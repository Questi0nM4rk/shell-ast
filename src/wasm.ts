// WASM bridge to the Go shell-ast processor.
//
// Asset loading uses Bun import attributes so paths are not resolved at
// runtime via import.meta.dirname (which `bun build --compile` would
// snapshot to the build-machine's absolute path — see docs/BUGS.md
// BUG-001 and docs/AUDIT.md A1).
//
// `with { type: "file" }` returns a real path in dev and a $bunfs/...
// embedded path in compiled binaries; readFile works in both.
//
// The shim is a side-effect import — wasm_exec.js is an IIFE that
// registers `globalThis.Go` when evaluated. Bun bundles it inline in
// dev and in compiled binaries.
//
// loadWasm() caches its in-flight promise so concurrent first-callers
// share a single instantiation (audit A3).

import { readFile } from "node:fs/promises";
import "./wasm_exec.js";
import wasmPath from "../dist/shell-ast.wasm" with { type: "file" };

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
