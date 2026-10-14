#!/usr/bin/env bash
# Tarball smoke: the packed package must work for both consumer runtimes.
#
#   Bun:  the "bun" export condition points at src/, so `bun build --compile`
#         sees the `type: "file"` WASM import and embeds the WASM. The binary
#         is moved out, the project deleted, and it must still parse.
#   Node: the "import" condition (dist/) parses from the installed tarball.
#
# Needs a built dist/ (bun run build). Every temp path is removed on exit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sa-tarball-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

cd "$REPO_ROOT"
[ -f dist/index.js ] || { echo "[tarball-smoke] missing dist/index.js: run 'bun run build' first"; exit 2; }
[ -f dist/shell-ast.wasm ] || { echo "[tarball-smoke] missing dist/shell-ast.wasm"; exit 2; }

echo "[tarball-smoke] npm pack"
TGZ="$(npm pack --pack-destination "$WORK" --silent | tail -1)"
[ -f "$WORK/$TGZ" ] || { echo "[tarball-smoke] no tarball produced"; exit 1; }

# --- Bun: compiled binary survives the project being deleted -------------
mkdir "$WORK/bun-proj" "$WORK/elsewhere" "$WORK/bin"
cd "$WORK/bun-proj"
echo '{}' > package.json
bun add "$WORK/$TGZ" >/dev/null 2>&1
cat > entry.ts <<'TS'
import { findCalls, parse, resolveFlags } from "@questi0nm4rk/shell-ast";

const ast = await parse("echo hi | grep h");
console.log(findCalls(ast).map((c) => resolveFlags(c)?.cmd).join(","));
TS
bun build --compile entry.ts --outfile "$WORK/bin/consumer" >/dev/null
cd "$WORK"
rm -rf "$WORK/bun-proj"
OUT="$(cd "$WORK/elsewhere" && "$WORK/bin/consumer")"
[ "$OUT" = "echo,grep" ] || { echo "[tarball-smoke] FAIL bun binary printed: $OUT"; exit 1; }
echo "[tarball-smoke] bun compiled binary OK: $OUT"

# --- Node: dist path -----------------------------------------------------
mkdir "$WORK/node-proj"
cd "$WORK/node-proj"
echo '{"type":"module"}' > package.json
npm install --silent --no-audit --no-fund "$WORK/$TGZ" >/dev/null 2>&1
cat > entry.mjs <<'JS'
import { findCalls, parse, resolveFlags } from "@questi0nm4rk/shell-ast";

const ast = await parse("echo hi | grep h");
console.log(findCalls(ast).map((c) => resolveFlags(c)?.cmd).join(","));
JS
OUT="$(node entry.mjs)"
[ "$OUT" = "echo,grep" ] || { echo "[tarball-smoke] FAIL node printed: $OUT"; exit 1; }
echo "[tarball-smoke] node OK: $OUT"
echo "[tarball-smoke] PASS"
