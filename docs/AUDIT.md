# shell-ast — Codebase Audit

> Historical — all findings resolved as of v0.4.0. Kept for provenance.

**Date:** 2026-05-11
**Scope:** Full audit of `@questi0nm4rk/shell-ast` v0.1.0
**Reviewer:** External validation pass — security, correctness, optimization, modularity, DRY/KISS, build/CI hygiene
**Sources audited:** `src/*.ts`, `processor/*.go`, `tests/*.ts`, `docs/specs/*.md`, `package.json`, `Makefile`, `tsconfig.json`, `biome.jsonc`, `.github/workflows/*.yml`, `.gitignore`, `.npmignore`, `.cc-review.yaml`, `go.mod`

---

## Executive Summary

The codebase is a clean, well-typed WASM-bridge to `mvdan/sh`. The Go serializer faithfully covers ~42 node types; the TypeScript surface is a real discriminated union with exhaustive switching. Tests exist on both sides.

The **dominant risk class is silent failure**: shipping a bug that downstream consumers cannot detect because the security-adjacent contract (parse → analyze) gracefully fails open. BUG-001 is the canonical instance; this audit identifies several others in the same class.

The **dominant gap is verification**: there is no CI workflow that runs tests, no compiled-binary smoke test, no fuzz of the serializer, no schema drift check between Go output and TS types. Every finding below could be caught automatically; none currently is.

| Class | P0 | P1 | P2 | P3 | Total |
|-------|----|----|----|----|-------|
| Correctness / safety | 5 | 4 | — | — | 9 |
| Optimization / structure | — | — | 8 | — | 8 |
| Build / packaging / CI | — | — | — | 10 | 10 |
| Testing gaps | — | — | — | 4 | 4 |

---

## P0 — Critical correctness & safety

### A1. `import.meta.dirname` baked at compile time (BUG-001)

**File:** `src/wasm.ts:23, 35`
**Severity:** CRITICAL — silently breaks all consumers compiling a binary.

```typescript
const runtimePath = join(import.meta.dirname, "wasm_exec.js");
const wasmPath = join(import.meta.dirname, "../dist/shell-ast.wasm");
```

`bun build --compile` snapshots `import.meta.dirname` into the binary as the build-machine's absolute path. At runtime on a different machine, `readFile` returns ENOENT. Consumers per fail-open conventions silently disable.

**Fix:** Bun import attributes (per `docs/BUGS.md` proposal).

```typescript
import wasmExecSrc from "./wasm_exec.js" with { type: "text" };
import wasmModule from "../dist/shell-ast.wasm" with { type: "wasm" };
```

**Test that catches it:** compiled-binary smoke (see D2).

---

### A2. `wasm_exec.js` evaluated as a string at runtime

**File:** `src/wasm.ts:25`
**Severity:** HIGH — works today but fragile and CSP-incompatible.

```typescript
const src = await readFile(runtimePath, "utf8");
// runtime evaluation of the shim follows
```

Even after A1's import-attributes fix swaps the WASM load, the runtime shim is still string-evaluated via the `Function` constructor. Three problems:

1. Breaks any CSP-restricted environment (`Content-Security-Policy: script-src` without `unsafe-eval`).
2. Defeats bundlers and static analysis — the shim is invisible to dependency tools.
3. Pollutes `globalThis.Go` — collides with any other Go-WASM library in the same realm.

**Fix:** side-effect import.

```typescript
import "./wasm_exec.js"; // sets globalThis.Go as a side effect
```

Bun bundles JS module imports correctly in both dev and `--compile`. The `globalThis.Go` side-effect is part of the file regardless.

**Stretch fix:** Port the ~6 syscalls `mvdan/sh` actually needs and delete the 657-line vendored shim. Most of `wasm_exec.js` supports Go runtime semantics this codebase never exercises (timers, file descriptors, full process model). Out of scope for first pass.

---

### A3. `loadWasm()` race condition

**File:** `src/wasm.ts:31-47`
**Severity:** HIGH — concurrent first-call paths leak Go runtimes.

