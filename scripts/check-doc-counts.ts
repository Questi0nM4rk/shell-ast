#!/usr/bin/env bun
/**
 * Cross-doc count-drift audit.
 *
 * @internal — CI guard, not a public API.
 *
 * Guards against silent drift between counts claimed in docs and the actual
 * source-of-truth values. README.md and CLAUDE.md both quote the TypeScript
 * test count ("245 TypeScript tests"); when the suite grows, those numbers
 * rot. This script makes the rot fail CI loudly instead of slipping through
 * to a published 1.0 README.
 *
 * Audits:
 *
 *   1. Test-count drift. Runs `bun test`, parses its `Ran N tests` summary as
 *      the source of truth, then scans README.md + CLAUDE.md for any
 *      "N tests" / "N TypeScript tests" claim and requires every one to equal
 *      the real count.
 *
 *   2. Hardcoded version markers. package.json's `version` is the single
 *      source of truth (surfaced in docs via the npm badge). A literal
 *      `Current: vX.Y.Z` or `Status: vX.Y.Z` marker in README.md that
 *      disagrees with package.json is drift; the preferred state is no such
 *      marker at all.
 *
 * The only side-effecting step (spawning `bun test`) lives in `runTestCount`,
 * a thin shell around the pure `parseRanCount`. Everything else is pure and
 * unit-tested in tests/check-doc-counts.test.ts. The script self-executes only
 * under `import.meta.main`, so importing it for tests does not run `main()`.
 *
 * Usage:
 *   bun scripts/check-doc-counts.ts          # run all audits
 *   bun scripts/check-doc-counts.ts --quiet  # only print on failure
 *
 * Exit codes:
 *   0  every audit passed
 *   1  one or more audits found drift
 *   2  argument-parse, file-read, or test-run failure
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = "check-doc-counts";

/** Docs that may carry a test-count claim. */
const TEST_COUNT_DOCS: readonly string[] = ["README.md", "CLAUDE.md"];
/** Docs scanned for hardcoded version markers. */
const VERSION_MARKER_DOCS: readonly string[] = ["README.md"];

export interface Violation {
  readonly audit: string;
  readonly detail: string;
}

export interface Doc {
  readonly path: string;
  readonly content: string;
}

interface Args {
  readonly quiet: boolean;
}

function parseArgs(argv: readonly string[]): Args | null {
  let quiet = false;
  for (const a of argv) {
    if (a === "--quiet") {
      quiet = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      process.stderr.write(`${SCRIPT}: unrecognized arg '${a}'\n`);
      printHelp();
      return null;
    }
  }
  return { quiet };
}

function printHelp(): void {
  process.stderr.write(`\
check-doc-counts — audit doc count/version claims against source truth.

Usage: bun scripts/check-doc-counts.ts [--quiet]

Audits:
  1. Test-count drift — README.md + CLAUDE.md "N tests" claims vs the live
     'Ran N tests' count from \`bun test\`.
  2. Hardcoded version markers — README.md 'Current:/Status: vX.Y.Z' vs
     package.json version (preferred: no such marker; rely on the npm badge).

Exits 0 if all audits pass.
Exits 1 if any audit found drift.
Exits 2 on argument, file-read, or test-run errors.
`);
}

// ─── pure logic (unit-tested) ────────────────────────────────────────────────

/** Parse the test count out of `bun test`'s summary line ("Ran N tests …").
 *  Returns the LAST match (the authoritative total) or null if absent. */
export function parseRanCount(output: string): number | null {
  const re = /Ran\s+(\d+)\s+tests?\b/g;
  let last: number | null = null;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical /g regex iteration; assignment-in-while is the documented MDN pattern.
  while ((match = re.exec(output)) !== null) {
    const n = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(n)) {
      last = n;
    }
  }
  return last;
}

/** Collect every "N tests" / "N TypeScript tests" claim in a doc. The
 *  optional `TypeScript ` qualifier sits between the number and "tests"; any
 *  other word there (e.g. "52 Go tests") does NOT match, so Go-count lines
 *  never feed the TypeScript audit. */
export function extractTestCountClaims(content: string): number[] {
  const re = /(\d+)\s+(?:TypeScript\s+)?tests\b/g;
  const claims: number[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical /g regex iteration; assignment-in-while is the documented MDN pattern.
  while ((match = re.exec(content)) !== null) {
    const n = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(n)) {
      claims.push(n);
    }
  }
  return claims;
}

/** Compare each doc's test-count claims against the source-of-truth count.
 *  A doc with no claim is fine; only a claim that disagrees is a violation. */
