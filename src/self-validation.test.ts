import { describe, expect, it } from "vitest";
import { serializeSelfValidationEvidence, validateTicketId } from "./self-validation.js";

describe("self-validation evidence", () => {
  it("serializes deterministic repository evidence", () => {
    expect(
      serializeSelfValidationEvidence({
        ticket: "FND-009",
        command: "npm --prefix /project run check",
        exitCode: 0,
        requiredState: [".aiw/profile.yml", ".aiw/manifest.yml"],
        generatedArtifacts: ["specs/specification.md"],
      }),
    ).toContain("required_state:\n  - .aiw/manifest.yml\n  - .aiw/profile.yml");
  });

  it("rejects unsafe ticket identifiers", () => {
    expect(() => validateTicketId("../../unsafe")).toThrow("TYPE-000");
  });
});
