package main

import "mvdan.cc/sh/v3/syntax"

// serializeNode dispatches to the correct per-type serializer.
// Returns nil for nil input.
func serializeNode(n syntax.Node) interface{} {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *syntax.File:
		return serializeFile(v)
	case *syntax.Stmt:
		return serializeStmt(v)
	case *syntax.Word:
		return serializeWord(v)
	case *syntax.Lit:
		return serializeLit(v)
	case *syntax.SglQuoted:
		return serializeSglQuoted(v)
	case *syntax.DblQuoted:
		return serializeDblQuoted(v)
	case *syntax.CmdSubst:
		return serializeCmdSubst(v)
	case *syntax.ParamExp:
		return serializeParamExp(v)
	case *syntax.ArithmExp:
		return serializeArithmExp(v)
	case *syntax.ProcSubst:
		return serializeProcSubst(v)
	case *syntax.ExtGlob:
		return serializeExtGlob(v)
	case *syntax.BraceExp:
		return serializeBraceExp(v)
	case *syntax.Redirect:
		return serializeRedirect(v)
	case *syntax.Assign:
		return serializeAssign(v)
	case *syntax.CallExpr:
		return serializeCallExpr(v)
	case *syntax.BinaryCmd:
		return serializeBinaryCmd(v)
	case *syntax.IfClause:
		return serializeIfClause(v)
	case *syntax.WhileClause:
		return serializeWhileClause(v)
	case *syntax.ForClause:
		return serializeForClause(v)
	case *syntax.CaseClause:
		return serializeCaseClause(v)
	case *syntax.Block:
		return serializeBlock(v)
	case *syntax.Subshell:
		return serializeSubshell(v)
	case *syntax.FuncDecl:
		return serializeFuncDecl(v)
	case *syntax.ArithmCmd:
		return serializeArithmCmd(v)
	case *syntax.TestClause:
		return serializeTestClause(v)
	case *syntax.DeclClause:
		return serializeDeclClause(v)
	case *syntax.LetClause:
		return serializeLetClause(v)
	case *syntax.TimeClause:
		return serializeTimeClause(v)
	case *syntax.CoprocClause:
		return serializeCoprocClause(v)
	case *syntax.TestDecl:
		return serializeTestDecl(v)
	default:
		return map[string]interface{}{
			"type": "Unknown",
			"pos":  nodePos(n.Pos()),
			"end":  nodePos(n.End()),
		}
	}
}

// serializeArithmExpr handles the ArithmExpr interface.
func serializeArithmExpr(n syntax.ArithmExpr) interface{} {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *syntax.BinaryArithm:
		return serializeBinaryArithm(v)
	case *syntax.UnaryArithm:
		return serializeUnaryArithm(v)
	case *syntax.ParenArithm:
		return serializeParenArithm(v)
	case *syntax.Word:
		return serializeWord(v)
	default:
		return nil
	}
}

// serializeTestExpr handles the TestExpr interface.
func serializeTestExpr(n syntax.TestExpr) interface{} {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *syntax.BinaryTest:
		return serializeBinaryTest(v)
	case *syntax.UnaryTest:
		return serializeUnaryTest(v)
	case *syntax.ParenTest:
		return serializeParenTest(v)
	case *syntax.Word:
		return serializeWord(v)
	default:
		return nil
	}
}

// serializeLoop handles the Loop interface.
func serializeLoop(n syntax.Loop) interface{} {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *syntax.WordIter:
		return serializeWordIter(v)
	case *syntax.CStyleLoop:
		return serializeCStyleLoop(v)
	default:
		return nil
	}
}

// serializeWordPart handles the WordPart interface.
func serializeWordPart(n syntax.WordPart) interface{} {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *syntax.Lit:
		return serializeLit(v)
	case *syntax.SglQuoted:
		return serializeSglQuoted(v)
	case *syntax.DblQuoted:
		return serializeDblQuoted(v)
	case *syntax.CmdSubst:
		return serializeCmdSubst(v)
	case *syntax.ParamExp:
		return serializeParamExp(v)
	case *syntax.ArithmExp:
		return serializeArithmExp(v)
	case *syntax.ProcSubst:
		return serializeProcSubst(v)
	case *syntax.ExtGlob:
		return serializeExtGlob(v)
	case *syntax.BraceExp:
		return serializeBraceExp(v)
	default:
		return map[string]interface{}{
			"type": "Unknown",
			"pos":  nodePos(n.Pos()),
			"end":  nodePos(n.End()),
		}
	}
}