```typescript
export async function loadWasm(): Promise<void> {
  if (parseFn !== null) return;
  // ... async work, no Promise cache ...
  parseFn = (src, dialect = "bash") => ...;
}
```

Two concurrent `parse()` calls before WASM is loaded both see `parseFn === null`, both run `WebAssembly.instantiate` + `go.run()`. The Go runtime is instantiated twice; `globalThis.__shellAstParse` is set twice. Each `go.run()` keeps the WASM instance alive via `<-make(chan struct{})` (see `processor/main.go:16`). Result: leaked Go runtime per concurrent first-call.

**Fix:** Cache the in-flight Promise.

```typescript
let loadPromise: Promise<void> | null = null;

export function loadWasm(): Promise<void> {
  loadPromise ??= doLoadWasm();
  return loadPromise;
}

async function doLoadWasm(): Promise<void> {
  // existing body
}
```

**Test that catches it:** `Promise.all([parse("a"), parse("b")])` from a fresh module should result in exactly one `WebAssembly.instantiate` call (mock or assert via globals).

---

### A4. Schema drift between Go serializer and TypeScript types

**File:** `processor/structs.go:588, 599` vs `src/types.ts:253-264, 266-270`
**Severity:** HIGH — silently drops fields from typed surface.

Two confirmed drifts:

| Go serializes | TypeScript declares | Field |
|---------------|---------------------|-------|
| `processor/structs.go:588 — "names": n.Names.String()` | `src/types.ts:253-264 — interface ParamExp` (no `names`) | `names` |
| `processor/structs.go:599 — "bracket": n.Bracket` | `src/types.ts:266-270 — interface ArithmExp` (no `bracket`) | `bracket` |

Consumers using exhaustive `switch` on operator unions never see these fields. They land in the JSON, get `JSON.parse`d into the resulting object, but TypeScript treats them as nonexistent — accesses are `undefined`, not type-checked, no autocomplete.

**Fix:**

```typescript
export interface ParamExp extends BaseNode {
  type: "ParamExp";
  // ...existing fields...
  names: string; // mvdan/sh ParamNames token, e.g. "@", "*", "#"
}

export interface ArithmExp extends BaseNode {
  type: "ArithmExp";
  bracket: boolean; // [ ] vs (( )) syntax
  // ...existing fields...
}
```

**Test that catches it (general):** reflection-based check that every field in every `processor/structs.go` `map[string]interface{}` literal appears in the matching TS interface (E4).

---

### A5. `unwrapCall` synthetic node leaks wrapper position

**File:** `src/semantic.ts:48-52`
**Severity:** MEDIUM-HIGH — diagnostic data is wrong, not user-visible until consumed.

```typescript
const syntheticCall: CallExprNode = {
  ...call,         // pos/end come from `sudo`
  assigns: [],
  args: innerArgs,
};
```

Spreading `...call` carries `pos`/`end` from the `sudo` wrapper's `CallExpr`, not the unwrapped `rm`. Any downstream consumer using `unwrapped.raw.pos` for diagnostics points at `sudo`. The consumer's source-pointer is wrong.

**Fix:**

```typescript
const firstArg = innerArgs[0];
const lastArg = innerArgs[innerArgs.length - 1];
const syntheticCall: CallExprNode = {
  type: "CallExpr",
  assigns: [],
  args: innerArgs,
  pos: firstArg?.pos ?? call.pos,
  end: lastArg?.end ?? call.end,
};
```

**Test that catches it:** `unwrapCall` on `sudo -u root rm -rf /` should produce `raw.pos.col` pointing at `rm`'s column, not column 1.

---

## P1 — Security / correctness, non-critical-path

### B1. Per-wrapper flag schemas are wrong

**File:** `src/semantic.ts:6-7`
**Severity:** HIGH for security-adjacent use.

```typescript
const SUDO_FLAGS_WITH_ARGS = new Set(["-u", "-g", "-r", "-t", "-T", "-C", "-p", "-U"]);
const PRIVILEGE_ESCALATORS = new Set(["sudo", "doas", "run0", "su"]);
```

