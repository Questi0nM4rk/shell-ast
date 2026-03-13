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
  n: LitNode | null;    // fd number, e.g. "2" in 2>&1
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
  index: ArithExpr | null;
  op: AssignOp;         // "=", "+=", etc.
  value: Word | null;
  array: ArrayExpr | null;
  naked: boolean;
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
  | TimeClause
  | CoprocClause
  | LetClause
  | DeclClause
  | TestClause;

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
  cond: Stmt[];
  then: Stmt[];
  elif: IfClause[];
  else: ElseClause | null;
  last: Comment[];
}

export interface ElseClause extends BaseNode {
  type: "ElseClause";
  then: Stmt[];
  last: Comment[];
}

export interface WhileClause extends BaseNode {
  type: "WhileClause";
  until: boolean;
  cond: Stmt[];
  do: Stmt[];
  last: Comment[];
}

export interface ForClause extends BaseNode {
  type: "ForClause";
  select: boolean;
  loop: WordIter | CStyleLoop;
  do: Stmt[];
  last: Comment[];
}

export interface WordIter extends BaseNode {
  type: "WordIter";
  name: LitNode;
  items: Word[];
}

export interface CStyleLoop extends BaseNode {
  type: "CStyleLoop";
  init: ArithExpr | null;
  cond: ArithExpr | null;
  post: ArithExpr | null;
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
  last: Comment[];
  op: CaseOp;   // ";;", ";&", ";;&"
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

export interface TimeClause extends BaseNode {
  type: "TimeClause";
  posixFormat: boolean;
  stmt: Stmt | null;
}

export interface CoprocClause extends BaseNode {
  type: "CoprocClause";
  name: LitNode | null;
  stmt: Stmt;
}

export interface LetClause extends BaseNode {
  type: "LetClause";
  exprs: ArithExpr[];
}

export interface DeclClause extends BaseNode {
  type: "DeclClause";
  variant: LitNode;
  opts: Word[];
  assigns: Assign[];
}

export interface TestClause extends BaseNode {
  type: "TestClause";
  x: TestExpr;
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
  | ArithExp
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
  recentlyDefined: boolean;  // $(<file) shorthand
}

export interface ParamExp extends BaseNode {
  type: "ParamExp";
  short: boolean;
  excl: boolean;
  length: boolean;
  width: boolean;
  param: LitNode | null;
  index: ArithExpr | null;
  slice: Slice | null;
  repl: Replace | null;
  exp: Expansion | null;
}

export interface ArithExp extends BaseNode {
  type: "ArithExp";
  unsigned: boolean;
  x: ArithExpr;
}

export interface ProcSubst extends BaseNode {
  type: "ProcSubst";
  op: ProcOp;   // "<(" | ">("
  stmts: Stmt[];
  last: Comment[];
}

export interface ExtGlob extends BaseNode {
  type: "ExtGlob";
  op: GlobOp;   // "@(" | "*(" | "+(" | "?(" | "!("
  pattern: Word;
}

export interface BraceExp extends BaseNode {
  type: "BraceExp";
  sequence: boolean;
  elems: Word[];
}
```

---

## Operator Literal Types

```typescript
export type BinCmdOp = "&&" | "||" | "|" | "|&";

export type RedirectOp =
  | ">" | ">>" | "<" | "<<" | "<<<" | "<>"
  | ">&" | "<&" | ">|" | ">>&" | ">>|&"
  | "<<-";

export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=";

export type CaseOp = ";;" | ";&" | ";;&";

export type GlobOp = "@(" | "*(" | "+(" | "?(" | "!(";

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
  | ElseClause
  | CaseItem
  | WordIter
  | CStyleLoop;
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

export function resolveFlags(call: CallExprNode): ResolvedCall | null {
  if (call.args.length === 0) return null;

  const wordToLit = (w: Word): string | null => {
    if (w.parts.length === 1 && w.parts[0]!.type === "Lit") {
      return (w.parts[0] as LitNode).value;
    }
    return null; // expansion — can't statically resolve
  };

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
      for (const e of node.elif) walk(e, visitor);
      if (node.else) walk(node.else, visitor);
      break;
    case "WhileClause":
      for (const s of node.cond) walk(s, visitor);
      for (const s of node.do) walk(s, visitor);
      break;
    case "ForClause":
      for (const s of node.do) walk(s, visitor);
      break;
    case "FuncDecl":
      walk(node.body, visitor);
      break;
  }
}
```
