import { describe, expect, it } from "vitest";
import { parseManifest, serializeManifest } from "./manifest.js";

describe("manifest contract", () => {
  it("parses a valid versioned manifest", () => {
    expect(
      parseManifest(
        "schema: 1\nproject:\n  name: demo\ntarget:\n  active: codex\npolicies:\n  artifact_language: en\n",
      ).target.active,
    ).toBe("codex");
  });

  it("rejects invalid schema and target", () => {
    expect(() =>
      parseManifest(
        "schema: 2\nproject:\n  name: demo\ntarget:\n  active: codex\npolicies:\n  artifact_language: en",
      ),
    ).toThrow("schema");
    expect(() =>
      parseManifest(
        "schema: 1\nproject:\n  name: demo\ntarget:\n  active: unknown\npolicies:\n  artifact_language: en",
      ),
    ).toThrow("unsupported");
  });

  it("reports actionable errors for missing required fields", () => {
    expect(() => parseManifest("schema: 1\n")).toThrow("project.name is required");
    expect(() => parseManifest("schema: 1\nproject:\n  name: demo\n")).toThrow(
      "target.active is unsupported: missing",
    );
    expect(() =>
      parseManifest("schema: 1\nproject:\n  name: demo\ntarget:\n  active: codex\n"),
    ).toThrow("artifact_language must be en");
  });

  it("serializes the canonical versioned shape", () => {
    expect(
      serializeManifest({
        schema: 1,
        project: { name: "demo" },
        target: { active: "codex" },
        policies: { artifactLanguage: "en" },
      }),
    ).toContain("schema: 1\nproject:");
  });
});
