// unwrapDeepParsed — async chain walker. Same logic as `unwrapDeep`
// for `wrapped` layers, plus: on `wrapped-script` it parses
// `u.script` via the passed `parse` function and continues with the
// inner script's first statement's cmd. The `wrapped-script` layer
// in the returned chain has `innerAst` populated.
//
// The `parse` function is threaded in (same pattern as
// `unwrapCallParsed`) to avoid a circular import.

import type { ResolveFlagsOptions } from "../flags.js";
import type { CallExprNode, ShellFile } from "../types.js";
import { WRAPPERS } from "./registry.js";
import type { UnwrappedCall } from "./types.js";
import { unwrapCall } from "./unwrap.js";

const MAX_CHAIN_DEPTH = 100;

/** Walk the wrapper chain, re-parsing `wrapped-script` layers' scripts.
 *
 *  - For each `wrapped` layer with a wrapper-named inner cmd, continues
 *    with `u.innerRaw` (same as `unwrapDeep`).
 *  - For each `wrapped-script` layer, parses `u.script` and continues
 *    with the parsed AST's first statement's CallExpr cmd (if any).
 *    The pushed layer has `innerAst` set.
 *  - Stops at `plain`, `wrapped-opaque`, or `wrapped` whose inner cmd
 *    isn't a recognized wrapper.
 *  - Parse error on a `wrapped-script` script → pushes the layer
 *    without `innerAst` and stops.
 *  - Caps at `MAX_CHAIN_DEPTH` defensively (returns partial chain). */
export async function unwrapDeepParsed(
  call: CallExprNode,
  parse: (src: string) => Promise<ShellFile>,
  opts?: ResolveFlagsOptions
): Promise<UnwrappedCall[]> {
  const chain: UnwrappedCall[] = [];
  let current: CallExprNode | undefined = call;
  while (current && chain.length < MAX_CHAIN_DEPTH) {
    const u = unwrapCall(current, opts);
    if (!u) break;

    if (u.kind === "wrapped" && WRAPPERS[u.cmd] !== undefined) {
      chain.push(u);
      current = u.innerRaw;
      continue;
    }

    if (u.kind === "wrapped-script") {
      let innerAst: ShellFile | undefined;
      try {
        innerAst = await parse(u.script);
      } catch {
        chain.push(u);
        break;
      }
      chain.push({ ...u, innerAst });
      const firstStmt = innerAst.stmts[0];
      if (firstStmt?.cmd?.type === "CallExpr") {
        current = firstStmt.cmd;
      } else {
        current = undefined;
      }
      continue;
    }

    // Terminal: plain, wrapped-opaque, or wrapped-with-non-wrapper-inner.
    chain.push(u);
    current = undefined;
  }
  return chain;
}
