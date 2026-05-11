# shell-ast

**Full shell AST for TypeScript** — `mvdan/sh` compiled to WASM, exposing the
complete parse tree as a typed discriminated union.

```typescript
import { parse, findCalls, resolveFlags } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo -u root rm -rf /");
const [call] = findCalls(ast);
const resolved = resolveFlags(call!);
// { cmd: "sudo", flags: [], args: ["-u", "root", "rm", "-rf", "/"] }
```

---

## Why

[`sh-syntax`](https://github.com/un-ts/sh-syntax) already wraps `mvdan/sh` as
WASM. But its Go processor strips the AST to `{ Pos, End }` before crossing the
boundary — you get source positions, not the tree. `CallExpr.Args`,
`BinaryCmd.Op`, `CmdSubst.Stmts`: all discarded.

That's fine for syntax highlighting. It's useless for anything semantic.

`shell-ast` rewrites the processor to serialize the **full typed AST** —
every node type `mvdan/sh` produces, with all fields, using a complete
type-switch serializer. The TypeScript side exposes it as a discriminated union
with exhaustive-switch support.

---

## Install

```bash
bun add @questi0nm4rk/shell-ast
# or
npm install @questi0nm4rk/shell-ast
```

The package ships pre-built WASM in `dist/`; no Go toolchain needed at
install time. See [`docs/specs/`](docs/specs/) for the design history.

---

## What You Get

```typescript
// Full typed parse tree
const ast: ShellFile = await parse("cat /etc/passwd | grep root");

// Walk every node in the tree
walk(ast, {
  BinaryCmd(node) {
    console.log("pipe op:", node.op); // "|"
  },
  CallExpr(node) {
    console.log("command:", node.args[0]?.parts[0]); // { type: "Lit", value: "cat" }
  },
});

// Extract all command invocations
const calls = findCalls(ast);
// [CallExpr("cat"), CallExpr("grep")]

// Canonicalize flags — splits -rf into ["-r", "-f"], respects --
const resolved = resolveFlags(calls[0]!);
// { cmd: "cat", flags: [], args: ["/etc/passwd"], raw: CallExpr }
```

### Node coverage

Every `mvdan/sh` node type is serialized:

| Category | Types |
|----------|-------|
| Top-level | `File`, `Stmt`, `Redirect`, `Word`, `Assign`, `Comment` |
| Commands | `CallExpr`, `BinaryCmd`, `IfClause`, `WhileClause`, `ForClause`, `CaseClause`, `Block`, `Subshell`, `FuncDecl`, `TimeClause`, `CoprocClause`, `LetClause`, `DeclClause`, `TestClause`, `ArithmCmd`, `TestDecl` |
| Word parts | `Lit`, `SglQuoted`, `DblQuoted`, `CmdSubst`, `ParamExp`, `ArithmExp`, `ProcSubst`, `ExtGlob`, `BraceExp` |
| Arithmetic | `BinaryArithm`, `UnaryArithm`, `ParenArithm` |
| Test | `BinaryTest`, `UnaryTest`, `ParenTest` |

All operators (`BinCmdOp`, `RedirectOp`, `GlobOp`, `CaseOp`, …) are typed as
string literal unions — `switch (node.op)` is exhaustive.

### Dialects

```typescript
await parse(src, "bash");   // default — full bash extensions
await parse(src, "posix");  // POSIX sh only
await parse(src, "mksh");   // MirBSD ksh
```

---

## Use Cases

### Security hooks (primary motivation)

Intercept shell commands before execution and check them semantically.
Regex and tokenizers both fail on real-world inputs:

```
rm -rf file1 file2          # regex: misses multi-target trailing anchor
sudo -u root rm -rf /       # tokenizer: -u consumes "root", skips "rm"
rm -r -f /                  # tokenizer: split flags not recombined
$(rm -rf /)                 # tokenizer: no subshell traversal
```

With `shell-ast`, all of these are handled by walking `CallExpr` nodes:

```typescript
import { parse, findCalls } from "@questi0nm4rk/shell-ast";
import { unwrapCall } from "@questi0nm4rk/shell-ast/semantic"; // sudo-aware unwrapper

async function checkCommand(input: string): Promise<string | null> {
  const ast = await parse(input).catch(() => null);
  if (!ast) return null; // malformed shell — skip

  for (const call of findCalls(ast)) {
    const unwrapped = unwrapCall(call);
    if (!unwrapped) continue;
    const { cmd, flags } = unwrapped;
    const has = (f: string) => flags.includes(f);

    if (cmd === "rm" && has("-r") && has("-f"))
      return "blocked: rm -rf";
    if (cmd === "git" && unwrapped.args[0] === "push" && has("--force"))
      return "blocked: git push --force";
  }
  return null;
}
```

### CI script analysis

```typescript
// Detect all redirects writing outside the workspace
walk(ast, {
  Redirect(node) {
    if (node.op === ">" || node.op === ">>") {
      const target = node.word.parts[0];
      if (target?.type === "Lit" && !target.value.startsWith("./")) {
        console.warn("writes outside workspace:", target.value);
      }
    }
  },
});
```

### Pipe graph traversal

```typescript
function pipelineCommands(stmt: Stmt): string[] {
  if (stmt.cmd?.type === "BinaryCmd" && stmt.cmd.op === "|") {
    return [...pipelineCommands(stmt.cmd.x), ...pipelineCommands(stmt.cmd.y)];
  }
  const first = stmt.cmd?.type === "CallExpr" ? stmt.cmd.args[0]?.parts[0] : null;
  return first?.type === "Lit" ? [first.value] : [];
}

const ast = await parse("cat /etc/passwd | grep root | wc -l");
pipelineCommands(ast.stmts[0]!);
// ["cat", "grep", "wc"]
```

---

## Architecture

```
TypeScript (src/)
  parse(src, dialect) → ShellFile
  walk(node, visitor) → void
  findCalls(ast) → CallExprNode[]
  resolveFlags(call) → ResolvedCall
         │
         │  JSON string over WASM boundary
         ▼
Go Processor (processor/)
  main.go     — WASM export: __shellAstParse
  structs.go  — type-switch serializer: syntax.Node → JSON
  pos.go      — source position helpers
         │
         │  uses
         ▼
mvdan/sh v3 (vendored)
  syntax.NewParser().Parse(src) → *syntax.File
  Full typed AST: CallExpr, BinaryCmd, CmdSubst, …
```

The Go processor is the only change from upstream `sh-syntax`. Everything else
(the WASM pipeline, `mvdan/sh` itself) stays the same.

---

## Development

**Prerequisites:** Go >= 1.22, Bun >= 1.2.0

```bash
git clone https://github.com/Questi0nM4rk/shell-ast
cd shell-ast

# Go dependencies (also writes go.sum — commit it)
go mod download

# Copy Go WASM runtime shim (path since Go 1.21)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" src/wasm_exec.js

# TypeScript dependencies
bun install
```

```bash
# Build
bun run build:wasm      # Go → dist/shell-ast.wasm
bun run build:ts        # TypeScript → dist/
bun run build           # both

# Test
go test ./processor/... -v   # Go serializer unit tests
bun test                     # TypeScript end-to-end tests
bun run typecheck            # tsc --noEmit
```

---

## Specs

| Spec | Content |
|------|---------|
| [SPEC-000](docs/specs/SPEC-000-index.md) | Index and reading guide |
| [SPEC-001](docs/specs/SPEC-001-overview.md) | Problem statement, sh-syntax gap, scope |
| [SPEC-002](docs/specs/SPEC-002-architecture.md) | Architecture, data flow, WASM build |
| [SPEC-003](docs/specs/SPEC-003-go-processor.md) | Go serializer: all ~42 node types |
| [SPEC-004](docs/specs/SPEC-004-typescript-types.md) | TypeScript discriminated unions, full type inventory |
| [SPEC-005](docs/specs/SPEC-005-implementation-guide.md) | Implementation phases, test fixtures, milestones |
| [SPEC-006](docs/specs/SPEC-006-research.md) | Enterprise research: Falco, CrowdStrike, DCG, why mvdan/sh |

---

## Comparison

| | `sh-syntax` | `tree-sitter-bash` | **`shell-ast`** |
|---|---|---|---|
| Runtime | WASM | WASM | WASM |
| Parser | mvdan/sh v3 | tree-sitter | mvdan/sh v3 |
| AST exposed | Positions only | Generic `{type, children}` | **Full typed tree** |
| TypeScript types | `{Pos, End}` | Untyped nodes | Discriminated union |
| Flag splitting | No | No | **Yes** (`-rf` → `["-r", "-f"]`) |
| Pipe traversal | No | Manual | **Yes** (`BinaryCmd.op`) |
| Redirect semantics | No | Manual | **Yes** (`Redirect.op`) |
| POSIX compliant | Yes | Partial | Yes |

---

## Relationship to sh-syntax

This is a fork — not a wrapper. The Go processor is entirely rewritten; the
WASM pipeline and `mvdan/sh` vendoring are kept. The npm package name is
`shell-ast` (not a scoped `sh-syntax` fork) because the JSON schema is
intentionally incompatible: we expose data that `sh-syntax` never had.

---

## License

MIT — same as [`un-ts/sh-syntax`](https://github.com/un-ts/sh-syntax).
