import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validatePackageContract } from "./package-contract.js";

describe("package contract", () => {
  it("validates the self-hosting package contract", () => {
    const contract = validatePackageContract(readFileSync("resources/package.yaml", "utf8"));
    expect(contract.version).toBe("0.1.0");
    expect(contract.resources.skills.length).toBeGreaterThan(0);
  });

  it("rejects packages without provenance and permissions", () => {
    expect(() =>
      validatePackageContract(
        "schema: 1\nid: demo\nversion: 1.0.0\nprovider: local\nsource: .\nresources:\ndependencies: []\n",
      ),
    ).toThrow("permissions");
  });
});
