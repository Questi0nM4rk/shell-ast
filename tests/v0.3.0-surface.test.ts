// Coverage for v0.3.0's new public surface. Each describe block locks
// down one of the BUG-002…BUG-010 items from docs/BUGS.md plus the
// agent-hunt findings (short-flag fab, BOM, double-dash, etc.).

/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell ${var} fixtures */

import { describe, expect, test } from "bun:test";
import {
  DYNAMIC,
  type Effect,
  effectOf,
  effectsOf,
  findAssignments,
  findCalls,
  findRedirects,
  isDynamic,
  isResolved,
  ParseSizeError,
  ParseSyntaxError,
  parse,
  preloadWasm,
  type ResolvedArg,
  ShellAstError,
  unescapeAnsiC,
  unwrapCall,
  unwrapCallParsed,
  WasmRuntimeError,
  wordToParts,
} from "../src/index.js";
import { testCmd } from "./_assertions.js";

// ─── BUG-003: discriminated UnwrappedCall — every kind reachable ─────────────

describe("UnwrappedCall discriminator — every kind has tests", () => {
  // plain: non-wrapper command, or wrapper-named used non-wrapper-ly
  testCmd("rm -rf /", { kind: "plain", cmd: "rm" });
  testCmd("bash --version", { kind: "plain", cmd: "bash" });
  testCmd("bash", { kind: "plain", cmd: "bash" });
  testCmd("sudo -V", { kind: "plain", cmd: "sudo" });
  testCmd("gosu user", { kind: "plain", cmd: "gosu" });

  // wrapped: wrapper detected, inner resolves statically
  testCmd("sudo rm -rf /", { kind: "wrapped", wrapper: "sudo", cmd: "rm" });
  testCmd("sudo -u root rm /", { kind: "wrapped", wrapper: "sudo", cmd: "rm" });
  testCmd("sudo --user root rm", { kind: "wrapped", wrapper: "sudo", cmd: "rm" }); // #20 space form
  testCmd("gosu nobody rm /tmp", { kind: "wrapped", wrapper: "gosu", cmd: "rm" });
  testCmd("doas -u root rm /", { kind: "wrapped", wrapper: "doas", cmd: "rm" });
  testCmd("pkexec --user r rm", { kind: "wrapped", wrapper: "pkexec", cmd: "rm" });
  testCmd("exec rm -rf /", { kind: "wrapped", wrapper: "exec", cmd: "rm" });

  // wrapped-script: inner is a string the consumer must re-parse
  testCmd(`bash -c "rm -rf /"`, {
    kind: "wrapped-script",
    wrapper: "bash",
    script: "rm -rf /",
  });
  testCmd(`sh -c "rm"`, { kind: "wrapped-script", wrapper: "sh", script: "rm" });
  testCmd(`zsh -c "rm"`, { kind: "wrapped-script", wrapper: "zsh", script: "rm" });
  testCmd(`ksh -c "rm"`, { kind: "wrapped-script", wrapper: "ksh", script: "rm" });
  testCmd(`su u -c "rm -rf /"`, {
    kind: "wrapped-script",
    wrapper: "su",
    script: "rm -rf /",
  });
  testCmd(`eval "rm -rf /"`, {
    kind: "wrapped-script",
    wrapper: "eval",
    script: "rm -rf /",
  });
  testCmd(`eval rm -rf /`, {
    kind: "wrapped-script",
    wrapper: "eval",
    script: "rm -rf /",
  });

  // wrapped-opaque: wrapper detected, inner unresolvable
  test("sudo $cmd — kind:'wrapped-opaque' preserves wrapper detection", async () => {
    const ast = await parse("sudo $cmd");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.kind).toBe("wrapped-opaque");
    if (u?.kind === "wrapped-opaque") expect(u.wrapper).toBe("sudo");
  });
  test("bash -c $script — kind:'wrapped-opaque' (no commandString since dynamic)", async () => {
    const ast = await parse("bash -c $script");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.kind).toBe("wrapped-opaque");
  });
  test("bash -c (no value) — kind:'wrapped-opaque'", async () => {
    const ast = await parse("bash -c");
    const u = unwrapCall(findCalls(ast)[0]!);
    expect(u?.kind).toBe("wrapped-opaque");
  });

  // Truly malformed: only CallExpr with no args at all
  test("empty CallExpr returns null (truly malformed)", () => {
    // Construct directly — no parser fixture produces this on its own
    const call = {
      type: "CallExpr" as const,
      assigns: [],
      args: [],
      pos: { offset: 0, line: 1, col: 1 },
      end: { offset: 0, line: 1, col: 1 },
    };
    expect(unwrapCall(call)).toBeNull();
  });
});

