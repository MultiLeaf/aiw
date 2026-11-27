import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";
import {
  advanceWorkflowTo,
  project,
  syncWithApproval,
  writeArtifact,
} from "./fixtures/cli-test-helpers.js";

describe("AI Workflow CLI — SDD workflow and gates", () => {
  it("creates an English brainstorming artifact with required sections", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "brainstorming");
    const result = await run(["brainstorm", "--title=Portable Workflow"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(
      join(cwd, ".aiw/generated/specs/test-workflow/brainstorm.md"),
      "utf8",
    );
    expect(artifact).toContain("# Portable Workflow");
    for (const section of [
      "Goal",
      "Users",
      "Assumptions",
      "Hypotheses",
      "Constraints",
      "Risks",
      "Open Questions",
    ])
      expect(artifact).toContain(`## ${section}`);
  });

  it("creates a specification with stable requirement IDs and acceptance criteria", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "specification");
    const result = await run(["spec", "--title=Workflow Specification"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(
      join(cwd, ".aiw/generated/specs/test-workflow/specification.md"),
      "utf8",
    );
    expect(artifact).toContain("# Workflow Specification");
    expect(artifact).toContain("REQ-001");
    expect(artifact).toContain("Acceptance criteria");
    expect(artifact).toContain("Given");
    expect(artifact).toContain("When");
    expect(artifact).toContain("Then");
    expect(artifact).toContain("## Constraints");
    expect(artifact).toContain("## Open Questions");
  });

  it("creates an ADR with a default unix-time id that never collides", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "technical-design");
    const first = await run(["adr", "--title=First decision"], cwd);
    expect(first.exitCode).toBe(0);
    const match = /ADR-(\d{13})-first-decision\.md$/.exec(first.output);
    expect(match).toBeTruthy();
    // A second ADR created immediately still gets a distinct id (ms precision
    // plus a collision scan makes parallel creation safe).
    const second = await run(["adr", "--title=Second decision"], cwd);
    expect(second.exitCode).toBe(0);
    const secondMatch = /ADR-(\d{13})-second-decision\.md$/.exec(second.output);
    expect(secondMatch).toBeTruthy();
    expect(secondMatch![1]).not.toBe(match![1]);
  });

  it("creates an ADR with alternatives, decision, rationale, and links", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "technical-design");
    const result = await run(["adr", "--id=007", "--title=Use Neutral Adapters"], cwd);
    expect(result.exitCode).toBe(0);
    const path = join(cwd, ".context/adrs/ADR-007-use-neutral-adapters.md");
    const artifact = await readFile(path, "utf8");
    expect(artifact).toContain("## Alternatives");
    expect(artifact).toContain("## Decision");
    expect(artifact).toContain("## Rationale");
    expect(artifact).toContain(".aiw/generated/specs/");
  });

  it("creates an implementation plan linked to requirements and validation commands", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "plan");
    const result = await run(["plan", "--title=First Increment"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(
      join(cwd, ".aiw/generated/plans/test-workflow/implementation-plan.md"),
      "utf8",
    );
    expect(artifact).toContain("REQ-001");
    expect(artifact).toContain("TASK-001");
    expect(artifact).toContain("npm run check");
    expect(artifact).toContain("## Risks and Dependencies");
    expect(artifact).toContain("## Completion Evidence");
    expect(artifact).toContain("Code: src/");
    expect(artifact).toContain("Tests: src/**/*.test.ts");
    expect(artifact).toContain("Link code changes, test results, and validation output");
  });

  it("requires an active approved workflow before verification", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["verify"], cwd)).error).toContain("No SDD workflow is active");
    await advanceWorkflowTo(cwd, "verification");
    const result = await run(["verify"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Verification passed");
  });

  it("blocks specification approval when acceptance criteria are incomplete", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "specification");
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      "# Spec\n\nREQ-001\n\nREQ-002\n\nAcceptance criteria\n",
    );
    await writeArtifact(
      cwd,
      ".aiw/generated/plans/test-workflow/implementation-plan.md",
      "# Plan\n\nREQ-001\n\nValidation: npm test\n",
    );
    const result = await run(["gate", "specification"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Given");
  });

  it("creates a queryable requirement traceability artifact", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "traceability");
    const result = await run(["trace"], cwd);
    expect(result.exitCode).toBe(0);
    const trace = await readFile(
      join(cwd, ".aiw/generated/artifacts/test-workflow/traceability.yml"),
      "utf8",
    );
    expect(trace).toContain("requirement: REQ-001");
    expect(trace).toContain("tasks: [TASK-001]");
    expect(trace).toContain("decisions:");
    expect(trace).toContain("code:");
    expect(trace).toContain("tests:");
    expect(trace).toContain("evidence:");
    expect(trace).toContain("npm test");

    const query = await run(["trace", "--requirement=REQ-001"], cwd);
    expect(query.exitCode).toBe(0);
    expect(query.output).toContain("requirement: REQ-001");
    expect((await run(["trace", "--requirement=REQ-999"], cwd)).error).toContain(
      "Requirement not found: REQ-999",
    );
  });

  it("blocks SDD progression until the previous artifact exists", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "plan");
    expect((await run(["gate", "plan"], cwd)).error).toContain("Quality gate blocked");
    await writeArtifact(
      cwd,
      ".aiw/generated/plans/test-workflow/implementation-plan.md",
      "TASK-001\nRequirement: REQ-001\nCode: src/main.ts\nTests: src/main.test.ts\nValidation: npm test\nEvidence: test output\n",
    );
    expect((await run(["gate", "plan"], cwd)).output).toContain("Quality gate passed");
    expect((await run(["gate", "unknown"], cwd)).error).toContain("Usage");
    expect((await run(["gate", "toString"], cwd)).error).toContain("Usage");
  });

  it("persists workflow sessions and requires human approval before stage transitions", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["spec"], cwd)).error).toContain("No SDD workflow is active");
    expect((await run(["workflow", "start", "--id=approval-test"], cwd)).exitCode).toBe(0);

    expect((await run(["spec"], cwd)).error).toContain("brainstorming");
    expect((await run(["skip", "brainstorming", "--reason=Not needed"], cwd)).exitCode).toBe(0);
    expect((await run(["skip", "product-requirements", "--reason=Not needed"], cwd)).exitCode).toBe(
      0,
    );
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/approval-test/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they start setup\nThen setup completes\n",
    );
    expect((await run(["gate", "specification"], cwd)).exitCode).toBe(0);
    expect((await run(["plan"], cwd)).error).toContain("specification");
    expect((await run(["approve", "specification"], cwd)).exitCode).toBe(0);
    await mkdir(join(cwd, ".aiw/generated/reports/approval-test"), { recursive: true });
    await writeArtifact(
      cwd,
      ".aiw/generated/reports/approval-test/technical-design.md",
      "## Context\nNeed\n## Proposed Design\nModule\n## Alternatives\nA or B\n## Interfaces\nAPI\n## Risks\nMigration\n## Validation\nTests\n",
    );
    expect((await run(["gate", "technical-design"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "technical-design"], cwd)).exitCode).toBe(0);
    expect((await run(["plan"], cwd)).exitCode).toBe(0);

    const status = await run(["workflow", "status"], cwd);
    expect(status.output).toContain("Workflow approval-test (active)");
    expect(status.output).toContain("Next action:");
    expect(status.output).toContain("specification: approved");
    expect((await run(["workflow", "complete"], cwd)).error).toContain("implementation");
  });

  it("invalidates downstream approvals when reviewed evidence changes", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=stale-test"], cwd);
    await run(["skip", "brainstorming", "--reason=Not needed"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/stale-test/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they start setup\nThen setup completes\n",
    );
    await run(["gate", "specification"], cwd);
    const specification = join(cwd, ".aiw/generated/specs/stale-test/specification.md");
    await writeFile(specification, `${await readFile(specification, "utf8")}Updated.\n`);
    expect((await run(["approve", "specification"], cwd)).error).toContain("changed after review");
    expect((await run(["workflow", "status"], cwd)).output).toContain("specification: stale");
  });

  it("completes every workflow stage only after its gate and explicit approval", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=full-stage-run"], cwd);

    expect((await run(["approve", "brainstorming"], cwd)).error).toContain(
      "Approval evidence is missing",
    );
    await run(["brainstorm"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/full-stage-run/brainstorm.md",
      "## Goal\nDeliver the feature\n## Users\nProject users\n## Constraints\nExisting APIs\n## Risks\nRegression\n## Non-goals\nUnrelated work\n",
    );
    expect((await run(["gate", "brainstorming"], cwd)).exitCode).toBe(0);
    expect((await run(["spec"], cwd)).error).toContain("awaiting human approval");
    expect((await run(["approve", "brainstorming"], cwd)).exitCode).toBe(0);
    await run(["prd"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/full-stage-run/product-requirements.md",
      "## Problem\nNeed\n## Users\nUsers\n## Outcomes\nOutcome\n## Non-goals\nNone\n## Success Signals\nSignal\n",
    );
    expect((await run(["gate", "product-requirements"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "product-requirements"], cwd)).exitCode).toBe(0);

    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/full-stage-run/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen the feature works\n",
    );
    expect((await run(["gate", "specification"], cwd)).exitCode).toBe(0);
    expect((await run(["plan"], cwd)).error).toContain("specification");
    expect((await run(["approve", "specification"], cwd)).exitCode).toBe(0);

    await mkdir(join(cwd, ".aiw/generated/reports/full-stage-run"), { recursive: true });
    await writeArtifact(
      cwd,
      ".aiw/generated/reports/full-stage-run/technical-design.md",
      "## Context\nRequirement context\n## Proposed Design\nA modular implementation\n## Alternatives\nAlternative A\n## Interfaces\nStable API\n## Risks\nRegression risk\n## Validation\nAutomated tests\n",
    );
    expect((await run(["gate", "technical-design"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "technical-design"], cwd)).exitCode).toBe(0);

    await run(["plan"], cwd);
    expect((await run(["gate", "plan"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "plan"], cwd)).exitCode).toBe(0);
    await writeArtifact(
      cwd,
      ".aiw/generated/reports/full-stage-run/implementation-report.md",
      "## Changed Files\nsrc/feature.ts\n## Tests\nsrc/feature.test.ts\n## Validation\nValidation: npm test → exit 0 (8 passed)\n## Deviations\nNone\n",
    );
    expect((await run(["gate", "implementation"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "implementation"], cwd)).exitCode).toBe(0);
    await writeArtifact(
      cwd,
      ".aiw/generated/reports/full-stage-run/verification-report.md",
      "## Requirements Checked\nREQ-001\n## Checks Passed\nValidation: npm test → exit 0 (8 passed)\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
    );
    expect((await run(["gate", "verification"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "verification"], cwd)).exitCode).toBe(0);
    await writeArtifact(
      cwd,
      ".aiw/generated/reports/full-stage-run/code-review.md",
      "## Scope\nFeature implementation\n## Findings\nNone\n## Checks\nTests and diff reviewed\n## Residual Risks\nNone\n## Decision\nAccept\n",
    );
    expect((await run(["gate", "review"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "review"], cwd)).exitCode).toBe(0);

    expect((await run(["trace"], cwd)).exitCode).toBe(0);
    expect((await run(["gate", "traceability"], cwd)).exitCode).toBe(0);
    expect((await run(["workflow", "complete"], cwd)).error).toContain("traceability");
    expect((await run(["approve", "traceability"], cwd)).exitCode).toBe(0);
    // The PR stage is optional: local-only runs skip it with human acceptance.
    await run(["skip", "pr", "--reason=Local-only test run"], cwd);
    const completion = await run(["workflow", "complete"], cwd);
    expect(completion.exitCode).toBe(0);
    // REQ-005: completion archives the workflow's scoped artifacts.
    expect(completion.output).toContain("Archived");
    expect(
      (
        await stat(
          join(cwd, ".aiw/checkpoints/workflow-full-stage-run-artifacts/specs/specification.md"),
        )
      ).isFile(),
    ).toBe(true);
    // FRIC-003: completion prints a usage summary and writes the report artifact.
    const reportPath = join(cwd, ".aiw/generated/reports/usage-full-stage-run.md");
    expect((await stat(reportPath)).isFile()).toBe(true);
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("No usage recorded");
    expect(report).toContain("usage-sidecar record");
    expect(report).toContain("Cost attribution skipped");
    expect(report).toContain("Stage timeline");
    expect((await run(["workflow", "status"], cwd)).output).toContain(
      "Workflow full-stage-run (complete)",
    );
  });

  it("prints usage totals and writes the completion report for light-lane tasks (FRIC-003)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(
      [
        "usage-sidecar",
        "record",
        "--command=scan",
        "--fresh-input=1000",
        "--output=200",
        "--workflow=FRIC-900",
      ],
      cwd,
    );
    await run(
      ["task", "start", "--ticket=FRIC-900", "--lane=light", "--lane-reason=small work"],
      cwd,
    );
    await run(["task", "evidence", "--validation=npm test passed"], cwd);
    const completed = await run(["workflow", "complete"], cwd);
    expect(completed.exitCode).toBe(0);
    expect(completed.output).toContain("1,200");
    expect(completed.output).toContain("generated/reports/usage-");
    const sessionText = await readFile(join(cwd, ".aiw", "workflow.yml"), "utf8");
    const workflowId = /workflowId: ([0-9a-f-]+)/.exec(sessionText)?.[1];
    expect(workflowId).toBeTruthy();
    const reportPath = join(cwd, `.aiw/generated/reports/usage-${workflowId}.md`);
    expect((await stat(reportPath)).isFile()).toBe(true);
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("total_tokens");
    expect(report).toContain("FRIC-900");
    expect(report).toContain("Cost attribution skipped");
  });

  it("records a human rejection before revising and re-gating the current stage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=rejection-run"], cwd);
    await run(["skip", "brainstorming", "--reason=Scope is already clear"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/rejection-run/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen it works\n",
    );
    await run(["gate", "specification"], cwd);
    expect((await run(["reject", "specification"], cwd)).error).toContain("Usage");
    expect(
      (await run(["reject", "specification", "--reason=Clarify the outcome"], cwd)).exitCode,
    ).toBe(0);
    expect((await run(["workflow", "status"], cwd)).output).toContain(
      "Next action: revise specification",
    );
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/rejection-run/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a member\nWhen they request setup\nThen setup completes\n",
    );
    expect((await run(["gate", "specification"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "specification"], cwd)).exitCode).toBe(0);
  });

  it("does not inherit approvals when starting a workflow in legacy project state", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await mkdir(join(cwd, ".aiw/generated/specs"), { recursive: true });
    await mkdir(join(cwd, ".aiw/generated/plans"), { recursive: true });
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/rejection-run/specification.md",
      "REQ-001 already exists\n",
    );
    await writeArtifact(
      cwd,
      ".aiw/generated/plans/rejection-run/implementation-plan.md",
      "TASK-001 already exists\n",
    );

    expect((await run(["workflow", "start", "--id=legacy-state"], cwd)).exitCode).toBe(0);
    const status = await run(["status"], cwd);
    expect(status.output).toContain("SDD workflow legacy-state (active)");
    expect(status.output).toContain("Next action: prepare brainstorming evidence.");
    expect((await run(["plan"], cwd)).error).toContain("brainstorming");
    const approvalLedger = await readFile(join(cwd, ".aiw/approvals.yml"), "utf8");
    expect(approvalLedger).toContain("stages: {}\n");
  });

  it("blocks existing but incomplete SDD artifacts with actionable feedback", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "brainstorming");
    await run(["brainstorm"], cwd);
    const result = await run(["gate", "brainstorming"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Brainstorm section Goal must contain content");
  });

  it("validates specifications and verification reports at their matching gates", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "specification");
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they start setup\nThen setup completes\n",
    );
    expect((await run(["gate", "specification"], cwd)).output).toContain("Quality gate passed");

    const verificationCwd = await project();
    await run(["install"], verificationCwd);
    await advanceWorkflowTo(verificationCwd, "verification");
    await mkdir(join(verificationCwd, ".aiw/generated/reports/test-workflow"), { recursive: true });
    await writeArtifact(
      verificationCwd,
      ".aiw/generated/reports/test-workflow/verification-report.md",
      "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
    );
    expect((await run(["gate", "verification"], verificationCwd)).output).toContain(
      "Quality gate passed",
    );
  });

  it("installs prerequisite workflow skills when a custom stage is selected", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "jest" }, devDependencies: { jest: "latest" } }),
    );
    const recommendation = await run(["recommend", "--select=skills/tdd-development"], cwd);
    expect(recommendation.exitCode).toBe(0);
    const persisted = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(persisted).toContain(
      "id: requirements-specification\n    provider: multileaf\n    confidence: 0.9\n    selected: true",
    );
    expect(persisted).toContain("id: implementation-planning");
    expect(persisted).toContain("id: verification");

    const sync = await syncWithApproval(cwd);
    expect(sync.exitCode).toBe(0);
    for (const skill of [
      "requirements-specification",
      "implementation-planning",
      "verification",
      "tdd-development",
    ])
      await expect(stat(join(cwd, `.agents/skills/${skill}/SKILL.md`))).resolves.toBeTruthy();
  });
});

