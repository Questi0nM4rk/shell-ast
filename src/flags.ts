import type { CallExprNode, SglQuoted, Word } from "./types.js";

// ─── DYNAMIC sentinel + type guards (BUG-005) ────────────────────────────────

/** Sentinel for positional args whose value cannot be statically
 *  resolved (variables, command substitutions). Distinct from any
 *  literal string a user might write — a script saying `cmd "<dynamic>"`
 *  produces `args: ["<dynamic>"]`, never `args: [DYNAMIC]`. */
export const DYNAMIC: unique symbol = Symbol("shell-ast.DYNAMIC");

export type ResolvedArg = string | typeof DYNAMIC;

/** Narrow a ResolvedArg to its DYNAMIC sentinel form. Prefer this over
 *  `a === DYNAMIC` so the type-guard intent is explicit and so
 *  refactoring the sentinel shape stays a one-file change. */
export function isDynamic(a: ResolvedArg): a is typeof DYNAMIC {
  return a === DYNAMIC;
}

/** Narrow a ResolvedArg to its resolved string form. Survives any
 *  future sentinel-shape regressions where a compiled output ships
 *  `"<dynamic>"` as a string and would pass `typeof === "string"`. */
export function isResolved(a: ResolvedArg): a is string {
  return typeof a === "string" && a !== (DYNAMIC as unknown as string);
}

// ─── ArgFragment / wordToParts (BUG-004) ─────────────────────────────────────

/** A single piece of a shell word after as much static evaluation as
 *  the parser can do. Words are zero or more fragments concatenated
 *  at runtime; some fragments resolve to a literal string, others
 *  expand dynamically (variables, command substitutions). */
export type ArgFragment =
  | { kind: "literal"; value: string }
  | { kind: "dynamic"; sourceText: string };

/** Decompose a Word into its statically-resolvable fragments. Never
 *  returns null — even `echo $cmd` yields one dynamic fragment, so
 *  consumers see "this is dynamic; here's the source text" instead
 *  of the binary string-or-null of wordToLit.
 *
 *  Each Lit / SglQuoted / DblQuoted{Lit only} part becomes a
 *  "literal" fragment; anything else (ParamExp, CmdSubst, ArithmExp,
 *  ProcSubst, ExtGlob, BraceExp) becomes a "dynamic" fragment with
 *  the best sourceText we can derive.
 *
 *  Empty Words (e.g. `""` after SplitBraces produces them) yield
 *  `[{kind:"literal", value:""}]` — always at least one fragment so
 *  consumers can iterate without special-casing. */
export function wordToParts(w: Word): ArgFragment[] {
  if (w.parts.length === 0) return [{ kind: "literal", value: "" }];
  const out: ArgFragment[] = [];
  for (const p of w.parts) {
    if (p.type === "Lit") {
      out.push({ kind: "literal", value: p.value });
      continue;
    }
    if (p.type === "SglQuoted") {
      // $'...' processes ANSI-C escape sequences; '...' is verbatim.
      const value = p.dollar ? unescapeAnsiC(p.value) : p.value;
      out.push({ kind: "literal", value });
      continue;
    }
    if (p.type === "DblQuoted") {
      const folded = foldDblQuoted(p.parts);
      if (folded !== null) {
        out.push({ kind: "literal", value: folded });
      } else {
        out.push({ kind: "dynamic", sourceText: dblQuotedSourceText(p.parts) });
      }
      continue;
    }
    // ParamExp / CmdSubst / ArithmExp / ProcSubst / ExtGlob / BraceExp
    out.push({ kind: "dynamic", sourceText: wordPartSourceText(p) });
  }
  return out;
}

/** True iff every part of a DblQuoted body is statically resolvable.
 *  Returns the concatenated value when true, null otherwise. */
function foldDblQuoted(parts: readonly Word["parts"][number][]): string | null {
  let out = "";
  for (const inner of parts) {
    if (inner.type === "Lit") {
      out += inner.value;
    } else if (inner.type === "SglQuoted") {
      out += inner.dollar ? unescapeAnsiC(inner.value) : inner.value;
    } else {
      return null;
    }
  }
  return out;
}

/** Approximate source text for a dynamic word-part, used as the
 *  `sourceText` of an `{kind:"dynamic"}` fragment. Best-effort —
 *  consumers needing exact source should re-extract from the file. */
function wordPartSourceText(p: Word["parts"][number]): string {
  switch (p.type) {
    case "Lit":
      return p.value;
    case "SglQuoted":
      return p.dollar ? `$'${p.value}'` : `'${p.value}'`;
    case "DblQuoted":
      return `"${dblQuotedSourceText(p.parts)}"`;
    case "ParamExp":
      return p.short && p.param ? `$${p.param.value}` : "${...}";
    case "CmdSubst":
      return p.backquotes ? "`...`" : "$(...)";
    case "ArithmExp":
      return p.bracket ? "$[...]" : "$((...))";
    case "ProcSubst":
      return `${p.op}...)`;
    case "ExtGlob":
      return `${p.op}${p.pattern.value})`;
    case "BraceExp":
      return "{...}";
    default:
      return "...";
  }
}

