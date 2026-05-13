# Migrating to `@questi0nm4rk/shell-ast@0.3.0`

This document is the reference for migrating a consumer (hook-kit,
ai-guardrails, or any other downstream) from v0.2.x to v0.3.0. It's
structured for both humans and AI agents: every section has a clear
**before**, **after**, and **why**.

## TL;DR — the one structural change

`UnwrappedCall` is now a **discriminated union** instead of an
all-fields-nullable record. Consumers `switch (u.kind)` instead of
guessing which of `wrapper`/`cmd`/`commandString` is the "real name"
in the current context.

```typescript
// v0.2.x — ambiguous, easy to misread
const u = unwrapCall(call);
if (u?.wrapper === "sudo" && u.cmd === "rm") {...}
if (u?.commandString) {/* re-parse */}
if (u === null) {/* what failed? unknown */}

// v0.3.0 — exhaustive, type-checked
const u = unwrapCall(call);
switch (u?.kind) {
  case "plain":          /* u.cmd, u.flags, u.args */                       break;
  case "wrapped":        /* u.wrapper, u.cmd, u.flags, u.args */            break;
  case "wrapped-script": /* u.wrapper, u.script — re-parse, or use innerAst */ break;
  case "wrapped-opaque": /* u.wrapper detected; inner unresolvable */       break;
  case undefined:        /* truly malformed (CallExpr with no args at all) */ break;
}
```

If you write a `switch (u.kind)` with all five cases, TypeScript proves
you handle every outcome. Adding a new variant in a future release will
fail your compile until you handle it.

---

## Search-and-replace cheatsheet

For mechanical migration of a v0.2.x codebase.

| If you wrote (v0.2.x) | Replace with (v0.3.0) |
|---|---|
| `u.wrapper === "sudo" && u.cmd === "rm"` | `u.kind === "wrapped" && u.wrapper === "sudo" && u.cmd === "rm"` |
| `u.wrapper === null && u.cmd === "rm"` | `u.kind === "plain" && u.cmd === "rm"` |
| `u.commandString` | `u.kind === "wrapped-script" && u.script` |
| `u !== null && (u.cmd ?? u.wrapper) === "bash"` | `u?.kind !== undefined && (u.kind === "plain" ? u.cmd : u.wrapper) === "bash"` |
| `u.cmd === null` (used to mean script) | `u.kind === "wrapped-script"` or `u.kind === "wrapped-opaque"` |
| `typeof a === "string"` (ResolvedArg narrowing) | `isResolved(a)` |
| `a === DYNAMIC` | `isDynamic(a)` |
| `try { parse(...) } catch (e) { /* string-match e.message */ }` | `catch (e) { if (e instanceof ParseSyntaxError) ... }` |
| Hand-rolled `["-c"]` extraction + `parse(commandString)` | `await unwrapCallParsed(call)` (sets `u.innerAst`) |
| `WRITE_OPS = new Set([">", ">>", ...])` | `findRedirects(ast, { ops: "write" })` or `effectOf(r) === "fs-write"` |
| `if (cmd.type === "CallExpr" && INLINE_SHELL_CMDS.has(cmd.cmd))` | `u.kind === "wrapped-script"` |
| `args.some(a => typeof a === "string" && p.test(a))` | `args.some(a => isResolved(a) && p.test(a))` |
| `wordToLit(...)` returned `null` for `""` | `wordToLit(...)` now returns `""` |
| `wordToLit(...)` returned `null` for `"foo""bar"` | `wordToLit(...)` now returns `"foobar"` |

---

## What disappears in hook-kit (canonical major consumer)

Files in hook-kit that should shrink or vanish entirely. References are
to `~/Projects/hook-kit` at v0.2.x. These are direct mechanical wins:

### `src/engine/helpers.ts`

```typescript
// DELETE: resolveUnwrappedOrFallback (~10 lines)
// Was needed because v0.2.x unwrapCall returned null for `bash`,
// `bash --version`, `curl | bash`. v0.3.0's `kind: "plain"` covers
// every case — callers use unwrapCall directly.

// DELETE: wordToScript (~25 lines)
// Was the multi-part-static workaround. Replace with the public
// wordToParts/wordToLit which now fold multi-part static themselves.

// DELETE: extractInlineScript (~30 lines)
// Replace with `unwrapCallParsed(call)` — returns the wrapped-script
// kind with `innerAst` already parsed. Saves a second parse() call.

// DELETE: INLINE_SHELL_CMDS constant
// shell-ast 0.3.0 WRAPPERS includes sh/bash/zsh/dash/ash/ksh/mksh/eval/exec.
// hook-kit no longer needs its own list.
```

