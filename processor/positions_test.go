// Position-correctness tests (audit E3).
//
// The original suite had one position assertion (line=1,col=1) on a
// single-line input. That misses every realistic bug class:
// off-by-one offsets, byte-vs-rune column counting, nested-node
// positions, multi-line tracking. These tests cover each.

package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type expectedPos struct {
	offset float64
	line   float64
	col    float64
}

func assertPos(t *testing.T, node interface{}, want expectedPos) {
	t.Helper()
	m, ok := node.(map[string]interface{})
	require.True(t, ok, "node is not a map")
	pos, ok := m["pos"].(map[string]interface{})
	require.True(t, ok, "node has no pos")
	assert.Equal(t, want.offset, pos["offset"], "offset")
	assert.Equal(t, want.line, pos["line"], "line")
	assert.Equal(t, want.col, pos["col"], "col")
}

func TestPositions_SingleLineCallExpr(t *testing.T) {
	ast := parseSource(t, "rm -rf /")
	// CallExpr starts at "rm" — line 1, col 1, offset 0
	cmd := nav(t, ast, "stmts", 0, "cmd")
	assertPos(t, cmd, expectedPos{0, 1, 1})
	// Args: rm@1, -rf@4, /@8 (col is 1-based)
	rm := nav(t, cmd, "args", 0)
	assertPos(t, rm, expectedPos{0, 1, 1})
	dashRf := nav(t, cmd, "args", 1)
	assertPos(t, dashRf, expectedPos{3, 1, 4})
	slash := nav(t, cmd, "args", 2)
	assertPos(t, slash, expectedPos{7, 1, 8})
}

func TestPositions_MultiLineFuncDecl(t *testing.T) {
	src := "echo hi\nfoo() {\n  rm -rf /tmp\n}\n"
	ast := parseSource(t, src)

	// stmts[0] echo on line 1, col 1
	echo := nav(t, ast, "stmts", 0, "cmd")
	assertPos(t, echo, expectedPos{0, 1, 1})

	// stmts[1] foo() func decl on line 2, col 1, offset 8 (after "echo hi\n")
	fn := nav(t, ast, "stmts", 1, "cmd")
	assertPos(t, fn, expectedPos{8, 2, 1})
	assert.Equal(t, "FuncDecl", nav(t, fn, "type"))

	// Body block on same line as foo() {
	body := nav(t, fn, "body", "cmd")
	assert.Equal(t, "Block", nav(t, body, "type"))

	// Inner rm on line 3, col 3 (two-space indent)
	rm := nav(t, body, "stmts", 0, "cmd")
	assertPos(t, rm, expectedPos{18, 3, 3})
	assert.Equal(t, "CallExpr", nav(t, rm, "type"))
}

func TestPositions_NestedCmdSubst(t *testing.T) {
	// Outer echo at col 1; CmdSubst $( at col 6; inner date at col 8
	src := "echo $(date +%s)"
	ast := parseSource(t, src)

	echo := nav(t, ast, "stmts", 0, "cmd", "args", 0)
	assertPos(t, echo, expectedPos{0, 1, 1})

	// args[1] is a Word containing the CmdSubst
	cmdsubstWord := nav(t, ast, "stmts", 0, "cmd", "args", 1)
	assertPos(t, cmdsubstWord, expectedPos{5, 1, 6}) // $ at col 6

	cmdsubst := nav(t, cmdsubstWord, "parts", 0)
	assert.Equal(t, "CmdSubst", nav(t, cmdsubst, "type"))
	assertPos(t, cmdsubst, expectedPos{5, 1, 6}) // CmdSubst itself starts at $

	// Inner "date" call starts at col 8 (after "echo $(")
	date := nav(t, cmdsubst, "stmts", 0, "cmd", "args", 0)
	assertPos(t, date, expectedPos{7, 1, 8})
}

func TestPositions_NestedDblQuoted(t *testing.T) {
	src := `echo "hello $name"`
	ast := parseSource(t, src)

	dq := nav(t, ast, "stmts", 0, "cmd", "args", 1, "parts", 0)
	assert.Equal(t, "DblQuoted", nav(t, dq, "type"))
	assertPos(t, dq, expectedPos{5, 1, 6}) // " at col 6

	// inside DblQuoted: Lit "hello " at col 7, then ParamExp $name
	lit := nav(t, dq, "parts", 0)
	assert.Equal(t, "Lit", nav(t, lit, "type"))
	assertPos(t, lit, expectedPos{6, 1, 7})

	paramexp := nav(t, dq, "parts", 1)
	assert.Equal(t, "ParamExp", nav(t, paramexp, "type"))
	assertPos(t, paramexp, expectedPos{12, 1, 13}) // $ at col 13
}

func TestPositions_HeredocPosition(t *testing.T) {
	src := "cat <<EOF\nhello\nEOF\n"
	ast := parseSource(t, src)

	// cat at col 1
	cat := nav(t, ast, "stmts", 0, "cmd", "args", 0)
	assertPos(t, cat, expectedPos{0, 1, 1})

	// Redirect <<EOF starts at col 5
	redir := nav(t, ast, "stmts", 0, "redirs", 0)
	assertPos(t, redir, expectedPos{4, 1, 5})
	assert.Equal(t, "<<", nav(t, redir, "op"))

	// Heredoc body on line 2
	hdoc := nav(t, redir, "hdoc")
	require.NotNil(t, hdoc)
	assertPos(t, hdoc, expectedPos{10, 2, 1})
}

func TestPositions_OffsetIsByteCount(t *testing.T) {
	// API contract documented by this test: mvdan/sh's Col counts
	// BYTES, not runes. Multi-byte UTF-8 advances col by the byte
	// width. Consumers building rune-aware diagnostics must convert.
	//
	// "é cmd" — é is 2 bytes (0xC3 0xA9):
	//   é   at offset 0, col 1
	//   sp  at offset 2, col 3
	//   c   at offset 3, col 4   (col 4, not col 3!)
	src := "é cmd"
	ast := parseSource(t, src)
	cmd := nav(t, ast, "stmts", 0, "cmd", "args", 0)
	assertPos(t, cmd, expectedPos{0, 1, 1})
	cmdArg := nav(t, ast, "stmts", 0, "cmd", "args", 1)
	assertPos(t, cmdArg, expectedPos{3, 1, 4})
}
