import type { CallExprNode, Word } from "./types.js";

/** Sentinel for positional args whose value cannot be statically
 *  resolved (variables, command substitutions). Distinct from any
 *  literal string a user might write — a script saying `cmd "<dynamic>"`
 *  produces `args: ["<dynamic>"]`, never `args: [DYNAMIC]`. */
export const DYNAMIC: unique symbol = Symbol("shell-ast.DYNAMIC");

export type ResolvedArg = string | typeof DYNAMIC;

export interface ResolvedCall {
  cmd: string; // first argument value, e.g. "rm"
  flags: string[]; // all "-x" and "--foo" arguments, split from combined short flags
  args: ResolvedArg[]; // non-flag positional arguments; DYNAMIC for unresolvable
  raw: CallExprNode; // original AST node
}

// wordToLit extracts the effective string value of a Word as it would
// be passed to a command after shell quote-stripping. Returns null
// when the value can't be statically resolved (variables, command
// substitutions, multi-part juxtapositions).
//
// Handles:
//   echo hello       → "hello"   (Lit)
//   echo "hello"     → "hello"   (DblQuoted{Lit})
//   echo ""          → ""        (empty DblQuoted — empty string, NOT unresolvable)
//   echo 'hello'     → "hello"   (SglQuoted)
//   echo ''          → ""        (empty SglQuoted)
//   echo "$x"        → null      (DblQuoted with ParamExp)
//   echo "a"b        → null      (multi-part juxtaposition)
export function wordToLit(w: Word): string | null {
  if (w.parts.length !== 1) return null;
  const p = w.parts[0];
  if (!p) return null;
  if (p.type === "Lit") return p.value;
  if (p.type === "SglQuoted") return p.value;
  if (p.type === "DblQuoted") {
    // Empty `""` is a valid empty-string literal, not unresolvable.
    if (p.parts.length === 0) return "";
    if (p.parts.length === 1) {
      const inner = p.parts[0];
      if (inner?.type === "Lit") return inner.value;
    }
  }
  return null;
}

/** True iff every char after the leading dash is an ASCII letter. Only
 *  pure-letter sequences expand as combined short flags (`-rf` → -r -f).
 *  Anything containing `=`, digits, or punctuation (`-=value`, `-O2`) is
 *  preserved as a single token to avoid fabricating flags that weren't
 *  in the source. */
function isCombinedShortFlag(s: string): boolean {
  if (s.length <= 2 || s.startsWith("--")) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isAscii =
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a); // a-z
    if (!isAscii) return false;
  }
  return true;
}

export function resolveFlags(call: CallExprNode): ResolvedCall | null {
  if (call.args.length === 0) return null;

  const firstArg = call.args[0];
  if (!firstArg) return null;
  const firstLit = wordToLit(firstArg);
  if (firstLit === null) return null;

  const flags: string[] = [];
  const args: ResolvedArg[] = [];
  let endOfFlags = false;

  for (const word of call.args.slice(1)) {
    const lit = wordToLit(word);
    if (lit === null) {
      args.push(DYNAMIC);
      continue;
    }
    // Only the FIRST literal `--` toggles end-of-flags. After that,
    // a `--` token is itself a positional argument.
    if (lit === "--" && !endOfFlags) {
      endOfFlags = true;
      continue;
    }
    // POSIX convention: a bare `-` is a positional (stdin sentinel),
    // not a flag.
    if (!endOfFlags && lit.startsWith("-") && lit !== "-") {
      if (isCombinedShortFlag(lit)) {
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
