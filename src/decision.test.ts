import { describe, expect, it } from "vitest";
import {
  buildEvidenceTriageRequest,
  buildRecommendationRankingRequest,
  buildSemanticRerankRequest,
  parseDecisionConfig,
  parseDecisionResponse,
} from "./decision.js";

describe("decision configuration", () => {
  it("disables the decision model when enabled is false", () => {
    const config = parseDecisionConfig("decision:\n  enabled: false\n");
    expect(config.enabled).toBe(false);
    expect(config.model).toBe("clef-flash:latest");
  });

  it("requires a model and http(s) base URL when enabled", () => {
    const config = parseDecisionConfig(
      "decision:\n  enabled: true\n  model: clef-flash:latest\n  baseUrl: http://localhost:11434\n",
    );
    expect(config.enabled).toBe(true);
    expect(config.model).toBe("clef-flash:latest");
    expect(() => parseDecisionConfig("decision:\n  enabled: true\n")).toThrow(/model/);
    expect(() =>
      parseDecisionConfig("decision:\n  enabled: true\n  model: m\n  baseUrl: ftp://h\n"),
    ).toThrow(/baseUrl/);
    expect(() => parseDecisionConfig("decision:\n  enabled: maybe\n")).toThrow(/boolean/);
    expect(() => parseDecisionConfig("other: true\n")).toThrow(/decision/);
  });
});

describe("decision response parsing", () => {
  it("parses noul and choice answers", () => {
    const response = parseDecisionResponse(
      JSON.stringify({
        model: "clef-flash:latest",
        answers: {
          evidence_complete: { type: "noul", noul: 0.02 },
          gate: { type: "choice", choice: "needs-work", confidence: 0.75 },
        },
      }),
    );
    expect(response.answers.evidence_complete?.noul).toBeCloseTo(0.02);
    expect(response.answers.gate?.choice).toBe("needs-work");
  });

  it("rejects malformed responses", () => {
    expect(() => parseDecisionResponse("{}")).toThrow(/Invalid decision response/);
    expect(() =>
      parseDecisionResponse(JSON.stringify({ model: "m", answers: { bad: { type: "weird" } } })),
    ).toThrow(/Invalid decision answer type/);
  });
});

describe("evidence triage request", () => {
  it("asks one completeness question and one advisory gate question", () => {
    const request = buildEvidenceTriageRequest("Plan: implement login. Evidence: none.");
    expect(Object.keys(request.questions)).toEqual(["evidence_complete", "gate"]);
    expect(request.questions.evidence_complete?.type).toBe("noul");
    const gate = request.questions.gate;
    if (gate?.type !== "choice") throw new Error("gate must be a choice question");
    expect(Object.keys(gate.criteria)).toContain("ready");
    expect(Object.keys(gate.criteria)).toContain("needs-work");
  });
});

describe("semantic rerank request", () => {
  it("builds one score question per candidate with the query", () => {
    const request = buildSemanticRerankRequest("how does install work", [
      { id: "match_0", text: "src/install.ts\ninstalls idempotently" },
      { id: "match_1", text: "docs/readme.md\nreadme" },
    ]);
    expect(request.state).toContain("how does install work");
    expect(Object.keys(request.questions)).toEqual(["match_0", "match_1"]);
    const first = request.questions.match_0;
    if (first?.type !== "score") throw new Error("expected score questions");
    expect(first.instructions).toContain("how does install work");
    expect(first.instructions).toContain("src/install.ts");
    expect(first.criteria).toHaveLength(2);
  });
});

describe("recommendation ranking request", () => {
  it("builds one score question per recommendation with the profile summary", () => {
    const request = buildRecommendationRankingRequest("languages: typescript; testing: vitest", [
      {
        id: "tdd-development",
        rationale: "Test-first with existing runner",
        evidence: ["testing:vitest"],
      },
      { id: "security-review", rationale: "Security review", evidence: ["language:typescript"] },
    ]);
    expect(request.state).toContain("languages: typescript");
    expect(Object.keys(request.questions)).toEqual(["tdd-development", "security-review"]);
    const question = request.questions["tdd-development"];
    if (question?.type !== "score") throw new Error("expected score questions");
    expect(question.instructions).toContain("languages: typescript");
    expect(question.instructions).toContain("Test-first with existing runner");
    expect(question.instructions).toContain("testing:vitest");
  });
});