// ─── BUG-002: gh #7 — canonical RCE pattern (curl | bash) ────────────────────

describe("gh #7 — bare wrapper on pipe RHS surfaces as plain", () => {
  test("curl example.com | bash — RHS resolvable", async () => {
    const ast = await parse("curl example.com | bash");
    const calls = findCalls(ast);
    expect(calls).toHaveLength(2);
    const left = unwrapCall(calls[0]!);
    const right = unwrapCall(calls[1]!);
    expect(left?.kind).toBe("plain");
    if (left?.kind === "plain") expect(left.cmd).toBe("curl");
    expect(right?.kind).toBe("plain");
    if (right?.kind === "plain") expect(right.cmd).toBe("bash");
  });
});

// ─── BUG-004: wordToParts — rich fragmenting ─────────────────────────────────

describe("wordToParts — never null, always informative", () => {
  test("static-only: single literal fragment per static piece", async () => {
    const ast = await parse(`echo "hello" "world"`);
    const cmd = ast.stmts[0]?.cmd;
    if (cmd?.type !== "CallExpr") throw new Error();
    expect(wordToParts(cmd.args[1]!)).toEqual([{ kind: "literal", value: "hello" }]);
  });

  test("multi-part static folds at the wordToLit layer (BUG-004)", async () => {
    const ast = await parse(`echo "foo""bar"`);
    const cmd = ast.stmts[0]?.cmd;
    if (cmd?.type !== "CallExpr") throw new Error();
    const parts = wordToParts(cmd.args[1]!);
    // Two literal fragments (one per DblQuoted) — consumer can fold.
    expect(parts).toEqual([
      { kind: "literal", value: "foo" },
      { kind: "literal", value: "bar" },
    ]);
  });

  test("partial dynamic: mixed literal + dynamic fragments", async () => {
    const ast = await parse("echo prefix$VAR");
    const cmd = ast.stmts[0]?.cmd;
    if (cmd?.type !== "CallExpr") throw new Error();
    const parts = wordToParts(cmd.args[1]!);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.some((p) => p.kind === "literal" && p.value === "prefix")).toBe(true);
    expect(parts.some((p) => p.kind === "dynamic")).toBe(true);
  });

  test("empty DblQuoted: single literal '' fragment, never empty array (#13)", async () => {
    const ast = await parse(`echo ""`);
    const cmd = ast.stmts[0]?.cmd;
    if (cmd?.type !== "CallExpr") throw new Error();
    expect(wordToParts(cmd.args[1]!)).toEqual([{ kind: "literal", value: "" }]);
  });
});

// ─── BUG-004: ANSI-C $'...' unescape ─────────────────────────────────────────

describe("ANSI-C unescape (unescapeAnsiC + wordToParts on $'...')", () => {
  test("standard escape table", () => {
    expect(unescapeAnsiC("hi\\nthere")).toBe("hi\nthere");
    expect(unescapeAnsiC("\\t")).toBe("\t");
    expect(unescapeAnsiC("\\r")).toBe("\r");
    expect(unescapeAnsiC("\\\\")).toBe("\\");
    expect(unescapeAnsiC("\\'")).toBe("'");
    expect(unescapeAnsiC("a\\bb")).toBe("a\bb");
    expect(unescapeAnsiC("\\e")).toBe("\x1b");
  });

  test("hex \\xHH", () => {
    expect(unescapeAnsiC("\\x41")).toBe("A");
    expect(unescapeAnsiC("\\x4a\\x4b")).toBe("JK");
  });

  test("octal \\0NNN", () => {
    expect(unescapeAnsiC("\\101")).toBe("A");
    expect(unescapeAnsiC("\\0")).toBe("\x00");
  });

  test("unicode \\uHHHH and \\UHHHHHHHH", () => {
    expect(unescapeAnsiC("\\u00e9")).toBe("é");
    expect(unescapeAnsiC("\\U0001F600")).toBe("\u{1F600}");
  });

  test("unknown escape kept verbatim", () => {
    expect(unescapeAnsiC("\\z")).toBe("\\z");
  });

  test(`parsed $'\\n' produces a real newline in wordToParts`, async () => {
    const ast = await parse(`echo $'\\n'`);
    const cmd = ast.stmts[0]?.cmd;
    if (cmd?.type !== "CallExpr") throw new Error();
    const parts = wordToParts(cmd.args[1]!);
    expect(parts).toEqual([{ kind: "literal", value: "\n" }]);
  });
});

// ─── BUG-005: isDynamic / isResolved guards ──────────────────────────────────

