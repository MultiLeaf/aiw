import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, pathPatternMatches } from "./policy-gate.js";

async function gitProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-paths-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "t"], { cwd, stdio: "ignore" });
  return cwd;
}

async function commit(cwd: string, file: string, content: string): Promise<void> {
  await mkdir(join(cwd, file, ".."), { recursive: true });
  await writeFile(join(cwd, file), content);
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", file], { cwd, stdio: "ignore" });
}

describe("path pattern semantics", () => {
  it("prefix * matches descendants, exact otherwise", () => {
    expect(pathPatternMatches("src/auth/*", "src/auth/login.ts")).toBe(true);
    expect(pathPatternMatches("src/auth/*", "src/auth/deep/session.ts")).toBe(true);
    expect(pathPatternMatches("src/auth/*", "src/billing/pay.ts")).toBe(false);
    expect(pathPatternMatches("docs/readme.md", "docs/readme.md")).toBe(true);
    expect(pathPatternMatches("docs/readme.md", "docs/other.md")).toBe(false);
  });
});

describe("changedPaths (REQ-002)", () => {
  it("collects committed, uncommitted, and untracked paths in a git repo", async () => {
    const cwd = await gitProject();
    await commit(cwd, "base.txt", "base\n");
    await commit(cwd, "src/auth/login.ts", "auth\n");
    // Uncommitted modification + untracked file.
    await writeFile(join(cwd, "src/auth/login.ts"), "auth changed\n");
    await mkdir(join(cwd, "src/billing"), { recursive: true });
    await writeFile(join(cwd, "src/billing/pay.ts"), "pay\n");

    const paths = changedPaths(cwd);
    expect(paths).toBeDefined();
    expect(paths).toContain("src/auth/login.ts");
    expect(paths).toContain("src/billing/pay.ts");
    expect(paths).not.toContain("base.txt");
  });

  it("returns undefined outside a git repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-nogit-"));
    expect(changedPaths(cwd)).toBeUndefined();
  });
});
