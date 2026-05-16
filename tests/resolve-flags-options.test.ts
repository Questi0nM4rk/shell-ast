// v0.5.0: resolveFlags accepts an optional opts parameter with
// consumer-provided globalFlags. Consumer's table is MERGED on top of
// the built-in GLOBAL_VALUE_FLAGS (consumer additions win for the same
// flag name, since Set.union has no ordering issue here — flags from
// either source are treated as value-taking).
//
// Also: basename match. firstLit containing "/" strips to basename for
// the table lookup. The `cmd` field preserves the original.

import { describe, expect, test } from "bun:test";
import { findCalls, parse, resolveFlags, unwrapCall } from "../src/index.js";

async function firstCall(src: string) {
  const ast = await parse(src);
  const [c] = findCalls(ast);
  if (!c) throw new Error(`no CallExpr in: ${src}`);
  return c;
}

describe("resolveFlags(call, opts.globalFlags) — consumer-registered tools", () => {
  test("registers a new tool not in the built-in table", async () => {
    const r = resolveFlags(await firstCall("terraform -chdir /tf apply"), {
      globalFlags: { terraform: ["-chdir", "-state"] },
    });
    expect(r?.flags).toEqual(["-chdir"]);
    expect(r?.args).toEqual(["apply"]);
    expect(r?.flagValues).toEqual({ "-chdir": ["/tf"] });
  });

  test("extends an existing tool with additional value-flags", async () => {
    // git built-in table doesn't include "--literal-pathspecs" as value-flag
    // (it's actually a boolean in real git, but for the test we treat it as
    // value-taking to verify merging semantics)
    const r = resolveFlags(await firstCall("git --custom-flag /some/path status"), {
      globalFlags: { git: ["--custom-flag"] },
    });
    expect(r?.flagValues["--custom-flag"]).toEqual(["/some/path"]);
    expect(r?.args).toEqual(["status"]);
  });

  test("unknown tool without opts → legacy boolean-flag behavior", async () => {
    const r = resolveFlags(await firstCall("frobnicate -X /tmp foo"));
    expect(r?.flags).toEqual(["-X"]);
    expect(r?.args).toEqual(["/tmp", "foo"]);
    expect(r?.flagValues).toEqual({});
  });

  test("opts is per-call (no module state)", async () => {
    // first call with opts
    const r1 = resolveFlags(await firstCall("terraform -chdir /tf apply"), {
      globalFlags: { terraform: ["-chdir"] },
    });
    expect(r1?.flagValues).toEqual({ "-chdir": ["/tf"] });

    // second call WITHOUT opts → legacy
    const r2 = resolveFlags(await firstCall("terraform -chdir /tf apply"));
    expect(r2?.flagValues).toEqual({});
    expect(r2?.args).toEqual(["/tf", "apply"]);
  });
});

describe("resolveFlags — basename match for path-shaped tool names", () => {
  test("/usr/bin/git matches the git row in the built-in table", async () => {
    const r = resolveFlags(await firstCall("/usr/bin/git -C /tmp worktree add"));
    expect(r?.cmd).toBe("/usr/bin/git"); // original preserved
    expect(r?.flags).toEqual(["-C"]);
    expect(r?.flagValues).toEqual({ "-C": ["/tmp"] });
    expect(r?.args).toEqual(["worktree", "add"]);
  });

  test("./bin/docker matches the docker row", async () => {
    const r = resolveFlags(await firstCall("./bin/docker -H tcp://x run nginx"));
    expect(r?.cmd).toBe("./bin/docker");
    expect(r?.flagValues).toEqual({ "-H": ["tcp://x"] });
    expect(r?.args).toEqual(["run", "nginx"]);
  });

  test("basename match works with consumer-provided globalFlags too", async () => {
    const r = resolveFlags(await firstCall("/opt/bin/terraform -chdir /tf apply"), {
      globalFlags: { terraform: ["-chdir"] },
    });
    expect(r?.cmd).toBe("/opt/bin/terraform");
    expect(r?.flagValues).toEqual({ "-chdir": ["/tf"] });
  });

  test("bare command without path uses the literal name", async () => {
    const r = resolveFlags(await firstCall("git -C /tmp worktree add"));
    expect(r?.cmd).toBe("git");
    expect(r?.flagValues).toEqual({ "-C": ["/tmp"] });
  });
});

describe("unwrapCall(call, opts) — opts threads through wrapper-stripped inner call", () => {
  test("sudo terraform -chdir /tf apply respects opts on the inner terraform call", async () => {
    const u = unwrapCall(await firstCall("sudo terraform -chdir /tf apply"), {
      globalFlags: { terraform: ["-chdir"] },
    });
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    expect(u.wrapper).toBe("sudo");
    expect(u.cmd).toBe("terraform");
    expect(u.flags).toEqual(["-chdir"]);
    expect(u.args).toEqual(["apply"]);
  });

  test("opts has no effect on the sudo wrapper schema itself", async () => {
    // Even if user tries to register sudo as a "value-flag" tool, the
    // wrapper schema (built into unwrapCall) takes precedence and sudo
    // is still treated as a wrapper, not a regular value-flag tool.
    const u = unwrapCall(await firstCall("sudo git -C /tmp worktree add"), {
      globalFlags: { sudo: ["-u"] },
    });
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    expect(u.wrapper).toBe("sudo");
    expect(u.cmd).toBe("git");
  });
});
