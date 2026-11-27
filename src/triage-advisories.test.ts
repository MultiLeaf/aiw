import { describe, expect, it } from "vitest";
import { triageAdvisories } from "./quality-gates.js";

const REPORT_WITHOUT_TRIAGE = `# Code Review

## Scope

The diff.

## Findings

F-1: Missing error handling in src/a.ts:12 (severity: medium).

## Checks

Tests reviewed.

## Residual Risks

None.

## Decision

Accept
`;

const REPORT_WITH_TRIAGE = REPORT_WITHOUT_TRIAGE.replace(
  "F-1: Missing error handling in src/a.ts:12 (severity: medium).",
  "F-1: Missing error handling in src/a.ts:12 (severity: medium) triage: auto-fixable",
);

const REPORT_WITH_NONE = REPORT_WITHOUT_TRIAGE.replace(
  "F-1: Missing error handling in src/a.ts:12 (severity: medium).",
  "None",
);

describe("finding triage advisories (REQ-004)", () => {
  it("warns (advisory only) when review findings lack a triage classification", () => {
    const advisories = triageAdvisories("review", REPORT_WITHOUT_TRIAGE);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toContain("Advisory");
    expect(advisories[0]).toContain("auto-fixable");
    expect(advisories[0]).toContain("judgment-required");
  });

  it("stays silent when findings carry a triage classification", () => {
    expect(triageAdvisories("review", REPORT_WITH_TRIAGE)).toEqual([]);
    expect(
      triageAdvisories("review", REPORT_WITH_TRIAGE.replace("auto-fixable", "judgment-required")),
    ).toEqual([]);
  });

  it("stays silent for empty findings and non-review stages", () => {
    expect(triageAdvisories("review", REPORT_WITH_NONE)).toEqual([]);
    expect(triageAdvisories("verification", REPORT_WITH_NONE)).toEqual([]);
    expect(triageAdvisories("specification", REPORT_WITHOUT_TRIAGE)).toEqual([]);
  });
});
