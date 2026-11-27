import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";
import { evaluateQualityGate } from "./quality-gates.js";

const READY_REPORT = `# PR Readiness

## PR Reference

#42

## Branch

feature/end-to-end → main

## CI Evidence

gh pr checks: all checks pass (https://example.com/ci/run/1)

## Review Comments

5 comments, all resolved with commits; unresolved: 0

## Conflict Check

Clean — base merged, no conflicts.

## Merge-Ready Checklist

- [x] CI green on the PR
- [x] All review comments resolved (unresolved: 0)
- [x] No merge conflicts with the base branch
- [x] Human-only: branch protection and required approvals satisfied
`;

describe("pr readiness gate content checks (REQ-001)", () => {
  it("passes a fully merge-ready report", () => {
    expect(evaluateQualityGate("pr", READY_REPORT)).toEqual([]);
  });

  it("fails reports with failing CI, unresolved comments, or unchecked items", () => {
    const failing = READY_REPORT.replace("all checks pass", "one check failed");
    expect(evaluateQualityGate("pr", failing)).toContain(
      "CI Evidence records a failing check; resolve it before merge-ready.",
    );
    const unresolved = READY_REPORT.replace("unresolved: 0", "unresolved: 2");
    expect(evaluateQualityGate("pr", unresolved)).toContain(
      "Review Comments must record unresolved: 0 with resolution evidence.",
    );
    const unchecked = READY_REPORT.replace("- [x] CI green", "- [ ] CI green");
    expect(evaluateQualityGate("pr", unchecked)).toContain(
      "Merge-Ready Checklist has unchecked items; resolve them before merge-ready.",
    );
    const conflicts = READY_REPORT.replace(
      "Clean — base merged, no conflicts.",
      "conflicts remain",
    );
    expect(evaluateQualityGate("pr", conflicts)).toContain(
      "Conflict Check must record a clean merge state.",
    );
  });
});

async function advanceToPr(cwd: string, reportContent: string): Promise<void> {
  await run(["install"], cwd);
  await run(["workflow", "start", "--id=pr-test"], cwd);
  for (const stage of ["brainstorming", "product-requirements"]) {
    await run(["skip", stage, "--reason=Not needed by this test"], cwd);
  }
  // specification
  await run(["spec"], cwd);
  await mkdir(join(cwd, ".aiw/generated/specs/pr-test"), { recursive: true });
  await writeFile(
    join(cwd, ".aiw/generated/specs/pr-test/specification.md"),
    "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen it works\n",
  );
  await run(["gate", "specification"], cwd);
  await run(["approve", "specification"], cwd);
  await run(["skip", "technical-design", "--reason=Not needed by this test"], cwd);
  // plan
  await mkdir(join(cwd, ".aiw/generated/plans/pr-test"), { recursive: true });
  await writeFile(
    join(cwd, ".aiw/generated/plans/pr-test/implementation-plan.md"),
    "TASK-001\nRequirement: REQ-001\nCode: src/main.ts\nTests: src/main.test.ts\nValidation: npm test\nEvidence: output\n",
  );
  await run(["gate", "plan"], cwd);
  await run(["approve", "plan"], cwd);
  // implementation
  await mkdir(join(cwd, ".aiw/generated/reports/pr-test"), { recursive: true });
  await writeFile(
    join(cwd, ".aiw/generated/reports/pr-test/implementation-report.md"),
    "## Changed Files\nsrc/main.ts\n## Tests\nmain.test.ts\n## Validation\nnpm test\n## Deviations\nNone\n",
  );
  await run(["gate", "implementation"], cwd);
  await run(["approve", "implementation"], cwd);
  // verification
  await writeFile(
    join(cwd, ".aiw/generated/reports/pr-test/verification-report.md"),
    "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
  );
  await run(["gate", "verification"], cwd);
  await run(["approve", "verification"], cwd);
  // review
  await writeFile(
    join(cwd, ".aiw/generated/reports/pr-test/code-review.md"),
    "## Scope\nFeature\n## Findings\nNone\n## Checks\nTests reviewed\n## Residual Risks\nNone\n## Decision\nAccept\n",
  );
  await run(["gate", "review"], cwd);
  await run(["approve", "review"], cwd);
  // traceability
  await run(["trace"], cwd);
  await run(["gate", "traceability"], cwd);
  await run(["approve", "traceability"], cwd);
  const scaffolded = await run(["pr"], cwd);
  if (scaffolded.exitCode !== 0) throw new Error(scaffolded.error ?? "aiw pr failed");
  if (reportContent)
    await writeFile(join(cwd, ".aiw/generated/reports/pr-test/pr-readiness.md"), reportContent);
}

