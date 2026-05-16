// v0.5.0: zero-config query helpers in src/query.ts.
//
// All helpers operate on a raw CallExprNode and don't require resolveFlags
// to be called first. They handle both space form (`-C /tmp`) and = form
// (`--git-dir=/repo`) where it makes semantic sense.
//
// `hasFlag` uses broad matching (literal, combined-short, = form LHS).
// `tokenAfter` returns the FIRST occurrence; `tokensAfter` returns ALL.

import { describe, expect, test } from "bun:test";
import {
  DYNAMIC,
  findCalls,
  flagsMatching,
  hasFlag,
  indexOfFlag,
  parse,
  resolvedCmd,
  tokenAfter,
  tokenAt,
  tokensAfter,
} from "../src/index.js";

async function firstCall(src: string) {
  const ast = await parse(src);
  const [c] = findCalls(ast);
  if (!c) throw new Error(`no CallExpr in: ${src}`);
  return c;
}

describe("tokenAfter — single value after a flag", () => {
  test("space form", async () => {
    expect(tokenAfter(await firstCall("git -C /tmp status"), "-C")).toBe("/tmp");
  });

  test("= form", async () => {
    expect(tokenAfter(await firstCall("git --git-dir=/repo status"), "--git-dir")).toBe(
      "/repo"
    );
  });

  test("= form with value containing another =", async () => {
    expect(tokenAfter(await firstCall("git -c color.ui=auto status"), "-c")).toBe(
      "color.ui=auto"
    );
  });

  test("returns first occurrence when flag appears multiple times", async () => {
    expect(tokenAfter(await firstCall("git -c a=1 -c b=2 status"), "-c")).toBe("a=1");
  });

  test("dynamic value → DYNAMIC sentinel", async () => {
    expect(tokenAfter(await firstCall('git -C "$DIR" status'), "-C")).toBe(DYNAMIC);
  });

  test("flag at end with no value → undefined", async () => {
    expect(tokenAfter(await firstCall("git -C"), "-C")).toBeUndefined();
  });

  test("flag not present → undefined", async () => {
    expect(tokenAfter(await firstCall("git status"), "-C")).toBeUndefined();
  });

  test("strict literal: -r does NOT match inside -rf (avoids ambiguity)", async () => {
    expect(tokenAfter(await firstCall("gcc -rf out.txt"), "-r")).toBeUndefined();
  });

  test("works without globalFlags table for the tool (zero-config)", async () => {
    // `frobnicate` is not in GLOBAL_VALUE_FLAGS. tokenAfter still finds it.
    expect(tokenAfter(await firstCall("frobnicate -X /tmp do-it"), "-X")).toBe("/tmp");
  });
});

describe("tokensAfter — all values across occurrences", () => {
  test("returns one entry per occurrence", async () => {
    expect(tokensAfter(await firstCall("git -c a=1 -c b=2 status"), "-c")).toEqual([
      "a=1",
      "b=2",
    ]);
  });

  test("mixes space and = forms", async () => {
    expect(
      tokensAfter(await firstCall("git --git-dir=/a --git-dir /b status"), "--git-dir")
    ).toEqual(["/a", "/b"]);
  });

  test("includes DYNAMIC for dynamic values", async () => {
    expect(tokensAfter(await firstCall('git -c k=v -c "$X" status'), "-c")).toEqual([
      "k=v",
      DYNAMIC,
    ]);
  });

  test("returns empty array when flag not present", async () => {
    expect(tokensAfter(await firstCall("git status"), "-C")).toEqual([]);
  });

  test("skips occurrences with no following token (end-of-args)", async () => {
    expect(tokensAfter(await firstCall("git -C /a -C"), "-C")).toEqual(["/a"]);
  });
});

describe("hasFlag — broad match", () => {
  test("literal token match", async () => {
    expect(hasFlag(await firstCall("git -C /tmp status"), "-C")).toBe(true);
  });

  test("matches inside combined short flag", async () => {
    expect(hasFlag(await firstCall("gcc -rf out.txt"), "-r")).toBe(true);
    expect(hasFlag(await firstCall("gcc -rf out.txt"), "-f")).toBe(true);
  });

  test("matches LHS of = form", async () => {
    expect(hasFlag(await firstCall("git --git-dir=/repo status"), "--git-dir")).toBe(
      true
    );
  });

  test("returns false when not present in any form", async () => {
    expect(hasFlag(await firstCall("git status"), "-C")).toBe(false);
    expect(hasFlag(await firstCall("gcc -rf out.txt"), "-x")).toBe(false);
  });

  test("does not match dynamic tokens (they have no resolvable string)", async () => {
    expect(hasFlag(await firstCall('git "$FLAG" status'), "-C")).toBe(false);
  });
});