One flag set is applied to four different wrappers. Real grammars diverge:

| Wrapper | Flags-with-arg | Special semantics |
|---------|----------------|-------------------|
| `sudo` | `-u`, `-g`, `-h`, `-D`, `-C`, `-p`, `-r`, `-t`, `-T`, `-U`, `--user=X` (long-eq) | `-A` is boolean (askpass) |
| `doas` | `-u`, `-C` | No `-T`, `-p`, `-U` |
| `run0` | `--user`, `--group`, `--unit`, `--description` | Long-form only |
| `su` | `-c`, `-l`, `-s`, `-G` | `su user -c "cmd"` puts command **inside** `-c`'s arg |

**Concrete miscategorization:** `sudo -h myhost rm -rf /` is parsed as `wrapper: "sudo", cmd: "myhost"`, dropping the actual dangerous command from analysis.

**Concrete miss:** `su user -c "rm -rf /"` is parsed with `cmd: "user"`, ignoring `-c`'s payload entirely.

**Missing wrappers:** `pkexec`, `gosu`, `setpriv`, `runuser`, `pfexec`, `please` (sudoers replacement), `op` (1Password run).

**Fix:** Per-wrapper schema.

```typescript
interface WrapperSchema {
  flagsWithArg: Set<string>;
  longEq: boolean;        // accepts --user=X
  commandFlag?: string;   // su's -c — wraps the actual command in this flag's value
}

const WRAPPERS: Record<string, WrapperSchema> = {
  sudo:   { flagsWithArg: new Set(["-u","-g","-h","-D","-C","-p","-r","-t","-T","-U"]), longEq: true },
  doas:   { flagsWithArg: new Set(["-u","-C"]), longEq: false },
  run0:   { flagsWithArg: new Set([]), longEq: true },
  pkexec: { flagsWithArg: new Set(["--user"]), longEq: true },
  gosu:   { flagsWithArg: new Set([]), longEq: false },
  runuser:{ flagsWithArg: new Set(["-u","-g","-G","-s","-c"]), longEq: true },
  setpriv:{ flagsWithArg: new Set(["--reuid","--regid","--groups"]), longEq: true },
  su:     { flagsWithArg: new Set(["-s","-G"]), longEq: false, commandFlag: "-c" },
};
```

`commandFlag` requires special handling: for `su`, the next arg is the *literal command string* and must be re-parsed via `parse()` recursively (or returned as opaque `commandString: string`).

---

### B2. No size cap on input

**File:** `src/index.ts:69-82`
**Severity:** MEDIUM — DoS vector for security hooks.

```typescript
export async function parse(src: string, ...): Promise<ShellFile> { ... }
```

`parse()` accepts arbitrary string. A hook running `parse(userInput)` has no upper bound. Pathological multi-MB input → WASM heap pressure → throw → caller fail-opens (per BUG-001 fail-open narrative) → silent disable.

**Fix:** Optional `maxBytes` param with sensible default.

```typescript
export async function parse(
  src: string,
  dialect: "bash" | "posix" | "mksh" = "bash",
  options: { maxBytes?: number } = {}
): Promise<ShellFile> {
  const maxBytes = options.maxBytes ?? 1_000_000; // 1 MB
  if (src.length > maxBytes) {
    throw new Error(`shell-ast: input size ${src.length} exceeds maxBytes ${maxBytes}`);
  }
  // ...
}
```

Use `Buffer.byteLength(src, "utf8")` if accuracy matters more than speed.

---

### B3. `<dynamic>` sentinel collides with literal arg

**File:** `src/helpers.ts:46`
**Severity:** LOW for normal use, MEDIUM for adversarial input.

```typescript
if (lit === null) {
  args.push("<dynamic>");
  continue;
}
```

A literal `cmd "<dynamic>"` and a substituted-away `cmd $foo` both yield `args: ["<dynamic>"]`. Indistinguishable. For security-adjacent rules that whitelist arg patterns, this is a bypass.

