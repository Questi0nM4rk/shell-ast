// Regression tests: ParamExp.names and ArithmExp.bracket must stay typed (audit A4).

/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell ${var} fixtures, not JS template literals */

import { describe, expect, test } from "bun:test";
import { parse } from "../src/index.js";
import type { ArithmExp, DblQuoted, ParamExp, WordPart } from "../src/types.js";

function firstWordPart<T extends WordPart>(
  ast: Awaited<ReturnType<typeof parse>>,
  pickArg = 1
): T {
  const stmt = ast.stmts[0];
  if (!stmt || stmt.cmd?.type !== "CallExpr") throw new Error("not a CallExpr");
  const word = stmt.cmd.args[pickArg];
  if (!word) throw new Error("missing arg");
  const part = word.parts[0];
  if (!part) throw new Error("missing part");
  return part as T;
}

describe("ParamExp.names (audit A4)", () => {
  test('"" for non-names expansion', async () => {
    const ast = await parse('echo "${name}"');
    const dq = firstWordPart<DblQuoted>(ast);
    expect(dq.type).toBe("DblQuoted");
    const pe = dq.parts[0] as ParamExp;
    expect(pe.type).toBe("ParamExp");
    expect(pe.names).toBe("");
  });

  test('"@" for ${!prefix@} (matching variable names)', async () => {
    const ast = await parse('echo "${!prefix@}"');
    const dq = firstWordPart<DblQuoted>(ast);
    const pe = dq.parts[0] as ParamExp;
    expect(pe.names).toBe("@");
  });

  test('"*" for ${!prefix*}', async () => {
    const ast = await parse('echo "${!prefix*}"');
    const dq = firstWordPart<DblQuoted>(ast);
    const pe = dq.parts[0] as ParamExp;
    expect(pe.names).toBe("*");
  });
});

describe("ArithmExp.bracket (audit A4)", () => {
  test("false for $((x+1)) (parens form)", async () => {
    const ast = await parse("echo $((x+1))");
    const ae = firstWordPart<ArithmExp>(ast);
    expect(ae.type).toBe("ArithmExp");
    expect(ae.bracket).toBe(false);
  });

  test("true for $[x+1] (deprecated bracket form)", async () => {
    const ast = await parse("echo $[x+1]");
    const ae = firstWordPart<ArithmExp>(ast);
    expect(ae.type).toBe("ArithmExp");
    expect(ae.bracket).toBe(true);
  });
});
