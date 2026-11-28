import { describe, expect, it, vi } from "vitest";
import { createCliOrchestrator, DEFAULT_CLI_HARNESSES } from "./orchestration-cli-runner.js";
import type { OrchestrationTask } from "./orchestration.js";

function task(overrides: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    id: "TASK-001",
    agent: "codex",
    prompt: "Implement feature $(rm -rf /)",
    dependsOn: [],
    ...overrides,
  };
}

describe("CLI orchestration runner", () => {
  it.each([
    ["codex", "codex", ["exec", "Implement feature $(rm -rf /)"]],
    ["claude", "claude", ["-p", "Implement feature $(rm -rf /)"]],
    ["gemini", "gemini", ["-p", "Implement feature $(rm -rf /)"]],
    ["antigravity", "agy", ["-p", "Implement feature $(rm -rf /)"]],
  ] as const)(
    "invokes %s via execFile argv without shell interpolation and honors task.worktree",
    async (agent, expectedBin, expectedArgs) => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "Done cleanly\n", stderr: "" }));
      const orchestrator = createCliOrchestrator({ root: "/repo", timeoutMs: 12_000, exec });
      const result = await orchestrator.run(task({ agent, worktree: "/repo/.aiw/worktrees/p/t1" }));
      expect(result).toEqual({ success: true, detail: "Done cleanly" });
      expect(exec).toHaveBeenCalledWith(expectedBin, expectedArgs, {
        cwd: "/repo/.aiw/worktrees/p/t1",
        timeoutMs: 12_000,
      });
    },
  );

  it("falls back to project root when task.worktree is unset", async () => {
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const orchestrator = createCliOrchestrator({ root: "/repo", exec });
    const result = await orchestrator.run(task({ agent: "claude" }));
    expect(result).toEqual({ success: true, detail: "TASK-001 completed by claude." });
    expect(exec).toHaveBeenCalledWith(
      DEFAULT_CLI_HARNESSES.claude.command,
      ["-p", "Implement feature $(rm -rf /)"],
      { cwd: "/repo", timeoutMs: 300_000 },
    );
  });

  it("reports missing harness binary, timeouts, and non-zero exits cleanly", async () => {
    const missing = createCliOrchestrator({
      root: "/repo",
      exec: async () => ({ exitCode: 127, stdout: "", stderr: "", notFound: true }),
    });
    expect(await missing.run(task({ agent: "antigravity" }))).toEqual({
      success: false,
      detail: "CLI harness 'agy' is not installed or not on PATH.",
    });

    const timedOut = createCliOrchestrator({
      root: "/repo",
      timeoutMs: 5_000,
      exec: async () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: true }),
    });
    expect(await timedOut.run(task({ agent: "gemini" }))).toEqual({
      success: false,
      detail: "Timed out after 5000ms running gemini.",
    });

    const failed = createCliOrchestrator({
      root: "/repo",
      exec: async () => ({ exitCode: 2, stdout: "", stderr: "\n  auth token missing  \nstack" }),
    });
    expect(await failed.run(task({ agent: "codex" }))).toEqual({
      success: false,
      detail: "auth token missing",
    });
  });
});
