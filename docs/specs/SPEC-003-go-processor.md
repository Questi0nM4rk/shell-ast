# SPEC-003: Go Processor — Full AST Serializer

## Status: Draft
## Version: 1.0

---

## What sh-syntax Does (and Why It's Wrong)

The upstream `sh-syntax` processor has this in `processor/structs.go`:

```go
type Node struct {
  Pos NodePos `json:"Pos"`
  End NodePos `json:"End"`
}

type NodePos struct {
  Offset uint   `json:"Offset"`
  Line   uint   `json:"Line"`
  Col    uint   `json:"Col"`
}

func mapNode(node syntax.Node) Node {
  return Node{
    Pos: nodePos(node.Pos()),
    End: nodePos(node.End()),
  }
}
```

This is called on every node in the tree. The result: every `CallExpr`, `BinaryCmd`, `Word`, `Lit`, `Redirect` — all become `{Pos, End}`. The tree structure is preserved but the data is gone.

The `sh-syntax` use case is "where is this node in the source" — enough for syntax highlighting and error reporting. Not enough for semantic analysis.

---

## mvdan/sh AST Types

Full reference of `syntax.Node` types from `mvdan.cc/sh/v3/syntax`.
Source of truth: `mvdan.cc/sh/v3@v3.10.0/syntax/nodes.go`.

### Statement-Level

```go
type File struct {
  Name  string
  Stmts []*Stmt
  Last  []Comment
}

type Stmt struct {
  Comments   []Comment
  Cmd        Command      // interface: CallExpr, BinaryCmd, etc.
  Position   Pos
  Semicolon  Pos
  Negated    bool         // prepended !
  Background bool         // &
  Coprocess  bool         // mksh |&
  Redirs     []*Redirect
}

type Redirect struct {
  OpPos Pos
  Op    RedirOperator    // ">", ">>", "<", "<<", etc.
  N     *Lit             // fd number or {varname} in Bash
  Word  *Word            // target/source
  Hdoc  *Word            // heredoc body
}
```

### Command Types (implement `Command` interface)

```go
type CallExpr struct {
  Assigns []*Assign
  Args    []*Word
}

type BinaryCmd struct {
  OpPos Pos
  Op    BinCmdOperator   // &&, ||, |, |&
  X, Y  *Stmt
}

type IfClause struct {
  Position Pos            // position of "if", "elif", or "else" token
  ThenPos  Pos            // position of "then"; empty if this is an "else"
  FiPos    Pos            // position of "fi"; shared with .Else if non-nil
  Cond     []*Stmt
  CondLast []Comment
  Then     []*Stmt
  ThenLast []Comment
  Else     *IfClause     // non-nil for "elif" or "else" branch
  Last     []Comment     // comments on the first "elif", "else", or "fi"
}

// Note: there is no separate ElseClause type. "else" is represented as an
// IfClause with no Cond (ThenPos is zero) chained via Else.

type WhileClause struct {
  WhilePos, DoPos, DonePos Pos
  Until                    bool
  Cond                     []*Stmt
  CondLast                 []Comment
  Do                       []*Stmt
  DoLast                   []Comment
}

type ForClause struct {
  ForPos, DoPos, DonePos Pos
  Select                 bool
  Braces                 bool // deprecated { } form
  Loop                   Loop   // interface: *WordIter | *CStyleLoop
  Do                     []*Stmt
  DoLast                 []Comment
}

type CaseClause struct {
  Case, In, Esac Pos
  Braces         bool // deprecated mksh form
  Word           *Word
  Items          []*CaseItem
  Last           []Comment
}

type Block struct {
  Lbrace, Rbrace Pos
  Stmts          []*Stmt
  Last           []Comment
}

type Subshell struct {
  Lparen, Rparen Pos
  Stmts          []*Stmt
  Last           []Comment
}

type FuncDecl struct {
  Position Pos
  RsrvWord bool   // non-POSIX "function f" style
  Parens   bool   // with () — only meaningful when RsrvWord=true
  Name     *Lit
  Body     *Stmt
}

type ArithmCmd struct {
  Left, Right Pos
  Unsigned    bool  // mksh's ((# expr))
  X           ArithmExpr
}

type TestClause struct {
  Left, Right Pos
  X           TestExpr
}

type DeclClause struct {
  // Variant is one of: "declare", "local", "export", "readonly", "typeset", "nameref"
  Variant *Lit
  Args    []*Assign
}

type LetClause struct {
  Let   Pos
  Exprs []ArithmExpr
}

type TimeClause struct {
  Time        Pos
  PosixFormat bool   // -p flag
  Stmt        *Stmt
}

type CoprocClause struct {
  Coproc Pos
  Name   *Word   // optional name (a Word, not a Lit)
  Stmt   *Stmt
}

type TestDecl struct {
  Position    Pos
  Description *Word
  Body        *Stmt
}
```

