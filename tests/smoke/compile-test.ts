// Smoke test that verifies a `bun build --compile`d binary can locate
// its bundled WASM at runtime. Catches BUG-001 (path baked into binary
// via import.meta.dirname).
//
// Run via:
//   bun build tests/smoke/compile-test.ts --compile --bytecode --outfile /tmp/sa-smoke
//   cp /tmp/sa-smoke /tmp/elsewhere-sa-smoke
//   /tmp/elsewhere-sa-smoke
//
// The copy + run-from-elsewhere step is essential — running the binary
// from inside the build tree masks the bug because relative paths
// happen to still resolve.

import { findCalls, parse } from "../../src/index.js";

async function main(): Promise<void> {
  const ast = await parse("rm -rf /");
  const [call] = findCalls(ast);
  const part = call?.args[0]?.parts[0];

  if (part?.type !== "Lit" || part.value !== "rm") {
    console.error(`FAIL: expected first arg to be Lit("rm"), got`, part);
    process.exit(1);
  }

  const ast2 = await parse("sudo -u root rm -rf /");
  const calls2 = findCalls(ast2);
  if (calls2.length !== 1) {
    console.error(`FAIL: expected 1 call, got ${calls2.length}`);
    process.exit(1);
  }

  console.log("OK");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
