# CLAUDE.md

Guidance for Claude Code working in this repo.

## What This Is

`shell-ast` (`@questi0nm4rk/shell-ast`): the parsing/AST layer of the ecosystem. Wraps `mvdan/sh` v3 (Go) compiled to WASM and exposes every node as a TypeScript discriminated union, with wrapper-aware unwrap (`sudo` / `doas` / shells / `eval` / `exec`), structural effect classification, and zero-config query helpers for command-level inspection.

**The full ecosystem framing — what shell-ast owns, what it doesn't, what each downstream layer does — is in [`docs/IDEOLOGY.md`](./docs/IDEOLOGY.md). Read that first if anything in here is unclear.**

This is the bottom layer. Consumers: `hook-kit` (rules + per-tool knowledge), `ai-guardrails` (policy bundles), plus any other tool that needs to understand commands before they execute.

## Commands

```bash
bun install                       # deps
bun test                          # run the TypeScript suite
go test ./processor/...           # 52 Go tests + 44-case schema lock
bun run typecheck                 # tsc --noEmit
bun run lint                      # biome check src/ tests/
bun run build                     # build WASM + bundle TS
bun run build:wasm                # WASM only (needs Go ≥ 1.25)
bun run build:ts                  # TS bundle only
bun run prepublishOnly            # lint + typecheck + go tests + bun tests + build
```

## Module Layout

```
src/
  index.ts          parse() + preloadWasm() + ParseError hierarchy + re-exports
  flags.ts          DYNAMIC sentinel, wordToParts, wordToLit, resolveFlags
                    + GLOBAL_VALUE_FLAGS table (6 tools) + ResolveFlagsOptions
                    + ResolvedCall.flagValues
  semantic.ts       back-compat barrel — re-exports from ./wrappers/index.js
                    (existing `from "./semantic.js"` and the `./semantic`
                    subpath export both keep working)
  wrappers/
    registry.ts        WrapperSchema + WRAPPERS table (17 wrappers:
                       sudo/doas/pkexec/shells/eval/exec/…)
    types.ts           UnwrappedCall discriminated union (plain / wrapped /
                       wrapped-script / wrapped-opaque) — wrapped variant
                       carries flagValues + innerRaw since 0.6.0
    unwrap.ts          unwrapCall + internal unwrapPositionalScript
    unwrap-async.ts    unwrapCallParsed (populates wrapped-script innerAst)
    unwrap-deep.ts     unwrapDeep — sync chain walker (since 0.7.0)
    unwrap-deep-async.ts unwrapDeepParsed — async chain walker, re-parses
                         wrapped-script layers (since 0.7.0)
    index.ts           barrel re-export
  extract.ts        findCalls / findRedirects / findAssignments / findFunctions
                    + depth + ops filters
  effects.ts        Effect union (13 kinds) + effectOf + effectsOf
  walk.ts           Visitor type + walk() (returns "skip" to stop descent)
  query.ts          zero-config helpers (tokenAfter, tokensAfter, hasFlag,
                    indexOfFlag, tokenAt, flagsMatching, resolvedCmd)
  types.ts          all AST node types
  wasm.ts           wasm-side loader, parseRaw
  wasm_exec.js      Go runtime shim (registers globalThis.Go via IIFE)

processor/
  main.go           WASM entry
  dispatch.go       type-switch serializer (every syntax.Node → typed JSON)
  *.go              per-node-type serializers

tests/
  *.test.ts         per-feature suites
  smoke/            tests/smoke/run-{compile,consumer-install}-smoke.sh
                    (validate dist/ from a fresh consumer install — CI-only normally)
```

## Conventions & Constraints

- **Bun ≥ 1.3, Go ≥ 1.25, TypeScript ^6.0** (devDep).
- `strict: true`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — no exceptions.
- No `any` — use `unknown` or proper types.
- Source-side `!` non-null assertions are forbidden (biome `noNonNullAssertion`); use explicit narrowing or `charAt`-style typed-safe alternatives. The `tests/**` override allows `!` in fixtures (a null deref IS the test failure).
- `biome check` (NOT `--reporter=json`; use `--reporter=rdjson` if you need machine-readable).
- Discriminated unions over nullable optional fields. `UnwrappedCall` is the canonical example.
- Typed errors over message-string-matching. `ShellAstError` hierarchy.
- ESM only (`"type": "module"`).
- Bun bundler is the build target — `--target node` for the lib build. `bun build --compile` is the standalone-binary path consumers can use (see BUG-001 history).

## Critical: do NOT add `sideEffects: false`

`package.json` must NOT have `"sideEffects": false`. The `src/wasm.ts` side-effect import of `./wasm_exec.js` registers `globalThis.Go`; the bundler will tree-shake the IIFE if the package claims to be side-effect-free. Shipped 0.3.1 with this bug → every consumer `parse()` call threw `WasmLoadError`. Memory: `feedback_sideeffects_false_breaks_wasm.md`.

