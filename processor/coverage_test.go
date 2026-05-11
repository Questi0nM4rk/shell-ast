// Coverage tests for node types that the original suite skipped
// (audit E2). Each test parses a minimal real-shell fixture and
// asserts the serializer produces the expected discriminator + key
// shape. Failure here means the serializer either silently dropped
// fields or returned a wrong type tag — both are bugs the existing
// suite couldn't catch.

package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// ─── Command-level nodes ─────────────────────────────────────────────────────

func TestSerializeLetClause(t *testing.T) {
	ast := parseSource(t, "let x=1+2 y=3*4")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "LetClause", cmd["type"])
	exprs := cmd["exprs"].([]interface{})
	assert.Len(t, exprs, 2, "let with two exprs")
}

func TestSerializeCoprocClause(t *testing.T) {
	ast := parseSource(t, "coproc cat /tmp/in")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "CoprocClause", cmd["type"])
	assert.NotNil(t, cmd["stmt"])
}

func TestSerializeTimeClause(t *testing.T) {
	ast := parseSource(t, "time ls /")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "TimeClause", cmd["type"])
	assert.NotNil(t, cmd["stmt"])
	assert.Equal(t, false, cmd["posixFormat"])
}

func TestSerializeTimeClause_Posix(t *testing.T) {
	ast := parseSource(t, "time -p ls /")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "TimeClause", cmd["type"])
	assert.Equal(t, true, cmd["posixFormat"])
}

func TestSerializeCStyleLoop(t *testing.T) {
	ast := parseSource(t, "for ((i=0; i<10; i++)); do echo $i; done")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "ForClause", cmd["type"])
	loop := cmd["loop"].(map[string]interface{})
	assert.Equal(t, "CStyleLoop", loop["type"])
	assert.NotNil(t, loop["init"])
	assert.NotNil(t, loop["cond"])
	assert.NotNil(t, loop["post"])
}

// ─── Word parts ──────────────────────────────────────────────────────────────

func TestSerializeBraceExp_List(t *testing.T) {
	ast := parseSource(t, "echo {a,b,c}", withSplitBraces)
	be := nav(t, ast, "stmts", 0, "cmd", "args", 1, "parts", 0)
	assert.Equal(t, "BraceExp", nav(t, be, "type"))
	assert.Equal(t, false, nav(t, be, "sequence"))
	assert.Len(t, nav(t, be, "elems"), 3)
}

func TestSerializeBraceExp_Sequence(t *testing.T) {
	ast := parseSource(t, "echo {1..5}", withSplitBraces)
	be := nav(t, ast, "stmts", 0, "cmd", "args", 1, "parts", 0)
	assert.Equal(t, "BraceExp", nav(t, be, "type"))
	assert.Equal(t, true, nav(t, be, "sequence"))
}

func TestSerializeExtGlob(t *testing.T) {
	ast := parseSource(t, "echo @(foo|bar)")
	eg := nav(t, ast, "stmts", 0, "cmd", "args", 1, "parts", 0)
	assert.Equal(t, "ExtGlob", nav(t, eg, "type"))
	assert.Equal(t, "@(", nav(t, eg, "op"))
	assert.Equal(t, "Lit", nav(t, eg, "pattern", "type"))
}

func TestSerializeParenArithm(t *testing.T) {
	ast := parseSource(t, "echo $(((1+2)))")
	ae := nav(t, ast, "stmts", 0, "cmd", "args", 1, "parts", 0)
	assert.Equal(t, "ArithmExp", nav(t, ae, "type"))
	assert.Equal(t, "ParenArithm", nav(t, ae, "x", "type"))
	inner := nav(t, ae, "x", "x")
	assert.Equal(t, "BinaryArithm", nav(t, inner, "type"))
	assert.Equal(t, "+", nav(t, inner, "op"))
}

// ─── ParamExp sub-nodes ──────────────────────────────────────────────────────

