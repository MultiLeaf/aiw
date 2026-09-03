import { describe, expect, it } from "vitest";
import { buildTraceabilityGraph, serializeTraceabilityGraph } from "./traceability.js";

describe("traceability graph", () => {
  it("links each requirement to decisions, tasks, code, tests, and evidence", () => {
    const graph = buildTraceabilityGraph({
      specification: "# Spec\n\nREQ-001\n\nREQ-002\n",
      plan: `# Plan

- TASK-001
  - Requirement: REQ-001
  - Code: src/workflow.ts
  - Tests: src/workflow.test.ts
  - Evidence: npm run check
`,
      decisions: [{ id: "ADR-007", content: "Related requirements: REQ-001" }],
    });

    expect(graph.links[0]).toEqual({
      requirement: "REQ-001",
      decisions: ["ADR-007"],
      tasks: ["TASK-001"],
      code: ["src/workflow.ts"],
      tests: ["src/workflow.test.ts"],
      evidence: ["npm run check"],
    });
    expect(graph.links[1]).toEqual({
      requirement: "REQ-002",
      decisions: [],
      tasks: [],
      code: [],
      tests: [],
      evidence: [],
    });
  });

  it("serializes deterministically and can select one requirement", () => {
    const graph = buildTraceabilityGraph({
      specification: "REQ-002 REQ-001 REQ-001",
      plan: "TASK-002\nRequirement: REQ-002\nEvidence: test output",
      decisions: [],
    });

    expect(serializeTraceabilityGraph(graph)).toBe(serializeTraceabilityGraph(graph));
    expect(serializeTraceabilityGraph(graph, "REQ-002")).toContain("requirement: REQ-002");
    expect(serializeTraceabilityGraph(graph, "REQ-002")).not.toContain("REQ-001");
    expect(() => serializeTraceabilityGraph(graph, "REQ-999")).toThrow(
      "Requirement not found: REQ-999",
    );
  });
});