### Word Parts (implement `WordPart` interface)

```go
type Lit struct {
  ValuePos, ValueEnd Pos
  Value              string
}

type SglQuoted struct {
  Left, Right Pos
  Dollar      bool    // $'...'
  Value       string
}

type DblQuoted struct {
  Left, Right Pos
  Dollar      bool    // $"..."
  Parts       []WordPart
}

type CmdSubst struct {
  Left, Right Pos
  Stmts       []*Stmt
  Last        []Comment
  Backquotes  bool  // deprecated `foo` form
  TempFile    bool  // mksh's ${ foo;}
  ReplyVar    bool  // mksh's ${|foo;}
}

type ParamExp struct {
  Dollar, Rbrace Pos
  Short          bool
  Excl           bool
  Length         bool
  Width          bool
  Param          *Lit
  Index          ArithmExpr      // ${a[i]}, ${a["k"]}
  Slice          *Slice          // ${a:x:y}
  Repl           *Replace        // ${a/x/y}
  Names          ParNamesOperator
  Exp            *Expansion      // ${a:-b}, ${a#b}, etc.
}

type ArithmExp struct {
  Left, Right Pos
  Bracket     bool  // deprecated $[expr] form
  Unsigned    bool  // mksh's $((# expr))
  X           ArithmExpr
}

type ProcSubst struct {
  OpPos, Rparen Pos
  Op            ProcOperator   // <( or >(
  Stmts         []*Stmt
  Last          []Comment
}

type ExtGlob struct {
  OpPos   Pos
  Op      GlobOperator   // ?(, *(, +(, @(, !(
  Pattern *Lit           // Note: *Lit, not *Word
}

type BraceExp struct {
  Sequence bool   // {x..y} range form
  Elems    []*Word
}
```

### Supporting Types

```go
type Word struct {
  Parts []WordPart
}

type Assign struct {
  Append bool       // +=
  Naked  bool       // without '='
  Name   *Lit       // must be a valid name
  Index  ArithmExpr // [i], ["k"]
  Value  *Word      // =val
  Array  *ArrayExpr // =(arr)
}

// Note: Assign has no Op field. Use Append bool to distinguish = vs +=.

type CaseItem struct {
  Op       CaseOperator
  OpPos    Pos
  Comments []Comment
  Patterns []*Word
  Stmts    []*Stmt
  Last     []Comment
}

type ArrayExpr struct {
  Lparen, Rparen Pos
  Elems          []*ArrayElem
  Last           []Comment
}

type ArrayElem struct {
  Index    ArithmExpr
  Value    *Word
  Comments []Comment
}

type Comment struct {
  Hash Pos
  Text string
}

// Loop interface: implemented by *WordIter and *CStyleLoop
type WordIter struct {
  Name  *Lit
  InPos Pos
  Items []*Word
}

type CStyleLoop struct {
  Lparen, Rparen Pos
  Init, Cond, Post ArithmExpr  // each may be nil
}

// ArithmExpr interface: implemented by *BinaryArithm, *UnaryArithm, *ParenArithm, *Word
// TestExpr interface:   implemented by *BinaryTest, *UnaryTest, *ParenTest, *Word
```

---

## Serializer Implementation

### Design Principles

1. Every serialized node includes `"type"` as a string discriminant
2. Position info (`pos`, `end`) always present — keeps compatibility with sh-syntax consumers
3. Operator fields serialized as their `.String()` value (human-readable, not int)
4. Nil pointers → JSON `null` (not omitted) so TypeScript types can be exact
5. Slices always present as arrays, never null (empty slice → `[]`)

