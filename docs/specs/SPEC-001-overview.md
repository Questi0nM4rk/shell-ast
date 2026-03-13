# SPEC-001: Overview — shell-ast

## Status: Draft
## Version: 1.0

---

## Problem Statement

Shell command analysis exists on three tiers of fidelity:

| Tier | Approach | Handles |
|------|----------|--------|
| 1 | Regex | Simple patterns — fast, brittle, easy to bypass |
| 2 | Token-level | Quoting/escaping — handles `rm -rf 'path with spaces'` |
| 3 | Full AST | Flag semantics, pipe structure, redirects, arithmetic, subshells |

Every serious security tool that does shell analysis operates at Tier 3. Regex and tokenizers fail on:

- `rm -rf file1 file2` (multi-target)
- `sudo -u root rm -rf /` (flag–argument pairs in privilege escalation)
- `cat /etc/passwd | base64` (pipe semantics)
- `$(rm -rf /)` (command substitution)
- `rm -r -f /` (split flags)
- `rm -- -rf /` (end-of-flags separator)

### The sh-syntax Gap

[`sh-syntax`](https://github.com/un-ts/sh-syntax) (npm) wraps [`mvdan/sh`](https://github.com/mvdan/sh) v3 as a WASM module. `mvdan/sh` is a production-grade, spec-compliant shell parser written in Go — it produces a full, typed AST for POSIX sh, Bash, and mksh.

But `sh-syntax`'s Go processor (`processor/structs.go`) strips the AST before it crosses the WASM boundary:

```go
// From un-ts/sh-syntax processor/structs.go
func mapNode(node syntax.Node) Node {
  return Node{
    Pos: nodePos(node.Pos()),
    End: nodePos(node.End()),
  }
}
```

Every node — `CallExpr`, `BinaryCmd`, `CmdSubst`, `Redirect`, `Word`, `Lit` — is flattened to `{Pos, End}`. The command name, arguments, operators, redirect targets: all discarded.

This makes `sh-syntax` useful for:
- Syntax validation (does this parse without error?)
- Source formatting (via `mvdan/sh`'s printer)
- Position-based tooling (syntax highlighting, go-to-definition)

Not useful for:
- Semantic analysis
- Security checking
- Command understanding

### Why Not Use the mvdan/sh Go Library Directly?

For Go programs, `mvdan/sh` is the right choice. But for TypeScript tooling running in Node/Bun/browsers:

1. No runtime Go dependency — everything is WASM
2. Existing `sh-syntax` API is familiar to the ecosystem
3. WASM size is acceptable (< 5MB) for security tools

The gap is solely in what gets serialized. The Go runtime already produces the full tree.

---

## Solution

`shell-ast` is a fork of `sh-syntax` with a rewritten Go processor that serializes the full typed AST.

**What changes:**
- `processor/structs.go` — full type-switch serializer (replaces `mapNode`)
- `processor/main.go` — updated WASM exports to return the rich AST
- TypeScript types — discriminated union for all 40+ node types
- TypeScript API — `parse(src, dialect)` → `ShellFile`

**What stays the same:**
- `mvdan/sh` version lock (v3)
- WASM compilation pipeline
- `sh-syntax` formatting API (unchanged — we add, not remove)
- License (MIT)

---

## Use Cases

### Primary: Security Hook Analysis

The immediate consumer is `ai-guardrails` — a tool that intercepts Claude Code's `Bash` tool calls and blocks dangerous commands. Current implementation uses regex + `shell-quote` tokenizer. Known gaps:

```
rm -rf file1 file2          # tokenizer: ✓ (multi-target not caught by regex)
sudo -u root rm -rf /       # tokenizer: ✗ (flag-arg pairs skip the real command)
rm -r -f /                  # tokenizer: ✗ (split flags not recombined)
$(rm -rf /)                 # tokenizer: ✗ (no subshell handling)
```

With full AST, all of these collapse to: walk the AST, find `CallExpr` nodes, check the resolved command name and canonicalized flags.

### Secondary: General Shell Analysis

Any TypeScript tool that needs shell semantics:
- Linters for shell scripts embedded in CI YAML
- Static analysis for package.json scripts
- Shell comprehension in AI coding agents
- Security scanners for IaC templates

---

## Scope

### In Scope (v1)

- Full AST serialization for all `mvdan/sh` node types
- Discriminated union TypeScript types for every node
- `parse(src, dialect): ShellFile` API
- `walk(node, visitor)` tree walker
- Helper: `findCalls(ast): CallNode[]` — extract all command invocations
- Helper: `resolveFlags(call): { cmd: string, flags: string[], args: string[] }` — canonicalize flags
- Dialect support: `posix`, `bash`, `mksh` (via `mvdan/sh`'s `syntax.NewParser`)
- WASM build pipeline
- 90%+ test coverage on the TypeScript layer

### Out of Scope (v1)

- Shell execution / evaluation
- Shell script rewriting / AST transforms
- Shell linting (use shellcheck)
- Shell formatting (use `sh-syntax`'s existing API)
- Browser bundle (Node/Bun only for v1)

---

## Relationship to sh-syntax

This is a fork, not a wrapper. We vendor `mvdan/sh` at a pinned version and maintain the Go processor ourselves. Changes to upstream `sh-syntax` are evaluated and cherry-picked if relevant; we don't track it directly.

The npm package name is `shell-ast` (not a scoped fork of `sh-syntax`) because the API surface is intentionally different — we add fields that `sh-syntax` never had, and our JSON schema is not compatible with theirs.
