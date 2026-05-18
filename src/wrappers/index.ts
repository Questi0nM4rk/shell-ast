// Barrel re-export for the wrappers module. Public-API entrypoint
// for consumers that want to import directly:
//
//   import { unwrapCall, type UnwrappedCall } from "@questi0nm4rk/shell-ast";
//
// (top-level `src/index.ts` already re-exports these; importing from
// `./wrappers` directly is an internal convention only).

export type { UnwrappedCall } from "./types.js";
export { unwrapCall } from "./unwrap.js";
export { unwrapCallParsed } from "./unwrap-async.js";
export { unwrapDeep } from "./unwrap-deep.js";
export { unwrapDeepParsed } from "./unwrap-deep-async.js";
