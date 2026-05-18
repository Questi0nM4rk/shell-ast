// unwrapDeepParsed — async chain walker that re-parses wrapped-script
// layers. Continues past `wrapped-script` by parsing `u.script` and
// taking the first statement's cmd as the next layer. Same termination
// rules as `unwrapDeep` otherwise.

import { describe, expect, test } from "bun:test";
import { findCalls, parse, unwrapDeepParsed } from "../src/index.js";

async function asyncChainOf(
  src: string,
  opts?: Parameters<typeof unwrapDeepParsed>[2]
) {
  const ast = await parse(src);
  return await unwrapDeepParsed(findCalls(ast)[0]!, parse, opts);
}

describe("unwrapDeepParsed — async chain walker with script re-parse", () => {
  test("sudo bash -c 'rm -rf /tmp/x' — chain of 3 (wrapped, wrapped-script, plain)", async () => {
    const chain = await asyncChainOf("sudo bash -c 'rm -rf /tmp/x'");
    expect(chain.length).toBe(3);
    expect(chain[0]?.kind).toBe("wrapped");
    expect(chain[1]?.kind).toBe("wrapped-script");
    expect(chain[2]?.kind).toBe("plain");
    if (chain[2]?.kind === "plain") expect(chain[2].cmd).toBe("rm");
  });

  test("sudo bash -c 'gcc -o /etc/x src.c' — gcc reachable at chain[2]", async () => {
    const chain = await asyncChainOf("sudo bash -c 'gcc -o /etc/x src.c'");
    expect(chain.length).toBe(3);
    expect(chain[2]?.kind).toBe("plain");
    if (chain[2]?.kind === "plain") {
      expect(chain[2].cmd).toBe("gcc");
      // Without opts.globalFlags, -o is boolean → /etc/x stays in args
      expect(chain[2].args).toEqual(["/etc/x", "src.c"]);
      expect(chain[2].flags).toEqual(["-o"]);
    }
  });

  test("wrapped-script layer has innerAst hydrated", async () => {
    const chain = await asyncChainOf("sudo bash -c 'rm -rf /tmp/x'");
    const wsLayer = chain[1];
    expect(wsLayer?.kind).toBe("wrapped-script");
    if (wsLayer?.kind === "wrapped-script") {
      expect(wsLayer.innerAst).toBeDefined();
      expect(wsLayer.innerAst?.type).toBe("File");
    }
  });

  test("bash -c 'bash -c \"rm\"' — nested wrapped-script, chain of 3", async () => {
    const chain = await asyncChainOf("bash -c 'bash -c \"rm /tmp/x\"'");
    expect(chain.length).toBe(3);
    expect(chain[0]?.kind).toBe("wrapped-script");
    expect(chain[1]?.kind).toBe("wrapped-script");
    expect(chain[2]?.kind).toBe("plain");
    if (chain[2]?.kind === "plain") expect(chain[2].cmd).toBe("rm");
  });

  test("plain rm — chain of 1, no re-parse needed", async () => {
    const chain = await asyncChainOf("rm -rf /tmp/x");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("plain");
  });

  test("sudo rm — chain of 1, terminal wrapped (rm not a wrapper)", async () => {
    const chain = await asyncChainOf("sudo rm -rf /tmp/x");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("wrapped");
  });

  test("sudo $CMD — chain of 1, wrapped-opaque (no re-parse possible)", async () => {
    const chain = await asyncChainOf("sudo $CMD");
    expect(chain.length).toBe(1);
    expect(chain[0]?.kind).toBe("wrapped-opaque");
  });

  test("multi-stmt inner — walker follows first stmt only", async () => {
    const chain = await asyncChainOf("bash -c 'rm /tmp/a; rm /tmp/b'");
    // bash -c "rm /tmp/a; rm /tmp/b" → wrapped-script(script="rm /tmp/a; rm /tmp/b")
    // → parse script → first stmt is `rm /tmp/a`. Walker takes that.
    expect(chain.length).toBe(2);
    expect(chain[0]?.kind).toBe("wrapped-script");
    expect(chain[1]?.kind).toBe("plain");
    if (chain[1]?.kind === "plain") {
      expect(chain[1].cmd).toBe("rm");
      expect(chain[1].args).toEqual(["/tmp/a"]);
    }
  });

  test("opts.globalFlags threads through async layers", async () => {
    const chain = await asyncChainOf("sudo bash -c 'gcc -o /etc/x src.c'", {
      globalFlags: { gcc: ["-o"] },
    });
    expect(chain.length).toBe(3);
    const inner = chain[2];
    if (inner?.kind === "plain") {
      expect(inner.cmd).toBe("gcc");
      expect(inner.flagValues).toEqual({ "-o": ["/etc/x"] });
    }
  });

  test("runaway guard caps at MAX_CHAIN_DEPTH for adversarial input", async () => {
    // 110 nested wrappers (sudo→sudo→sudo→…) → walker caps at 100
    const src = `${"sudo ".repeat(110)}rm /tmp/x`;
    const chain = await asyncChainOf(src);
    expect(chain.length).toBe(100);
  });
});
