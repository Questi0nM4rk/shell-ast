package main

import "mvdan.cc/sh/v3/syntax"

// Concrete WordPart-interface implementers, plus arithmetic/test
// expressions and the small leaf types (ArrayExpr/Elem, WordIter,
// CStyleLoop, Slice, Replace, Expansion).

// ─── Word parts ──────────────────────────────────────────────────────────────

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
	return withPos(n, map[string]interface{}{
		"type":   "SglQuoted",
		"dollar": n.Dollar,
		"value":  n.Value,
	})
}

func serializeDblQuoted(n *syntax.DblQuoted) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":   "DblQuoted",
		"dollar": n.Dollar,
		"parts":  serializeWordParts(n.Parts),
	})
}

func serializeCmdSubst(n *syntax.CmdSubst) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":       "CmdSubst",
		"stmts":      serializeStmts(n.Stmts),
		"last":       serializeComments(n.Last),
		"backquotes": n.Backquotes,
		"tempFile":   n.TempFile,
		"replyVar":   n.ReplyVar,
	})
}

func serializeParamExp(n *syntax.ParamExp) map[string]interface{} {
	// n.Names.String() returns "illegalTok" for the zero value (no names
	// operator), which is mvdan/sh's enum-default token. Normalize to ""
	// so the JSON schema and the TS union are clean.
	names := ""
	if n.Names != 0 {
		names = n.Names.String()
	}
	return withPos(n, map[string]interface{}{
		"type":   "ParamExp",
		"short":  n.Short,
		"excl":   n.Excl,
		"length": n.Length,
		"width":  n.Width,
		"param":  serializeLit(n.Param),
		"index":  serializeArithmExpr(n.Index),
		"slice":  serializeSlice(n.Slice),
		"repl":   serializeReplace(n.Repl),
		"names":  names,
		"exp":    serializeExpansion(n.Exp),
	})
}

func serializeArithmExp(n *syntax.ArithmExp) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "ArithmExp",
		"bracket":  n.Bracket,
		"unsigned": n.Unsigned,
		"x":        serializeArithmExpr(n.X),
	})
}

func serializeProcSubst(n *syntax.ProcSubst) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "ProcSubst",
		"op":    n.Op.String(),
		"stmts": serializeStmts(n.Stmts),
		"last":  serializeComments(n.Last),
	})
}

func serializeExtGlob(n *syntax.ExtGlob) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":    "ExtGlob",
		"op":      n.Op.String(),
		"pattern": serializeLit(n.Pattern),
	})
}

func serializeBraceExp(n *syntax.BraceExp) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "BraceExp",
		"sequence": n.Sequence,
		"elems":    serializeWords(n.Elems),
	})
}

// ─── Arithmetic expressions ──────────────────────────────────────────────────

func serializeBinaryArithm(n *syntax.BinaryArithm) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "BinaryArithm",
		"op":   n.Op.String(),
		"x":    serializeArithmExpr(n.X),
		"y":    serializeArithmExpr(n.Y),
	})
}

func serializeUnaryArithm(n *syntax.UnaryArithm) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "UnaryArithm",
		"op":   n.Op.String(),
		"post": n.Post,
		"x":    serializeArithmExpr(n.X),
	})
}

func serializeParenArithm(n *syntax.ParenArithm) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "ParenArithm",
		"x":    serializeArithmExpr(n.X),
	})
}

// ─── Test expressions ────────────────────────────────────────────────────────

func serializeBinaryTest(n *syntax.BinaryTest) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "BinaryTest",
		"op":   n.Op.String(),
		"x":    serializeTestExpr(n.X),
		"y":    serializeTestExpr(n.Y),
	})
}

func serializeUnaryTest(n *syntax.UnaryTest) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "UnaryTest",
		"op":   n.Op.String(),
		"x":    serializeTestExpr(n.X),
	})
}

func serializeParenTest(n *syntax.ParenTest) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "ParenTest",
		"x":    serializeTestExpr(n.X),
	})
}

// ─── Supporting leaves ───────────────────────────────────────────────────────

func serializeArrayExpr(n *syntax.ArrayExpr) interface{} {
	if n == nil {
		return nil
	}
	return withPos(n, map[string]interface{}{
		"type":  "ArrayExpr",
		"elems": serializeArrayElems(n.Elems),
		"last":  serializeComments(n.Last),
	})
}

func serializeArrayElem(n *syntax.ArrayElem) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":     "ArrayElem",
		"index":    serializeArithmExpr(n.Index),
		"value":    serializeWord(n.Value),
		"comments": serializeComments(n.Comments),
	})
}

func serializeWordIter(n *syntax.WordIter) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type":  "WordIter",
		"name":  serializeLit(n.Name),
		"items": serializeWords(n.Items),
	})
}

func serializeCStyleLoop(n *syntax.CStyleLoop) map[string]interface{} {
	return withPos(n, map[string]interface{}{
		"type": "CStyleLoop",
		"init": serializeArithmExpr(n.Init),
		"cond": serializeArithmExpr(n.Cond),
		"post": serializeArithmExpr(n.Post),
	})
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
