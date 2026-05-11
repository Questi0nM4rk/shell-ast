package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"mvdan.cc/sh/v3/syntax"
)

// parseOption mutates the parsed File in place before serialization.
// Use to apply post-parse transforms like syntax.SplitBraces.
type parseOption func(*syntax.File)

// withSplitBraces is a parseOption that exposes BraceExp nodes by
// applying the same transform parse() uses when called with
// `{ splitBraces: true }`.
var withSplitBraces parseOption = applySplitBraces

// parseSource parses shell source, applies any options, and returns
// the JSON-decoded serialized AST.
func parseSource(t *testing.T, src string, opts ...parseOption) map[string]interface{} {
	t.Helper()
	p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(syntax.LangBash))
	f, err := p.Parse(strings.NewReader(src), "")
	require.NoError(t, err)
	for _, opt := range opts {
		opt(f)
	}
	b, err := json.Marshal(serializeFile(f))
	require.NoError(t, err)
	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(b, &result))
	return result
}

// nav walks a JSON-decoded AST through a sequence of map keys (string)
// and array indices (int). Each step's failure points at the path so
// far for fast diagnosis.
func nav(t *testing.T, root interface{}, steps ...interface{}) interface{} {
	t.Helper()
	cur := root
	for i, step := range steps {
		switch s := step.(type) {
		case string:
			m, ok := cur.(map[string]interface{})
			require.True(t, ok, "step %d (%q): expected map at %v, got %T", i, s, steps[:i], cur)
			cur = m[s]
		case int:
			a, ok := cur.([]interface{})
			require.True(t, ok, "step %d (%d): expected array at %v, got %T", i, s, steps[:i], cur)
			require.Less(t, s, len(a), "step %d: index %d out of range (len=%d)", i, s, len(a))
			cur = a[s]
		default:
			t.Fatalf("step %d: unsupported step type %T", i, step)
		}
	}
	return cur
}

// getCmd returns the nth statement's cmd map.
func getCmd(t *testing.T, ast map[string]interface{}, stmtIdx int) map[string]interface{} {
	t.Helper()
	cmd, ok := nav(t, ast, "stmts", stmtIdx, "cmd").(map[string]interface{})
	require.True(t, ok, "stmts[%d].cmd is not a map", stmtIdx)
	return cmd
}

// litValue returns the .value of the first Lit part of a Word.
func litValue(arg interface{}) string {
	return arg.(map[string]interface{})["parts"].([]interface{})[0].(map[string]interface{})["value"].(string)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestSerializeFile(t *testing.T) {
	ast := parseSource(t, "echo hello")
	assert.Equal(t, "File", ast["type"])
	stmts, ok := ast["stmts"].([]interface{})
	assert.True(t, ok)
	assert.Len(t, stmts, 1)
}

func TestSerializeCallExpr_Simple(t *testing.T) {
	ast := parseSource(t, "echo hello")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "CallExpr", cmd["type"])
	args := cmd["args"].([]interface{})
	assert.Len(t, args, 2)
	assert.Equal(t, "echo", litValue(args[0]))
	assert.Equal(t, "hello", litValue(args[1]))
}

func TestSerializeCallExpr_Flags(t *testing.T) {
	ast := parseSource(t, "rm -rf /")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "CallExpr", cmd["type"])
	args := cmd["args"].([]interface{})
	assert.Len(t, args, 3)
	assert.Equal(t, "rm", litValue(args[0]))
	assert.Equal(t, "-rf", litValue(args[1]))
	assert.Equal(t, "/", litValue(args[2]))
}

func TestSerializeBinaryCmd_Pipe(t *testing.T) {
	ast := parseSource(t, "cat /etc/passwd | grep root")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "BinaryCmd", cmd["type"])
	assert.Equal(t, "|", cmd["op"])

	x := cmd["x"].(map[string]interface{})
	xCmd := x["cmd"].(map[string]interface{})
	assert.Equal(t, "CallExpr", xCmd["type"])
	assert.Equal(t, "cat", litValue(xCmd["args"].([]interface{})[0]))

	y := cmd["y"].(map[string]interface{})
	yCmd := y["cmd"].(map[string]interface{})
	assert.Equal(t, "CallExpr", yCmd["type"])
	assert.Equal(t, "grep", litValue(yCmd["args"].([]interface{})[0]))
}

