// Security-relevant correctness regressions (audit phase 5).
//
// These tests exercise the contract from the consumer's perspective:
// security hooks call parse() + findCalls() + unwrapCall() + resolveFlags()
// to detect dangerous patterns. A test here failing means a hook
// silently misses a real-world bypass.

import { describe, expect, test } from "bun:test";
import { DYNAMIC, findCalls, parse, resolveFlags } from "../src/index.js";
import { unwrapCall } from "../src/semantic.js";

describe("quoted flags must canonicalize the same as bare flags", () => {
  // Bash strips quotes before passing args to the command. A hook that
  // checks for `flags.includes("-r")` must see `-r` whether the user
  // wrote rm -rf, rm "-rf", or rm '-rf'. Otherwise: silent bypass.

  test('rm "-rf" / — double-quoted combined flag', async () => {
    const ast = await parse('rm "-rf" /');
    const resolved = resolveFlags(findCalls(ast)[0]!);
    expect(resolved?.cmd).toBe("rm");
    expect(resolved?.flags).toContain("-r");
    expect(resolved?.flags).toContain("-f");
    expect(resolved?.args).toEqual(["/"]);
  });

  test("rm '-rf' / — single-quoted combined flag", async () => {
    const ast = await parse("rm '-rf' /");
    const resolved = resolveFlags(findCalls(ast)[0]!);
    expect(resolved?.cmd).toBe("rm");
    expect(resolved?.flags).toContain("-r");
    expect(resolved?.flags).toContain("-f");
    expect(resolved?.args).toEqual(["/"]);
  });

  test('rm "-r" "-f" / — both flags double-quoted separately', async () => {
    const ast = await parse('rm "-r" "-f" /');
    const resolved = resolveFlags(findCalls(ast)[0]!);
    expect(resolved?.cmd).toBe("rm");
    expect(resolved?.flags).toEqual(["-r", "-f"]);
    expect(resolved?.args).toEqual(["/"]);
  });

  test('"rm" -rf / — quoted command name resolves too', async () => {
    const ast = await parse('"rm" -rf /');
    const resolved = resolveFlags(findCalls(ast)[0]!);
    expect(resolved?.cmd).toBe("rm");
    expect(resolved?.flags).toContain("-r");
  });

  test("dynamic Word becomes typed DYNAMIC sentinel (not magic string)", async () => {
    const ast = await parse('rm "$flags" /');
    const resolved = resolveFlags(findCalls(ast)[0]!);
    expect(resolved?.cmd).toBe("rm");
    // "$flags" is DblQuoted with ParamExp inside — cannot resolve statically.
    expect(resolved?.flags).toEqual([]);
    expect(resolved?.args).toContain(DYNAMIC);
    // The literal "/" is preserved as a string.
    expect(resolved?.args).toContain("/");
  });

  test("literal '<dynamic>' string is NOT confused with DYNAMIC sentinel", async () => {
    // Pre-fix this would parse to args: ["<dynamic>"] and collide with
    // a real substitution. With Symbol sentinel the two are distinct.
    const ast = await parse(`rm "<dynamic>"`);
    const resolved = resolveFlags(findCalls(ast)[0]!);
    expect(resolved?.args).toEqual(["<dynamic>"]);
    expect(resolved?.args).not.toContain(DYNAMIC);
  });
});

