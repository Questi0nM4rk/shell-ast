// Query helpers accept CallExprNode OR UnwrappedCall — v0.6.0
// primary-lens completeness contract.
//
// For UnwrappedCall.wrapped, helpers dispatch to the INNER call
// (u.innerRaw). For plain / wrapped-script / wrapped-opaque, they
// dispatch to u.raw. Wrapper-side queries on a wrapped call require
// explicit u.raw — exercised below to confirm both paths remain reachable.

import { describe, expect, test } from "bun:test";
import {
  findCalls,
  flagsMatching,
  hasFlag,
  indexOfFlag,
  parse,
  resolvedCmd,
  tokenAfter,
  tokenAt,
  tokensAfter,
  unwrapCall,
} from "../src/index.js";

async function unwrapped(src: string) {
  const ast = await parse(src);
  return unwrapCall(findCalls(ast)[0]!);
}

describe("polymorphic dispatch — plain unwrapped", () => {
  test("tokenAfter on plain dispatches to u.raw", async () => {
    const u = await unwrapped("git --git-dir /repo status");
    expect(u?.kind).toBe("plain");
    expect(tokenAfter(u!, "--git-dir")).toBe("/repo");
  });

  test("hasFlag on plain", async () => {
    const u = await unwrapped("gcc -rf src.c");
    expect(hasFlag(u!, "-r")).toBe(true);
    expect(hasFlag(u!, "-f")).toBe(true);
    expect(hasFlag(u!, "-x")).toBe(false);
  });

  test("flagsMatching on plain", async () => {
    const u = await unwrapped("dd if=/dev/zero of=/tmp/x bs=1M");
    expect(flagsMatching(u!, (f) => f.includes("="))).toEqual([
      "if=/dev/zero",
      "of=/tmp/x",
      "bs=1M",
    ]);
  });

  test("resolvedCmd on plain — basename", async () => {
    const u = await unwrapped("/usr/bin/git status");
    expect(resolvedCmd(u!)).toBe("git");
  });
});

describe("polymorphic dispatch — wrapped dispatches to INNER call", () => {
  test("tokenAfter on wrapped — value from inner gcc, not outer sudo", async () => {
    const u = await unwrapped("sudo gcc -o /tmp/x src.c");
    expect(u?.kind).toBe("wrapped");
    expect(tokenAfter(u!, "-o")).toBe("/tmp/x");
  });

  test("tokensAfter on wrapped — collects from inner only", async () => {
    const u = await unwrapped("sudo git -c k1=v1 -c k2=v2 status");
    expect(u?.kind).toBe("wrapped");
    expect(tokensAfter(u!, "-c")).toEqual(["k1=v1", "k2=v2"]);
  });

  test("hasFlag on wrapped — inner gcc visible, outer sudo's -u NOT visible", async () => {
    const u = await unwrapped("sudo -u root gcc -o /tmp/x src.c");
    expect(u?.kind).toBe("wrapped");
    expect(hasFlag(u!, "-o")).toBe(true); // inner gcc has -o
    expect(hasFlag(u!, "-u")).toBe(false); // outer sudo's -u — invisible from polymorphic
  });

  test("hasFlag on u.raw — outer sudo's -u IS reachable explicitly", async () => {
    const u = await unwrapped("sudo -u root gcc -o /tmp/x src.c");
    if (u?.kind !== "wrapped") throw new Error("expected wrapped");
    expect(hasFlag(u.raw, "-u")).toBe(true); // explicit escape hatch
  });

  test("indexOfFlag on wrapped — indexes into inner args", async () => {
    const u = await unwrapped("sudo gcc -o /tmp/x src.c");
    if (u?.kind !== "wrapped") throw new Error("expected wrapped");
    // inner is `gcc -o /tmp/x src.c`. args[1] is "-o".
    expect(indexOfFlag(u, "-o")).toBe(1);
  });

  test("tokenAt on wrapped — index 0 is INNER cmd", async () => {
    const u = await unwrapped("sudo gcc -o /tmp/x src.c");
    expect(tokenAt(u!, 0)).toBe("gcc");
  });

  test("flagsMatching on wrapped — matches inner only", async () => {
    const u = await unwrapped("sudo dd if=/dev/zero of=/tmp/x bs=1M");
    expect(flagsMatching(u!, (f) => f.startsWith("of="))).toEqual(["of=/tmp/x"]);
  });

  test("resolvedCmd on wrapped — inner cmd basename", async () => {
    const u = await unwrapped("sudo /usr/bin/git status");
    expect(resolvedCmd(u!)).toBe("git");
  });
});

describe("polymorphic dispatch — wrapped-script / wrapped-opaque use u.raw", () => {
  test("hasFlag on wrapped-script — wrapper's -c visible", async () => {
    const u = await unwrapped('bash -c "gcc -o /tmp/x src.c"');
    expect(u?.kind).toBe("wrapped-script");
    expect(hasFlag(u!, "-c")).toBe(true); // bash's -c flag
  });

  test("tokenAfter on wrapped-script — value of -c is the script string", async () => {
    const u = await unwrapped('bash -c "gcc -o /tmp/x"');
    expect(tokenAfter(u!, "-c")).toBe("gcc -o /tmp/x");
  });

  test("resolvedCmd on wrapped-script — wrapper basename", async () => {
    const u = await unwrapped('bash -c "rm -rf /"');
    expect(resolvedCmd(u!)).toBe("bash");
  });

  test("wrapped-opaque — wrapper still queryable", async () => {
    const u = await unwrapped("sudo $CMD");
    expect(u?.kind).toBe("wrapped-opaque");
    expect(resolvedCmd(u!)).toBe("sudo");
  });
});

describe("back-compat — raw CallExprNode still works", () => {
  test("tokenAfter accepts raw CallExpr", async () => {
    const ast = await parse("git --git-dir /repo status");
    const call = findCalls(ast)[0]!;
    expect(tokenAfter(call, "--git-dir")).toBe("/repo");
  });

  test("hasFlag accepts raw CallExpr", async () => {
    const ast = await parse("gcc -rf src.c");
    const call = findCalls(ast)[0]!;
    expect(hasFlag(call, "-r")).toBe(true);
  });

  test("resolvedCmd accepts raw CallExpr", async () => {
    const ast = await parse("/usr/bin/git status");
    const call = findCalls(ast)[0]!;
    expect(resolvedCmd(call)).toBe("git");
  });
});

describe("dispatch on the canonical pattern from IDEOLOGY §11", () => {
  test('"gcc -o /etc/passwd via sudo" closes via polymorphic dispatch', async () => {
    const u = await unwrapped("sudo gcc -o /etc/passwd src.c");
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    // No u.raw walk, no resolveFlags re-call. Just hasFlag + tokenAfter on u.
    expect(u.cmd).toBe("gcc");
    expect(hasFlag(u, "-o")).toBe(true);
    expect(tokenAfter(u, "-o")).toBe("/etc/passwd");
    // The pre-v0.6.0 workaround returned the WRONG value (sudo's -o
    // doesn't exist, so the workaround would have returned undefined
    // for the outer call). The new path gets the inner value.
  });
});
