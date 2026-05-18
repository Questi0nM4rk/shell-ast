# Ecosystem ideology — shell-ast / hook-kit / ai-guardrails / feets

This document captures the working philosophy across the four-project stack. It is the **architectural truth** for cross-project decisions; individual project CLAUDE.md files are tactical, this is strategic.

---

## The stack, with hard boundaries

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ai-guardrails         policy bundles, deny/allow/ask decisions,          │
│                        runtime integration with Claude Code hooks         │
├───────────────────────────────────────────────────────────────────────────┤
│  hook-kit              rule composition primitives + per-tool knowledge   │
│                        ("gcc -o writes a file", "git push --force is bad")│
├───────────────────────────────────────────────────────────────────────────┤
│  shell-ast             shell grammar, AST, wrapper unwrap, structural     │
│                        effects, zero-config query helpers                 │
└───────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                ┌──────────────────────────────────────┐
                │  feets    BDD test framework         │
                │           used across all three      │
                └──────────────────────────────────────┘
                                     │
                                     ▼
                ┌──────────────────────────────────────┐
                │  qsm-marketplace                     │
                │  methodology + tooling plugins       │
                │  (memory, primer, learning-loop, …)  │
                └──────────────────────────────────────┘
```

Each layer owns **one** responsibility. The boundaries are hard. Bleeding responsibility across layers is the smell we watch for.

### shell-ast

**Owns:** parse `bash` / `posix` / `mksh` into a typed AST. Recognize and unwrap shell wrappers (`sudo` / `doas` / `pkexec` / shells / `eval` / `exec`). Classify operator effects (`exec`, `pipe`, `fs-write`, `fs-read`, `subshell`, …). Split flags vs positionals. Provide zero-config query helpers (`tokenAfter`, `hasFlag`, `tokensAfter`, …). Maintain the small `GLOBAL_VALUE_FLAGS` table (6 tools) for tools where value-flag handling is required to keep positionals lined up.

**Doesn't own:** what `gcc -o` semantically means. Whether `git push --force` is dangerous. Which paths are "system" vs "workspace." Per-tool argument vocabularies. Role tags on tokens. Schema registries. Plugin runtimes. Policy decisions.

**Distribution:** `@questi0nm4rk/shell-ast` on npm. Public.

### hook-kit

**Owns:** rule composition (`cmd()` / `path()` / `pipe()` / `redirect()` / `content()` / `custom()` / `stateful()` builders). The decision vocabulary (`deny` / `ask` / `warning` / `note`). The engine that walks a CallExpr, dispatches builders, merges annotations. The shell-wrapper and Claude-Code-adapter binaries. Per-tool knowledge that consumers need (which flags matter for security, what each tool's positionals mean). The escalation infrastructure (askpass / broker / spool tree / TUI).

**Doesn't own:** shell parsing. Wrapper unwrap. Structural effect classification. Specific policy ("block `rm -rf /`"). Runtime integration with a particular harness. The decision of *which* tools matter — consumers compose that.

**Distribution:** `@questi0nm4rk/hook-kit` on npm. Public.

### ai-guardrails

**Owns:** opinionated bundles of hook-kit rules that implement a *specific* security/safety policy. The Claude-Code integration scripts. The CLI for end-users (`ai-guardrails init`, `check`, `generate`). The per-language linter runners (Python, TS, Lua, .NET) and config generators. The rule groups (`network`, `filesystem`, `process`, `secrets`, etc.) composed from hook-kit builders.

**Doesn't own:** shell parsing or rule primitives. The rule *runtime* (that's hook-kit's). Whether a given decision should be deny vs ask vs warning is policy — and ai-guardrails has opinions, but those opinions are configurable.

**Distribution:** `@questi0nm4rk/ai-guardrails` on npm + compiled binaries via GitHub Releases.

### feets

**Owns:** the BDD-style test framework used by all three projects. Test composition syntax. Fixture management. Assertion vocabulary.

**Doesn't own:** anything domain-specific. Generic test infrastructure only.

**Distribution:** `@questi0nm4rk/feets` on npm.

### qsm-marketplace

**Owns:** Claude Code plugin packaging. Methodology plugins (memory, primer, learning-loop, output-discipline, cli-wrappers, worktree-bash). Tool plugins (web-scraping, data-processing, db, browser, docs, lightrag). Skill collections (superpowers, frontend-design, plugin-dev). The `qsm-setup` bootstrap.

**Doesn't own:** code in the four library projects above. qsm-marketplace shapes *how* I work; it doesn't ship the code I work on.

---

## Core principles

### 1. Toolkit over framework

shell-ast does not ship per-tool schemas. hook-kit does not ship a pre-built rule list. Each layer ships primitives; the next layer composes them. The temptation to ship "smart defaults for common cases" is constant; resist it. The cost of being wrong about per-tool semantics is high (false security signal) and the maintenance cost is recurring.

When in doubt: provide more primitives, not more semantics.

### 2. Honest about limitations

We never silently fail. When something can't be seen statically — variables, command substitutions, runtime values — we surface that with a typed marker:

- `DYNAMIC` symbol for unresolvable args
- `wrapped-opaque` kind for wrappers we can't see through
- `wordToLit` returns `null` for non-static words
- `flagValues` includes `DYNAMIC` for dynamic flag values

Consumers decide how to handle these (deny-by-default, ignore, sourceText heuristic). We don't guess for them.

When we know we *can't* do something — `find -exec` parsing, `dd if=/of=` syntax, full per-tool grammar — it's documented in `docs/BUGS.md` (limitations section of each entry) and the relevant migration doc. Honest gaps are better than false confidence.

### 3. 80/20 with escape hatches

We aim to be reliable on the common path, not exhaustive on the long tail. For the long tail, we provide escape hatches:

- `.raw` field on every result → consumers walk the AST themselves
- `walk(node, visitor)` API → full structural traversal with `"skip"` control
- `findAll(ast, "NodeType")` → typed extract for any node type
- `unwrapCallParsed(call)` → recurse into `wrapped-script` payloads
- Pluggable `globalFlags` option → register your own tool's value-flags per-call

When a consumer hits something we don't handle, the answer is usually "compose these primitives" — not "wait for us to ship a feature."

### 4. No silent failures, no implicit fallthrough

- Discriminated unions over nullable optional fields. `UnwrappedCall` is `plain | wrapped | wrapped-script | wrapped-opaque`, exhaustively typed. TypeScript forces consumers to handle every case.
- Typed errors. `ParseSyntaxError`, `ParseSizeError`, `WasmLoadError`, `WasmRuntimeError` — discriminated by `.kind`. No regex-on-message catch sites.
- Never `catch {}` or `?? undefined` to swallow a failure.
- The no-execution guard in CI (`tests/smoke/...` + `grep` for `child_process`/`Bun.spawn`/…) keeps the test surface from ever shelling out — we parse shell strings, we don't run them.

### 5. Verification before claim

Source-side green is necessary but not sufficient. For shell-ast specifically, the bundled `dist/index.js` must be verified at runtime before any `npm publish`:

- `grep -c "globalThis.Go" dist/index.js` must be ≥ 2 (definition + check)
- Fresh `/tmp` consumer smoke must import + parse + assert

The 0.3.1 incident — `sideEffects: false` caused the bundler to tree-shake `wasm_exec.js`, source tests stayed green, the published artifact threw `WasmLoadError` on every consumer call — is the load-bearing lesson. See `feedback_verify_dist_before_publish.md` and `feedback_sideeffects_false_breaks_wasm.md` in `~/.claude/projects/-home-qs-m4rk-Projects-shell-ast/memory/`.

### 6. Personal-scale, not OSS-shaped

This is a single-maintainer ecosystem with a few testers. The standard OSS reflexes — defer features waiting for "user requests," design for hypothetical consumers, treat every API as forever-stable — don't apply. **The user is the consumer.** Add features when they're useful, accept break-the-API minors as natural, push back on architectural over-reach but not on "we don't have proof users want this."

What stays: semver discipline (don't break minors without migration docs), honest changelogs, public packages with permissive licenses (MIT/BSD). What doesn't: API council, RFC process, deprecation cycles measured in years.

### 7. Manual publish, no auto-publish

No GH Actions workflow auto-publishes shell-ast (or hook-kit or ai-guardrails). CI runs tests, smokes, validates. The human pushes the button. The full ritual is in `~/.claude/projects/-home-qs-m4rk-Projects-shell-ast/memory/project_publish_ritual.md` (9 steps).

Rationale: the WASM build needs Go ≥ 1.25 (which CI is pinned to), the two CI smoke tests would catch most issues but only fire on PR, and bypassing them via direct push to main is exactly the manual-publish trap that caused 0.3.1. Keeping the publish manual makes the verification step impossible to skip.

### 8. Honest disagreement, not performative agreement

When a user idea is wrong (or just suboptimal), say so. Mirroring an idea back without pushback wastes the user's filtering budget and leaves them less informed than before they asked. Direct quote: *"U can push back, u just matched kinda what i wanned, so now i have no idea and im just throwring ideas."*

Same rule applies to architectural pull-back: when I notice my own drift (e.g. proposing schemas/Role vocabularies for shell-ast — see `feedback_shell_ast_is_a_toolkit.md`), self-correct rather than wait for the user to course-correct me again.

### 9. Plan, ask, implement

For non-trivial features:

1. Write a plan doc at `docs/plans/<version>.md` covering scope, locked decisions, file structure, test plan, worked examples, order of work, and what we explicitly do NOT do.
2. Surface the genuine design choices via `AskUserQuestion` (4 max, with my recommendation flagged).
3. Lock the decisions in the plan doc with a dated signoff line.
4. Test-first implementation (write the failing tests, then implement until green).
5. Verify-before-publish ritual (see principle 5).
6. Publish + commit + tag + GH release with substantive notes.

The 0.5.0 release followed this pattern end-to-end. It's the working template.

### 10. Document the *why*, not the *what*

Code shows what we do. `git blame` shows when we did it. Memory and docs hold the *why* — rationale for architectural decisions, working agreements, incidents that shaped current rules. Things that can't be grepped for.

What goes in **memory** (`~/.claude/projects/<slug>/memory/`):
- Corrections from the user (feedback wing)
- Project state with rationale (project wing — what's underway, why)
- Pointers to external resources (reference wing)
- User profile facts (user wing)

What goes in **docs/**:
- BUG entries with reproducers, limitations, fix paths
- Migration guides
- Specs (architecture, design rationale)
- This ideology doc

What goes in **CLAUDE.md**:
- Tactical project guidance (commands, module layout, conventions)
- Pointers to the docs and memory

What goes in **code comments**:
- The *why* of a non-obvious choice ("workaround for bug X", "this loop invariant guarantees Y")
- Never the *what* (the code already shows that)

---

## Where each project stops

The most common scope-violation pattern is "shell-ast should know about [tool]" or "hook-kit should ship default rules for [scenario]." Most of those are architecturally rejected, not just deferred — the difference matters when re-evaluating.

This section is split into two subsections per a 2026-05-18 BUG-008 postmortem lesson (memory: `feedback_dont_conflate_deferred_with_rejected.md`). **Architecturally rejected** features stay rejected for the structural reason listed; "a consumer asked" doesn't unlock them. **Deferred** features have an explicit revisit-condition; when the condition triggers, they ship.

### Architecturally rejected

- **shell-ast shipping per-tool semantic schemas** (gcc / git / docker / kubectl). Per-tool knowledge belongs in hook-kit. shell-ast's `GLOBAL_VALUE_FLAGS` table is the *minimum* needed to keep positional parsing correct — not a wedge for shipping full grammars.
- **shell-ast adding a `Role` vocabulary** (`fs-read`, `fs-write`, `fs-cwd`, `config`, …). shell-ast doesn't tag tokens with semantic roles. Consumer tags whatever they want.
- **shell-ast adding a fluent `Query<T>` chain class** (LINQ-style). Native `Array.prototype` + Iterator Helpers already cover the chain case. Don't reinvent.
- **hook-kit shipping a pre-built rule library**. hook-kit ships *primitives*, consumers ship *rules*. `examples/ai-guardrails/src/hooks.ts` is the reference for how a downstream composes them — it lives in examples, not in `src/`.
- **GitHub Actions auto-publish workflow**. See principle 7 — manual publish is what makes the load-bearing verification step impossible to skip.
- **Default schemas / Role vocabulary / schema registry / per-tool plugin runtime**. All rejected during v0.5.0 design — see `docs/plans/v0.5.0.md` "What this release explicitly does NOT ship."

### Deferred (with revisit-conditions)

(Currently empty as of 2026-05-18. `unwrapDeep` was the last entry here; shipped in v0.7.0 once hook-kit-Claude filed #11 with the asymmetry argument that met the revisit gate. The shape of an entry in this section:)

- ~~**shell-ast adding `unwrapDeep` for chained wrappers**~~ — **SHIPPED v0.7.0** ([plan](./plans/v0.7.0.md), closes [BUG-008](./BUGS.md), closes [#11](https://github.com/Questi0nM4rk/shell-ast/issues/11)). Original deferral rationale: "consumers can do this themselves with `unwrapCallParsed` + `findCalls` recursion." Revisit gate: "when hook-kit hits real pain." Gate triggered by hook-kit's asymmetric-classification argument on #11. Lesson — see memory `feedback_verify_escape_hatch_claims.md`: the escape-hatch claim ("hook-kit's recurseInlineShells covers `sudo bash -c \"rm\"`") was wrong and got carried unverified across two releases.

