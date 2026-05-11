# shell-ast — Known Bugs

## BUG-001: WASM path baked at compile time breaks `bun build --compile`

**Severity:** CRITICAL — silently breaks all consumers that compile a binary.

**Reported:** 2026-05-11 (during ai-guardrails v4.0.0 release)

**Symptom:** A binary that bundles `@questi0nm4rk/shell-ast` via `bun build --compile`
works on the build machine but silently fails to load WASM on every other machine.
Consumers see no error — `parseRaw()` calls go through `loadWasm()` which throws
`ENOENT`, callers catch and treat as "no AST available" (per fail-open conventions),
and every shell-AST-dependent rule silently no-ops.

**Where it bit us:** ai-guardrails v4.0.0 shipped three compiled binaries via GitHub
Releases. The CI runner path (`/home/runner/work/ai-guardrails/ai-guardrails/...`)
got baked into every binary. `dist/ai-guardrails-hk -c "git push --force"` returned
exit 0 + "Everything up-to-date" instead of escalating. Only caught during
post-install end-to-end review. Fix-forward required a v4.0.1 patch release.

### Root cause

`src/wasm.ts:23,35` resolves both asset paths via `import.meta.dirname`:

```typescript
const runtimePath = join(import.meta.dirname, "wasm_exec.js");
const wasmPath = join(import.meta.dirname, "../dist/shell-ast.wasm");
```

`bun build --compile` snapshots `import.meta.dirname` at build time. The compiled
binary contains the absolute path of the build machine's `node_modules/`. At runtime
on a different machine, `readFile(wasmPath)` returns ENOENT.

Verification (string-dump of an installed binary built by GitHub Actions):

```
$ strings ~/.local/bin/ai-guardrails-hk | grep shell-ast.wasm
const wasmPath = import_node_path.join(
  "/home/runner/work/ai-guardrails/ai-guardrails/node_modules/@questi0nm4rk/shell-ast/dist",
  "../dist/shell-ast.wasm"
);
```

### Why fail-open hides it

hook-kit's Iron Law 4 (fail open on infra errors) is the right default for the
*evaluator*, but applied at the WASM-load layer it converts a single packaging
bug into a silent disabling of every command/pipe/redirect rule across the
ecosystem. There is no signal at runtime that anything is wrong.

### Proposed fix

Switch from `readFile`-by-path to bun's import-asset syntax, which embeds the
asset into the bundle at build time and resolves at runtime by content, not by
path:

```typescript
// src/wasm.ts (proposed shape)
// `with { type: "text" }` returns the file contents as a string in dev and
// embeds them in the compiled binary.
import wasmExecSrc from "./wasm_exec.js" with { type: "text" };

// `with { type: "wasm" }` returns the instantiated WebAssembly.Module, which
// can be passed to WebAssembly.instantiate(module, importObject).
import wasmModule from "../dist/shell-ast.wasm" with { type: "wasm" };
```

Then `loadGoRuntime()` evaluates `wasmExecSrc` (same mechanism as today, just
with a string from the bundle instead of from disk) and `loadWasm()` calls
`WebAssembly.instantiate(wasmModule, go.importObject)` directly — no `readFile`
of an absolute path.

Bun's import attributes are honored both in dev (resolves to file content at
module-load) and in `bun build --compile` (embeds the asset into the compiled
binary). Same code in script mode and binary mode, no conditional logic.

**Reference:** Bun bundler docs on import attributes — https://bun.com/docs/bundler/loaders

### Tarball impact

The `files` field in `package.json` already includes `dist/`, so the WASM and
JS runtime ship with the package today. The fix changes how they're loaded,
not what's distributed.

### Test that would have caught this

A "compiled binary on a fresh location" smoke test:

```bash
# In shell-ast's CI:
bun build tests/smoke/compile-test.ts --compile --bytecode --outfile /tmp/sa-test
cp /tmp/sa-test /tmp/elsewhere/sa-test  # any path outside node_modules
/tmp/elsewhere/sa-test  # parses a known input, asserts output
```

Currently shell-ast's tests run `parseRaw()` from the source tree, so
`import.meta.dirname` resolves correctly and the bug stays invisible.

### Severity rationale

CRITICAL because:

1. Silent failure mode — no error message, no exit code change, no log line.
2. All downstream guards become no-ops, so security-relevant rules go
   unenforced without anyone noticing. Worse than no guard at all (false sense
   of safety).
3. Affects every consumer that uses `bun build --compile`, which is the only
   distribution path for shell-wrapper-style hook binaries.
4. Distinguishes by machine, not by code — same binary works on builder, fails
   everywhere else, so a single end-to-end install test on a fresh machine is
   needed to catch it (the standard "build, run unit tests" loop misses it).

### Workaround until fix lands

Consumers can build on the same machine they install on. Cross-machine
distribution (CI build → user install) is broken until BUG-001 is resolved.

---
