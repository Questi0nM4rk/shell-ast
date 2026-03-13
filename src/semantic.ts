import { resolveFlags, wordToLit } from "./helpers.js";
import type { CallExprNode } from "./types.js";

export type { ResolvedCall } from "./helpers.js";

const SUDO_FLAGS_WITH_ARGS = new Set(["-u", "-g", "-r", "-t", "-T", "-C", "-p", "-U"]);
const PRIVILEGE_ESCALATORS = new Set(["sudo", "doas", "run0", "su"]);

export interface UnwrappedCall {
  wrapper: string | null; // "sudo", "doas", etc. — or null if not wrapped
  cmd: string;
  flags: string[];
  args: string[];
  raw: CallExprNode;
}

export function unwrapCall(call: CallExprNode): UnwrappedCall | null {
  const resolved = resolveFlags(call);
  if (!resolved) return null;

  if (!PRIVILEGE_ESCALATORS.has(resolved.cmd)) {
    return { wrapper: null, ...resolved };
  }

  // Skip past the privilege escalator's own flags (which may take arguments)
  const rawArgs = call.args.slice(1);
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (!arg) break;
    const lit = wordToLit(arg);
    if (lit === null) break;
    if (SUDO_FLAGS_WITH_ARGS.has(lit)) {
      i += 2; // skip -u root
      continue;
    }
    if (lit.startsWith("-")) {
      i++; // skip -n, --login
      continue;
    }
    break; // found the real command
  }

  if (i >= rawArgs.length) return null;

  // Build a synthetic CallExpr from position i onward
  const innerArgs = rawArgs.slice(i);
  const syntheticCall: CallExprNode = {
    ...call,
    assigns: [],
    args: innerArgs,
  };
  const innerResolved = resolveFlags(syntheticCall);
  if (!innerResolved) return null;

  return {
    wrapper: resolved.cmd,
    ...innerResolved,
    raw: call,
  };
}

// wordToLit is re-exported from helpers for convenience
export { wordToLit } from "./helpers.js";
