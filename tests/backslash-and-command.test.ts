import { describe, expect, test } from "bun:test";
import {
  DYNAMIC,
  findCalls,
  parse,
  resolvedCmd,
  resolveFlags,
  unwrapCall,
  unwrapDeep,
} from "../src/index.js";
import { testCmd } from "./_assertions.js";

async function args(src: string) {
  const call = findCalls(await parse(src))[0];
  if (!call) throw new Error(`no call in ${src}`);
  const r = resolveFlags(call);
  if (!r) throw new Error(`unresolved: ${src}`);
  return r;
}

describe("backslash quote removal in unquoted words (v0.8.1-beta.0)", () => {
  testCmd(String.raw`r\m -rf build`, { wrapper: null, cmd: "rm", flags: ["-r", "-f"] });
  testCmd(String.raw`\rm -rf build`, { wrapper: null, cmd: "rm" });
  testCmd(String.raw`rm\ -rf build`, { wrapper: null, cmd: "rm -rf" });
  testCmd(String.raw`sudo r\m -rf build`, { wrapper: "sudo", cmd: "rm" });
  testCmd(String.raw`env r\m x`, { wrapper: "env", cmd: "rm" });

  test("flags and args resolve too", async () => {
    const r = await args(String.raw`rm \-rf a\ b`);
    expect(r.flags).toEqual(["-r", "-f"]);
    expect(r.args).toEqual(["a b"]);
  });

  test("escaped backslash is one backslash", async () => {
    expect((await args(String.raw`echo a\\b`)).args).toEqual(["a\\b"]);
  });

  test("backslash-newline joins the lines", async () => {
    expect((await args("echo a\\\nb")).args).toEqual(["ab"]);
  });

  test("single quotes keep the backslash", async () => {
    expect((await args(String.raw`echo 'a\b' 'r\m'`)).args).toEqual(["a\\b", "r\\m"]);
  });

  test('double quotes drop it only before $ ` " \\', async () => {
    expect(
      (await args(String.raw`echo "a\$b" "a\"b" "a\\b" "a\b" "a\mb"`)).args
    ).toEqual(["a$b", 'a"b', "a\\b", "a\\b", "a\\mb"]);
  });

  test("a word with an expansion stays DYNAMIC", async () => {
    const r = await args(String.raw`echo r\m$x`);
    expect(r.args).toEqual([DYNAMIC]);
  });

  test("a command substitution as the command stays DYNAMIC", async () => {
    const call = findCalls(await parse("$(echo rm) -rf build"))[0];
    expect(call && resolveFlags(call)).toBeNull();
  });

  test("a trailing lone backslash stays", async () => {
    expect((await args(String.raw`echo a\ `)).args).toEqual(["a "]);
  });
});

describe("command builtin (v0.8.1-beta.0)", () => {
  testCmd("command rm -rf build", {
    wrapper: "command",
    cmd: "rm",
    flags: ["-r", "-f"],
  });
  testCmd("command -p rm -rf build", { wrapper: "command", cmd: "rm" });
  testCmd("command -- rm build", { wrapper: "command", cmd: "rm" });
  testCmd("command git push --force", { wrapper: "command", cmd: "git" });
  testCmd("command $CMD", {
    kind: "wrapped-opaque",
    wrapper: "command",
    reason: "dynamic-command",
  });

  // lookups execute nothing: plain, with `command` as the cmd
  testCmd("command -v rm", { wrapper: null, cmd: "command", args: ["rm"] });
  testCmd("command -V rm", { wrapper: null, cmd: "command" });
  testCmd("command -pv rm", { wrapper: null, cmd: "command" });
  testCmd("command -p -v rm", { wrapper: null, cmd: "command" });

  // bare, and the asymmetric with-wrapper shape
  testCmd("command", { wrapper: null, cmd: "command" });
  testCmd("sudo command rm -rf /", { wrapper: "sudo", cmd: "command" });

  test("unwrapDeep walks sudo then command to rm", async () => {
    const call = findCalls(await parse("sudo command rm -rf /"))[0];
    if (!call) throw new Error("no call");
    const chain = unwrapDeep(call);
    const last = chain.at(-1);
    expect(last?.kind).toBe("wrapped");
    expect(last && "cmd" in last ? last.cmd : null).toBe("rm");
  });

  test("unwrapCall on `command -v` is plain", async () => {
    const call = findCalls(await parse("command -v rm"))[0];
    expect(call && unwrapCall(call)?.kind).toBe("plain");
  });
});

describe("resolvedCmd is the basename helper", () => {
  const cases: [string, string][] = [
    ["/bin/rm -rf build", "rm"],
    ["/usr/bin/git push --force origin main", "git"],
    [String.raw`\rm x`, "rm"],
    [String.raw`/bin/r\m x`, "rm"],
    [`"rm" -rf build`, "rm"],
  ];
  for (const [src, want] of cases) {
    test(`${src} -> ${want}`, async () => {
      const call = findCalls(await parse(src))[0];
      expect(call && resolvedCmd(call)).toBe(want);
    });
  }

  test("cmd stays as written", async () => {
    expect((await args("/bin/rm -rf build")).cmd).toBe("/bin/rm");
  });

  test("wrapped: inner basename; dynamic: undefined", async () => {
    const wrapped = findCalls(await parse("env /bin/rm -rf build"))[0];
    const u = wrapped && unwrapCall(wrapped);
    expect(u && resolvedCmd(u)).toBe("rm");
    const dyn = findCalls(await parse("$(echo rm) -rf build"))[0];
    expect(dyn && resolvedCmd(dyn)).toBeUndefined();
  });
});