### `src/rules/redirect.ts`

```typescript
// DELETE: const WRITE_OPS = new Set([">", ">>", ">|", "&>", "&>>"]);
//
// Replace with one of:
//   findRedirects(ast, { ops: "write" })   // filter built into shell-ast
//   effectOf(redir) === "fs-write"         // single-node check
```

### `src/rules/pipe.ts`

```typescript
// DELETE: if (node.op !== "|" && node.op !== "|&") return;
//
// Replace with:
//   effectOf(node) === "pipe"
```

### `src/rules/command.ts`

```typescript
// CHANGE: dispatch on u.kind instead of pulling wrapper ?? cmd
// (or cmd ?? wrapper depending on context).

// Before:
const name = u.wrapper ?? u.cmd;

// After:
const name =
  u.kind === "plain"          ? u.cmd :
  u.kind === "wrapped"        ? u.cmd :    // policy: match inner cmd
  u.kind === "wrapped-script" ? u.wrapper : // policy: match shell-runner
  u.kind === "wrapped-opaque" ? u.wrapper : // policy: catch the escalator
  null;
```

The change forces the consumer to make the wrapper-vs-cmd decision
explicit per context, instead of the implicit `??` that was bug-prone
(hook-kit had both `wrapper ?? cmd` and `cmd ?? wrapper` at different
call sites in v0.2.x; v0.3.0 makes the choice visible at the call site).

---

## Each new API, with a usage example

### `isDynamic(a)` / `isResolved(a)` — BUG-005

```typescript
import { isDynamic, isResolved } from "@questi0nm4rk/shell-ast";

for (const arg of unwrapped.args) {
  if (isResolved(arg)) {
    // arg is narrowed to string — safe to compare, regex, etc.
    if (arg.startsWith("/etc/")) flag();
  }
  // No else branch needed; isDynamic(arg) is the only other case.
}
```

Why prefer over `typeof a === "string"`: a regressed bundler that
shipped the literal string `"<dynamic>"` would pass `typeof === "string"`
but fail `isResolved`.

### `wordToParts(w)` — BUG-004

```typescript
import { wordToParts } from "@questi0nm4rk/shell-ast";

// "rm $DANGER /tmp" — see the partial structure
for (const frag of wordToParts(word)) {
  switch (frag.kind) {
    case "literal": doSomething(frag.value); break;
    case "dynamic": logSourceText(frag.sourceText); break;
  }
}
```

Use when you want to inspect the partial structure of a Word with
mixed static/dynamic content. `wordToLit` still exists as the
all-or-nothing convenience.

### `findCalls(ast, { depth: "top" })` — BUG-006

```typescript
// depth: "any" (default) — every CallExpr in the tree
findCalls(ast);

// depth: "top" — only execution-context calls; skips $(…), <(…), {a,b,c}
findCalls(ast, { depth: "top" });
```

Use `"top"` when you want "what does this script actually run" without
also matching command-substitution inner commands. Use `"any"` for
security scanning (catches dangerous commands hiding in `$(...)`).

### `findRedirects(ast, { ops })` / `findAssignments(ast, { exportedOnly })`

```typescript
findRedirects(ast, { ops: "write" });   // > >> >| &> &>>
findRedirects(ast, { ops: "read" });    // < << <<- <<<
findRedirects(ast, { ops: "all" });     // default

findAssignments(ast, { exportedOnly: true });  // only `export X=Y`/`readonly`/`declare`
```

### `unwrapCallParsed(call)` — BUG-007

```typescript
import { unwrapCallParsed, findCalls } from "@questi0nm4rk/shell-ast";

const u = await unwrapCallParsed(call);
if (u?.kind === "wrapped-script") {
  // u.script is the raw string
  // u.innerAst is the parsed AST — no need to re-call parse()
  for (const innerCall of findCalls(u.innerAst!)) {
    check(innerCall);
  }
}
```

`unwrapCallParsed` is async; sync `unwrapCall` stays sync and leaves
`innerAst` undefined.

### `preloadWasm()` — BUG-010

```typescript
// Compiled-binary entry point
import { preloadWasm } from "@questi0nm4rk/shell-ast";

async function main() {
  await preloadWasm();   // warm WASM during startup
  // ... now parseargv, evaluate rules, etc. — first parse() is instant
}
```

Idempotent; safe to call from multiple modules. Useful when first-rule
latency matters (every hook-kit binary).

### Typed errors — BUG-009

