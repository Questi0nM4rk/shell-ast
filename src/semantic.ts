import type { ResolvedArg } from "./flags.js";
import { DYNAMIC, resolveFlags, wordToLit } from "./flags.js";
import type { CallExprNode } from "./types.js";

export type { ResolvedCall } from "./flags.js";

interface WrapperSchema {
  /** Flags that consume the next positional arg as their value. */
  flagsWithArg: ReadonlySet<string>;
  /** When true, --foo=value is also accepted (single token, no extra arg). */
  longEq: boolean;
  /** When set, this flag's value is itself a shell command string.
   *  unwrapCall returns it as `commandString` so the caller can
   *  recursively parse it. The wrapper's own cmd/flags/args describe
   *  the wrapper itself in this case. */
  commandFlag?: string;
  /** When true, the first positional arg is the target username
   *  (e.g. `gosu USER cmd`, `su USER -c "..."`). The walker consumes
   *  one positional before looking for the inner command. */
  positionalUser?: boolean;
}

const SHELL_SCHEMA: WrapperSchema = {
  flagsWithArg: new Set(),
  longEq: false,
  commandFlag: "-c",
};

const WRAPPERS: Readonly<Record<string, WrapperSchema>> = {
  // sudo: short flags accept either space- or equals-form for their values;
  // long flags accept both `--user=root` (longEq) and `--user root` (space).
  // Include both short and long forms in flagsWithArg so space-form long
  // flags are consumed correctly.
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
  // Shell wrappers carrying a command string. Not privilege escalators
  // by themselves, but `pkexec sh -c "rm -rf /"` chains them; consumers
  // need to surface the inner string regardless. All POSIX shells share
  // the same -c contract.
  sh: SHELL_SCHEMA,
  bash: SHELL_SCHEMA,
  zsh: SHELL_SCHEMA,
  dash: SHELL_SCHEMA,
  ash: SHELL_SCHEMA,
};

export interface UnwrappedCall {
  /** The wrapper name (sudo/doas/su/sh/...), or null when not wrapped. */
  wrapper: string | null;
  /** The inner command name. Null when the wrapper carries an opaque
   *  command string (commandString set) — caller must parse it. */
  cmd: string | null;
  flags: string[];
  args: ResolvedArg[];
  raw: CallExprNode;
  /** Set when the wrapper's `commandFlag` carried a shell-command
   *  string (e.g. `su -c "rm -rf /"` or `sh -c "..."`). When present,
   *  cmd/flags/args describe the wrapper itself; the caller should
   *  call parse() on commandString to analyze the inner command. */
  commandString?: string;
}

export function unwrapCall(call: CallExprNode): UnwrappedCall | null {
  const resolved = resolveFlags(call);
  if (!resolved) return null;

  const schema = WRAPPERS[resolved.cmd];
  if (!schema) {
    return { wrapper: null, ...resolved };
  }

  // Walk the wrapper's args, consuming its own flags. Some wrappers
  // (su, gosu) have a positional username before the inner command;
  // userConsumed tracks whether we've already eaten it.
  const rawArgs = call.args.slice(1);
  let userConsumed = !schema.positionalUser;
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (!arg) break;
    const lit = wordToLit(arg);
    if (lit === null) break; // dynamic — stop walking

    // commandFlag (su's -c, sh's -c, etc.) — extract the command string.
    if (schema.commandFlag && lit === schema.commandFlag) {
      const next = rawArgs[i + 1];
      const commandString = next ? wordToLit(next) : null;
      if (commandString === null) {
        // Wrapper-with-commandFlag detected but the script value is
        // missing or dynamic (`bash -c`, `bash -c $script`). The
        // wrapper IS active — preserve that detection so consumers
        // checking `wrapper === "bash"` for shell-execution still
        // see it. Inner script is unresolvable (no commandString).
        return {
          wrapper: resolved.cmd,
          cmd: null,
          flags: resolved.flags,
          args: resolved.args,
          raw: call,
        };
      }
      // Strip the consumed commandFlag value and any preceding wrapper
      // flags from the surfaced args. The remainder (tokens after the
      // commandString) is what bash's -c assigns to $0/$1/… inside the
      // inner script; consumers see those as wrapper.args. Avoids the
      // dual-representation where args still contains the script value
      // alongside `commandString`.
      const trailingArgs: ResolvedArg[] = [];
      for (const w of rawArgs.slice(i + 2)) {
        const t = wordToLit(w);
        trailingArgs.push(t === null ? DYNAMIC : t);
      }
      return {
        wrapper: resolved.cmd,
        cmd: null,
        flags: resolved.flags,
        args: trailingArgs,
        raw: call,
        commandString,
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
    // The wrapper-named command was invoked without an inner command
    // (e.g. `bash`, `bash --version`, RHS of `curl … | bash`, `sudo -V`,
    // `gosu user`). It isn't actually acting as a wrapper — return it
    // as a normal non-wrapped call so consumers can still pattern-match
    // on cmd/flags. Closes gh #7.
    return { wrapper: null, ...resolved };
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
    // Inner command is dynamic (`sudo $cmd`, `sudo -u root $cmd`). The
    // wrapper IS active — preserve it so security consumers checking
    // `wrapper === "sudo"` for privilege escalation still catch it.
    // cmd:null + no commandString signals "wrapper used, inner unresolvable".
    return {
      wrapper: resolved.cmd,
      cmd: null,
      flags: resolved.flags,
      args: resolved.args,
      raw: call,
    };
  }

  return {
    wrapper: resolved.cmd,
    cmd: innerResolved.cmd,
    flags: innerResolved.flags,
    args: innerResolved.args,
    raw: call,
  };
}
