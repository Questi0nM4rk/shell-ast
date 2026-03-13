# SPEC-005: Implementation Guide

## Status: Draft
## Version: 1.0

---

## Prerequisites

```bash
go version   # >= 1.22
bun --version  # >= 1.2.0
```

---

## Phase 1: Repository Setup

### 1.1 Init Go module

```bash
go mod init github.com/Questi0nM4rk/shell-ast
go get mvdan.cc/sh/v3@v3.10.0  # pin version
go mod download                 # generates go.sum — commit this file
go mod vendor                   # optional: vendor/ for reproducible offline builds
```

`go.sum` must be committed to version control. It is the cryptographic checksum
file that ensures reproducible builds. Do not add `go.sum` to `.gitignore`.

### 1.2 Init TypeScript

```bash
bun init
```

### 1.3 Copy Go WASM runtime shim

```bash
# Go 1.21+ uses lib/wasm/; earlier versions used misc/wasm/
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" src/wasm_exec.js
```

This file must be bundled with the TypeScript package. It's part of Go's standard
distribution. The `lib/wasm/` path is canonical for Go 1.21 and later. On older Go
installations the file is at `$(go env GOROOT)/misc/wasm/wasm_exec.js`.

---

## Phase 2: Go Processor

### 2.1 File structure

```
processor/
  main.go         WASM entry: exports __shellAstParse
  structs.go      Type-switch serializer (main work)
  pos.go          Source position helper
  structs_test.go Go unit tests
```

### 2.2 Implementation order for `structs.go`

Implement in this order (simple → complex):

1. `serializePos(p syntax.Pos) NodePos` — helper used everywhere
2. `serializeLit(n *syntax.Lit)` — leaf node, simplest
3. `serializeSglQuoted(n *syntax.SglQuoted)` — leaf
4. `serializeWord(n *syntax.Word)` — wraps WordParts
5. `serializeRedirect(n *syntax.Redirect)`
6. `serializeAssign(n *syntax.Assign)`
7. `serializeCallExpr(n *syntax.CallExpr)` — FIRST PRIORITY, needed for security use case
8. `serializeBinaryCmd(n *syntax.BinaryCmd)` — SECOND PRIORITY (pipes, &&, ||)
9. `serializeStmt(n *syntax.Stmt)` — wraps Command + Redirs
10. `serializeFile(n *syntax.File)` — root
11. All remaining command types (IfClause, WhileClause, etc.)
12. All remaining word part types (CmdSubst, ParamExp, etc.)

**Ship after step 10** — File/Stmt/CallExpr/BinaryCmd/Word/Redirect/Lit covers 80% of real-world usage.

### 2.3 serializeNode dispatch

After all per-type functions exist, implement the top-level dispatch:

```go
func serializeNode(n syntax.Node) interface{} {
  if n == nil {
    return nil
  }
  switch v := n.(type) {
  case *syntax.File:     return serializeFile(v)
  case *syntax.Stmt:     return serializeStmt(v)
  case *syntax.CallExpr: return serializeCallExpr(v)
  // ...
  }
}
```

### 2.4 Tests

Write Go unit tests before each serializer function (TDD):

```bash
go test ./processor/... -v
```

Test fixture strings — copy these directly into test cases:

```
simple:         "echo hello"
flags:          "rm -rf /"
piped:          "cat /etc/passwd | grep root"
logical:        "make && make test"
redirect-out:   "echo foo > /tmp/out"
redirect-err:   "cmd 2>&1"
heredoc:        "cat <<EOF\nhello\nEOF"
cmd-subst:      "echo $(date)"
proc-subst:     "diff <(ls a) <(ls b)"
arith:          "echo $((x + 1))"
double-quoted:  "echo \"hello $name\""
sudo-flag-arg:  "sudo -u root rm -rf /"
nested-subsh:   "(cd /tmp && rm -rf *)"
func-decl:      "foo() { echo bar; }"
for-loop:       "for f in *.txt; do rm $f; done"
bash-array:     "arr=(a b c)"
test-clause:    "[[ -f foo && -d bar ]]"
```

---

## Phase 3: TypeScript Types

### 3.1 Derive from Go types

Do NOT hand-write types from memory. Use the Go source as authority:

```bash
# Print all types that implement syntax.Node (i.e. have Pos/End methods)
grep -n 'func.*Pos() Pos' $(go env GOPATH)/pkg/mod/mvdan.cc/sh/v3@v3.10.0/syntax/nodes.go
```

All types are defined in `mvdan.cc/sh/v3/syntax/nodes.go` (not `syntax.go`).
Operator enum values are in `mvdan.cc/sh/v3/syntax/tokens.go`.

### 3.2 Validation

After WASM is built, test that the TypeScript types match actual JSON output:

```typescript
test("parse returns ShellFile", async () => {
  const ast = await parse("echo hello");
  expect(ast.type).toBe("File");
  expect(ast.stmts).toHaveLength(1);
  const stmt = ast.stmts[0]!;
  expect(stmt.cmd?.type).toBe("CallExpr");
  const call = stmt.cmd as CallExprNode;
  expect(call.args).toHaveLength(2);
  const firstArg = call.args[0]!;
  expect(firstArg.parts[0]).toMatchObject({ type: "Lit", value: "echo" });
});
```

---

## Phase 4: Helpers and Walk

Implement `walk.ts` and `helpers.ts` with full TypeScript test coverage.

Key tests for `resolveFlags`:

