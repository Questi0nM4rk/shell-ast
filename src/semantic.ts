// Privilege-escalator and shell-wrapper unwrapping.
//
// Result space is an exhaustive discriminated union — every legitimate
// outcome has its own `kind`. Consumers write `switch (u.kind)` with
// TypeScript exhaustiveness; ambiguous-shape bugs (commands as flags,
// wrapper detection lost, dual representation of script + args)
// become impossible to construct.

import type { ResolvedArg } from "./flags.js";
import { DYNAMIC, resolveFlags, wordToLit } from "./flags.js";
import type { CallExprNode, ShellFile } from "./types.js";

export type { ResolvedArg, ResolvedCall } from "./flags.js";

// ─── Wrapper schema ──────────────────────────────────────────────────────────

interface WrapperSchema {
  /** Flags that consume the next positional arg as their value
   *  (`sudo -u root cmd`, `sudo --user root cmd`). Include both short
   *  and space-form long variants. */
  flagsWithArg: ReadonlySet<string>;
  /** When true, --foo=value is also accepted (single token, no extra arg). */
  longEq: boolean;
  /** When set, this flag's value is itself a shell command string
   *  (`bash -c "..."`). */
  commandFlag?: string;
  /** When true, the first positional arg is the target username
   *  (`gosu USER cmd`, `su USER -c "..."`). */
  positionalUser?: boolean;
  /** Some shells take their script via positional args, not a flag:
   *    "concat" — `eval "rm" "-rf" "/"` joins args[1:] with spaces
   *    "first"  — (reserved for future shapes; not currently used)
   *  When set, the wrapper produces a "wrapped-script" variant whose
   *  script field is built from positional args after the wrapper's
   *  own flags are consumed. */
  commandFromArgs?: "concat" | "first";
}

const SHELL_SCHEMA: WrapperSchema = {
  flagsWithArg: new Set(),
  longEq: false,
  commandFlag: "-c",
};

const WRAPPERS: Readonly<Record<string, WrapperSchema>> = {
  // sudo: short flags accept space- or equals-form; long flags accept
  // both `--user=root` (longEq) and `--user root` (space). Include both
  // in flagsWithArg so space-form long flags are consumed.
  sudo: {
    flagsWithArg: new Set([
      "-u",
      "-g",
      "-h",
      "-D",
      "-C",
      "-p",
      "-r",
      "-t",
      "-T",
      "-U",
      "--user",
      "--group",
      "--host",
      "--chdir",
      "--close-from",
      "--prompt",
      "--role",
      "--type",
      "--command-timeout",
      "--other-user",
    ]),
    longEq: true,
  },
  doas: {
    flagsWithArg: new Set(["-u", "-C"]),
    longEq: false,
  },
  run0: {
    flagsWithArg: new Set([]),
    longEq: true,
  },
  pkexec: {
    flagsWithArg: new Set(["--user"]),
    longEq: true,
  },
  gosu: {
    flagsWithArg: new Set([]),
    longEq: false,
    positionalUser: true,
  },
  runuser: {
    flagsWithArg: new Set([
      "-u",
      "-g",
      "-G",
      "-s",
      "--user",
      "--group",
      "--supp-group",
      "--shell",
    ]),
    longEq: true,
    commandFlag: "-c",
  },
  setpriv: {
    flagsWithArg: new Set([
      "--reuid",
      "--regid",
      "--groups",
      "--bounding-set",
      "--securebits",
      "--pdeathsig",
    ]),
    longEq: true,
  },
  su: {
    flagsWithArg: new Set(["-s", "-G", "--shell", "--supp-group"]),
    longEq: false,
    commandFlag: "-c",
    positionalUser: true,
  },
  // POSIX shell wrappers carrying a script via -c. Not privilege
  // escalators, but chained patterns like `pkexec sh -c "rm -rf /"`
  // hide the inner command; surface the script regardless.
  sh: SHELL_SCHEMA,
  bash: SHELL_SCHEMA,
  zsh: SHELL_SCHEMA,
  dash: SHELL_SCHEMA,
  ash: SHELL_SCHEMA,
  ksh: SHELL_SCHEMA,
  mksh: SHELL_SCHEMA,
  // Shell-execution primitives whose script comes from positional args.
  //   eval "rm -rf /" — args[1:] joined by spaces, re-parsed at runtime
  //   exec rm -rf /   — args[1:] replace the current process
  // exec is also handled as a normal wrapper since args[1:] IS the inner command.
  eval: { flagsWithArg: new Set(), longEq: false, commandFromArgs: "concat" },
  exec: { flagsWithArg: new Set(), longEq: false },
};

