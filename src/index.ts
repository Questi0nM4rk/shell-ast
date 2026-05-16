import type { ShellFile } from "./types.js";
import { loadWasm, parseRaw } from "./wasm.js";

// ─── Type re-exports ─────────────────────────────────────────────────────────

export type {
  Assign,
  CallExprNode,
  CmdSubst,
  FuncDecl,
  Redirect,
  ShellFile,
  ShellNode,
  Stmt,
  Word,
  WordPart,
} from "./types.js";
export type { Visitor } from "./walk.js";

// ─── Walker + extractors (BUG-006: filter options) ───────────────────────────

export {
  type ExtractAssignmentOptions,
  type ExtractCallOptions,
  type ExtractRedirectOptions,
  findAll,
  findAssignments,
  findCalls,
  findCmdSubstitutions,
  findFunctions,
  findRedirects,
} from "./extract.js";
export { walk } from "./walk.js";

// ─── flags.ts — canonicalization + ArgFragment + DYNAMIC ─────────────────────

export {
  type ArgFragment,
  DYNAMIC,
  isDynamic,
  isResolved,
  type ResolvedArg,
  type ResolvedCall,
  resolveFlags,
  unescapeAnsiC,
  wordToLit,
  wordToParts,
} from "./flags.js";

// ─── semantic.ts — discriminated UnwrappedCall ───────────────────────────────

import type { UnwrappedCall } from "./semantic.js";
import { unwrapCallParsed as _unwrapCallParsedInternal } from "./semantic.js";
import type { CallExprNode } from "./types.js";

export type { UnwrappedCall } from "./semantic.js";
export { unwrapCall } from "./semantic.js";

// ─── Effects API ─────────────────────────────────────────────────────────────

export { type Effect, effectOf, effectsOf } from "./effects.js";

// ─── ParseError hierarchy (BUG-009) ──────────────────────────────────────────

/** Discriminated base class for any error thrown by `parse()`. Consumers
 *  catch and dispatch on `kind` instead of regexing message strings. */
export abstract class ShellAstError extends Error {
  abstract readonly kind: "syntax" | "size-limit" | "wasm-load" | "wasm-runtime";
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Thrown by `parse()` when mvdan/sh's parser rejects the input. */
export class ParseSyntaxError extends ShellAstError {
  readonly kind = "syntax" as const;
  readonly line: number;
  readonly col: number;
  /** Short window of source around the syntax error (best-effort). */
  readonly snippet: string | undefined;

  constructor(message: string, line: number, col: number, snippet?: string) {
    super(message);
    this.line = line;
    this.col = col;
    this.snippet = snippet;
  }
}

/** Thrown by `parse()` when the input exceeds the configured maxBytes. */
export class ParseSizeError extends ShellAstError {
  readonly kind = "size-limit" as const;
  readonly bytes: number;
  readonly limit: number;
  constructor(bytes: number, limit: number) {
    super(`shell-ast: input size ${bytes} bytes exceeds maxBytes ${limit}`);
    this.bytes = bytes;
    this.limit = limit;
  }
}

/** Thrown when the WASM module fails to load (file missing, bad path,
 *  malformed binary). Different from a syntax error — distinguishes
 *  "infra broken" from "user input malformed". */
export class WasmLoadError extends ShellAstError {
  readonly kind = "wasm-load" as const;
}

/** Thrown when the WASM module loaded but reported an internal error
 *  during parse (very rare; usually indicates a serializer bug). */
export class WasmRuntimeError extends ShellAstError {
  readonly kind = "wasm-runtime" as const;
}

/** Parse a `1:5: message` style location from mvdan/sh error text.
 *  Returns nullish components when the pattern doesn't match. */
function parseLocation(msg: string): { line?: number; col?: number; rest: string } {
  const m = msg.match(/^(\d+):(\d+):\s*(.+)$/s);
  if (!m) return { rest: msg };
  const [, line, col, rest] = m;
  if (line === undefined || col === undefined || rest === undefined) {
    return { rest: msg };
  }
  return { line: Number(line), col: Number(col), rest };
}

function snippetAt(src: string, line: number, col: number): string {
  const lines = src.split(/\r?\n/);
  const target = lines[line - 1] ?? "";
  const pointer = `${" ".repeat(Math.max(0, col - 1))}^`;
  return `${target}\n${pointer}`;
}

// ─── parse() ─────────────────────────────────────────────────────────────────

export interface ParseOptions {
  /** Reject inputs whose UTF-8 byte length exceeds this cap.
   *  Defaults to 1_000_000 (1 MB). Pass Infinity to disable. */
  maxBytes?: number;
  /** Apply mvdan/sh's SplitBraces post-pass so `{a,b,c}` becomes a
   *  BraceExp node instead of a literal. Default false (matches the
   *  parser's default — brace expansion is a runtime concept). */
  splitBraces?: boolean;
}

const DEFAULT_MAX_BYTES = 1_000_000;

export async function parse(
  src: string,
  dialect: "bash" | "posix" | "mksh" = "bash",
  options: ParseOptions = {}
): Promise<ShellFile> {
  // Strip a leading UTF-8 BOM — mvdan/sh would otherwise treat it as
  // part of the first token (cmd: "﻿echo") and consumers see an
  // unresolvable command name. Files exported from Windows tooling
  // frequently carry one.
  if (src.charCodeAt(0) === 0xfeff) {
    src = src.slice(1);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const bytes = Buffer.byteLength(src, "utf8");
  if (bytes > maxBytes) {
    throw new ParseSizeError(bytes, maxBytes);
  }

  try {
    await loadWasm();
  } catch (err) {
    throw new WasmLoadError(
      `shell-ast: WASM failed to load — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const json = parseRaw(src, dialect, options.splitBraces);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature forbids .error on Record<>
  if (parsed["error"]) {
    // biome-ignore lint/complexity/useLiteralKeys: same reason
    const msg = String(parsed["error"]);
    // biome-ignore lint/complexity/useLiteralKeys: same reason
    const isSyntax = parsed["syntaxError"] === true;
    if (!isSyntax) {
      throw new WasmRuntimeError(`shell-ast: WASM reported error — ${msg}`);
    }
    const { line, col, rest } = parseLocation(msg);
    if (line !== undefined && col !== undefined) {
      throw new ParseSyntaxError(msg, line, col, snippetAt(src, line, col));
    }
    throw new ParseSyntaxError(rest, 0, 0);
  }
  return parsed as unknown as ShellFile;
}

// ─── preloadWasm (BUG-010) ───────────────────────────────────────────────────

/** Warm the WASM module ahead of the first `parse()` call. Idempotent;
 *  safe to call any number of times. Useful for compiled-binary
 *  consumers that want WASM-init latency out of the first-evaluation
 *  hot path. */
export async function preloadWasm(): Promise<void> {
  try {
    await loadWasm();
  } catch (err) {
    throw new WasmLoadError(
      `shell-ast: WASM preload failed — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ─── unwrapCallParsed convenience wrapper ────────────────────────────────────

/** Async unwrap that pre-parses the script for any `wrapped-script`
 *  result. Saves consumers a re-parse when they want to recurse into
 *  the inner AST.
 *
 *  ```ts
 *  const u = await unwrapCallParsed(call);
 *  if (u?.kind === "wrapped-script") {
 *    for (const inner of findCalls(u.innerAst!)) { ... }
 *  }
 *  ``` */
export function unwrapCallParsed(call: CallExprNode): Promise<UnwrappedCall | null> {
  return _unwrapCallParsedInternal(call, parse);
}
