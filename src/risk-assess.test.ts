import { describe, expect, it } from "vitest";
import {
  applyEscalation,
  assessRisk,
  RISK_CATEGORIES,
  type ChangedFile,
  type RiskAssessment,
} from "./risk-assess.js";

const file = (path: string): ChangedFile => ({ path });

describe("risk tiers by changed content", () => {
  it("classifies documentation-only changes as passive with no reasons", () => {
    const assessment = assessRisk([
      file("README.md"),
      file("docs/opportunities/OPP-001-proportional-ceremony-light-lane.md"),
      file("CHANGELOG.md"),
      file("LICENSE"),
    ]);
    expect(assessment.tier).toBe("passive");
    expect(assessment.reasons).toEqual([]);
  });

  it("classifies a plain code change with no high-risk category as medium", () => {
    const assessment = assessRisk([file("src/utils/format.ts")]);
    expect(assessment.tier).toBe("medium");
    expect(assessment.reasons).toEqual([]);
  });

  it("classifies mixed documentation and code as at least medium", () => {
    const assessment = assessRisk([file("README.md"), file("src/utils/format.ts")]);
    expect(assessment.tier).toBe("medium");
  });

  it("classifies an authentication path change as high with a security reason", () => {
    const assessment = assessRisk([file("src/auth/service-token.ts")]);
    expect(assessment.tier).toBe("high");
    expect(assessment.reasons).toContainEqual({
      code: "security",
      path: "src/auth/service-token.ts",
    });
  });

  it("classifies a migration as high with a data reason", () => {
    const assessment = assessRisk([file("db/migrations/0001-add-users.sql")]);
    expect(assessment.tier).toBe("high");
    expect(assessment.reasons).toContainEqual({
      code: "data_irreversible",
      path: "db/migrations/0001-add-users.sql",
    });
  });

  it("classifies a public contract change as high", () => {
    const assessment = assessRisk([file("package.json"), file("dist/plugin-sdk.d.ts")]);
    expect(assessment.tier).toBe("high");
    expect(assessment.reasons).toContainEqual({
      code: "consumed_contract",
      path: "package.json",
    });
  });

  it("classifies a concurrency-related path as high", () => {
    const assessment = assessRisk([file("src/orchestration/worker-pool.ts")]);
    expect(assessment.tier).toBe("high");
    expect(assessment.reasons).toContainEqual({
      code: "concurrency",
      path: "src/orchestration/worker-pool.ts",
    });
  });

  it("classifies a delivery or environment change as high", () => {
    const assessment = assessRisk([
      file(".github/workflows/ci.yml"),
      file("scripts/release-check.mjs"),
    ]);
    expect(assessment.tier).toBe("high");
    expect(assessment.reasons).toContainEqual({
      code: "delivery_environment",
      path: ".github/workflows/ci.yml",
    });
  });

  it("collects every matching category for one path", () => {
    const assessment = assessRisk([file("src/auth/login-worker.ts")]);
    expect(assessment.tier).toBe("high");
    const codes = assessment.reasons.map((reason) => reason.code);
    expect(codes).toContain("security");
    expect(codes).toContain("concurrency");
  });

  it("counts changed paths without letting size decide the tier", () => {
    const thousandDocLines = Array.from({ length: 1000 }, (_, index) =>
      file(`docs/part-${index}.md`),
    );
    expect(assessRisk(thousandDocLines).tier).toBe("passive");
  });

  it("keeps test files out of the high-risk categories", () => {
    const assessment = assessRisk([file("src/auth/service-token.test.ts")]);
    expect(assessment.tier).toBe("medium");
  });

  it("preserves the full path of tracked-modified files (porcelain column)", () => {
    // Regression: trimming porcelain lines before slicing the fixed-width
    // column turned ` M src/auth/token.ts` into `rc/auth/token.ts`.
    const assessment = assessRisk([file("src/auth/token.ts")]);
    expect(assessment.changedPaths).toEqual(["src/auth/token.ts"]);
  });

  it("ignores workflow-managed .aiw state paths", () => {
    const assessment = assessRisk([
      file(".aiw/lock.yml"),
      file(".aiw/checkpoints/task-light-x.yml"),
      file("src/utils/format.ts"),
    ]);
    expect(assessment.tier).toBe("medium");
    expect(assessment.reasons).toEqual([]);
    expect(assessment.changedPaths).toHaveLength(3);
  });
});

describe("untested regression category", () => {
  it("flags a source change with no covering test as high", () => {
    const assessment = assessRisk([file("src/billing/invoice.ts")], {
      hasCoveringTest: () => false,
    });
    expect(assessment.tier).toBe("high");
    expect(assessment.reasons).toContainEqual({
      code: "untested_regression",
      path: "src/billing/invoice.ts",
    });
  });

  it("does not flag a source change when a covering test exists", () => {
    const assessment = assessRisk([file("src/billing/invoice.ts")], {
      hasCoveringTest: () => true,
    });
    expect(assessment.tier).toBe("medium");
  });

  it("ignores the category when no test knowledge is provided", () => {
    const assessment = assessRisk([file("src/billing/invoice.ts")]);
    expect(assessment.tier).toBe("medium");
    expect(assessment.reasons).toEqual([]);
  });
});

describe("agent escalation", () => {
  const medium: RiskAssessment = { tier: "medium", reasons: [], changedPaths: ["src/x.ts"] };

  it("raises a medium assessment to high with an agent escalation reason", () => {
    const escalated = applyEscalation(medium, 2, "touches session validation");
    expect(escalated.tier).toBe("high");
    expect(escalated.reasons).toContainEqual({
      code: "agent_escalation",
      detail: "item 2: security — touches session validation",
    });
  });

  it("raises a passive assessment to high", () => {
    const passive: RiskAssessment = {
      tier: "passive",
      reasons: [],
      changedPaths: ["README.md"],
    };
    expect(applyEscalation(passive, 1, "irreversible data import").tier).toBe("high");
  });

  it("never lowers a high assessment and still records the reason", () => {
    const high: RiskAssessment = {
      tier: "high",
      reasons: [{ code: "security", path: "src/auth.ts" }],
      changedPaths: ["src/auth.ts"],
    };
    const escalated = applyEscalation(high, 6, "no test covers this path");
    expect(escalated.tier).toBe("high");
    expect(escalated.reasons).toHaveLength(2);
  });

  it("rejects invalid escalation inputs", () => {
    expect(() => applyEscalation(medium, 0, "reason")).toThrow(/item/);
    expect(() => applyEscalation(medium, 7, "reason")).toThrow(/item/);
    expect(() => applyEscalation(medium, 2, "")).toThrow(/reason/i);
    expect(() => applyEscalation(medium, 2, "a".repeat(501))).toThrow(/500/);
    expect(() => applyEscalation(medium, 2, "two\nlines")).toThrow(/single line/i);
  });

  it("accepts a reason of exactly 500 bytes", () => {
    expect(applyEscalation(medium, 2, "a".repeat(500)).tier).toBe("high");
  });
});

describe("risk category catalog", () => {
  it("documents all six high-risk items with descriptions", () => {
    expect(RISK_CATEGORIES.map((category) => category.item)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const category of RISK_CATEGORIES) {
      expect(category.description.length).toBeGreaterThan(0);
    }
  });
});
