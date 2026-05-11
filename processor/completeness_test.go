// Schema completeness test (audit E4).
//
// For each concrete syntax.* type we serialize, this file pairs a
// real-shell fixture with a navigator (extracts the typed instance
// from the parsed File) and the EXACT set of JSON keys the
// serializer is expected to emit.
//
// What this catches:
//   - mvdan/sh adds a field to a type (we silently drop it) — test
//     fails with "unexpected: <key>" or our schema is incomplete
//   - our serializer forgets a field — test fails with "missing: <key>"
//   - a key is renamed in either direction — test fails
//
// This is the regression check the audit identified as the root-cause
// fix for A4 (ParamExp.names / ArithmExp.bracket drift).

package main

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"mvdan.cc/sh/v3/syntax"
)

// schemaCase is one (type, fixture, expected-keys) row in the schema lock.
type schemaCase struct {
	typeName     string
	fixture      string
	locate       func(*syntax.File) interface{}
	expectedKeys []string
	splitBraces  bool // apply syntax.SplitBraces post-parse (for BraceExp)
}

// posEnd are the keys every Node carries via withPos.
var posEnd = []string{"pos", "end"}

func merge(a []string, b ...string) []string {
	out := make([]string, 0, len(a)+len(b))
	out = append(out, a...)
	out = append(out, b...)
	return out
}

// Navigators for the schemaCases. Each starts from `f.Stmts[0].Cmd`
// (the top-level command of the fixture) and drills down. They use
// inline type assertions; if mvdan/sh reshapes the AST, these panic
// loudly, which is exactly what we want from a schema-lock test.

func navFile(f *syntax.File) interface{}   { return serializeFile(f) }
func navStmt(f *syntax.File) interface{}   { return serializeStmt(f.Stmts[0]) }
func navRedir(f *syntax.File) interface{}  { return serializeRedirect(f.Stmts[0].Redirs[0]) }
func navAssign(f *syntax.File) interface{} { return serializeAssign(f.Stmts[0].Cmd.(*syntax.CallExpr).Assigns[0]) }
func navCallExpr(f *syntax.File) interface{} {
	return serializeCallExpr(f.Stmts[0].Cmd.(*syntax.CallExpr))
}
func navBinaryCmd(f *syntax.File) interface{} {
	return serializeBinaryCmd(f.Stmts[0].Cmd.(*syntax.BinaryCmd))
}
func navIfClause(f *syntax.File) interface{} {
	return serializeIfClause(f.Stmts[0].Cmd.(*syntax.IfClause))
}
func navWhileClause(f *syntax.File) interface{} {
	return serializeWhileClause(f.Stmts[0].Cmd.(*syntax.WhileClause))
}
func navForClause(f *syntax.File) interface{} {
	return serializeForClause(f.Stmts[0].Cmd.(*syntax.ForClause))
}
func navCaseClause(f *syntax.File) interface{} {
	return serializeCaseClause(f.Stmts[0].Cmd.(*syntax.CaseClause))
}
func navCaseItem(f *syntax.File) interface{} {
	return serializeCaseItem(f.Stmts[0].Cmd.(*syntax.CaseClause).Items[0])
}
func navBlock(f *syntax.File) interface{} {
	return serializeBlock(f.Stmts[0].Cmd.(*syntax.Block))
}
func navSubshell(f *syntax.File) interface{} {
	return serializeSubshell(f.Stmts[0].Cmd.(*syntax.Subshell))
}
func navFuncDecl(f *syntax.File) interface{} {
	return serializeFuncDecl(f.Stmts[0].Cmd.(*syntax.FuncDecl))
}
func navArithmCmd(f *syntax.File) interface{} {
	return serializeArithmCmd(f.Stmts[0].Cmd.(*syntax.ArithmCmd))
}
func navTestClause(f *syntax.File) interface{} {
	return serializeTestClause(f.Stmts[0].Cmd.(*syntax.TestClause))
}
func navDeclClause(f *syntax.File) interface{} {
	return serializeDeclClause(f.Stmts[0].Cmd.(*syntax.DeclClause))
}
func navLetClause(f *syntax.File) interface{} {
	return serializeLetClause(f.Stmts[0].Cmd.(*syntax.LetClause))
}
func navTimeClause(f *syntax.File) interface{} {
	return serializeTimeClause(f.Stmts[0].Cmd.(*syntax.TimeClause))
}
func navCoprocClause(f *syntax.File) interface{} {
	return serializeCoprocClause(f.Stmts[0].Cmd.(*syntax.CoprocClause))
}
func navWord(f *syntax.File) interface{} {
	return serializeWord(f.Stmts[0].Cmd.(*syntax.CallExpr).Args[0])
}

