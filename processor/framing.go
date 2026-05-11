package main

import "mvdan.cc/sh/v3/syntax"

// Framing types: the outer skeleton (File, Stmt) plus per-Stmt
// satellites (Redirect, Word, Assign, Comment) that aren't themselves
// commands but appear at every level of the AST.

func serializeFile(n *syntax.File) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "File",
		"name":  n.Name,
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
	})
}

func serializeStmt(n *syntax.Stmt) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":       "Stmt",
		"cmd":        serializeCommand(n.Cmd),
		"redirs":     serializeRedirects(n.Redirs),
		"comments":   serializeComments(n.Comments),
		"negated":    n.Negated,
		"background": n.Background,
		"coprocess":  n.Coprocess,
	})
}

func serializeRedirect(n *syntax.Redirect) map[string]interface{} {
	m := map[string]interface{}{
		"type": "Redirect",
		"op":   n.Op.String(),
		"word": serializeWord(n.Word),
		"hdoc": nil,
		"n":    nil,
	}
	if n.Hdoc != nil {
		m["hdoc"] = serializeWord(n.Hdoc)
	}
	if n.N != nil {
		m["n"] = serializeLit(n.N)
	}
	return withPos(n, m)
}

func serializeWord(n *syntax.Word) map[string]interface{} {
	if n == nil {
		return nil
	}
	return withPos(n, map[string]interface{}{
		"type":  "Word",
		"parts": serializeWordParts(n.Parts),
	})
}

func serializeAssign(n *syntax.Assign) map[string]interface{} {
	if n == nil {
		return nil
	}
	return withPos(n, map[string]interface{}{
		"type":   "Assign",
		"name":   serializeLit(n.Name),
		"index":  serializeArithmExpr(n.Index),
		"append": n.Append,
		"naked":  n.Naked,
		"value":  serializeWord(n.Value),
		"array":  serializeArrayExpr(n.Array),
	})
}

func serializeComment(n syntax.Comment) map[string]interface{} {
	return map[string]interface{}{
		"type": "Comment",
		"text": n.Text,
		"pos":  nodePos(n.Hash),
		"end":  nodePos(n.Hash),
	}
}