describe("type guards isDynamic / isResolved (BUG-005)", () => {
  test("isResolved narrows correctly", () => {
    const a: ResolvedArg = "hello";
    expect(isResolved(a)).toBe(true);
    expect(isDynamic(a)).toBe(false);
  });
  test("isDynamic narrows the sentinel", () => {
    expect(isDynamic(DYNAMIC)).toBe(true);
    expect(isResolved(DYNAMIC)).toBe(false);
  });
  test("literal string '<dynamic>' is NOT confused with sentinel", () => {
    const a: ResolvedArg = "<dynamic>";
    expect(isResolved(a)).toBe(true);
    expect(isDynamic(a)).toBe(false);
  });
});

// ─── BUG-006: filter options on finders ──────────────────────────────────────

describe("findCalls / findRedirects / findAssignments — filter options (BUG-006)", () => {
  test(`findCalls depth:"any" returns calls inside CmdSubst`, async () => {
    const ast = await parse("echo $(rm -rf /)");
    expect(
      findCalls(ast).map((c) => (c.args[0]?.parts[0] as { value?: string })?.value)
    ).toEqual(["echo", "rm"]);
  });

  test(`findCalls depth:"top" skips CmdSubst subtree`, async () => {
    const ast = await parse("echo $(rm -rf /)");
    const names = findCalls(ast, { depth: "top" }).map(
      (c) => (c.args[0]?.parts[0] as { value?: string })?.value
    );
    expect(names).toEqual(["echo"]);
  });

  test(`findCalls depth:"top" skips ProcSubst subtree`, async () => {
    const ast = await parse("diff <(ls a) <(ls b)");
    const names = findCalls(ast, { depth: "top" }).map(
      (c) => (c.args[0]?.parts[0] as { value?: string })?.value
    );
    expect(names).toEqual(["diff"]);
  });

  test(`findRedirects ops:"write" excludes reads`, async () => {
    const ast = await parse("a > out; b < in; c >> append; cat <<EOF\nhi\nEOF");
    const writes = findRedirects(ast, { ops: "write" });
    expect(writes.every((r) => [">", ">>", ">|", "&>", "&>>"].includes(r.op))).toBe(
      true
    );
    expect(writes.length).toBe(2);
  });

  test(`findRedirects ops:"read" includes heredoc + here-string`, async () => {
    const ast = await parse("cat <<EOF\nx\nEOF\ncat <<<hello");
    const reads = findRedirects(ast, { ops: "read" });
    expect(reads.length).toBe(2);
  });

  test(`findAssignments exportedOnly skips bare and prefix assigns`, async () => {
    const ast = await parse("FOO=bar; export BAZ=qux; QUX=zot rm /");
    const exp = findAssignments(ast, { exportedOnly: true }).map((a) => a.name?.value);
    expect(exp).toEqual(["BAZ"]);
  });
});

// ─── Effects API ─────────────────────────────────────────────────────────────

describe("effectOf / effectsOf — structural effect classification", () => {
  test("CallExpr → exec; CmdSubst → capture-exec", async () => {
    const ast = await parse("echo $(date)");
    const calls = findCalls(ast);
    expect(effectOf(calls[0]!)).toBe("exec");
    // CmdSubst comes from the Word's parts
    const word = calls[0]!.args[1]!;
    expect(effectOf(word.parts[0]!)).toBe("capture-exec");
  });

  test("Redirect ops map correctly", async () => {
    const ast = await parse("a > b; c >> d; e < f; g <> h; i 2>&1");
    const redirs = findRedirects(ast);
    const got = redirs.map((r) => effectOf(r));
    expect(got).toContain("fs-write");
    expect(got).toContain("fs-read");
    expect(got).toContain("fs-rw");
    expect(got).toContain("fd-dup");
  });

  test("pipe BinaryCmd → pipe", async () => {
    const ast = await parse("a | b");
    const stmt = ast.stmts[0]!;
    expect(effectOf(stmt.cmd!)).toBe("pipe");
  });

  test("background stmt → fork-detach via effectOf(Stmt)", async () => {
    const ast = await parse("cmd &");
    expect(effectOf(ast.stmts[0]!)).toBe("fork-detach");
  });

  test("effectsOf walks subtree and unions", async () => {
    const ast = await parse("(echo $(rm)) > out");
    const effects = effectsOf(ast);
    expect(effects.has("subshell")).toBe(true);
    expect(effects.has("exec")).toBe(true);
    expect(effects.has("capture-exec")).toBe(true);
    expect(effects.has("fs-write")).toBe(true);
  });

  test("Effect enum is exhaustive (smoke)", () => {
    // Compile-time check that the union covers every literal we emit.
    const _exhaust: Effect = "exec" as Effect;
    expect(_exhaust).toBeDefined();
  });
});

// ─── BUG-009: typed parse errors ─────────────────────────────────────────────

