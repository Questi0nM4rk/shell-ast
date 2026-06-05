# shell-ast capabilities and limits

> Status: Reference — what shell-ast can and cannot see.

shell-ast is a **static, pre-execution parser**. It tells you the commands and structure a shell string *could* produce;
it does not tell you what will happen when you run it.

---

## 1. The contract: static over-approximation

shell-ast runs **before execution** — the archetypal consumer is a `PreToolUse` guard that must approve or deny a command
before the shell ever sees it.

What the library returns is an over-approximation: it reports every command that *could* run, never a runtime-accurate
execution tree. The two are not the same.

An accurate execution tree is only obtainable by **running the command** under a tracer:

- `strace -f -e trace=execve` / `execsnoop` (eBPF) — syscall-level ground truth
- `bash -x` — shell traces what it actually evaluates
- `auditd` + `execve` rules — kernel audit log

Why static is fundamentally limited: command resolution depends on `$PATH` at the moment of execution, function and alias
shadowing that exists only in the calling shell's environment, `eval` and `$(…)` whose contents are opaque until they run,
and shell itself is Turing-complete. Deciding statically whether an arbitrary command reaches a given execution path is
undecidable in the general case.

That is not a library bug. It is the nature of parsing shell. The design response is to be **explicit about what is
unresolvable** — `DYNAMIC` sentinels, `wrapped-opaque` variants — so consumers can apply a conservative policy
(treat unknowns as suspicious) rather than silently missing them.

---

## 2. What shell-ast sees

These are the things shell-ast can surface from a parsed string:

- **Commands, flags, and positional args** — every `CallExpr` with `cmd`, `flags`, `args`
  (`ResolvedArg[]` — either a literal string or the `DYNAMIC` sentinel).
- **Value-flag-resolved positionals** — `resolveFlags(call)` / `unwrapCall(call)` apply `GLOBAL_VALUE_FLAGS` (see §7)
  so that `git -C /tmp status` yields `args: ["status"]` rather than `args: ["/tmp", "status"]`.
- **Redirects** — `findRedirects(ast)` returns every `Redirect` node with its operator
  (`>`, `>>`, `<`, `<<`, `<<<`, `<>`, `>&`, `&>`, `&>>`, …) and the target word.
- **Pipelines** — `BinaryCmd` nodes with `op: "|"` or `op: "|&"`; `effectsOf(node)` returns `"pipe"`.
- **Subshells** — `(cmd)` blocks appear as `Subshell` nodes.
- **Command substitutions as opaque shapes** — `$(…)` and `` `…` `` appear as `CmdSubst` nodes.
  The structure is present; the runtime value is not.
- **Wrapper unwrap** — `unwrapCall(call)` peels one layer of a recognized wrapper (see §6).
  `unwrapDeep` / `unwrapDeepParsed` walk chains.
- **Env-prefix assignments** — `FOO=bar cmd` exposes the `Assign` nodes on the `CallExpr`;
  `effectOf(call)` returns `"env-prefix"`.
- **Here-docs and here-strings** — `<<EOF … EOF` and `<<<value` appear as `Redirect` nodes
  with ops `"<<"` / `"<<-"` / `"<<<"`.
- **Operator effects** — `effectOf(node)` / `effectsOf(node)` classify 13 structural kinds
  (`exec`, `pipe`, `fs-write`, `fs-read`, `fs-rw`, `fd-dup`, `subshell`, `fork-detach`,
  `capture-exec`, `compound-fs-read`, `compound-fs-write`, `env-write`, `env-prefix`)
  from operator enums alone — no command-name knowledge required.

---

## 3. What shell-ast cannot see

Each limitation comes with the API output so consumers know exactly what they will receive.

### 3.1 Runtime variable values

```ts
const ast = await parse("rm $TARGET");
const call = findCalls(ast)[0]!;
const r = resolveFlags(call);
// r.args === [DYNAMIC]      ← the symbol, not the string "$TARGET"
// isDynamic(r.args[0])  === true
// isResolved(r.args[0]) === false
```

`$TARGET` is opaque until the shell expands it at runtime. The `DYNAMIC` sentinel is a unique symbol
(`Symbol("shell-ast.DYNAMIC")`), not the string `"<dynamic>"`.

### 3.2 Command-substitution results

```ts
const ast = await parse("CMD=$(which python); $CMD --version");
// findCalls returns two CallExprs:
//   CallExpr 1: cmd="which", args=["python"]  ← the inner sub's call
//   CallExpr 2: args=[DYNAMIC]                ← $CMD — value not known
```

`$(which python)` produces a `CmdSubst` node. The call inside it (`which python`) is visible as a `CallExpr`;
the string it would produce at runtime is not. Any subsequent use of the captured value is `DYNAMIC`.

### 3.3 Aliases

```ts
// shell session has: alias rm='rm -i'
const ast = await parse("rm /etc/passwd");
const r = resolveFlags(findCalls(ast)[0]!);
// r.cmd   === "rm"
// r.flags === []            ← -i is NOT here; aliases expand at runtime
```