---

## 11. The primary lens must be complete

When a release ships an opinionated "headline API" (the path the README and CLAUDE.md push), the consumer must never need to fall through to lower-level primitives to answer questions the headline API was designed for. Falling through to `.raw` (or re-running an upstream resolver) is the escape hatch for *uncommon* questions — not for the questions the primary lens claims to answer.

Concretely: shell-ast's headline path is `parse → findCalls → unwrapCall → switch (u.kind)`. Security rules naturally want to ask "what value did flag X get on the inner command?" and "is flag Y present anywhere on the inner command?". Those questions are *core to the primary lens* and must be answerable directly from the `UnwrappedCall` shape — not by reaching past it to the resolver or by re-synthesizing the inner call.

This is downstream of §3 ("80/20 with escape hatches"): escape hatches exist for the 20%, not for filling holes in the 80%.

### Worked failure: v0.5.0 → v0.6.0

In v0.5.0 we added `flagValues` to `ResolvedCall` (the *secondary* lens — what you get from `resolveFlags(call)` directly). We did not also propagate it through `unwrapCall` to `UnwrappedCall`. Consumers wanting flagValues on a wrapper-aware lookup had to either:

1. Re-run `resolveFlags(u.raw, opts)` after `unwrapCall` — wasteful, and for `wrapped` calls `u.raw` is the OUTER (sudo) call, not the inner gcc.
2. Walk `u.raw` with query helpers — same outer-vs-inner trap; can return wrong target.