// paramExpInDblQuoted drills from File -> stmts[0].cmd.args[1] (the
// double-quoted Word) -> parts[0] (the DblQuoted) -> parts[0] (the
// ParamExp). The fixture pattern `cmd "${...}"` is used by every
// Slice/Replace/Expansion test.
func paramExpInDblQuoted(t *testing.T, ast map[string]interface{}) interface{} {
	t.Helper()
	pe := nav(t, ast, "stmts", 0, "cmd", "args", 1, "parts", 0, "parts", 0)
	assert.Equal(t, "ParamExp", nav(t, pe, "type"))
	return pe
}

func TestSerializeSlice(t *testing.T) {
	ast := parseSource(t, `echo "${var:1:3}"`)
	pe := paramExpInDblQuoted(t, ast)
	slice := nav(t, pe, "slice")
	assert.Equal(t, "Slice", nav(t, slice, "type"))
	assert.NotNil(t, nav(t, slice, "offset"))
	assert.NotNil(t, nav(t, slice, "length"))
}

func TestSerializeReplace(t *testing.T) {
	ast := parseSource(t, `echo "${var/old/new}"`)
	pe := paramExpInDblQuoted(t, ast)
	repl := nav(t, pe, "repl")
	assert.Equal(t, "Replace", nav(t, repl, "type"))
	assert.Equal(t, false, nav(t, repl, "all"))
	assert.NotNil(t, nav(t, repl, "orig"))
	assert.NotNil(t, nav(t, repl, "with"))
}

func TestSerializeReplace_All(t *testing.T) {
	ast := parseSource(t, `echo "${var//old/new}"`)
	pe := paramExpInDblQuoted(t, ast)
	assert.Equal(t, true, nav(t, pe, "repl", "all"))
}

func TestSerializeExpansion_Default(t *testing.T) {
	ast := parseSource(t, `echo "${var:-fallback}"`)
	pe := paramExpInDblQuoted(t, ast)
	exp := nav(t, pe, "exp")
	assert.Equal(t, "Expansion", nav(t, exp, "type"))
	assert.Equal(t, ":-", nav(t, exp, "op"))
}

// ─── Test-clause operators ───────────────────────────────────────────────────

func TestSerializeBinaryTest_NumericEq(t *testing.T) {
	ast := parseSource(t, "[[ $x -eq 1 ]]")
	cmd := getCmd(t, ast, 0)
	assert.Equal(t, "TestClause", cmd["type"])
	x := cmd["x"].(map[string]interface{})
	assert.Equal(t, "BinaryTest", x["type"])
	assert.Equal(t, "-eq", x["op"])
}

func TestSerializeBinaryTest_RegexMatch(t *testing.T) {
	ast := parseSource(t, "[[ $x =~ ^foo ]]")
	cmd := getCmd(t, ast, 0)
	x := cmd["x"].(map[string]interface{})
	assert.Equal(t, "BinaryTest", x["type"])
	assert.Equal(t, "=~", x["op"])
}

// ─── Array forms ─────────────────────────────────────────────────────────────

func TestSerializeArrayExpr_Indexed(t *testing.T) {
	ast := parseSource(t, "arr=([0]=a [1]=b)")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	cmd := stmt["cmd"].(map[string]interface{})
	assigns := cmd["assigns"].([]interface{})
	assign := assigns[0].(map[string]interface{})
	arr := assign["array"].(map[string]interface{})
	assert.Equal(t, "ArrayExpr", arr["type"])
	elems := arr["elems"].([]interface{})
	assert.Len(t, elems, 2)
	for _, e := range elems {
		elem := e.(map[string]interface{})
		assert.Equal(t, "ArrayElem", elem["type"])
		assert.NotNil(t, elem["index"], "indexed element must have index")
	}
}

func TestSerializeArrayExpr_Plain(t *testing.T) {
	ast := parseSource(t, "arr=(a b c)")
	stmts := ast["stmts"].([]interface{})
	stmt := stmts[0].(map[string]interface{})
	cmd := stmt["cmd"].(map[string]interface{})
	assigns := cmd["assigns"].([]interface{})
	assign := assigns[0].(map[string]interface{})
	arr := assign["array"].(map[string]interface{})
	elems := arr["elems"].([]interface{})
	assert.Len(t, elems, 3)
	for _, e := range elems {
		elem := e.(map[string]interface{})
		assert.Nil(t, elem["index"], "plain element has no index")
	}
}
