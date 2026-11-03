import { describe, expect, it } from "vitest";
import { compareVerificationPairs } from "./workflow.js";
import { join } from "node:path";

function setup(plan: string, report?: string): string[] {
  const store: Record<string, string> = {
    [join("generated/plans/implementation-plan.md")]: plan,
  };
  if (report !== undefined) store[join("generated/reports/implementation-report.md")] = report;
  const fs = {
    exists: (path: string): boolean => path in store,
    read: (path: string): string => store[path] ?? "",
  };
  return compareVerificationPairs(join("."), fs as never, "implementation");
}

const PLAN_WITH_PAIRS = `# Plan

## Ordered Tasks

- [ ] TASK-001: Add feature
  - Requirement: REQ-001
  - Validation: npm test → exit 0
  - Validation: npm run lint → exit 0

- [ ] TASK-002: Update contract
  - Requirement: REQ-001
  - Validation: node scripts/check.js → exit 2
`;

describe("OPP-014 paired verification", () => {
  it("passes when every declared pair has a matching observed line", () => {
    const issues = setup(
      PLAN_WITH_PAIRS,
      `# Implementation Evidence\n\n## Validation\n\n- Validation: npm test → exit 0 (132 passed)\n- Validation: npm run lint → exit 0\n- Validation: node scripts/check.js → exit 2 (2 findings, as designed)\n`,
    );
    expect(issues).toEqual([]);
  });

  it("fails a declared pair with no observed record", () => {
    const issues = setup(
      PLAN_WITH_PAIRS,
      `# Implementation Evidence\n\n## Validation\n\n- Validation: npm test → exit 0\n`,
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("[verification_pair_missing]");
    expect(issues[0]).toContain("TASK-001");
    expect(issues[0]).toContain("npm run lint");
    expect(issues[1]).toContain("[verification_pair_missing]");
    expect(issues[1]).toContain("TASK-002");
  });

  it("fails mismatched exit codes between expected and observed", () => {
    const issues = setup(
      PLAN_WITH_PAIRS,
      `# Implementation Evidence\n\n## Validation\n\n- Validation: npm test → exit 1 (a failure nobody declared)\n- Validation: npm run lint → exit 0\n- Validation: node scripts/check.js → exit 0\n`,
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("[verification_pair_mismatch]");
    expect(issues[0]).toContain("TASK-001");
    expect(issues[0]).toContain("expected exit 0, observed exit 1");
    expect(issues[1]).toContain("[verification_pair_mismatch]");
    expect(issues[1]).toContain("TASK-002");
  });

  it("accepts legacy plans without pair arrows unchanged", () => {
    const issues = setup(
      "# Plan\n\nTASK-001\nValidation: npm test\n",
      "# Implementation Evidence\n",
    );
    expect(issues).toEqual([]);
  });

  it("returns no issues when the report is missing but the plan is legacy", () => {
    const issues = setup("# Plan\n\nTASK-001\nValidation: npm test\n");
    expect(issues).toEqual([]);
  });

  it("normalizes command whitespace when matching observations", () => {
    const issues = setup(
      "- [ ] TASK-001: x\n  - Validation: npm   test → exit 0\n",
      "- Validation: npm test → exit 0\n",
    );
    expect(issues).toEqual([]);
  });
});
