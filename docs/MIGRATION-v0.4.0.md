# What changed in `@questi0nm4rk/shell-ast@0.4.0`

A targeted parser-semantics fix for [BUG-000](./BUGS.md). Shipped 2026-05-15. **No API changes** — the surface (`parse`, `findCalls`, `unwrapCall`, `resolveFlags`, …) is unchanged. The fix changes the *output shape* of `resolveFlags` (and therefore `unwrapCall`) for six tools: `git`, `docker`, `kubectl`, `make`, `tar`, `xargs`.

If your code does **not** match on `resolveFlags(...).args[0]` for those tools, you can drop in 0.4.0 with no changes. If it does, the change is almost certainly in the right direction (closes a silent-bypass class of bug), but read on.

---

## TL;DR

`resolveFlags` now consults a per-tool table of *value-taking* global flags. Tokens that follow a known value-flag are consumed as the flag's value instead of being pushed to `args`.

```ts
// v0.3.x — silent positional shift
resolveFlags(parse("git -C /tmp worktree add /tmp/x").stmts[0].cmd)
// → { cmd: "git", flags: ["-C"], args: ["/tmp", "worktree", "add", "/tmp/x"] }
//                                          ^^^^ leaked into args[0]

// v0.4.0 — `-C` consumes its value
// → { cmd: "git", flags: ["-C"], args: ["worktree", "add", "/tmp/x"] }
```