That's the smell. The fix (v0.6.0) wasn't to add one named field — it was to recognize the *class* of "the inner call's information is unreachable from the primary lens" and close it: `flagValues` + `innerRaw` on `UnwrappedCall.wrapped` + polymorphic query helpers that dispatch to the inner call when given an `UnwrappedCall`.

### Filter for future features

Before shipping a new piece of derived information, ask: *can the consumer reach this through the primary lens without falling through to `.raw` or re-running the resolver?* If no, the API change isn't done. Either complete the primary-lens surface or articulate why the question doesn't belong on the primary lens.

This principle does NOT mean "ship every conceivable derived view." It means "if you ship A on `ResolvedCall`, audit whether `UnwrappedCall` needs a mirror — and if so, do it in the same release."

### Sibling rule: asymmetric variant classification

Added 2026-05-18 from the v0.7.0 BUG-008 postmortem (memory: `feedback_asymmetric_variant_classification.md`).

When the same logical chain produces different lens shapes depending on which wrappers compose it, the lens is asymmetric. Worked example: `bash -c '…'` classifies as `wrapped-script` (auto-recursed via `unwrapCallParsed`), but `sudo bash -c '…'` classifies as `wrapped`-with-shell-inner (consumer-recursed). Same chain, different code path. Consumer has to re-implement what the lens does one wrapper away. That asymmetry IS the primary-lens problem, sibling to the "data-dropped-at-the-boundary" original.