// ─── Discriminated UnwrappedCall (BUG-003) ───────────────────────────────────

/** The four legitimate outcomes of unwrapping a CallExpr. Consumers
 *  write `switch (u.kind)` and TypeScript forces exhaustive handling.
 *
 *  - `plain`:           not a wrapper, or wrapper-named but used non-wrapper-ly
 *                       (`bash`, `bash --version`, `sudo -V`, `gosu user`)
 *  - `wrapped`:         wrapper detected, inner command resolved statically
 *                       (`sudo rm -rf /`, `gosu user rm /tmp`, `exec rm /`)
 *  - `wrapped-script`:  wrapper detected, inner is a shell-script string
 *                       (`bash -c "rm"`, `eval "rm -rf"`). `script` is
 *                       the value; consumers parse it themselves or use
 *                       `unwrapCallParsed` for the pre-parsed `innerAst`.
 *  - `wrapped-opaque`:  wrapper detected, inner unresolvable (`sudo $cmd`,
 *                       `bash -c $script`). Wrapper detection preserved
 *                       so security consumers still see escalation. */
export type UnwrappedCall =
  | {
      kind: "plain";
      cmd: string;
      flags: string[];
      args: ResolvedArg[];
      raw: CallExprNode;
    }
  | {
      kind: "wrapped";
      wrapper: string;
      cmd: string;
      flags: string[];
      args: ResolvedArg[];
      raw: CallExprNode;
    }
  | {
      kind: "wrapped-script";
      wrapper: string;
      /** The script-string value of the commandFlag (or concatenated
       *  positional args for `eval`). Re-parse with `parse()` or use
       *  `unwrapCallParsed` to get `innerAst` populated. */
      script: string;
      /** Wrapper's own flags as parsed (e.g. ["-c"]). */
      flags: string[];
      /** Positional args AFTER the script — bash assigns these to
       *  $0/$1/… inside the inner script. */
      args: ResolvedArg[];
      raw: CallExprNode;
      /** Pre-parsed inner AST. Populated only by `unwrapCallParsed`. */
      innerAst?: ShellFile;
    }
  | {
      kind: "wrapped-opaque";
      wrapper: string;
      flags: string[];
      args: ResolvedArg[];
      raw: CallExprNode;
    };

// ─── unwrapCall (sync) ───────────────────────────────────────────────────────

/** Unwrap a CallExpr. Sync; never parses the inner script for
 *  `wrapped-script` results. Use `unwrapCallParsed` if you need
 *  `innerAst`.
 *
 *  Returns null only for truly malformed input (CallExpr with no args
 *  at all — pure assignment-only stmts). All other shapes resolve to
 *  one of the four discriminator kinds. */