**Fix:** Symbol sentinel.

```typescript
export const DYNAMIC = Symbol("DYNAMIC");
export type ResolvedArg = string | typeof DYNAMIC;

export interface ResolvedCall {
  cmd: string;
  flags: string[];
  args: ResolvedArg[];
  raw: CallExprNode;
}
```

Breaking change. Make it now while pre-1.0.

---

### B4. Privilege escalator list incomplete

Covered in B1's `WRAPPERS` map. Adding `pkexec`, `gosu`, `setpriv`, `runuser`, `pfexec`, `please` to detection is the same edit.

---

## P2 — Optimization / structure

### C1. JSON over WASM boundary: double encode/decode

**File:** `processor/main.go:42-45`, `src/index.ts:75`
**Severity:** LOW — perf only, document as known cost.

```go
b, err := json.Marshal(node)
return js.ValueOf(string(b))
```

```typescript
const json = parseRaw(src, dialect);
const parsed = JSON.parse(json) as Record<string, unknown>;
```

For deep ASTs the JSON encode (Go) + decode (V8) is the wall-clock bottleneck.

**Alternative (deferred):** return `js.ValueOf(map)` recursively. Trade-off: many small cross-boundary calls, slower for small ASTs. Benchmark before pursuing.

**For now:** document in SPEC-002 under "Size Budget" and link to a future v1.x experiment.

---

### C2. `processor/structs.go` is 811 lines, single file, repetitive

**File:** `processor/structs.go`
**Severity:** LOW — maintainability.

Split:
- `dispatch.go` — `serializeNode`, `serializeCommand`, `serializeWordPart`, `serializeArithmExpr`, `serializeTestExpr`, `serializeLoop`
- `commands.go` — `CallExpr`, `BinaryCmd`, `IfClause`, `WhileClause`, `ForClause`, `CaseClause`, `Block`, `Subshell`, `FuncDecl`, `ArithmCmd`, `TestClause`, `DeclClause`, `LetClause`, `TimeClause`, `CoprocClause`, `TestDecl`
- `words.go` — `Word`, `Lit`, `SglQuoted`, `DblQuoted`, `CmdSubst`, `ParamExp`, `ProcSubst`, `ExtGlob`, `BraceExp`
- `arithm.go` — `ArithmExp`, `BinaryArithm`, `UnaryArithm`, `ParenArithm`
- `test.go` — `TestClause`, `BinaryTest`, `UnaryTest`, `ParenTest`
- `support.go` — `ArrayExpr`, `ArrayElem`, `WordIter`, `CStyleLoop`, `Slice`, `Replace`, `Expansion`, `Comment`, `Assign`, `Redirect`, `Stmt`, `File`

Plus extract repeated patterns:

```go
// generic []T → []interface{} via per-element serializer
func mapNodes[T any](xs []T, f func(T) interface{}) []interface{} {
  out := make([]interface{}, len(xs))
  for i, x := range xs { out[i] = f(x) }
  return out
}

// inject pos/end into any serializer's output map
func withPos(n syntax.Node, m map[string]interface{}) map[string]interface{} {
  m["pos"] = nodePos(n.Pos())
  m["end"] = nodePos(n.End())
  return m
}
```

`mapNodes` replaces ~12 hand-written loops. `withPos` removes ~80 lines of `"pos":/"end":` boilerplate from ~40 serializers.

---

### C3. Two dispatch tables, mostly unused

**File:** `processor/structs.go:7-79 (serializeNode)` vs `:168-208 (serializeCommand)`
**Severity:** LOW — confusion only.

`serializeNode` enumerates every node type, but is only ever reachable as the fallback for `serializeWordPart`/`serializeCommand`'s `default:` arms — and only one (`serializeWordPart:160`) actually returns it. The function is essentially dead.

**Fix:** Either delete `serializeNode` or make it the single dispatcher and route `serializeCommand`/`serializeWordPart`/etc. through it. Latter is cleaner if you keep the interface-typed dispatchers.

---