// Word-part navigators: each parses `echo X` and pulls Parts[0] of the second arg.
func wordPartAt(f *syntax.File) syntax.WordPart {
	return f.Stmts[0].Cmd.(*syntax.CallExpr).Args[1].Parts[0]
}
func navLit(f *syntax.File) interface{}       { return serializeLit(wordPartAt(f).(*syntax.Lit)) }
func navSglQuoted(f *syntax.File) interface{} { return serializeSglQuoted(wordPartAt(f).(*syntax.SglQuoted)) }
func navDblQuoted(f *syntax.File) interface{} { return serializeDblQuoted(wordPartAt(f).(*syntax.DblQuoted)) }
func navCmdSubst(f *syntax.File) interface{}  { return serializeCmdSubst(wordPartAt(f).(*syntax.CmdSubst)) }
func navParamExp(f *syntax.File) interface{} {
	return serializeParamExp(wordPartAt(f).(*syntax.DblQuoted).Parts[0].(*syntax.ParamExp))
}
func navArithmExp(f *syntax.File) interface{} { return serializeArithmExp(wordPartAt(f).(*syntax.ArithmExp)) }
func navProcSubst(f *syntax.File) interface{} { return serializeProcSubst(wordPartAt(f).(*syntax.ProcSubst)) }
func navExtGlob(f *syntax.File) interface{}   { return serializeExtGlob(wordPartAt(f).(*syntax.ExtGlob)) }
func navBraceExp(f *syntax.File) interface{}  { return serializeBraceExp(wordPartAt(f).(*syntax.BraceExp)) }

// Arithmetic / test nodes inside $((...)) and [[ ... ]] containers.
func navBinaryArithm(f *syntax.File) interface{} {
	return serializeBinaryArithm(wordPartAt(f).(*syntax.ArithmExp).X.(*syntax.BinaryArithm))
}
func navUnaryArithm(f *syntax.File) interface{} {
	return serializeUnaryArithm(wordPartAt(f).(*syntax.ArithmExp).X.(*syntax.UnaryArithm))
}
func navParenArithm(f *syntax.File) interface{} {
	return serializeParenArithm(wordPartAt(f).(*syntax.ArithmExp).X.(*syntax.ParenArithm))
}
func navBinaryTest(f *syntax.File) interface{} {
	return serializeBinaryTest(f.Stmts[0].Cmd.(*syntax.TestClause).X.(*syntax.BinaryTest))
}
func navUnaryTest(f *syntax.File) interface{} {
	return serializeUnaryTest(f.Stmts[0].Cmd.(*syntax.TestClause).X.(*syntax.UnaryTest))
}
func navParenTest(f *syntax.File) interface{} {
	return serializeParenTest(f.Stmts[0].Cmd.(*syntax.TestClause).X.(*syntax.ParenTest))
}

// Supporting (non-Node) leaves: ArrayExpr, ArrayElem, WordIter, CStyleLoop, Slice, Replace, Expansion.
func navArrayExpr(f *syntax.File) interface{} {
	return serializeArrayExpr(f.Stmts[0].Cmd.(*syntax.CallExpr).Assigns[0].Array)
}
func navArrayElem(f *syntax.File) interface{} {
	return serializeArrayElem(f.Stmts[0].Cmd.(*syntax.CallExpr).Assigns[0].Array.Elems[0])
}
func navWordIter(f *syntax.File) interface{} {
	return serializeWordIter(f.Stmts[0].Cmd.(*syntax.ForClause).Loop.(*syntax.WordIter))
}
func navCStyleLoop(f *syntax.File) interface{} {
	return serializeCStyleLoop(f.Stmts[0].Cmd.(*syntax.ForClause).Loop.(*syntax.CStyleLoop))
}
func navSlice(f *syntax.File) interface{} {
	return serializeSlice(wordPartAt(f).(*syntax.DblQuoted).Parts[0].(*syntax.ParamExp).Slice)
}
func navReplace(f *syntax.File) interface{} {
	return serializeReplace(wordPartAt(f).(*syntax.DblQuoted).Parts[0].(*syntax.ParamExp).Repl)
}
func navExpansion(f *syntax.File) interface{} {
	return serializeExpansion(wordPartAt(f).(*syntax.DblQuoted).Parts[0].(*syntax.ParamExp).Exp)
}
func navComment(f *syntax.File) interface{} {
	return serializeComment(f.Last[0])
}

