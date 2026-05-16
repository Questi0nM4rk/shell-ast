# shell-ast — Known Bugs

## BUG-000: Global value-taking flags (`-C`, `-H`, `--context`, …) shift positional args, breaking subcommand-position matching downstream

**Status:** FIXED in v0.4.0 (2026-05-15). `resolveFlags` now consults a per-tool `GLOBAL_VALUE_FLAGS` table (`src/flags.ts`) covering `git`, `docker`, `kubectl`, `make`, `tar`, `xargs`. Sudo / doas / pkexec / etc. inherit the table on the inner call automatically because `unwrapCall` re-runs `resolveFlags` after wrapper-stripping.

**Severity:** HIGH — security-relevant. Allows trivial bypass of subcommand-position rules in consumers built on shell-ast (e.g. hook-kit's `cmd(prog, "sub")` matcher).

**Reported:** 2026-05-14 (during hook-kit 0.5.0 work; also flagged in hook-kit/CLAUDE.md as a known limitation since 0.4.x).

### Symptom (reproducer on hook-kit 0.5.0)

```ts
const rule = cmd("git", "worktree", "add").deny("blocked");

// Fires as expected:
await runModule({ module: ..., command: "git worktree add /tmp/x" });
// → terminal.kind === "deny"

// Slips through:
await runModule({ module: ..., command: "git -C /tmp worktree add /tmp/x" });
// → terminal === null
```

The same bypass shape works against `docker -H tcp://… run`, `kubectl --context prod get …`, `make -C /repo build`, `tar -C /target …`, etc. — every UNIX tool that accepts a leading value-taking global flag.

### Root cause

`resolveFlags` (and `unwrapCall`'s positional-args extraction) treats every leading `-X / --x` token as a boolean flag with no value-consumption rule. For `git -C /tmp worktree add`, the parsed call is:

```
{ cmd: "git", flags: ["-C"], args: ["/tmp", "worktree", "add"] }
```

— `/tmp` ends up in `args[0]` instead of being consumed as the value of `-C`. Consumers that match on `args[0] === "worktree"` (hook-kit's subcommand-position predicate) see `args[0] === "/tmp"` and silently miss.

### Why hook-kit can't paper over this

We considered building per-tool global-flag tables into hook-kit's `CommandRuleBuilder` (e.g. "for `git`, treat `-C` as value-taking before positional matching"). Rejected because:

1. **Scope blow-up.** Every consumer of shell-ast would need to maintain its own table — `git`, `docker`, `kubectl`, `make`, `tar`, `find`, `xargs`, `ssh -o`, `curl -H`, … The list grows with every popular tool.
2. **Drift risk.** Tables in consumers drift out of sync with the actual CLI behavior. The truth lives in the parser, not in downstream rule libraries.
3. **Security boundary.** A silent bypass is a deny-class bug. Closest-to-source fix wins — we want one place to audit, not N.

### How the v0.4.0 fix works

`resolveFlags(call)` looks up `call.cmd` in a private `GLOBAL_VALUE_FLAGS: Record<string, ReadonlySet<string>>` table. When the next token starts with `-` and matches an entry in the tool's set, `resolveFlags` consumes the FOLLOWING token as the flag's value (whether literal or dynamic) and excludes it from `args`. Unlisted tools fall back to the legacy "every `-X` is boolean" behavior — no regression for code that wasn't on the affected paths.

Verified shapes (test fixtures in `tests/global-flags.test.ts`):

| Input | flags | args |
|---|---|---|
| `git -C /tmp worktree add /tmp/x` | `["-C"]` | `["worktree", "add", "/tmp/x"]` |
| `git -c color.ui=auto -C /tmp status` | `["-c", "-C"]` | `["status"]` |
| `docker -H tcp://prod:2375 run nginx` | `["-H"]` | `["run", "nginx"]` |
| `kubectl --context prod get pods` | `["--context"]` | `["get", "pods"]` |
| `make -C /repo -f Makefile.prod build` | `["-C", "-f"]` | `["build"]` |
| `sudo git -C /tmp worktree add` (post-`unwrapCall`) | `["-C"]` | `["worktree", "add"]` |
| `frobnicate -X /tmp do-it` (unlisted) | `["-X"]` | `["/tmp", "do-it"]` |

### Known limitations of the v0.4.0 fix

1. **`-Cvalue` (concatenated short form) is not consumed** — only the space-separated `-C value` form. `git -C/tmp` still parses with `-C/tmp` as a single literal flag token.
2. **Tool name match is exact** — `git` looks up the table; `/usr/bin/git` does not. Consumers using full paths should normalize first.
3. **`xargs cmd args…` boundary not detected** — `resolveFlags` consumes `-I {} -n 1` correctly, but does not know that the rest of the line is xargs's command-to-run, so `-rf` gets expanded as combined short flags. Consumers needing inner-cmd-as-a-unit should locate the first non-flag arg and slice from there.
4. **Dynamic values are silently consumed**, not exposed in a separate `flagValues` map. `git -C "$DIR" worktree add` produces `flags: ["-C"], args: ["worktree", "add"]`. Tracking flag-value pairs (literal or DYNAMIC) is deferred to v0.5.0.

### Original design space (preserved for context)

The natural shape is per-tool *global-flag tables* in the resolver, consulted before positional-arg accumulation. Something like:

```ts
// shell-ast internal table — extend as needed
const GLOBAL_VALUE_FLAGS: Record<string, readonly string[]> = {
  git:     ["-C", "-c", "--git-dir", "--work-tree", "--namespace"],
  docker:  ["-H", "--host", "--config", "--context"],
  kubectl: ["--context", "--cluster", "--namespace", "-n", "--kubeconfig"],
  make:    ["-C", "--directory", "-f", "--file"],
  tar:     ["-C", "--directory", "-f", "--file"],
  // ...
};

function resolveFlags(call: CallExprNode): UnwrappedCall {
  const cmd = wordToLit(call.cmd);
  const valueFlags = new Set(GLOBAL_VALUE_FLAGS[cmd ?? ""] ?? []);
  // Walk call.args; when token starts with a known value-flag, consume the
  // next arg as its value. Otherwise positional. (Already handles `--flag=value`
  // because the `=` form keeps positional alignment intact.)
}
```

**Open design questions for the shell-ast maintainer to decide:**

1. **Per-tool table location.** Inline (as above), opt-in via `parse(src, { globalFlags: {...} })`, or pluggable registry? The pluggable route lets niche tools register their own without bloating the core table, but adds an API surface.
2. **Long/short equivalence.** `-C` vs `--directory` for make — the table needs both, or the resolver needs a separate alias step. Keep flat for now and let consumers extend.
3. **Inheritance through sudo/wrappers.** `sudo git -C /tmp worktree add` — does the global-flag table apply to the inner `git` post-unwrap? It should; check that `unwrapCall` re-runs flag resolution after sudo strip.
4. **What about totally unknown tools?** Default to current behavior (treat all leading `-X` as boolean). The table is opt-in coverage, not a regression for unlisted tools.

### Why "at the top of BUGS.md"

This sits above BUG-001 (WASM path) because:
- BUG-001 has a known fix path (lazy WASM resolution); this one needs a design decision.
- Consumers can workaround BUG-001 (don't `bun build --compile`); they cannot workaround this without rebuilding the same per-tool table client-side, which is exactly the scope-blow-up we're trying to avoid.
- It's the closest the shell-ast → hook-kit → ai-guardrails stack has to a quiet-bypass class of bug. Worth surfacing first to readers.

---

## BUG-001: WASM path baked at compile time breaks `bun build --compile`

**Severity:** CRITICAL — silently breaks all consumers that compile a binary.

**Reported:** 2026-05-11 (during ai-guardrails v4.0.0 release)

**Symptom:** A binary that bundles `@questi0nm4rk/shell-ast` via `bun build --compile`
works on the build machine but silently fails to load WASM on every other machine.
Consumers see no error — `parseRaw()` calls go through `loadWasm()` which throws
`ENOENT`, callers catch and treat as "no AST available" (per fail-open conventions),
and every shell-AST-dependent rule silently no-ops.

**Where it bit us:** ai-guardrails v4.0.0 shipped three compiled binaries via GitHub
Releases. The CI runner path (`/home/runner/work/ai-guardrails/ai-guardrails/...`)
got baked into every binary. `dist/ai-guardrails-hk -c "git push --force"` returned
exit 0 + "Everything up-to-date" instead of escalating. Only caught during
post-install end-to-end review. Fix-forward required a v4.0.1 patch release.

### Root cause

`src/wasm.ts:23,35` resolves both asset paths via `import.meta.dirname`:

```typescript
const runtimePath = join(import.meta.dirname, "wasm_exec.js");
const wasmPath = join(import.meta.dirname, "../dist/shell-ast.wasm");
```

`bun build --compile` snapshots `import.meta.dirname` at build time. The compiled
binary contains the absolute path of the build machine's `node_modules/`. At runtime
on a different machine, `readFile(wasmPath)` returns ENOENT.

Verification (string-dump of an installed binary built by GitHub Actions):

```
$ strings ~/.local/bin/ai-guardrails-hk | grep shell-ast.wasm
const wasmPath = import_node_path.join(
  "/home/runner/work/ai-guardrails/ai-guardrails/node_modules/@questi0nm4rk/shell-ast/dist",
  "../dist/shell-ast.wasm"
);
```

### Why fail-open hides it

hook-kit's Iron Law 4 (fail open on infra errors) is the right default for the
*evaluator*, but applied at the WASM-load layer it converts a single packaging
bug into a silent disabling of every command/pipe/redirect rule across the
ecosystem. There is no signal at runtime that anything is wrong.

### Proposed fix

Switch from `readFile`-by-path to bun's import-asset syntax, which embeds the
asset into the bundle at build time and resolves at runtime by content, not by
path:

```typescript
// src/wasm.ts (proposed shape)
// `with { type: "text" }` returns the file contents as a string in dev and
// embeds them in the compiled binary.
import wasmExecSrc from "./wasm_exec.js" with { type: "text" };

// `with { type: "wasm" }` returns the instantiated WebAssembly.Module, which
// can be passed to WebAssembly.instantiate(module, importObject).
import wasmModule from "../dist/shell-ast.wasm" with { type: "wasm" };
```

Then `loadGoRuntime()` evaluates `wasmExecSrc` (same mechanism as today, just
with a string from the bundle instead of from disk) and `loadWasm()` calls
`WebAssembly.instantiate(wasmModule, go.importObject)` directly — no `readFile`
of an absolute path.

Bun's import attributes are honored both in dev (resolves to file content at
module-load) and in `bun build --compile` (embeds the asset into the compiled
binary). Same code in script mode and binary mode, no conditional logic.

**Reference:** Bun bundler docs on import attributes — https://bun.com/docs/bundler/loaders

### Tarball impact

The `files` field in `package.json` already includes `dist/`, so the WASM and
JS runtime ship with the package today. The fix changes how they're loaded,
not what's distributed.

### Test that would have caught this

A "compiled binary on a fresh location" smoke test:

```bash
# In shell-ast's CI:
bun build tests/smoke/compile-test.ts --compile --bytecode --outfile /tmp/sa-test
cp /tmp/sa-test /tmp/elsewhere/sa-test  # any path outside node_modules
/tmp/elsewhere/sa-test  # parses a known input, asserts output
```

Currently shell-ast's tests run `parseRaw()` from the source tree, so
`import.meta.dirname` resolves correctly and the bug stays invisible.

### Severity rationale

CRITICAL because:

1. Silent failure mode — no error message, no exit code change, no log line.
2. All downstream guards become no-ops, so security-relevant rules go
   unenforced without anyone noticing. Worse than no guard at all (false sense
   of safety).
3. Affects every consumer that uses `bun build --compile`, which is the only
   distribution path for shell-wrapper-style hook binaries.
4. Distinguishes by machine, not by code — same binary works on builder, fails
   everywhere else, so a single end-to-end install test on a fresh machine is
   needed to catch it (the standard "build, run unit tests" loop misses it).

### Workaround until fix lands

Consumers can build on the same machine they install on. Cross-machine
distribution (CI build → user install) is broken until BUG-001 is resolved.

---

# Feature requests & API ergonomics

The entries below were captured 2026-05-13 during a hook-kit ↔ ai-guardrails
integration session. They aren't bugs in the strict sense — shell-ast 0.2.1
works — but each one shows up as awkward, error-prone, or low-signal code in
the consumer (hook-kit, the canonical major consumer). Code references are
to `~/Projects/hook-kit` at the time of writing.

---

## BUG-002: `unwrapCall` returns `null` for bare wrapper invocations

**Severity:** HIGH — forces every consumer to ship a `resolveFlags` fallback.

**Reported:** 2026-05-13. Also filed upstream as `Questi0nM4rk/shell-ast#7`.

**Symptom:** When a `WRAPPERS`-listed command (`bash`, `sh`, …) appears without
an inner command — bare `bash`, `bash --version`, `bash -i`, the right side of
`curl example.com | bash` — `unwrapCall` returns `null`. Every consumer that
uses `unwrapCall` as the primary lens on a `CallExpr` loses the ability to
detect bash/sh/etc. in those positions.

### Where it bit us

hook-kit's pipe-rule and command-rule machinery couldn't match `curl … | bash`
(the canonical RCE pattern), and `cmd("bash").deny(…)` failed to fire on
`bash --version`. Worked around in `src/engine/helpers.ts:resolveUnwrappedOrFallback`
with a `resolveFlags` fallback used by both `rules/command.ts:87` and
`rules/pipe.ts:73`. That helper becomes dead code the moment this lands.

### Root cause

`src/semantic.ts` `unwrapCall`, the wrapper-walk loop hits `if (i >=
rawArgs.length) return null;`. That branch fires whenever the wrapper consumed
all of its own arguments without finding a positional inner command. Treating
"no inner command" as "this isn't a wrapper invocation, return as a plain call"
would let `unwrapCall` stay the single, complete entry point.

### Suggested fix

```ts
if (i >= rawArgs.length) {
  return { wrapper: null, ...resolved };   // fall through to plain
}
```

Same change for any other `return null` paths inside the wrapper logic that
fire when "we couldn't find an inner command" (vs. "we hit something genuinely
dynamic" — keep those returning null).

### Impact

Every downstream library currently writes the same `resolveFlags` workaround.
A one-line shell-ast fix removes the boilerplate from every consumer.

---

## BUG-003: `UnwrappedCall` shape should be a discriminated union, not three nullable fields

**Severity:** HIGH — biggest single source of caller-side confusion.

**Reported:** 2026-05-13.

**Symptom:** The current shape

```ts
interface UnwrappedCall {
  wrapper: string | null;
  cmd: string | null;
  flags: string[];
  args: ResolvedArg[];
  raw: CallExprNode;
  commandString?: string;
}
```

forces every consumer to figure out which of `wrapper` / `cmd` is the
"name that matters" — and the answer depends on caller intent. Hook-kit
ended up with `wrapper ?? cmd` in inline-shell detection
(`src/engine/index.ts:99`) but `cmd ?? wrapper` in pipe-RHS resolution
(`src/rules/pipe.ts:76`). Both are correct for their purpose, but the
mirror-image idioms are confusing and the type system gives no help.

### Suggested API

```ts
type UnwrappedCall =
  | { kind: "plain";   cmd: string; flags: string[]; args: ResolvedArg[]; raw }
  | { kind: "wrapped"; wrapper: string; cmd: string; flags: string[]; args: ResolvedArg[]; raw }   // sudo rm -rf /
  | { kind: "shell";   wrapper: string; commandString: string; raw };                              // bash -c '…'
```

### Why this helps

Consumers collapse to a single `switch (u.kind)` with each branch type-checked.
`wrapper ?? cmd` and `cmd ?? wrapper` both disappear — `case "plain": u.cmd`,
`case "wrapped": handle wrapper or cmd intentionally`, `case "shell":
re-parse commandString`. TypeScript forces exhaustiveness. The
`resolveUnwrappedOrFallback` helper in hook-kit would collapse into a sealed
`switch` with no fallback path to maintain.

### Impact

This is the structural change that retires the most hook-kit boilerplate.
Worth bundling with BUG-002's fix as a single breaking 0.3.0 release.

---

## BUG-004: `wordToLit` is binary — needs a "give me what you can" variant

**Severity:** HIGH for security consumers.

**Reported:** 2026-05-13.

**Symptom:** Today `wordToLit("rm -rf $DANGER")` returns `null` for the
`$DANGER` arg because it's not a single literal. The caller has zero
visibility into what got expanded. hook-kit's `argMatches(/secret/)` rule
silently misses every command with any expansion.

### Where it bit us

Quoted-arg test at `tests/rules/cmd.test.ts:205` had to be rewritten when
shell-ast 0.2.x changed quote semantics — and the v0.2.0 bundling bug
returned the literal string `"<dynamic>"` for any non-resolvable arg, which
hook-kit's regex tests then matched against (silently wrong). A richer
return shape would have surfaced "this is dynamic; here's what we know" so
the bug couldn't disguise itself as a literal.

### Suggested API

```ts
type ArgFragment =
  | { kind: "literal"; value: string }
  | { kind: "dynamic"; sourceText: string };   // the raw source of the unresolved part

function wordToParts(w: Word): ArgFragment[];   // never null, always informative
```

Keep `wordToLit` as a convenience that returns `parts.length === 1 &&
parts[0].kind === "literal" ? parts[0].value : null` — preserves the
current API while exposing the richer one underneath.

### Why this helps

hook-kit can write: "the command is `rm -rf` followed by a literal `--no-preserve-root`
followed by a dynamic value — escalate." Today we only know "literal" or
"give up." Materially better for security rules; eliminates a class of
silent-allow regressions.

---

## BUG-005: Type guards exported alongside the `DYNAMIC` sentinel

**Severity:** MEDIUM — refactor-safety.

**Reported:** 2026-05-13.

**Symptom:** Today consumers narrow `ResolvedArg = string | typeof DYNAMIC`
with `typeof a === "string"`. That's fragile — a bundling regression in
shell-ast 0.2.0 produced the literal string `"<dynamic>"` in `dist/index.js`
(see BUG-001 history), and the `typeof === "string"` narrowing was useless
against it. The bundled shell-ast was effectively returning a value that
passed every consumer's type guard but failed every semantic intent.

### Suggested API

```ts
export function isDynamic(a: ResolvedArg): a is typeof DYNAMIC;
export function isResolved(a: ResolvedArg): a is string;
```

### Where it would have helped

hook-kit's regex match would have read

```ts
unwrapped.args.some(a => isResolved(a) && p.test(a))
```

instead of

```ts
unwrapped.args.some(a => typeof a === "string" && p.test(a))
```

The former breaks the moment shell-ast's compiled output ships a buggy
sentinel; the latter silently keeps "working." Library-owned guards are
the canonical way to insulate consumers from sentinel-shape changes.

### Impact

Cheap (10 lines of shell-ast), tightens every consumer's narrowing path,
prevents an entire class of "compiled sentinel diverges from source
sentinel" regressions.

---

## BUG-006: `findCalls` needs a `topLevel` option (and `findRedirects` a `writesOnly`)

**Severity:** MEDIUM — consumer-side filter boilerplate.

**Reported:** 2026-05-13.

**Symptom:** `findCalls(ast)` returns every `CallExpr` in the tree —
including ones nested inside command substitutions
(`echo $(rm -rf foo)`). Some hook-kit rules want to inspect every nested
call (security); some want only the top-level invocation (pipe matching,
inline-shell recursion). Today we walk the full set and re-filter, which
is a meaningful pile of repeated tree-traversal logic.

### Suggested API

```ts
function findCalls(ast: ShellFile, opts?: { topLevel?: boolean }): CallExprNode[];
function findRedirects(ast: ShellFile, opts?: { writesOnly?: boolean }): Redirect[];
function findAssignments(ast: ShellFile, opts?: { exportedOnly?: boolean }): Assign[];
```

Backwards-compatible (opts is optional). The implementation has the depth
information already during the walk; exposing it is essentially free.

### Why this helps

hook-kit's `redirect()` rule currently re-walks the output of
`findRedirects` to keep only write ops. The engine's inline-shell recursion
re-filters for top-level shells. Both collapse to a one-line call.

---

## BUG-007: `unwrapCall` for `bash -c '…'` should return the parsed inner AST

**Severity:** MEDIUM — saves a re-parse.

**Reported:** 2026-05-13.

**Symptom:** Today, `unwrapCall(bash -c 'rm -rf /')` returns
`{ wrapper: "bash", cmd: null, commandString: "rm -rf /" }`. Every consumer
that wants to inspect the inner script (hook-kit's inline-shell recursion,
any future RCE-detection rule) calls `parse(commandString)` again. shell-ast
already had the parser warm; the consumer's re-parse is pure waste.

### Suggested API

Folded into the discriminated-union shape from BUG-003:

```ts
| { kind: "shell"; wrapper: string; innerAst: ShellFile; commandString: string; raw }
```

`commandString` stays for consumers that want the raw source (for log
output, AI agent prompts, etc.); `innerAst` is the pre-parsed AST. Optional
to populate — if shell-ast's parser already ran on the inner string for its
own resolution, just hand it back.

### Why this helps

hook-kit's `extractInlineScript` helper in `src/engine/helpers.ts:140`
disappears entirely — the recursion just reads `u.innerAst` and recurses.
Inline-shell rules go from "extract string → re-parse → walk" to "walk
inner AST." Net saving: one parser invocation per inline-shell call per
event.

---

## BUG-008: `unwrapDeep(call)` for chained wrappers

**Severity:** MEDIUM — correctness gap for layered wrappers.

**Reported:** 2026-05-13.

**Symptom:** `sudo bash -c 'rm -rf /'` is three semantic layers: sudo wraps
bash wraps an opaque script. Today `unwrapCall` peels one layer. The
consumer has to inspect the result and decide whether to recurse on the
remaining `bash -c '…'` themselves. hook-kit's current sudo-aware
guarantee (`cmd("rm")` matches `sudo rm -rf /`) works for one-layer
wrapping but I'm not confident it survives this chained case — and there's
no test fixture for it.

### Suggested API

```ts
function unwrapDeep(call: CallExprNode): UnwrappedCall[];   // outermost first
```

Returns the unwrap chain. `[sudo-layer, bash-layer]` for the example
above. Consumer iterates and inspects each layer — natural representation
for "is this `rm` anywhere in the invocation chain" rules.

### Why this helps

hook-kit's command rule can iterate the chain instead of recursing
manually. Sudo-aware semantics extend naturally to N levels. Test fixtures
become "given this chain, assert these decisions."

---

## BUG-009: `ParseError` should carry structured position + kind, not just a message

**Severity:** LOW — quality-of-life for diagnostics.

**Reported:** 2026-05-13.

**Symptom:** Today `parse()` throws a plain `Error` with a message like
`"1:5: \`then\` must be followed by a statement list"`. hook-kit's BUG-001
stderr warning dumps this string verbatim. A consumer that wanted to
categorize errors (recoverable syntax vs. infrastructure failure) has to
regex the message. The bundled WASM-load failure message
(`"ENOENT … shell-ast.wasm"`) looks indistinguishable from a syntax error
at the catch site.

### Suggested API

```ts
class ParseError extends Error {
  readonly line: number;
  readonly col: number;
  readonly kind: "syntax" | "wasm-load" | "wasm-runtime" | "size-limit";
  readonly snippet?: string;
}
```

### Why this helps

hook-kit's BUG-001 warning could distinguish "shell-ast WASM failed to load
(infra error)" from "this specific command was malformed (likely fine).
The former should warn loudly once per process; the latter is normal.
Today both look identical at the catch site.

---

## BUG-010: Export `loadWasm` / add `preloadWasm` from the public API

**Severity:** LOW — startup latency optimization.

**Reported:** 2026-05-13.

**Symptom:** WASM loads lazily on the first `parse()` call. For
compiled-binary consumers, that first-call latency lands in the hot path
of evaluating a real user command. There's no way to warm the WASM ahead
of time — `loadWasm` exists in `src/wasm.ts` but isn't re-exported from
`src/index.ts`.

### Suggested API

```ts
export async function preloadWasm(): Promise<void>;
```

Idempotent. Safe to call multiple times. Returns the same promise the
first parse would internally.

### Why this helps

hook-kit's `runShell` in `src/wrapper/hk.ts` can call `await preloadWasm()`
at binary startup, before parsing argv. Cold-start latency moves out of
the first-rule evaluation. Adapter mode (`run()`) can do the same. No API
break; pure additive.

---

# Priority ranking

For a hook-kit cleanup pass, the highest-leverage items are:

1. **BUG-002** — single-line fix, deletes the `resolveFlags` fallback in
   every consumer.
2. **BUG-003** — structural; biggest reduction in consumer-side ambiguity.
   Worth bundling with BUG-002 in a 0.3.0 break.
3. **BUG-004** — security-relevant; closes a class of silent-allow holes.
4. **BUG-005** — small library change, prevents an entire bundling-regression
   failure mode from recurring.

BUG-006 through BUG-010 are quality-of-life — each removes a small amount
of consumer boilerplate or unlocks an optimization, but none are
load-bearing the way 002–005 are.

