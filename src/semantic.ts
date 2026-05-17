// Back-compat barrel — semantic.ts contents moved to src/wrappers/ in
// v0.6.0. Existing `from "./semantic.js"` / `from "../src/semantic.js"`
// imports continue to work unchanged.
//
// New code should prefer `from "@questi0nm4rk/shell-ast"` (top-level
// re-export) or `from "./wrappers/index.js"` for internal callers.

export type { ResolvedArg, ResolvedCall } from "./flags.js";
export type { UnwrappedCall } from "./wrappers/index.js";
export { unwrapCall, unwrapCallParsed } from "./wrappers/index.js";
