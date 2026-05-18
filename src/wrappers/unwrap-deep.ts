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

import type { ResolveFlagsOptions } from "../flags.js";
import type { CallExprNode } from "../types.js";
import { WRAPPERS } from "./registry.js";
import type { UnwrappedCall } from "./types.js";
import { unwrapCall } from "./unwrap.js";

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
export function unwrapDeep(
  call: CallExprNode,
  opts?: ResolveFlagsOptions
): UnwrappedCall[] {
  const chain: UnwrappedCall[] = [];
  let current: CallExprNode | undefined = call;
  while (current && chain.length < MAX_CHAIN_DEPTH) {
    const u = unwrapCall(current, opts);
    if (!u) break;
    chain.push(u);
    // Continue only when this wrapped layer's inner cmd is itself a
    // recognized wrapper. For `sudo rm`, the next unwrap would just be
    // `plain(rm)` — redundant with what `wrapped(sudo, cmd:rm)` already
    // exposes. For `sudo bash` / `sudo sudo` / `doas bash`, the next
    // layer is genuinely new information (wrapped-script, another
    // wrapped, etc.) so we keep walking.
    if (u.kind === "wrapped" && WRAPPERS[u.cmd] !== undefined) {
      current = u.innerRaw;
    } else {
      current = undefined;
    }
  }
  return chain;
}