### C4. `helpers.ts` mixes responsibilities

**File:** `src/helpers.ts`
**Severity:** LOW — modularity.

Couples three concerns:
- Walker (`findCalls`)
- Lexer (`wordToLit`)
- Flag canonicalization (`resolveFlags`)

**Fix:** Split into:
- `src/extract.ts` — `findCalls`, future `findRedirects`, `findAssigns`, `findFunctions`
- `src/flags.ts` — `wordToLit`, `resolveFlags`, sentinels
- `src/semantic.ts` — already separate, keep

`src/index.ts` re-exports remain stable; consumers don't notice.

---

### C5. Test fixture duplication

**File:** `tests/helpers.test.ts:14-65` and `tests/semantic.test.ts:5-30`
**Severity:** LOW — DRY violation, ~50 lines.

Both test files redefine `makePos / makeLit / makeWord / makeCall / makeStmt / makeFile`.

**Fix:** Extract `tests/_factories.ts`. Both suites import.

```typescript
// tests/_factories.ts
export function makePos(offset = 0, line = 1, col = 1): NodePos { ... }
export function makeLit(value: string): LitNode { ... }
export function makeWord(...lits: string[]): Word { ... }
// ...
```

---

### C6. `UnwrappedCall` redefines fields rather than composing

**File:** `src/semantic.ts:9-15`
**Severity:** TRIVIAL.

```typescript
export interface UnwrappedCall {
  wrapper: string | null;
  cmd: string;
  flags: string[];
  args: string[];
  raw: CallExprNode;
}
```

**Fix:**

```typescript
export type UnwrappedCall = ResolvedCall & { wrapper: string | null };
```

Combines with B3 (sentinel) — `args` will be `ResolvedArg[]` after that fix; composition keeps both consistent for free.

---

### C7. Triple re-exports of `wordToLit`

**File:** `src/helpers.ts:23` (definition), `src/semantic.ts:64` (re-export), `src/index.ts:5` (re-export)
**Severity:** TRIVIAL.

**Fix:** Pick `src/index.ts` as the single re-export (or `src/flags.ts` after C4). Delete from `semantic.ts`.

---

### C8. No richer extractors beyond `findCalls`

**File:** `src/helpers.ts`
**Severity:** LOW — feature gap.

Library's primary value-add is "walk the tree for me." Currently only `findCalls` is exposed. For semantic analysis, callers reimplement walkers for redirects, assignments, function declarations.

**Fix (after C4):** Add to `src/extract.ts`:

```typescript
export function findRedirects(ast: ShellFile): Redirect[] { ... }
export function findAssignments(ast: ShellFile): Assign[] { ... }
export function findFunctions(ast: ShellFile): FuncDecl[] { ... }
export function findCmdSubstitutions(ast: ShellFile): CmdSubst[] { ... }
```

All are 5-line wrappers around `walk()`.

---

## P3 — Build, packaging, CI

### D1. **No CI workflow runs tests** — the precondition gap

**File:** `.github/workflows/`
**Severity:** CRITICAL — this is the meta-cause of BUG-001.

The only workflows present are `cc-review.yml` and `cc-review-interactive.yml` (AI code review). There is **no workflow** that runs:

- `go test ./processor/...`
- `bun test`
- `bun run typecheck`
- `bun run lint`
- WASM build

**Fix:** Add `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install
      - run: bun run build:wasm
      - run: cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" src/wasm_exec.js
      - run: bun run typecheck
      - run: bun run lint
      - run: go test -v ./processor/...
      - run: bun test
      - run: bun run build:ts
  smoke-compile:
    needs: test
    runs-on: ubuntu-latest
    steps: # see D2
```

Until D1 lands, every other fix in this audit ships without verification.

---

### D2. No "compiled binary on a fresh location" smoke test

**File:** none — to be added
**Severity:** HIGH — would catch BUG-001 directly.

Per `docs/BUGS.md:88-94`. Builds a binary that uses `parseRaw`, copies it outside the build tree's `node_modules/`, runs it, asserts known output.

