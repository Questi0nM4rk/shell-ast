// unwrapDeep — sync chain walker. Closes BUG-008 (deferred from v0.5.0, v0.6.0).
//
// Returns the chain of UnwrappedCall results, outermost-first. Stops at the
// first non-`wrapped` result (sync can't proceed past `wrapped-script` —
// that's `unwrapDeepParsed`'s job). The `wrapped` case uses 0.6.0's
// `innerRaw` to continue.

import { describe, expect, test } from "bun:test";
import { findCalls, parse, unwrapDeep } from "../src/index.js";

async function chainOf(src: string, opts?: Parameters<typeof unwrapDeep>[1]) {
  const ast = await parse(src);
  return unwrapDeep(findCalls(ast)[0]!, opts);
}

describe("unwrapDeep — sync chain walker", () => {
  test("plain rm — chain of 1, terminal plain", async () => {
    const chain = await chainOf("rm -rf /tmp/x");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("plain");
    if (chain[0]?.kind === "plain") {
      expect(chain[0].cmd).toBe("rm");
    }
  });

  test("sudo rm — chain of 1, wrapped because rm is not a wrapper", async () => {
    const chain = await chainOf("sudo rm -rf /tmp/x");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("wrapped");
    if (chain[0]?.kind === "wrapped") {
      expect(chain[0].wrapper).toBe("sudo");
      expect(chain[0].cmd).toBe("rm");
    }
  });

  test("sudo bash -c 'rm' — chain of 2, ends at wrapped-script (sync stops)", async () => {
    const chain = await chainOf("sudo bash -c 'rm -rf /tmp/x'");
    expect(chain.length).toBe(2);
    expect(chain[0]?.kind).toBe("wrapped");
    expect(chain[1]?.kind).toBe("wrapped-script");
    if (chain[0]?.kind === "wrapped") expect(chain[0].cmd).toBe("bash");
    if (chain[1]?.kind === "wrapped-script") {
      expect(chain[1].wrapper).toBe("bash");
      expect(chain[1].script).toBe("rm -rf /tmp/x");
    }
  });

  test("doas sh -c 'gcc -o /etc/x src.c' — chain of 2", async () => {
    const chain = await chainOf("doas sh -c 'gcc -o /etc/x src.c'");
    expect(chain.length).toBe(2);
    expect(chain[0]?.kind).toBe("wrapped");
    expect(chain[1]?.kind).toBe("wrapped-script");
    if (chain[0]?.kind === "wrapped") {
      expect(chain[0].wrapper).toBe("doas");
      expect(chain[0].cmd).toBe("sh");
    }
  });

  test("sudo doas rm — chain of 2 (sudo→doas→rm)", async () => {
    const chain = await chainOf("sudo doas rm -rf /tmp/x");
    expect(chain.length).toBe(2);
    expect(chain[0]?.kind).toBe("wrapped");
    expect(chain[1]?.kind).toBe("wrapped");
    if (chain[0]?.kind === "wrapped") expect(chain[0].cmd).toBe("doas");
    if (chain[1]?.kind === "wrapped") {
      expect(chain[1].wrapper).toBe("doas");
      expect(chain[1].cmd).toBe("rm");
    }
  });

  test("triple sudo — sudo sudo sudo rm — chain of 3", async () => {
    const chain = await chainOf("sudo sudo sudo rm -rf /tmp/x");
    expect(chain.length).toBe(3);
    expect(chain.every((u) => u.kind === "wrapped")).toBe(true);
    if (chain[2]?.kind === "wrapped") expect(chain[2].cmd).toBe("rm");
  });

  test("sudo $CMD — chain of 1, wrapped-opaque (dynamic inner)", async () => {
    const chain = await chainOf("sudo $CMD");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("wrapped-opaque");
    if (chain[0]?.kind === "wrapped-opaque") expect(chain[0].wrapper).toBe("sudo");
  });

  test("bash --version — chain of 1, plain (wrapper-named, no inner)", async () => {
    const chain = await chainOf("bash --version");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("plain");
    if (chain[0]?.kind === "plain") expect(chain[0].cmd).toBe("bash");
  });

  test("opts.globalFlags threads through every wrapped layer", async () => {
    const chain = await chainOf("sudo terraform -chdir /tf apply", {
      globalFlags: { terraform: ["-chdir"] },
    });
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("wrapped");
    if (chain[0]?.kind === "wrapped") {
      expect(chain[0].cmd).toBe("terraform");
      expect(chain[0].flagValues).toEqual({ "-chdir": ["/tf"] });
    }
  });

  test("runaway guard caps chain at MAX_CHAIN_DEPTH (100)", async () => {
    // 110 nested sudos should produce chain capped at 100
    const src = `${"sudo ".repeat(110)}rm /tmp/x`;
    const chain = await chainOf(src);
    expect(chain.length).toBe(100);
    // The final cap-element is still `wrapped` (sudo wrapping the next sudo),
    // since we capped before reaching the bottom rm.
    expect(chain[99]?.kind).toBe("wrapped");
  });

  test("empty chain when call has no resolvable cmd", () => {
    // Construct a CallExpr with no args via the factories
    const emptyCall = {
      type: "CallExpr" as const,
      assigns: [],
      args: [],
      pos: { offset: 0, line: 1, col: 1 },
      end: { offset: 0, line: 1, col: 1 },
    };
    const chain = unwrapDeep(emptyCall);
    expect(chain).toEqual([]);
  });
});
