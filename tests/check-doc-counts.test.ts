// Unit tests for the doc-count drift guard's PURE logic.
//
// The guard script (scripts/check-doc-counts.ts) runs `bun test` in a
// subprocess to get the source-of-truth test count. That execution is
// deliberately NOT exercised here: this file lives under tests/, which the
// CI no-execution guard scans for process-spawning APIs. We test only the
// pure parse + compare functions, which carry all the drift logic. The
// subprocess call is a thin shell around `parseRanCount`, which IS tested.

import { describe, expect, test } from "bun:test";
import {
  extractTestCountClaims,
  extractVersionMarkers,
  findTestCountMismatches,
  findVersionMarkerMismatches,
  parseRanCount,
} from "../scripts/check-doc-counts.ts";

describe("parseRanCount", () => {
  test("extracts the count from a bun test summary line", () => {
    const out = " 329 pass\n 0 fail\nRan 329 tests across 17 files. [403.00ms]";
    expect(parseRanCount(out)).toBe(329);
  });

  test("handles the count appearing with no surrounding pass/fail lines", () => {
    expect(parseRanCount("Ran 7 tests across 1 files. [1.00ms]")).toBe(7);
  });

  test("returns the last match when the phrase appears more than once", () => {
    // Defensive: bun prints one summary, but a wrapper could echo an earlier
    // partial. The final 'Ran N tests' is the authoritative total.
    const out = "Ran 10 tests across 2 files.\n...\nRan 329 tests across 17 files.";
    expect(parseRanCount(out)).toBe(329);
  });

  test("returns null when no summary line is present", () => {
    expect(parseRanCount("error: something blew up\nno summary here")).toBeNull();
  });

  test("returns null on an empty string", () => {
    expect(parseRanCount("")).toBeNull();
  });
});

describe("extractTestCountClaims", () => {
  test("matches a bare 'N tests' claim", () => {
    expect(extractTestCountClaims("bun test  # 329 tests")).toEqual([329]);
  });

  test("matches an 'N TypeScript tests' claim", () => {
    expect(extractTestCountClaims("- **329 TypeScript tests** via bun test")).toEqual([
      329,
    ]);
  });

  test("collects every claim in a document", () => {
    const content = "245 tests here\nand 329 TypeScript tests there";
    expect(extractTestCountClaims(content)).toEqual([245, 329]);
  });

  test("does not match 'Go tests' as a TypeScript claim source of truth", () => {
    // The pattern intentionally matches any 'N tests' / 'N TypeScript tests'.
    // The guard only scans README.md + CLAUDE.md (no Go-count lines feed it),
    // but the '52 Go tests' substring still contains '52 ... tests' — assert
    // the regex captures the number directly preceding 'tests', i.e. 52 is
    // NOT captured because 'Go' sits between it and 'tests'.
    expect(extractTestCountClaims("**52 Go tests**")).toEqual([]);
  });

  test("returns an empty array when there is no claim", () => {
    expect(extractTestCountClaims("no counts in this prose at all")).toEqual([]);
  });
});

describe("findTestCountMismatches", () => {
  const docs = [
    { path: "README.md", content: "- **329 TypeScript tests**" },
    { path: "CLAUDE.md", content: "bun test  # 329 tests" },
  ];

  test("reports no violations when every claim matches the truth", () => {
    expect(findTestCountMismatches(329, docs)).toEqual([]);
  });

  test("reports a violation for a stale claim", () => {
    const stale = [{ path: "README.md", content: "- **245 TypeScript tests**" }];
    const v = findTestCountMismatches(329, stale);
    expect(v).toHaveLength(1);
    expect(v[0]?.detail).toContain("README.md");
    expect(v[0]?.detail).toContain("245");
    expect(v[0]?.detail).toContain("329");
  });

  test("reports one violation per mismatched claim across docs", () => {
    const mixed = [
      { path: "README.md", content: "245 tests" },
      { path: "CLAUDE.md", content: "329 tests" },
    ];
    expect(findTestCountMismatches(329, mixed)).toHaveLength(1);
  });

  test("a doc with no claim is fine (not every doc carries a count)", () => {
    const partial = [
      { path: "README.md", content: "- **329 TypeScript tests**" },
      { path: "CLAUDE.md", content: "no count in this one" },
    ];
    expect(findTestCountMismatches(329, partial)).toEqual([]);
  });
});

describe("extractVersionMarkers", () => {
  test("captures a 'Current: vX.Y.Z' marker", () => {
    expect(extractVersionMarkers("Current: v0.7.0")).toEqual(["0.7.0"]);
  });

  test("captures a 'Status: X.Y.Z' marker without the v prefix", () => {
    expect(extractVersionMarkers("Status: 1.2.3")).toEqual(["1.2.3"]);
  });

  test("captures multiple markers", () => {
    expect(extractVersionMarkers("Current: v0.7.0\nStatus:  v0.7.0")).toEqual([
      "0.7.0",
      "0.7.0",
    ]);
  });

  test("ignores plain version strings that are not Current/Status markers", () => {
    // The npm badge and prose mentions of versions must NOT trip the guard;
    // only the hardcoded Current:/Status: markers do.
    expect(extractVersionMarkers("shipped in v0.7.0; see the badge")).toEqual([]);
  });

  test("returns an empty array when there are no markers", () => {
    expect(extractVersionMarkers("no version markers here")).toEqual([]);
  });
});

describe("findVersionMarkerMismatches", () => {
  test("no violations when no markers exist (the preferred state)", () => {
    expect(findVersionMarkerMismatches("0.7.0", "rely on the npm badge")).toEqual([]);
  });

  test("no violations when a marker agrees with package.json", () => {
    expect(findVersionMarkerMismatches("0.7.0", "Current: v0.7.0")).toEqual([]);
  });

  test("reports a violation when a marker disagrees with package.json", () => {
    const v = findVersionMarkerMismatches("0.7.0", "Current: v0.6.0");
    expect(v).toHaveLength(1);
    expect(v[0]?.detail).toContain("0.6.0");
    expect(v[0]?.detail).toContain("0.7.0");
  });
});
