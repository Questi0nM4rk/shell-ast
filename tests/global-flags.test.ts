// BUG-000 — per-tool global value-flag tables in resolveFlags.
//
// Without these, `git -C /tmp worktree add` parses with `args[0] === "/tmp"`,
// which silently bypasses any consumer rule that matches on subcommand
// position. The fix consults a per-tool table of value-taking global
// flags and consumes the next token as the flag's value.

import { describe, expect, test } from "bun:test";
import { findCalls, parse, resolveFlags, unwrapCall } from "../src/index.js";

async function firstCall(src: string) {
  const ast = await parse(src);
  const [c] = findCalls(ast);
  if (!c) throw new Error(`no CallExpr in: ${src}`);
  return c;
}

describe("BUG-000: global value-taking flags shift positional args correctly", () => {
  test("git -C consumes its directory value, not args[0]", async () => {
    const r = resolveFlags(await firstCall("git -C /tmp worktree add /tmp/x"));
    expect(r?.cmd).toBe("git");
    expect(r?.flags).toEqual(["-C"]);
    expect(r?.args).toEqual(["worktree", "add", "/tmp/x"]);
  });

  test("git --git-dir space form consumes value", async () => {
    const r = resolveFlags(await firstCall("git --git-dir /repo/.git status"));
    expect(r?.flags).toEqual(["--git-dir"]);
    expect(r?.args).toEqual(["status"]);
  });

  test("git --git-dir=value (= form) needs no special handling", async () => {
    const r = resolveFlags(await firstCall("git --git-dir=/repo/.git status"));
    expect(r?.flags).toEqual(["--git-dir=/repo/.git"]);
    expect(r?.args).toEqual(["status"]);
  });

  test("git -c key=value -C /tmp consumes both value flags in sequence", async () => {
    const r = resolveFlags(await firstCall("git -c color.ui=auto -C /tmp status"));
    expect(r?.flags).toEqual(["-c", "-C"]);
    expect(r?.args).toEqual(["status"]);
  });

  test("docker -H consumes its host value", async () => {
    const r = resolveFlags(await firstCall("docker -H tcp://prod:2375 run nginx"));
    expect(r?.cmd).toBe("docker");
    expect(r?.flags).toEqual(["-H"]);
    expect(r?.args).toEqual(["run", "nginx"]);
  });

  test("kubectl --context consumes its value", async () => {
    const r = resolveFlags(await firstCall("kubectl --context prod get pods"));
    expect(r?.flags).toEqual(["--context"]);
    expect(r?.args).toEqual(["get", "pods"]);
  });

  test("kubectl -n consumes its namespace value", async () => {
    const r = resolveFlags(await firstCall("kubectl -n prod delete pod web"));
    expect(r?.flags).toEqual(["-n"]);
    expect(r?.args).toEqual(["delete", "pod", "web"]);
  });

  test("make -C and -f consume their values", async () => {
    const r = resolveFlags(await firstCall("make -C /repo -f Makefile.prod build"));
    expect(r?.flags).toEqual(["-C", "-f"]);
    expect(r?.args).toEqual(["build"]);
  });

  test("tar -C and -f consume their values", async () => {
    const r = resolveFlags(await firstCall("tar -C /target -f archive.tar -x"));
    expect(r?.flags).toEqual(["-C", "-f", "-x"]);
    expect(r?.args).toEqual([]);
  });

  test("xargs -I and -n consume their values (inner-cmd boundary not detected)", async () => {
    // resolveFlags consumes the value of `-I` (`{}`) and `-n` (`1`),
    // then treats the rest as ordinary tokens — it has no knowledge of
    // xargs's "the rest is the command to run" convention, so `-rf`
    // gets expanded as combined short flags. Consumers wanting the
    // inner-cmd-as-a-unit shape should locate the first non-flag arg
    // and slice from there themselves.
    const r = resolveFlags(await firstCall("xargs -I {} -n 1 rm -rf"));
    expect(r?.flags).toEqual(["-I", "-n", "-r", "-f"]);
    expect(r?.args).toEqual(["rm"]);
  });

  test("dynamic value of a value-flag is consumed (not pushed to args)", async () => {
    const r = resolveFlags(await firstCall('git -C "$DIR" worktree add'));
    expect(r?.flags).toEqual(["-C"]);
    expect(r?.args).toEqual(["worktree", "add"]);
  });

  test("value-taking flag at end with no value: flag is kept; nothing to consume", async () => {
    const r = resolveFlags(await firstCall("git -C"));
    expect(r?.flags).toEqual(["-C"]);
    expect(r?.args).toEqual([]);
  });

  test("plain `git push` (no global flag) is unchanged from pre-fix behavior", async () => {
    const r = resolveFlags(await firstCall("git push --force origin main"));
    expect(r?.flags).toEqual(["--force"]);
    expect(r?.args).toEqual(["push", "origin", "main"]);
  });

  test("unlisted tool falls back to legacy boolean-flag behavior", async () => {
    const r = resolveFlags(await firstCall("frobnicate -X /tmp do-the-thing"));
    expect(r?.cmd).toBe("frobnicate");
    expect(r?.flags).toEqual(["-X"]);
    expect(r?.args).toEqual(["/tmp", "do-the-thing"]);
  });
});