export function findTestCountMismatches(
  truth: number,
  docs: readonly Doc[]
): Violation[] {
  const AUDIT = "test-count";
  const violations: Violation[] = [];
  for (const doc of docs) {
    for (const claim of extractTestCountClaims(doc.content)) {
      if (claim !== truth) {
        violations.push({
          audit: AUDIT,
          detail: `${doc.path}: claims ${String(claim)} tests; \`bun test\` ran ${String(truth)}`,
        });
      }
    }
  }
  return violations;
}

/** Extract the version from every hardcoded `Current:`/`Status:` marker, with
 *  or without a leading `v`. Plain version mentions (badge, prose) do NOT
 *  match — only the labelled markers. */
export function extractVersionMarkers(content: string): string[] {
  const re = /(?:Current|Status):\s*v?(\d+\.\d+\.\d+)/g;
  const markers: string[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical /g regex iteration; assignment-in-while is the documented MDN pattern.
  while ((match = re.exec(content)) !== null) {
    const v = match[1];
    if (v !== undefined) {
      markers.push(v);
    }
  }
  return markers;
}

/** A hardcoded version marker that disagrees with package.json is drift. The
 *  preferred state is no marker at all (the npm badge is the live source). */
export function findVersionMarkerMismatches(
  pkgVersion: string,
  content: string
): Violation[] {
  const AUDIT = "version-marker";
  const violations: Violation[] = [];
  for (const marker of extractVersionMarkers(content)) {
    if (marker !== pkgVersion) {
      violations.push({
        audit: AUDIT,
        detail: `README.md: hardcoded version marker '${marker}' disagrees with package.json '${pkgVersion}' (prefer no marker — rely on the npm badge)`,
      });
    }
  }
  return violations;
}

// ─── I/O shells (not unit-tested; thin wrappers around pure logic) ────────────

function readFile(path: string): string | null {
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${SCRIPT}: cannot read ${path}: ${msg}\n`);
    return null;
  }
}

/** Run `bun test` and return the parsed count. null = couldn't determine. */
function runTestCount(): number | null {
  const res = spawnSync("bun", ["test"], {
    cwd: process.cwd(),
    encoding: "utf8",
    // bun prints the summary to stderr; capture both streams.
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.error) {
    process.stderr.write(
      `${SCRIPT}: failed to spawn 'bun test': ${res.error.message}\n`
    );
    return null;
  }
  const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  return parseRanCount(combined);
}

interface PackageVersion {
  readonly version?: string;
}

function readPackageVersion(): string | null {
  const raw = readFile("package.json");
  if (raw === null) {
    return null;
  }
  try {
    const pkg = JSON.parse(raw) as PackageVersion;
    return pkg.version ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${SCRIPT}: package.json parse failed: ${msg}\n`);
    return null;
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    return 2;
  }

  const violations: Violation[] = [];

  // Audit 1: test-count drift.
  const truth = runTestCount();
  if (truth === null) {
    process.stderr.write(
      `${SCRIPT}: could not determine the test count from 'bun test'\n`
    );
    return 2;
  }
  const testDocs: Doc[] = [];
  for (const path of TEST_COUNT_DOCS) {
    const content = readFile(path);
    if (content === null) {
      return 2;
    }
    testDocs.push({ path, content });
  }
  violations.push(...findTestCountMismatches(truth, testDocs));

  // Audit 2: hardcoded version markers.
  const pkgVersion = readPackageVersion();
  if (pkgVersion === null) {
    return 2;
  }
  for (const path of VERSION_MARKER_DOCS) {
    const content = readFile(path);
    if (content === null) {
      return 2;
    }
    violations.push(...findVersionMarkerMismatches(pkgVersion, content));
  }

  if (violations.length === 0) {
    if (!args.quiet) {
      process.stderr.write(
        `${SCRIPT}: all audits passed (bun test ran ${String(truth)} tests)\n`
      );
    }
    return 0;
  }

  for (const v of violations) {
    process.stderr.write(`${SCRIPT} [${v.audit}]: ${v.detail}\n`);
  }
  process.stderr.write(
    `\n${SCRIPT}: ${String(violations.length)} drift(s) found.\n` +
      "Update each doc to match the source of truth (the live test count / package.json\n" +
      "version), or fix the source if the doc value is the intended one.\n"
  );
  return 1;
}

// Self-execute only as a script; importing for tests must not run main().
if (import.meta.main) {
  process.exit(main());
}
