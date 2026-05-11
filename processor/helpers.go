package main

import "mvdan.cc/sh/v3/syntax"

// withPos injects pos/end into a serializer's output map and returns
// the same map. Every per-type serializer carries source positions,
// so this collapses ~80 lines of repetition.
func withPos(n syntax.Node, m map[string]interface{}) map[string]interface{} {
	m["pos"] = nodePos(n.Pos())
	m["end"] = nodePos(n.End())
	return m
}

// ─── Slice serializers (one per element type that appears in lists) ──

func serializeStmts(stmts []*syntax.Stmt) []interface{} {
	out := make([]interface{}, len(stmts))
	for i, s := range stmts {
		out[i] = serializeStmt(s)
	}
	return out
}

func serializeWords(ws []*syntax.Word) []interface{} {
	out := make([]interface{}, len(ws))
	for i, w := range ws {
		out[i] = serializeWord(w)
	}
	return out
}

func serializeAssigns(as []*syntax.Assign) []interface{} {
	out := make([]interface{}, len(as))
	for i, a := range as {
		out[i] = serializeAssign(a)
	}
	return out
}

func serializeRedirects(rs []*syntax.Redirect) []interface{} {
	out := make([]interface{}, len(rs))
	for i, r := range rs {
		out[i] = serializeRedirect(r)
	}
	return out
}

func serializeArithmExprs(es []syntax.ArithmExpr) []interface{} {
	out := make([]interface{}, len(es))
	for i, e := range es {
		out[i] = serializeArithmExpr(e)
	}
	return out
}

func serializeArrayElems(es []*syntax.ArrayElem) []interface{} {
	out := make([]interface{}, len(es))
	for i, e := range es {
		out[i] = serializeArrayElem(e)
	}
	return out
}

func serializeCaseItems(items []*syntax.CaseItem) []interface{} {
	out := make([]interface{}, len(items))
	for i, item := range items {
		out[i] = serializeCaseItem(item)
	}
	return out
}

func serializeWordParts(parts []syntax.WordPart) []interface{} {
	out := make([]interface{}, len(parts))
	for i, p := range parts {
		out[i] = serializeWordPart(p)
	}
	return out
}

func serializeComments(comments []syntax.Comment) []interface{} {
	out := make([]interface{}, len(comments))
	for i, c := range comments {
		out[i] = serializeComment(c)
	}
	return out
}