**Fix:** `tests/smoke/compile-test.ts`:

```typescript
#!/usr/bin/env bun
import { parse, findCalls } from "@questi0nm4rk/shell-ast";
const ast = await parse("rm -rf /");
const [call] = findCalls(ast);
const cmd = call?.args[0]?.parts[0];
if (cmd?.type !== "Lit" || cmd.value !== "rm") {
  console.error("FAIL: expected rm, got", cmd);
  process.exit(1);
}
console.log("OK");
```

CI step:

```yaml
- run: bun build tests/smoke/compile-test.ts --compile --bytecode --outfile /tmp/sa-test
- run: cp /tmp/sa-test /tmp/elsewhere
- run: cd / && /tmp/elsewhere/sa-test  # different CWD, outside node_modules
```

---

### D3. `prepublishOnly` doesn't run tests

**File:** `package.json:30`
**Severity:** HIGH.

```json
"prepublishOnly": "bun run build"
```

You can publish a binary that doesn't pass tests. Fix:

```json
"prepublishOnly": "bun run lint && bun run typecheck && go test ./processor/... && bun test && bun run build"
```

---

### D4. Two competing build pipelines

**File:** `Makefile:15-17` vs `package.json:28`
**Severity:** MEDIUM — `Makefile` is broken for the secondary export.

| Path | Entry points | `.d.ts` | Status |
|------|--------------|---------|--------|
| `Makefile build-ts` | `src/index.ts` only | No | **Broken** — misses `semantic.ts` |
| `package.json build:ts` | `src/index.ts`, `src/semantic.ts` | Yes | Correct |

**Fix:** Either align Makefile to invoke `bun run build:ts` and stop duplicating, or delete the Makefile entirely (npm scripts cover everything). The Makefile adds little — recommend delete.

---

### D5. `.npmignore` and `package.json` `files` overlap

**File:** `.npmignore`, `package.json:23-25`
**Severity:** LOW — cleanup.

```json
"files": ["dist/"]
```

`files` is an allowlist (npm best practice). When `files` is present, `.npmignore` is largely redundant and risks diverging.

**Fix:** Delete `.npmignore`. `files: ["dist/"]` is sufficient and safer.

---

### D6. `tsconfig.json` includes `src/wasm_exec.js`

**File:** `tsconfig.json:24`
**Severity:** TRIVIAL.

```json
"include": ["src/**/*"]
```

Pulls in `src/wasm_exec.js`. Currently silently ignored (no `allowJs`). Explicit is better:

```json
"exclude": ["node_modules", "dist", "tests", "src/wasm_exec.js"]
```

---

### D7. `wasm_exec.js` ↔ Go toolchain version mismatch is undetectable

**File:** `Makefile:13`, `package.json:28`
**Severity:** MEDIUM — cryptic runtime failure.

```bash
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" src/wasm_exec.js
```

If WASM was built with Go 1.22 and the shim copied from Go 1.23, runtime errors are opaque (`syscall/js: unknown function id`).

**Fix:** Pin via `go.mod` toolchain directive, validate at build time.

```go
// go.mod
go 1.22
toolchain go1.22.10
```

```bash
# build:wasm prelude
HAVE=$(go env GOVERSION)
WANT=$(grep -oP 'toolchain go\K[\d.]+' go.mod)
[ "$HAVE" = "go$WANT" ] || { echo "Go version mismatch: have $HAVE want go$WANT"; exit 1; }
```

Or commit `wasm_exec.js` and freeze it with the WASM binary.

---

### D8. Both bun lockfiles `.gitignore`d

**File:** `.gitignore:28-29`
**Severity:** MEDIUM — reproducibility.

```gitignore
bun.lockb
bun.lock
```

Comment in the file says "Consider committing these." For a published library, **commit one** (`bun.lock`, the text format) for CI reproducibility. Ignored lockfiles drift silently.

**Fix:** Remove `bun.lock` from `.gitignore`. Run `bun install` to regenerate, commit it.

---

### D9. `mvdan/sh v3.10.0` likely outdated

