import { describe, expect, test } from "bun:test";
import { findCalls, resolveFlags, wordToLit } from "../src/helpers.js";
import type { CallExprNode, ShellFile, Word } from "../src/types.js";
import { walk } from "../src/walk.js";
import {
  makeCall,
  makeFile,
  makeLit,
  makePos,
  makeStmt,
  makeWord,
} from "./_factories.js";

// ─── wordToLit tests ──────────────────────────────────────────────────────────

describe("wordToLit", () => {
  test("returns value for single-Lit word", () => {
    const w = makeWord("hello");
    expect(wordToLit(w)).toBe("hello");
  });

  test("returns null for multi-part word (dynamic)", () => {
    const w: Word = {
      type: "Word",
      parts: [makeLit("hello"), makeLit("world")],
      pos: makePos(),
      end: makePos(),
    };
    expect(wordToLit(w)).toBeNull();
  });

  test("returns null for non-Lit part", () => {
    const w: Word = {
      type: "Word",
      parts: [
        {
          type: "ParamExp",
          short: true,
          excl: false,
          length: false,
          width: false,
          param: makeLit("name"),
          index: null,
          slice: null,
          repl: null,
          exp: null,
          names: "",
          pos: makePos(),
          end: makePos(),
        },
      ],
      pos: makePos(),
      end: makePos(),
    };
    expect(wordToLit(w)).toBeNull();
  });
});

// ─── resolveFlags tests ───────────────────────────────────────────────────────

describe("resolveFlags", () => {
  test("resolves simple command with no flags", () => {
    const call = makeCall("echo", "hello");
    const result = resolveFlags(call);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe("echo");
    expect(result!.flags).toEqual([]);
    expect(result!.args).toEqual(["hello"]);
  });

  test("resolves long flags", () => {
    const call = makeCall("git", "push", "--force");
    const result = resolveFlags(call);
    expect(result!.cmd).toBe("git");
    expect(result!.flags).toContain("--force");
    expect(result!.args).toEqual(["push"]);
  });

  test("splits combined short flags: -rf → [-r, -f]", () => {
    const call = makeCall("rm", "-rf", "/");
    const result = resolveFlags(call);
    expect(result!.cmd).toBe("rm");
    expect(result!.flags).toContain("-r");
    expect(result!.flags).toContain("-f");
    expect(result!.flags).not.toContain("-rf");
    expect(result!.args).toEqual(["/"]);
  });

  test("respects -- end-of-flags marker", () => {
    const call = makeCall("cmd", "--", "-not-a-flag");
    const result = resolveFlags(call);
    expect(result!.flags).toEqual([]);
    expect(result!.args).toEqual(["-not-a-flag"]);
  });

  test("returns null for empty args", () => {
    const call: CallExprNode = {
      type: "CallExpr",
      assigns: [],
      args: [],
      pos: makePos(),
      end: makePos(),
    };
    expect(resolveFlags(call)).toBeNull();
  });

  test("returns null if first arg is dynamic (ParamExp)", () => {
    const dynamicWord: Word = {
      type: "Word",
      parts: [
        {
          type: "ParamExp",
          short: true,
          excl: false,
          length: false,
          width: false,
          param: makeLit("cmd"),
          index: null,
          slice: null,
          repl: null,
          exp: null,
          names: "",
          pos: makePos(),
          end: makePos(),
        },
      ],
      pos: makePos(),
      end: makePos(),
    };
    const call: CallExprNode = {
      type: "CallExpr",
      assigns: [],
      args: [dynamicWord],
      pos: makePos(),
      end: makePos(),
    };
    expect(resolveFlags(call)).toBeNull();
  });

  test("marks dynamic arguments as <dynamic>", () => {
    const call: CallExprNode = {
      type: "CallExpr",
      assigns: [],
      args: [
        makeWord("echo"),
        {
          type: "Word",
          parts: [
            {
              type: "CmdSubst",
              stmts: [],
              last: [],
              backquotes: false,
              tempFile: false,
              replyVar: false,
              pos: makePos(),
              end: makePos(),
            },
          ],
          pos: makePos(),
          end: makePos(),
        },
      ],
      pos: makePos(),
      end: makePos(),
    };
    const result = resolveFlags(call);
    expect(result!.args).toEqual(["<dynamic>"]);
  });
});

// ─── findCalls tests ──────────────────────────────────────────────────────────

describe("findCalls", () => {
  test("finds single call in file", () => {
    const ast = makeFile(makeCall("echo", "hello"));
    const calls = findCalls(ast);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("CallExpr");
  });

  test("finds multiple calls in file", () => {
    const ast = makeFile(makeCall("echo", "foo"), makeCall("rm", "-rf", "/tmp/x"));
    const calls = findCalls(ast);
    expect(calls).toHaveLength(2);
  });

  test("returns empty array for file with no stmts", () => {
    const ast = makeFile();
    expect(findCalls(ast)).toHaveLength(0);
  });
});

// ─── walk tests ───────────────────────────────────────────────────────────────

describe("walk", () => {
  test("visits File node", () => {
    const ast = makeFile();
    let visited = false;
    walk(ast, {
      File() {
        visited = true;
      },
    });
    expect(visited).toBe(true);
  });

  test("visits nested CallExpr nodes", () => {
    const ast = makeFile(makeCall("echo", "a"), makeCall("rm", "b"));
    const cmds: string[] = [];
    walk(ast, {
      CallExpr(node) {
        const first = node.args[0];
        if (first) {
          const lit = first.parts[0];
          if (lit?.type === "Lit") cmds.push(lit.value);
        }
      },
    });
    expect(cmds).toEqual(["echo", "rm"]);
  });

  test("skip return stops descent", () => {
    const inner = makeCall("nested");
    const outerFile: ShellFile = {
      type: "File",
      name: "",
      stmts: [makeStmt(inner)],
      last: [],
      pos: makePos(),
      end: makePos(),
    };
    let callVisited = false;
    walk(outerFile, {
      File: () => "skip",
      CallExpr() {
        callVisited = true;
      },
    });
    expect(callVisited).toBe(false);
  });

  test("visits Word parts", () => {
    const ast = makeFile(makeCall("echo", "hello"));
    const lits: string[] = [];
    walk(ast, {
      Lit(node) {
        lits.push(node.value);
      },
    });
    expect(lits).toContain("echo");
    expect(lits).toContain("hello");
  });
});
