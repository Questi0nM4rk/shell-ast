# shell-ast — Specification Index

## Status: Reference
## Version: 1.0

---

## Overview

`shell-ast` exposes the full typed AST from `mvdan/sh` v3 to TypeScript by
rewriting the Go WASM processor to serialize every node type. This directory
contains the complete design specification.

---

## Specs

| Spec | Title | Purpose |
|------|-------|---------|
| [SPEC-001](SPEC-001-overview.md) | Overview | Problem statement, solution summary, use cases, scope |
| [SPEC-002](SPEC-002-architecture.md) | Architecture | Layer diagram, Go + TS module structure, data flow, WASM build |
| [SPEC-003](SPEC-003-go-processor.md) | Go Processor | Full `mvdan/sh` AST type reference, serializer design, operator values |
| [SPEC-004](SPEC-004-typescript-types.md) | TypeScript Types | Discriminated union types, helper API (`walk`, `findCalls`, `resolveFlags`) |
| [SPEC-005](SPEC-005-implementation-guide.md) | Implementation Guide | Phase-by-phase build plan, TDD approach, test fixtures, milestones |
| [SPEC-006](SPEC-006-research.md) | Research | Tool comparison (Falco, CrowdStrike, ShellCheck, tree-sitter), decision rationale |

---

## Reading Order

**First time:** SPEC-001 → SPEC-002 → SPEC-004 → SPEC-005

**Implementing Go processor:** SPEC-003 (authoritative Go type reference)

**Evaluating the approach:** SPEC-006 (research and alternatives)

---

## Key Facts

- `mvdan/sh` version: v3.10.0 (pinned)
- Go minimum: 1.22
- Runtime: Bun >= 1.2.0 (Node/Bun only for v1 — no browser bundle)
- WASM size budget: 3–6 MB
- Node types serialized: ~42 (16 command + 9 word part + 11 supporting + 6 arith/test expression)
- TypeScript API: `parse(src, dialect)` → `ShellFile`, `walk`, `findCalls`, `resolveFlags`, `unwrapCall`