**File:** `go.mod:7`
**Severity:** LOW — dependency hygiene.

```
mvdan.cc/sh/v3 v3.10.0
```

Current upstream is v3.11.x. No Renovate/Dependabot config in repo.

**Fix:** Add `.github/dependabot.yml` covering `gomod` and `npm` ecosystems. Update mvdan/sh to current.

---

### D10. README "Pre-release. Not yet published to npm" stale

**File:** `README.md:34-37`
**Severity:** TRIVIAL — documentation.

Recent commits add `prepublishOnly`, `.npmignore`, scoped name, semantic export. The package is publish-ready.

**Fix:** Drop the pre-release banner; replace with install instructions + version badge.

---

## E — Testing gaps

### E1. No fuzz of the serializer

**File:** none — to be added
**Severity:** MEDIUM — completeness.

`mvdan/sh` ships fuzz corpora at `mvdan.cc/sh/v3/syntax/testdata/`. Pipe each through `serializeFile` + `json.Marshal` and assert no panic, no `"type":"Unknown"` in output.

**Fix:** `processor/fuzz_test.go`:

```go
func FuzzSerialize(f *testing.F) {
  for _, seed := range []string{"echo hello", "rm -rf /", ...} {
    f.Add(seed)
  }
  f.Fuzz(func(t *testing.T, src string) {
    p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(syntax.LangBash))
    file, err := p.Parse(strings.NewReader(src), "")
    if err != nil { return } // not valid, skip
    _, err = json.Marshal(serializeFile(file))
    if err != nil { t.Fatalf("marshal: %v", err) }
  })
}
```

CI: `go test -run=^$ -fuzz=FuzzSerialize -fuzztime=30s ./processor/`.

---

### E2. Many node types untested end-to-end

**File:** `processor/structs_test.go`
**Severity:** MEDIUM.

Untested in current Go test suite:
- `LetClause`, `CoprocClause`, `TimeClause`, `TestDecl`
- `BraceExp`, `ExtGlob`, `Slice`, `Replace`, `Expansion`
- `ParenArithm`, `CStyleLoop`
- `ArrayExpr` with explicit indexes (`arr=([0]=a [1]=b)`)
- `BinaryTest -eq` numeric comparators

Every untested type has a serializer. Failure modes are silent (returns nil or wrong shape, no test asserts).

**Fix:** Add fixture for each. Pattern:

```go
func TestSerializeLetClause(t *testing.T) {
  ast := parseSource(t, "let x=1+2 y=3*4")
  cmd := getCmd(t, ast, 0)
  assert.Equal(t, "LetClause", cmd["type"])
  exprs := cmd["exprs"].([]interface{})
  assert.Len(t, exprs, 2)
}
```

---

### E3. Position correctness barely tested

**File:** `processor/structs_test.go:264-273`
**Severity:** MEDIUM.

```go
func TestSerializeNodePositions(t *testing.T) {
  ast := parseSource(t, "echo hello")
  // ... only asserts pos.line == 1, pos.col == 1
}
```

Single fixture. Multi-line, multi-statement positions never asserted. Real position bugs (off-by-one, byte vs rune offsets) hide.

**Fix:** Table test asserting `pos.line/pos.col/pos.offset` for nested nodes across multi-line sources. At least one fixture per nesting level (top, nested, inside CmdSubst, inside DblQuoted).

---

### E4. No round-trip / completeness check between Go and TS

**File:** none — to be added
**Severity:** HIGH — root cause of A4.

Reflection-based "every public field of every `syntax.*` Node type appears in the JSON output" test would have caught the `names`/`bracket` drift. A separate "every JSON key appears in the matching TS interface" check (TS-side) would close the loop.

**Fix (Go side):** runtime reflection over `reflect.TypeOf(syntax.ParamExp{})`, walk public fields, assert each is a key in the serialized map.

**Fix (TS side):** generate TS types from a JSON schema dumped by Go (post-v1, requires codegen).

For now: a hand-curated checklist test covering all ~42 node types would be sufficient and catches the drift.

