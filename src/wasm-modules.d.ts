// Ambient declarations for asset imports used by src/wasm.ts.

// `import "./wasm_exec.js"` is a side-effect import — the file is the Go
// runtime shim that registers `globalThis.Go` on evaluation.
declare module "*/wasm_exec.js";

// `import path from "x.wasm" with { type: "file" }` — Bun's file loader
// returns a path string. In dev it resolves to the real disk path; in
// `bun build --compile` output it resolves to an embedded `$bunfs/...`
// path that node:fs can read. Either way, readFile works.
declare module "*.wasm" {
  const path: string;
  export default path;
}