For consumers running **subcommand-position rules** (e.g. hook-kit's `cmd("git", "worktree")` matcher checking `args[0] === "worktree"`), this is the difference between catching `git -C /tmp worktree add` and silently missing it.

---

## Affected tools

| Tool | Value-taking flags |
|---|---|
| `git` | `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`, `--super-prefix`, `--config-env` |
| `docker` | `-H`, `--host`, `--config`, `--context`, `--log-level`, `--tlscacert`, `--tlscert`, `--tlskey` |
| `kubectl` | `-n`, `--namespace`, `-s`, `--server`, `--context`, `--cluster`, `--kubeconfig`, `--token`, `--user`, `--as`, `--as-group`, `--certificate-authority`, `--client-certificate`, `--client-key` |
| `make` | `-C`, `--directory`, `-f`, `--file`, `--makefile`, `-I`, `--include-dir`, `-j`, `--jobs`, `-l`, `--load-average`, `-o`, `--old-file`, `--assume-old`, `-W`, `--what-if` |
| `tar` | `-C`, `--directory`, `-f`, `--file` |
| `xargs` | `-I`, `-n`, `--max-args`, `-P`, `--max-procs`, `-d`, `--delimiter`, `-E`, `-L`, `--max-lines`, `-s`, `--max-chars`, `-a`, `--arg-file` |

Tools NOT in this list are unaffected — `resolveFlags` falls back to the legacy "every `-X` is boolean" behavior for them. `--longflag=value` (the `=` form) needs no special handling under any tool because `=` keeps positional alignment intact already.

---

## Before / after

### Subcommand-position match suddenly fires (good)

```ts
// Consumer rule (pseudocode):
//   "deny `git worktree add` regardless of -C"
function isGitWorktreeAdd(call: CallExprNode): boolean {
  const r = resolveFlags(call);
  return r?.cmd === "git" && r.args[0] === "worktree" && r.args[1] === "add";
}

// v0.3.x:
isGitWorktreeAdd(parse("git worktree add /tmp/x"));        // ✓ true
isGitWorktreeAdd(parse("git -C /tmp worktree add /tmp/x")); // ✗ false (silent bypass)

// v0.4.0:
isGitWorktreeAdd(parse("git worktree add /tmp/x"));        // ✓ true
isGitWorktreeAdd(parse("git -C /tmp worktree add /tmp/x")); // ✓ true (fix)
```

### Wrapper-aware unwrap inherits the table

```ts
// `sudo git -C /tmp worktree add` — the `-C` consumption happens
// on the *inner* git call, after sudo is stripped. No code changes
// needed in the consumer; unwrapCall already calls resolveFlags
// after wrapper-stripping.
const u = unwrapCall(parse("sudo git -C /tmp worktree add"));
// v0.4.0: { kind: "wrapped", wrapper: "sudo", cmd: "git",
//          flags: ["-C"], args: ["worktree", "add"] }
```

### Path-based rules see fewer paths in `args` (intentional)

If your rule used `args.some(isPathLike)` to flag any path-shaped argument, you may now see *fewer* matches for affected tools:

```ts
// "warn if any arg looks like an absolute path"
function hasAbsolutePathArg(call: CallExprNode): boolean {
  const r = resolveFlags(call);
  return !!r?.args.some((a) => typeof a === "string" && a.startsWith("/"));
}

// v0.3.x: hasAbsolutePathArg(parse("git -C /tmp worktree add")) → true
// v0.4.0: hasAbsolutePathArg(parse("git -C /tmp worktree add")) → false
```

This is generally desired — `/tmp` is the *target directory* of the global `-C` flag, not a positional argument to `worktree add`. If you specifically want to inspect the value of `-C` (or `-H`, `--context`, …), see the *Known limitations* section below for the v0.5.0 plan.

### `args[0]` for affected tools just shifted

Before:
```ts
resolveFlags(parse("docker -H tcp://prod:2375 run nginx").stmts[0].cmd).args
// → ["tcp://prod:2375", "run", "nginx"]
```

After:
```ts
resolveFlags(parse("docker -H tcp://prod:2375 run nginx").stmts[0].cmd).args
// → ["run", "nginx"]
```

If your test fixtures asserted the old shape, update them.

---

## Known limitations of the 0.4.0 fix

These shape exactly what `resolveFlags` does and does not handle. Each one is a deliberate scope decision; the v0.5.0 plan is at the bottom.

1. **`-Cvalue` (concatenated short form) is not consumed.** `git -C/tmp worktree add` parses with `-C/tmp` as a single literal flag token — only the space-separated form (`-C /tmp`) triggers value consumption.
2. **Tool name match is exact.** `git` looks up the table; `/usr/bin/git` does not. Normalize tool paths in your consumer if you rely on this.
3. **`xargs cmd args…` boundary not detected.** `resolveFlags` consumes `-I {} -n 1` correctly, but does not know that the rest of the line is xargs's command-to-run. `xargs -I {} -n 1 rm -rf` produces `flags: ["-I", "-n", "-r", "-f"], args: ["rm"]` — `-rf` is incorrectly treated as flags-of-xargs. Consumers wanting the inner-cmd as a unit should locate the first non-flag arg after the global flags and slice from there.
4. **Dynamic values are silently consumed**, not exposed in a separate `flagValues` map. `git -C "$DIR" worktree add` produces `flags: ["-C"], args: ["worktree", "add"]` with no surfaced `$DIR`. If you need the value of a flag (literal or DYNAMIC), this is deferred to v0.5.0.
5. **The table is not extensible from consumer code.** It is a private const inside `src/flags.ts`. If you need to register your own tool, file an issue with the tool name and its value-flag list. v0.5.0 will likely add a `parse(src, { globalFlags: {...} })` opt-in for niche tools.

---

## Verifying migration

```bash
bun add @questi0nm4rk/shell-ast@0.4.0   # or npm install
bun test                                # update fixtures that asserted old shapes
```

Quick search for code that may need a glance:

```bash
# args[0]-on-affected-tools matchers (likely NEEDS your attention):
grep -rn 'resolveFlags' src/ | grep -E 'git|docker|kubectl|make|tar|xargs'

# rules that walk args looking for path-shaped values:
grep -rn '\.args\.some\|args\.find' src/

# fixtures that asserted the old `args` shape:
grep -rn '"\(/tmp\|/repo\|tcp://\|prod\)"' tests/  # adjust patterns to your layout
```

---

## Why "BUG-000" and not "BUG-NNN"?

The bug index in `docs/BUGS.md` is ordered by severity / urgency, not by discovery date. BUG-000 sits above BUG-001 (WASM path) because:

- BUG-001 has a known fix path (lazy WASM resolution); BUG-000 needed a design decision.
- BUG-001 is workaroundable downstream (don't `bun build --compile`); BUG-000 was *not* workaroundable without consumers rebuilding the same per-tool table client-side, which is exactly the scope blow-up shell-ast exists to absorb.
- It's the closest the shell-ast → hook-kit → ai-guardrails stack had to a quiet-bypass class of bug.

---

## Where to file issues

- Library bugs / API regressions: <https://github.com/Questi0nM4rk/shell-ast/issues>
- A tool you want added to the global-flag table: same place, label as `enhancement` and include the tool name + the list of value-taking global flags from its man page. Short PRs adding entries to `GLOBAL_VALUE_FLAGS` are welcome.
