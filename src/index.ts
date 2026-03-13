import type { ShellFile } from "./types.js";
import { loadWasm, parseRaw } from "./wasm.js";

export type { ResolvedCall } from "./helpers.js";
export { findCalls, resolveFlags, wordToLit } from "./helpers.js";
export type { UnwrappedCall } from "./semantic.js";
export { unwrapCall } from "./semantic.js";
export type {
  ArithmCmd,
  ArithmExp,
  ArithmExpr,
  ArrayElem,
  ArrayExpr,
  Assign,
  BinaryArithm,
  BinaryCmd,
  BinaryTest,
  BinCmdOp,
  Block,
  BraceExp,
  CallExprNode,
  CaseClause,
  CaseItem,
  CaseOp,
  CmdSubst,
  Command,
  Comment,
  CoprocClause,
  CStyleLoop,
  DblQuoted,
  DeclClause,
  Expansion,
  ExtGlob,
  ForClause,
  FuncDecl,
  GlobOp,
  IfClause,
  LetClause,
  LitNode,
  NodePos,
  ParamExp,
  ParenArithm,
  ParenTest,
  ProcOp,
  ProcSubst,
  Redirect,
  RedirectOp,
  Replace,
  SglQuoted,
  ShellFile,
  ShellNode,
  Slice,
  Stmt,
  Subshell,
  TestClause,
  TestDecl,
  TestExpr,
  TimeClause,
  UnaryArithm,
  UnaryTest,
  WhileClause,
  Word,
  WordIter,
  WordPart,
} from "./types.js";
export type { Visitor } from "./walk.js";
export { walk } from "./walk.js";

export async function parse(
  src: string,
  dialect: "bash" | "posix" | "mksh" = "bash"
): Promise<ShellFile> {
  await loadWasm();
  const json = parseRaw(src, dialect);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .error on Record<>
  if (parsed["error"]) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .error on Record<>
    throw new Error(String(parsed["error"]));
  }
  return parsed as unknown as ShellFile;
}
