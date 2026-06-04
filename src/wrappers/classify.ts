// Wrapper classification predicates derived from the WRAPPERS registry.
// Keeps the registry itself INTERNAL (per the v1.0 stability tiers) while
// giving consumers a stable boolean lens.

import { WRAPPERS } from "./registry.js";

/** Strip a path prefix to its basename for registry lookup.
 *  `/usr/bin/bash` → `bash`, `./bash` → `bash`, `bash` → `bash`. */
function basename(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

/** True iff `name` is a shell interpreter — a wrapper that carries its
 *  payload as a *script string* (`bash -c "…"`, `eval "…"`,
 *  `su user -c "…"`, `runuser -c "…"`) rather than as an exec'd argv
 *  (`sudo`, `env`, `exec`, …).
 *
 *  Derived from `WRAPPERS`: a row is a script interpreter iff it sets
 *  `commandFlag` (a `-c`-style script flag) or `commandFromArgs`
 *  (positional script, e.g. `eval`). Adding an interpreter to the
 *  registry auto-updates this predicate — no second list to drift.
 *
 *  Basename-normalized so `/usr/bin/bash` resolves like `bash`.
 *  Empty string and trailing-slash forms (`bash/`, `/`) normalize to
 *  `""`, which is absent from `WRAPPERS` and so returns `false` — the
 *  correct, safe default.
 *
 *  Consumers (hook-kit SA-02) use this to decide whether a
 *  `wrapped-opaque` layer with a dynamic body must be *escalated*
 *  (shell interpreter → can't inspect the script) vs left alone
 *  (non-shell wrapper). See issue #12. */
export function isShellInterpreter(name: string): boolean {
  const schema = WRAPPERS[basename(name)];
  if (!schema) return false;
  return schema.commandFlag !== undefined || schema.commandFromArgs !== undefined;
}