describe("findCalls reaches commands inside every nesting form", () => {
  // walk.ts has a switch case for each container type. A regression
  // dropping any case silently breaks findCalls for that nesting form.

  async function callNames(src: string): Promise<string[]> {
    const ast = await parse(src);
    return findCalls(ast).map((c) => {
      const part = c.args[0]?.parts[0];
      return part?.type === "Lit" ? part.value : "<unresolvable>";
    });
  }

  test("BinaryCmd: && and || chain", async () => {
    const names = await callNames("make && rm -rf / || echo done");
    expect(names).toEqual(["make", "rm", "echo"]);
  });

  test("Pipe (BinaryCmd op |)", async () => {
    expect(await callNames("cat /etc/passwd | grep root | wc -l")).toEqual([
      "cat",
      "grep",
      "wc",
    ]);
  });

  test("Subshell", async () => {
    expect(await callNames("(cd /tmp && rm -rf *)")).toEqual(["cd", "rm"]);
  });

  test("Block", async () => {
    expect(await callNames("{ echo a; rm -rf /; }")).toEqual(["echo", "rm"]);
  });

  test("IfClause then-branch", async () => {
    expect(await callNames("if true; then rm -rf /; fi")).toEqual(["true", "rm"]);
  });

  test("IfClause else-branch", async () => {
    expect(await callNames("if false; then echo; else rm -rf /; fi")).toEqual([
      "false",
      "echo",
      "rm",
    ]);
  });

  test("WhileClause body", async () => {
    expect(await callNames("while :; do rm -rf /; done")).toEqual([":", "rm"]);
  });

  test("ForClause body", async () => {
    expect(await callNames("for f in *.txt; do rm $f; done")).toEqual(["rm"]);
  });

  test("CaseClause arm", async () => {
    expect(await callNames("case x in y) rm -rf /;; *) echo no;; esac")).toEqual([
      "rm",
      "echo",
    ]);
  });

  test("FuncDecl body", async () => {
    expect(await callNames("foo() { rm -rf /; }")).toEqual(["rm"]);
  });

  test("Nested CmdSubst with dangerous payload", async () => {
    expect(await callNames("echo $(rm -rf /)")).toEqual(["echo", "rm"]);
  });

  test("Negated statement still surfaces inner call", async () => {
    expect(await callNames("! rm -rf /")).toEqual(["rm"]);
  });

  test("Background statement still surfaces inner call", async () => {
    expect(await callNames("rm -rf / &")).toEqual(["rm"]);
  });

  test("Assignment-prefix CallExpr surfaces", async () => {
    const ast = await parse("FOO=bar rm -rf /");
    const calls = findCalls(ast);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.assigns).toHaveLength(1);
    expect(resolveFlags(calls[0]!)?.cmd).toBe("rm");
  });
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

  test("mksh dialect parses mksh-specific construct without throwing", async () => {
    // mksh accepts ${|foo;} reply variable — bash does not.
    const ast = await parse("${|x=1;}", "mksh");
    expect(ast.type).toBe("File");
  });

  test("bash rejects mksh-only ${|...} reply variable", async () => {
    await expect(parse("${|x=1;}", "bash")).rejects.toThrow();
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
  test("sudo -u root rm -rf / unwraps to rm", async () => {
    const ast = await parse("sudo -u root rm -rf /");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("sudo");
    expect(u?.cmd).toBe("rm");
  });

  test("doas -u root rm unwraps", async () => {
    const ast = await parse("doas -u root rm -rf /");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("doas");
    expect(u?.cmd).toBe("rm");
  });

  test("pkexec --user root rm unwraps", async () => {
    const ast = await parse("pkexec --user root rm -rf /");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("pkexec");
    expect(u?.cmd).toBe("rm");
  });

  test("gosu user rm unwraps (no flags-with-args)", async () => {
    const ast = await parse("gosu nobody rm -rf /tmp");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("gosu");
    expect(u?.cmd).toBe("rm");
  });

  test("runuser -u root rm unwraps", async () => {
    const ast = await parse("runuser -u root rm -rf /");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("runuser");
    expect(u?.cmd).toBe("rm");
  });

  test("setpriv --reuid root rm unwraps", async () => {
    const ast = await parse("setpriv --reuid 0 rm -rf /");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("setpriv");
    expect(u?.cmd).toBe("rm");
  });

  test("sudo --user=root rm unwraps (long-eq form)", async () => {
    const ast = await parse("sudo --user=root rm -rf /");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("sudo");
    expect(u?.cmd).toBe("rm");
  });

  test('su user -c "rm -rf /" exposes commandString', async () => {
    // su's contract is unique: the inner command is INSIDE -c's value
    // as a string. unwrapCall returns commandString instead of cmd so
    // the consumer can parse it themselves.
    const ast = await parse(`su user -c "rm -rf /"`);
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("su");
    expect(u?.cmd).toBeNull();
    expect(u?.commandString).toBe("rm -rf /");
  });

  test('sh -c "rm -rf /" exposes commandString', async () => {
    const ast = await parse(`sh -c "rm -rf /"`);
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.wrapper).toBe("sh");
    expect(u?.commandString).toBe("rm -rf /");
  });
});