The parser sees `rm` as written. Alias expansion happens in the calling shell at runtime; it is not part of the syntax tree.

### 3.4 Function vs binary

```ts
// shell session has: function deploy() { kubectl apply -f prod.yaml; }
const ast = await parse("deploy");
const r = resolveFlags(findCalls(ast)[0]!);
// r.cmd === "deploy"        ← indistinguishable from a binary named "deploy"
```

A `CallExpr` to a user-defined function looks identical to one for an external binary. The distinction is only
resolvable at runtime when the shell looks up `$PATH` and the function table.

### 3.5 Conditional reachability

```ts
const ast = await parse('[ -n "$x" ] && rm -rf /');
// findCalls returns two calls: "[" (the test) and "rm"
// Whether rm actually executes depends on the runtime value of $x.
```

`rm` is statically visible. Whether it runs is not. The library reports all reachable `CallExpr` nodes — consumers
apply their own conditional-reachability policy.

### 3.6 `eval` / `-c` of a non-literal

```ts
const ast = await parse('bash -c "$CMD"');
const u = unwrapCall(findCalls(ast)[0]!);
// u.kind   === "wrapped-opaque"
// u.reason === "dynamic-script"
// u.wrapper === "bash"
```

When the script body is a variable or substitution, the inner commands are unknowable statically. The library returns
`wrapped-opaque` with `reason: "dynamic-script"` so consumers still see the wrapper identity (escalation signal)
without fabricating inner commands that don't exist yet.

---

## 4. Where wrapper unwrap stops

`unwrapCall` returns one of four variants. Three of them are terminal — the chain cannot continue from them without
more information.

### `wrapped-opaque` — three `reason` values

| `reason` | What happened | Example |
|---|---|---|
| `"dynamic-script"` | Shell / eval given a non-literal body | `bash -c "$CMD"`, `eval $SCRIPT` |
| `"dynamic-command"` | Non-script wrapper given a non-literal inner command | `sudo $CMD`, `env $CMD` |
| `"missing-script"` | Shell `-c` flag present but no body at all | `bash -c` |

All three produce `{ kind: "wrapped-opaque", wrapper, reason, flags, args, raw }`. The `reason` field lets consumers
decide escalation policy without re-deriving the cause.

### `wrapped-script` with a literal script

`bash -c "rm -rf /"` produces `{ kind: "wrapped-script", wrapper: "bash", script: "rm -rf /" }`. The script string is
present. Re-parse it with `parse(u.script)` or use `unwrapCallParsed(call)` to receive the `innerAst` pre-populated.
The sync walker `unwrapDeep` stops at this variant — it cannot re-parse without `await`. Use `unwrapDeepParsed` to
continue past `wrapped-script` layers.

### Chain depth cap

`unwrapDeep` and `unwrapDeepParsed` have an internal `MAX_CHAIN_DEPTH = 100` runaway guard. Chains beyond that are
truncated (the partial chain is returned). Realistic inputs are never truncated; this guard exists against pathological
inputs like `sudo sudo sudo … cmd` with N large. Consumers that have their own policy (e.g. hook-kit caps chains at 5)
should check `chain.length` on the returned array.

---

## 5. Where wrapper unwrap also stops (structural, not opaque)

`unwrapDeep` continues only when the current `wrapped` layer's inner command is itself a recognized wrapper. For
`sudo rm`, the inner `rm` is `plain` — the chain returns `[wrapped(sudo, cmd:rm)]` because `plain(rm)` adds no new
information that `wrapped` doesn't already expose. For `sudo bash`, the inner `bash` is a recognized wrapper, so the
chain continues to `wrapped-script` or `wrapped-opaque`.

---

## 6. Wrapper coverage

All 21 recognized wrappers fall into three categories. `isShellInterpreter(name)` returns true for wrappers that carry
a **script payload** (a `-c`-style flag or positional script args). It returns false for everything else — including
privilege escalators and command-introducers. Basename-normalized: `isShellInterpreter("/usr/bin/bash") === true`.

| Category | Wrappers | `isShellInterpreter` |
|---|---|---|
| Privilege escalators | `sudo`, `doas`, `run0`, `pkexec`, `gosu`, `setpriv` | `false` |
| Shell interpreters | `bash`, `sh`, `zsh`, `dash`, `ash`, `ksh`, `mksh`, `eval`, `su`, `runuser` | `true` |
| Command-introducers | `env`, `timeout`, `nice`, `nohup`, `exec` | `false` |

Notes on the table:

- `su` and `runuser` are in the shell-interpreter row because both accept `-c "script"`.
- `eval` is in the shell-interpreter row because its positional args are joined and re-executed as a script.
- `exec` does not carry a script payload — it replaces the current process with its first positional arg.
- `env`, `timeout`, `nice`, `nohup` are command-introducers (added v0.8.0): they prefix another command but do not
  interpret a script.

**Not yet covered (deferred):**

