import { describe, expect, it } from "vitest";
import { checksumPackage, verifyPackageProvenance } from "./package-integrity.js";

describe("package integrity", () => {
  it("creates a reproducible SHA-256 checksum", () => {
    expect(checksumPackage("package")).toBe(checksumPackage("package"));
    expect(checksumPackage("package")).toHaveLength(64);
  });

  it("rejects tampered content and verifies optional signatures", () => {
    const content = "trusted package";
    const checksum = checksumPackage(content);
    expect(() => verifyPackageProvenance("tampered", { checksum })).toThrow("checksum mismatch");
    expect(() => verifyPackageProvenance(content, { checksum, signature: "sig" })).toThrow(
      "configured verifier",
    );
    expect(() =>
      verifyPackageProvenance(content, { checksum, signature: "sig" }, () => true),
    ).not.toThrow();
    expect(() =>
      verifyPackageProvenance(content, { checksum, signature: "sig" }, () => false),
    ).toThrow("signature verification");
  });
});