// serializeCommand handles the Command interface.
func serializeCommand(n syntax.Command) interface{} {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *syntax.CallExpr:
		return serializeCallExpr(v)
	case *syntax.BinaryCmd:
		return serializeBinaryCmd(v)
	case *syntax.IfClause:
		return serializeIfClause(v)
	case *syntax.WhileClause:
		return serializeWhileClause(v)
	case *syntax.ForClause:
		return serializeForClause(v)
	case *syntax.CaseClause:
		return serializeCaseClause(v)
	case *syntax.Block:
		return serializeBlock(v)
	case *syntax.Subshell:
		return serializeSubshell(v)
	case *syntax.FuncDecl:
		return serializeFuncDecl(v)
	case *syntax.ArithmCmd:
		return serializeArithmCmd(v)
	case *syntax.TestClause:
		return serializeTestClause(v)
	case *syntax.DeclClause:
		return serializeDeclClause(v)
	case *syntax.LetClause:
		return serializeLetClause(v)
	case *syntax.TimeClause:
		return serializeTimeClause(v)
	case *syntax.CoprocClause:
		return serializeCoprocClause(v)
	case *syntax.TestDecl:
		return serializeTestDecl(v)
	default:
		return nil
	}
}

// ─── Statement-level ──────────────────────────────────────────────────────────

