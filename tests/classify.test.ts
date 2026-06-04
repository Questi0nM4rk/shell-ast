import { describe, expect, test } from "bun:test";
import { isShellInterpreter } from "../src/index.js";

describe("isShellInterpreter — script-wrapper classification (issue #12)", () => {
  test.each([
    "bash",
    "sh",
    "zsh",
    "dash",
    "ash",
    "ksh",
    "mksh", // SHELL_SCHEMA (-c)
    "eval", // commandFromArgs
    "su", // commandFlag -c + positional user
    "runuser", // commandFlag -c — MORE complete than hook-kit's hand-set
  ])("%s → true (carries a script payload)", (name) => {
    expect(isShellInterpreter(name)).toBe(true);
  });

  test.each([
    "sudo",
    "doas",
    "run0",
    "pkexec",
    "gosu",
    "setpriv", // privilege escalators
    "exec", // exec'd argv, not a script
    "env",
    "timeout",
    "nice",
    "nohup", // command-introducers (added later)
    "rm",
    "git",
    "notacommand", // non-wrappers
  ])("%s → false (not a script wrapper)", (name) => {
    expect(isShellInterpreter(name)).toBe(false);
  });

  test("basename-normalized: /usr/bin/bash → true", () => {
    expect(isShellInterpreter("/usr/bin/bash")).toBe(true);
  });
  test("basename-normalized: /bin/sudo → false", () => {
    expect(isShellInterpreter("/bin/sudo")).toBe(false);
  });

  test("trailing slash: bash/ → false", () => {
    expect(isShellInterpreter("bash/")).toBe(false);
  });
  test("empty string → false", () => {
    expect(isShellInterpreter("")).toBe(false);
  });
});
