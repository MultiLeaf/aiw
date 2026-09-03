import { describe, expect, it } from "vitest";
import { evaluateQualityGate } from "./quality-gates.js";

describe("quality gates", () => {
  it("reports actionable missing brainstorming content", () => {
    expect(evaluateQualityGate("specification", "# Idea\n\n## Goal\n\n")).toEqual([
      "Brainstorm section Goal must contain content.",
      "Brainstorm section Users is missing.",
      "Brainstorm section Constraints is missing.",
      "Brainstorm section Risks is missing.",
      "Brainstorm section Non-goals is missing.",
    ]);
  });

  it("accepts complete artifacts and rejects incomplete specifications and plans", () => {
    const brainstorm =
      "## Goal\nShip safely\n## Users\nDevelopers\n## Constraints\nEnglish\n## Risks\nDrift\n## Non-goals\nUI\n";
    expect(evaluateQualityGate("specification", brainstorm)).toEqual([]);
    expect(evaluateQualityGate("plan", "REQ-001\nAcceptance criteria\nGiven\nWhen\n")).toContain(
      "Requirement acceptance criteria must use Given, When, and Then.",
    );
    expect(
      evaluateQualityGate(
        "verification",
        "TASK-001\nRequirement: REQ-001\nCode: src/a.ts\nTests: src/a.test.ts\nValidation: npm test\nEvidence: output",
      ),
    ).toEqual([]);
  });

  it.each(["Requirement", "Code", "Tests", "Validation", "Evidence"])(
    "rejects an empty %s task field without consuming the following line",
    (emptyField) => {
      const fields = ["Requirement", "Code", "Tests", "Validation", "Evidence"]
        .map((field) => `${field}:${field === emptyField ? "" : ` value-for-${field}`}`)
        .join("\n");

      expect(evaluateQualityGate("verification", `TASK-001\n${fields}`)).toContain(
        `Implementation plan task must define ${emptyField}.`,
      );
    },
  );
});