## Publish ritual (manual — no auto-publish)

There is no GH Actions workflow that auto-publishes. Full 9-step ritual in `~/.claude/projects/-home-qs-m4rk-Projects-shell-ast/memory/project_publish_ritual.md`. Mandatory verification before `npm publish`:

1. **Symbol grep:** `grep -c "globalThis.Go" dist/index.js` — must be ≥ 2 (definition + check). 1 means the wasm_exec.js IIFE got tree-shaken; do NOT publish.
2. **Fresh tmp consumer smoke:** copy `dist/` + `package.json` to `/tmp/smoke/node_modules/@questi0nm4rk/shell-ast/`, then `node --input-type=module -e "import('@questi0nm4rk/shell-ast').then(m => m.parse('git -C /tmp status'))"`. Verify actual runtime works.

Source-side `bun test` is NOT sufficient — it runs against `src/`, not the bundled `dist/`. The 0.3.1 incident is the load-bearing lesson.

`npm` metadata (description, repository, etc.) is locked per-published-version. To refresh the description on the npm page, you must publish a new version — there's no `--refresh-description` flag. See 0.5.1.

## Testing

- **351 TypeScript tests** via `bun test`. Per-feature files (`tests/extract.test.ts`, `tests/semantic.test.ts`, `tests/query.test.ts`, `tests/flag-values.test.ts`, `tests/resolve-flags-options.test.ts`, `tests/global-flags.test.ts`, `tests/v0.3.0-surface.test.ts`, `tests/types-drift.test.ts`, `tests/parse.test.ts`, `tests/helpers.test.ts`, `tests/security.test.ts`, `tests/wasm.test.ts`).
- **52 Go tests** + **44-case schema completeness lock** via `go test ./processor/...`. The schema lock fails if mvdan/sh adds a node type that our serializer doesn't cover. CI also runs a 30s fuzz of the serializer.
- **`tests/smoke/`** — `run-compile-smoke.sh` validates the `bun build --compile` deployment path (BUG-001 regression). `run-consumer-install-smoke.sh` validates the consumer-install path (gh #5 regression). Both run in CI. **Run them locally if you're touching anything WASM-load-shaped.**
- **No process execution at the test surface** — CI greps the source tree for `child_process` / `Bun.spawn` / `execSync` / `spawnSync` / `Deno.run` / `Deno.Command` / `worker_threads` / `node:vm` / etc. and fails on any match. We parse shell strings; we don't run them.
- **Tests-first for new features.** v0.5.0 is the working template — see `docs/plans/v0.5.0.md` order-of-work section.

## Scope boundaries (the things shell-ast does NOT do)

Read [`docs/IDEOLOGY.md`](./docs/IDEOLOGY.md) section "Where each project stops" for the full list with rationale. Quick rejects:

- **Per-tool semantic schemas** (gcc / git / docker / kubectl) — hook-kit's job.
- **`Role` vocabulary** (`fs-read`, `fs-write`, `fs-cwd`, …) — consumer tags whatever they want.
- **Fluent `Query<T>` chain class** — native `Array.prototype` + Iterator Helpers cover it.
- ~~**`unwrapDeep` for chained wrappers**~~ — **SHIPPED v0.7.0** (`unwrapDeep` + `unwrapDeepParsed`). Closed [BUG-008](./docs/BUGS.md) / [#11](https://github.com/Questi0nM4rk/shell-ast/issues/11). Postmortem of the two-release deferral is the canonical worked example for how NOT to defer features — see memory `feedback_dont_conflate_deferred_with_rejected.md` and `feedback_verify_escape_hatch_claims.md`.
- **Default per-tool schemas beyond the current `GLOBAL_VALUE_FLAGS` 6.**
- **Auto-publish workflow.**
- **Anything that requires shell-ast to know what a specific tool "means."**

If a feature request smells like one of these, push back with the ideology section that applies.

## Plan-then-implement workflow

For non-trivial features (anything beyond a one-line fix), the working pattern is:

1. Write `docs/plans/<version>.md` with scope, decisions, file structure, test plan, worked examples, order of work, what we explicitly do NOT do.
2. Surface genuine design choices via `AskUserQuestion` (4 max, recommendation flagged).
3. Lock decisions in the plan doc with a dated signoff line.
4. TDD: write failing tests first, then implement.
5. Verify-before-publish ritual (the two checks above).
6. Publish + commit + tag + GH release with substantive notes.

`docs/plans/v0.5.0.md` is the worked example. Follow that template.

## Docs cross-reference

| Doc | What's in it |
|---|---|
| [`README.md`](./README.md) | User-facing intro, install, recipes, comparison table |
| [`docs/IDEOLOGY.md`](./docs/IDEOLOGY.md) | Ecosystem philosophy, layering, principles, scope rejects |
| [`docs/BUGS.md`](./docs/BUGS.md) | Consumer-pain log (BUG-NNN entries, severity-ordered) |
| [`docs/AUDIT.md`](./docs/AUDIT.md) | Historic codebase audit findings |
| [`docs/MIGRATION-v0.3.0.md`](./docs/MIGRATION-v0.3.0.md) | v0.2.x → v0.3.0 (discriminated UnwrappedCall) |
| [`docs/MIGRATION-v0.4.0.md`](./docs/MIGRATION-v0.4.0.md) | v0.3.x → v0.4.0 (per-tool global value-flag tables) |
| [`docs/plans/v0.5.0.md`](./docs/plans/v0.5.0.md) | v0.5.0 plan + locked decisions (toolkit primitives) |
| [`docs/plans/v0.6.0.md`](./docs/plans/v0.6.0.md) | v0.6.0 plan + locked decisions (flagValues + innerRaw on UnwrappedCall, polymorphic query helpers, semantic.ts → wrappers/ split) |
| [`docs/plans/v0.7.0.md`](./docs/plans/v0.7.0.md) | v0.7.0 plan + locked decisions (unwrapDeep + unwrapDeepParsed, BUG-008 close-out, four BUG-008-postmortem lessons applied) |
| `~/.claude/projects/-home-qs-m4rk-Projects-shell-ast/memory/MEMORY.md` | Always-loaded session memory index |

## Memory entries (load-bearing)

Read these when in doubt — they hold the *why* that the code doesn't.

| Memory | Topic |
|---|---|
| `feedback_sideeffects_false_breaks_wasm.md` | The 0.3.1 incident — never set `sideEffects: false` on packages with side-effect imports |
| `feedback_verify_dist_before_publish.md` | Pre-publish ritual — grep dist + tmp consumer smoke. `bun test` isn't enough |
| `feedback_shell_ast_is_a_toolkit.md` | shell-ast scope hard rejects (no schemas, no Roles, no LINQ chain class) |
| `feedback_user_is_the_consumer.md` | Personal-scale ecosystem framing — don't defer features waiting for hypothetical users (extended 2026-05-18 with the BUG-008 sibling-pain case study) |
| `feedback_push_back_when_you_have_reason.md` | Working-relationship discipline — don't mirror, disagree when warranted |
| `feedback_dont_conflate_deferred_with_rejected.md` | IDEOLOGY's "Where each project stops" must split architecturally-rejected from deferred-with-revisit-conditions. v0.7.0 refactored this. |
| `feedback_verify_escape_hatch_claims.md` | Plan-doc deferrals citing "the existing escape hatch covers it" require a passing test in the consumer's repo. v0.6.0 plan's wrong claim about hook-kit's `recurseInlineShells` is the worked failure. |
| `feedback_asymmetric_variant_classification.md` | When adding a wrapper or variant, test the with-wrapper-prefix shape (`sudo X`, `doas X`) alongside the bare shape. Same logical chain producing different lens shapes = primary-lens problem sibling to §11. |
| `project_ecosystem_layering.md` | shell-ast → hook-kit → ai-guardrails → feets responsibility table |
| `project_publish_ritual.md` | Full 9-step manual publish procedure |
| `reference_bugs_md_ordering.md` | `docs/BUGS.md` severity-ordered, not chronological |

## Plan-doc hygiene checklist (BUG-008 postmortem, 2026-05-18)

Before locking a `docs/plans/v*.md` deferral decision, run through these checks. They exist because they were missed across v0.5.0 → v0.6.0 for BUG-008, and the cost was two release cycles of stalled hook-kit work plus a wrong "escape hatch covers it" claim in v0.6.0's plan that nobody verified.

1. **Deferred vs rejected?** Is this feature architecturally out-of-scope (per the IDEOLOGY "Architecturally rejected" subsection), or just timing-deferred? If deferred: write the explicit revisit-condition. Don't bundle it next to actual rejects; consumers and future-you re-evaluate from that grouping.
2. **Escape-hatch verified?** If the deferral rationale is "consumers can do this with primitive X + Y," point to a passing test in the consumer's repo that demonstrates X + Y end-to-end for the deferred case. "Should be fine" is not enough — v0.6.0 plan's "hook-kit's `recurseInlineShells` covers `sudo bash -c \"rm\"`" was wrong and carried forward unchecked.
3. **Personal-scale vs OSS-shaped gate?** "Wait for consumer demand" / "wait for user feedback" / "wait for second consumer" / "wait for hook-kit to hit real pain" are all the same OSS-shaped reflex IDEOLOGY §6 rejects. In a sibling-ecosystem under one maintainer, the gate must be architectural ("this is the wrong layer", "the impl is too large to phase"), not demand-driven.
4. **Asymmetric variant check?** When adding a wrapper / variant / lens shape, snapshot the with-wrapper-prefix case (`sudo X`, `doas X`, `env X`) alongside the bare case in `tests/wrapper-shapes.test.ts`. If shapes diverge in a way that forces consumer-side recursion, that's a primary-lens problem sibling to §11 — close the gap or document the asymmetry as deliberate.