describe("indexOfFlag — position in call.args", () => {
  test("returns 1-based-ish index in call.args (args[0] is cmd, so first arg-after-cmd is 1)", async () => {
    // call.args = [git, -C, /tmp, status]; -C is at index 1
    expect(indexOfFlag(await firstCall("git -C /tmp status"), "-C")).toBe(1);
  });

  test("finds combined-short flag at its containing token's index", async () => {
    // call.args = [gcc, -rf, out.txt]; -r is "in" -rf at index 1
    expect(indexOfFlag(await firstCall("gcc -rf out.txt"), "-r")).toBe(1);
  });

  test("finds = form at its containing token's index", async () => {
    expect(
      indexOfFlag(await firstCall("git --git-dir=/repo status"), "--git-dir")
    ).toBe(1);
  });

  test("undefined when not present", async () => {
    expect(indexOfFlag(await firstCall("git status"), "-C")).toBeUndefined();
  });
});

describe("tokenAt — raw nth token with wordToLit resolution", () => {
  test("tokenAt(call, 0) is the command itself", async () => {
    expect(tokenAt(await firstCall("git status"), 0)).toBe("git");
  });

  test("tokenAt(call, 1) is the first arg-after-cmd", async () => {
    expect(tokenAt(await firstCall("git push origin main"), 1)).toBe("push");
  });

  test("dynamic token → DYNAMIC sentinel", async () => {
    expect(tokenAt(await firstCall('echo "$X" foo'), 1)).toBe(DYNAMIC);
  });

  test("out-of-range → undefined", async () => {
    expect(tokenAt(await firstCall("git status"), 5)).toBeUndefined();
  });

  test("negative → undefined", async () => {
    expect(tokenAt(await firstCall("git status"), -1)).toBeUndefined();
  });
});

describe("flagsMatching — filter flag-like literal tokens by predicate", () => {
  test("dd if=/of= style", async () => {
    expect(
      flagsMatching(await firstCall("dd if=/dev/zero of=/tmp/x bs=1M"), (f) =>
        f.includes("=")
      )
    ).toEqual(["if=/dev/zero", "of=/tmp/x", "bs=1M"]);
  });

  test("matches flag-shaped tokens (starts with -) too", async () => {
    expect(
      flagsMatching(await firstCall("git --git-dir=/repo --bare status"), (f) =>
        f.startsWith("--")
      )
    ).toEqual(["--git-dir=/repo", "--bare"]);
  });

  test("empty when no tokens match", async () => {
    expect(
      flagsMatching(await firstCall("git status"), (f) => f.startsWith("--"))
    ).toEqual([]);
  });

  test("does not include the cmd itself", async () => {
    // "git" doesn't pass the predicate; this confirms cmd is skipped
    expect(flagsMatching(await firstCall("git status"), () => true)).toEqual([
      "status",
    ]);
  });
});

describe("resolvedCmd — basename of args[0], wordToLit'd", () => {
  test("bare cmd", async () => {
    expect(resolvedCmd(await firstCall("git status"))).toBe("git");
  });

  test("full path → basename", async () => {
    expect(resolvedCmd(await firstCall("/usr/bin/git status"))).toBe("git");
  });

  test("relative path → basename", async () => {
    expect(resolvedCmd(await firstCall("./bin/docker run"))).toBe("docker");
  });

  test("dynamic cmd → undefined", async () => {
    expect(resolvedCmd(await firstCall('"$CMD" status'))).toBeUndefined();
  });

  test("cmd with no trailing basename (trailing slash) → empty string", async () => {
    // Weird edge case: literal "/bin/" as a command. Not realistic but defines behavior.
    expect(resolvedCmd(await firstCall("/bin/ status"))).toBe("");
  });
});

describe("integration — hook-kit-style rule using the helpers", () => {
  test("'gcc -o must write to /tmp/' rule", async () => {
    // The user's worked example from the brainstorm
    async function checkGccOutput(src: string): Promise<string | null> {
      const ast = await parse(src);
      for (const call of findCalls(ast)) {
        if (resolvedCmd(call) !== "gcc") continue;
        const out = tokenAfter(call, "-o");
        if (typeof out === "string" && !out.startsWith("/tmp/"))
          return `gcc -o ${out} writes outside /tmp`;
      }
      return null;
    }

    expect(await checkGccOutput("gcc -o /tmp/a.out main.c")).toBeNull();
    expect(await checkGccOutput("gcc -o ./build/a.out main.c")).toBe(
      "gcc -o ./build/a.out writes outside /tmp"
    );
    // Full-path gcc still works because resolvedCmd basename-strips
    expect(await checkGccOutput("/usr/bin/gcc -o /etc/x.out main.c")).toBe(
      "gcc -o /etc/x.out writes outside /tmp"
    );
    // No -o → no rule fires
    expect(await checkGccOutput("gcc -c main.c")).toBeNull();
  });
});
