package main

import "mvdan.cc/sh/v3/syntax"

// Interface-typed dispatchers. mvdan/sh's Command, WordPart, ArithmExpr,
// TestExpr, and Loop are interfaces — each call site that has one of
// these types calls into the matching dispatcher to emit a JSON shape.
//
// nil inputs return nil so callers don't need to nil-check before
// calling. Unknown concrete types degrade to {type: "Unknown", pos, end}
// for WordPart (the only dispatcher with a non-nil fallback) so that
// future mvdan/sh additions surface in the JSON instead of silently
// dropping.

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
		return withPos(n, map[string]interface{}{"type": "Unknown"})
	}
}

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
