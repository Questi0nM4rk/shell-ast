import { readFile } from "node:fs/promises";
import { join } from "node:path";

// WebAssembly.Imports is not directly accessible in all TypeScript targets;
// use Parameters inference to get the exact type expected by instantiate.
type WasmImports = NonNullable<Parameters<typeof WebAssembly.instantiate>[1]>;

interface GoInstance {
  importObject: WasmImports;
  run(instance: WebAssembly.Instance): void;
}

let parseFn: ((src: string, dialect?: string) => string) | null = null;

async function loadGoRuntime(): Promise<new () => GoInstance> {
  // Check if the Go WASM runtime is already loaded
  const g = globalThis as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .Go on Record<>
  if (g["Go"]) return g["Go"] as new () => GoInstance;

  // Load and execute wasm_exec.js which sets globalThis.Go.
  // new Function() runs the code in global scope, which is exactly what we need.
  const runtimePath = join(import.meta.dirname, "wasm_exec.js");
  const src = await readFile(runtimePath, "utf8");
  new Function(src)();

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .Go on Record<>
  return g["Go"] as new () => GoInstance;
}

export async function loadWasm(): Promise<void> {
  if (parseFn !== null) return;

  const Go = await loadGoRuntime();
  const wasmPath = join(import.meta.dirname, "../dist/shell-ast.wasm");
  const wasmBytes = await readFile(wasmPath);

  const go = new Go();
  const result = await WebAssembly.instantiate(wasmBytes, go.importObject);
  go.run(result.instance);

  parseFn = (src: string, dialect = "bash") => {
    const g2 = globalThis as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .__shellAstParse
    return (g2["__shellAstParse"] as (s: string, d: string) => string)(src, dialect);
  };
}

export function parseRaw(src: string, dialect?: string): string {
  if (parseFn === null) throw new Error("WASM not loaded — call loadWasm() first");
  return parseFn(src, dialect);
}
