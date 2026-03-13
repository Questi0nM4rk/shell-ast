import { describe, expect, test } from "bun:test";
import { findCalls, parse, resolveFlags } from "../src/index.js";
import { unwrapCall } from "../src/semantic.js";

describe("parse (WASM integration)", () => {
  test("returns ShellFile for simple command", async () => {
    const ast = await parse("echo hello");
    expect(ast.type).toBe("File");
    expect(ast.stmts).toHaveLength(1);
    const stmt = ast.stmts[0]!;
    expect(stmt.type).toBe("Stmt");
    expect(stmt.cmd?.type).toBe("CallExpr");
  });

  test("CallExpr has correct args", async () => {
    const ast = await parse("rm -rf /");
    const calls = findCalls(ast);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.args).toHaveLength(3);
    expect(call.args[0]!.parts[0]).toMatchObject({ type: "Lit", value: "rm" });
  });

  test("resolveFlags splits combined short flags", async () => {
    const ast = await parse("rm -rf /tmp/foo");
    const calls = findCalls(ast);
    expect(calls).toHaveLength(1);
    const resolved = resolveFlags(calls[0]!);
    expect(resolved?.cmd).toBe("rm");
    expect(resolved?.flags).toContain("-r");
    expect(resolved?.flags).toContain("-f");
    expect(resolved?.args).toEqual(["/tmp/foo"]);
  });

  test("pipe: BinaryCmd with op |", async () => {
    const ast = await parse("cat /etc/passwd | grep root");
    expect(ast.stmts).toHaveLength(1);
    const stmt = ast.stmts[0]!;
    expect(stmt.cmd?.type).toBe("BinaryCmd");
    if (stmt.cmd?.type === "BinaryCmd") {
      expect(stmt.cmd.op).toBe("|");
    }
  });

  test("command substitution: CmdSubst node", async () => {
    const ast = await parse("echo $(date)");
    const calls = findCalls(ast);
    expect(calls).toHaveLength(2); // echo + date
  });

  test("redirect: Redirect node with op", async () => {
    const ast = await parse("echo foo > /tmp/out");
    const stmt = ast.stmts[0]!;
    expect(stmt.redirs).toHaveLength(1);
    expect(stmt.redirs[0]!.op).toBe(">");
  });

  test("function declaration: FuncDecl node", async () => {
    const ast = await parse("foo() { echo bar; }");
    const stmt = ast.stmts[0]!;
    expect(stmt.cmd?.type).toBe("FuncDecl");
    if (stmt.cmd?.type === "FuncDecl") {
      expect(stmt.cmd.name.value).toBe("foo");
    }
  });

  test("for loop: ForClause with WordIter", async () => {
    const ast = await parse("for f in a b c; do echo $f; done");
    const stmt = ast.stmts[0]!;
    expect(stmt.cmd?.type).toBe("ForClause");
    if (stmt.cmd?.type === "ForClause") {
      expect(stmt.cmd.loop.type).toBe("WordIter");
    }
  });

  test("test clause: TestClause with BinaryTest", async () => {
    const ast = await parse("[[ -f foo && -d bar ]]");
    const stmt = ast.stmts[0]!;
    expect(stmt.cmd?.type).toBe("TestClause");
  });

  test("source positions are present", async () => {
    const ast = await parse("echo hello");
    expect(ast.pos.line).toBe(1);
    expect(ast.pos.col).toBe(1);
    const stmt = ast.stmts[0]!;
    expect(stmt.cmd?.pos.line).toBe(1);
  });

  test("syntax error throws", async () => {
    await expect(parse("if; then")).rejects.toThrow();
  });

  test("posix dialect", async () => {
    const ast = await parse("echo hello", "posix");
    expect(ast.type).toBe("File");
  });

  test("unwrapCall: sudo -u root rm -rf /", async () => {
    const ast = await parse("sudo -u root rm -rf /");
    const calls = findCalls(ast);
    const unwrapped = unwrapCall(calls[0]!);
    expect(unwrapped?.wrapper).toBe("sudo");
    expect(unwrapped?.cmd).toBe("rm");
    expect(unwrapped?.flags).toContain("-r");
    expect(unwrapped?.flags).toContain("-f");
  });

  test("findCalls walks nested CmdSubst", async () => {
    const ast = await parse("echo $(date +%s)");
    const calls = findCalls(ast);
    // Should find both echo and date
    const cmdNames = calls
      .map((c) => {
        const first = c.args[0];
        if (!first) return null;
        const part = first.parts[0];
        return part?.type === "Lit" ? part.value : null;
      })
      .filter(Boolean);
    expect(cmdNames).toContain("echo");
    expect(cmdNames).toContain("date");
  });
});