describe("pr stage command and gate (REQ-001)", () => {
  it("scaffolds the report with host-side instructions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-pr-scaffold-"));
    // advanceToPr scaffolds the pr report and then overwrites it; keep the scaffold.
    await advanceToPr(cwd, "");
    const prOutput = await readFile(
      join(cwd, ".aiw/generated/reports/pr-test/pr-readiness.md"),
      "utf8",
    );
    expect(prOutput).toContain("## Merge-Ready Checklist");
    expect(prOutput).toContain("- [ ] Human-only");
    expect(prOutput).toContain("## PR Reference");
    // The scaffold command output guidance is verified in advanceToPr's success;
    // assert the host-side instructions text via a fresh scaffold run.
    const again = await run(["pr"], cwd);
    expect(again.exitCode).toBe(0);
    expect(again.output).toContain("gh pr create");
    expect(again.output).toContain("(the CLI never runs these)");
  });

  it("gates a merge-ready report and blocks completion until pr resolves", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-pr-ready-"));
    // Scaffold only: the placeholder checklist blocks the gate.
    await advanceToPr(cwd, "");
    const incomplete = await run(["gate", "pr"], cwd);
    expect(incomplete.exitCode).toBe(1);
    expect(incomplete.error).toContain("Quality gate blocked");
    expect(incomplete.error).toContain("Merge-Ready Checklist");

    // Replace with the completed report: the gate passes.
    await writeFile(join(cwd, ".aiw/generated/reports/pr-test/pr-readiness.md"), READY_REPORT);
    const ready = await run(["gate", "pr"], cwd);
    expect(ready.exitCode).toBe(0);
    expect(ready.output).toContain("Quality gate passed for pr");

    // Completion is blocked until the pr stage is approved or skipped.
    const blockedComplete = await run(["workflow", "complete"], cwd);
    expect(blockedComplete.exitCode).not.toBe(0);
    await run(["approve", "pr"], cwd);
    const complete = await run(["workflow", "complete"], cwd);
    expect(complete.exitCode).toBe(0);
  });

  it("auto-consumes the orchestration forecast and blocks on conflicts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-pr-conflict-"));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "t"], { cwd, stdio: "ignore" });
    await writeFile(join(cwd, "file.txt"), "base\n");
    execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "base"], { cwd, stdio: "ignore" });
    // A task branch with a conflicting change on the same line.
    execFileSync("git", ["checkout", "-b", "aiw/plan1/TASK-001"], { cwd, stdio: "ignore" });
    await writeFile(join(cwd, "file.txt"), "branch change\n");
    execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "branch"], { cwd, stdio: "ignore" });
    execFileSync("git", ["checkout", "main"], { cwd, stdio: "ignore" });
    await writeFile(join(cwd, "file.txt"), "main change\n");
    execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "main"], { cwd, stdio: "ignore" });

    // The PR report must declare a branch matching the orchestration plan.
    await advanceToPr(
      cwd,
      READY_REPORT.replace("feature/end-to-end → main", "aiw/plan1/TASK-001 → main"),
    );
    // Orchestration plan + checkpoint: the gate must re-run the forecast.
    await writeFile(
      join(cwd, "orchestration.yml"),
      'schema: 1\nid: plan1\ntasks:\n  - id: TASK-001\n    agent: codex\n    prompt: "do it"\n    depends_on: []\n',
    );
    await mkdir(join(cwd, ".aiw/checkpoints"), { recursive: true });
    const tip = execFileSync("git", ["rev-parse", "aiw/plan1/TASK-001"], { cwd }).toString().trim();
    await writeFile(
      join(cwd, ".aiw/checkpoints/orchestration-plan1.yml"),
      `schema: 1\nplan: plan1\nresults:\n  - id: TASK-001\n    status: passed\n    detail: done\n    finalCommit: ${tip}\n`,
    );

    const blocked = await run(["gate", "pr"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("Orchestration merge forecast reports conflicts");

    // AIW-002 REQ-001: a PR branch that matches none of the plans falls back
    // to recorded evidence — no false conflict block from an unrelated plan.
    const unrelated = await mkdtemp(join(tmpdir(), "aiw-pr-unrelated-"));
    execFileSync("git", ["clone", cwd, unrelated], { stdio: "ignore" });
    await advanceToPr(unrelated, READY_REPORT);
    const { writeFile: writeUnrelated } = await import("node:fs/promises");
    await writeUnrelated(
      join(unrelated, ".aiw/checkpoints/orchestration-plan1.yml"),
      `schema: 1\nplan: plan1\nresults:\n  - id: TASK-001\n    status: passed\n    detail: done\n    finalCommit: ${tip}\n`,
    );
    const unrelatedGate = await run(["gate", "pr"], unrelated);
    expect(unrelatedGate.exitCode).toBe(0);
    expect(unrelatedGate.output).toContain("Quality gate passed for pr");
  });
});