### Complete Node Inventory

The following Go types require serializer functions:

**Command nodes** (16):
`CallExpr`, `BinaryCmd`, `IfClause`, `WhileClause`, `ForClause`, `CaseClause`,
`Block`, `Subshell`, `FuncDecl`, `ArithmCmd`, `TestClause`, `DeclClause`,
`LetClause`, `TimeClause`, `CoprocClause`, `TestDecl`

**Word part nodes** (9):
`Lit`, `SglQuoted`, `DblQuoted`, `CmdSubst`, `ParamExp`, `ArithmExp`,
`ProcSubst`, `ExtGlob`, `BraceExp`

**Supporting nodes** (11):
`File`, `Stmt`, `Redirect`, `Assign`, `Word`, `CaseItem`, `Comment`,
`ArrayExpr`, `ArrayElem`, `WordIter`, `CStyleLoop`

**Arithmetic expression nodes** (3, serialized inline):
`BinaryArithm`, `UnaryArithm`, `ParenArithm`
(Note: `*Word` also implements `ArithmExpr` — handled by existing `serializeWord`)

**Test expression nodes** (3, serialized inline):
`BinaryTest`, `UnaryTest`, `ParenTest`
(Note: `*Word` also implements `TestExpr`)

Total: ~42 serializer functions.

### Operator String Values

Operators are serialized as strings (via `.String()` method on the enum type):

```
BinCmdOperator: "&&", "||", "|", "|&"
RedirOperator:  ">", ">>", "<", "<>", "<&", ">&", ">|", "<<", "<<-", "<<<",
                "&>", "&>>"
ParNamesOp:     "*", "@"
GlobOperator:   "?(", "*(", "+(", "@(", "!("
ProcOperator:   "<(", ">("
CaseOperator:   ";;", ";&", ";;&", ";|"
```

Note on redirect operators: `&>` (redirect stdout+stderr) and `&>>` (append
stdout+stderr) are valid Bash operators. There is no `>>&` or `>|&` — those are
not real operators in `mvdan/sh` or the shell specifications.

---

## Test Strategy

Go unit tests in `processor/structs_test.go`.
The test file imports `strings` and `encoding/json` from stdlib; use
`github.com/stretchr/testify/assert` for assertions.

```go
package main

import (
  "encoding/json"
  "strings"
  "testing"

  "github.com/stretchr/testify/assert"
  "mvdan.cc/sh/v3/syntax"
)

func TestSerializeCallExpr(t *testing.T) {
  p := syntax.NewParser()
  f, _ := p.Parse(strings.NewReader("rm -rf /"), "")
  result := serializeFile(f)
  b, _ := json.Marshal(result)

  var parsed map[string]interface{}
  json.Unmarshal(b, &parsed)

  stmts := parsed["stmts"].([]interface{})
  stmt := stmts[0].(map[string]interface{})
  call := stmt["cmd"].(map[string]interface{})

  assert.Equal(t, "CallExpr", call["type"])
  args := call["args"].([]interface{})
  assert.Len(t, args, 3)

  arg0 := args[0].(map[string]interface{})
  parts := arg0["parts"].([]interface{})
  lit := parts[0].(map[string]interface{})
  assert.Equal(t, "Lit", lit["type"])
  assert.Equal(t, "rm", lit["value"])
}
```

Test cases to cover:
- Simple command: `echo hello`
- Flags: `rm -rf /`
- Pipeline: `cat /etc/passwd | grep root`
- Logical: `make && make test`
- Redirect: `echo foo > /tmp/out`
- Redirect stderr: `cmd 2>&1`
- Heredoc: `cat <<EOF`
- Command substitution: `$(date)`
- Process substitution: `diff <(ls a) <(ls b)`
- Arithmetic expansion: `echo $((x + 1))`
- Arithmetic command: `((x++))`
- Double-quoted: `"hello $name"`
- Sudo with flag-arg pairs: `sudo -u root rm -rf /`
- Nested subshells: `(cd /tmp && rm -rf *)`
- Function declaration: `foo() { echo bar; }`
- For loop: `for f in *.txt; do rm $f; done`
- Bash array: `arr=(a b c)`
- Test clause: `[[ -f foo && -d bar ]]`
