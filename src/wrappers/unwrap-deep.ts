// unwrapDeep — sync chain walker for chained wrappers.
//
// Returns the chain of UnwrappedCall results outermost-first. For each
// `wrapped` layer, continues with `innerRaw` (the synthetic inner
// CallExpr exposed since 0.6.0). Stops at `plain`, `wrapped-script`,
// or `wrapped-opaque` — those are terminal in the sync walker, since
// `wrapped-script` requires re-parsing the script string (an async
// operation handled by `unwrapDeepParsed`).
//
// Closes BUG-008 (deferred from v0.5.0, v0.6.0; shipped v0.7.0).

import type { CallExprNode } from "../types.js";
import type { UnwrappedCall } from "./types.js";
import { type UnwrapOptions, unwrapCall } from "./unwrap.js";

/** Internal runaway guard against pathological inputs like
 *  `sudo sudo sudo … sudo cmd` with N huge. Consumers cap at
 *  smaller values (hook-kit caps at 5 per BUG-008). 100 here is
 *  large enough that realistic chains are never truncated, small
 *  enough that an adversarial recursion bombs early. */
const MAX_CHAIN_DEPTH = 100;

/** Walk the wrapper chain. Returns the unwrapped layers outermost-first.
 *
 *  - For each `wrapped` layer, continues with `u.innerRaw`.
 *  - Stops at the first `plain` / `wrapped-script` / `wrapped-opaque`
 *    layer (sync can't re-parse `wrapped-script` — see `unwrapDeepParsed`).
 *  - Returns `[]` if `unwrapCall(call)` would return `null` on the first
 *    layer (CallExpr with no resolvable cmd).
 *  - Caps at `MAX_CHAIN_DEPTH` and returns the partial chain. */
export function unwrapDeep(call: CallExprNode, opts?: UnwrapOptions): UnwrappedCall[] {
  const chain: UnwrappedCall[] = [];
  let current: CallExprNode | undefined = call;
  let suppressPlain = false;
  while (current && chain.length < MAX_CHAIN_DEPTH) {
    const u = unwrapCall(current, opts);
    if (!u || (suppressPlain && u.kind === "plain")) break;
    chain.push(u);
    // Try every wrapped inner call so custom resolvers participate without a
    // second look-ahead invocation. A terminal plain result is redundant with
    // its parent's `cmd`, so the next iteration suppresses it.
    if (u.kind === "wrapped") {
      current = u.innerRaw;
      suppressPlain = true;
    } else {
      current = undefined;
    }
  }
  return chain;
}