```typescript
test("resolveFlags splits combined short flags", async () => {
  const ast = await parse("rm -rf /tmp/foo");
  const calls = findCalls(ast);
  expect(calls).toHaveLength(1);
  const resolved = resolveFlags(calls[0]!);
  expect(resolved?.cmd).toBe("rm");
  expect(resolved?.flags).toContain("-r");
  expect(resolved?.flags).toContain("-f");
  expect(resolved?.args).toEqual(["/tmp/foo"]);
});

test("resolveFlags handles sudo flag-arg pairs", async () => {
  const ast = await parse("sudo -u root rm -rf /");
  const calls = findCalls(ast);
  const resolved = resolveFlags(calls[0]!);
  expect(resolved?.cmd).toBe("sudo");
  expect(resolved?.args).toContain("root");
  expect(resolved?.args).toContain("rm");
});
```

---

## Phase 5: sudo-aware Semantic Unwrapper (Optional)

A higher-level helper that understands privilege escalation wrappers:

```typescript
// src/semantic.ts
import type { CallExprNode, Word, LitNode } from "./types.js";
import { resolveFlags } from "./helpers.js";

const SUDO_FLAGS_WITH_ARGS = new Set(["-u", "-g", "-r", "-t", "-T", "-C", "-p", "-U"]);
const PRIVILEGE_ESCALATORS = new Set(["sudo", "doas", "run0", "su"]);

export interface UnwrappedCall {
  wrapper: string | null;   // "sudo", "doas", etc. — or null if not wrapped
  cmd: string;
  flags: string[];
  args: string[];
  raw: CallExprNode;
}

// wordToLit extracts the literal string value from a single-Lit Word.
// Returns null if the Word contains expansions or is not statically resolvable.
function wordToLit(w: Word): string | null {
  if (w.parts.length === 1 && w.parts[0]!.type === "Lit") {
    return (w.parts[0] as LitNode).value;
  }
  return null;
}

export function unwrapCall(call: CallExprNode): UnwrappedCall | null {
  const resolved = resolveFlags(call);
  if (!resolved) return null;

  if (!PRIVILEGE_ESCALATORS.has(resolved.cmd)) {
    return { wrapper: null, ...resolved };
  }

  // Skip past sudo's own flags (which take arguments)
  const rawArgs = call.args.slice(1);
  let i = 0;
  while (i < rawArgs.length) {
    const lit = wordToLit(rawArgs[i]!);
    if (lit === null) break;
    if (SUDO_FLAGS_WITH_ARGS.has(lit)) { i += 2; continue; }  // skip -u root
    if (lit.startsWith("-")) { i++; continue; }               // skip -n, --login
    break;  // found the real command
  }

  if (i >= rawArgs.length) return null;

  // Build a synthetic CallExpr from position i onward
  const innerArgs = rawArgs.slice(i);
  const syntheticCall: CallExprNode = {
    ...call,
    assigns: [],
    args: innerArgs,
  };
  const innerResolved = resolveFlags(syntheticCall);
  if (!innerResolved) return null;

  return {
    wrapper: resolved.cmd,
    ...innerResolved,
    raw: call,
  };
}
```

---

## Integration with ai-guardrails

Once `shell-ast` is published to npm, update `ai-guardrails-ts`:

```bash
bun add shell-ast
```

Replace `src/hooks/dangerous-patterns.ts`:

```typescript
import { parse, findCalls } from "shell-ast";
import { unwrapCall } from "shell-ast/semantic";

export async function checkDangerousCommand(input: string): Promise<string | null> {
  let ast;
  try {
    ast = await parse(input);
  } catch {
    // Parse error = not valid shell = skip
    return null;
  }

  const calls = findCalls(ast);
  for (const call of calls) {
    const unwrapped = unwrapCall(call);
    if (!unwrapped) continue;

    const { cmd, flags } = unwrapped;
    const hasFlag = (f: string) => flags.includes(f);

    // rm with -r and -f
    if (cmd === "rm" && hasFlag("-r") && hasFlag("-f")) {
      return `Blocked: rm -rf (flags: ${flags.join(" ")}, cmd: ${cmd})`;
    }

    // git with push --force
    if (cmd === "git" && unwrapped.args[0] === "push" && hasFlag("--force")) {
      return "Blocked: git push --force";
    }

    // ... other checks
  }

  return null;
}
```

This replaces all regex + shell-quote tokenizer patterns with proper AST-level checking.
The deferred bugs in `ai-guardrails docs/bugs/hook-bypass-regex-limitations.md` are fixed by this.

---

## Milestones

| Milestone | Deliverable | Tests |
|-----------|------------|-------|
| M1 | `serializeCallExpr`, `serializeBinaryCmd`, Go tests | Go: 5 tests |
| M2 | Full Go serializer (all ~42 node types, including ArithmExpr + TestExpr nodes) | Go: 25 tests |
| M3 | WASM build pipeline, TypeScript WASM loader | TS: WASM loads |
| M4 | TypeScript types, `parse()` API | TS: 10 tests |
| M5 | `walk()`, `findCalls()`, `resolveFlags()` | TS: 20 tests |
| M6 | `unwrapCall()` sudo-aware unwrapper (`src/semantic.ts`) | TS: 10 tests |
| M7 | 90% coverage, README, first npm publish | — |
| M8 | Wire into ai-guardrails, retire regex hooks | — |

Estimated scope: ~2500 lines of Go + ~1200 lines of TypeScript.