describe("workflow-scoped artifacts (FRIC-005)", () => {
  it("isolates artifacts between sequential workflows and archives them at completion", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=first-run"], cwd);
    await run(["skip", "brainstorming", "--reason=clear"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    const firstPath = join(cwd, ".aiw/generated/specs/first-run/specification.md");
    await writeArtifact(cwd, ".aiw/generated/specs/first-run/specification.md", "REQ-001 first\n");
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    await run(["workflow", "abandon", "--reason=done with first"], cwd);
    await run(["workflow", "start", "--id=second-run"], cwd);
    await run(["skip", "brainstorming", "--reason=clear"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/second-run/specification.md",
      "REQ-001 second\n",
    );
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    // REQ-003: first workflow's artifact is untouched by the second workflow.
    await expect(readFile(firstPath, "utf8")).resolves.toBe("REQ-001 first\n");
  });

  it("reads legacy fixed-path artifacts with an advisory (REQ-004)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=legacy-adv"], cwd);
    await run(["skip", "brainstorming", "--reason=clear"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    // Simulate a pre-namespacing installation: only the legacy fixed path exists.
    await rm(join(cwd, ".aiw/generated/specs/legacy-adv"), { recursive: true, force: true });
    await mkdir(join(cwd, ".aiw/generated/specs"), { recursive: true });
    const legacyPath = join(cwd, ".aiw/generated/specs/specification.md");
    await writeFile(
      legacyPath,
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen it works\n",
    );
    const gate = await run(["gate", "specification"], cwd);
    expect(gate.exitCode).toBe(0);
    expect(gate.output).toContain("legacy fixed path");
    await run(["approve", "specification"], cwd);
    // REQ-004: a rewrite goes to the scoped path; legacy stays untouched.
    await run(["spec"], cwd).catch(() => undefined);
    await expect(readFile(legacyPath, "utf8")).resolves.toContain("REQ-001");
  });

  it("archives workflow artifacts at completion and tolerates light-lane no artifacts (REQ-005)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=archive-run"], cwd);
    await run(["skip", "brainstorming", "--reason=clear"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/archive-run/specification.md",
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen it works\n",
    );
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    await run(["workflow", "abandon", "--reason=stop before full completion"], cwd);
    // complete a light-lane workflow with no stage artifacts
    await run(["task", "start", "--no-ticket", "--lane=light", "--lane-reason=small"], cwd);
    await run(["task", "evidence", "--validation=ok"], cwd);
    const completed = await run(["workflow", "complete"], cwd);
    expect(completed.exitCode).toBe(0);
    expect(completed.output).not.toContain("Archived");
  });
});

