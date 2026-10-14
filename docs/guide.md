# shell-ast guide

Feature reference and recipes. The README has the short version.

## Highlights

- **Discriminated `UnwrappedCall`** — `plain` / `wrapped` / `wrapped-script` / `wrapped-opaque` with exhaustiveness checking. Recognizes 17 wrappers: `sudo`, `doas`, `pkexec`, `run0`, `gosu`, `runuser`, `setpriv`, `su`, `sh`, `bash`, `zsh`, `dash`, `ash`, `ksh`, `mksh`, `eval`, `exec`. In 0.6.0, `wrapped` also carries `flagValues` (inner-call's value-flag map) and `innerRaw` (the synthetic inner `CallExprNode`), so wrapper-aware rules don't fall back to `u.raw` walks.
- **Polymorphic query helpers** *(0.6.0)* — every helper accepts `CallExprNode | UnwrappedCall`. For `wrapped`, it dispatches to the inner call automatically: `tokenAfter(u, "-o")` returns the inner `gcc -o` value even when wrapped in `sudo gcc`. Wrapper-side queries stay reachable via explicit `tokenAfter(u.raw, "-u")`.
- **Chained-wrapper unwrap** *(0.7.0)* — `unwrapDeep(call)` returns the chain as `UnwrappedCall[]` outermost-first for inputs like `sudo bash -c '…'` (chain length 2 sync — stops at `wrapped-script`). `unwrapDeepParsed(call, parse)` continues past `wrapped-script` by parsing the inner script (chain length 3 — `wrapped → wrapped-script → plain`). Consumers walk a uniform list regardless of which wrappers compose.
- **Per-tool global value-flag tables** *(0.4.0)* — `git -C /tmp worktree add` parses with `args: ["worktree", "add"]`, not `args: ["/tmp", "worktree", "add"]`. Covers `git`, `docker`, `kubectl`, `make`, `tar`, `xargs`. Sudo / wrapper unwrapping inherits the table on the inner call automatically. Closes [BUG-000](./BUGS.md).
- **Zero-config query helpers** *(new in 0.5.0)* — `tokenAfter(call, "-o")`, `hasFlag(call, "-r")`, `tokensAfter(call, "-c")`, `tokenAt(call, i)`, `indexOfFlag(call, "-C")`, `flagsMatching(call, predicate)`, `resolvedCmd(call)`. Both space form and `=` form handled. The toolkit primitives for hook-kit-style rule authors.
- **`flagValues` on `ResolvedCall`** *(new in 0.5.0)* — captured values for every value-taking flag the resolver recognized, indexed by flag name. Both `--git-dir=/repo` and `--git-dir /repo` populate the same key; repeated flags appear in order.
- **Pluggable `globalFlags`** *(new in 0.5.0)* — `resolveFlags(call, { globalFlags: { terraform: ["-chdir"] } })`. Register your own value-taking flags per-call, merged with the built-in table. No module state.
- **Basename match** *(new in 0.5.0)* — `/usr/bin/git`, `./bin/docker` now hit the right table row. Original path preserved on `cmd`.
- **`DYNAMIC` symbol sentinel** — distinguishes statically-resolvable args from `$variable` / `$(…)` substitutions. Type guards (`isResolved`, `isDynamic`) survive bundler regressions that would silently turn a sentinel into the literal string `"<dynamic>"`.
- **`wordToParts(w)`** — never null; returns `{kind: "literal" | "dynamic", value/sourceText}` fragments. See the partial structure of `rm $DANGER /tmp` instead of getting back `null`.
- **Typed errors** — `ParseSyntaxError` / `ParseSizeError` / `WasmLoadError` / `WasmRuntimeError` with `.kind` discriminator. Catch sites distinguish "user input malformed" from "infra broken."
- **`effectOf(node)` / `effectsOf(node)`** — 13 structural effect kinds (`exec`, `pipe`, `fs-write`, `fs-read`, `fs-rw`, `fd-dup`, `subshell`, `fork-detach`, `capture-exec`, `compound-fs-read`, `compound-fs-write`, `env-write`, `env-prefix`) derived from operator enums. No command-name knowledge required.
- **`findCalls(ast, { depth: "top" })`** — skip data-as-code subtrees (`$(…)`, `<(…)`, `{a,b,c}`) so pipe-rule and inline-shell logic don't need to re-filter.
- **`preloadWasm()`** — idempotent warm-up to move WASM init out of the first-`parse()` hot path.
- **ANSI-C unescape** — `$'\n'` resolves to a real newline. UTF-8 BOM stripped before parse. Multi-part static `Word`s fold (`"foo""bar"` → `"foobar"`).


## Quick recipes

### Security hook — block dangerous patterns before execution

```typescript
import { parse, findCalls, unwrapCall } from "@questi0nm4rk/shell-ast";

async function check(input: string): Promise<string | null> {
  const ast = await parse(input).catch(() => null);
  if (!ast) return null;

  for (const call of findCalls(ast)) {
    const u = unwrapCall(call);
    if (!u) continue;

    switch (u.kind) {
      case "plain":
      case "wrapped":
        if (u.cmd === "rm" && u.flags.includes("-r") && u.flags.includes("-f"))
          return `blocked: rm -rf${u.kind === "wrapped" ? ` via ${u.wrapper}` : ""}`;
        if (u.cmd === "git" && u.args[0] === "push" && u.flags.includes("--force"))
          return "blocked: git push --force";
        break;
      case "wrapped-script":
        return await check(u.script); // recurse into bash -c "..."
      case "wrapped-opaque":
        if (u.wrapper === "sudo" || u.wrapper === "doas")
          return `escalation with dynamic inner (${u.wrapper})`;
        break;
    }
  }
  return null;
}
```

### Audit redirects writing outside the workspace

```typescript
import { parse, findRedirects, wordToLit } from "@questi0nm4rk/shell-ast";

const ast = await parse(input);
for (const r of findRedirects(ast, { ops: "write" })) {
  const target = wordToLit(r.word);
  if (target && !target.startsWith("./") && !target.startsWith("/tmp/"))
    console.warn(`writes outside workspace: ${target}`);
}
```

### Trace a pipeline

```typescript
import { parse, findCalls } from "@questi0nm4rk/shell-ast";

const ast = await parse("cat /etc/passwd | grep root | wc -l");
const names = findCalls(ast, { depth: "top" }).map((c) => {
  const part = c.args[0]?.parts[0];
  return part?.type === "Lit" ? part.value : "<dynamic>";
});
// ["cat", "grep", "wc"]
```

### Pre-warm WASM at startup (compiled binaries)

```typescript
import { preloadWasm } from "@questi0nm4rk/shell-ast";

await preloadWasm(); // idempotent; the first parse() is now instant
```

### Per-command rules — primary lens (0.6.0)

shell-ast's defaults are intentionally tool-agnostic. For per-tool nuance, compose the zero-config query helpers against the `UnwrappedCall` directly. The polymorphic helpers handle the sudo/bash/etc. unwrap for you — for `wrapped` variants, every query targets the **inner** call.

```typescript
// "gcc -o must write to /tmp/" — works for plain gcc AND sudo gcc
import { findCalls, parse, tokenAfter, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo gcc -o /etc/x.out main.c");
for (const call of findCalls(ast)) {
  const u = unwrapCall(call);
  if (u?.kind !== "plain" && u?.kind !== "wrapped") continue;
  if (u.cmd !== "gcc") continue;
  // u.flagValues works when -o is in the global table (or opts.globalFlags);
  // tokenAfter(u, "-o") is the zero-config fallback. Both target the inner call.
  const out = u.flagValues["-o"]?.[0] ?? tokenAfter(u, "-o");
  if (typeof out === "string" && !out.startsWith("/tmp/"))
    console.warn(`gcc -o ${out} writes outside /tmp`);
}
```

```typescript
// dd's if=/of= syntax — no `-` prefix, no space-separated value
import { findCalls, flagsMatching, parse, unwrapCall } from "@questi0nm4rk/shell-ast";

for (const call of findCalls(await parse(input))) {
  const u = unwrapCall(call);
  if (u?.kind !== "plain" && u?.kind !== "wrapped") continue;
  if (u.cmd !== "dd") continue;
  const writes = flagsMatching(u, (f) => f.startsWith("of=")).map((f) => f.slice(3));
  if (writes.some((t) => !t.startsWith("./"))) deny(`dd of= outside workspace`);
}
```

```typescript
// Register an unknown tool's value-flags per-call — opts threads through unwrap
import { findCalls, parse, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo terraform -chdir /tf apply");
for (const call of findCalls(ast)) {
  const u = unwrapCall(call, { globalFlags: { terraform: ["-chdir", "-state"] } });
  if (u?.kind !== "wrapped") continue;
  // u.flagValues = { "-chdir": ["/tf"] }  ← inner terraform's, NOT outer sudo's
  // u.args = ["apply"]
}
```

```typescript
// Native chains work — every extractor returns a real Array
import { findCalls, parse, tokenAfter, unwrapCall } from "@questi0nm4rk/shell-ast";

const ast = await parse(input);
const violations = findCalls(ast)
  .map((c) => unwrapCall(c))
  .filter((u): u is NonNullable<typeof u> => u?.kind === "plain" || u?.kind === "wrapped")
  .filter((u) => u.cmd === "gcc")
  .map((u) => tokenAfter(u, "-o"))
  .filter((o): o is string => typeof o === "string" && !o.startsWith("/tmp/"));
```

`tokenAfter` handles both `--git-dir /repo` and `--git-dir=/repo` forms internally. For wrapper-side queries (e.g. "did sudo escalate to root?"), pass `u.raw` explicitly: `tokenAfter(u.raw, "-u")`.

### Chained wrappers — `unwrapDeep` (0.7.0)

For `sudo bash -c 'rm -rf /'` and similar chained-wrapper invocations, `unwrapCall` peels exactly one layer. The lens classifies `bash -c '…'` as `wrapped-script` (auto-recursed via `unwrapCallParsed`) but `sudo bash -c '…'` as `wrapped`-with-shell-inner — same logical chain, different lens shape. `unwrapDeep` (sync) and `unwrapDeepParsed` (async, re-parses the inner script) return the chain as `UnwrappedCall[]` outermost-first so consumers walk a uniform list.

```typescript
// "is `rm` or `gcc` anywhere in this invocation chain?" — works for sudo bash -c '...' too
import { findCalls, parse, unwrapDeepParsed } from "@questi0nm4rk/shell-ast";

const ast = await parse("sudo bash -c 'gcc -o /etc/passwd src.c'");
for (const call of findCalls(ast)) {
  const chain = await unwrapDeepParsed(call, parse);
  for (const layer of chain) {
    if (layer.kind !== "plain" && layer.kind !== "wrapped") continue;
    if (layer.cmd === "gcc" && layer.flagValues["-o"]?.[0]?.startsWith("/etc/")) {
      console.warn(`gcc writes to system path via chain: ${chain.map((l) => l.cmd ?? l.wrapper).join(" → ")}`);
    }
  }
}
```

`unwrapDeep` stops at the first non-`wrapped` layer (sync can't re-parse). `unwrapDeepParsed` continues past `wrapped-script` and hydrates `innerAst` on that layer. Both cap internally at `MAX_CHAIN_DEPTH = 100` as a defensive runaway guard; consumers should cap on the returned array length per their own policy (hook-kit caps at 5).

### Custom wrappers — `wrapperResolver`

A consumer can teach `unwrapCall`, `unwrapDeep` and `unwrapDeepParsed` about its own command prefixes for one call, without global registration.

```typescript
import { type CustomWrapperResolver, findCalls, parse, unwrapDeep } from "@questi0nm4rk/shell-ast";

const wrapperResolver: CustomWrapperResolver = ({ cmd, args }) => {
  if (cmd === "mise" && args[0] === "x" && args[1] === "--") return { innerArgIndex: 2 };
  if (cmd === "op" && args[0] === "run" && args[1] === "--") return { innerArgIndex: 2 };
  return undefined;
};

const ast = await parse("sudo op run -- mise x -- target --flag");
const chain = unwrapDeep(findCalls(ast)[0]!, { wrapperResolver });
// sudo → op → mise → target
```

`args` holds every word after the command in source order; static words are strings, dynamic words are the `DYNAMIC` sentinel. `innerArgIndex` is zero-based in that array. Built-in wrappers take precedence. An index one past the last argument (`mise x --` with nothing after) returns `plain`; any other invalid index throws. The resolver sees `cmd` as written, so normalise `/usr/bin/mise` or `\mise` yourself. Contract details: [CAPABILITIES.md](./CAPABILITIES.md).

## Test and CI guards

- TypeScript tests, Go tests, a schema completeness test, and a fuzz test of the serializer (see `processor/fuzz_test.go`)
- **Two regression smokes** baked into CI — compiled-binary deployment ([gh #5](https://github.com/Questi0nM4rk/shell-ast/issues/5)), consumer install from-elsewhere ([BUG-001](./BUGS.md))
- **No process execution at the test surface** — CI greps the source tree for `child_process` / `node:child_process` / `worker_threads` / `node:worker_threads` / `node:vm` / `execSync` / `spawnSync` / `Bun.spawn` / `Deno.run` / `Deno.Command` and fails the build on any match. The library parses shell strings; the test suite must never run them.
- **Dependabot-tracked** for Go, npm, and GitHub Actions ecosystems


## Compatibility

| Runtime | Status |
|---|---|
| Node.js ≥ 18 | ✓ ESM only (this package is `"type": "module"`) |
| Bun ≥ 1.3 | ✓ |
| `bun build --compile` standalone binary | ✓ — checked by a CI smoke test ([gh #5](https://github.com/Questi0nM4rk/shell-ast/issues/5)) |
| Deno | should work via `npm:` specifier; not in CI |
| Browsers | not supported (uses Node WASI shim) |


## Development and release

Prerequisites: Go 1.25 or newer, Bun 1.3 or newer. TypeScript is a devDependency.

```bash
git clone https://github.com/Questi0nM4rk/shell-ast
cd shell-ast
bun install
bun run build      # build wasm + bundle ts
bun test           # run the TypeScript suite
go test ./processor/...    
```

`bun run prepublishOnly` runs the full release gate: `lint → typecheck → go test → bun test → build`.

### Releasing

A pushed `v*` tag runs `.github/workflows/release.yml`, which stages the package on npm; a maintainer approves it on npmjs.com with 2FA. It authenticates with npm trusted publishing (OIDC), so the repo holds no npm token. To ship a new version:

```bash
# set "version" in package.json to X.Y.Z, then:
git commit -am "chore: release X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The workflow fails before staging when the tag and `package.json` version differ. `prepublishOnly` runs the full gate (WASM build, lint, typecheck, go test, bun test, TS build) before the tarball is uploaded. The stage step passes `--provenance` on the command line, which overrides the `"provenance": false` in `publishConfig`.

`publishConfig.access` is set to `"public"` so the scoped package will not be silently rejected as private.

