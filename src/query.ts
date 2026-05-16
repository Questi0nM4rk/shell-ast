// Zero-configuration query helpers for inspecting a CallExprNode.
//
// All helpers operate on a raw CallExpr (the result of `findCalls`),
// and none of them require `resolveFlags` to be called first. They are
// the "give me one piece of info about this call" primitives that
// consumers (hook-kit, ai-guardrails) compose into rules.
//
// Per-tool knowledge does NOT live here. These helpers don't know
// "gcc -o means output" — they just know "find the token after -o".
// The consumer brings the semantics.
//
// Both space form (`-C /tmp`) and joined `=` form (`--git-dir=/repo`)
// are handled where the operation makes sense:
//   - tokenAfter / tokensAfter: returns value for both forms
//   - hasFlag: matches both forms AND combined-short components (-r in -rf)
//   - indexOfFlag: returns the index of the containing token in either form
//   - flagsMatching: filters raw literal tokens (no form rewriting)
//
// All helpers return ResolvedArg (string | DYNAMIC) or undefined. Dynamic
// values surface as DYNAMIC; consumers decide whether to deny-by-default
// or inspect via wordToParts.

import { DYNAMIC, type ResolvedArg, wordToLit } from "./flags.js";
import type { CallExprNode } from "./types.js";

/** Pure-ASCII-letter sequence after the leading dash. Matches the same
 *  rule resolveFlags uses for combined short flags. */
function isCombinedShortFlag(s: string): boolean {
  if (s.length <= 2 || s.startsWith("--")) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isAscii = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (!isAscii) return false;
  }
  return true;
}

/** True iff `lit` matches `flag` either as a literal token, as part of a
 *  combined short flag, or as the LHS of an = form. Used by hasFlag /
 *  indexOfFlag for the "broad" semantics. */
function tokenContainsFlag(lit: string, flag: string): boolean {
  if (lit === flag) return true;
  if (flag.startsWith("--")) {
    return lit.startsWith(`${flag}=`);
  }
  if (flag.startsWith("-") && flag.length === 2) {
    // Short flag like "-r" — check inside a combined short flag
    if (isCombinedShortFlag(lit) && lit.includes(flag.charAt(1))) return true;
  }
  return false;
}

/** First value following `flag` in `call.args`, handling both space form
 *  (`-C /tmp`) and joined `=` form (`--git-dir=/repo`).
 *
 *  Returns the value token (resolved literal or DYNAMIC), or `undefined`
 *  when the flag is absent, has no following token (end-of-args), or
 *  only appears inside a combined-short group like `-rf` (strict literal
 *  match avoids ambiguity for short flags). */
export function tokenAfter(call: CallExprNode, flag: string): ResolvedArg | undefined {
  const rest = call.args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word) continue;
    const lit = wordToLit(word);
    if (lit === null) continue;
    // Joined = form: --git-dir=/repo → return /repo
    if (flag.startsWith("--") && lit.startsWith(`${flag}=`)) {
      return lit.slice(flag.length + 1);
    }
    // Literal token: next word is the value
    if (lit === flag) {
      const next = rest[i + 1];
      if (next === undefined) return undefined;
      const nextLit = wordToLit(next);
      return nextLit === null ? DYNAMIC : nextLit;
    }
  }
  return undefined;
}

/** Values following EVERY occurrence of `flag` — one entry per occurrence.
 *  Same matching rules as `tokenAfter`. Useful for repeated value-flags
 *  like `git -c k1=v1 -c k2=v2`. */
export function tokensAfter(call: CallExprNode, flag: string): ResolvedArg[] {
  const out: ResolvedArg[] = [];
  const rest = call.args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word) continue;
    const lit = wordToLit(word);
    if (lit === null) continue;
    if (flag.startsWith("--") && lit.startsWith(`${flag}=`)) {
      out.push(lit.slice(flag.length + 1));
      continue;
    }
    if (lit === flag) {
      const next = rest[i + 1];
      if (next === undefined) continue;
      const nextLit = wordToLit(next);
      out.push(nextLit === null ? DYNAMIC : nextLit);
    }
  }
  return out;
}

