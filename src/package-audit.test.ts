import { describe, expect, it } from "vitest";
import { assertPackagePermissions, reviewPackagePermissions } from "./package-audit.js";
import type { PackageContract } from "./package-contract.js";

const pkg = { permissions: ["read:repository", "network:external"] } as PackageContract;

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
});
