# SPEC-006: Research — Enterprise Shell Analysis Standards

## Status: Reference
## Version: 1.0

Captures the research that motivated choosing full AST parsing over simpler approaches.

---

## Three Tiers of Shell Analysis

### Tier 1: Regex

Used by: simple pre-commit hooks, basic SAST scanners, grep-based tools.

**Handles:**
- Literal command patterns: `/\brm\b.*-rf/`
- Simple flag detection when flags are adjacent

**Misses:**
- `rm -rf file1 file2` (multi-target — trailing anchor fails)
- `sudo -u root rm -rf /` (flag-arg pairs skip real command)
- `rm -r -f /` (split flags)
- Quoted arguments: `rm -rf 'my path'`
- Escaped characters
- Any command substitution

**Verdict:** Baseline protection. Trivially bypassed by any non-trivial shell invocation.

### Tier 2: Token-Level

Used by: `shell-quote` (npm), POSIX shell word-splitting implementations.

**Handles:**
- Quoting and escaping correctly
- Multi-word arguments: `rm -rf 'path with spaces'`
- Token boundaries

**Misses:**
- Flag-argument pairs: `sudo -u root rm -rf /` — `-u` consumes `root`, `rm` is missed
- Split flags requiring semantic recombination: `rm -r -f /`
- Pipe semantics: `echo foo | rm -rf /dev/null` — which command is the dangerous one?
- Command substitution: `$(rm -rf /)`
- Arithmetic expansion: `rm -rf $(echo /)`

**Verdict:** Good for the common cases. Fails on adversarial inputs and privilege escalation patterns.

### Tier 3: Full AST

Used by: Falco, CrowdStrike Falcon, commercial SAST, tree-sitter-based tools.

**Handles everything Tier 2 misses, plus:**
- Full pipe graph traversal
- Command substitution (recursive)
- Process substitution
- Here-documents
- Arithmetic evaluation paths
- All flag combinations regardless of order
- All privilege escalation wrappers (`sudo`, `doas`, `run0`, `su`, `nsenter`, `chroot`)

**Verdict:** The correct approach for any serious security tool.

---

## Enterprise Tool Analysis

### Falco (CNCF, open source)

**Approach:** Syscall interception via eBPF at the Linux kernel level. Captures `execve()` calls with resolved arguments after shell processing.

**Tier:** 4 (post-execution, syscall level — even above AST)

**Relevant for us:** Falco runs *after* the command executes. We need pre-execution analysis. Falco is the right answer for production workload monitoring, not pre-execution hooks.

**Relevant pattern:** Falco uses a rule language that compares against the *resolved* argv:
```yaml
- rule: Delete bulk data
  condition: spawned_process and proc.name = rm and proc.args contains "-r"
  output: "rm -r detected (user=%user.name args=%proc.args)"
```
Argv is post-exec, fully resolved. No need for shell parsing.

### CrowdStrike Falcon (commercial)

**Approach (from published research):** Three-stage pipeline:
1. SIMD regex for fast initial screening
2. Context classifier (BERT-based) for ambiguous cases
3. On high-risk: shell tokenizer or command-line parser for full analysis

**Key insight:** Even CrowdStrike doesn't do full AST for everything — it's too expensive at scale. They tier the analysis based on initial risk score. Full parsing only for high-confidence risk cases.

**Relevant for us:** We're a pre-execution hook, called once per Bash tool invocation. Performance is not the bottleneck. We can afford full AST parsing on every command.

### DCG (Datadog Cloud Guard — published blog post)

**Approach:** "3-tier pipeline": SIMD → context classifier → tree-sitter AST

**Parser choice:** tree-sitter (specifically `tree-sitter-bash`)

**Why tree-sitter and not `mvdan/sh`?**
- tree-sitter is language-agnostic (one runtime, many grammars)
- DCG already uses tree-sitter for other languages
- tree-sitter grammars are maintained by the community

**Why we choose `mvdan/sh` instead:**
- `mvdan/sh` is spec-compliant POSIX + Bash, maintained by the same author as `gofmt`
- `mvdan/sh` is already in the `sh-syntax` npm ecosystem
- WASM compilation path is established
- tree-sitter-bash has less complete POSIX coverage

### ShellCheck (open source, widely used)

**Approach:** Full custom shell parser in Haskell. Not reusable as a library from TypeScript.

**Relevant insight:** ShellCheck's AST representation for our use case would be perfect, but it's not accessible from TypeScript without a subprocess call. `mvdan/sh` via WASM is a better integration story.

### Semgrep (open source, r2c)

**Approach for shell:** Uses a custom shell pattern syntax over tree-sitter-bash AST.

**Limitation:** Semgrep's shell support is incomplete relative to its Python/Java/Go support. Pattern matching over AST — not what we need (we need programmatic flag analysis).

---

## Why Not tree-sitter?

`tree-sitter-bash` has a npm package and WASM build. Why `mvdan/sh` instead?

1. **API quality**: `mvdan/sh`'s typed Go AST is more precise — every node type has specific fields. tree-sitter produces a generic `{type, children, text}` tree requiring manual navigation.

2. **Error recovery**: tree-sitter is designed for incremental parsing with error recovery. `mvdan/sh` fails fast on invalid syntax — appropriate for a security tool (malformed input = suspicious).

3. **Existing ecosystem**: `sh-syntax` already wraps `mvdan/sh` with WASM. We're forking a working WASM pipeline, not building one from scratch.

4. **Flag canonicalization**: `resolveFlags` is easier to implement against `mvdan/sh`'s typed `CallExpr.Args` than against tree-sitter's generic child nodes.

5. **Operator precision**: `mvdan/sh` gives us `BinaryCmd.Op` as an enum — `AND_IF`, `OR_IF`, `PIPE`, `PIPEALL`. tree-sitter gives us the raw operator text from source.

---

## Chosen Approach

**`mvdan/sh` v3 via WASM, full typed AST serialized to JSON.**

This is:
- Tier 3 (full AST) — handles all cases that regex and tokenizers miss
- Pre-execution — hooks fire before the command runs (not Falco's post-exec)
- TypeScript-native — no subprocess, no IPC, WASM loaded once
- Spec-compliant — `mvdan/sh` passes the POSIX test suite and handles all bash extensions
- Extensible — the full tree means we can add new checks without changing the parser

The only limitation: `mvdan/sh` does not evaluate shell arithmetic or variable expansion. `$(rm -rf /)` is identified as a `CmdSubst` containing a `CallExpr` — the recursive walk catches it. But `rm -rf ${DIR}` where `DIR=/` is not caught — the `ParamExp` is present but the value is unknown. This is acceptable; we're doing static analysis, not evaluation.
