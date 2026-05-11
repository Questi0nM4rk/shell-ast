package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// FuzzSerialize runs random shell strings through mvdan/sh's parser
// and our serializer. It catches three failure classes:
//   1. serialize* panics on a parser-accepted but rare AST shape
//   2. json.Marshal fails on the resulting map
//   3. the dispatcher hits its "Unknown" fallback — i.e. mvdan/sh
//      produces a node type our switches don't handle
//
// Seed corpus is hand-picked to cover every node type the serializer
// handles. The fuzzer mutates those bytes to explore the parser's
// accepted-input space.
//
// Run a quick pass:  go test -run=^$ -fuzz=FuzzSerialize -fuzztime=30s
func FuzzSerialize(f *testing.F) {
	seeds := []string{
		// CallExpr / BinaryCmd
		"echo hello",
		"rm -rf /",
		"cat /etc/passwd | grep root | wc -l",
		"make && rm -rf / || echo done",
		// Redirects
		"echo > /tmp/a 2>&1",
		"cat <<EOF\nhello\nEOF",
		"echo <<<here-string",
		// Subshell / Block
		"(cd /tmp && rm *)",
		"{ echo a; rm b; }",
		// IfClause / WhileClause / ForClause / CaseClause
		"if true; then rm; elif false; then echo; else cat; fi",
		"while :; do break; done",
		"until false; do continue; done",
		"for f in *; do rm $f; done",
		"for ((i=0; i<10; i++)); do echo $i; done",
		"case x in y) echo;; *) rm;; esac",
		// FuncDecl
		"foo() { echo; }",
		"function bar { echo; }",
		// Word parts
		`echo "hello $name"`,
		`echo 'single quoted'`,
		`echo $(date) $(uname -a)`,
		`echo $((1 + 2 * 3))`,
		`echo "${var}" "${var:-default}" "${var/old/new}" "${var:1:3}" "${!prefix@}"`,
		`diff <(ls a) <(ls b)`,
		`echo @(foo|bar) ?(x) *(y) +(z) !(w)`,
		// Arrays
		"arr=(a b c)",
		"arr=([0]=a [1]=b)",
		"declare -A m=([k]=v)",
		// Tests
		"[[ -f x && -d y || ! -z $a ]]",
		"[[ $x =~ ^foo ]]",
		"[ -e x ]",
		// ArithmCmd / TimeClause / LetClause / CoprocClause
		"((x++))",
		"time ls /",
		"let x=1+2 y=3*4",
		"coproc cat",
		// Background / negated / assignment-prefix
		"rm -rf / &",
		"! rm",
		"FOO=bar rm",
		// Privilege escalators (semantic.ts cares about these)
		"sudo -u root rm -rf /",
		`su user -c "rm -rf /"`,
		"pkexec --user root rm",
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, src string) {
		// Cap input size: the fuzzer otherwise explores multi-MB
		// blobs that parse slowly and don't add coverage.
		if len(src) > 10_000 {
			t.Skip()
		}

		p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(syntax.LangBash))
		file, err := p.Parse(strings.NewReader(src), "")
		if err != nil {
			return // not valid shell — that's fine, parser said so
		}

		// Serialize must not panic. We can't recover() here because
		// a panic is what the fuzzer wants to catch — re-raise via
		// the goroutine's default behavior.
		result := serializeFile(file)

		b, err := json.Marshal(result)
		if err != nil {
			t.Fatalf("marshal failed for %q: %v", src, err)
		}

		// The dispatcher's "Unknown" fallback means a node type
		// reached serializeWordPart that wasn't in the switch — i.e.
		// mvdan/sh added a WordPart type we don't handle.
		if bytes.Contains(b, []byte(`"type":"Unknown"`)) {
			t.Fatalf("Unknown node type produced for %q\n%s", src, b)
		}

		// Round-trip: serialize → JSON → parse JSON. Catches any
		// non-marshalable value snuck into the map (channels, funcs,
		// cycles).
		var roundtrip map[string]interface{}
		if err := json.Unmarshal(b, &roundtrip); err != nil {
			t.Fatalf("round-trip unmarshal failed for %q: %v", src, err)
		}
	})
}

// Also test the SplitBraces post-pass — fuzz that path separately
// since brace expansion exercises the BraceExp serializer which
// mvdan/sh's Walk panics on (we work around in transforms.go).
func FuzzSerializeWithSplitBraces(f *testing.F) {
	seeds := []string{
		"echo {a,b,c}",
		"echo {1..5}",
		"echo {1..10..2}",
		"echo a{x,y}b",
		"echo {a,b}{c,d}",
		"echo prefix.{a,b,c}.suffix",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, src string) {
		if len(src) > 10_000 {
			t.Skip()
		}
		p := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(syntax.LangBash))
		file, err := p.Parse(strings.NewReader(src), "")
		if err != nil {
			return
		}
		applySplitBraces(file)
		b, err := json.Marshal(serializeFile(file))
		if err != nil {
			t.Fatalf("marshal failed for %q: %v", src, err)
		}
		if bytes.Contains(b, []byte(`"type":"Unknown"`)) {
			t.Fatalf("Unknown node type produced for %q\n%s", src, b)
		}
	})
}