function dblQuotedSourceText(parts: readonly Word["parts"][number][]): string {
  let out = "";
  for (const inner of parts) out += wordPartSourceText(inner);
  return out;
}

// ─── ANSI-C unescape ($'...') ────────────────────────────────────────────────

/** Process ANSI-C escape sequences inside `$'...'` per bash(1).
 *  Handles \\a \\b \\e \\f \\n \\r \\t \\v \\\\ \\' \\" \\? \\0NNN \\xHH \\uHHHH.
 *  Unknown escapes are kept verbatim (matches bash leniency). */
export function unescapeAnsiC(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c !== "\\" || i + 1 >= s.length) {
      out += c;
      i++;
      continue;
    }
    const next = s[i + 1]!;
    switch (next) {
      case "a":
        out += "\x07";
        i += 2;
        continue;
      case "b":
        out += "\b";
        i += 2;
        continue;
      case "e":
      case "E":
        out += "\x1b";
        i += 2;
        continue;
      case "f":
        out += "\f";
        i += 2;
        continue;
      case "n":
        out += "\n";
        i += 2;
        continue;
      case "r":
        out += "\r";
        i += 2;
        continue;
      case "t":
        out += "\t";
        i += 2;
        continue;
      case "v":
        out += "\v";
        i += 2;
        continue;
      case "\\":
        out += "\\";
        i += 2;
        continue;
      case "'":
        out += "'";
        i += 2;
        continue;
      case '"':
        out += '"';
        i += 2;
        continue;
      case "?":
        out += "?";
        i += 2;
        continue;
      case "x": {
        const hex = s.substring(i + 2, i + 4).match(/^[0-9A-Fa-f]{1,2}/);
        if (!hex) {
          out += c + next;
          i += 2;
          continue;
        }
        out += String.fromCharCode(parseInt(hex[0], 16));
        i += 2 + hex[0].length;
        continue;
      }
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7": {
        const oct = s.substring(i + 1, i + 4).match(/^[0-7]{1,3}/);
        if (!oct) {
          out += c + next;
          i += 2;
          continue;
        }
        out += String.fromCharCode(parseInt(oct[0], 8));
        i += 1 + oct[0].length;
        continue;
      }
      case "u": {
        const hex = s.substring(i + 2, i + 6).match(/^[0-9A-Fa-f]{1,4}/);
        if (!hex) {
          out += c + next;
          i += 2;
          continue;
        }
        out += String.fromCodePoint(parseInt(hex[0], 16));
        i += 2 + hex[0].length;
        continue;
      }
      case "U": {
        const hex = s.substring(i + 2, i + 10).match(/^[0-9A-Fa-f]{1,8}/);
        if (!hex) {
          out += c + next;
          i += 2;
          continue;
        }
        const cp = parseInt(hex[0], 16);
        if (cp > 0x10ffff) {
          out += c + next;
          i += 2;
          continue;
        }
        out += String.fromCodePoint(cp);
        i += 2 + hex[0].length;
        continue;
      }
      default:
        // Unknown escape — keep verbatim
        out += c + next;
        i += 2;
    }
  }
  return out;
}

// ─── wordToLit (convenience over wordToParts) ────────────────────────────────

/** Returns the static string value of a Word when every fragment is
 *  statically resolvable, joined as the command would see them after
 *  quote-stripping. Returns null for any dynamic component.
 *
 *  Multi-part juxtapositions of static fragments fold:
 *    echo "foo""bar"   → "foobar"
 *    echo 'a'b"c"      → "abc"
 *    echo $'hi\\n'      → "hi\\n" (real newline)
 *    echo "x$y"        → null    (mid-word ParamExp)
 *    echo ""           → ""      (empty literal — NOT null) */
export function wordToLit(w: Word): string | null {
  const parts = wordToParts(w);
  let out = "";
  for (const f of parts) {
    if (f.kind !== "literal") return null;
    out += f.value;
  }
  return out;
}

// ─── ResolvedCall + resolveFlags ─────────────────────────────────────────────

export interface ResolvedCall {
  cmd: string; // first argument value, e.g. "rm"
  flags: string[]; // all "-x" and "--foo" arguments, split from combined short flags
  args: ResolvedArg[]; // non-flag positional arguments; DYNAMIC for unresolvable
  raw: CallExprNode; // original AST node
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

// Avoid an unused-import warning for SglQuoted; it's used only in the
// type position of `unescapeAnsiC`'s contract, which the JSDoc above
// describes informally. Exporting nothing keeps the surface minimal.
export type { SglQuoted };
