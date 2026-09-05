import { describe, expect, it, vi } from "vitest";
import {
  executeOrchestrationPlan,
  orchestrationWaves,
  parseOrchestrationPlan,
  serializeOrchestrationPreview,
  serializeOrchestrationResults,
  type OrchestrationPlan,
} from "./orchestration.js";

const content = `schema: 1
id: release-readiness
tasks:
  - id: TASK-001
    agent: codex
    prompt: "Implement the change."
    depends_on: []
  - id: TASK-002
    agent: claude
    prompt: "Review quality."
    depends_on: [TASK-001]
  - id: TASK-003
    agent: codex
    prompt: "Review security."
    depends_on: [TASK-001]
`;

describe("multi-agent orchestration", () => {
  it("parses a strict plan and creates deterministic parallel waves", () => {
    const plan = parseOrchestrationPlan(content);
    expect(orchestrationWaves(plan)).toEqual([["TASK-001"], ["TASK-002", "TASK-003"]]);
    expect(serializeOrchestrationPreview(plan)).toBe(
      "schema: 1\nplan: release-readiness\nwaves:\n  - index: 1\n    tasks: [TASK-001]\n  - index: 2\n    tasks: [TASK-002, TASK-003]\n",
    );
  });

  it("accepts portable CRLF plans without changing their meaning", () => {
    expect(parseOrchestrationPlan(content.replaceAll("\n", "\r\n"))).toEqual(
      parseOrchestrationPlan(content),
    );
  });

  it("executes independent work concurrently and preserves plan order", async () => {
    const active: string[] = [];
    let peak = 0;
    const run = vi.fn(async (task: { id: string }) => {
      active.push(task.id);
      peak = Math.max(peak, active.length);
      await Promise.resolve();
      active.splice(active.indexOf(task.id), 1);
      return { success: true, detail: `${task.id} complete` };
    });
    const plan = parseOrchestrationPlan(content);
    const results = await executeOrchestrationPlan(plan, { run }, 2);
    expect(peak).toBe(2);
    expect(results.map(({ id, status }) => [id, status])).toEqual([
      ["TASK-001", "passed"],
      ["TASK-002", "passed"],
      ["TASK-003", "passed"],
    ]);
    expect(serializeOrchestrationResults(plan, results)).toContain("status: passed");
  });

  it("blocks descendants of failed tasks while continuing independent work", async () => {
    const plan: OrchestrationPlan = {
      schema: 1,
      id: "failure",
      tasks: [
        { id: "TASK-001", agent: "codex", prompt: "Fail.", dependsOn: [] },
        { id: "TASK-002", agent: "claude", prompt: "Blocked.", dependsOn: ["TASK-001"] },
        { id: "TASK-003", agent: "codex", prompt: "Pass.", dependsOn: [] },
      ],
    };
    const run = vi.fn(async (task: { id: string }) => ({
      success: task.id !== "TASK-001",
      detail: task.id === "TASK-001" ? "failed\nunsafe line" : "complete",
    }));
    const results = await executeOrchestrationPlan(plan, { run }, 2);
    expect(results).toEqual([
      { id: "TASK-001", status: "failed", detail: "failed unsafe line" },
      { id: "TASK-002", status: "blocked", detail: "A dependency did not pass." },
      { id: "TASK-003", status: "passed", detail: "complete" },
    ]);
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ id: "TASK-002" }));
  });

  it.each([
    content.replace("schema: 1", "schema: 2"),
    content.replace("TASK-001]", "TASK-999]"),
    content.replace("depends_on: [TASK-001]", "depends_on: [TASK-002]"),
    content.replace("agent: codex", "agent: unknown"),
    content.replace('prompt: "Implement the change."', "prompt: unquoted"),
    content.replace('prompt: "Implement the change."', 'prompt: "Unsafe\\u0000prompt"'),
    content.replace("TASK-003", "TASK-001"),
  ])("rejects invalid plans", (value) => {
    expect(() => parseOrchestrationPlan(value)).toThrow();
  });
});