func TestSerializeBinaryCmd_LogicalAnd(t *testing.T) {
	ast := parseSource(t, "make && make test")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "BinaryCmd", cmd["type"])
	assert.Equal(t, "&&", cmd["op"])
}

func TestSerializeRedirect_Out(t *testing.T) {
	ast := parseSource(t, "echo foo > /tmp/out")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	redirs := stmt["redirs"].([]interface{})
	assert.Len(t, redirs, 1)
	redir := redirs[0].(map[string]interface{})
	assert.Equal(t, "Redirect", redir["type"])
	assert.Equal(t, ">", redir["op"])
}

func TestSerializeRedirect_StderrToStdout(t *testing.T) {
	ast := parseSource(t, "cmd 2>&1")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	redirs := stmt["redirs"].([]interface{})
	assert.Len(t, redirs, 1)
	redir := redirs[0].(map[string]interface{})
	assert.Equal(t, ">&", redir["op"])
	// n should be "2"
	n := redir["n"].(map[string]interface{})
	assert.Equal(t, "Lit", n["type"])
	assert.Equal(t, "2", n["value"])
}

func TestSerializeCmdSubst(t *testing.T) {
	ast := parseSource(t, "echo $(date)")
	cmd := getCmd(t, ast, 0)
	args := cmd["args"].([]interface{})
	// args[1] is Word with CmdSubst part
	word := args[1].(map[string]interface{})
	parts := word["parts"].([]interface{})
	sub := parts[0].(map[string]interface{})
	assert.Equal(t, "CmdSubst", sub["type"])
	subStmts := sub["stmts"].([]interface{})
	assert.Len(t, subStmts, 1)
	subCmd := subStmts[0].(map[string]interface{})["cmd"].(map[string]interface{})
	assert.Equal(t, "date", litValue(subCmd["args"].([]interface{})[0]))
}

func TestSerializeProcSubst(t *testing.T) {
	ast := parseSource(t, "diff <(ls a) <(ls b)")
	cmd := getCmd(t, ast, 0)
	args := cmd["args"].([]interface{})
	assert.Len(t, args, 3)
	// args[1] is Word with ProcSubst
	word := args[1].(map[string]interface{})
	parts := word["parts"].([]interface{})
	proc := parts[0].(map[string]interface{})
	assert.Equal(t, "ProcSubst", proc["type"])
	assert.Equal(t, "<(", proc["op"])
}

func TestSerializeArithmExp(t *testing.T) {
	ast := parseSource(t, "echo $((x + 1))")
	cmd := getCmd(t, ast, 0)
	args := cmd["args"].([]interface{})
	word := args[1].(map[string]interface{})
	parts := word["parts"].([]interface{})
	arith := parts[0].(map[string]interface{})
	assert.Equal(t, "ArithmExp", arith["type"])
	x := arith["x"].(map[string]interface{})
	assert.Equal(t, "BinaryArithm", x["type"])
	assert.Equal(t, "+", x["op"])
}

func TestSerializeArithmCmd(t *testing.T) {
	ast := parseSource(t, "((x++))")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "ArithmCmd", cmd["type"])
	x := cmd["x"].(map[string]interface{})
	assert.Equal(t, "UnaryArithm", x["type"])
	assert.Equal(t, "++", x["op"])
	assert.Equal(t, true, x["post"])
}

func TestSerializeDblQuoted(t *testing.T) {
	ast := parseSource(t, `echo "hello $name"`)
	cmd := getCmd(t, ast, 0)
	args := cmd["args"].([]interface{})
	word := args[1].(map[string]interface{})
	parts := word["parts"].([]interface{})
	dq := parts[0].(map[string]interface{})
	assert.Equal(t, "DblQuoted", dq["type"])
	dqParts := dq["parts"].([]interface{})
	assert.Len(t, dqParts, 2)
	assert.Equal(t, "Lit", dqParts[0].(map[string]interface{})["type"])
	assert.Equal(t, "ParamExp", dqParts[1].(map[string]interface{})["type"])
}

func TestSerializeSudoWithFlagArg(t *testing.T) {
	ast := parseSource(t, "sudo -u root rm -rf /")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "CallExpr", cmd["type"])
	args := cmd["args"].([]interface{})
	assert.Len(t, args, 6)
	assert.Equal(t, "sudo", litValue(args[0]))
	assert.Equal(t, "-u", litValue(args[1]))
	assert.Equal(t, "root", litValue(args[2]))
	assert.Equal(t, "rm", litValue(args[3]))
}

