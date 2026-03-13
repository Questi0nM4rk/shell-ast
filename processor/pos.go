package main

import "mvdan.cc/sh/v3/syntax"

// NodePos mirrors syntax.Pos for JSON serialization.
type NodePos struct {
	Offset uint `json:"offset"`
	Line   uint `json:"line"`
	Col    uint `json:"col"`
}

func nodePos(p syntax.Pos) NodePos {
	return NodePos{
		Offset: p.Offset(),
		Line:   p.Line(),
		Col:    p.Col(),
	}
}