```typescript
import {
  parse,
  ParseSyntaxError,
  ParseSizeError,
  WasmLoadError,
  WasmRuntimeError,
  ShellAstError,
} from "@questi0nm4rk/shell-ast";

try {
  await parse(input);
} catch (e) {
  if (e instanceof ParseSyntaxError) {
    console.warn(`syntax error at ${e.line}:${e.col}\n${e.snippet}`);
    // recover — bad user input, ignore
  } else if (e instanceof ParseSizeError) {
    console.error(`input too big: ${e.bytes} > ${e.limit}`);
    // recover — adversarial input, reject loudly
  } else if (e instanceof WasmLoadError) {
    // INFRA — log once at warn, fail-open, page on-call
  } else if (e instanceof WasmRuntimeError) {
    // BUG — fail-closed, file a shell-ast issue
  } else {
    throw e;
  }
}
```

Discrimination via `e.kind` (`"syntax" | "size-limit" | "wasm-load" |
"wasm-runtime"`) also works.

### `effectOf(node)` / `effectsOf(node)` — new

```typescript
import { effectOf, effectsOf } from "@questi0nm4rk/shell-ast";

// effectOf: single-node effect
effectOf(callExpr)     === "exec"
effectOf(redirNode)    === "fs-write" | "fs-read" | "fs-rw" | "fd-dup"
effectOf(binaryCmd)    === "pipe" | null
effectOf(subshellNode) === "subshell"
effectOf(stmt)         === "fork-detach" | null

// effectsOf: union of every effect under a subtree
effectsOf(ast)  // Set<Effect>
```

13 effect kinds; full list in `src/effects.ts`. Effects are
**structural** — no command-name knowledge required. Layer command-name
policy on top (e.g. "if effectOf(call)==='exec' AND u.cmd==='rm' AND
u.flags includes -r and -f, …").

### `splitBraces` option (already existed in v0.2.x, mentioning for completeness)

```typescript
parse("echo {a,b,c}", "bash", { splitBraces: true });
// Word.parts[0] is now a BraceExp instead of a literal "{a,b,c}".
```

---

## Bug fixes that don't require migration work

These v0.2.x bugs are fixed transparently:

- `rm "-rf" /` resolves flags correctly (quoted-flag bypass closed)
- `bash -c "rm" extra` no longer has `"rm"` in BOTH `args` and `commandString`
- `sudo --user root rm /` (space form) unwraps as `wrapped(sudo→rm)`
- `cmd -=value` no longer fabricates `["-=","-v","-a","-l","-u","-e"]`
- `cat -` is a positional, not a flag
- `rm -- --` produces `args: ["--"]`
- UTF-8 BOM stripped before parse
- `eval "rm -rf /"`, `exec rm -rf /`, `ksh -c "..."`, `mksh -c "..."` all unwrap
- `parse({,})` no longer panics (defensive `withPos` recover)

If your consumer pinned `^0.2.x`, bumping to `^0.3.0` will pick all of
these up automatically — but the TypeScript breaking changes above are
mandatory before your code compiles.

---

## Verifying migration

```bash
# After updating your imports:
bun run typecheck     # MUST pass — discriminator forces exhaustive handling
bun test              # MUST pass — your fixtures may need 'kind' assertions

# If you have any of these patterns, you still have v0.2.x code:
grep -rn "u\.wrapper\b" src/
grep -rn "u\.commandString" src/
grep -rn "u\.cmd === null" src/
grep -rn "typeof.*=== \"string\"" src/    # likely should be isResolved
grep -rn "\.message\.match\(" src/        # likely should be `instanceof ParseSyntaxError`
```

---

## Deferred to v0.4.0

- `unwrapDeep(call): UnwrappedCall[]` for chained wrappers
  (`sudo bash -c 'rm'`) — today you recurse manually via
  `unwrapCallParsed` + walking `innerAst`. Test fixtures for chained
  wrappers landed in v0.3.0.
- Possible removal of `unwrapCall`'s remaining `| null` failure
  path (the truly-malformed empty-args case) in favor of a Result-style
  return.

---

## Where to file issues

- Library bugs / API regressions: <https://github.com/Questi0nM4rk/shell-ast/issues>
- New consumer pain that suggests another API (BUG-006-style "I had
  to filter shell-ast's output downstream"): same place, label as
  `consumer-ergonomics`.

Reference v0.2.x consumer-pain documents in `docs/BUGS.md` for the
template — each entry cites the consumer file:line where the friction
shows up. That's the kind of evidence that gets prioritized.
