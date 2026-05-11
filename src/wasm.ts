// WASM bridge to the Go shell-ast processor.
//
// Path resolution must work in three modes:
//   (a) dev `bun test` / `bun run` against src/ — wasm lives in
//       sibling dist/ directory
//   (b) consumer `import "@questi0nm4rk/shell-ast"` after `bun add` —
//       wasm lives in the same directory as the bundled index.js
//   (c) `bun build --compile` standalone binary — wasm is embedded
//       inside the binary's $bunfs/ filesystem
//
// Anchoring against `fileURLToPath(import.meta.url)` covers all three:
// dev → src/wasm.ts URL, consumer → dist/index.js URL (which gets
// joined with the sibling wasm), compile → $bunfs URL (binary self-
// contained). The `../dist/` vs `./` divergence between dev and
// consumer is reconciled by deriving the wasm filename inline below
// and letting the bundler rewrite the import path.
//
// Earlier history (see docs/BUGS.md BUG-001 and docs/AUDIT.md A1):
//   - v0.1.0 used `import.meta.dirname` directly → BUG-001 baked the
//     build-machine path into `bun build --compile` output
//   - v0.2.0 used `with { type: "file" }` → bundler emitted a
//     CWD-relative string literal that broke every consumer not
//     running from dist/ (gh issue #5)
//   - v0.2.1 (this): fileURLToPath(import.meta.url) → preserved as a
//     runtime expression by the bundler; resolves correctly in all
//     three modes
//
// The shim is a side-effect import — wasm_exec.js is an IIFE that
// registers `globalThis.Go` when evaluated. Bun bundles it inline
// in dev and in compiled binaries.
//
// loadWasm() caches its in-flight promise so concurrent first-callers
// share a single instantiation (audit A3).

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./wasm_exec.js";
import wasmAsset from "../dist/shell-ast.wasm" with { type: "file" };

// `with { type: "file" }` returns:
//   - dev (bun run / bun test on src/): an absolute disk path
//   - bun build --compile: an absolute $bunfs/... path (embedded)
//   - bun build --target node: a CWD-relative literal like
//     "./shell-ast.wasm" — this is the v0.2.0 regression (gh #5)
//
// Re-anchor a relative result against the module's own directory
// (dist/index.js's location for consumer installs). Absolute paths
// are passed through untouched so both dev and --compile keep
// working unchanged.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = isAbsolute(wasmAsset)
  ? wasmAsset
  : join(here, wasmAsset.replace(/^\.\//, ""));

// WebAssembly.Imports isn't exported in all lib targets; derive the
// expected type from instantiate's signature.
type WasmImports = NonNullable<Parameters<typeof WebAssembly.instantiate>[1]>;

interface GoConstructor {
  new (): GoInstance;
}

interface GoInstance {
  importObject: WasmImports;
  run(instance: WebAssembly.Instance): void;
}

type ParseFn = (src: string, dialect?: string, splitBraces?: boolean) => string;

let parseFn: ParseFn | null = null;
let loadPromise: Promise<void> | null = null;

function readGlobal<T>(key: string): T | undefined {
  return (globalThis as Record<string, unknown>)[key] as T | undefined;
}

async function doLoadWasm(): Promise<void> {
  const Go = readGlobal<GoConstructor>("Go");
  if (!Go) throw new Error("shell-ast: wasm_exec.js did not register globalThis.Go");

  const wasmBytes = await readFile(wasmPath);
  const go = new Go();
  const result = await WebAssembly.instantiate(wasmBytes, go.importObject);
  go.run(result.instance);

  const exported = readGlobal<ParseFn>("__shellAstParse");
  if (!exported) throw new Error("shell-ast: WASM did not register __shellAstParse");
  parseFn = exported;
}

export function loadWasm(): Promise<void> {
  loadPromise ??= doLoadWasm();
  return loadPromise;
}

export function parseRaw(src: string, dialect?: string, splitBraces?: boolean): string {
  if (parseFn === null)
    throw new Error("shell-ast: WASM not loaded — call loadWasm() first");
  return parseFn(src, dialect, splitBraces);
}
