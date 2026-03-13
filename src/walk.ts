import type { ShellNode } from "./types.js";

export type Visitor = {
  // biome-ignore lint/suspicious/noConfusingVoidType: void needed for implicit-return visitors
  [K in ShellNode["type"]]?: (node: Extract<ShellNode, { type: K }>) => void | "skip";
};

export function walk(node: ShellNode, visitor: Visitor): void {
  const handler = visitor[node.type as ShellNode["type"]] as
    // biome-ignore lint/suspicious/noConfusingVoidType: void needed for implicit-return visitors
    ((n: ShellNode) => void | "skip") | undefined;

  if (handler) {
    const result = handler(node);
    if (result === "skip") return;
  }

  walkChildren(node, visitor);
}

function walkChildren(node: ShellNode, visitor: Visitor): void {
  switch (node.type) {
    case "File":
      for (const stmt of node.stmts) walk(stmt, visitor);
      break;
    case "Stmt":
      if (node.cmd) walk(node.cmd, visitor);
      for (const r of node.redirs) walk(r, visitor);
      break;
    case "CallExpr":
      for (const a of node.assigns) walk(a, visitor);
      for (const arg of node.args) walk(arg, visitor);
      break;
    case "BinaryCmd":
      walk(node.x, visitor);
      walk(node.y, visitor);
      break;
    case "IfClause":
      for (const s of node.cond) walk(s, visitor);
      for (const s of node.then) walk(s, visitor);
      if (node.else) walk(node.else, visitor);
      break;
    case "WhileClause":
      for (const s of node.cond) walk(s, visitor);
      for (const s of node.do) walk(s, visitor);
      break;
    case "ForClause":
      walk(node.loop, visitor);
      for (const s of node.do) walk(s, visitor);
      break;
    case "CaseClause":
      walk(node.word, visitor);
      for (const item of node.items) walk(item, visitor);
      break;
    case "CaseItem":
      for (const p of node.patterns) walk(p, visitor);
      for (const s of node.stmts) walk(s, visitor);
      break;
    case "Block":
    case "Subshell":
      for (const stmt of node.stmts) walk(stmt, visitor);
      break;
    case "FuncDecl":
      walk(node.body, visitor);
      break;
    case "ArithmCmd":
      walk(node.x, visitor);
      break;
    case "TestClause":
      walk(node.x, visitor);
      break;
    case "LetClause":
      for (const e of node.exprs) walk(e, visitor);
      break;
    case "TimeClause":
      if (node.stmt) walk(node.stmt, visitor);
      break;
    case "CoprocClause":
      walk(node.stmt, visitor);
      break;
    case "DeclClause":
      for (const a of node.args) walk(a, visitor);
      break;
    case "TestDecl":
      walk(node.body, visitor);
      break;
    case "Word":
      for (const part of node.parts) walk(part, visitor);
      break;
    case "DblQuoted":
      for (const part of node.parts) walk(part, visitor);
      break;
    case "CmdSubst":
      for (const stmt of node.stmts) walk(stmt, visitor);
      break;
    case "ProcSubst":
      for (const stmt of node.stmts) walk(stmt, visitor);
      break;
    case "Assign":
      if (node.value) walk(node.value, visitor);
      if (node.array) walk(node.array, visitor);
      break;
    case "ArrayExpr":
      for (const e of node.elems) walk(e, visitor);
      break;
    case "ArrayElem":
      if (node.value) walk(node.value, visitor);
      break;
    case "WordIter":
      for (const item of node.items) walk(item, visitor);
      break;
    case "BinaryArithm":
      walk(node.x, visitor);
      walk(node.y, visitor);
      break;
    case "UnaryArithm":
    case "ParenArithm":
      walk(node.x, visitor);
      break;
    case "BinaryTest":
      walk(node.x, visitor);
      walk(node.y, visitor);
      break;
    case "UnaryTest":
    case "ParenTest":
      walk(node.x, visitor);
      break;
    case "Redirect":
      walk(node.word, visitor);
      if (node.hdoc) walk(node.hdoc, visitor);
      break;
    // Leaf nodes: no children to walk
    case "Lit":
    case "SglQuoted":
    case "Comment":
    case "ExtGlob":
    case "BraceExp":
    case "ArithmExp":
    case "ParamExp":
    case "CStyleLoop":
      break;
  }
}
