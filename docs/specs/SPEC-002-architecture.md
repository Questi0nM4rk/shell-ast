# SPEC-002: Architecture — shell-ast

## Status: Draft
## Version: 1.0

---

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  TypeScript Layer (src/)                                    │
│                                                             │
│  parse(src, dialect) → ShellFile                           │
│  walk(node, visitor) → void                                │
│  findCalls(ast) → CallExprNode[]                           │
│  resolveFlags(call) → ResolvedCall                         │
│                                                             │
│  Types: discriminated union (ShellNode = File | Stmt | ...) │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON over WASM boundary
┌──────────────────────────▼──────────────────────────────────┐
│  Go Processor (processor/)                                  │
│                                                             │
│  main.go    — WASM exports: parseShell(src, dialect)       │
│  structs.go — type-switch serializer: Node → JSON          │
│  pos.go     — source position helpers                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────┐
│  mvdan/sh v3 (vendored)                                     │
│                                                             │
│  syntax.NewParser().Parse(src)  → *syntax.File             │
│  syntax.File, Stmt, CallExpr,   — full typed AST           │
│  BinaryCmd, CmdSubst, Word, ...                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Go Layer (`processor/`)

### `main.go` — WASM Entry Points

```go
//go:build js && wasm

package main

import (
  "encoding/json"
  "strings"
  "syscall/js"
  "mvdan.cc/sh/v3/syntax"
)

func main() {
  js.Global().Set("__shellAstParse", js.FuncOf(parseShell))
  <-make(chan struct{})  // keep WASM alive
}

func parseShell(this js.Value, args []js.Value) interface{} {
  if len(args) < 1 {
    return errorResult("missing source argument")
  }
  src := args[0].String()
  dialect := "bash"
  if len(args) >= 2 {
    dialect = args[1].String()
  }

  lang, err := parseDialect(dialect)
  if err != nil {
    return errorResult(err.Error())
  }

  p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(lang))
  f, err := p.Parse(strings.NewReader(src), "")
  if err != nil {
    return syntaxErrorResult(err, src)
  }

  node := serializeFile(f)
  b, _ := json.Marshal(node)
  return js.ValueOf(string(b))
}
```

### `structs.go` — Type-Switch Serializer

This is the core change from `sh-syntax`. Instead of `mapNode()` → `{Pos, End}`, we implement a full type switch over every `syntax.Node` type:

```go
func serializeNode(node syntax.Node) interface{} {
  if node == nil {
    return nil
  }
  switch n := node.(type) {
  case *syntax.File:       return serializeFile(n)
  case *syntax.Stmt:       return serializeStmt(n)
  case *syntax.CallExpr:   return serializeCallExpr(n)
  case *syntax.BinaryCmd:  return serializeBinaryCmd(n)
  case *syntax.IfClause:   return serializeIfClause(n)
  case *syntax.WhileClause: return serializeWhileClause(n)
  case *syntax.ForClause:  return serializeForClause(n)
  case *syntax.CaseClause: return serializeCaseClause(n)
  case *syntax.Block:      return serializeBlock(n)
  case *syntax.Subshell:   return serializeSubshell(n)
  case *syntax.FuncDecl:   return serializeFuncDecl(n)
  case *syntax.CmdSubst:   return serializeCmdSubst(n)
  case *syntax.Word:       return serializeWord(n)
  case *syntax.Lit:        return serializeLit(n)
  case *syntax.SglQuoted:  return serializeSglQuoted(n)
  case *syntax.DblQuoted:  return serializeDblQuoted(n)
  case *syntax.Redirect:   return serializeRedirect(n)
  case *syntax.Assign:     return serializeAssign(n)
  // ... all remaining types
  default:
    return map[string]interface{}{
      "type": "Unknown",
      "pos":  nodePos(node.Pos()),
      "end":  nodePos(node.End()),
    }
  }
}
```

Each serializer outputs the node type tag plus all semantically meaningful fields:

```go
func serializeCallExpr(n *syntax.CallExpr) map[string]interface{} {
  assigns := make([]interface{}, len(n.Assigns))
  for i, a := range n.Assigns {
    assigns[i] = serializeAssign(a)
  }
  args := make([]interface{}, len(n.Args))
  for i, w := range n.Args {
    args[i] = serializeWord(w)
  }
  return map[string]interface{}{
    "type":    "CallExpr",
    "assigns": assigns,
    "args":    args,
    "pos":     nodePos(n.Pos()),
    "end":     nodePos(n.End()),
  }
}

func serializeBinaryCmd(n *syntax.BinaryCmd) map[string]interface{} {
  return map[string]interface{}{
    "type": "BinaryCmd",
    "op":   n.Op.String(),  // "&&", "||", "|", "|&"
    "x":    serializeStmt(n.X),
    "y":    serializeStmt(n.Y),
    "pos":  nodePos(n.Pos()),
    "end":  nodePos(n.End()),
  }
}

func serializeRedirect(n *syntax.Redirect) map[string]interface{} {
  result := map[string]interface{}{
    "type": "Redirect",
    "op":   n.Op.String(),
    "word": serializeWord(n.Word),
    "pos":  nodePos(n.Pos()),
    "end":  nodePos(n.End()),
  }
  if n.Hdoc != nil {
    result["hdoc"] = serializeWord(n.Hdoc)
  }
  if n.N != nil {
    result["n"] = serializeLit(n.N)
  }
  return result
}
```

