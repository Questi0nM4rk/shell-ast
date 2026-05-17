// unwrapCallParsed — async unwrap that additionally pre-parses the
// inner script for `wrapped-script` results. Saves consumers from
// re-invoking `parse()` themselves.

import type { ResolveFlagsOptions } from "../flags.js";
import type { CallExprNode, ShellFile } from "../types.js";
import type { UnwrappedCall } from "./types.js";
import { unwrapCall } from "./unwrap.js";

/** Async unwrap that additionally pre-parses the script for any
 *  `wrapped-script` result. Consumers wanting to recurse into the
 *  inner AST get it without a second parse() call.
 *
 *  Takes a `parse` function as input to avoid a circular import.
 *  The public `parse` from `src/index.ts` is the expected argument. */
export async function unwrapCallParsed(
  call: CallExprNode,
  parse: (src: string) => Promise<ShellFile>,
  opts?: ResolveFlagsOptions
): Promise<UnwrappedCall | null> {
  const u = unwrapCall(call, opts);
  if (!u || u.kind !== "wrapped-script") return u;
  try {
    const innerAst = await parse(u.script);
    return { ...u, innerAst };
  } catch {
    // Inner script is shell-syntactically invalid — return without
    // innerAst so consumers can still inspect the script string.
    return u;
  }
}
