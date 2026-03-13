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

Full reference of `syntax.Node` types from `mvdan.cc/sh/v3/syntax`:

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
  Op    RedirectOp   // ">", ">>", "<", "<<", etc.
  N     *Lit         // optional file descriptor number
  Word  *Word        // target/source
  Hdoc  *Word        // heredoc body
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
  IfPos, ThenPos, FiPos Pos
  Cond                  []*Stmt
  Then                  []*Stmt
  Elif                  []*IfClause
  Else                  *ElseClause
  Last                  []Comment
}

type WhileClause struct {
  WhilePos, DoPos, DonePos Pos
  Until                    bool
  Cond                     []*Stmt
  Do                       []*Stmt
  Last                     []Comment
}

type ForClause struct {
  ForPos, DoPos, DonePos Pos
  Select                 bool
  Loop                   Loop   // interface: WordIter | CStyleLoop
  Do                     []*Stmt
  Last                   []Comment
}

type CaseClause struct {
  Case, Esac Pos
  Last       []Comment
  Word       *Word
  Items      []*CaseItem
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
  RsrvWord bool
  Parens   bool
  Name     *Lit
  Body     *Stmt
}

type TimeClause struct {
  Time Pos
  PosixFormat bool
  Stmt *Stmt
}

type CoprocClause struct {
  Coproc Pos
  Name   *Lit
  Stmt   *Stmt
}

type LetClause struct {
  Let   Pos
  Exprs []ArithExpr
}

type DeclClause struct {
  Variant *Lit
  Opts    []*Word
  Assigns []*Assign
}

type TestClause struct {
  Left, Right Pos
  X           TestExpr
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
  Dollar      bool
  Value       string
}

type DblQuoted struct {
  Left, Right Pos
  Dollar      bool
  Parts       []WordPart
}

type CmdSubst struct {
  Left, Right    Pos
  Stmts          []*Stmt
  Last           []Comment
  RecentlyDefined bool  // $(<file) shorthand
}

type ParamExp struct {
  Dollar, Rbrace Pos
  Short          bool
  Excl           bool
  Length         bool
  Width          bool
  Param          *Lit
  Index          ArithExpr
  Slice          *Slice
  Repl           *Replace
  Names          ParNamesOperator
  Exp            *Expansion
}

type ArithExp struct {
  Left, Right Pos
  Unsigned    bool
  X           ArithExpr
}

type ProcSubst struct {
  OpPos, Rparen Pos
  Op            ProcOperator   // >( or <(
  Stmts         []*Stmt
  Last          []Comment
}

type ExtGlob struct {
  OpPos Pos
  Op    GlobOperator   // @(, *(, +(, ?(, !(
  Pattern *Word
}

type BraceExp struct {
  Sequence bool
  Elems    []*Word
}

type ArrayExpr struct {
  Lparen, Rparen Pos
  Elems          []*ArrayElem
  Last           []Comment
}
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

**Command nodes** (14):
`CallExpr`, `BinaryCmd`, `IfClause`, `WhileClause`, `ForClause`, `CaseClause`,
`Block`, `Subshell`, `FuncDecl`, `TimeClause`, `CoprocClause`, `LetClause`,
`DeclClause`, `TestClause`

**Word part nodes** (9):
`Lit`, `SglQuoted`, `DblQuoted`, `CmdSubst`, `ParamExp`, `ArithExp`,
`ProcSubst`, `ExtGlob`, `BraceExp`

**Supporting nodes** (8):
`File`, `Stmt`, `Redirect`, `Assign`, `Word`, `CaseItem`, `Comment`, `ArrayExpr`

Total: ~31 node types, each needing one function.

### Operator String Values

Operators are serialized as strings (via `.String()` method on the enum type):

```
BinCmdOperator: "&&", "||", "|", "|&"
RedirectOp:     ">", ">>", "<", "<<", "<<<", "<>", ">&", "<&", ">|&"
ParNamesOp:     "@A", "@a", "@k", "@K" (bash-specific)
GlobOperator:   "@(", "*(", "+(", "?(", "!("
ProcOperator:   "<(", ">("
TestOperator:   "-a", "-b", "-c", ... (30+ test operators)
```

---

## Test Strategy

Go unit tests in `processor/structs_test.go`:

```go
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
- Heredoc: `cat <<EOF`
- Command substitution: `$(date)`
- Process substitution: `diff <(ls a) <(ls b)`
- Arithmetic: `$((x + 1))`
- Double-quoted: `"hello $name"`
- Sudo with flag-arg pairs: `sudo -u root rm -rf /`
- Nested subshells: `(cd /tmp && rm -rf *)`
- Function declaration: `foo() { echo bar; }`
- For loop: `for f in *.txt; do rm $f; done`
