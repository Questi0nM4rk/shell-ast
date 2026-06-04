// Snapshot regression on UnwrappedCall shape.
//
// Enumerates one canonical invocation per UnwrappedCall variant ×
// wrapper category, snapshots the normalized JSON. Future shape
// changes (added fields, renamed fields, dropped fields, variant
// additions, value-extraction regressions) surface in the snapshot
// diff so they can't be silent.
//
// `raw` and `innerRaw` are shrunk to `{ type, argCount, headLit }` —
// the full AST node is too pos/end-noisy for snapshot stability and
// not what we're guarding here. The snapshot's job is to lock the
// SHAPE of UnwrappedCall, not the AST positions.
//
// DYNAMIC sentinel (Symbol) is rendered as the literal string
// "<DYNAMIC>" so it survives JSON.stringify in the snapshot.

import { describe, expect, test } from "bun:test";
import {
  DYNAMIC,
  findCalls,
  isDynamic,
  parse,
  type ResolvedArg,
  type UnwrappedCall,
  unwrapCall,
  wordToLit,
} from "../src/index.js";
import type { CallExprNode } from "../src/types.js";
import { testCmd } from "./_assertions.js";

function summarizeCall(c: CallExprNode): {
  type: string;
  argCount: number;
  headLit: string | null;
} {
  const head = c.args[0];
  return {
    type: c.type,
    argCount: c.args.length,
    headLit: head ? wordToLit(head) : null,
  };
}

function normalizeArg(a: ResolvedArg): string {
  return isDynamic(a) ? "<DYNAMIC>" : a;
}

function normalizeFlagValues(
  fv: Record<string, ResolvedArg[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fv)) {
    out[k] = v.map(normalizeArg);
  }
  return out;
}

function normalize(u: UnwrappedCall | null): unknown {
  if (u === null) return { _null: true };
  switch (u.kind) {
    case "plain":
      return {
        kind: u.kind,
        cmd: u.cmd,
        flags: u.flags,
        args: u.args.map(normalizeArg),
        flagValues: normalizeFlagValues(u.flagValues),
        raw: summarizeCall(u.raw),
      };
    case "wrapped":
      return {
        kind: u.kind,
        wrapper: u.wrapper,
        cmd: u.cmd,
        flags: u.flags,
        args: u.args.map(normalizeArg),
        flagValues: normalizeFlagValues(u.flagValues),
        innerRaw: summarizeCall(u.innerRaw),
        raw: summarizeCall(u.raw),
      };
    case "wrapped-script":
      return {
        kind: u.kind,
        wrapper: u.wrapper,
        script: u.script,
        flags: u.flags,
        args: u.args.map(normalizeArg),
        raw: summarizeCall(u.raw),
        innerAst: u.innerAst === undefined ? "<unparsed>" : "<parsed>",
      };
    case "wrapped-opaque":
      return {
        kind: u.kind,
        wrapper: u.wrapper,
        reason: u.reason,
        flags: u.flags,
        args: u.args.map(normalizeArg),
        raw: summarizeCall(u.raw),
      };
  }
}

const cases: Array<{ name: string; src: string }> = [
  // ─── plain ─────────────────────────────────────────────────────────
  { name: "plain — bare rm with combined-short", src: "rm -rf /tmp/x" },
  { name: "plain — basename path resolution", src: "/usr/bin/git status" },
  {
    name: "plain — git with global value-flag",
    src: "git -C /tmp worktree add /tmp/x",
  },
  { name: "plain — wrapper-named no inner (bash --version)", src: "bash --version" },
  { name: "plain — wrapper-named no inner (sudo -V)", src: "sudo -V" },

  // ─── wrapped ───────────────────────────────────────────────────────
  { name: "wrapped — sudo + rm", src: "sudo rm -rf /tmp/x" },
  { name: "wrapped — doas + gcc", src: "doas gcc -o /tmp/x src.c" },
  {
    name: "wrapped — sudo with -u + inner global flag",
    src: "sudo -u root git -C /tmp status",
  },
  { name: "wrapped — positionalUser (gosu)", src: "gosu nobody rm /tmp/x" },
  { name: "wrapped — exec strip", src: "exec rm -rf /tmp/x" },
  { name: "wrapped — sudo + basename-path inner", src: "sudo /usr/bin/git status" },

  // ─── wrapped-script ────────────────────────────────────────────────
  { name: "wrapped-script — bash -c", src: 'bash -c "rm -rf /tmp/x"' },
  { name: "wrapped-script — sh -c", src: 'sh -c "echo hi"' },
  { name: "wrapped-script — eval (commandFromArgs)", src: "eval 'rm -rf /tmp/x'" },
  {
    name: "wrapped-opaque — bash -c with dynamic body + trailing args",
    src: 'bash -c "$@" sh arg1 arg2',
  },

  // ─── wrapped-opaque ────────────────────────────────────────────────
  { name: "wrapped-opaque — sudo $cmd", src: "sudo $CMD" },
  { name: "wrapped-opaque — bash -c $script", src: "bash -c $SCRIPT" },
  { name: "wrapped-opaque — bash -c (missing-script)", src: "bash -c" },

  // ─── chained wrapper (per lesson L4: asymmetric variant classification) ─
  // sudo bash -c '…' is the canonical case where bare `bash -c` is
  // wrapped-script but adding sudo makes it wrapped-with-bash-inner.
  // Snapshot the outer layer; the chain is exercised by unwrap-deep.test.ts.
  { name: "chained — sudo bash -c '...'", src: "sudo bash -c 'rm -rf /tmp/x'" },
];

describe("UnwrappedCall snapshot regression", () => {
  for (const { name, src } of cases) {
    test(name, async () => {
      const ast = await parse(src);
      const u = unwrapCall(findCalls(ast)[0]!);
      expect(normalize(u)).toMatchSnapshot();
    });
  }
});

describe("snapshot helpers — sanity", () => {
  test("normalizeArg renders DYNAMIC as <DYNAMIC>", () => {
    expect(normalizeArg(DYNAMIC)).toBe("<DYNAMIC>");
    expect(normalizeArg("literal")).toBe("literal");
  });
});

describe("wrapped-opaque reason discriminator (v0.8.0)", () => {
  testCmd('bash -c "$CMD"', {
    kind: "wrapped-opaque",
    wrapper: "bash",
    reason: "dynamic-script",
  });
  testCmd("bash -c", {
    kind: "wrapped-opaque",
    wrapper: "bash",
    reason: "missing-script",
  });
  testCmd("sudo $CMD", {
    kind: "wrapped-opaque",
    wrapper: "sudo",
    reason: "dynamic-command",
  });
  testCmd("eval $SCRIPT", {
    kind: "wrapped-opaque",
    wrapper: "eval",
    reason: "dynamic-script",
  });
});
