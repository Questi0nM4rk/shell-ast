// Wrapper schema + recognized-wrapper table.
//
// A wrapper is a command that *transparently invokes another command* —
// privilege escalators (sudo, doas, pkexec), shell invocations (bash -c),
// and execution primitives (eval, exec). The schema describes how to
// walk past the wrapper's own flags / positional vocabulary to reach
// the inner command.
//
// Extending: add a new entry to WRAPPERS keyed on the command name.
// Fields are documented inline on WrapperSchema.

/** Per-wrapper parsing schema consumed by `unwrapCall`. */
export interface WrapperSchema {
  /** Flags that consume the next positional arg as their value
   *  (`sudo -u root cmd`, `sudo --user root cmd`). Include both short
   *  and space-form long variants. */
  flagsWithArg: ReadonlySet<string>;
  /** When true, --foo=value is also accepted (single token, no extra arg). */
  longEq: boolean;
  /** When set, this flag's value is itself a shell command string
   *  (`bash -c "..."`). */
  commandFlag?: string;
  /** When true, the first positional arg is the target username
   *  (`gosu USER cmd`, `su USER -c "..."`). */
  positionalUser?: boolean;
  /** Some shells take their script via positional args, not a flag:
   *    "concat" — `eval "rm" "-rf" "/"` joins args[1:] with spaces
   *    "first"  — (reserved for future shapes; not currently used)
   *  When set, the wrapper produces a "wrapped-script" variant whose
   *  script field is built from positional args after the wrapper's
   *  own flags are consumed. */
  commandFromArgs?: "concat" | "first";
}

const SHELL_SCHEMA: WrapperSchema = {
  flagsWithArg: new Set(),
  longEq: false,
  commandFlag: "-c",
};

/** Recognized wrappers. Lookup is exact-match on the resolved command
 *  name (basename matching is applied upstream in `resolveFlags`). */
export const WRAPPERS: Readonly<Record<string, WrapperSchema>> = {
  // sudo: short flags accept space- or equals-form; long flags accept
  // both `--user=root` (longEq) and `--user root` (space). Include both
  // in flagsWithArg so space-form long flags are consumed.
  sudo: {
    flagsWithArg: new Set([
      "-u",
      "-g",
      "-h",
      "-D",
      "-C",
      "-p",
      "-r",
      "-t",
      "-T",
      "-U",
      "--user",
      "--group",
      "--host",
      "--chdir",
      "--close-from",
      "--prompt",
      "--role",
      "--type",
      "--command-timeout",
      "--other-user",
    ]),
    longEq: true,
  },
  doas: {
    flagsWithArg: new Set(["-u", "-C"]),
    longEq: false,
  },
  run0: {
    flagsWithArg: new Set([]),
    longEq: true,
  },
  pkexec: {
    flagsWithArg: new Set(["--user"]),
    longEq: true,
  },
  gosu: {
    flagsWithArg: new Set([]),
    longEq: false,
    positionalUser: true,
  },
  runuser: {
    flagsWithArg: new Set([
      "-u",
      "-g",
      "-G",
      "-s",
      "--user",
      "--group",
      "--supp-group",
      "--shell",
    ]),
    longEq: true,
    commandFlag: "-c",
  },
  setpriv: {
    flagsWithArg: new Set([
      "--reuid",
      "--regid",
      "--groups",
      "--bounding-set",
      "--securebits",
      "--pdeathsig",
    ]),
    longEq: true,
  },
  su: {
    flagsWithArg: new Set(["-s", "-G", "--shell", "--supp-group"]),
    longEq: false,
    commandFlag: "-c",
    positionalUser: true,
  },
  // POSIX shell wrappers carrying a script via -c. Not privilege
  // escalators, but chained patterns like `pkexec sh -c "rm -rf /"`
  // hide the inner command; surface the script regardless.
  sh: SHELL_SCHEMA,
  bash: SHELL_SCHEMA,
  zsh: SHELL_SCHEMA,
  dash: SHELL_SCHEMA,
  ash: SHELL_SCHEMA,
  ksh: SHELL_SCHEMA,
  mksh: SHELL_SCHEMA,
  // Shell-execution primitives whose script comes from positional args.
  //   eval "rm -rf /" — args[1:] joined by spaces, re-parsed at runtime
  //   exec rm -rf /   — args[1:] replace the current process
  // exec is also handled as a normal wrapper since args[1:] IS the inner command.
  eval: { flagsWithArg: new Set(), longEq: false, commandFromArgs: "concat" },
  exec: { flagsWithArg: new Set(), longEq: false },
};
