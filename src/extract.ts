// Walker-based extractors. Each finder runs walk() once and collects
// every matching node into an array, returned in source order.

import type {
  Assign,
  CallExprNode,
  CmdSubst,
  FuncDecl,
  Redirect,
  ShellFile,
  ShellNode,
} from "./types.js";
import { type Visitor, walk } from "./walk.js";

/** Return every node in the tree whose .type matches `type`. Typed
 *  via the discriminated-union extract: `findAll(ast, "CallExpr")`
 *  returns CallExprNode[], `findAll(ast, "Redirect")` returns
 *  Redirect[], etc. */
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

export const findCalls = (ast: ShellFile): CallExprNode[] => findAll(ast, "CallExpr");
export const findRedirects = (ast: ShellFile): Redirect[] => findAll(ast, "Redirect");
export const findAssignments = (ast: ShellFile): Assign[] => findAll(ast, "Assign");
export const findFunctions = (ast: ShellFile): FuncDecl[] => findAll(ast, "FuncDecl");
export const findCmdSubstitutions = (ast: ShellFile): CmdSubst[] =>
  findAll(ast, "CmdSubst");
