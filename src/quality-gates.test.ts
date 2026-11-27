import { describe, expect, it } from "vitest";
import { evaluateQualityGate } from "./quality-gates.js";

describe("quality gates", () => {
  it("reports actionable missing brainstorming content", () => {
    expect(evaluateQualityGate("brainstorming", "# Idea\n\n## Goal\n\n")).toEqual([
      "Brainstorm section Goal must contain content.",
      "Brainstorm section Users is missing.",
      "Brainstorm section Constraints is missing.",
      "Brainstorm section Risks is missing.",
      "Brainstorm section Non-goals is missing.",
    ]);
  });

  it("gates the product-requirements artifact on its five sections", () => {
    expect(evaluateQualityGate("product-requirements", "# PRD\n\n## Problem\n\n")).toEqual([
      "PRD section Problem must contain content.",
      "PRD section Users is missing.",
      "PRD section Outcomes is missing.",
      "PRD section Non-goals is missing.",
      "PRD section Success Signals is missing.",
    ]);
    expect(
      evaluateQualityGate(
        "product-requirements",
        "# PRD\n\n## Problem\nP\n## Users\nU\n## Outcomes\nO\n## Non-goals\nN\n## Success Signals\nS\n",
      ),
    ).toEqual([]);
  });

  it("enforces the QA test matrix in plan and verification gates (REQ-003)", () => {
    const base =
      "TASK-001\nRequirement: REQ-001\nCode: src/a.ts\nTests: src/a.test.ts\nValidation: npm test\nEvidence: output\n";
    // Ratchet: plans without a Test Plan section pass unchanged.
    expect(evaluateQualityGate("plan", base)).toEqual([]);
    expect(
      evaluateQualityGate(
        "plan",
        `${base}\n## Test Plan\n\nTC-001: login flow (REQ-001)\nTC-002: logout flow (REQ-001)\n`,
      ),
    ).toEqual([]);
    expect(evaluateQualityGate("plan", `${base}\n## Test Plan\n\nTC-001: login flow\n`)).toEqual([
      "Test case TC-001 must link to at least one REQ-### requirement.",
    ]);
    expect(evaluateQualityGate("plan", `${base}\n## Test Plan\n\nNo cases yet\n`)).toEqual([
      "Test Plan must define TC-### cases linked to REQ-### requirements.",
    ]);

    const verification =
      "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n";
    // Ratchet: reports without a Test Results section pass unchanged.
    expect(evaluateQualityGate("verification", verification)).toEqual([]);
    expect(
      evaluateQualityGate(
        "verification",
        `${verification}\n## Test Results\n\nTC-001: pass (npm test)\nTC-002: pass (npm test)\n`,
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate("verification", `${verification}\n## Test Results\n\nTC-001: fail\n`),
    ).toEqual([
      "Test case TC-001 failed; resolve it before verification passes.",
      "Test case TC-001 must record a result (pass/fail).",
    ]);
    expect(
      evaluateQualityGate("verification", `${verification}\n## Test Results\n\nTC-001: unclear\n`),
    ).toEqual(["Test case TC-001 must record a result (pass/fail)."]);
  });

  it("requires ADR links for declared consequential decisions (REQ-004)", () => {
    const design =
      "## Context\nNeed\n## Proposed Design\nModule\n## Alternatives\nA or B\n## Interfaces\nAPI\n## Risks\nMigration\n## Validation\nTests\n";
    // Ratchet: designs without the section pass unchanged.
    expect(evaluateQualityGate("technical-design", design)).toEqual([]);
    expect(
      evaluateQualityGate("technical-design", `${design}\n## Consequential Decisions\n\nNone\n`),
    ).toEqual([]);
    expect(
      evaluateQualityGate(
        "technical-design",
        `${design}\n## Consequential Decisions\n\n- Strictness ordering — .context/adrs/ADR-101-policy-order.md\n`,
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate(
        "technical-design",
        `${design}\n## Consequential Decisions\n\n- Strictness ordering (no ADR yet)\n`,
      ),
    ).toEqual([
      "Consequential decision must link an existing ADR path (.context/adrs/ADR-*.md): - Strictness ordering (no ADR yet)",
    ]);
  });

  it("accepts complete artifacts and rejects incomplete specifications and plans", () => {
    const brainstorm =
      "## Goal\nShip safely\n## Users\nDevelopers\n## Constraints\nEnglish\n## Risks\nDrift\n## Non-goals\nUI\n";
    expect(evaluateQualityGate("brainstorming", brainstorm)).toEqual([]);
    expect(
      evaluateQualityGate(
        "specification",
        "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen planned\nThen it is testable\n",
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate("specification", "REQ-001\nAcceptance criteria\nGiven\nWhen\n"),
    ).toContain("Requirement acceptance criteria must use Given, When, and Then.");
    expect(
      evaluateQualityGate(
        "plan",
        "TASK-001\nRequirement: REQ-001\nCode: src/a.ts\nTests: src/a.test.ts\nValidation: npm test\nEvidence: output",
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate(
        "verification",
        "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate(
        "verification",
        "TASK-001\nRequirement: REQ-001\nCode: src/a.ts\nTests: src/a.test.ts\nValidation: npm test\nEvidence: output",
      ),
    ).toContain("Verification Report section Decision is missing.");
  });

  it.each(["Requirement", "Code", "Tests", "Validation", "Evidence"])(
    "rejects an empty %s task field without consuming the following line",
    (emptyField) => {
      const fields = ["Requirement", "Code", "Tests", "Validation", "Evidence"]
        .map((field) => `${field}:${field === emptyField ? "" : ` value-for-${field}`}`)
        .join("\n");

      expect(evaluateQualityGate("plan", `TASK-001\n${fields}`)).toContain(
        `Implementation plan task must define ${emptyField}.`,
      );
    },
  );

  it("requires reviewable technical design, implementation, review, and traceability evidence", () => {
    expect(
      evaluateQualityGate(
        "technical-design",
        "## Context\nNeed\n## Proposed Design\nModule\n## Alternatives\nA or B\n## Interfaces\nAPI\n## Risks\nMigration\n## Validation\nTests\n",
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate(
        "implementation",
        "## Changed Files\nsrc/a.ts\n## Tests\nnpm test\n## Validation\npassed\n## Deviations\nNone\n",
      ),
    ).toEqual([]);
    expect(
      evaluateQualityGate(
        "review",
        "## Scope\nDiff\n## Findings\nNone\n## Checks\nReviewed tests\n## Residual Risks\nNone\n## Decision\nAccept\n",
      ),
    ).toEqual([]);
    expect(evaluateQualityGate("implementation", "## Tests\nNo tests\n")).toContain(
      "Implementation Evidence section Changed Files is missing.",
    );
    expect(
      evaluateQualityGate(
        "traceability",
        "schema: 1\nlinks:\n  - requirement: REQ-001\n    tasks: [TASK-001]\n    decisions: []\n    code: [src/a.ts]\n    tests: [src/a.test.ts]\n    evidence: [npm test]\n",
      ),
    ).toEqual([]);
  });
});
