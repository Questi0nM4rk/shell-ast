// Shared AST-node factories for synthetic tests that don't go through
// `parse()`. Real-parse tests should keep using `parse()` directly.

import type {
  CallExprNode,
  LitNode,
  NodePos,
  ShellFile,
  Stmt,
  Word,
} from "../src/types.js";

export function makePos(offset = 0, line = 1, col = 1): NodePos {
  return { offset, line, col };
}

export function makeLit(value: string): LitNode {
  return { type: "Lit", value, pos: makePos(), end: makePos() };
}

export function makeWord(...lits: string[]): Word {
  return {
    type: "Word",
    parts: lits.map(makeLit),
    pos: makePos(),
    end: makePos(),
  };
}

export function makeCall(...args: string[]): CallExprNode {
  return {
    type: "CallExpr",
    assigns: [],
    args: args.map((a) => makeWord(a)),
    pos: makePos(),
    end: makePos(),
  };
}

export function makeStmt(cmd: CallExprNode): Stmt {
  return {
    type: "Stmt",
    cmd,
    redirs: [],
    comments: [],
    negated: false,
    background: false,
    coprocess: false,
    pos: makePos(),
    end: makePos(),
  };
}

export function makeFile(...calls: CallExprNode[]): ShellFile {
  return {
    type: "File",
    name: "",
    stmts: calls.map(makeStmt),
    last: [],
    pos: makePos(),
    end: makePos(),
  };
}
