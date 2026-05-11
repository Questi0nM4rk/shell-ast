// Coverage for the new walker-based extractors (audit C8).

import { describe, expect, test } from "bun:test";
import {
  findAssignments,
  findCalls,
  findCmdSubstitutions,
  findFunctions,
  findRedirects,
  parse,
} from "../src/index.js";

describe("findRedirects", () => {
  test("collects every redirect across the tree", async () => {
    const ast = await parse(
      "echo a > /tmp/a 2>&1; cat < /tmp/a | tee /tmp/b; echo c >> /tmp/c"
    );
    const redirs = findRedirects(ast);
    const ops = redirs.map((r) => r.op);
    expect(ops).toContain(">");
    expect(ops).toContain(">&");
    expect(ops).toContain("<");
    expect(ops).toContain(">>");
    expect(redirs.length).toBe(4);
  });

  test("walks redirects inside functions", async () => {
    const ast = await parse("foo() { echo > /tmp/x; }");
    expect(findRedirects(ast)).toHaveLength(1);
  });

  test("returns empty array for source without redirects", async () => {
    const ast = await parse("echo hi");
    expect(findRedirects(ast)).toEqual([]);
  });
});

describe("findAssignments", () => {
  test("collects bare assignments and prefix assignments", async () => {
    const ast = await parse("FOO=bar; BAZ=qux rm -rf /; arr=(a b)");
    const assigns = findAssignments(ast);
    const names = assigns.map((a) => a.name?.value);
    expect(names).toEqual(["FOO", "BAZ", "arr"]);
  });

  test("walks declarations inside functions", async () => {
    const ast = await parse("foo() { local x=1; }");
    expect(findAssignments(ast).length).toBeGreaterThan(0);
  });
});

describe("findFunctions", () => {
  test("collects every function declaration", async () => {
    const ast = await parse("foo() { :; }; bar() { :; }; baz() { foo; bar; }");
    const fns = findFunctions(ast);
    expect(fns.map((f) => f.name.value)).toEqual(["foo", "bar", "baz"]);
  });

  test("returns empty for source with no functions", async () => {
    const ast = await parse("echo hi");
    expect(findFunctions(ast)).toEqual([]);
  });
});

describe("findCmdSubstitutions", () => {
  test("collects $(...)", async () => {
    const ast = await parse("echo $(date) $(uname -a)");
    expect(findCmdSubstitutions(ast)).toHaveLength(2);
  });

  test("collects nested $($(...))", async () => {
    const ast = await parse("echo $(echo $(date))");
    const subs = findCmdSubstitutions(ast);
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });

  test("collects backquote `cmd` form", async () => {
    const ast = await parse("echo `date`");
    const subs = findCmdSubstitutions(ast);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.backquotes).toBe(true);
  });
});

describe("findCalls", () => {
  // Existing parse.test.ts covers the basic case; this verifies the
  // shape stays right after the C4 module split.
  test("returns CallExpr nodes in source order", async () => {
    const ast = await parse("a; b; c");
    expect(findCalls(ast)).toHaveLength(3);
  });
});
