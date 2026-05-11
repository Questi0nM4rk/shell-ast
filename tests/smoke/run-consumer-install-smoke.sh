#!/usr/bin/env bash
# Consumer-install smoke test for gh issue #5 (v0.2.0 regression).
#
# Packs the package via `bun pm pack`, installs the tarball into a
# throwaway scratch directory, and runs a consumer script from THAT
# directory. The bundled `dist/index.js` must resolve its wasm
# anchored to the module location, not to process.cwd().
#
# This catches the v0.2.0 class of bug where `with { type: "file" }`
# was emitting a CWD-relative literal — every consumer outside the
# package directory ENOENT'd on first parse().

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="${TMPDIR:-/tmp}/sa-consumer-$$"
TGZ_NAME=""

cleanup() {
  local rc=$?
  rm -rf "$SCRATCH"
  [ -n "$TGZ_NAME" ] && rm -f "$REPO_ROOT/$TGZ_NAME"
  exit "$rc"
}
trap cleanup EXIT

cd "$REPO_ROOT"

# Preconditions: a built dist must exist.
[ -f dist/index.js ] || { echo "[consumer-smoke] missing dist/index.js — run 'bun run build' first"; exit 2; }
[ -f dist/shell-ast.wasm ] || { echo "[consumer-smoke] missing dist/shell-ast.wasm"; exit 2; }

echo "[consumer-smoke] packing tarball"
PACK_OUTPUT=$(bun pm pack 2>&1)
TGZ_NAME=$(echo "$PACK_OUTPUT" | grep -oE 'questi0nm4rk-shell-ast-[0-9.]+\.tgz' | head -1)
[ -n "$TGZ_NAME" ] || { echo "[consumer-smoke] couldn't determine tarball name from: $PACK_OUTPUT"; exit 1; }

echo "[consumer-smoke] scratch dir: $SCRATCH"
mkdir -p "$SCRATCH"
command cp "$REPO_ROOT/$TGZ_NAME" "$SCRATCH/sa.tgz"

cd "$SCRATCH"
echo '{}' > package.json
echo "[consumer-smoke] installing from tarball"
bun add ./sa.tgz >/dev/null 2>&1

cat > repro.ts <<'TS'
import { parse, findCalls, resolveFlags } from "@questi0nm4rk/shell-ast";
import { unwrapCall } from "@questi0nm4rk/shell-ast/semantic";

const ast = await parse("rm -rf /; sudo -u root rm /");
const calls = findCalls(ast);
if (calls.length !== 2) {
  console.error(`FAIL: expected 2 calls, got ${calls.length}`);
  process.exit(1);
}
const first = resolveFlags(calls[0]!);
if (first?.cmd !== "rm") {
  console.error(`FAIL: expected first cmd "rm", got ${first?.cmd}`);
  process.exit(1);
}
const second = unwrapCall(calls[1]!);
if (second?.wrapper !== "sudo" || second?.cmd !== "rm") {
  console.error(`FAIL: expected sudo->rm, got wrapper=${second?.wrapper} cmd=${second?.cmd}`);
  process.exit(1);
}
console.log("OK");
TS

echo "[consumer-smoke] running consumer script from $SCRATCH (not the repo)"
bun run repro.ts
echo "[consumer-smoke] PASS"
