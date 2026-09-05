import { describe, expect, it, vi } from "vitest";
import { runCommand } from "./workflow.js";
import { memoryFileSystem } from "./fixtures/plugin-files.js";

const plan = `schema: 1
id: review
tasks:
  - id: TASK-001
    agent: codex
    prompt: "Implement."
    depends_on: []
  - id: TASK-002
    agent: claude
    prompt: "Review."
    depends_on: [TASK-001]
`;

function project(content = plan): ReturnType<typeof memoryFileSystem> {
  return memoryFileSystem({
    "/project/.aiw/manifest.yml": "schema: 1\ntarget:\n  active: codex\n",
    "/project/orchestration.yml": content,
  });
}

describe("orchestration workflow", () => {
  it("previews without mutation and executes only with explicit consent", async () => {
    const fs = project();
    const before = fs.snapshot();
    const preview = await runCommand(["orchestrate", "--plan=orchestration.yml"], "/project", fs);
    expect(preview.exitCode).toBe(0);
    expect(preview.output).toContain("tasks: [TASK-001]");
    expect(fs.snapshot()).toEqual(before);

    const run = vi.fn(async () => ({ success: true, detail: "complete" }));
    const executed = await runCommand(
      ["orchestrate", "--plan=orchestration.yml", "--execute", "--max-parallel=2"],
      "/project",
      fs,
      { orchestrator: { run } },
    );
    expect(executed.exitCode).toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(fs.read("/project/.aiw/checkpoints/orchestration-review.yml")).toContain(
      "status: passed",
    );
    const checkpoint = fs.snapshot();
    expect(
      (
        await runCommand(["orchestrate", "--plan=orchestration.yml", "--execute"], "/project", fs, {
          orchestrator: { run },
        })
      ).error,
    ).toContain("checkpoint already exists");
    expect(fs.snapshot()).toEqual(checkpoint);
  });

  it("records failures and blocks dependent work", async () => {
    const fs = project();
    const run = vi.fn(async () => ({ success: false, detail: "failed" }));
    const result = await runCommand(
      ["orchestrate", "--plan=orchestration.yml", "--execute"],
      "/project",
      fs,
      { orchestrator: { run } },
    );
    expect(result.exitCode).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.read("/project/.aiw/checkpoints/orchestration-review.yml")).toContain(
      "status: blocked",
    );
  });

  it("rejects invalid options and plans without changing state", async () => {
    for (const args of [
      ["orchestrate"],
      ["orchestrate", "--plan=../outside"],
      ["orchestrate", "--plan=orchestration.yml", "--execute", "--execute"],
      ["orchestrate", "--plan=orchestration.yml", "--execute", "--max-parallel=0"],
    ]) {
      const fs = project();
      const before = fs.snapshot();
      expect(
        (await runCommand(args, "/project", fs, { orchestrator: { run: vi.fn() } })).exitCode,
      ).toBe(1);
      expect(fs.snapshot()).toEqual(before);
    }
  });
});
