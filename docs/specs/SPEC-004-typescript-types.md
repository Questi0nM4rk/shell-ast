# SPEC-004: TypeScript Types — Discriminated Union Design

## Status: Draft
## Version: 1.0

---

## Design Goals

1. Every node has a `type` string literal discriminant — enables exhaustive `switch`
2. Source positions are always present — keeps compatibility with position-based tooling
3. Operator fields are string literals (not numbers) — human-readable, `switch`-able
4. Arrays are never `null` — always `T[]` (may be empty)
5. Optional node references are `T | null` — explicit, no `undefined` ambiguity

---

## Core Types

```typescript
// src/types.ts

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
```

---

## Top-Level

```typescript
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
  n: LitNode | null;    // fd number or {varname}, e.g. "2" in 2>&1
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
  append: boolean;      // true for +=, false for =
  naked: boolean;       // true when there is no = at all
  value: Word | null;
  array: ArrayExpr | null;
}

export interface Comment extends BaseNode {
  type: "Comment";
  text: string;
}
```

---

## Command Union

```typescript
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
  op: BinCmdOp;   // "&&" | "||" | "|" | "|&"
  x: Stmt;
  y: Stmt;
}

export interface IfClause extends BaseNode {
  type: "IfClause";
  cond: Stmt[];         // empty when this node represents an "else" branch
  condLast: Comment[];
  then: Stmt[];
  thenLast: Comment[];
  else: IfClause | null; // the "elif" or "else" continuation, if any
  last: Comment[];
}

// Note: there is no ElseClause type. An "else" branch is an IfClause with
// empty cond[]. Detect it with: node.type === "IfClause" && node.cond.length === 0

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
  op: CaseOp;   // ";;", ";&", ";;&", ";|"
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
  unsigned: boolean;     // mksh's ((# expr))
  x: ArithmExpr;
}

export interface TestClause extends BaseNode {
  type: "TestClause";
  x: TestExpr;
}

export interface DeclClause extends BaseNode {
  type: "DeclClause";
  variant: LitNode;      // "declare", "local", "export", "readonly", "typeset", "nameref"
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
  name: Word | null;     // a Word (not LitNode) — may contain expansions
  stmt: Stmt;
}

export interface TestDecl extends BaseNode {
  type: "TestDecl";
  description: Word;
  body: Stmt;
}
```

---

## WordPart Union

```typescript
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
  dollar: boolean;   // $'...'
  value: string;
}

export interface DblQuoted extends BaseNode {
  type: "DblQuoted";
  dollar: boolean;   // $"..."
  parts: WordPart[];
}

export interface CmdSubst extends BaseNode {
  type: "CmdSubst";
  stmts: Stmt[];
  last: Comment[];
  backquotes: boolean;   // deprecated `foo` form
  tempFile: boolean;     // mksh's ${ foo;}
  replyVar: boolean;     // mksh's ${|foo;}
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
}

export interface ArithmExp extends BaseNode {
  type: "ArithmExp";
  unsigned: boolean;
  x: ArithmExpr;
}

export interface ProcSubst extends BaseNode {
  type: "ProcSubst";
  op: ProcOp;   // "<(" | ">("
  stmts: Stmt[];
  last: Comment[];
}

export interface ExtGlob extends BaseNode {
  type: "ExtGlob";
  op: GlobOp;   // "?(" | "*(" | "+(" | "@(" | "!("
  pattern: LitNode;    // Note: *Lit in Go, not *Word
}

export interface BraceExp extends BaseNode {
  type: "BraceExp";
  sequence: boolean;   // {x..y} range form
  elems: Word[];
}
```

---

## Arithmetic and Test Expression Types

`ArithmExpr` and `TestExpr` are interface types in Go. They are serialized as
discriminated unions in TypeScript:

```typescript
// ArithmExpr: produced by $(( )), (( )), let, array indices, etc.
export type ArithmExpr =
  | BinaryArithm
  | UnaryArithm
  | ParenArithm
  | Word;   // a name or literal used as an arithmetic operand

export interface BinaryArithm extends BaseNode {
  type: "BinaryArithm";
  op: string;    // e.g. "+", "-", "*", "/", "+=", "==", "?", ":"
  x: ArithmExpr;
  y: ArithmExpr;
}

export interface UnaryArithm extends BaseNode {
  type: "UnaryArithm";
  op: string;    // e.g. "!", "~", "++", "--", "+", "-"
  post: boolean; // true if operator is postfix (x++ vs ++x)
  x: ArithmExpr;
}

export interface ParenArithm extends BaseNode {
  type: "ParenArithm";
  x: ArithmExpr;
}

// TestExpr: produced by [[ ]]
export type TestExpr =
  | BinaryTest
  | UnaryTest
  | ParenTest
  | Word;   // a literal string operand in a test expression

export interface BinaryTest extends BaseNode {
  type: "BinaryTest";
  op: string;    // e.g. "==", "!=", "-eq", "-lt", "=~", "&&", "||"
  x: TestExpr;
  y: TestExpr;
}

export interface UnaryTest extends BaseNode {
  type: "UnaryTest";
  op: string;    // e.g. "-f", "-d", "-z", "-n", "!"
  x: TestExpr;
}

export interface ParenTest extends BaseNode {
  type: "ParenTest";
  x: TestExpr;
}
```

