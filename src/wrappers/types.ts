// UnwrappedCall — the discriminated result space of `unwrapCall`.
//
// Adding a variant: extend the union here, update `unwrapCall` in
// `./unwrap.ts` to return it, add a snapshot fixture to
// `tests/wrapper-shapes.test.ts`, document in `docs/MIGRATION-*.md`
// for the release that adds it. TypeScript exhaustiveness checking
// ensures every consumer's `switch (u.kind)` will fail to compile
// until they handle the new variant.

import type { ResolvedArg } from "../flags.js";
import type { CallExprNode, ShellFile } from "../types.js";

/** The four legitimate outcomes of unwrapping a CallExpr. Consumers
 *  write `switch (u.kind)` and TypeScript forces exhaustive handling.
 *
 *  - `plain`:           not a wrapper, or wrapper-named but used non-wrapper-ly
 *                       (`bash`, `bash --version`, `sudo -V`, `gosu user`)
 *  - `wrapped`:         wrapper detected, inner command resolved statically
 *                       (`sudo rm -rf /`, `gosu user rm /tmp`, `exec rm /`)
 *  - `wrapped-script`:  wrapper detected, inner is a shell-script string
 *                       (`bash -c "rm"`, `eval "rm -rf"`). `script` is
 *                       the value; consumers parse it themselves or use
 *                       `unwrapCallParsed` for the pre-parsed `innerAst`.
 *  - `wrapped-opaque`:  wrapper detected, inner unresolvable (`sudo $cmd`,
 *                       `bash -c $script`). Wrapper detection preserved
 *                       so security consumers still see escalation. */
export type UnwrappedCall =
  | {
      kind: "plain";
      cmd: string;
      flags: string[];
      args: ResolvedArg[];
      /** Values captured for each value-taking flag the resolver
       *  recognized on this call. See `ResolvedCall.flagValues` for
       *  the population rules. Always present, possibly empty `{}`. */
      flagValues: Record<string, ResolvedArg[]>;
      raw: CallExprNode;
    }
  | {
      kind: "wrapped";
      wrapper: string;
      cmd: string;
      flags: string[];
      args: ResolvedArg[];
      /** Values captured for each value-taking flag the resolver
       *  recognized on the INNER command (post-wrapper-strip). Always
       *  present, possibly empty `{}`. For the wrapper's own value
       *  flags (e.g. sudo `-u root`), call
       *  `resolveFlags(u.raw, opts).flagValues` directly. */
      flagValues: Record<string, ResolvedArg[]>;
      /** Synthetic CallExpr representing the inner command after the
       *  wrapper's own flags and positional-user (if any) have been
       *  consumed. Use with query helpers to ask questions of the
       *  inner call without re-synthesizing it:
       *  `tokenAfter(u.innerRaw, "-o")`, `flagsMatching(u.innerRaw, fn)`.
       *  Query helpers also accept `u` directly and dispatch here. */
      innerRaw: CallExprNode;
      /** The OUTER call as the user wrote it (`sudo gcc -o /tmp src.c`).
       *  Use to inspect wrapper-side flags. */
      raw: CallExprNode;
    }
  | {
      kind: "wrapped-script";
      wrapper: string;
      /** The script-string value of the commandFlag (or concatenated
       *  positional args for `eval`). Re-parse with `parse()` or use
       *  `unwrapCallParsed` to get `innerAst` populated. */
      script: string;
      /** Wrapper's own flags as parsed (e.g. ["-c"]). */
      flags: string[];
      /** Positional args AFTER the script — bash assigns these to
       *  $0/$1/… inside the inner script. */
      args: ResolvedArg[];
      raw: CallExprNode;
      /** Pre-parsed inner AST. Populated only by `unwrapCallParsed`. */
      innerAst?: ShellFile;
    }
  | {
      kind: "wrapped-opaque";
      wrapper: string;
      /** Why the inner is unresolvable — lets security consumers decide
       *  escalation policy without re-deriving it:
       *   - "dynamic-script":  shell -c / eval given a non-literal body
       *                        (`bash -c "$CMD"`, `eval $SCRIPT`)
       *   - "dynamic-command": wrapper given a non-literal inner command
       *                        (`sudo $CMD`)
       *   - "missing-script":  shell -c with no body at all (`bash -c`) */
      reason: "dynamic-script" | "dynamic-command" | "missing-script";
      flags: string[];
      args: ResolvedArg[];
      raw: CallExprNode;
    };
