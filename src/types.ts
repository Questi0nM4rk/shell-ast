// src/types.ts — Full typed AST for mvdan/sh v3

export interface NodePos {
  offset: number;
  line: number;
  col: number;
}

// Every node carries source position
interface BaseNode {
  pos: NodePos;
  end: NodePos;
}

// ─── Top-Level ────────────────────────────────────────────────────────────────

export interface ShellFile extends BaseNode {
  type: "File";
  name: string;
  stmts: Stmt[];
  last: Comment[];
}

export interface Stmt extends BaseNode {
  type: "Stmt";
  cmd: Command | null;
  redirs: Redirect[];
  comments: Comment[];
  negated: boolean;
  background: boolean;
  coprocess: boolean;
}

export interface Redirect extends BaseNode {
  type: "Redirect";
  op: RedirectOp;
  n: LitNode | null; // fd number or {varname}, e.g. "2" in 2>&1
  word: Word;
  hdoc: Word | null;
}

export interface Word extends BaseNode {
  type: "Word";
  parts: WordPart[];
}

export interface Assign extends BaseNode {
  type: "Assign";
  name: LitNode | null;
  index: ArithmExpr | null;
  append: boolean; // true for +=, false for =
  naked: boolean; // true when there is no = at all
  value: Word | null;
  array: ArrayExpr | null;
}

export interface Comment extends BaseNode {
  type: "Comment";
  text: string;
}

// ─── Command Union ────────────────────────────────────────────────────────────

export type Command =
  | CallExprNode
  | BinaryCmd
  | IfClause
  | WhileClause
  | ForClause
  | CaseClause
  | Block
  | Subshell
  | FuncDecl
  | ArithmCmd
  | TestClause
  | DeclClause
  | LetClause
  | TimeClause
  | CoprocClause
  | TestDecl;

export interface CallExprNode extends BaseNode {
  type: "CallExpr";
  assigns: Assign[];
  args: Word[];
}

export interface BinaryCmd extends BaseNode {
  type: "BinaryCmd";
  op: BinCmdOp;
  x: Stmt;
  y: Stmt;
}

export interface IfClause extends BaseNode {
  type: "IfClause";
  cond: Stmt[]; // empty when this node represents an "else" branch
  condLast: Comment[];
  then: Stmt[];
  thenLast: Comment[];
  else: IfClause | null; // the "elif" or "else" continuation, if any
  last: Comment[];
}

// Note: there is no ElseClause type. An "else" branch is an IfClause with
// empty cond[]. Detect with: node.type === "IfClause" && node.cond.length === 0

export interface WhileClause extends BaseNode {
  type: "WhileClause";
  until: boolean;
  cond: Stmt[];
  condLast: Comment[];
  do: Stmt[];
  doLast: Comment[];
}

export interface ForClause extends BaseNode {
  type: "ForClause";
  select: boolean;
  loop: WordIter | CStyleLoop;
  do: Stmt[];
  doLast: Comment[];
}

export interface WordIter extends BaseNode {
  type: "WordIter";
  name: LitNode;
  items: Word[];
}

export interface CStyleLoop extends BaseNode {
  type: "CStyleLoop";
  init: ArithmExpr | null;
  cond: ArithmExpr | null;
  post: ArithmExpr | null;
}

export interface CaseClause extends BaseNode {
  type: "CaseClause";
  word: Word;
  items: CaseItem[];
  last: Comment[];
}

export interface CaseItem extends BaseNode {
  type: "CaseItem";
  patterns: Word[];
  stmts: Stmt[];
  comments: Comment[];
  last: Comment[];
  op: CaseOp;
}

export interface Block extends BaseNode {
  type: "Block";
  stmts: Stmt[];
  last: Comment[];
}

export interface Subshell extends BaseNode {
  type: "Subshell";
  stmts: Stmt[];
  last: Comment[];
}

export interface FuncDecl extends BaseNode {
  type: "FuncDecl";
  rsrvWord: boolean;
  parens: boolean;
  name: LitNode;
  body: Stmt;
}

export interface ArithmCmd extends BaseNode {
  type: "ArithmCmd";
  unsigned: boolean; // mksh's ((# expr))
  x: ArithmExpr;
}

export interface TestClause extends BaseNode {
  type: "TestClause";
  x: TestExpr;
}

export interface DeclClause extends BaseNode {
  type: "DeclClause";
  variant: LitNode; // "declare", "local", "export", "readonly", "typeset", "nameref"
  args: Assign[];
}

export interface LetClause extends BaseNode {
  type: "LetClause";
  exprs: ArithmExpr[];
}

export interface TimeClause extends BaseNode {
  type: "TimeClause";
  posixFormat: boolean;
  stmt: Stmt | null;
}

export interface CoprocClause extends BaseNode {
  type: "CoprocClause";
  name: Word | null; // a Word (not LitNode) — may contain expansions
  stmt: Stmt;
}

export interface TestDecl extends BaseNode {
  type: "TestDecl";
  description: Word;
  body: Stmt;
}

// ─── WordPart Union ───────────────────────────────────────────────────────────

export type WordPart =
  | LitNode
  | SglQuoted
  | DblQuoted
  | CmdSubst
  | ParamExp
  | ArithmExp
  | ProcSubst
  | ExtGlob
  | BraceExp;

export interface LitNode extends BaseNode {
  type: "Lit";
  value: string;
}

