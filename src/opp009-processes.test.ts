import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./cli.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-opp009-"));
}

describe("OPP-009 processes as entry points", () => {
  it("runs a bugfix process: diagnosis → implementation → verification → review, no feature stages", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const started = await run(["task", "start", "--ticket=BUG-1", "--process=bugfix"], cwd);
    expect(started.exitCode).toBe(0);
    const ledger = await readFile(join(cwd, ".aiw", "approvals.yml"), "utf8");
    expect(ledger).toContain("process: bugfix");

    // feature stages are not part of this process
    const spec = await run(["spec"], cwd);
    expect(spec.exitCode).toBe(1);
    expect(spec.error).toContain("[reason: stage_not_in_process]");
    const status = await run(["task", "status"], cwd);
    expect(status.output).toContain("diagnosis");
    expect(status.output).not.toContain("- brainstorming:");

    const diagnosis = await run(["diagnosis", "--title=Token rejection bug"], cwd);
    expect(diagnosis.exitCode).toBe(0);
    await writeFile(
      join(cwd, ".aiw/generated/reports/diagnosis.md"),
      "# Token rejection bug\n\n## Reproduction\n\n- Command: `npm test -- revocation`\n- Observed: valid token rejected\n\n## Expected\n\n- Valid tokens verify\n\n## Root Cause\n\n- `revoked` check inverted at src/auth/token.ts:12\n\n## Scope\n\n- In scope: src/auth/token.ts\n- Out of scope: key rotation\n",
    );
    const gateDiagnosis = await run(["gate", "diagnosis"], cwd);
    expect(gateDiagnosis.exitCode, gateDiagnosis.error ?? "").toBe(0);
    expect((await run(["approve", "diagnosis"], cwd)).exitCode).toBe(0);

    // implementation in bugfix does not require spec/plan
    const reportDir = join(cwd, ".aiw", "generated", "reports");
    await writeFile(
      join(reportDir, "implementation-report.md"),
      "## Changed Files\nsrc/auth/token.ts\n## Tests\ntoken.test.ts\n## Validation\nValidation: npm test → exit 0\n## Deviations\nNone\n",
    );
    const gateImpl = await run(["gate", "implementation"], cwd);
    expect(gateImpl.exitCode, gateImpl.error ?? "").toBe(0);
    expect((await run(["approve", "implementation"], cwd)).exitCode).toBe(0);
    await writeFile(
      join(reportDir, "verification-report.md"),
      "## Requirements Checked\nReproduction now passes\n## Checks Passed\nValidation: npm test → exit 0 (6 passed)\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
    );
    const gateVer = await run(["gate", "verification"], cwd);
    expect(gateVer.exitCode, gateVer.error ?? "").toBe(0);
    expect((await run(["approve", "verification"], cwd)).exitCode).toBe(0);
    await writeFile(
      join(reportDir, "code-review.md"),
      "## Scope\nFix inverted revocation check\n## Findings\nNone\n## Checks\nDiff reviewed\n## Residual Risks\nNone\n## Decision\nAccept\n",
    );
    const gateReview = await run(["gate", "review"], cwd);
    expect(gateReview.exitCode, gateReview.error ?? gateReview.output ?? "").toBe(0);
    expect((await run(["approve", "review"], cwd)).exitCode).toBe(0);
    const complete = await run(["workflow", "complete"], cwd);
    expect(complete.exitCode, complete.error ?? complete.output ?? "").toBe(0);
  });

  it("runs an idea-assessment process with a validated outcome", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const started = await run(
      ["task", "start", "--ticket=IDEA-3", "--process=idea-assessment"],
      cwd,
    );
    expect(started.exitCode).toBe(0);
    const assess = await run(["assess", "--title=Plugin marketplace"], cwd);
    expect(assess.exitCode).toBe(0);
    const assessmentPath = join(cwd, ".aiw/generated/reports/assessment.md");
    // invalid outcome fails the gate
    await writeFile(
      assessmentPath,
      "# Plugin marketplace\n\n## Evidence\n\n- RFC discussion: 12 requests\n\n## Outcome\n\nmaybe\n\n## Rationale\n\n- unclear\n",
    );
    expect((await run(["gate", "assessment"], cwd)).exitCode).toBe(1);
    await writeFile(
      assessmentPath,
      "# Plugin marketplace\n\n## Evidence\n\n- RFC discussion: 12 requests\n- Support load: 4 tickets/month\n\n## Outcome\n\ngo\n\n## Rationale\n\n- demand is documented and scoped\n\n## Next Step\n\n- go: feature workflow for a minimal registry\n",
    );
    const gateAssessment = await run(["gate", "assessment"], cwd);
    expect(gateAssessment.exitCode, gateAssessment.error ?? "").toBe(0);
    expect((await run(["approve", "assessment"], cwd)).exitCode).toBe(0);
    expect((await run(["workflow", "complete"], cwd)).exitCode).toBe(0);
  });

  it("keeps the feature process byte-identical when no --process is given", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const started = await run(["task", "start", "--ticket=TEAM-30"], cwd);
    expect(started.exitCode).toBe(0);
    expect(started.output).not.toContain("process");
    const ledger = await readFile(join(cwd, ".aiw", "approvals.yml"), "utf8");
    expect(ledger).not.toContain("process:");
    const diagnosis = await run(["diagnosis"], cwd);
    expect(diagnosis.exitCode).toBe(1);
    expect(diagnosis.error).toContain("[reason: stage_not_in_process]");
    // the feature flow still works
    await run(["brainstorm"], cwd);
    expect((await run(["gate", "brainstorming"], cwd)).exitCode).toBe(1); // incomplete is fine
    expect(existsSync(join(cwd, ".aiw", "generated", "specs"))).toBe(true);
  });

  it("composes bugfix with the light lane", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const started = await run(
      [
        "task",
        "start",
        "--ticket=BUG-2",
        "--process=bugfix",
        "--lane=light",
        "--lane-reason=one-line fix",
      ],
      cwd,
    );
    expect(started.exitCode).toBe(0);
    const ledger = await readFile(join(cwd, ".aiw", "approvals.yml"), "utf8");
    expect(ledger).toContain("process: bugfix");
    expect(ledger).toContain("lane: light");
    const spec = await run(["spec"], cwd);
    expect(spec.error).toContain("[reason: stage_not_in_process]");
  });

  it("rejects unknown process names", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["task", "start", "--ticket=BUG-9", "--process=waterfall"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Unknown process");
    expect(result.error).toContain("feature, bugfix, idea-assessment");
  });
});
