# shell-ast

Full AST exposure for shell scripts — `mvdan/sh` compiled to WASM, with the complete parse tree serialized to TypeScript-consumable JSON.

---

## The Problem

[`sh-syntax`](https://github.com/un-ts/sh-syntax) wraps `mvdan/sh` as a WASM module and exposes it to JavaScript/TypeScript. But its Go processor strips the AST down to position-only nodes before sending them across the WASM boundary:

```go
// sh-syntax/processor/structs.go — what gets serialized:
type Node struct {
  Pos NodePos `json:"Pos"`
  End NodePos `json:"End"`
}
```

`CallExpr.Args`, `BinaryCmd.Op`, `CmdSubst.Stmts`, `Redirect.Hdoc` — none of it crosses the boundary. You get source positions. You don't get the tree.

This makes `sh-syntax` useful for syntax checking and formatting, but useless for semantic analysis: detecting dangerous commands, checking flag semantics, understanding pipe structure, or analyzing redirects.

---

## The Solution

`shell-ast` rewrites the Go processor to serialize the **full typed AST** — every node type `mvdan/sh` produces, with all fields, as a TypeScript discriminated union:

```typescript
type ShellNode =
  | { type: "File"; stmts: Stmt[]; last: Comment[] }
  | { type: "Stmt"; cmd: Command | null; redirs: Redirect[]; background: boolean; negated: boolean }
  | { type: "CallExpr"; assigns: Assign[]; args: Word[] }
  | { type: "BinaryCmd"; op: BinaryOp; x: Stmt; y: Stmt }
  | { type: "CmdSubst"; stmts: Stmt[]; recentlyDefined: boolean }
  | { type: "Redirect"; op: RedirectOp; word: Word; hdoc: Word | null }
  // ... 40+ node types
```

This enables proper command analysis — the kind that regex and token-level parsers cannot do:

```typescript
import { parse } from "shell-ast";

const ast = await parse("sudo -u root rm -rf /");
const call = findCallExpr(ast);
// call.args[0].parts[0].value === "sudo"
// call.args[1].parts[0].value === "-u"
// call.args[2].parts[0].value === "root"
// call.args[3].parts[0].value === "rm"
// → properly detects rm with -r and -f flags regardless of order
```

---

## Status

**Pre-release — not yet published to npm.**

See `docs/specs/` for the full design and implementation plan.

---

## Architecture

```
mvdan/sh (Go)          Full typed AST
    └── processor/     Rewritten: type-switch serializer
         └── WASM      JSON across boundary
              └── TypeScript  Discriminated union types + parse() API
```

See [`docs/specs/SPEC-002-architecture.md`](docs/specs/SPEC-002-architecture.md) for details.

---

## Development

```bash
# Prerequisites
git clone https://github.com/Questi0nM4rk/shell-ast
cd shell-ast

# Build Go → WASM
GOOS=js GOARCH=wasm go build -o dist/shell-ast.wasm ./processor

# Install TypeScript dependencies
bun install

# Run tests
bun test

# Build TypeScript
bun run build
```

## License

MIT — fork of [`un-ts/sh-syntax`](https://github.com/un-ts/sh-syntax) which is also MIT.