/** True iff `flag` appears in the call in any syntactic form: literal
 *  token, combined-short component (`-r` is "present" in `-rf`), or
 *  LHS of an = form (`--git-dir` is "present" in `--git-dir=/repo`).
 *
 *  This is the "does this command use this option, in any form?"
 *  question. For strict-literal "appears as its own token", use
 *  `resolveFlags(call).flags.includes(flag)`. */
export function hasFlag(call: CallExprNode, flag: string): boolean {
  for (const word of call.args.slice(1)) {
    if (!word) continue;
    const lit = wordToLit(word);
    if (lit === null) continue;
    if (tokenContainsFlag(lit, flag)) return true;
  }
  return false;
}

/** Index in `call.args` where `flag` first appears (matched via the same
 *  broad rules as `hasFlag`). The index is the containing token's
 *  position, so `gcc -rf out.txt` returns 1 for both `-r` and `-f` (both
 *  live inside the `-rf` token at index 1).
 *
 *  Returns `undefined` when not found. */
export function indexOfFlag(call: CallExprNode, flag: string): number | undefined {
  for (let i = 1; i < call.args.length; i++) {
    const word = call.args[i];
    if (!word) continue;
    const lit = wordToLit(word);
    if (lit === null) continue;
    if (tokenContainsFlag(lit, flag)) return i;
  }
  return undefined;
}

/** `call.args[i]` resolved via `wordToLit`. Returns `DYNAMIC` for
 *  non-static words, `undefined` for out-of-range or negative `i`.
 *
 *  Note: `tokenAt(call, 0)` is the COMMAND itself (`call.args[0]`),
 *  matching the underlying AST shape. The first arg-after-cmd is at
 *  index 1. */
export function tokenAt(call: CallExprNode, i: number): ResolvedArg | undefined {
  if (i < 0 || i >= call.args.length) return undefined;
  const word = call.args[i];
  if (!word) return undefined;
  const lit = wordToLit(word);
  return lit === null ? DYNAMIC : lit;
}

/** All literal-resolvable flag-shaped tokens in `call.args[1..]` whose
 *  string value passes `predicate`. The command itself (`call.args[0]`)
 *  is never included. Dynamic tokens are skipped.
 *
 *  Use this for non-standard flag syntaxes that `resolveFlags` does not
 *  recognize: dd's `if=/of=` form, awk's `-F`-style, anything you want
 *  to match by substring. */
export function flagsMatching(
  call: CallExprNode,
  predicate: (token: string) => boolean
): string[] {
  const out: string[] = [];
  for (const word of call.args.slice(1)) {
    if (!word) continue;
    const lit = wordToLit(word);
    if (lit === null) continue;
    if (predicate(lit)) out.push(lit);
  }
  return out;
}

/** Basename of the call's command word, resolved via `wordToLit`.
 *
 *  `/usr/bin/git` → `"git"`, `./bin/docker` → `"docker"`, `git` → `"git"`.
 *  Returns `undefined` for dynamic command words. Matches the lookup
 *  rule used by `resolveFlags` for `globalFlags` table dispatch, so
 *  consumer per-tool branches stay consistent regardless of how the
 *  user wrote the path.
 *
 *  Edge case: a literal trailing-slash path (`/bin/`) returns the empty
 *  string. Realistic inputs never look like this; documenting for
 *  completeness. */
export function resolvedCmd(call: CallExprNode): string | undefined {
  const first = call.args[0];
  if (!first) return undefined;
  const lit = wordToLit(first);
  if (lit === null) return undefined;
  const slash = lit.lastIndexOf("/");
  return slash === -1 ? lit : lit.slice(slash + 1);
}
