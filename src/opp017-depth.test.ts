import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";
import {
  createTaskWorktrees,
  executeOrchestrationPlan,
  forecastIntegration,
  type OrchestrationPlan,
} from "./orchestration.js";

function gitRepo(): { root: string; aiw: string; git: (args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "aiw-opp017-"));
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@e.c"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(root, "README.md"), "line1\nline2\nline3\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  const aiw = join(root, ".aiw");
  mkdirSync(aiw, { recursive: true });
  return { root, aiw, git };
}

function commitIn(worktree: string, file: string, content: string): void {
  writeFileSync(join(worktree, file), content);
  execFileSync("git", ["-C", worktree, "add", "."], { stdio: ["ignore", "ignore", "ignore"] });
  execFileSync("git", ["-C", worktree, "commit", "-qm", "task work"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
}

const PLAN: OrchestrationPlan = {
  schema: 1,
  id: "depth-plan",
  tasks: [
    { id: "TASK-001", agent: "codex", prompt: "a", dependsOn: [] },
    { id: "TASK-002", agent: "codex", prompt: "b", dependsOn: [] },
    { id: "TASK-003", agent: "codex", prompt: "c", dependsOn: ["TASK-001"] },
  ],
};

describe("OPP-017 orchestration depth", () => {
  it("records durationMs, diffStat and wallClock evidence", async () => {
    const { root, aiw } = gitRepo();
    const worktrees = createTaskWorktrees(root, aiw, PLAN);
    const entry = worktrees.get("TASK-001")!;
    execFileSync("git", ["-C", entry.worktree, "config", "user.email", "t@e.c"]);
    execFileSync("git", ["-C", entry.worktree, "config", "user.name", "t"]);
    commitIn(entry.worktree, "feature-a.ts", "export const a = 1;\n");
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
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
    expect(first.diffStat).toContain("feature-a.ts");
  }, 20000);

  it("forecast reports wave order and clean merges for committed task branches", async () => {
    const { root, aiw } = gitRepo();
    const worktrees = createTaskWorktrees(root, aiw, PLAN);
    execFileSync("git", ["config", "user.email", "t@e.c"]);
    execFileSync("git", ["config", "user.name", "t"]);
    for (const [taskId, file] of [
      ["TASK-001", "feature-a.ts"],
      ["TASK-002", "feature-b.ts"],
      ["TASK-003", "feature-c.ts"],
    ] as const) {
      const entry = worktrees.get(taskId)!;
      commitIn(entry.worktree, file, `export const x = 1;\n`);
    }
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
    const forecast = forecastIntegration(root, PLAN, results);
    expect(forecast).toHaveLength(3);
    expect(forecast.map((line) => line.wave)).toEqual([1, 1, 2]);
    expect(forecast.every((line) => line.state === "clean" || line.state === "identical")).toBe(
      true,
    );
  });

  it("forecast reports conflicts when the target diverges on the same file", async () => {
    const { root, aiw, git } = gitRepo();
    const worktrees = createTaskWorktrees(root, aiw, PLAN);
    execFileSync("git", ["config", "user.email", "t@e.c"]);
    execFileSync("git", ["config", "user.name", "t"]);
    const entry = worktrees.get("TASK-001")!;
    commitIn(entry.worktree, "README.md", "changed by task\n");
    // the target branch also changes README.md after the worktree branched
    writeFileSync(join(root, "README.md"), "changed by main\n");
    git(["add", "."]);
    git(["commit", "-qm", "main change"]);
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
    const forecast = forecastIntegration(root, PLAN, results);
    const conflicting = forecast.find((line) => line.taskId === "TASK-001");
    expect(conflicting?.state).toBe("conflict");
  });

  it("doctor reports leaked managed worktrees with the cleanup continuation", async () => {
    const { root } = gitRepo();
    await run(["install"], cwd(root));
    createTaskWorktrees(root, join(root, ".aiw"), PLAN);
    const doctor = await run(["doctor"], root);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.error).toContain("[reason: worktrees_leaked]");
    expect(doctor.error).toContain("orchestrate --cleanup --execute");
    const cleaned = await run(["orchestrate", "--cleanup", "--execute"], root);
    expect(cleaned.exitCode).toBe(0);
    expect((await run(["doctor"], root)).exitCode).toBe(0);
  });

  it("aiw orchestrate integrate names conflicts in the checkpointed plan", async () => {
    const { root, git } = gitRepo();
    writeFileSync(
      join(root, "plan.yml"),
      `schema: 1\nid: depth-cli\ntasks:\n  - id: TASK-001\n    agent: codex\n    prompt: "conflicting work"\n    depends_on: []\n`,
    );
    await run(["install"], cwd(root));
    const execute = await run(["orchestrate", "--plan=plan.yml", "--execute", "--isolate"], root, {
      orchestrator: {
        async run(task) {
          // the adapter commits inside its isolated worktree
          commitIn(task.worktree!, "README.md", "changed by task\n");
          return { success: true, detail: `ran in ${task.worktree ?? "main"}` };
        },
      },
    });
    expect(execute.exitCode, execute.error ?? "").toBe(0);
    // main diverges on the same file after the plan ran
    writeFileSync(join(root, "README.md"), "changed by main after plan\n");
    git(["add", "."]);
    git(["commit", "-qm", "main diverges"]);
    const integrate = await run(["orchestrate", "integrate", "--plan=plan.yml"], root);
    expect(integrate.exitCode).toBe(1);
    expect(integrate.output).toContain("CONFLICTS");
    expect(integrate.output).toContain("conflicts: 1");
    // nothing was merged: README.md on main is still the main version
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("changed by main after plan");
  });

  it("integrate without a checkpoint fails with the typed continuation", async () => {
    const { root } = gitRepo();
    writeFileSync(
      join(root, "plan.yml"),
      `schema: 1\nid: never-ran\ntasks:\n  - id: TASK-001\n    agent: codex\n    prompt: "never executed"\n    depends_on: []\n`,
    );
    await run(["install"], cwd(root));
    const result = await run(["orchestrate", "integrate", "--plan=plan.yml"], root);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: orchestration_not_executed]");
  });
});

function cwd(root: string): string {
  return root;
}
