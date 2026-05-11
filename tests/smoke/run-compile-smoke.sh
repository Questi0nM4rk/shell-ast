#!/usr/bin/env bash
# Compile-binary smoke test for BUG-001.
#
# Builds tests/smoke/compile-test.ts as a `bun build --compile` binary,
# copies it outside the build tree, then deliberately moves `dist/` aside
# so any path baked into the binary by import.meta.dirname can no longer
# resolve. The binary must still locate its WASM via embedded assets.
#
# Returns 0 if the binary loads WASM correctly without `dist/` on disk.
# Returns non-zero (the binary's exit code) otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${TMPDIR:-/tmp}/sa-smoke-$$"
ELSEWHERE="${TMPDIR:-/tmp}/sa-smoke-elsewhere-$$"
DIST_SAVED="${TMPDIR:-/tmp}/sa-dist-saved-$$"
SHIM_SAVED="${TMPDIR:-/tmp}/sa-shim-saved-$$"

cleanup() {
  local rc=$?
  # Restore originals. If something recreated dist/ or shim mid-run, prefer
  # the saved (pre-move) copy and warn — silent leak in $TMPDIR otherwise.
  if [ -e "$DIST_SAVED" ]; then
    [ -e "$REPO_ROOT/dist" ] && { echo "[smoke] warning: dist/ recreated mid-run; restoring saved copy"; rm -rf "$REPO_ROOT/dist"; }
    mv "$DIST_SAVED" "$REPO_ROOT/dist"
  fi
  if [ -e "$SHIM_SAVED" ]; then
    [ -e "$REPO_ROOT/src/wasm_exec.js" ] && { echo "[smoke] warning: shim recreated mid-run; restoring saved copy"; rm -f "$REPO_ROOT/src/wasm_exec.js"; }
    mv "$SHIM_SAVED" "$REPO_ROOT/src/wasm_exec.js"
  fi
  rm -f "$BIN" "$ELSEWHERE"
  exit "$rc"
}
trap cleanup EXIT

cd "$REPO_ROOT"

# Preconditions — if assets aren't built we'd fail with a confusing
# "binary couldn't load" instead of a clear "build first".
[ -f "$REPO_ROOT/dist/shell-ast.wasm" ] || { echo "[smoke] missing dist/shell-ast.wasm — run 'bun run build:wasm' first"; exit 2; }
[ -f "$REPO_ROOT/src/wasm_exec.js" ] || { echo "[smoke] missing src/wasm_exec.js — copy from \$(go env GOROOT)/lib/wasm/wasm_exec.js"; exit 2; }

echo "[smoke] building compile-test.ts -> $BIN"
bun build tests/smoke/compile-test.ts --compile --bytecode --outfile "$BIN" >/dev/null

echo "[smoke] copying binary to $ELSEWHERE"
command cp "$BIN" "$ELSEWHERE"

echo "[smoke] moving dist/ and src/wasm_exec.js aside"
mv "$REPO_ROOT/dist" "$DIST_SAVED"
mv "$REPO_ROOT/src/wasm_exec.js" "$SHIM_SAVED"

echo "[smoke] running binary from /tmp with no dist/ on disk"
cd /
"$ELSEWHERE"
RC=$?

echo "[smoke] binary exit=$RC"
exit "$RC"
