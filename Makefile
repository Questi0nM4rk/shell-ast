WASM_OUT := dist/shell-ast.wasm
GO_SRC    := $(shell find processor -name '*.go' -not -name '*_test.go')

.PHONY: build build-wasm build-ts test test-go test-ts typecheck lint clean

build: build-wasm build-ts

build-wasm: $(WASM_OUT)

$(WASM_OUT): $(GO_SRC)
	mkdir -p dist
	GOOS=js GOARCH=wasm go build -o $(WASM_OUT) ./processor
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" src/wasm_exec.js

build-ts:
	bun run tsc --noEmit
	bun build src/index.ts --outdir dist --target node

test: test-go test-ts

test-go:
	go test ./processor/... -v

test-ts:
	bun test

typecheck:
	bun run tsc --noEmit

lint:
	bun run biome check src/ tests/

clean:
	rm -rf dist