describe("ticket-driven task", () => {
  it("starts a task from a ticket and records it in the session", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(
      ["task", "start", "--ticket=PROJ-142", "--title=Export endpoint"],
      cwd,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task started for ticket PROJ-142");
    expect(result.output).toContain("Export endpoint");
    expect(result.output).toContain("aiw skip brainstorming");
    expect(result.output).toContain(`aiw spec --ticket=PROJ-142`);
    const session = await readFile(join(cwd, ".aiw", "workflow.yml"), "utf8");
    expect(session).toContain("ticket: PROJ-142");
    expect(session).toContain("title: Export endpoint");
  });

  it("rejects malformed ticket ids", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["task", "start", "--ticket=invalid"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("TEAM-123");
  });

  it("creates a local ticket when no ticket is given", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["task", "start", "--title=Small fix"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("LOCAL-001");
    const session = await readFile(join(cwd, ".aiw", "workflow.yml"), "utf8");
    expect(session).toContain("ticket: LOCAL-001");
    const status = await run(["task", "status"], cwd);
    expect(status.output).toContain("Ticket: LOCAL-001");
  });

  it("honors an explicit --no-ticket and sequences local ticket numbers", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const first = await run(["task", "start", "--no-ticket"], cwd);
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain("LOCAL-001");
    await run(["workflow", "abandon", "--reason=superseded"], cwd);
    const second = await run(["task", "start"], cwd);
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("LOCAL-002");
    const session = await readFile(join(cwd, ".aiw", "workflow.yml"), "utf8");
    expect(session).toContain("ticket: LOCAL-002");
  });

  it("rejects combining --no-ticket with --ticket", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["task", "start", "--ticket=PROJ-1", "--no-ticket"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Usage");
  });

  it("reports ticket, stages, and next step in task status", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["task", "start", "--ticket=PROJ-142", "--title=Export endpoint"], cwd);
    const status = await run(["task", "status"], cwd);
    expect(status.exitCode).toBe(0);
    expect(status.output).toContain("Ticket: PROJ-142 — Export endpoint");
    expect(status.output).toContain("Stages:");
    expect(status.output).toContain("brainstorming: not-started");
    expect(status.output).toContain("ticket PROJ-142 already provides the requirement");
  });

  it("links the specification scaffold to the ticket", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["task", "start", "--ticket=PROJ-142"], cwd);
    await run(["skip", "brainstorming", "--reason=provided by ticket"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    await run(["spec", "--ticket=PROJ-142", "--title=Export endpoint"], cwd);
    const sessionText = await readFile(join(cwd, ".aiw", "workflow.yml"), "utf8");
    const workflowId = /workflowId: ([0-9a-f-]+)/.exec(sessionText)?.[1];
    const spec = await readFile(
      join(cwd, ".aiw", "generated", "specs", workflowId!, "specification.md"),
      "utf8",
    );
    expect(spec).toContain("> Ticket: PROJ-142");
  });

  it("recommends the ticket-driven capability", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "1" } }),
    );
    await run(["scan"], cwd);
    await run(["recommend"], cwd);
    const recommendations = await readFile(join(cwd, ".aiw", "recommendations.yml"), "utf8");
    expect(recommendations).toContain("ticket-driven-development");
    expect(recommendations).toContain("skills/ticket");
  });
});