func serializeFile(n *syntax.File) map[string]interface{} {
	stmts := serializeStmts(n.Stmts)
	last := serializeComments(n.Last)
	return map[string]interface{}{
		"type":  "File",
		"name":  n.Name,
		"stmts": stmts,
		"last":  last,
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeStmt(n *syntax.Stmt) map[string]interface{} {
	redirs := make([]interface{}, len(n.Redirs))
	for i, r := range n.Redirs {
		redirs[i] = serializeRedirect(r)
	}
	comments := serializeComments(n.Comments)
	return map[string]interface{}{
		"type":       "Stmt",
		"cmd":        serializeCommand(n.Cmd),
		"redirs":     redirs,
		"comments":   comments,
		"negated":    n.Negated,
		"background": n.Background,
		"coprocess":  n.Coprocess,
		"pos":        nodePos(n.Pos()),
		"end":        nodePos(n.End()),
	}
}

func serializeRedirect(n *syntax.Redirect) map[string]interface{} {
	result := map[string]interface{}{
		"type": "Redirect",
		"op":   n.Op.String(),
		"word": serializeWord(n.Word),
		"hdoc": nil,
		"n":    nil,
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
	if n.Hdoc != nil {
		result["hdoc"] = serializeWord(n.Hdoc)
	}
	if n.N != nil {
		result["n"] = serializeLit(n.N)
	}
	return result
}

func serializeWord(n *syntax.Word) map[string]interface{} {
	if n == nil {
		return nil
	}
	parts := make([]interface{}, len(n.Parts))
	for i, p := range n.Parts {
		parts[i] = serializeWordPart(p)
	}
	return map[string]interface{}{
		"type":  "Word",
		"parts": parts,
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeAssign(n *syntax.Assign) map[string]interface{} {
	if n == nil {
		return nil
	}
	return map[string]interface{}{
		"type":   "Assign",
		"name":   serializeLit(n.Name),
		"index":  serializeArithmExpr(n.Index),
		"append": n.Append,
		"naked":  n.Naked,
		"value":  serializeWord(n.Value),
		"array":  serializeArrayExpr(n.Array),
		"pos":    nodePos(n.Pos()),
		"end":    nodePos(n.End()),
	}
}

func serializeComment(n syntax.Comment) map[string]interface{} {
	return map[string]interface{}{
		"type": "Comment",
		"text": n.Text,
		"pos":  nodePos(n.Hash),
		"end":  nodePos(n.Hash),
	}
}

// ─── Command types ────────────────────────────────────────────────────────────

func serializeCallExpr(n *syntax.CallExpr) map[string]interface{} {
	assigns := make([]interface{}, len(n.Assigns))
	for i, a := range n.Assigns {
		assigns[i] = serializeAssign(a)
	}
	args := make([]interface{}, len(n.Args))
	for i, w := range n.Args {
		args[i] = serializeWord(w)
	}
	return map[string]interface{}{
		"type":    "CallExpr",
		"assigns": assigns,
		"args":    args,
		"pos":     nodePos(n.Pos()),
		"end":     nodePos(n.End()),
	}
}

func serializeBinaryCmd(n *syntax.BinaryCmd) map[string]interface{} {
	return map[string]interface{}{
		"type": "BinaryCmd",
		"op":   n.Op.String(),
		"x":    serializeStmt(n.X),
		"y":    serializeStmt(n.Y),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeIfClause(n *syntax.IfClause) map[string]interface{} {
	return map[string]interface{}{
		"type":     "IfClause",
		"cond":     serializeStmts(n.Cond),
		"condLast": serializeComments(n.CondLast),
		"then":     serializeStmts(n.Then),
		"thenLast": serializeComments(n.ThenLast),
		"else":     serializeIfClausePtr(n.Else),
		"last":     serializeComments(n.Last),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeIfClausePtr(n *syntax.IfClause) interface{} {
	if n == nil {
		return nil
	}
	return serializeIfClause(n)
}

func serializeWhileClause(n *syntax.WhileClause) map[string]interface{} {
	return map[string]interface{}{
		"type":     "WhileClause",
		"until":    n.Until,
		"cond":     serializeStmts(n.Cond),
		"condLast": serializeComments(n.CondLast),
		"do":       serializeStmts(n.Do),
		"doLast":   serializeComments(n.DoLast),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeForClause(n *syntax.ForClause) map[string]interface{} {
	return map[string]interface{}{
		"type":   "ForClause",
		"select": n.Select,
		"loop":   serializeLoop(n.Loop),
		"do":     serializeStmts(n.Do),
		"doLast": serializeComments(n.DoLast),
		"pos":    nodePos(n.Pos()),
		"end":    nodePos(n.End()),
	}
}

func serializeCaseClause(n *syntax.CaseClause) map[string]interface{} {
	items := make([]interface{}, len(n.Items))
	for i, item := range n.Items {
		items[i] = serializeCaseItem(item)
	}
	return map[string]interface{}{
		"type":  "CaseClause",
		"word":  serializeWord(n.Word),
		"items": items,
		"last":  serializeComments(n.Last),
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeCaseItem(n *syntax.CaseItem) map[string]interface{} {
	patterns := make([]interface{}, len(n.Patterns))
	for i, p := range n.Patterns {
		patterns[i] = serializeWord(p)
	}
	return map[string]interface{}{
		"type":     "CaseItem",
		"op":       n.Op.String(),
		"patterns": patterns,
		"stmts":    serializeStmts(n.Stmts),
		"comments": serializeComments(n.Comments),
		"last":     serializeComments(n.Last),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeBlock(n *syntax.Block) map[string]interface{} {
	return map[string]interface{}{
		"type":  "Block",
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeSubshell(n *syntax.Subshell) map[string]interface{} {
	return map[string]interface{}{
		"type":  "Subshell",
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeFuncDecl(n *syntax.FuncDecl) map[string]interface{} {
	return map[string]interface{}{
		"type":     "FuncDecl",
		"rsrvWord": n.RsrvWord,
		"parens":   n.Parens,
		"name":     serializeLit(n.Name),
		"body":     serializeStmt(n.Body),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeArithmCmd(n *syntax.ArithmCmd) map[string]interface{} {
	return map[string]interface{}{
		"type":     "ArithmCmd",
		"unsigned": n.Unsigned,
		"x":        serializeArithmExpr(n.X),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeTestClause(n *syntax.TestClause) map[string]interface{} {
	return map[string]interface{}{
		"type": "TestClause",
		"x":    serializeTestExpr(n.X),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeDeclClause(n *syntax.DeclClause) map[string]interface{} {
	args := make([]interface{}, len(n.Args))
	for i, a := range n.Args {
		args[i] = serializeAssign(a)
	}
	return map[string]interface{}{
		"type":    "DeclClause",
		"variant": serializeLit(n.Variant),
		"args":    args,
		"pos":     nodePos(n.Pos()),
		"end":     nodePos(n.End()),
	}
}

func serializeLetClause(n *syntax.LetClause) map[string]interface{} {
	exprs := make([]interface{}, len(n.Exprs))
	for i, e := range n.Exprs {
		exprs[i] = serializeArithmExpr(e)
	}
	return map[string]interface{}{
		"type":  "LetClause",
		"exprs": exprs,
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeTimeClause(n *syntax.TimeClause) map[string]interface{} {
	var stmt interface{}
	if n.Stmt != nil {
		stmt = serializeStmt(n.Stmt)
	}
	return map[string]interface{}{
		"type":        "TimeClause",
		"posixFormat": n.PosixFormat,
		"stmt":        stmt,
		"pos":         nodePos(n.Pos()),
		"end":         nodePos(n.End()),
	}
}

func serializeCoprocClause(n *syntax.CoprocClause) map[string]interface{} {
	return map[string]interface{}{
		"type": "CoprocClause",
		"name": serializeWord(n.Name),
		"stmt": serializeStmt(n.Stmt),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeTestDecl(n *syntax.TestDecl) map[string]interface{} {
	return map[string]interface{}{
		"type":        "TestDecl",
		"description": serializeWord(n.Description),
		"body":        serializeStmt(n.Body),
		"pos":         nodePos(n.Pos()),
		"end":         nodePos(n.End()),
	}
}

// ─── Word Part types ──────────────────────────────────────────────────────────

func serializeLit(n *syntax.Lit) map[string]interface{} {
	if n == nil {
		return nil
	}
	return map[string]interface{}{
		"type":  "Lit",
		"value": n.Value,
		"pos":   nodePos(n.ValuePos),
		"end":   nodePos(n.ValueEnd),
	}
}

func serializeSglQuoted(n *syntax.SglQuoted) map[string]interface{} {
	return map[string]interface{}{
		"type":   "SglQuoted",
		"dollar": n.Dollar,
		"value":  n.Value,
		"pos":    nodePos(n.Pos()),
		"end":    nodePos(n.End()),
	}
}

func serializeDblQuoted(n *syntax.DblQuoted) map[string]interface{} {
	parts := make([]interface{}, len(n.Parts))
	for i, p := range n.Parts {
		parts[i] = serializeWordPart(p)
	}
	return map[string]interface{}{
		"type":   "DblQuoted",
		"dollar": n.Dollar,
		"parts":  parts,
		"pos":    nodePos(n.Pos()),
		"end":    nodePos(n.End()),
	}
}

func serializeCmdSubst(n *syntax.CmdSubst) map[string]interface{} {
	return map[string]interface{}{
		"type":       "CmdSubst",
		"stmts":      serializeStmts(n.Stmts),
		"last":       serializeComments(n.Last),
		"backquotes": n.Backquotes,
		"tempFile":   n.TempFile,
		"replyVar":   n.ReplyVar,
		"pos":        nodePos(n.Pos()),
		"end":        nodePos(n.End()),
	}
}

func serializeParamExp(n *syntax.ParamExp) map[string]interface{} {
	return map[string]interface{}{
		"type":   "ParamExp",
		"short":  n.Short,
		"excl":   n.Excl,
		"length": n.Length,
		"width":  n.Width,
		"param":  serializeLit(n.Param),
		"index":  serializeArithmExpr(n.Index),
		"slice":  serializeSlice(n.Slice),
		"repl":   serializeReplace(n.Repl),
		"names":  n.Names.String(),
		"exp":    serializeExpansion(n.Exp),
		"pos":    nodePos(n.Pos()),
		"end":    nodePos(n.End()),
	}
}

func serializeArithmExp(n *syntax.ArithmExp) map[string]interface{} {
	return map[string]interface{}{
		"type":     "ArithmExp",
		"bracket":  n.Bracket,
		"unsigned": n.Unsigned,
		"x":        serializeArithmExpr(n.X),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeProcSubst(n *syntax.ProcSubst) map[string]interface{} {
	return map[string]interface{}{
		"type":  "ProcSubst",
		"op":    n.Op.String(),
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeExtGlob(n *syntax.ExtGlob) map[string]interface{} {
	return map[string]interface{}{
		"type":    "ExtGlob",
		"op":      n.Op.String(),
		"pattern": serializeLit(n.Pattern),
		"pos":     nodePos(n.Pos()),
		"end":     nodePos(n.End()),
	}
}

func serializeBraceExp(n *syntax.BraceExp) map[string]interface{} {
	elems := make([]interface{}, len(n.Elems))
	for i, e := range n.Elems {
		elems[i] = serializeWord(e)
	}
	return map[string]interface{}{
		"type":     "BraceExp",
		"sequence": n.Sequence,
		"elems":    elems,
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

// ─── Supporting types ─────────────────────────────────────────────────────────

func serializeArrayExpr(n *syntax.ArrayExpr) interface{} {
	if n == nil {
		return nil
	}
	elems := make([]interface{}, len(n.Elems))
	for i, e := range n.Elems {
		elems[i] = serializeArrayElem(e)
	}
	return map[string]interface{}{
		"type":  "ArrayExpr",
		"elems": elems,
		"last":  serializeComments(n.Last),
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeArrayElem(n *syntax.ArrayElem) map[string]interface{} {
	return map[string]interface{}{
		"type":     "ArrayElem",
		"index":    serializeArithmExpr(n.Index),
		"value":    serializeWord(n.Value),
		"comments": serializeComments(n.Comments),
		"pos":      nodePos(n.Pos()),
		"end":      nodePos(n.End()),
	}
}

func serializeWordIter(n *syntax.WordIter) map[string]interface{} {
	items := make([]interface{}, len(n.Items))
	for i, w := range n.Items {
		items[i] = serializeWord(w)
	}
	return map[string]interface{}{
		"type":  "WordIter",
		"name":  serializeLit(n.Name),
		"items": items,
		"pos":   nodePos(n.Pos()),
		"end":   nodePos(n.End()),
	}
}

func serializeCStyleLoop(n *syntax.CStyleLoop) map[string]interface{} {
	return map[string]interface{}{
		"type": "CStyleLoop",
		"init": serializeArithmExpr(n.Init),
		"cond": serializeArithmExpr(n.Cond),
		"post": serializeArithmExpr(n.Post),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeSlice(n *syntax.Slice) interface{} {
	if n == nil {
		return nil
	}
	return map[string]interface{}{
		"type":   "Slice",
		"offset": serializeArithmExpr(n.Offset),
		"length": serializeArithmExpr(n.Length),
	}
}

func serializeReplace(n *syntax.Replace) interface{} {
	if n == nil {
		return nil
	}
	return map[string]interface{}{
		"type": "Replace",
		"all":  n.All,
		"orig": serializeWord(n.Orig),
		"with": serializeWord(n.With),
	}
}

func serializeExpansion(n *syntax.Expansion) interface{} {
	if n == nil {
		return nil
	}
	return map[string]interface{}{
		"type": "Expansion",
		"op":   n.Op.String(),
		"word": serializeWord(n.Word),
	}
}

// ─── Arithmetic expression types ─────────────────────────────────────────────

func serializeBinaryArithm(n *syntax.BinaryArithm) map[string]interface{} {
	return map[string]interface{}{
		"type": "BinaryArithm",
		"op":   n.Op.String(),
		"x":    serializeArithmExpr(n.X),
		"y":    serializeArithmExpr(n.Y),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeUnaryArithm(n *syntax.UnaryArithm) map[string]interface{} {
	return map[string]interface{}{
		"type": "UnaryArithm",
		"op":   n.Op.String(),
		"post": n.Post,
		"x":    serializeArithmExpr(n.X),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeParenArithm(n *syntax.ParenArithm) map[string]interface{} {
	return map[string]interface{}{
		"type": "ParenArithm",
		"x":    serializeArithmExpr(n.X),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

// ─── Test expression types ────────────────────────────────────────────────────

func serializeBinaryTest(n *syntax.BinaryTest) map[string]interface{} {
	return map[string]interface{}{
		"type": "BinaryTest",
		"op":   n.Op.String(),
		"x":    serializeTestExpr(n.X),
		"y":    serializeTestExpr(n.Y),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeUnaryTest(n *syntax.UnaryTest) map[string]interface{} {
	return map[string]interface{}{
		"type": "UnaryTest",
		"op":   n.Op.String(),
		"x":    serializeTestExpr(n.X),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

func serializeParenTest(n *syntax.ParenTest) map[string]interface{} {
	return map[string]interface{}{
		"type": "ParenTest",
		"x":    serializeTestExpr(n.X),
		"pos":  nodePos(n.Pos()),
		"end":  nodePos(n.End()),
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func serializeStmts(stmts []*syntax.Stmt) []interface{} {
	result := make([]interface{}, len(stmts))
	for i, s := range stmts {
		result[i] = serializeStmt(s)
	}
	return result
}

func serializeComments(comments []syntax.Comment) []interface{} {
	result := make([]interface{}, len(comments))
	for i, c := range comments {
		result[i] = serializeComment(c)
	}
	return result
}