export interface SglQuoted extends BaseNode {
  type: "SglQuoted";
  dollar: boolean; // $'...'
  value: string;
}

export interface DblQuoted extends BaseNode {
  type: "DblQuoted";
  dollar: boolean; // $"..."
  parts: WordPart[];
}

export interface CmdSubst extends BaseNode {
  type: "CmdSubst";
  stmts: Stmt[];
  last: Comment[];
  backquotes: boolean; // deprecated `foo` form
  tempFile: boolean; // mksh's ${ foo;}
  replyVar: boolean; // mksh's ${|foo;}
}

export interface ParamExp extends BaseNode {
  type: "ParamExp";
  short: boolean;
  excl: boolean;
  length: boolean;
  width: boolean;
  param: LitNode | null;
  index: ArithmExpr | null;
  slice: Slice | null;
  repl: Replace | null;
  exp: Expansion | null;
  // mvdan/sh ParNamesOperator. "@" for ${!prefix@}, "*" for ${!prefix*},
  // "" for any other parameter expansion (most cases).
  names: "" | "@" | "*";
}

export interface ArithmExp extends BaseNode {
  type: "ArithmExp";
  unsigned: boolean;
  // true for $[expr] (deprecated bracket form); false for $((expr)).
  bracket: boolean;
  x: ArithmExpr;
}

export interface ProcSubst extends BaseNode {
  type: "ProcSubst";
  op: ProcOp;
  stmts: Stmt[];
  last: Comment[];
}

export interface ExtGlob extends BaseNode {
  type: "ExtGlob";
  op: GlobOp;
  pattern: LitNode; // Note: *Lit in Go, not *Word
}

export interface BraceExp extends BaseNode {
  type: "BraceExp";
  sequence: boolean; // {x..y} range form
  elems: Word[];
}

// ─── Arithmetic Expression Types ──────────────────────────────────────────────

// ArithmExpr: produced by $(( )), (( )), let, array indices, etc.
export type ArithmExpr = BinaryArithm | UnaryArithm | ParenArithm | Word;

export interface BinaryArithm extends BaseNode {
  type: "BinaryArithm";
  op: string; // e.g. "+", "-", "*", "/", "+=", "==", "?", ":"
  x: ArithmExpr;
  y: ArithmExpr;
}

export interface UnaryArithm extends BaseNode {
  type: "UnaryArithm";
  op: string; // e.g. "!", "~", "++", "--", "+", "-"
  post: boolean; // true if operator is postfix (x++ vs ++x)
  x: ArithmExpr;
}

export interface ParenArithm extends BaseNode {
  type: "ParenArithm";
  x: ArithmExpr;
}

// ─── Test Expression Types ────────────────────────────────────────────────────

// TestExpr: produced by [[ ]]
export type TestExpr = BinaryTest | UnaryTest | ParenTest | Word;

export interface BinaryTest extends BaseNode {
  type: "BinaryTest";
  op: string; // e.g. "==", "!=", "-eq", "-lt", "=~", "&&", "||"
  x: TestExpr;
  y: TestExpr;
}

export interface UnaryTest extends BaseNode {
  type: "UnaryTest";
  op: string; // e.g. "-f", "-d", "-z", "-n", "!"
  x: TestExpr;
}

export interface ParenTest extends BaseNode {
  type: "ParenTest";
  x: TestExpr;
}

// ─── Supporting Types ─────────────────────────────────────────────────────────

// Note: Slice, Replace, Expansion have no source positions in mvdan/sh.
export interface Slice {
  type: "Slice";
  offset: ArithmExpr;
  length: ArithmExpr | null;
}

export interface Replace {
  type: "Replace";
  all: boolean;
  orig: Word;
  with: Word | null;
}

export interface Expansion {
  type: "Expansion";
  op: string; // e.g. ":-", ":=", ":?", ":+", "#", "##", "%", "%%", "^", ","
  word: Word | null;
}

export interface ArrayExpr extends BaseNode {
  type: "ArrayExpr";
  elems: ArrayElem[];
  last: Comment[];
}

export interface ArrayElem extends BaseNode {
  type: "ArrayElem";
  index: ArithmExpr | null;
  value: Word | null;
  comments: Comment[];
}

// ─── Operator Literal Types ───────────────────────────────────────────────────

export type BinCmdOp = "&&" | "||" | "|" | "|&";

export type RedirectOp =
  | ">" // RdrOut
  | ">>" // AppOut
  | "<" // RdrIn
  | "<>" // RdrInOut
  | "<&" // DplIn
  | ">&" // DplOut
  | ">|" // ClbOut (clobber)
  | "<<" // Hdoc
  | "<<-" // DashHdoc
  | "<<<" // WordHdoc (here-string)
  | "&>" // RdrAll (redirect stdout+stderr)
  | "&>>"; // AppAll (append stdout+stderr)

export type CaseOp = ";;" | ";&" | ";;&" | ";|";

// GlobOperator order matches the Go const iota:
export type GlobOp = "?(" | "*(" | "+(" | "@(" | "!(";

export type ProcOp = "<(" | ">(";

// ─── Master Union ─────────────────────────────────────────────────────────────

export type ShellNode =
  | ShellFile
  | Stmt
  | Redirect
  | Word
  | Assign
  | Comment
  | Command
  | WordPart
  | ArithmExpr
  | TestExpr
  | CaseItem
  | WordIter
  | CStyleLoop
  | ArrayExpr
  | ArrayElem;
