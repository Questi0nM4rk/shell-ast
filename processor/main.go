//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"mvdan.cc/sh/v3/syntax"
)

func main() {
	js.Global().Set("__shellAstParse", js.FuncOf(parseShell))
	<-make(chan struct{}) // keep WASM alive
}

func parseShell(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("missing source argument")
	}
	src := args[0].String()
	dialect := "bash"
	if len(args) >= 2 {
		dialect = args[1].String()
	}
	splitBraces := false
	if len(args) >= 3 && args[2].Type() == js.TypeBoolean {
		splitBraces = args[2].Bool()
	}

	lang, err := parseDialect(dialect)
	if err != nil {
		return errorResult(err.Error())
	}

	p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(lang))
	f, err := p.Parse(strings.NewReader(src), "")
	if err != nil {
		return syntaxErrorResult(err.Error())
	}

	if splitBraces {
		applySplitBraces(f)
	}

	node := serializeFile(f)
	b, err := json.Marshal(node)
	if err != nil {
		return errorResult("marshal error: " + err.Error())
	}
	return js.ValueOf(string(b))
}


func parseDialect(s string) (syntax.LangVariant, error) {
	switch s {
	case "bash", "":
		return syntax.LangBash, nil
	case "posix":
		return syntax.LangPOSIX, nil
	case "mksh":
		return syntax.LangMirBSDKorn, nil
	default:
		return 0, fmt.Errorf("unknown dialect %q: expected bash, posix, or mksh", s)
	}
}

func errorResult(msg string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"error": msg,
	})
	return string(b)
}

func syntaxErrorResult(msg string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"error":       msg,
		"syntaxError": true,
	})
	return string(b)
}
