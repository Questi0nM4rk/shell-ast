// v0.5.0: `flagValues` field on ResolvedCall preserves the values that
// were consumed by value-taking global flags. Populated by resolveFlags
// when the matching tool is in GLOBAL_VALUE_FLAGS (or the consumer's
// globalFlags option).
//
// Shape: Record<string, ResolvedArg[]>
//   - Same flag appearing multiple times → all values appended in order
//   - Both space form (`-C /tmp`) and = form (`--git-dir=/repo`) populate
//   - Dynamic values appear as DYNAMIC
//   - Empty record when no value-flags matched

import { describe, expect, test } from "bun:test";
import { DYNAMIC, findCalls, parse, resolveFlags } from "../src/index.js";

async function firstCall(src: string) {
  const ast = await parse(src);
  const [c] = findCalls(ast);
  if (!c) throw new Error(`no CallExpr in: ${src}`);
  return c;
}

describe("flagValues — space form", () => {
  test("single value-flag populated", async () => {
    const r = resolveFlags(await firstCall("git -C /tmp worktree add"));
    expect(r?.flagValues).toEqual({ "-C": ["/tmp"] });
  });

  test("multiple distinct value-flags populated", async () => {
    const r = resolveFlags(await firstCall("git -c key=val -C /tmp status"));
    expect(r?.flagValues).toEqual({ "-c": ["key=val"], "-C": ["/tmp"] });
  });

  test("same value-flag repeated → array of all values in order", async () => {
    const r = resolveFlags(await firstCall("git -c k1=v1 -c k2=v2 status"));
    expect(r?.flagValues).toEqual({ "-c": ["k1=v1", "k2=v2"] });
  });

  test("value-flag at end with no value → flag is kept, flagValues entry absent", async () => {
    const r = resolveFlags(await firstCall("git -C"));
    expect(r?.flags).toEqual(["-C"]);
    expect(r?.flagValues).toEqual({});
  });
});

describe("flagValues — = form (joined)", () => {
  test("--git-dir=/repo populates flagValues with the value", async () => {
    const r = resolveFlags(await firstCall("git --git-dir=/repo status"));
    expect(r?.flagValues).toEqual({ "--git-dir": ["/repo"] });
    // The original token also stays in flags for backward compat
    expect(r?.flags).toEqual(["--git-dir=/repo"]);
  });

  test("mixed = and space forms populate same key", async () => {
    const r = resolveFlags(await firstCall("git --git-dir=/a --git-dir /b status"));
    expect(r?.flagValues).toEqual({ "--git-dir": ["/a", "/b"] });
  });

  test("= form value can contain another =", async () => {
    const r = resolveFlags(await firstCall("git -c color.ui=auto status"));
    expect(r?.flagValues).toEqual({ "-c": ["color.ui=auto"] });
  });
});

describe("flagValues — dynamic values", () => {
  test('git -C "$DIR" produces DYNAMIC in flagValues', async () => {
    const r = resolveFlags(await firstCall('git -C "$DIR" worktree add'));
    expect(r?.flagValues["-C"]).toEqual([DYNAMIC]);
  });

  test("dynamic and literal values can mix for repeated flags", async () => {
    const r = resolveFlags(await firstCall('git -c k=v -c "$X" status'));
    expect(r?.flagValues["-c"]).toEqual(["k=v", DYNAMIC]);
  });
});

describe("flagValues — empty / unmatched cases", () => {
  test("plain command with no value-flags → empty flagValues", async () => {
    const r = resolveFlags(await firstCall("ls -la /tmp"));
    expect(r?.flagValues).toEqual({});
  });

  test("unknown tool → empty flagValues (no table for it)", async () => {
    const r = resolveFlags(await firstCall("frobnicate -X /tmp foo"));
    expect(r?.flagValues).toEqual({});
  });

  test("git push --force (no value-flags fire) → empty flagValues", async () => {
    const r = resolveFlags(await firstCall("git push --force origin main"));
    expect(r?.flagValues).toEqual({});
  });
});

describe("flagValues — integration with existing fields", () => {
  test("flags and args still hold their existing shape", async () => {
    const r = resolveFlags(await firstCall("git -C /tmp push --force origin main"));
    expect(r?.cmd).toBe("git");
    expect(r?.flags).toEqual(["-C", "--force"]);
    expect(r?.args).toEqual(["push", "origin", "main"]);
    expect(r?.flagValues).toEqual({ "-C": ["/tmp"] });
  });
});
