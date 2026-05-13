// Security-relevant correctness regressions (audit phase 5).
//
// These tests exercise the contract from the consumer's perspective:
// security hooks call parse() + findCalls() + unwrapCall() + resolveFlags()
// to detect dangerous patterns. A test here failing means a hook
// silently misses a real-world bypass.

import { describe, expect, test } from "bun:test";
import { DYNAMIC, parse } from "../src/index.js";
import { testCmd } from "./_assertions.js";

describe("quoted flags must canonicalize the same as bare flags", () => {
  // Bash strips quotes before passing args to the command. A hook that
  // checks for `flags.includes("-r")` must see `-r` whether the user
  // wrote rm -rf, rm "-rf", or rm '-rf'. Otherwise: silent bypass.
  testCmd('rm "-rf" /', { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  testCmd("rm '-rf' /", { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  testCmd('rm "-r" "-f" /', { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  testCmd('"rm" -rf /', { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  // "$flags" is DblQuoted with ParamExp inside — cannot resolve statically;
  // the literal "/" is preserved as a string.
  testCmd('rm "$flags" /', { cmd: "rm", flags: [], args: [DYNAMIC, "/"] });
  // Pre-fix the literal user string "<dynamic>" would collide with the
  // sentinel; with Symbol it stays a real string in args.
  testCmd('rm "<dynamic>"', { cmd: "rm", args: ["<dynamic>"] });
});

describe("findCalls reaches commands inside every nesting form", () => {
  // walk.ts has a switch case for each container type. A regression
  // dropping any case silently breaks findCalls for that nesting form.
  testCmd("make && rm -rf / || echo done", { calls: ["make", "rm", "echo"] });
  testCmd("cat /etc/passwd | grep root | wc -l", { calls: ["cat", "grep", "wc"] });
  testCmd("(cd /tmp && rm -rf *)", { calls: ["cd", "rm"] });
  testCmd("{ echo a; rm -rf /; }", { calls: ["echo", "rm"] });
  testCmd("if true; then rm -rf /; fi", { calls: ["true", "rm"] });
  testCmd("if false; then echo; else rm -rf /; fi", { calls: ["false", "echo", "rm"] });
  testCmd("while :; do rm -rf /; done", { calls: [":", "rm"] });
  testCmd("for f in *.txt; do rm $f; done", { calls: ["rm"] });
  testCmd("case x in y) rm -rf /;; *) echo no;; esac", { calls: ["rm", "echo"] });
  testCmd("foo() { rm -rf /; }", { calls: ["rm"] });
  testCmd("echo $(rm -rf /)", { calls: ["echo", "rm"] });
  testCmd("! rm -rf /", { calls: ["rm"] });
  testCmd("rm -rf / &", { calls: ["rm"] });

  testCmd("FOO=bar rm -rf /", { cmd: "rm", calls: ["rm"], assignsCount: 1 });
});

describe("dialect parameter actually changes parser behavior", () => {
  // Without these tests, parse(..., "posix") could silently fall back
  // to bash and every assertion would still pass.

  test("posix rejects bash-only function keyword", async () => {
    await expect(parse("function foo { :; }", "posix")).rejects.toThrow();
  });

  test("posix rejects bash-only array literal", async () => {
    // mvdan/sh's posix is lenient on [[ ... ]] but does reject arrays.
    await expect(parse("a=(b c)", "posix")).rejects.toThrow();
  });

  test("posix rejects bash-only process substitution", async () => {
    await expect(parse("diff <(ls)", "posix")).rejects.toThrow();
  });

  test("bash accepts what posix rejects", async () => {
    const ast = await parse("a=(b c)", "bash");
    expect(ast.type).toBe("File");
  });

  test("mksh dialect parses mksh-specific reply variable", async () => {
    // ${|...} originated in mksh as a "reply variable" form. mvdan/sh
    // has historically accepted it under both bash and mksh dialects;
    // we assert mksh works to keep at least one mksh-targeted fixture.
    const ast = await parse("${|x=1;}", "mksh");
    expect(ast.type).toBe("File");
  });

  test("posix rejects mksh ${ stmts;} grouping", async () => {
    // ${ stmts;} (note the leading space) is mksh's value-substitution
    // grouping. posix rejects it; bash and mksh accept.
    await expect(parse("${ x=1;}", "posix")).rejects.toThrow();
  });
});

describe("splitBraces option exposes BraceExp nodes", () => {
  test("default leaves {a,b,c} as Lit (mvdan/sh default)", async () => {
    const ast = await parse("echo {a,b,c}");
    const stmt = ast.stmts[0]!;
    if (stmt.cmd?.type !== "CallExpr") throw new Error();
    const part = stmt.cmd.args[1]?.parts[0];
    expect(part?.type).toBe("Lit");
  });

  test("splitBraces: true produces BraceExp", async () => {
    const ast = await parse("echo {a,b,c}", "bash", { splitBraces: true });
    const stmt = ast.stmts[0]!;
    if (stmt.cmd?.type !== "CallExpr") throw new Error();
    const part = stmt.cmd.args[1]?.parts[0];
    expect(part?.type).toBe("BraceExp");
    if (part?.type === "BraceExp") {
      expect(part.elems).toHaveLength(3);
      expect(part.sequence).toBe(false);
    }
  });

  test("splitBraces: true on {1..5} produces sequence BraceExp", async () => {
    const ast = await parse("echo {1..5}", "bash", { splitBraces: true });
    const stmt = ast.stmts[0]!;
    if (stmt.cmd?.type !== "CallExpr") throw new Error();
    const part = stmt.cmd.args[1]?.parts[0];
    expect(part?.type).toBe("BraceExp");
    if (part?.type === "BraceExp") {
      expect(part.sequence).toBe(true);
    }
  });
});

describe("input size cap (audit B2)", () => {
  // Adversarial input could OOM the WASM instance. parse() must
  // reject inputs that exceed an explicit byte cap before crossing
  // the WASM boundary.

  test("rejects input over default 1MB cap", async () => {
    const big = `echo ${"x".repeat(1_500_000)}`;
    await expect(parse(big)).rejects.toThrow(/maxBytes/);
  });

  test("respects custom maxBytes", async () => {
    await expect(parse("echo hello world", "bash", { maxBytes: 5 })).rejects.toThrow(
      /maxBytes/
    );
  });

  test("accepts input under cap", async () => {
    const ast = await parse("echo hi", "bash", { maxBytes: 100 });
    expect(ast.type).toBe("File");
  });

  test("default 1MB allows reasonably large scripts", async () => {
    // 100 KB of legitimate script — well under 1MB
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) lines.push(`echo line${i}`);
    const ast = await parse(lines.join("\n"));
    expect(ast.type).toBe("File");
  });
});

describe("privilege escalators (audit B1, B4)", () => {
  testCmd("sudo -u root rm -rf /", { wrapper: "sudo", cmd: "rm" });
  testCmd("doas -u root rm -rf /", { wrapper: "doas", cmd: "rm" });
  testCmd("pkexec --user root rm -rf /", { wrapper: "pkexec", cmd: "rm" });
  testCmd("gosu nobody rm -rf /tmp", { wrapper: "gosu", cmd: "rm" });
  testCmd("runuser -u root rm -rf /", { wrapper: "runuser", cmd: "rm" });
  testCmd("setpriv --reuid 0 rm -rf /", { wrapper: "setpriv", cmd: "rm" });
  testCmd("sudo --user=root rm -rf /", { wrapper: "sudo", cmd: "rm" });
  // su -c / sh -c put the inner command INSIDE -c's value as a script
  // string. unwrapCall returns kind:"wrapped-script" with the script
  // field; consumers parse() it themselves (or use unwrapCallParsed).
  testCmd(`su user -c "rm -rf /"`, { wrapper: "su", script: "rm -rf /" });
  testCmd(`sh -c "rm -rf /"`, { wrapper: "sh", script: "rm -rf /" });
});
