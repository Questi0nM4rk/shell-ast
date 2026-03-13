import { describe, expect, test } from "bun:test";
import { unwrapCall } from "../src/semantic.js";
import type { CallExprNode, LitNode, NodePos, Word } from "../src/types.js";

function makePos(offset = 0, line = 1, col = 1): NodePos {
  return { offset, line, col };
}

function makeLit(value: string): LitNode {
  return { type: "Lit", value, pos: makePos(), end: makePos() };
}

function makeWord(...lits: string[]): Word {
  return {
    type: "Word",
    parts: lits.map(makeLit),
    pos: makePos(),
    end: makePos(),
  };
}

function makeCall(...args: string[]): CallExprNode {
  return {
    type: "CallExpr",
    assigns: [],
    args: args.map((a) => makeWord(a)),
    pos: makePos(),
    end: makePos(),
  };
}

describe("unwrapCall", () => {
  test("non-escalator command returns wrapper: null", () => {
    const call = makeCall("rm", "-rf", "/");
    const result = unwrapCall(call);
    expect(result).not.toBeNull();
    expect(result!.wrapper).toBeNull();
    expect(result!.cmd).toBe("rm");
    expect(result!.flags).toContain("-r");
    expect(result!.flags).toContain("-f");
    expect(result!.args).toEqual(["/"]);
  });

  test("sudo without flag-arg pairs", () => {
    const call = makeCall("sudo", "rm", "-rf", "/");
    const result = unwrapCall(call);
    expect(result).not.toBeNull();
    expect(result!.wrapper).toBe("sudo");
    expect(result!.cmd).toBe("rm");
    expect(result!.flags).toContain("-r");
    expect(result!.flags).toContain("-f");
    expect(result!.args).toEqual(["/"]);
  });

  test("sudo -u root rm -rf /", () => {
    const call = makeCall("sudo", "-u", "root", "rm", "-rf", "/");
    const result = unwrapCall(call);
    expect(result).not.toBeNull();
    expect(result!.wrapper).toBe("sudo");
    expect(result!.cmd).toBe("rm");
    expect(result!.flags).toContain("-r");
    expect(result!.flags).toContain("-f");
    expect(result!.args).toEqual(["/"]);
  });

  test("sudo -n rm file (short boolean flag, no arg)", () => {
    const call = makeCall("sudo", "-n", "rm", "file");
    const result = unwrapCall(call);
    expect(result!.wrapper).toBe("sudo");
    expect(result!.cmd).toBe("rm");
    expect(result!.args).toEqual(["file"]);
  });

  test("doas rm -rf /", () => {
    const call = makeCall("doas", "rm", "-rf", "/");
    const result = unwrapCall(call);
    expect(result!.wrapper).toBe("doas");
    expect(result!.cmd).toBe("rm");
  });

  test("sudo with only own flags (no real command) returns null", () => {
    const call = makeCall("sudo", "-u", "root");
    const result = unwrapCall(call);
    expect(result).toBeNull();
  });

  test("returns null for empty call", () => {
    const call: CallExprNode = {
      type: "CallExpr",
      assigns: [],
      args: [],
      pos: makePos(),
      end: makePos(),
    };
    expect(unwrapCall(call)).toBeNull();
  });

  test("preserves raw reference to original call", () => {
    const call = makeCall("sudo", "rm", "/");
    const result = unwrapCall(call);
    expect(result!.raw).toBe(call);
  });
});
