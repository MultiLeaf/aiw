import { describe, expect, it } from "vitest";
import {
  FULL_ASSEMBLER,
  materializeParityTask,
  parseParityTask,
  runParitySuite,
  runParityTask,
  serializeParitySuite,
  TASK_ASSEMBLER,
} from "./task-parity.js";

const VALID_TASK = `schema: 1
id: deploy-guardrails
description: Deployment constraints must survive just-in-time retrieval
layers:
  global: "Team conventions: trunk-based development."
  project: "Never deploy on Fridays. Staging endpoint is db-staging.internal."
  task: "Ship the migration with a rollback plan."
critical_facts:
  - Never deploy on Fridays
  - db-staging.internal
completion_markers:
  - rollback plan
`;

describe("task parity", () => {
  it("parses a valid task with layers, facts, and markers", () => {
    const task = parseParityTask(VALID_TASK);
    expect(task.id).toBe("deploy-guardrails");
    expect(task.criticalFacts).toEqual(["Never deploy on Fridays", "db-staging.internal"]);
    expect(task.completionMarkers).toEqual(["rollback plan"]);
  });

  it("rejects invalid ids, empty layers, and tasks without expectations", () => {
    expect(() =>
      parseParityTask(VALID_TASK.replace("id: deploy-guardrails", "id: Bad_Id")),
    ).toThrow(/id/);
    expect(() =>
      parseParityTask(
        VALID_TASK.replace(/layers:[\s\S]*?critical_facts:/, "layers:\ncritical_facts:"),
      ),
    ).toThrow(/non-empty context layer/);
    expect(() =>
      parseParityTask(
        VALID_TASK.replace(
          /critical_facts:[\s\S]*$/,
          "critical_facts: []\ncompletion_markers: []\n",
        ),
      ),
    ).toThrow(/critical fact, completion marker, or required pattern/);
    expect(() => parseParityTask("schema: 2\n")).toThrow(/schema/);
  });

  it("passes when every critical fact survives task retrieval", () => {
    const result = runParityTask(parseParityTask(VALID_TASK));
    expect(result.passed).toBe(true);
    expect(result.factsRetained).toBe(2);
    expect(result.assembledTokens).toBeLessThanOrEqual(result.baselineTokens);
  });

  it("fails and names the exact fact lost when retrieval drops its layer", () => {
    const task = parseParityTask(
      VALID_TASK.replace(
        '  project: "Never deploy on Fridays. Staging endpoint is db-staging.internal."',
        '  session: "Never deploy on Fridays. Staging endpoint is db-staging.internal."',
      ),
    );
    const result = runParityTask(task);
    expect(result.passed).toBe(false);
    expect(result.missingFacts).toEqual(["Never deploy on Fridays", "db-staging.internal"]);
  });

  it("scores a suite and reports failures without gating on cost", () => {
    const passing = parseParityTask(VALID_TASK);
    const failing = parseParityTask(
      VALID_TASK.replace("id: deploy-guardrails", "id: session-only-fact").replace(
        '  project: "Never deploy on Fridays. Staging endpoint is db-staging.internal."',
        '  session: "Never deploy on Fridays."',
      ),
    );
    const suite = runParitySuite([passing, failing]);
    expect(suite.total).toBe(2);
    expect(suite.failed).toBe(1);
    const serialized = serializeParitySuite(suite);
    expect(serialized).toContain("failed: 1");
    expect(serialized).toContain("missing_fact: Never deploy on Fridays");
  });

  it("loads artifact sources and requires every pattern match to survive assembly", () => {
    const artifacts: Record<string, string> = {
      ".aiw/generated/specs/specification.md":
        "# Specification\n\nREQ-001 must do X.\nREQ-002 shall do Y.\nREQ-003 may do Z.\n",
    };
    const task = parseParityTask(
      [
        "schema: 1",
        "id: spec-to-plan",
        "layers:",
        '  task: "Write the implementation plan."',
        "sources:",
        "  project: .aiw/generated/specs/specification.md",
        "required_patterns:",
        "  - 'REQ-\\d+'",
      ].join("\n"),
    );
    const materialized = materializeParityTask(task, (path) => {
      if (!(path in artifacts)) throw new Error(`missing: ${path}`);
      return artifacts[path];
    });
    // The task assembler drops the session layer only; project survives, so all REQ ids pass.
    const result = runParityTask(materialized);
    expect(result.passed).toBe(true);
    expect(result.missingPatterns).toEqual([]);
    // If the spec lands in the session layer instead, every REQ id is lost and named.
    const sessionTask = parseParityTask(
      [
        "schema: 1",
        "id: spec-lost-in-session",
        "layers:",
        '  task: "Write the implementation plan."',
        "sources:",
        "  session: .aiw/generated/specs/specification.md",
        "required_patterns:",
        "  - 'REQ-\\d+'",
      ].join("\n"),
    );
    const lost = runParityTask(materializeParityTask(sessionTask, (path) => artifacts[path]));
    expect(lost.passed).toBe(false);
    expect(lost.missingPatterns).toEqual([
      "REQ-\\d+ -> REQ-001",
      "REQ-\\d+ -> REQ-002",
      "REQ-\\d+ -> REQ-003",
    ]);
  });

  it("rejects unsafe sources and invalid patterns", () => {
    expect(() =>
      parseParityTask(
        VALID_TASK.replace(
          "completion_markers:",
          "sources:\n  project: ../outside/spec.md\ncompletion_markers:",
        ),
      ),
    ).toThrow(/safe project-relative path/);
    expect(() =>
      parseParityTask(
        VALID_TASK.replace(
          "completion_markers:",
          'required_patterns:\n  - "([unclosed"\ncompletion_markers:',
        ),
      ),
    ).toThrow(/invalid required pattern/);
  });

  it("reports a readable error when a source artifact is missing", () => {
    const task = parseParityTask(
      VALID_TASK.replace(
        "completion_markers:",
        "sources:\n  project: .aiw/generated/specs/missing.md\ncompletion_markers:",
      ),
    );
    expect(() =>
      materializeParityTask(task, () => {
        throw new Error("ENOENT");
      }),
    ).toThrow(/cannot read source .*ENOENT/);
  });

  it("accepts an injected assembler so future strategies are scoreable", () => {
    const dropEverything = {
      name: "empty",
      assemble: (): string => "",
    };
    const suite = runParitySuite([parseParityTask(VALID_TASK)], dropEverything);
    expect(suite.failed).toBe(1);
    const identity = {
      name: "identity-full",
      assemble: FULL_ASSEMBLER.assemble,
    };
    expect(runParitySuite([parseParityTask(VALID_TASK)], identity).failed).toBe(0);
    expect(TASK_ASSEMBLER.name).toBe("task-retrieval");
  });
});
