import { describe, expect, test } from "bun:test";
import {
  type CustomWrapperResolver,
  DYNAMIC,
  findCalls,
  parse,
  unwrapCall,
  unwrapDeep,
  unwrapDeepParsed,
} from "../src/index.js";

const wrapperResolver: CustomWrapperResolver = ({ cmd, args }) => {
  if (cmd === "mise" && args[0] === "x" && args[1] === "--") {
    return { innerArgIndex: 2 };
  }
  if (cmd === "op" && args[0] === "run" && args[1] === "--") {
    return { innerArgIndex: 2 };
  }
  return undefined;
};

async function callOf(src: string) {
  const ast = await parse(src);
  return findCalls(ast)[0]!;
}

describe("per-call custom wrapper resolver", () => {
  test("unwraps a consumer-defined wrapper", async () => {
    const result = unwrapCall(await callOf("mise x -- target --flag"), {
      wrapperResolver,
    });

    expect(result?.kind).toBe("wrapped");
    if (result?.kind === "wrapped") {
      expect(result.wrapper).toBe("mise");
      expect(result.cmd).toBe("target");
      expect(result.flags).toEqual(["--flag"]);
    }
  });

  test("composes custom wrappers recursively beneath built-ins", async () => {
    const chain = unwrapDeep(
      await callOf("sudo env KEY=value op run -- mise x -- target --flag"),
      { wrapperResolver }
    );

    expect(
      chain.map((layer) =>
        layer.kind === "wrapped" ? [layer.wrapper, layer.cmd] : [layer.kind]
      )
    ).toEqual([
      ["sudo", "env"],
      ["env", "op"],
      ["op", "mise"],
      ["mise", "target"],
    ]);
  });

  test("leaves unknown custom-wrapper arguments plain", async () => {
    const result = unwrapCall(await callOf("mise unknown target"), {
      wrapperResolver,
    });

    expect(result?.kind).toBe("plain");
    if (result?.kind === "plain") expect(result.cmd).toBe("mise");
  });

  test("exposes dynamic prefix tokens without treating them as literals", async () => {
    let seenArgs: readonly (string | typeof DYNAMIC)[] = [];
    const resolver: CustomWrapperResolver = (input) => {
      seenArgs = input.args;
      return wrapperResolver(input);
    };

    const result = unwrapCall(await callOf("mise $SUBCOMMAND -- target"), {
      wrapperResolver: resolver,
    });

    expect(seenArgs).toEqual([DYNAMIC, "--", "target"]);
    expect(result?.kind).toBe("plain");
  });

  test("preserves a dynamic inner command as wrapped-opaque", async () => {
    const result = unwrapCall(await callOf("op run -- $CMD --flag"), {
      wrapperResolver,
    });

    expect(result).toMatchObject({
      kind: "wrapped-opaque",
      wrapper: "op",
      reason: "dynamic-command",
    });
  });

  test("keeps resolver configuration isolated to each call", async () => {
    const call = await callOf("mise x -- target");

    expect(unwrapCall(call)?.kind).toBe("plain");
    expect(unwrapCall(call, { wrapperResolver })?.kind).toBe("wrapped");
    expect(unwrapCall(call)?.kind).toBe("plain");
  });

  test("gives built-in wrappers precedence over the custom resolver", async () => {
    let resolverCalled = false;
    const resolver: CustomWrapperResolver = () => {
      resolverCalled = true;
      return { innerArgIndex: 0 };
    };

    const result = unwrapCall(await callOf("sudo target"), {
      wrapperResolver: resolver,
    });

    expect(resolverCalled).toBe(false);
    expect(result).toMatchObject({
      kind: "wrapped",
      wrapper: "sudo",
      cmd: "target",
    });
  });

  test("threads the resolver through parsed-script recursion", async () => {
    const chain = await unwrapDeepParsed(
      await callOf("bash -c 'op run -- mise x -- target'"),
      parse,
      { wrapperResolver }
    );

    expect(
      chain.map((layer) =>
        layer.kind === "wrapped"
          ? `${layer.wrapper}:${layer.cmd}`
          : layer.kind === "wrapped-script"
            ? `${layer.wrapper}:script`
            : layer.kind
      )
    ).toEqual(["bash:script", "op:mise", "mise:target"]);
  });

  test("threads global flags through parsed custom-wrapper recursion", async () => {
    const chain = await unwrapDeepParsed(
      await callOf("bash -c 'op run -- frobnicate -C /tmp status'"),
      parse,
      {
        wrapperResolver,
        globalFlags: { frobnicate: ["-C"] },
      }
    );

    expect(chain).toHaveLength(2);
    expect(chain[1]).toMatchObject({
      kind: "wrapped",
      wrapper: "op",
      cmd: "frobnicate",
      args: ["status"],
      flagValues: { "-C": ["/tmp"] },
    });
  });

  test("treats a matched prefix with no inner command as plain", async () => {
    const call = await callOf("mise x --");

    expect(unwrapCall(call, { wrapperResolver })).toMatchObject({
      kind: "plain",
      cmd: "mise",
    });
    expect(unwrapDeep(call, { wrapperResolver })).toMatchObject([
      { kind: "plain", cmd: "mise" },
    ]);
  });

  test("passes cmd to the resolver as written", async () => {
    const seen: string[] = [];
    const recording: CustomWrapperResolver = (input) => {
      seen.push(input.cmd);
      return wrapperResolver(input);
    };

    const u = unwrapCall(await callOf("/usr/bin/mise x -- target"), {
      wrapperResolver: recording,
    });

    expect(seen).toEqual(["/usr/bin/mise"]);
    expect(u).toMatchObject({ kind: "plain", cmd: "/usr/bin/mise" });
  });

  test("rejects invalid inner argument indices", async () => {
    const call = await callOf("mise x -- target");

    for (const innerArgIndex of [99, -1, 0.5, Number.NaN, Infinity, -Infinity]) {
      const resolver: CustomWrapperResolver = () => ({ innerArgIndex });
      expect(() => unwrapCall(call, { wrapperResolver: resolver })).toThrow(RangeError);
    }
  });
});
