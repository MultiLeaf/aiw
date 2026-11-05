import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectGitSummary, summarizeGitLog } from "./git.js";
import type { ShellResult } from "../eval/scenarios.js";
import { run } from "../cli.js";

const LOG = [
  "@@feat: add service",
  "src/main/java/Service.java",
  "src/main/java/Util.java",
  "",
  "@@fix: service crash",
  "src/main/java/Service.java",
  "",
  "@@feat: extend service",
  "src/main/java/Service.java",
  "docs/guide.md",
  "",
  "@@chore: deps",
  "package.json",
  "",
].join("\n");

describe("git log summarizer", () => {
  it("derives commit-type ratios, top paths and hotspots deterministically", () => {
    const summary = summarizeGitLog(LOG);
    expect(summary.available).toBe(true);
    expect(summary.commitTypeRatio).toEqual({ feat: 0.5, fix: 0.25, chore: 0.25 });
    expect(summary.topPaths).toEqual([
      "src/main/java/Service.java",
      "docs/guide.md",
      "package.json",
      "src/main/java/Util.java",
    ]);
    expect(summary.hotspots).toEqual(["src/main/java", "docs"]);
  });

  it("breaks ties alphabetically and caps lists at five entries", () => {
    const log = [
      "@@feat: a",
      "b.txt",
      "a.txt",
      "",
      "@@feat: b",
      "c.txt",
      "b.txt",
      "",
      "@@feat: c",
      "d.txt",
      "e.txt",
      "f.txt",
      "g.txt",
      "h.txt",
      "",
    ].join("\n");
    const summary = summarizeGitLog(log);
    expect(summary.topPaths[0]).toBe("b.txt");
    expect(summary.topPaths).toHaveLength(5);
  });

  it("buckets non-conventional subjects as other", () => {
    const summary = summarizeGitLog("@@plain subject\na.txt\n");
    expect(summary.commitTypeRatio).toEqual({ other: 1 });
  });

  it("returns unavailable when git cannot run (repo without git)", async () => {
    const runner = async (): Promise<ShellResult> => ({
      exitCode: 128,
      stdout: "",
      stderr: "no git",
    });
    expect(await collectGitSummary("/tmp/xyz", runner)).toBeUndefined();
  });

  it("collects a summary through an injected runner", async () => {
    const runner = async (): Promise<ShellResult> => ({ exitCode: 0, stdout: LOG, stderr: "" });
    const summary = await collectGitSummary("/repo", runner);
    expect(summary?.topPaths[0]).toBe("src/main/java/Service.java");
  });
});

const gitWorks = (): boolean => {
  try {
    execFileSync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
};

describe("aiw evaluate git integration", () => {
  it.skipIf(!gitWorks)("feeds git facts into the bundle from a real repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-git-"));
    const git = (args: string[]): Buffer =>
      execFileSync("git", args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
    git(["init", "--quiet"]);
    git([
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "feat: first",
      "--quiet",
    ]);
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "app.py"), "x = 1\n");
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "fix: app", "--quiet"]);
    const result = await run(["evaluate"], cwd);
    expect(result.exitCode).toBe(0);
    const signals = readFileSync(join(cwd, ".aiw/eval/signals.yml"), "utf8");
    expect(signals).toContain("git.top-path");
    expect(signals).toContain("git.commit-ratio.fix");
    expect(signals).not.toContain("git-history-unavailable");
    expect(existsSync(join(cwd, ".aiw/eval/brief.md"))).toBe(true);
  });
});