---

## Supporting Types

```typescript
export interface Slice extends BaseNode {
  type: "Slice";
  offset: ArithmExpr;
  length: ArithmExpr | null;
}

export interface Replace extends BaseNode {
  type: "Replace";
  all: boolean;
  orig: Word;
  with: Word | null;
}

export interface Expansion extends BaseNode {
  type: "Expansion";
  op: string;    // e.g. ":-", ":=", ":?", ":+", "#", "##", "%", "%%", "^", ","
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
```

---

## Operator Literal Types

```typescript
export type BinCmdOp = "&&" | "||" | "|" | "|&";

// RedirOperator string values from mvdan/sh's .String() method:
export type RedirectOp =
  | ">"    // RdrOut
  | ">>"   // AppOut
  | "<"    // RdrIn
  | "<>"   // RdrInOut
  | "<&"   // DplIn
  | ">&"   // DplOut
  | ">|"   // ClbOut (clobber)
  | "<<"   // Hdoc
  | "<<-"  // DashHdoc
  | "<<<"  // WordHdoc (here-string)
  | "&>"   // RdrAll (redirect stdout+stderr)
  | "&>>"; // AppAll (append stdout+stderr)

export type CaseOp = ";;" | ";&" | ";;&" | ";|";

// GlobOperator order matches the Go const iota:
export type GlobOp = "?(" | "*(" | "+(" | "@(" | "!(";

export type ProcOp = "<(" | ">(";
```

---

## Master Union

```typescript
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
  | Slice
  | Replace
  | Expansion
  | ArrayExpr
  | ArrayElem;
```

---

## Helper Types (`src/helpers.ts`)

```typescript
import type { ShellFile, CallExprNode, Word, LitNode } from "./types.js";
import { walk } from "./walk.js";

export interface ResolvedCall {
  cmd: string;       // first argument value, e.g. "rm"
  flags: string[];   // all "-x" and "--foo" arguments
  args: string[];    // non-flag arguments
  raw: CallExprNode; // original AST node
}

export function findCalls(ast: ShellFile): CallExprNode[] {
  const calls: CallExprNode[] = [];
  walk(ast, {
    CallExpr(node) { calls.push(node); },
  });
  return calls;
}

// wordToLit extracts the string value from a single-Lit Word, or returns null
// if the word contains expansions or multiple parts that can't be statically resolved.
function wordToLit(w: Word): string | null {
  if (w.parts.length === 1 && w.parts[0]!.type === "Lit") {
    return (w.parts[0] as LitNode).value;
  }
  return null;
}

export function resolveFlags(call: CallExprNode): ResolvedCall | null {
  if (call.args.length === 0) return null;

  const firstLit = wordToLit(call.args[0]!);
  if (firstLit === null) return null;

  const flags: string[] = [];
  const args: string[] = [];
  let endOfFlags = false;

  for (const word of call.args.slice(1)) {
    const lit = wordToLit(word);
    if (lit === null) { args.push("<dynamic>"); continue; }
    if (lit === "--") { endOfFlags = true; continue; }
    if (!endOfFlags && lit.startsWith("-")) {
      // Expand combined short flags: -rf → ["-r", "-f"]
      if (lit.length > 2 && !lit.startsWith("--")) {
        for (const ch of lit.slice(1)) flags.push(`-${ch}`);
      } else {
        flags.push(lit);
      }
    } else {
      args.push(lit);
    }
  }

  return { cmd: firstLit, flags, args, raw: call };
}
```

---

## Walk API (`src/walk.ts`)

```typescript
import type { ShellNode } from "./types.js";

export type Visitor = {
  [K in ShellNode["type"]]?: (node: Extract<ShellNode, { type: K }>) => void | "skip";
};

export function walk(node: ShellNode, visitor: Visitor): void {
  const handler = visitor[node.type as ShellNode["type"]] as
    | ((n: ShellNode) => void | "skip")
    | undefined;

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
      for (const arg of node.args) walk(arg, visitor);
      break;
    case "BinaryCmd":
      walk(node.x, visitor);
      walk(node.y, visitor);
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
    case "Subshell":
    case "Block":
      for (const stmt of node.stmts) walk(stmt, visitor);
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
    case "FuncDecl":
      walk(node.body, visitor);
      break;
    case "CaseClause":
      walk(node.word, visitor);
      for (const item of node.items) walk(item, visitor);
      break;
    case "CaseItem":
      for (const p of node.patterns) walk(p, visitor);
      for (const s of node.stmts) walk(s, visitor);
      break;
    case "ArithmCmd":
      walk(node.x, visitor);
      break;
    case "TestClause":
      walk(node.x, visitor);
      break;
    case "ProcSubst":
      for (const stmt of node.stmts) walk(stmt, visitor);
      break;
  }
}
```