describe("aiw risk assess", () => {
  async function gitProject(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-risk-"));
    const run = (cmd: string, args: string[]): void =>
      execFileSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
    run("git", ["init", "-q"]);
    run("git", ["config", "user.email", "test@example.com"]);
    run("git", ["config", "user.name", "Test"]);
    await writeFile(join(cwd, "README.md"), "# project\n");
    run("git", ["add", "."]);
    run("git", ["commit", "-qm", "initial"]);
    return cwd;
  }

  it("renders bounded labeled judge context when an index exists (OPP-008 REQ-003)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
    );
    await mkdir(join(cwd, ".aiw", "semantic"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "semantic", "index.json"),
      JSON.stringify({
        schema: 1,
        model: "test-model",
        chunks: [
          {
            file: "src/caller.ts",
            text: "calls the changed module\nfrom another subsystem\nmore",
            vector: [1, 0],
          },
        ],
      }),
    );
    const result = await run(["semantic", "judge-context", "--paths=src/auth/token.ts"], cwd, {
      embeddingProvider: {
        available: async () => true,
        embed: async () => [[1, 0]],
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("## Changed paths");
    expect(result.output).toContain("src/caller.ts");
    expect(result.output).toContain("context aid");
    expect(result.output).toContain("never confirmed facts");
    const unavailable = await run(["semantic", "judge-context", "--paths=a.ts"], cwd, {
      embeddingProvider: {
        available: async () => false,
        embed: async () => {
          throw new Error("no network");
        },
      },
    });
    expect(unavailable.exitCode).toBe(1);
    expect(unavailable.error).toContain("fail-safe");
  });

  it("retrieval prevents a false untested flag without changing other reasons (OPP-008 REQ-001/002)", async () => {
    const cwd = await gitProject();
    await mkdir(join(cwd, "src", "auth"), { recursive: true });
    await writeFile(join(cwd, "src", "auth", "token.ts"), "export const t = 1;\n");
    // Baseline: no sibling test -> untested_regression stands, byte-identical floor.
    const baseline = await run(["risk", "assess"], cwd);
    expect(baseline.output).toContain("untested_regression");
    expect(baseline.output).not.toContain("covering: semantic-retrieval");
    // Enable semantic mapping with an index whose differently-named test chunk matches.
    await mkdir(join(cwd, ".aiw"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
    );
    await mkdir(join(cwd, ".aiw", "semantic"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "semantic", "index.json"),
      JSON.stringify({
        schema: 1,
        model: "test-model",
        chunks: [
          { file: "tests/integration.spec.ts", text: "exercises token issuance", vector: [1, 0] },
        ],
      }),
    );
    const result = await run(["risk", "assess"], cwd, {
      embeddingProvider: {
        available: async () => true,
        embed: async () => [[1, 0]],
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("covering: semantic-retrieval (src/auth/token.ts)");
    expect(result.output).not.toContain("untested_regression");
    // The auth category reason and the tier remain rule-based (REQ-002).
    expect(result.output).toContain("risk: high");
    expect(result.output).toContain("security");
    const json = JSON.parse(
      (
        await run(["risk", "assess", "--json"], cwd, {
          embeddingProvider: {
            available: async () => true,
            embed: async () => [[1, 0]],
          },
        })
      ).output ?? "{}",
    );
    expect(json.covering_evidence).toEqual(["src/auth/token.ts"]);
  });

  it("classifies a documentation-only change as passive and not risk-due", async () => {
    const cwd = await gitProject();
    await mkdir(join(cwd, "docs"));
    await writeFile(join(cwd, "docs", "notes.md"), "notes\n");
    const result = await run(["risk", "assess"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("risk: passive");
    expect(result.output).toContain("risk due: no");
    const json = JSON.parse((await run(["risk", "assess", "--json"], cwd)).output ?? "{}");
    expect(json.schema).toBe("aiw.risk-assessment/v1");
    expect(json.risk).toBe("passive");
    expect(json.risk_due).toBe(false);
  });

  it("classifies an auth change as high and names a runnable next command", async () => {
    const cwd = await gitProject();
    await mkdir(join(cwd, "src", "auth"), { recursive: true });
    await writeFile(join(cwd, "src", "auth", "token.ts"), "export const t = 1;\n");
    const result = await run(["risk", "assess"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("risk: high");
    expect(result.output).toContain("security");
    expect(result.output).toContain("src/auth/token.ts");
    expect(result.output).toContain("risk due: yes");
    const json = JSON.parse((await run(["risk", "assess", "--json"], cwd)).output ?? "{}");
    expect(json.risk).toBe("high");
    expect(json.risk_due).toBe(true);
    expect(json.next_command).toBe("aiw workflow start");
  });

  it("starts a workflow when the printed next command is executed", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await mkdir(join(cwd, "src", "auth"), { recursive: true });
    await writeFile(join(cwd, "src", "auth", "token.ts"), "export const t = 1;\n");
    const json = JSON.parse((await run(["risk", "assess", "--json"], cwd)).output ?? "{}");
    const started = await run((json.next_command as string).split(" ").slice(1), cwd);
    expect(started.exitCode).toBe(0);
    expect(started.output).toContain("Workflow started");
  });

  it("assesses a committed range with --base-ref", async () => {
    const cwd = await gitProject();
    await mkdir(join(cwd, "src", "auth"), { recursive: true });
    await writeFile(join(cwd, "src", "auth", "token.ts"), "export const t = 1;\n");
    const exec = (cmd: string, args: string[]): void =>
      execFileSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
    exec("git", ["add", "."]);
    exec("git", ["commit", "-qm", "auth"]);
    const result = await run(["risk", "assess", "--base-ref=HEAD~1"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("risk: high");
    const clean = await run(["risk", "assess", "--base-ref=HEAD"], cwd);
    expect(clean.output).toContain("risk: passive");
  });

  it("raises a medium change to high with agent escalation flags", async () => {
    const cwd = await gitProject();
    await mkdir(join(cwd, "src", "billing"), { recursive: true });
    await writeFile(join(cwd, "src", "billing", "invoice.ts"), "export const i = 1;\n");
    // A covering sibling test keeps the deterministic tier at medium so the
    // test exercises escalation, not the untested-regression category.
    await writeFile(join(cwd, "src", "billing", "invoice.test.ts"), "test();\n");
    const base = await run(["risk", "assess"], cwd);
    expect(base.output).toContain("risk: medium");
    const escalated = await run(
      ["risk", "assess", "--escalate-item=2", "--escalate-reason=touches billing auth checks"],
      cwd,
    );
    expect(escalated.output).toContain("risk: high");
    expect(escalated.output).toContain("agent_escalation");
  });

  it("rejects an invalid escalation item with an actionable error", async () => {
    const cwd = await gitProject();
    const result = await run(["risk", "assess", "--escalate-item=9", "--escalate-reason=x"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("1 to 6");
  });

  it("never writes project state (read-only guarantee)", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await mkdir(join(cwd, "src", "auth"), { recursive: true });
    await writeFile(join(cwd, "src", "auth", "token.ts"), "export const t = 1;\n");
    const before = await readdir(join(cwd, ".aiw"));
    const result = await run(["risk", "assess"], cwd);
    expect(result.exitCode).toBe(0);
    const after = await readdir(join(cwd, ".aiw"));
    expect(after.sort()).toEqual(before.sort());
  });

  it("fails clearly outside a git repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-nogit-"));
    const result = await run(["risk", "assess"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("git");
  });
});

describe("workflow abandon (field feedback fix)", () => {
  it("refuses without an active workflow and names the way to start one", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["workflow", "abandon", "--reason=obsolete"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: workflow_not_active]");
    expect(result.error).toContain("`aiw workflow start`");
  });

  it("requires a reason", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=abandon-no-reason"], cwd);
    const result = await run(["workflow", "abandon"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Usage: aiw workflow abandon --reason=");
  });

  it("archives the active workflow with the abandonment reason and frees the slot", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=abandon-me-1"], cwd);
    const result = await run(
      ["workflow", "abandon", "--reason=obsolete: superseded by ticket TEAM-9"],
      cwd,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("abandoned");
    expect(result.output).toContain("checkpoints/workflow-abandon-me-1-approvals.yml");
    expect(existsSync(join(cwd, ".aiw", "workflow.yml"))).toBe(false);
    expect(existsSync(join(cwd, ".aiw", "approvals.yml"))).toBe(false);
    const session = await readFile(
      join(cwd, ".aiw", "checkpoints", "workflow-abandon-me-1-session.yml"),
      "utf8",
    );
    expect(session).toContain("status: abandoned");
    expect(session).toContain("obsolete: superseded by ticket TEAM-9");
    const ledger = await readFile(
      join(cwd, ".aiw", "checkpoints", "workflow-abandon-me-1-approvals.yml"),
      "utf8",
    );
    expect(ledger).toContain("workflowId: abandon-me-1");
  });

  it("lets a new workflow start after abandoning", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=abandon-me-2"], cwd);
    await run(["workflow", "abandon", "--reason=stale"], cwd);
    const started = await run(["workflow", "start", "--id=fresh-after-abandon"], cwd);
    expect(started.exitCode).toBe(0);
    expect((await run(["workflow", "status"], cwd)).output).toContain("fresh-after-abandon");
    // the archived id stays reusable-proof: starting the archived id again is rejected
    const reused = await run(["workflow", "start", "--id=abandon-me-2"], cwd);
    expect(reused.exitCode).toBe(1);
  });

  it("gives the still-active block a typed reason naming abandon as the way out", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=still-active-1"], cwd);
    const result = await run(["workflow", "start", "--id=still-active-2"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: workflow_still_active]");
    expect(result.error).toContain("`aiw workflow abandon --reason=");
  });

  it("exposes the still-active block as machine-readable json", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=still-active-3"], cwd);
    const result = await run(["workflow", "start", "--id=still-active-4", "--json"], cwd);
    const envelope = JSON.parse(result.output ?? "{}");
    expect(envelope.reason_code).toBe("workflow_still_active");
    expect(envelope.next_action).toContain("aiw workflow abandon");
  });
});

describe("light lane (OPP-001)", () => {
  it("starts a light task, prints the resume test, and records the rationale in the ledger", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(
      [
        "task",
        "start",
        "--ticket=TEAM-7",
        "--lane=light",
        "--lane-reason=one-line fix, resumable from request",
      ],
      cwd,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("light lane");
    expect(result.output).toContain("resumed from your request plus `git diff`");
    expect(result.output).toContain("Rationale recorded: one-line fix, resumable from request");
    const ledger = await readFile(join(cwd, ".aiw", "approvals.yml"), "utf8");
    expect(ledger).toContain("lane: light");
    expect(ledger).toContain("one-line fix, resumable from request");
  });

  it("requires a lane reason for the light lane", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["task", "start", "--ticket=TEAM-8", "--lane=light"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--lane-reason");
  });

  it("blocks stage commands in the light lane with an escalation continuation", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["task", "start", "--ticket=TEAM-9", "--lane=light", "--lane-reason=small fix"], cwd);
    const spec = await run(["spec"], cwd);
    expect(spec.exitCode).toBe(1);
    expect(spec.error).toContain("[reason: lane_escalation_required]");
    expect(spec.error).toContain("aiw task escalate");
    const gate = await run(["gate", "brainstorming"], cwd);
    expect(gate.error).toContain("[reason: lane_escalation_required]");
    const approve = await run(["approve", "brainstorming"], cwd);
    expect(approve.error).toContain("[reason: lane_escalation_required]");
    // No stage artifacts were authored.
    expect(existsSync(join(cwd, ".aiw", "generated", "specs", "specification.md"))).toBe(false);
  });

  it("escalates to the full lane and preserves recorded evidence", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(
      ["task", "start", "--ticket=TEAM-10", "--lane=light", "--lane-reason=small fix"],
      cwd,
    );
    await run(["task", "evidence", "--validation=npm test: 3 passed"], cwd);
    const escalated = await run(
      ["task", "escalate", "--reason=scope grew: needs a specification"],
      cwd,
    );
    expect(escalated.exitCode).toBe(0);
    expect(escalated.output).toContain("escalated to the full lane");
    const status = await run(["task", "status"], cwd);
    expect(status.output).toContain("escalated to the full lane");
    const brainstorm = await run(["brainstorm"], cwd);
    expect(brainstorm.exitCode).toBe(0);
    const second = await run(["task", "escalate", "--reason=again"], cwd);
    expect(second.exitCode).toBe(1);
  });

  it("completes a light task with evidence and no durable spec artifacts", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["task", "start", "--ticket=TEAM-11", "--lane=light", "--lane-reason=typo fix"], cwd);
    const blocked = await run(["workflow", "complete"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("[reason: light_evidence_missing]");
    const evidence = await run(["task", "evidence", "--validation=vitest run: 552 passed"], cwd);
    expect(evidence.exitCode).toBe(0);
    const completed = await run(["workflow", "complete"], cwd);
    expect(completed.exitCode).toBe(0);
    expect(completed.output).toContain("light lane");
    const checkpoints = await readdir(join(cwd, ".aiw", "checkpoints"));
    const light = checkpoints.find((name) => name.startsWith("task-light-"));
    expect(light).toBeDefined();
    const content = await readFile(join(cwd, ".aiw", "checkpoints", light!), "utf8");
    expect(content).toContain("vitest run: 552 passed");
    expect(content).toContain("lane: light");
    expect(existsSync(join(cwd, ".aiw", "generated", "specs", "specification.md"))).toBe(false);
    expect(existsSync(join(cwd, ".aiw", "generated", "plans", "implementation-plan.md"))).toBe(
      false,
    );
  });

  it("keeps the full lane as the default and unchanged", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["task", "start", "--ticket=TEAM-12", "--title=Full"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("light lane");
    const status = await run(["task", "status"], cwd);
    expect(status.output).not.toContain("Lane: light");
    const spec = await run(["spec"], cwd);
    expect(spec.exitCode).toBe(1);
    expect(spec.error).toContain("brainstorming");
  });
});

describe("blocking reason codes and exact continuations", () => {
  it("emits a typed reason and runnable continuation when a gate is blocked", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "plan");
    const result = await run(["gate", "plan"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: gate_evidence_missing]");
    expect(result.error).toContain(".aiw/generated/plans/test-workflow/implementation-plan.md");
    expect(result.error).toContain("aiw gate plan");
  });

  it("names the exact approve command for a pending prerequisite stage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=continuation-check"], cwd);
    await run(["brainstorm"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/continuation-check/brainstorm.md",
      "## Goal\nDeliver the feature\n## Users\nProject users\n## Constraints\nExisting APIs\n## Risks\nRegression\n## Non-goals\nUnrelated work\n",
    );
    await run(["gate", "brainstorming"], cwd);
    const result = await run(["spec"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: stage_prerequisite_pending]");
    expect(result.error).toContain("`aiw approve brainstorming`");
  });

  it("executes the printed continuation to clear the block", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=continuation-exec"], cwd);
    await run(["brainstorm"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/continuation-exec/brainstorm.md",
      "## Goal\nDeliver the feature\n## Users\nProject users\n## Constraints\nExisting APIs\n## Risks\nRegression\n## Non-goals\nUnrelated work\n",
    );
    await run(["gate", "brainstorming"], cwd);
    const blocked = await run(["spec"], cwd);
    const continuation = /`aiw (approve [a-z-]+)`/.exec(blocked.error ?? "")?.[1];
    expect(continuation).toBe("approve brainstorming");
    const cleared = await run(continuation!.split(" "), cwd);
    expect(cleared.exitCode).toBe(0);
    await run(["skip", "product-requirements", "--reason=Not needed"], cwd);
    expect((await run(["spec"], cwd)).exitCode).toBe(0);
  });

  it("exposes machine-readable reason_code and next_command with --json", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "plan");
    const result = await run(["gate", "plan", "--json"], cwd);
    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.output ?? "{}");
    expect(envelope.reason_code).toBe("gate_evidence_missing");
    expect(envelope.next_action).toContain("aiw gate plan");
  });

  it("exposes the approval_stale reason with the gate rerun command", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=stale-json"], cwd);
    await run(["brainstorm"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/stale-json/brainstorm.md",
      "## Goal\nDeliver the feature\n## Users\nProject users\n## Constraints\nExisting APIs\n## Risks\nRegression\n## Non-goals\nUnrelated work\n",
    );
    await run(["gate", "brainstorming"], cwd);
    await run(["approve", "brainstorming"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/stale-json/brainstorm.md",
      "## Goal\nDeliver the changed feature\n## Users\nProject users\n## Constraints\nExisting APIs\n## Risks\nRegression\n## Non-goals\nUnrelated work\n",
    );
    const result = await run(["approve", "brainstorming", "--json"], cwd);
    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.output ?? "{}");
    expect(envelope.reason_code).toBe("approval_stale");
    expect(envelope.next_command).toBe("aiw gate brainstorming");
  });
});
