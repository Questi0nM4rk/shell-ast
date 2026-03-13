import type { CallExprNode, LitNode, ShellFile, Word } from "./types.js";
import { walk } from "./walk.js";

export interface ResolvedCall {
  cmd: string; // first argument value, e.g. "rm"
  flags: string[]; // all "-x" and "--foo" arguments, split from combined short flags
  args: string[]; // non-flag positional arguments
  raw: CallExprNode; // original AST node
}

export function findCalls(ast: ShellFile): CallExprNode[] {
  const calls: CallExprNode[] = [];
  walk(ast, {
    CallExpr(node) {
      calls.push(node);
    },
  });
  return calls;
}

// wordToLit extracts the string value from a single-Lit Word.
// Returns null if the word contains expansions or multiple parts.
export function wordToLit(w: Word): string | null {
  const first = w.parts[0];
  if (w.parts.length === 1 && first?.type === "Lit") {
    return (first as LitNode).value;
  }
  return null;
}

export function resolveFlags(call: CallExprNode): ResolvedCall | null {
  if (call.args.length === 0) return null;

  const firstArg = call.args[0];
  if (!firstArg) return null;
  const firstLit = wordToLit(firstArg);
  if (firstLit === null) return null;

  const flags: string[] = [];
  const args: string[] = [];
  let endOfFlags = false;

  for (const word of call.args.slice(1)) {
    const lit = wordToLit(word);
    if (lit === null) {
      args.push("<dynamic>");
      continue;
    }
    if (lit === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && lit.startsWith("-")) {
      // Expand combined short flags: -rf → ["-r", "-f"]
      if (lit.length > 2 && !lit.startsWith("--")) {
        for (const ch of lit.slice(1)) flags.push(`-${ch}`);
      } else {
        flags.push(lit);
      }
    } else {
      args.push(lit);
    }
  }

  return { cmd: firstLit, flags, args, raw: call };
}
