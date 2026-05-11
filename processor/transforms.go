package main

import "mvdan.cc/sh/v3/syntax"

// applySplitBraces walks the file and turns each Word's brace-expansion
// literals (e.g. "{a,b,c}") into BraceExp nodes. Returns false on the
// Word visitor so Walk doesn't try to descend into BraceExp — its
// switch panics on that node type.
func applySplitBraces(f *syntax.File) {
	syntax.Walk(f, func(node syntax.Node) bool {
		if w, ok := node.(*syntax.Word); ok {
			syntax.SplitBraces(w)
			return false
		}
		return true
	})
}
