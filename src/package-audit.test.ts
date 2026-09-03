import { describe, expect, it } from "vitest";
import {
  assertPackagePermissions,
  reviewPackagePermissions,
  serializePermissionReview,
} from "./package-audit.js";
import type { PackageContract } from "./package-contract.js";

const pkg = {
  id: "example/package",
  version: "1.0.0",
  permissions: ["read:repository", "network:external"],
} as PackageContract;

describe("package permission audit", () => {
  it("approves only explicitly allowlisted permissions", () => {
    expect(reviewPackagePermissions(pkg, ["read:repository"]).unapproved).toEqual([
      "network:external",
    ]);
    expect(() => assertPackagePermissions(pkg, ["read:repository"])).toThrow("network:external");
    expect(() =>
      assertPackagePermissions(pkg, ["read:repository", "network:external"]),
    ).not.toThrow();
  });

  it("rejects unknown permissions and serializes a deterministic risk review", () => {
    expect(serializePermissionReview(pkg)).toBe(
      "Package permission review: example/package@1.0.0\n- network:external (high)\n- read:repository (low)\nDecision: explicit approval required\n",
    );
    expect(() =>
      assertPackagePermissions({ permissions: ["system:root"] } as PackageContract, [
        "system:root",
      ]),
    ).toThrow("Unknown package permissions: system:root");
  });
});