func TestSerializeSubshell(t *testing.T) {
	ast := parseSource(t, "(cd /tmp && rm -rf *)")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "Subshell", cmd["type"])
	subStmts := cmd["stmts"].([]interface{})
	assert.Len(t, subStmts, 1)
	innerCmd := subStmts[0].(map[string]interface{})["cmd"].(map[string]interface{})
	assert.Equal(t, "BinaryCmd", innerCmd["type"])
}

func TestSerializeFuncDecl(t *testing.T) {
	ast := parseSource(t, "foo() { echo bar; }")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "FuncDecl", cmd["type"])
	name := cmd["name"].(map[string]interface{})
	assert.Equal(t, "foo", name["value"])
	body := cmd["body"].(map[string]interface{})
	bodyCmd := body["cmd"].(map[string]interface{})
	assert.Equal(t, "Block", bodyCmd["type"])
}

func TestSerializeForClause(t *testing.T) {
	ast := parseSource(t, "for f in *.txt; do rm $f; done")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "ForClause", cmd["type"])
	loop := cmd["loop"].(map[string]interface{})
	assert.Equal(t, "WordIter", loop["type"])
	name := loop["name"].(map[string]interface{})
	assert.Equal(t, "f", name["value"])
}

func TestSerializeTestClause(t *testing.T) {
	ast := parseSource(t, "[[ -f foo && -d bar ]]")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "TestClause", cmd["type"])
	x := cmd["x"].(map[string]interface{})
	assert.Equal(t, "BinaryTest", x["type"])
	assert.Equal(t, "&&", x["op"])
}

func TestSerializeHeredoc(t *testing.T) {
	ast := parseSource(t, "cat <<EOF\nhello\nEOF")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	redirs := stmt["redirs"].([]interface{})
	assert.Len(t, redirs, 1)
	redir := redirs[0].(map[string]interface{})
	assert.Equal(t, "<<", redir["op"])
	assert.NotNil(t, redir["hdoc"])
}

func TestSerializeNodePositions(t *testing.T) {
	ast := parseSource(t, "echo hello")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	cmd := stmt["cmd"].(map[string]interface{})
	pos := cmd["pos"].(map[string]interface{})
	// "echo" starts at offset 0, line 1, col 1
	assert.Equal(t, float64(1), pos["line"])
	assert.Equal(t, float64(1), pos["col"])
}

func TestSerializeIfClause(t *testing.T) {
	ast := parseSource(t, "if true; then echo yes; fi")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "IfClause", cmd["type"])
	cond := cmd["cond"].([]interface{})
	assert.Len(t, cond, 1)
	then := cmd["then"].([]interface{})
	assert.Len(t, then, 1)
	assert.Nil(t, cmd["else"])
}

func TestSerializeWhileClause(t *testing.T) {
	ast := parseSource(t, "while true; do echo loop; done")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "WhileClause", cmd["type"])
	assert.Equal(t, false, cmd["until"])
}

func TestSerializeUntilClause(t *testing.T) {
	ast := parseSource(t, "until false; do echo loop; done")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "WhileClause", cmd["type"])
	assert.Equal(t, true, cmd["until"])
}

func TestSerializeCaseClause(t *testing.T) {
	ast := parseSource(t, "case $x in a) echo a;; b) echo b;; esac")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "CaseClause", cmd["type"])
	items := cmd["items"].([]interface{})
	assert.Len(t, items, 2)
	item := items[0].(map[string]interface{})
	assert.Equal(t, "CaseItem", item["type"])
	assert.Equal(t, ";;", item["op"])
}

func TestSerializeDeclClause(t *testing.T) {
	ast := parseSource(t, "declare -a myarray")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "DeclClause", cmd["type"])
	variant := cmd["variant"].(map[string]interface{})
	assert.Equal(t, "declare", variant["value"])
}

func TestSerializeSglQuoted(t *testing.T) {
	ast := parseSource(t, "echo 'hello world'")
	cmd := getCmd(t, ast, 0)
	args := cmd["args"].([]interface{})
	word := args[1].(map[string]interface{})
	parts := word["parts"].([]interface{})
	sq := parts[0].(map[string]interface{})
	assert.Equal(t, "SglQuoted", sq["type"])
	assert.Equal(t, "hello world", sq["value"])
}

func TestSerializeNegatedStmt(t *testing.T) {
	ast := parseSource(t, "! false")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	assert.Equal(t, true, stmt["negated"])
}
