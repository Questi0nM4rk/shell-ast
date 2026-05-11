// Table-driven test helper for shell-ast.
//
// SAFETY GUARANTEE — the strings passed to testCmd are PARSED, never
// executed. This file imports only `parse` and AST analyzers; it must
// not import any process-execution API. CI enforces this with a grep
// step over the whole test surface (see .github/workflows/ci.yml).
//
// Example:
//   testCmd("rm -rf /", { cmd: "rm", flags: ["-r","-f"], args: ["/"] });

import { expect, test } from "bun:test";
import type { ResolvedArg } from "../src/index.js";
import { findCalls, parse, resolveFlags } from "../src/index.js";
import { unwrapCall } from "../src/semantic.js";

type Dialect = "bash" | "posix" | "mksh";

export interface ExpectedCmd {
  // First-call assertions (applied to calls[0])
  cmd?: string | null;
  flags?: string[];
  args?: ResolvedArg[];
  wrapper?: string | null;
  commandString?: string;
  /** Exact length of calls[0].assigns (for FOO=bar cmd patterns). */
  assignsCount?: number;

  // Whole-AST assertions
  /** Names (Lit value) of every call in source order. */
  calls?: string[];
  /** Total number of CallExpr nodes. */
  callCount?: number;

  // Negative
  /** Expect parse() to throw. true = any throw; RegExp = message must match. */
  throws?: boolean | RegExp;

  // Parse options
  dialect?: Dialect;
  splitBraces?: boolean;

  // Test-suite plumbing
  /** Override the auto-generated test name (defaults to the source). */
  name?: string;
  /** Skip this case without removing it. */
  skip?: boolean;
}

function callName(c: ReturnType<typeof findCalls>[number]): string {
  const part = c.args[0]?.parts[0];
  return part?.type === "Lit" ? part.value : "<dynamic>";
}

export function testCmd(src: string, expected: ExpectedCmd): void {
  const runner = expected.skip ? test.skip : test;
  runner(expected.name ?? src, async () => {
    if (expected.throws !== undefined && expected.throws !== false) {
      const matcher = expected.throws === true ? undefined : expected.throws;
      await expect(
        parse(src, expected.dialect, { splitBraces: expected.splitBraces })
      ).rejects.toThrow(matcher);
      return;
    }

    const ast = await parse(src, expected.dialect, {
      splitBraces: expected.splitBraces,
    });
    const calls = findCalls(ast);

    if (expected.calls !== undefined) {
      expect(calls.map(callName)).toEqual(expected.calls);
    }
    if (expected.callCount !== undefined) {
      expect(calls.length).toBe(expected.callCount);
    }

    // Hoist single-call analyses so each per-field assertion just
    // reads from the cached value. unwrapCall covers both wrapper and
    // non-wrapper paths (it returns {wrapper: null, cmd: ...} for
    // plain calls), so it's the source of truth for cmd.
    const first = calls[0];
    const u = first ? unwrapCall(first) : null;
    const r = first ? resolveFlags(first) : null;

    if (expected.cmd !== undefined) expect(u?.cmd ?? null).toBe(expected.cmd);
    if (expected.flags !== undefined) expect(r?.flags).toEqual(expected.flags);
    if (expected.args !== undefined) expect(r?.args).toEqual(expected.args);
    if (expected.wrapper !== undefined)
      expect(u?.wrapper ?? null).toBe(expected.wrapper);
    if (expected.commandString !== undefined) {
      expect(u?.commandString).toBe(expected.commandString);
    }
    if (expected.assignsCount !== undefined) {
      expect(first?.assigns.length).toBe(expected.assignsCount);
    }
  });
}