export function unwrapCall(call: CallExprNode): UnwrappedCall | null {
  const resolved = resolveFlags(call);
  if (!resolved) return null;

  const schema = WRAPPERS[resolved.cmd];
  if (!schema) {
    return {
      kind: "plain",
      cmd: resolved.cmd,
      flags: resolved.flags,
      args: resolved.args,
      raw: resolved.raw,
    };
  }

  // commandFromArgs wrappers (eval) — script is positional, not -c flagged.
  if (schema.commandFromArgs) {
    return unwrapPositionalScript(resolved, call, schema);
  }

  // Standard flag-walker.
  const rawArgs = call.args.slice(1);
  let userConsumed = !schema.positionalUser;
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (!arg) break;
    const lit = wordToLit(arg);
    if (lit === null) break; // dynamic — stop walking

    // commandFlag (-c) — extract the script string.
    if (schema.commandFlag && lit === schema.commandFlag) {
      const next = rawArgs[i + 1];
      const script = next ? wordToLit(next) : null;
      if (script === null) {
        // bash -c with no value or dynamic value → opaque
        return {
          kind: "wrapped-opaque",
          wrapper: resolved.cmd,
          flags: resolved.flags,
          args: resolved.args,
          raw: call,
        };
      }
      const trailingArgs: ResolvedArg[] = [];
      for (const w of rawArgs.slice(i + 2)) {
        const t = wordToLit(w);
        trailingArgs.push(t === null ? DYNAMIC : t);
      }
      return {
        kind: "wrapped-script",
        wrapper: resolved.cmd,
        script,
        flags: resolved.flags,
        args: trailingArgs,
        raw: call,
      };
    }
    if (schema.longEq && lit.startsWith("--") && lit.includes("=")) {
      i++;
      continue;
    }
    if (schema.flagsWithArg.has(lit)) {
      i += 2;
      continue;
    }
    if (lit.startsWith("-")) {
      i++;
      continue;
    }
    // Positional. First one is the username when positionalUser is set.
    if (!userConsumed) {
      userConsumed = true;
      i++;
      continue;
    }
    break; // inner command
  }

  if (i >= rawArgs.length) {
    // Wrapper-named but no inner command found. Not really wrapping.
    return {
      kind: "plain",
      cmd: resolved.cmd,
      flags: resolved.flags,
      args: resolved.args,
      raw: resolved.raw,
    };
  }

  const innerArgs = rawArgs.slice(i);
  const firstInner = innerArgs[0];
  const lastInner = innerArgs[innerArgs.length - 1];
  if (!firstInner || !lastInner) return null;
  const syntheticCall: CallExprNode = {
    type: "CallExpr",
    assigns: [],
    args: innerArgs,
    pos: firstInner.pos,
    end: lastInner.end,
  };
  const innerResolved = resolveFlags(syntheticCall);
  if (!innerResolved) {
    // Inner is dynamic (`sudo $cmd`). Wrapper detection preserved.
    return {
      kind: "wrapped-opaque",
      wrapper: resolved.cmd,
      flags: resolved.flags,
      args: resolved.args,
      raw: call,
    };
  }
  return {
    kind: "wrapped",
    wrapper: resolved.cmd,
    cmd: innerResolved.cmd,
    flags: innerResolved.flags,
    args: innerResolved.args,
    raw: call,
  };
}

/** Internal: handle eval-style positional-script wrappers. */
function unwrapPositionalScript(
  resolved: { cmd: string; flags: string[]; args: ResolvedArg[]; raw: CallExprNode },
  call: CallExprNode,
  schema: WrapperSchema
): UnwrappedCall {
  const positional = call.args.slice(1);
  if (positional.length === 0) {
    // Bare `eval` — no-op invocation; surface as plain.
    return {
      kind: "plain",
      cmd: resolved.cmd,
      flags: resolved.flags,
      args: resolved.args,
      raw: resolved.raw,
    };
  }
  const literals: string[] = [];
  for (const w of positional) {
    const lit = wordToLit(w);
    if (lit === null) {
      return {
        kind: "wrapped-opaque",
        wrapper: resolved.cmd,
        flags: resolved.flags,
        args: resolved.args,
        raw: call,
      };
    }
    literals.push(lit);
  }
  const script =
    schema.commandFromArgs === "concat" ? literals.join(" ") : (literals[0] ?? "");
  return {
    kind: "wrapped-script",
    wrapper: resolved.cmd,
    script,
    flags: resolved.flags,
    args: [],
    raw: call,
  };
}

// ─── unwrapCallParsed (async — populates innerAst, BUG-007) ──────────────────

/** Async unwrap that additionally pre-parses the script for any
 *  `wrapped-script` result. Consumers wanting to recurse into the
 *  inner AST get it without a second parse() call.
 *
 *  Takes a `parse` function as input to avoid a circular import.
 *  The public `parse` from `src/index.ts` is the expected argument. */
export async function unwrapCallParsed(
  call: CallExprNode,
  parse: (src: string) => Promise<ShellFile>
): Promise<UnwrappedCall | null> {
  const u = unwrapCall(call);
  if (!u || u.kind !== "wrapped-script") return u;
  try {
    const innerAst = await parse(u.script);
    return { ...u, innerAst };
  } catch {
    // Inner script is shell-syntactically invalid — return without
    // innerAst so consumers can still inspect the script string.
    return u;
  }
}
