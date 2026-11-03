import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";
import {
  createTaskWorktrees,
  executeOrchestrationPlan,
  listManagedWorktrees,
  removeWorktrees,
  type OrchestrationPlan,
} from "./orchestration.js";

function gitRepo(): { root: string; aiw: string; git: (args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "aiw-opp010-"));
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@e.c"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(root, "README.md"), "# project\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  const aiw = join(root, ".aiw");
  mkdirSync(aiw, { recursive: true });
  return { root, aiw, git };
}

const PLAN: OrchestrationPlan = {
  schema: 1,
  id: "iso-plan",
  tasks: [
    { id: "TASK-001", agent: "codex", prompt: "first", dependsOn: [] },
    { id: "TASK-002", agent: "codex", prompt: "second", dependsOn: [] },
  ],
};

describe("OPP-010 worktree isolation", () => {
  it("creates branch-per-task worktrees and hands their path to the adapter", async () => {
    const { root, aiw, git } = gitRepo();
    const worktrees = createTaskWorktrees(root, aiw, PLAN);
    expect(worktrees.size).toBe(2);
    const paths = [...worktrees.values()].map((entry) => entry.worktree);
    for (const path of paths) expect(existsSync(path)).toBe(true);
    expect(git(["worktree", "list"])).toContain("aiw/iso-plan/TASK-001");

    const seenWorktrees: (string | undefined)[] = [];
    await executeOrchestrationPlan(
      PLAN,
      {
        async run(task) {
          seenWorktrees.push(task.worktree);
          return { success: true, detail: "ok" };
        },
      },
      2,
      { options: { root, aiw, planId: PLAN.id }, worktrees },
    );
    // each adapter invocation received its own worktree path
    expect(
      seenWorktrees.every((path) => path && path.includes(join(".aiw", "worktrees", "iso-plan"))),
    ).toBe(true);
    expect(new Set(seenWorktrees).size).toBe(2);
  });

  it("records base and final commit evidence for isolated tasks", async () => {
    const { root, aiw } = gitRepo();
    const worktrees = createTaskWorktrees(root, aiw, PLAN);
    const entry = worktrees.get("TASK-001")!;
    // simulate the adapter committing inside the worktree
    execFileSync("git", ["-C", entry.worktree, "config", "user.email", "t@e.c"]);
    execFileSync("git", ["-C", entry.worktree, "config", "user.name", "t"]);
    writeFileSync(join(entry.worktree, "feature.txt"), "work\n");
    execFileSync("git", ["-C", entry.worktree, "add", "."]);
    execFileSync("git", ["-C", entry.worktree, "commit", "-qm", "task work"]);
    const results = await executeOrchestrationPlan(
      PLAN,
      {
        async run() {
          return { success: true, detail: "ok" };
        },
      },
      2,
      { options: { root, aiw, planId: PLAN.id }, worktrees },
    );
    const first = results.find((result) => result.id === "TASK-001")!;
    expect(first.worktree).toBe(entry.worktree);
    expect(first.baseCommit).toBe(entry.baseCommit);
    expect(first.finalCommit).not.toBe(entry.baseCommit);
  });

  it("lists and removes managed worktrees (cleanup)", () => {
    const { root, aiw } = gitRepo();
    const worktrees = createTaskWorktrees(root, aiw, PLAN);
    expect(listManagedWorktrees(root, aiw).length).toBe(2);
    removeWorktrees(
      root,
      [...worktrees.values()].map((entry) => entry.worktree),
      { force: true },
    );
    expect(listManagedWorktrees(root, aiw).length).toBe(0);
    for (const entry of worktrees.values()) expect(existsSync(entry.worktree)).toBe(false);
  });

  it("exposes --isolate through the CLI with an injected adapter (e2e)", async () => {
    const { root } = gitRepo();
    writeFileSync(
      join(root, "plan.yml"),
      `schema: 1\nid: cli-iso\ntasks:\n  - id: TASK-001\n    agent: codex\n    prompt: "work in isolation"\n    depends_on: []\n`,
    );
    await run(["install"], cwd(root));
    const seen: string[] = [];
    const result = await run(["orchestrate", "--plan=plan.yml", "--execute", "--isolate"], root, {
      orchestrator: {
        async run(task) {
          seen.push(task.worktree ?? "no-worktree");
          return { success: true, detail: "done" };
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe("no-worktree");
    // success cleanup removed the worktree; the checkpoint kept the evidence
    const checkpoint = await readFile(
      join(root, ".aiw", "checkpoints", "orchestration-cli-iso.yml"),
      "utf8",
    );
    expect(checkpoint).toContain("worktree:");
    expect(checkpoint).toContain("baseCommit:");
    expect(existsSync(seen[0])).toBe(false);
  });

  it("keeps failed-task worktrees for diagnosis", async () => {
    const { root } = gitRepo();
    writeFileSync(
      join(root, "plan.yml"),
      `schema: 1\nid: cli-iso-fail\ntasks:\n  - id: TASK-001\n    agent: codex\n    prompt: "will fail"\n    depends_on: []\n`,
    );
    await run(["install"], cwd(root));
    const result = await run(["orchestrate", "--plan=plan.yml", "--execute", "--isolate"], root, {
      orchestrator: {
        async run(task) {
          return { success: false, detail: `failed in ${task.worktree}` };
        },
      },
    });
    expect(result.exitCode).toBe(1);
    const checkpoint = await readFile(
      join(root, ".aiw", "checkpoints", "orchestration-cli-iso-fail.yml"),
      "utf8",
    );
    const kept = /worktree: "?([^"\n]+)"?/.exec(checkpoint)?.[1];
    expect(kept).toBeDefined();
    expect(existsSync(kept!)).toBe(true);
  });
});

function cwd(root: string): string {
  return root;
}
