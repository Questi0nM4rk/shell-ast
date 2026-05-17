// Table-driven test helper for shell-ast.
//
// SAFETY GUARANTEE — the strings passed to testCmd are PARSED, never
// executed. This file imports only `parse` and AST analyzers; it must
// not import any process-execution API. CI enforces this with a grep
// step over the whole test surface (see .github/workflows/ci.yml).
//
// Example:
//   testCmd("rm -rf /",                  { cmd: "rm", flags: ["-r","-f"], args: ["/"] });
//   testCmd("sudo -u root rm /",         { wrapper: "sudo", cmd: "rm" });
//   testCmd(`bash -c "rm -rf /"`,        { wrapper: "bash", script: "rm -rf /" });

import { expect, test } from "bun:test";
import type { ResolvedArg } from "../src/index.js";
import { findCalls, parse, resolveFlags, wordToLit } from "../src/index.js";
import type { UnwrappedCall } from "../src/semantic.js";
import { unwrapCall } from "../src/semantic.js";

type Dialect = "bash" | "posix" | "mksh";

export interface ExpectedCmd {
  // ─── Discriminator-aware assertions ──────────────────────────────
  /** If set, asserts the UnwrappedCall.kind exactly. Otherwise the
   *  expected kind is derived from the other fields. */
  kind?: UnwrappedCall["kind"];
  /** Inner cmd name for `wrapped` and `plain` kinds. Set to undefined
   *  to skip; setting to a string asserts a `wrapped`/`plain` result. */
  cmd?: string;
  /** Wrapper name for any wrapped variant. Set to null to assert
   *  `plain` kind (no wrapper). */
  wrapper?: string | null;
  /** Asserts kind === "wrapped-script" and script equals this value. */
  script?: string;

  // ─── Field-level assertions (any kind) ───────────────────────────
  flags?: string[];
  args?: ResolvedArg[];
  /** Deep-equal assertion on `u.flagValues` (plain / wrapped variants
   *  only — fails the test if the resolved kind doesn't carry it). */
  flagValues?: Record<string, ResolvedArg[]>;
  /** Presence + shape assertion on `u.innerRaw` (wrapped variant only).
   *  `cmdLit` asserts the literal of `innerRaw.args[0]`. `flagsLit`
   *  asserts the literal-resolved flag-shaped tokens (anything starting
   *  with `-` after the cmd). Either sub-field undefined skips that
   *  check; the field's presence alone asserts innerRaw exists. */
  innerRaw?: { cmdLit?: string; flagsLit?: string[] };
  /** Exact length of calls[0].assigns (for FOO=bar cmd patterns). */
  assignsCount?: number;

  // ─── Whole-AST assertions ────────────────────────────────────────
  /** Names (Lit value) of every call in source order. */
  calls?: string[];
  /** Total number of CallExpr nodes. */
  callCount?: number;

  // ─── Negative ────────────────────────────────────────────────────
  /** Expect parse() to throw. true = any throw; RegExp = message must match. */
  throws?: boolean | RegExp;

  // ─── Parse options ───────────────────────────────────────────────
  dialect?: Dialect;
  splitBraces?: boolean;

  // ─── Test-suite plumbing ─────────────────────────────────────────
  /** Override the auto-generated test name (defaults to the source). */
  name?: string;
  /** Skip this case without removing it. */
  skip?: boolean;
}

function callName(c: ReturnType<typeof findCalls>[number]): string {
  const part = c.args[0]?.parts[0];
  return part?.type === "Lit" ? part.value : "<dynamic>";
}

/** Derive the expected discriminator from the other fields when the
 *  caller didn't specify `kind` explicitly. Allows existing tests to
 *  keep working without rewriting every fixture. */
function expectedKind(e: ExpectedCmd): UnwrappedCall["kind"] | null {
  if (e.kind !== undefined) return e.kind;
  if (e.script !== undefined) return "wrapped-script";
  if (e.wrapper === null) return "plain";
  if (e.wrapper !== undefined && e.cmd === undefined) return "wrapped-opaque";
  if (e.wrapper !== undefined) return "wrapped";
  if (e.cmd !== undefined) return "plain";
  return null;
}

/** Read `wrapper` off any UnwrappedCall variant (returns null for plain). */
function wrapperOf(u: UnwrappedCall): string | null {
  return u.kind === "plain" ? null : u.wrapper;
}

/** Read `cmd` off variants that have one. */
function cmdOf(u: UnwrappedCall): string | null {
  if (u.kind === "plain" || u.kind === "wrapped") return u.cmd;
  return null;
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

    const first = calls[0];
    const u = first ? unwrapCall(first) : null;
    const r = first ? resolveFlags(first) : null;

    const wantKind = expectedKind(expected);
    if (wantKind !== null) {
      expect(u?.kind).toBe(wantKind);
    }
    if (expected.cmd !== undefined) {
      expect(u ? cmdOf(u) : null).toBe(expected.cmd);
    }
    if (expected.wrapper !== undefined) {
      expect(u ? wrapperOf(u) : null).toBe(expected.wrapper);
    }
    if (expected.script !== undefined) {
      expect(u?.kind).toBe("wrapped-script");
      if (u?.kind === "wrapped-script") {
        expect(u.script).toBe(expected.script);
      }
    }
    if (expected.flags !== undefined) {
      // For wrapped/plain/wrapped-opaque, flags come from the unwrap
      // shape; for wrapped-script the script value is separate so we
      // still read flags from u. For consistency we read r.flags
      // which is always the outer-call resolveFlags result.
      expect(r?.flags).toEqual(expected.flags);
    }
    if (expected.args !== undefined) {
      expect(r?.args).toEqual(expected.args);
    }
    if (expected.assignsCount !== undefined) {
      expect(first?.assigns.length).toBe(expected.assignsCount);
    }
    if (expected.flagValues !== undefined) {
      if (u?.kind !== "plain" && u?.kind !== "wrapped") {
        throw new Error(
          `flagValues assertion only valid on plain / wrapped variants — got ${u?.kind ?? "null"} for ${src}`
        );
      }
      expect(u.flagValues).toEqual(expected.flagValues);
    }
    if (expected.innerRaw !== undefined) {
      if (u?.kind !== "wrapped") {
        throw new Error(
          `innerRaw assertion only valid on wrapped variant — got ${u?.kind ?? "null"} for ${src}`
        );
      }
      expect(u.innerRaw.type).toBe("CallExpr");
      if (expected.innerRaw.cmdLit !== undefined) {
        const head = u.innerRaw.args[0];
        const lit = head ? wordToLit(head) : null;
        expect(lit).toBe(expected.innerRaw.cmdLit);
      }
      if (expected.innerRaw.flagsLit !== undefined) {
        const tail = u.innerRaw.args.slice(1);
        const flagTokens: string[] = [];
        for (const w of tail) {
          const lit = wordToLit(w);
          if (lit?.startsWith("-")) flagTokens.push(lit);
        }
        expect(flagTokens).toEqual(expected.innerRaw.flagsLit);
      }
    }
  });
}