- `find -exec … \;` inner-command boundary — `find` itself appears as a `CallExpr`; the `-exec` target is not unwrapped.
- `xargs` inner-command boundary — `xargs rm` appears as a `CallExpr`; the command `xargs` passes to `rm` is not
  re-classified as a wrapper chain. (`xargs` IS in `GLOBAL_VALUE_FLAGS` for its own flags; the inner command boundary
  is the gap.)
- `env -S` / `--split-string` — the string passed to `env -S` is not parsed as an argv.

---

## 7. `GLOBAL_VALUE_FLAGS` coverage and the escape hatch

Value-taking flags — flags that consume the next positional token as their value — must be declared for positional
alignment to be correct. Without the table, `git -C /tmp status` would produce `args: ["/tmp", "status"]` instead of
`args: ["status"]` with `-C`'s value captured in `flagValues`.

### Built-in default tools (v0.8.0)

| Tool | Value-taking flags (built-in) |
|---|---|
| `git` | `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`, `--super-prefix`, `--config-env` |
| `docker` | `-H`, `--host`, `--config`, `--context`, `--log-level`, `--tlscacert`, `--tlscert`, `--tlskey` |
| `kubectl` | `-n`, `--namespace`, `-s`, `--server`, `--context`, `--cluster`, `--kubeconfig`, `--token`, `--user`, `--as`, `--as-group`, `--certificate-authority`, `--client-certificate`, `--client-key` |
| `make` | `-C`, `--directory`, `-f`, `--file`, `--makefile`, `-I`, `--include-dir`, `-j`, `--jobs`, `-l`, `--load-average`, `-o`, `--old-file`, `--assume-old`, `-W`, `--what-if` |
| `tar` | `-C`, `--directory`, `-f`, `--file` |
| `xargs` | `-I`, `-n`, `--max-args`, `-P`, `--max-procs`, `-d`, `--delimiter`, `-E`, `-L`, `--max-lines`, `-s`, `--max-chars`, `-a`, `--arg-file` |
| `aws` | `--profile`, `--region`, `--endpoint-url`, `--output`, `--ca-bundle`, `--cli-read-timeout`, `--cli-connect-timeout` |
| `gcloud` | `--project`, `--account`, `--configuration`, `--format`, `--billing-project`, `--impersonate-service-account` |
| `terraform` | `-chdir` |
| `npm` | `--prefix`, `--registry`, `--workspace`, `-w`, `--userconfig`, `--globalconfig` |
| `cargo` | `--config`, `--color` |
| `gh` | `-R`, `--repo`, `--hostname` |

### The escape hatch — `ResolveFlagsOptions.globalFlags`

For tools not in the built-in table (e.g. `helm`, `az`, `pnpm`, `pip`), inject per-call value-flags via
`opts.globalFlags`. No module state; takes effect only for that call.

```ts
import { parse, findCalls, resolveFlags } from "@questi0nm4rk/shell-ast";

const ast = await parse("helm upgrade --namespace staging myapp ./chart");
const call = findCalls(ast)[0]!;
const r = resolveFlags(call, { globalFlags: { helm: ["--namespace"] } });
// r.cmd          === "helm"
// r.args         === ["upgrade", "myapp", "./chart"]
// r.flagValues   === { "--namespace": ["staging"] }
```

The `opts` object threads through `unwrapCall` and `unwrapDeep` — passing it at the top-level call is sufficient
for wrapper chains.

```ts
// Also works for sudo helm:
const u = unwrapCall(sudoHelmCall, { globalFlags: { helm: ["--namespace"] } });
// u.kind         === "wrapped"
// u.wrapper      === "sudo"
// u.flagValues   === { "--namespace": ["staging"] }   ← inner helm's value-flag
```

---

## 8. Pairing for ground truth — 3-ring framing

shell-ast is the **static ring** in a multi-layer defense:

```
┌──────────────────────────────────────────────────────────────────┐
│  static ring   shell-ast — what COULD run, before execution      │
│                fail TOWARD escalation on DYNAMIC / wrapped-opaque │
│                (can't see inside → treat as suspicious)           │
├──────────────────────────────────────────────────────────────────┤
│  runtime ring  execsnoop / auditd / strace -f — what DID run     │
│                kernel ground truth, no parsing ambiguity          │
├──────────────────────────────────────────────────────────────────┤
│  policy ring   ai-guardrails / hook-kit — deny / ask / warn      │
│                composed from both rings above                     │
└──────────────────────────────────────────────────────────────────┘
```

The two bottom rings are **complementary, not competing**. Static analysis runs before execution (zero runtime
overhead, catches the command before it fires). Runtime tracing provides ground truth for audit, forensics, and
anomaly detection after the fact. Static analysis cannot replace runtime tracing; runtime tracing cannot block
commands before they execute.

The conservative default for the static ring: when shell-ast returns `DYNAMIC` or `wrapped-opaque`, treat it as
**suspicious unless proven otherwise**. A consumer that passes through dynamic args silently is not using the API
safely. The `reason` field on `wrapped-opaque` lets the consumer calibrate — `"missing-script"` (bare `bash -c`) is
a different signal than `"dynamic-command"` (`sudo $CMD`) — but all three warrant escalation in a security-critical
context.