describe("typed parse errors (BUG-009)", () => {
  test("syntax error throws ParseSyntaxError with line/col", async () => {
    let caught: unknown;
    try {
      await parse("if; then");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseSyntaxError);
    expect(caught).toBeInstanceOf(ShellAstError);
    if (caught instanceof ParseSyntaxError) {
      expect(caught.kind).toBe("syntax");
      expect(caught.line).toBeGreaterThan(0);
      expect(caught.col).toBeGreaterThan(0);
    }
  });

  test("size error throws ParseSizeError with bytes/limit", async () => {
    let caught: unknown;
    try {
      await parse(`echo ${"x".repeat(10)}`, "bash", { maxBytes: 5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseSizeError);
    if (caught instanceof ParseSizeError) {
      expect(caught.kind).toBe("size-limit");
      expect(caught.bytes).toBeGreaterThan(5);
      expect(caught.limit).toBe(5);
    }
  });

  test("kind discriminates between error types", async () => {
    const syntax = await parse("if; then").catch((e) => e);
    const size = await parse("a", "bash", { maxBytes: 0 }).catch((e) => e);
    expect(syntax.kind).toBe("syntax");
    expect(size.kind).toBe("size-limit");
    // WasmRuntimeError is reachable only with a malformed dispatch — covered by
    // the Go-side fuzz; assert the class exists.
    expect(WasmRuntimeError.prototype).toBeInstanceOf(ShellAstError);
  });
});

// ─── BUG-010: preloadWasm ────────────────────────────────────────────────────

describe("preloadWasm (BUG-010)", () => {
  test("idempotent — multiple calls all resolve", async () => {
    await preloadWasm();
    await preloadWasm();
    await preloadWasm();
    // After preload, a parse() is instant from the WASM-load perspective.
    const ast = await parse("echo hi");
    expect(ast.type).toBe("File");
  });
});

// ─── BUG-007: unwrapCallParsed — innerAst populated ──────────────────────────

describe("unwrapCallParsed — async unwrap with innerAst (BUG-007)", () => {
  test(`bash -c "rm -rf /" returns innerAst pre-parsed`, async () => {
    const ast = await parse(`bash -c "rm -rf /"`);
    const u = await unwrapCallParsed(findCalls(ast)[0]!);
    expect(u?.kind).toBe("wrapped-script");
    if (u?.kind === "wrapped-script") {
      expect(u.script).toBe("rm -rf /");
      expect(u.innerAst).toBeDefined();
      if (u.innerAst) {
        const inner = findCalls(u.innerAst);
        expect(inner).toHaveLength(1);
      }
    }
  });

  test("plain call still resolves without innerAst", async () => {
    const ast = await parse("rm /tmp/x");
    const u = await unwrapCallParsed(findCalls(ast)[0]!);
    expect(u?.kind).toBe("plain");
  });
});

// ─── Logic fixes from the audit's adversarial bug-hunt ───────────────────────

describe("resolveFlags edge cases (held-branch logic fixes)", () => {
  // #10/11 — short-flag fabrication
  testCmd("cmd -=value", { cmd: "cmd", flags: ["-=value"], args: [] });
  testCmd("cmd -ab=c", { cmd: "cmd", flags: ["-ab=c"], args: [] });
  testCmd("gcc -O2 foo.c", { cmd: "gcc", flags: ["-O2"], args: ["foo.c"] });
  testCmd("rm -rf /", { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  // #16 — second `--` is positional
  testCmd("rm -- --", { cmd: "rm", flags: [], args: ["--"] });
  testCmd("rm -- -a -b", { cmd: "rm", flags: [], args: ["-a", "-b"] });
  // #18 — bare `-` is POSIX stdin sentinel
  testCmd("cat -", { cmd: "cat", flags: [], args: ["-"] });
  testCmd("cat - file", { cmd: "cat", flags: [], args: ["-", "file"] });
});

describe("BOM stripping (#29)", () => {
  test("leading UTF-8 BOM is stripped before parse", async () => {
    const ast = await parse("﻿echo hello");
    const cmd = ast.stmts[0]?.cmd;
    if (cmd?.type !== "CallExpr") throw new Error();
    const lit = cmd.args[0]?.parts[0];
    expect(lit?.type).toBe("Lit");
    if (lit?.type === "Lit") expect(lit.value).toBe("echo");
  });
});

// ─── Quoted-flag bypass (audit C2 — regression checks against the old "fragile" tests) ────

describe("quoted flags still canonicalize (regression locks)", () => {
  testCmd('rm "-rf" /', { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  testCmd("rm '-rf' /", { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  testCmd('rm "-r" "-f" /', { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
  testCmd('"rm" -rf /', { cmd: "rm", flags: ["-r", "-f"], args: ["/"] });
});
