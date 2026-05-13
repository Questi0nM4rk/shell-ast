// Structural effect classification.
//
// Every shell AST node either produces a side effect (I/O, env mutation,
// process fork, exec) or is structural-only (sequencing, flow control).
// `effectOf(node)` returns the immediate effect of a single node;
// `effectsOf(node)` walks a subtree and unions every effect produced
// underneath.
//
// The taxonomy is derived purely from node types and operator enums —
// no command-name knowledge required. `effectOf(CallExpr)` is always
// `"exec"`: we know SOMETHING runs, not whether `rm` deletes files.
// Layer policy (e.g. "this cmd name is destructive") on top.
//
// Why ship this: hook-kit and similar consumers hand-roll constants
// like `WRITE_OPS = Set([">", ">>", ...])` inline in every rule. The
// library owns the operator enum; this exposes the categorisation
// once instead of N times.

import type { ShellNode } from "./types.js";
import { walk } from "./walk.js";

/** Structural effects derivable from AST shape alone. */
export type Effect =
  /** CallExpr — a command runs. The library can't say what it does. */
  | "exec"
  /** CmdSubst (`$(…)`, `` `…` `` ) — executes children, captures stdout. */
  | "capture-exec"
  /** Subshell (`(…)`) — forks a child shell and waits. */
  | "subshell"
  /** BinaryCmd op `|` or `|&` — stdout (and maybe stderr) wired to next stage. */
  | "pipe"
  /** Stmt.background (`cmd &`) — forks and detaches; survives script exit. */
  | "fork-detach"
  /** Redirect op `<`, `<<`, `<<-`, `<<<` — file descriptor opened for reading. */
  | "fs-read"
  /** Redirect op `>`, `>>`, `>|`, `&>`, `&>>` — fd opened for writing. */
  | "fs-write"
  /** Redirect op `<>` — fd opened for read/write. */
  | "fs-rw"
  /** Redirect op `<&`, `>&` — fd duplication (e.g. `2>&1`). No I/O. */
  | "fd-dup"
  /** ProcSubst `<(…)` — inner runs, output presented as a readable FD. */
  | "compound-fs-read"
  /** ProcSubst `>(…)` — inner runs, input presented as a writable FD. */
  | "compound-fs-write"
  /** Bare Assign (e.g. `FOO=bar` as a standalone Stmt) — writes shell env. */
  | "env-write"
  /** Assign inside a CallExpr (`FOO=bar cmd`) — transient env for one exec. */
  | "env-prefix";

/** Effect of THIS node only — does not recurse into children. Returns
 *  null for purely-structural nodes (File, Stmt, IfClause, …) that
 *  carry no immediate effect of their own. */
export function effectOf(node: ShellNode): Effect | null {
  switch (node.type) {
    case "CallExpr":
      // Assignment-only "calls" (FOO=bar with no args) are env mutations.
      return node.args.length === 0 ? "env-prefix" : "exec";
    case "CmdSubst":
      return "capture-exec";
    case "Subshell":
      return "subshell";
    case "BinaryCmd":
      return node.op === "|" || node.op === "|&" ? "pipe" : null;
    case "Stmt":
      return node.background ? "fork-detach" : null;
    case "Redirect": {
      const op = node.op;
      if (op === "<" || op === "<<" || op === "<<-" || op === "<<<") return "fs-read";
      if (op === ">" || op === ">>" || op === ">|" || op === "&>" || op === "&>>")
        return "fs-write";
      if (op === "<>") return "fs-rw";
      if (op === "<&" || op === ">&") return "fd-dup";
      return null;
    }
    case "ProcSubst":
      return node.op === "<(" ? "compound-fs-read" : "compound-fs-write";
    case "Assign":
      // Standalone Assign nodes carry env-write; Assigns inside a
      // CallExpr arrive here via the same path but the parent's
      // effectOf already classifies as env-prefix when args is empty.
      // To distinguish, callers should pass the CallExpr/Stmt rather
      // than the bare Assign — but if they do pass an Assign, the
      // safest single-node answer is env-write.
      return "env-write";
    default:
      return null;
  }
}

/** Union of every effect produced by `node` and all its descendants.
 *  Stmt.background bubbles up via the Stmt itself; redirect ops on
 *  any Stmt are included; CmdSubst/ProcSubst contribute their own
 *  effect AND any nested effects below them. */
export function effectsOf(node: ShellNode): Set<Effect> {
  const out = new Set<Effect>();
  walk(node, {});
  // walk doesn't give a "visit every node type" visitor; build one
  // by iterating known types instead.
  const visitor = new Proxy({} as Record<string, (n: ShellNode) => void>, {
    get: () => (n: ShellNode) => {
      const e = effectOf(n);
      if (e !== null) out.add(e);
    },
  });
  walk(node, visitor);
  return out;
}