Filter: when adding a wrapper variant or a new wrapper entry, test the with-wrapper-prefix shape (`sudo X`, `doas X`, `env X`) alongside the bare shape (`X`). Snapshot it in `tests/wrapper-shapes.test.ts`. If the resulting shapes diverge such that consumers would walk them differently, that's a design smell — close the gap (e.g., ship the auto-recursion via `unwrapDeep` / `unwrapDeepParsed`) or document the asymmetry as a deliberate boundary.

---

## Direction (snapshot — refresh as plans evolve)

### shell-ast

Currently at `0.7.0`. v0.5.x was the "toolkit primitives" baseline; v0.6.0 closed the primary-lens-completeness gap (see §11) — `flagValues` + `innerRaw` on `UnwrappedCall`, polymorphic query helpers. v0.7.0 closed the chained-wrapper asymmetry (see §11 sibling rule) — `unwrapDeep` + `unwrapDeepParsed`. Beyond 0.7.0, more primitives land only when hook-kit hits real pain — no schemas, no roles, no per-tool default DB. See `docs/plans/v0.5.0.md`, `docs/plans/v0.6.0.md`, `docs/plans/v0.7.0.md` for what landed and what was explicitly deferred.

### hook-kit

v0.6.0 plan (in `~/Projects/hook-kit/CLAUDE.md`):
- Adopt shell-ast 0.5 features: basename match by default in `cmd()`, `.flagValueMatches()` / `.flagValueEquals()` on `cmd()` backed by `flagValues`, `findRedirects({depth: "top"})` in `redirect()`, expose `ResolveFlagsOptions.globalFlags` through `evaluate()` / `runShell()`.
- Ship the test-builders SDK (`@questi0nm4rk/hook-kit/testing`).
- 0.5.1 already landed the `src/rules/` → `src/builders/` rename + the rule-free split docs.

### ai-guardrails

v4 native hook-kit integration is the current state. Maintains three binaries (`ai-guardrails`, `ai-guardrails-hk`, `ai-guardrails-hk-cc-tools`). Adds rule groups as the user's per-tool needs surface.

### feets

BDD framework, used by all three. Not currently undergoing scoped feature work in this session.

### qsm-marketplace

Methodology + tooling plugins. Bootstrapped via `qsm-setup`. The Stop hook's `DECISION:` extraction, the memory vault, the cli-wrappers pattern, the worktree-bash annotation — all from this stack.

---

## How to use this document

Cross-project decisions reference this doc by section. When proposing a change that touches scope boundaries, cite which principle applies. When a principle is wrong for a new situation, **update this doc first** — don't quietly violate it.

Last updated: 2026-05-18 (v0.7.0 — `unwrapDeep`, IDEOLOGY refactor per BUG-008 postmortem).
