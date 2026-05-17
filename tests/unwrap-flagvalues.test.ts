// flagValues + innerRaw on UnwrappedCall — v0.6.0 surface.
//
// flagValues propagates the resolver's value-flag table through
// `unwrapCall` so consumers don't need to fall through to
// `resolveFlags(u.raw, opts)` for the common "what value did flag X
// get?" question. innerRaw exposes the synthetic inner CallExpr for
// wrapped calls so query helpers can compose against it.

import { describe, expect, test } from "bun:test";
import { findCalls, parse, unwrapCall, wordToLit } from "../src/index.js";
import { testCmd } from "./_assertions.js";

describe("flagValues on plain", () => {
  testCmd("git -C /tmp worktree add /tmp/x", {
    cmd: "git",
    flagValues: { "-C": ["/tmp"] },
    args: ["worktree", "add", "/tmp/x"],
  });

  testCmd("docker -H tcp://prod:2375 run nginx", {
    cmd: "docker",
    flagValues: { "-H": ["tcp://prod:2375"] },
  });

  testCmd("git -c k1=v1 -C /tmp -c k2=v2 status", {
    cmd: "git",
    flagValues: { "-c": ["k1=v1", "k2=v2"], "-C": ["/tmp"] },
  });

  testCmd("gcc -o /tmp/x src.c", {
    cmd: "gcc",
    flagValues: {},
  });

  testCmd("rm -rf /tmp/x", {
    cmd: "rm",
    flagValues: {},
  });
});

describe("flagValues on wrapped — INNER call semantics", () => {
  testCmd("sudo git -C /tmp worktree add", {
    wrapper: "sudo",
    cmd: "git",
    flagValues: { "-C": ["/tmp"] },
  });

  testCmd("sudo -u root git -C /repo status", {
    wrapper: "sudo",
    cmd: "git",
    flagValues: { "-C": ["/repo"] },
  });

  testCmd("doas docker -H tcp://prod run nginx", {
    wrapper: "doas",
    cmd: "docker",
    flagValues: { "-H": ["tcp://prod"] },
  });

  testCmd("sudo gcc -o /tmp/x src.c", {
    wrapper: "sudo",
    cmd: "gcc",
    flagValues: {},
  });
});

describe("flagValues with opts.globalFlags — threaded through unwrap", () => {
  test("plain gcc with consumer-registered -o", async () => {
    const ast = await parse("gcc -o /tmp/x src.c");
    const u = unwrapCall(findCalls(ast)[0]!, { globalFlags: { gcc: ["-o"] } });
    expect(u?.kind).toBe("plain");
    if (u?.kind !== "plain") return;
    expect(u.flagValues).toEqual({ "-o": ["/tmp/x"] });
    expect(u.args).toEqual(["src.c"]);
  });

  test("sudo gcc with consumer-registered -o — inner picks it up", async () => {
    const ast = await parse("sudo gcc -o /tmp/x src.c");
    const u = unwrapCall(findCalls(ast)[0]!, { globalFlags: { gcc: ["-o"] } });
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    expect(u.flagValues).toEqual({ "-o": ["/tmp/x"] });
    expect(u.args).toEqual(["src.c"]);
  });

  test("terraform — opts merges with built-in table", async () => {
    const ast = await parse("terraform -chdir /tf apply");
    const u = unwrapCall(findCalls(ast)[0]!, {
      globalFlags: { terraform: ["-chdir"] },
    });
    expect(u?.kind).toBe("plain");
    if (u?.kind !== "plain") return;
    expect(u.flagValues).toEqual({ "-chdir": ["/tf"] });
    expect(u.args).toEqual(["apply"]);
  });
});

describe("innerRaw on wrapped — synthetic inner CallExpr exposed", () => {
  testCmd("sudo git -C /tmp worktree add", {
    wrapper: "sudo",
    cmd: "git",
    innerRaw: { cmdLit: "git", flagsLit: ["-C"] },
  });

  testCmd("doas /usr/bin/git status", {
    wrapper: "doas",
    cmd: "/usr/bin/git",
    innerRaw: { cmdLit: "/usr/bin/git" },
  });

  // innerRaw preserves the RAW token shape — `-rf` stays combined.
  // resolveFlags would split it to ["-r", "-f"] in u.flags, but
  // innerRaw.args is the AST node, not the post-resolve view.
  testCmd("sudo rm -rf /tmp/x", {
    wrapper: "sudo",
    cmd: "rm",
    innerRaw: { cmdLit: "rm", flagsLit: ["-rf"] },
  });

  test("innerRaw arg count matches inner-cmd positionals", async () => {
    const ast = await parse("sudo git -C /tmp worktree add");
    const u = unwrapCall(findCalls(ast)[0]!);
    if (u?.kind !== "wrapped") throw new Error("expected wrapped");
    // git + -C + /tmp + worktree + add = 5 args (cmd is args[0])
    expect(u.innerRaw.args.length).toBe(5);
    expect(wordToLit(u.innerRaw.args[0]!)).toBe("git");
    expect(wordToLit(u.innerRaw.args[1]!)).toBe("-C");
    expect(wordToLit(u.innerRaw.args[2]!)).toBe("/tmp");
  });

  test("u.raw is the OUTER call (sudo), u.innerRaw is the INNER (git)", async () => {
    const ast = await parse("sudo -u root git -C /tmp status");
    const u = unwrapCall(findCalls(ast)[0]!);
    if (u?.kind !== "wrapped") throw new Error("expected wrapped");
    expect(wordToLit(u.raw.args[0]!)).toBe("sudo");
    expect(wordToLit(u.innerRaw.args[0]!)).toBe("git");
  });
});

describe("plain (wrapper-named, no inner) — flagValues still populated", () => {
  // bash --version is a wrapper-named call used non-wrapper-ly → "plain"
  testCmd("bash --version", {
    cmd: "bash",
    kind: "plain",
    flagValues: {}, // bash isn't in GLOBAL_VALUE_FLAGS; --version isn't value-taking
  });
});
