# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-06-05

### Features

- **wrappers:** Export isShellInterpreter predicate (closes #12)
- **wrappers:** Add reason discriminator to wrapped-opaque variant
- **wrappers:** Cover env/timeout/nice/nohup command-introducers
- **flags:** Add aws/gcloud/terraform/npm/cargo/gh to GLOBAL_VALUE_FLAGS

### Bug Fixes

- **docs:** Reconcile TypeScript test count to live 351

### Refactor

- **wrappers:** Generalize positionalUser to leadingPositionals

### Documentation

- **claude:** Apply v0.7.0 ideology — plan-doc hygiene checklist, BUG-008 postmortem references
- Clean hero snippet, relabel 0.4.0 link
- **bugs:** Reconcile statuses, fix issue link, retitle log
- **audit:** Mark AUDIT.md historical
- Add SECURITY.md
- **changelog:** Regenerate Unreleased from this branch's commits
- Move resolved v0.4.0 audit into docs/decisions/
- Add CAPABILITIES.md — static over-approximation contract
- **bugs:** Mark BUG-001 FIXED + reconcile all statuses for 1.0 readiness

### Testing

- Add doc-count drift guard

### Security

- Add git-cliff config + generated CHANGELOG

### Chore

- **pkg:** Order exports conditions types-first
- **ts:** Fold scripts into root typecheck (LSP-correct)
- Remove cc-review workflows

## [0.7.0] - 2026-05-18

### Documentation

- Cross-reference v0.6.0 in CLAUDE.md + README; refresh module layout

## [0.6.0] - 2026-05-17

### Documentation

- Add CLAUDE.md + docs/IDEOLOGY.md (ecosystem framing)

## [0.5.0] - 2026-05-16

### Features

- **0.5.0:** Query helpers, flagValues, pluggable globalFlags, basename match

## [0.4.0] - 2026-05-16

### Features

- **0.4.0:** Per-tool global value-flag tables — closes BUG-000

## [0.3.2] - 2026-05-14

### Bug Fixes

- **release:** 0.3.2 — drop sideEffects:false; ship working bundle

## [0.3.1] - 2026-05-14

### Documentation

- Add v0.3.0 migration guide for consuming agents
- Modern OSS-shaped README + add LICENSE

## [0.3.0] - 2026-05-13

### Features

- [**breaking**] V0.3.0 — discriminated UnwrappedCall + effects + typed errors

## [0.2.1] - 2026-05-11

### Bug Fixes

- Re-anchor wasm path (closes #5)

## [0.2.0] - 2026-05-11

### Features

- Implement full shell-ast package (M1–M6)
- Codebase audit close (v0.2.0)

### Documentation

- Add specs, project scaffolding, and all research
- Simplify pass + factual corrections + new README
- Simplify, factual corrections, and new README

### Chore

- Initialize repository
- Add prepublishOnly, semantic export, .npmignore
- Rename package to @qs_m4rk/shell-ast (name was taken)
- Fix scope to @questi0nm4rk/shell-ast
- Add cc-review bot integration
- Grant WebSearch + WebFetch to cc-review workflow

