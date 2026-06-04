// unwrapCall — sync entry point that turns a CallExpr into one of the
// four `UnwrappedCall` variants. The async variant `unwrapCallParsed`
// (in ./unwrap-async.ts) wraps this and additionally pre-parses the
// inner script for `wrapped-script` results.

import {
  DYNAMIC,
  type ResolvedArg,
  type ResolvedCall,
  type ResolveFlagsOptions,
  resolveFlags,
  wordToLit,
} from "../flags.js";
import type { CallExprNode } from "../types.js";
import { WRAPPERS, type WrapperSchema } from "./registry.js";
import type { UnwrappedCall } from "./types.js";

/** Unwrap a CallExpr. Sync; never parses the inner script for
 *  `wrapped-script` results. Use `unwrapCallParsed` if you need
 *  `innerAst`.
 *
 *  Returns null only for truly malformed input (CallExpr with no args
 *  at all — pure assignment-only stmts). All other shapes resolve to
 *  one of the four discriminator kinds. */
export function unwrapCall(
  call: CallExprNode,
  opts?: ResolveFlagsOptions
): UnwrappedCall | null {
  const resolved = resolveFlags(call, opts);
  if (!resolved) return null;

  const schema = WRAPPERS[resolved.cmd];
  if (!schema) {
    return {
      kind: "plain",
      cmd: resolved.cmd,
      flags: resolved.flags,
      args: resolved.args,
      flagValues: resolved.flagValues,
      raw: resolved.raw,
    };
  }

  // commandFromArgs wrappers (eval) — script is positional, not -c flagged.
  if (schema.commandFromArgs) {
    return unwrapPositionalScript(resolved, call, schema);
  }

  // Standard flag-walker.
  const rawArgs = call.args.slice(1);
  let leadingRemaining = schema.leadingPositionals ?? 0;
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
          reason: next === undefined ? "missing-script" : "dynamic-script",
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
    // Leading positional(s): su/gosu user, timeout duration. Skip them.
    if (leadingRemaining > 0) {
      leadingRemaining--;
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
      flagValues: resolved.flagValues,
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
  const innerResolved = resolveFlags(syntheticCall, opts);
  if (!innerResolved) {
    // Inner is dynamic (`sudo $cmd`). Wrapper detection preserved.
    return {
      kind: "wrapped-opaque",
      wrapper: resolved.cmd,
      reason: "dynamic-command",
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
    flagValues: innerResolved.flagValues,
    innerRaw: syntheticCall,
    raw: call,
  };
}

/** Internal: handle eval-style positional-script wrappers. */
function unwrapPositionalScript(
  resolved: ResolvedCall,
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
      flagValues: resolved.flagValues,
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
        reason: "dynamic-script",
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
