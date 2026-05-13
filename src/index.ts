import type { ShellFile } from "./types.js";
import { loadWasm, parseRaw } from "./wasm.js";

export {
  findAssignments,
  findCalls,
  findCmdSubstitutions,
  findFunctions,
  findRedirects,
} from "./extract.js";
export type { ResolvedArg, ResolvedCall } from "./flags.js";
export { DYNAMIC, resolveFlags, wordToLit } from "./flags.js";
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

export interface ParseOptions {
  /** Reject inputs whose UTF-8 byte length exceeds this cap.
   *  Defaults to 1_000_000 (1 MB). Pass Infinity to disable. */
  maxBytes?: number;
  /** Apply mvdan/sh's SplitBraces post-pass so `{a,b,c}` becomes a
   *  BraceExp node instead of a literal. Default false (matches the
   *  parser's default — brace expansion is a runtime concept). */
  splitBraces?: boolean;
}

const DEFAULT_MAX_BYTES = 1_000_000;

export async function parse(
  src: string,
  dialect: "bash" | "posix" | "mksh" = "bash",
  options: ParseOptions = {}
): Promise<ShellFile> {
  // Strip a leading UTF-8 BOM. mvdan/sh treats the BOM as part of the
  // first token, producing unresolvable command names like "﻿echo".
  // Files exported from Windows tooling frequently carry one.
  if (src.charCodeAt(0) === 0xfeff) {
    src = src.slice(1);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const bytes = Buffer.byteLength(src, "utf8");
  if (bytes > maxBytes) {
    throw new Error(
      `shell-ast: input size ${bytes} bytes exceeds maxBytes ${maxBytes}`
    );
  }

  await loadWasm();
  const json = parseRaw(src, dialect, options.splitBraces);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .error on Record<>
  if (parsed["error"]) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .error on Record<>
    throw new Error(String(parsed["error"]));
  }
  return parsed as unknown as ShellFile;
}
