import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest.js";

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
});