// Schema. One row per type. expectedKeys MUST include every JSON
// key the serializer emits — adding a key without updating this row
// fails the test (unexpected key), and removing one fails it too
// (missing key).
var schemaCases = []schemaCase{
	// Framing
	{typeName: "File", fixture: "echo hi", locate: navFile, expectedKeys: merge([]string{"type", "name", "stmts", "last"}, posEnd...)},
	{typeName: "Stmt", fixture: "echo hi", locate: navStmt, expectedKeys: merge([]string{"type", "cmd", "redirs", "comments", "negated", "background", "coprocess"}, posEnd...)},
	{typeName: "Redirect", fixture: "echo > /tmp/x", locate: navRedir, expectedKeys: merge([]string{"type", "op", "word", "hdoc", "n"}, posEnd...)},
	{typeName: "Word", fixture: "echo hi", locate: navWord, expectedKeys: merge([]string{"type", "parts"}, posEnd...)},
	{typeName: "Assign", fixture: "FOO=bar rm", locate: navAssign, expectedKeys: merge([]string{"type", "name", "index", "append", "naked", "value", "array"}, posEnd...)},
	{typeName: "Comment", fixture: "echo hi\n# tail comment", locate: navComment, expectedKeys: []string{"type", "text", "pos", "end"}},

	// Commands
	{typeName: "CallExpr", fixture: "echo hi", locate: navCallExpr, expectedKeys: merge([]string{"type", "assigns", "args"}, posEnd...)},
	{typeName: "BinaryCmd", fixture: "echo a && echo b", locate: navBinaryCmd, expectedKeys: merge([]string{"type", "op", "x", "y"}, posEnd...)},
	{typeName: "IfClause", fixture: "if true; then echo; fi", locate: navIfClause, expectedKeys: merge([]string{"type", "cond", "condLast", "then", "thenLast", "else", "last"}, posEnd...)},
	{typeName: "WhileClause", fixture: "while :; do break; done", locate: navWhileClause, expectedKeys: merge([]string{"type", "until", "cond", "condLast", "do", "doLast"}, posEnd...)},
	{typeName: "ForClause", fixture: "for f in *; do echo; done", locate: navForClause, expectedKeys: merge([]string{"type", "select", "loop", "do", "doLast"}, posEnd...)},
	{typeName: "CaseClause", fixture: "case x in y) echo;; esac", locate: navCaseClause, expectedKeys: merge([]string{"type", "word", "items", "last"}, posEnd...)},
	{typeName: "CaseItem", fixture: "case x in y) echo;; esac", locate: navCaseItem, expectedKeys: merge([]string{"type", "op", "patterns", "stmts", "comments", "last"}, posEnd...)},
	{typeName: "Block", fixture: "{ echo; }", locate: navBlock, expectedKeys: merge([]string{"type", "stmts", "last"}, posEnd...)},
	{typeName: "Subshell", fixture: "(echo)", locate: navSubshell, expectedKeys: merge([]string{"type", "stmts", "last"}, posEnd...)},
	{typeName: "FuncDecl", fixture: "foo() { :; }", locate: navFuncDecl, expectedKeys: merge([]string{"type", "rsrvWord", "parens", "name", "body"}, posEnd...)},
	{typeName: "ArithmCmd", fixture: "((x++))", locate: navArithmCmd, expectedKeys: merge([]string{"type", "unsigned", "x"}, posEnd...)},
	{typeName: "TestClause", fixture: "[[ -f x ]]", locate: navTestClause, expectedKeys: merge([]string{"type", "x"}, posEnd...)},
	{typeName: "DeclClause", fixture: "declare -a arr", locate: navDeclClause, expectedKeys: merge([]string{"type", "variant", "args"}, posEnd...)},
	{typeName: "LetClause", fixture: "let x=1+2", locate: navLetClause, expectedKeys: merge([]string{"type", "exprs"}, posEnd...)},
	{typeName: "TimeClause", fixture: "time ls", locate: navTimeClause, expectedKeys: merge([]string{"type", "posixFormat", "stmt"}, posEnd...)},
	{typeName: "CoprocClause", fixture: "coproc cat", locate: navCoprocClause, expectedKeys: merge([]string{"type", "name", "stmt"}, posEnd...)},

	// Word parts
	{typeName: "Lit", fixture: "echo hi", locate: navLit, expectedKeys: []string{"type", "value", "pos", "end"}},
	{typeName: "SglQuoted", fixture: "echo 'x'", locate: navSglQuoted, expectedKeys: merge([]string{"type", "dollar", "value"}, posEnd...)},
	{typeName: "DblQuoted", fixture: `echo "x $y"`, locate: navDblQuoted, expectedKeys: merge([]string{"type", "dollar", "parts"}, posEnd...)},
	{typeName: "CmdSubst", fixture: "echo $(date)", locate: navCmdSubst, expectedKeys: merge([]string{"type", "stmts", "last", "backquotes", "tempFile", "replyVar"}, posEnd...)},
	{typeName: "ParamExp", fixture: `echo "${var/old/new:1:3}"`, locate: navParamExp, expectedKeys: merge([]string{"type", "short", "excl", "length", "width", "param", "index", "slice", "repl", "names", "exp"}, posEnd...)},
	{typeName: "ArithmExp", fixture: "echo $((1+2))", locate: navArithmExp, expectedKeys: merge([]string{"type", "bracket", "unsigned", "x"}, posEnd...)},
	{typeName: "ProcSubst", fixture: "echo <(ls)", locate: navProcSubst, expectedKeys: merge([]string{"type", "op", "stmts", "last"}, posEnd...)},
	{typeName: "ExtGlob", fixture: "echo @(a|b)", locate: navExtGlob, expectedKeys: merge([]string{"type", "op", "pattern"}, posEnd...)},
	{typeName: "BraceExp", fixture: "echo {a,b,c}", locate: navBraceExp, splitBraces: true, expectedKeys: merge([]string{"type", "sequence", "elems"}, posEnd...)},

	// Arithmetic
	{typeName: "BinaryArithm", fixture: "echo $((1+2))", locate: navBinaryArithm, expectedKeys: merge([]string{"type", "op", "x", "y"}, posEnd...)},
	{typeName: "UnaryArithm", fixture: "echo $((-x))", locate: navUnaryArithm, expectedKeys: merge([]string{"type", "op", "post", "x"}, posEnd...)},
	{typeName: "ParenArithm", fixture: "echo $(((1+2)))", locate: navParenArithm, expectedKeys: merge([]string{"type", "x"}, posEnd...)},

	// Test
	{typeName: "BinaryTest", fixture: "[[ -f x && -d y ]]", locate: navBinaryTest, expectedKeys: merge([]string{"type", "op", "x", "y"}, posEnd...)},
	{typeName: "UnaryTest", fixture: "[[ -f x ]]", locate: navUnaryTest, expectedKeys: merge([]string{"type", "op", "x"}, posEnd...)},
	{typeName: "ParenTest", fixture: "[[ ( -f x ) ]]", locate: navParenTest, expectedKeys: merge([]string{"type", "x"}, posEnd...)},

	// Supporting leaves (no pos/end — these aren't Nodes in mvdan/sh)
	{typeName: "ArrayExpr", fixture: "arr=(a b)", locate: navArrayExpr, expectedKeys: merge([]string{"type", "elems", "last"}, posEnd...)},
	{typeName: "ArrayElem", fixture: "arr=(a)", locate: navArrayElem, expectedKeys: merge([]string{"type", "index", "value", "comments"}, posEnd...)},
	{typeName: "WordIter", fixture: "for f in *; do echo; done", locate: navWordIter, expectedKeys: merge([]string{"type", "name", "items"}, posEnd...)},
	{typeName: "CStyleLoop", fixture: "for ((i=0;i<10;i++)); do echo; done", locate: navCStyleLoop, expectedKeys: merge([]string{"type", "init", "cond", "post"}, posEnd...)},
	{typeName: "Slice", fixture: `echo "${var:1:3}"`, locate: navSlice, expectedKeys: []string{"type", "offset", "length"}},
	{typeName: "Replace", fixture: `echo "${var/old/new}"`, locate: navReplace, expectedKeys: []string{"type", "all", "orig", "with"}},
	{typeName: "Expansion", fixture: `echo "${var:-default}"`, locate: navExpansion, expectedKeys: []string{"type", "op", "word"}},
}

func TestSchemaCompleteness(t *testing.T) {
	for _, c := range schemaCases {
		t.Run(c.typeName, func(t *testing.T) {
			p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(syntax.LangBash))
			f, err := p.Parse(strings.NewReader(c.fixture), "")
			require.NoError(t, err, "parsing fixture")
			if c.splitBraces {
				applySplitBraces(f)
			}

			rawNode := c.locate(f)
			require.NotNil(t, rawNode, "locate returned nil")

			// Round-trip through JSON so we see exactly the keys
			// a TS consumer sees, not the in-process map shape.
			b, err := json.Marshal(rawNode)
			require.NoError(t, err)
			var got map[string]interface{}
			require.NoError(t, json.Unmarshal(b, &got))

			gotKeys := sortedKeys(got)
			wantKeys := sortedCopy(c.expectedKeys)

			assert.Equal(t, wantKeys, gotKeys,
				"%s schema drift — schemaCases or serializer needs updating", c.typeName)
		})
	}
}

func sortedKeys(m map[string]interface{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedCopy(xs []string) []string {
	out := append([]string(nil), xs...)
	sort.Strings(out)
	return out
}