describe("GLOBAL_VALUE_FLAGS — agent-critical tools (v0.8.0)", () => {
  test("aws --region consumes its value; args[0] is s3", async () => {
    const r = resolveFlags(
      await firstCall("aws --region us-east-1 s3 rm s3://b --recursive")
    );
    expect(r?.cmd).toBe("aws");
    expect(r?.flags).toEqual(["--region", "--recursive"]);
    expect(r?.args).toEqual(["s3", "rm", "s3://b"]);
    expect(r?.args[0]).toBe("s3");
  });

  test("gcloud --project consumes its value; args[0] is compute", async () => {
    const r = resolveFlags(
      await firstCall("gcloud --project p compute instances delete x")
    );
    expect(r?.cmd).toBe("gcloud");
    expect(r?.flags).toEqual(["--project"]);
    expect(r?.args).toEqual(["compute", "instances", "delete", "x"]);
    expect(r?.args[0]).toBe("compute");
  });

  test("terraform -chdir= form (= form); args[0] is apply", async () => {
    const r = resolveFlags(await firstCall("terraform -chdir=/tf apply -auto-approve"));
    expect(r?.cmd).toBe("terraform");
    expect(r?.flags).toEqual(["-chdir=/tf", "-auto-approve"]);
    expect(r?.args).toEqual(["apply"]);
    expect(r?.args[0]).toBe("apply");
  });

  test("terraform -chdir space form consumes /tf; args[0] is apply", async () => {
    const r = resolveFlags(await firstCall("terraform -chdir /tf apply"));
    expect(r?.cmd).toBe("terraform");
    expect(r?.flags).toEqual(["-chdir"]);
    expect(r?.flagValues).toEqual({ "-chdir": ["/tf"] });
    expect(r?.args).toEqual(["apply"]);
    expect(r?.args[0]).toBe("apply");
  });

  test("npm --prefix consumes its value; args[0] is run", async () => {
    const r = resolveFlags(await firstCall("npm --prefix /app run build"));
    expect(r?.cmd).toBe("npm");
    expect(r?.flags).toEqual(["--prefix"]);
    expect(r?.args).toEqual(["run", "build"]);
    expect(r?.args[0]).toBe("run");
  });

  test("cargo --config consumes its value; args[0] is run", async () => {
    const r = resolveFlags(
      await firstCall("cargo --config net.offline=true run --release")
    );
    expect(r?.cmd).toBe("cargo");
    expect(r?.flags).toEqual(["--config", "--release"]);
    expect(r?.flagValues).toEqual({ "--config": ["net.offline=true"] });
    expect(r?.args).toEqual(["run"]);
    expect(r?.args[0]).toBe("run");
  });

  test("gh -R consumes its value; args[0] is pr", async () => {
    const r = resolveFlags(await firstCall("gh -R owner/repo pr merge 123"));
    expect(r?.cmd).toBe("gh");
    expect(r?.flags).toEqual(["-R"]);
    expect(r?.args).toEqual(["pr", "merge", "123"]);
    expect(r?.args[0]).toBe("pr");
  });

  test("sudo aws --region; inner args[0] is s3", async () => {
    const u = unwrapCall(await firstCall("sudo aws --region eu-west-1 s3 rm s3://b"));
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    expect(u.wrapper).toBe("sudo");
    expect(u.cmd).toBe("aws");
    expect(u.flags).toEqual(["--region"]);
    expect(u.args).toEqual(["s3", "rm", "s3://b"]);
    expect(u.args[0]).toBe("s3");
  });
});

describe("BUG-000: wrapper unwrap inherits the table on the inner call", () => {
  test("sudo git -C /tmp worktree add — inner git uses git's table", async () => {
    const u = unwrapCall(await firstCall("sudo git -C /tmp worktree add /tmp/x"));
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    expect(u.wrapper).toBe("sudo");
    expect(u.cmd).toBe("git");
    expect(u.flags).toEqual(["-C"]);
    expect(u.args).toEqual(["worktree", "add", "/tmp/x"]);
  });

  test("doas docker -H tcp://… run — inner docker uses docker's table", async () => {
    const u = unwrapCall(await firstCall("doas docker -H tcp://prod:2375 run nginx"));
    expect(u?.kind).toBe("wrapped");
    if (u?.kind !== "wrapped") return;
    expect(u.wrapper).toBe("doas");
    expect(u.cmd).toBe("docker");
    expect(u.flags).toEqual(["-H"]);
    expect(u.args).toEqual(["run", "nginx"]);
  });

  test("bash -c reaches inner script unchanged; table applies on re-parse", async () => {
    // The wrapped-script kind exposes the inner script as a string.
    // Consumers re-parse it with parse() to apply rules — at which
    // point the table fires on the inner git/docker/etc.
    const u = unwrapCall(await firstCall('bash -c "git -C /tmp worktree add"'));
    expect(u?.kind).toBe("wrapped-script");
    if (u?.kind !== "wrapped-script") return;
    expect(u.script).toBe("git -C /tmp worktree add");
    const inner = resolveFlags(await firstCall(u.script));
    expect(inner?.flags).toEqual(["-C"]);
    expect(inner?.args).toEqual(["worktree", "add"]);
  });
});