---

## Recommended fix order

Each row is one PR. Each PR ends with green CI and a passing smoke (after D1+D2 land).

| PR | Phase | Findings | Effort | Unblocks |
|----|-------|----------|--------|----------|
| 1 | **CI** | D1, D2 | Small | Everything else |
| 2 | **BUG-001 + race** | A1, A2, A3 | Small | ai-guardrails consumers |
| 3 | **Type drift + position fix** | A4, A5 | Small | Correct AST contract |
| 4 | **Test fixtures + missing coverage** | C5, E2, E3 | Medium | Confidence for refactors |
| 5 | **Wrapper schemas + size cap + sentinel** | B1, B2, B3, B4, C6 | Medium | Real security correctness |
| 6 | **Module split + extractors** | C4, C7, C8 | Small | Library ergonomics |
| 7 | **Go refactor (helpers + split)** | C2, C3 | Medium | Maintainability |
| 8 | **Build cleanup** | D3, D4, D5, D6, D7, D8, D9, D10 | Small | Publishing hygiene |
| 9 | **Fuzz + completeness** | E1, E4 | Medium | Future-proof |

**Total:** 9 PRs, ~4-5 days end-to-end with TDD discipline.

Each PR follows TDD: failing test → minimal fix → green → review.

---

## Findings index (file-by-file)

### `src/wasm.ts`
- A1 (lines 23, 35) — `import.meta.dirname` baked
- A2 (line 25) — runtime string-evaluation of shim
- A3 (lines 31-47) — `loadWasm` race

### `src/index.ts`
- B2 (line 69) — no size cap
- C7 (line 5) — duplicate `wordToLit` re-export

### `src/helpers.ts`
- B3 (line 46) — `<dynamic>` sentinel collision
- C4 (file) — mixed responsibilities
- C8 — missing extractors

### `src/semantic.ts`
- A5 (lines 48-52) — synthetic node leaks position
- B1 (lines 6-7) — wrong wrapper flag schemas
- B4 (line 7) — incomplete escalator list
- C6 (lines 9-15) — `UnwrappedCall` redefinition
- C7 (line 64) — duplicate `wordToLit` re-export

### `src/types.ts`
- A4 (lines 253-264, 266-270) — drift with Go serializer

### `processor/structs.go`
- A4 (lines 588, 599) — `names`/`bracket` drift
- C2 (file) — single 811-line file, repetitive
- C3 (lines 7-79, 168-208) — duplicated dispatch tables

### `processor/structs_test.go`
- E2 (file) — many node types untested
- E3 (lines 264-273) — position test too narrow

### `tests/helpers.test.ts`, `tests/semantic.test.ts`
- C5 (helpers.test.ts:14-65, semantic.test.ts:5-30) — duplicate fixtures

### `package.json`
- D3 (line 30) — `prepublishOnly` skips tests
- D5 (lines 23-25) — `files` overlaps with `.npmignore`

### `Makefile`
- D4 (lines 15-17) — broken for secondary export
- D7 (line 13) — Go version mismatch undetectable

### `tsconfig.json`
- D6 (line 24) — includes `wasm_exec.js`

### `.gitignore`
- D8 (lines 28-29) — both bun lockfiles ignored

### `.npmignore`
- D5 — redundant with `files`

### `go.mod`
- D9 (line 7) — `mvdan/sh v3.10.0` outdated
- D7 — no `toolchain` directive

### `README.md`
- D10 (lines 34-37) — stale "pre-release" banner

### `.github/workflows/`
- D1 (directory) — no CI workflow runs tests
- D2 — no compiled-binary smoke

---

## Out of scope (deferred)

- Streaming JSON across the WASM boundary (C1 deeper fix) — requires benchmarking.
- TS type codegen from Go reflection (E4 deeper fix) — requires build-time tooling.
- Replacing `wasm_exec.js` with a minimal subset (A2 stretch) — requires deep Go runtime knowledge.
- Migrating `testify` to stdlib `testing` — pure dep reduction, no correctness impact.
