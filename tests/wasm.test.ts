import { describe, expect, test } from "bun:test";
import { loadWasm } from "../src/wasm.js";

describe("loadWasm", () => {
  test("repeated calls return the same Promise reference", async () => {
    await loadWasm();
    const p1 = loadWasm();
    const p2 = loadWasm();
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
  });

  test("concurrent calls share one Promise", async () => {
    const promises = Array.from({ length: 10 }, () => loadWasm());
    await Promise.all(promises);
    for (const p of promises) expect(p).toBe(promises[0]);
  });
});
