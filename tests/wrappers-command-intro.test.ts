import { describe } from "bun:test";
import { testCmd } from "./_assertions.js";

describe("command-introducing wrappers (v0.8.0)", () => {
  // nohup — bare prefix
  testCmd("nohup rm -rf /", { wrapper: "nohup", cmd: "rm" });

  // nice — value flag -n, then inner. innerRaw on the -NUM form guards the
  // syntheticCall built after the flag skip.
  testCmd("nice rm -rf /", { wrapper: "nice", cmd: "rm" });
  testCmd("nice -n 10 rm -rf /", { wrapper: "nice", cmd: "rm" });
  testCmd("nice -10 rm -rf /", {
    wrapper: "nice",
    cmd: "rm",
    innerRaw: { cmdLit: "rm", flagsLit: ["-rf"] },
  }); // old -NUM form

  // timeout — leading DURATION positional, then inner. innerRaw guards the
  // syntheticCall built after the leadingPositionals skip.
  testCmd("timeout 5 rm -rf /", {
    wrapper: "timeout",
    cmd: "rm",
    innerRaw: { cmdLit: "rm", flagsLit: ["-rf"] },
  });
  testCmd("timeout -s KILL 5 rm -rf /", { wrapper: "timeout", cmd: "rm" });
  testCmd("timeout --signal=KILL 5 rm /", { wrapper: "timeout", cmd: "rm" });

  // env — security case + assignment prefix + its own flags. innerRaw guards
  // the syntheticCall built after the assignmentPrefix skip.
  testCmd("env rm -rf /", { wrapper: "env", cmd: "rm" });
  testCmd("env FOO=bar rm -rf /", {
    wrapper: "env",
    cmd: "rm",
    innerRaw: { cmdLit: "rm", flagsLit: ["-rf"] },
  });
  testCmd("env -u PATH FOO=bar rm /", { wrapper: "env", cmd: "rm" });
  testCmd("env -i rm -rf /", { wrapper: "env", cmd: "rm" });
  testCmd("env -C /tmp rm -rf /", { wrapper: "env", cmd: "rm" });

  // dynamic inner → opaque with reason (routes through existing site)
  testCmd("env $CMD", {
    kind: "wrapped-opaque",
    wrapper: "env",
    reason: "dynamic-command",
  });
  testCmd("timeout 5 $CMD", {
    kind: "wrapped-opaque",
    wrapper: "timeout",
    reason: "dynamic-command",
  });
});
