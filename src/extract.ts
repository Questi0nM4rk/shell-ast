// Walker-based extractors with optional structural filters.
//
// BUG-006: `findCalls(ast, { depth: "top" })` restricts the result to
// "top-level execution context" calls — every call outside CmdSubst /
// ProcSubst / BraceExp and outside the inner-script value of a
// commandFlag (`bash -c "..."`'s argument is not crossed).
//
// `findRedirects(ast, { ops: "write" })` filters to write-redirects
// only, matching hook-kit's `WRITE_OPS` set.

import type {
  Assign,
  CallExprNode,
  CmdSubst,
  FuncDecl,
  Redirect,
  RedirectOp,
  ShellFile,
  ShellNode,
} from "./types.js";
import { type Visitor, walk } from "./walk.js";

/** Return every node in the tree whose .type matches `type`. Typed
 *  via the discriminated-union extract: `findAll(ast, "CallExpr")`
 *  returns CallExprNode[], etc. */
export function findAll<K extends ShellNode["type"]>(
  ast: ShellFile,
  type: K
): Extract<ShellNode, { type: K }>[] {
  const out: Extract<ShellNode, { type: K }>[] = [];
  const visitor: Visitor = {
    [type]: (node: Extract<ShellNode, { type: K }>) => {
      out.push(node);
    },
  } as Visitor;
  walk(ast, visitor);
  return out;
}

// ─── findCalls + depth filter (BUG-006) ──────────────────────────────────────

export interface ExtractCallOptions {
  /** `"any"` (default): every CallExpr in the tree, including inside
   *  command substitutions and brace expansions.
   *  `"top"`: only calls in the visible execution context — skips
   *  CmdSubst, ProcSubst, and BraceExp subtrees (the data-as-code
   *  positions where the parser is just capturing structure). */
  depth?: "any" | "top";
}

export function findCalls(
  ast: ShellFile,
  opts: ExtractCallOptions = {}
): CallExprNode[] {
  if (opts.depth !== "top") return findAll(ast, "CallExpr");
  const out: CallExprNode[] = [];
  walk(ast, {
    CallExpr(node) {
      out.push(node);
    },
    CmdSubst() {
      // Stop descent — anything inside $(…) / `…` is data-as-code.
      return "skip";
    },
    ProcSubst() {
      return "skip";
    },
    BraceExp() {
      return "skip";
    },
  });
  return out;
}

// ─── findRedirects + ops filter (BUG-006) ────────────────────────────────────

const WRITE_OPS: ReadonlySet<RedirectOp> = new Set<RedirectOp>([
  ">",
  ">>",
  ">|",
  "&>",
  "&>>",
]);
const READ_OPS: ReadonlySet<RedirectOp> = new Set<RedirectOp>([
  "<",
  "<<",
  "<<-",
  "<<<",
]);

export interface ExtractRedirectOptions {
  /** `"all"` (default), `"write"` (`>`/`>>`/`&>`/etc.), `"read"`
   *  (`<`/`<<`/`<<<`). Heredoc and here-string forms count as reads. */
  ops?: "all" | "write" | "read";
  /** `"any"` (default): every Redirect in the tree, including inside
   *  command substitutions and brace expansions.
   *  `"top"`: only redirects in the visible execution context — skips
   *  CmdSubst, ProcSubst, and BraceExp subtrees (parity with findCalls). */
  depth?: "any" | "top";
}

export function findRedirects(
  ast: ShellFile,
  opts: ExtractRedirectOptions = {}
): Redirect[] {
  const filter =
    opts.ops === "write"
      ? (r: Redirect) => WRITE_OPS.has(r.op)
      : opts.ops === "read"
        ? (r: Redirect) => READ_OPS.has(r.op)
        : null;
  if (opts.depth !== "top") {
    const all = findAll(ast, "Redirect");
    return filter ? all.filter(filter) : all;
  }
  const out: Redirect[] = [];
  walk(ast, {
    Redirect(node) {
      if (!filter || filter(node)) out.push(node);
    },
    CmdSubst() {
      return "skip";
    },
    ProcSubst() {
      return "skip";
    },
    BraceExp() {
      return "skip";
    },
  });
  return out;
}

// ─── findAssignments + exportedOnly filter (BUG-006) ─────────────────────────

const EXPORT_DECLS: ReadonlySet<string> = new Set([
  "export",
  "readonly",
  "declare",
  "typeset",
]);

export interface ExtractAssignmentOptions {
  /** When true, only return assignments inside `export`/`readonly`/
   *  `declare`/`typeset` DeclClauses. Skips bare `FOO=bar` and
   *  CallExpr-prefix `FOO=bar cmd` assigns. */
  exportedOnly?: boolean;
}

export function findAssignments(
  ast: ShellFile,
  opts: ExtractAssignmentOptions = {}
): Assign[] {
  if (!opts.exportedOnly) return findAll(ast, "Assign");
  const out: Assign[] = [];
  walk(ast, {
    DeclClause(node) {
      if (!EXPORT_DECLS.has(node.variant.value)) return;
      for (const a of node.args) out.push(a);
    },
  });
  return out;
}

// ─── findFunctions / findCmdSubstitutions — unchanged ────────────────────────

export function findFunctions(ast: ShellFile): FuncDecl[] {
  return findAll(ast, "FuncDecl");
}

export function findCmdSubstitutions(ast: ShellFile): CmdSubst[] {
  return findAll(ast, "CmdSubst");
}
