import { describe, expect, it } from "vitest";
import { collectSignals } from "./signals.js";
import { parseDrafts, validateDrafts } from "./validate.js";

const bundle = collectSignals([
  "build.gradle.kts",
  "gradlew",
  "src/main/java/App.java",
  "src/test/java/AppTest.java",
]);

const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "rule",
  signature: "gradle-test-before-done",
  title: "Run Gradle tests before completing",
  outline: "Require ./gradlew test before any task completion.",
  evidence: ["fact-001", "fact-002"],
  ...overrides,
});

describe("draft contract validation", () => {
  it("accepts well-formed drafts (fake agent output)", () => {
    const result = validateDrafts([record()], bundle, []);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
  });

  it("rejects records with missing required fields", () => {
    const result = validateDrafts([record({ title: undefined, outline: "" })], bundle, []);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toHaveLength(2);
    expect(result.errors[0]?.reason.join(" ")).toContain("title");
    expect(result.errors[0]?.reason.join(" ")).toContain("outline");
  });

  it("rejects evidence refs that do not resolve into the bundle (REQ-001)", () => {
    const result = validateDrafts([record({ evidence: ["fact-999"] })], bundle, []);
    expect(result.errors[0]?.reason.join(" ")).toContain("fact-999");
  });

  it("rejects unknown kinds", () => {
    const result = validateDrafts([record({ kind: "macro" })], bundle, []);
    expect(result.errors[0]?.reason.join(" ")).toContain("kind");
  });

  it("flags overlap with an existing catalog resource (REQ-006)", () => {
    const result = validateDrafts(
      [record({ kind: "skill", title: "Code review checklist for Gradle" })],
      bundle,
      ["skills/code-review"],
    );
    expect(result.overlaps).toContainEqual({
      signature: "gradle-test-before-done",
      catalogId: "skills/code-review",
    });
  });

  it("parses the agent draft file format", () => {
    const drafts = parseDrafts(
      "- kind: skill\n  signature: sig-a\n  title: A\n  outline: Do A.\n  evidence: [fact-001]\n",
    );
    expect(drafts).toEqual([
      { kind: "skill", signature: "sig-a", title: "A", outline: "Do A.", evidence: ["fact-001"] },
    ]);
  });
});
