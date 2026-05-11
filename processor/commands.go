package main

import "mvdan.cc/sh/v3/syntax"

// Concrete Command-interface implementers. Dispatched into by
// serializeCommand in dispatch.go.

func serializeCallExpr(n *syntax.CallExpr) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":    "CallExpr",
		"assigns": serializeAssigns(n.Assigns),
		"args":    serializeWords(n.Args),
	})
}

func serializeBinaryCmd(n *syntax.BinaryCmd) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "BinaryCmd",
		"op":   n.Op.String(),
		"x":    serializeStmt(n.X),
		"y":    serializeStmt(n.Y),
	})
}

func serializeIfClause(n *syntax.IfClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "IfClause",
		"cond":     serializeStmts(n.Cond),
		"condLast": serializeComments(n.CondLast),
		"then":     serializeStmts(n.Then),
		"thenLast": serializeComments(n.ThenLast),
		"else":     serializeIfClausePtr(n.Else),
		"last":     serializeComments(n.Last),
	})
}

// serializeIfClausePtr exists because IfClause.Else is *IfClause
// (nil-able), and the JSON shape needs a typed null instead of an
// empty object when there's no else branch.
func serializeIfClausePtr(n *syntax.IfClause) interface{} {
	if n == nil {
		return nil
	}
	return serializeIfClause(n)
}

func serializeWhileClause(n *syntax.WhileClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "WhileClause",
		"until":    n.Until,
		"cond":     serializeStmts(n.Cond),
		"condLast": serializeComments(n.CondLast),
		"do":       serializeStmts(n.Do),
		"doLast":   serializeComments(n.DoLast),
	})
}

func serializeForClause(n *syntax.ForClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":   "ForClause",
		"select": n.Select,
		"loop":   serializeLoop(n.Loop),
		"do":     serializeStmts(n.Do),
		"doLast": serializeComments(n.DoLast),
	})
}

func serializeCaseClause(n *syntax.CaseClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "CaseClause",
		"word":  serializeWord(n.Word),
		"items": serializeCaseItems(n.Items),
		"last":  serializeComments(n.Last),
	})
}

func serializeCaseItem(n *syntax.CaseItem) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "CaseItem",
		"op":       n.Op.String(),
		"patterns": serializeWords(n.Patterns),
		"stmts":    serializeStmts(n.Stmts),
		"comments": serializeComments(n.Comments),
		"last":     serializeComments(n.Last),
	})
}

func serializeBlock(n *syntax.Block) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "Block",
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
	})
}

func serializeSubshell(n *syntax.Subshell) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "Subshell",
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
	})
}

func serializeFuncDecl(n *syntax.FuncDecl) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "FuncDecl",
		"rsrvWord": n.RsrvWord,
		"parens":   n.Parens,
		"name":     serializeLit(n.Name),
		"body":     serializeStmt(n.Body),
	})
}

func serializeArithmCmd(n *syntax.ArithmCmd) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "ArithmCmd",
		"unsigned": n.Unsigned,
		"x":        serializeArithmExpr(n.X),
	})
}

func serializeTestClause(n *syntax.TestClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "TestClause",
		"x":    serializeTestExpr(n.X),
	})
}

func serializeDeclClause(n *syntax.DeclClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":    "DeclClause",
		"variant": serializeLit(n.Variant),
		"args":    serializeAssigns(n.Args),
	})
}

func serializeLetClause(n *syntax.LetClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "LetClause",
		"exprs": serializeArithmExprs(n.Exprs),
	})
}

func serializeTimeClause(n *syntax.TimeClause) map[string]interface{} {
	var stmt interface{}
	if n.Stmt != nil {
		stmt = serializeStmt(n.Stmt)
	}
	return withPos(n, map[string]interface{}{
		"type":        "TimeClause",
		"posixFormat": n.PosixFormat,
		"stmt":        stmt,
	})
}

func serializeCoprocClause(n *syntax.CoprocClause) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "CoprocClause",
		"name": serializeWord(n.Name),
		"stmt": serializeStmt(n.Stmt),
	})
}

func serializeTestDecl(n *syntax.TestDecl) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":        "TestDecl",
		"description": serializeWord(n.Description),
		"body":        serializeStmt(n.Body),
	})
}