---

## TypeScript Layer (`src/`)

### Module Structure

```
src/
  index.ts      — public API: parse, walk, findCalls, resolveFlags
  types.ts      — ShellNode discriminated union (~42 types)
  wasm.ts       — WASM loader and bridge
  walk.ts       — AST walker
  helpers.ts    — findCalls, resolveFlags
  semantic.ts   — unwrapCall (sudo-aware privilege escalation unwrapper)
```

### WASM Loading (`wasm.ts`)

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let parseFn: ((src: string, dialect?: string) => string) | null = null;

export async function loadWasm(): Promise<void> {
  if (parseFn !== null) return;

  const wasmPath = join(import.meta.dirname, "../dist/shell-ast.wasm");
  const wasmBytes = await readFile(wasmPath);

  const go = new Go(); // Go WASM runtime shim (wasm_exec.js)
  const result = await WebAssembly.instantiate(wasmBytes, go.importObject);
  go.run(result.instance);

  parseFn = (src: string, dialect = "bash") =>
    (globalThis as Record<string, unknown>).__shellAstParse(src, dialect) as string;
}

export function parseRaw(src: string, dialect?: string): string {
  if (parseFn === null) throw new Error("WASM not loaded — call loadWasm() first");
  return parseFn(src, dialect);
}
```

### Public API (`index.ts`)

```typescript
import { loadWasm, parseRaw } from "./wasm.js";
import type { ShellFile } from "./types.js";

export type { ShellNode, ShellFile, CallExprNode, BinaryCmd } from "./types.js";
export { walk } from "./walk.js";
export { findCalls, resolveFlags } from "./helpers.js";

export async function parse(
  src: string,
  dialect: "bash" | "posix" | "mksh" = "bash"
): Promise<ShellFile> {
  await loadWasm();
  const json = parseRaw(src, dialect);
  return JSON.parse(json) as ShellFile;
}
```

---

## Data Flow: `sudo -u root rm -rf /`

1. `parse("sudo -u root rm -rf /")` called from TypeScript
2. WASM bridge calls `__shellAstParse(src, "bash")`
3. Go: `syntax.NewParser().Parse(src)` → `*syntax.File`
4. Go: `serializeFile(f)` → type-switch recursion:
   ```
   File
     Stmts[0]: Stmt
       Cmd: CallExpr
         Args[0]: Word { Parts: [Lit{Value:"sudo"}] }
         Args[1]: Word { Parts: [Lit{Value:"-u"}] }
         Args[2]: Word { Parts: [Lit{Value:"root"}] }
         Args[3]: Word { Parts: [Lit{Value:"rm"}] }
         Args[4]: Word { Parts: [Lit{Value:"-rf"}] }
         Args[5]: Word { Parts: [Lit{Value:"/"}] }
   ```
5. JSON marshaled, crosses WASM boundary as string
6. TypeScript: `JSON.parse()` → typed `ShellFile`
7. `unwrapCall(call)` → `{ wrapper: "sudo", cmd: "rm", flags: ["-r", "-f"], args: ["/"] }`

---

## WASM Build

```makefile
# Makefile
WASM_OUT := dist/shell-ast.wasm
GO_SRC    := $(shell find processor -name '*.go')

$(WASM_OUT): $(GO_SRC)
	mkdir -p dist
	GOOS=js GOARCH=wasm go build -o $(WASM_OUT) ./processor
	cp "$(shell go env GOROOT)/lib/wasm/wasm_exec.js" dist/wasm_exec.js

.PHONY: build test clean
build: $(WASM_OUT) bun-build
bun-build:
	bun run tsc --noEmit
	bun build src/index.ts --outdir dist --target node
test:
	bun test
clean:
	rm -rf dist
```

---

## Size Budget

Expected WASM size: 3–6 MB (similar to `sh-syntax`'s ~4MB).
The serializer adds minimal code size. JSON encoding is in Go stdlib.
No additional Go dependencies — only `mvdan/sh` vendored.
