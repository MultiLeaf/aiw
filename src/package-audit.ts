import type { PackageContract } from "./package-contract.js";

export type PermissionReview = {
  allowed: boolean;
  requested: string[];
  unapproved: string[];
};

export const PACKAGE_PERMISSIONS = {
  "read:repository": "low",
  "filesystem:read": "low",
  "filesystem:write": "high",
  "network:external": "high",
  "environment:read": "high",
  "process:execute": "critical",
} as const;
export type PackagePermission = keyof typeof PACKAGE_PERMISSIONS;

export function assertKnownPermissions(permissions: string[]): void {
  const unknown = permissions.filter((permission) => !(permission in PACKAGE_PERMISSIONS));
  if (unknown.length) throw new Error(`Unknown package permissions: ${unknown.join(", ")}`);
}

export function reviewPackagePermissions(
  pkg: PackageContract,
  approved: string[],
): PermissionReview {
  assertKnownPermissions(pkg.permissions);
  const unapproved = pkg.permissions.filter((permission) => !approved.includes(permission));
  return { allowed: unapproved.length === 0, requested: [...pkg.permissions], unapproved };
}

export function serializePermissionReview(pkg: PackageContract): string {
  reviewPackagePermissions(pkg, []);
  const permissions = [...pkg.permissions].sort();
  return `Package permission review: ${pkg.id}@${pkg.version}\n${permissions.length ? permissions.map((permission) => `- ${permission} (${PACKAGE_PERMISSIONS[permission as PackagePermission]})`).join("\n") : "- none"}\nDecision: ${permissions.length ? "explicit approval required" : "no permissions requested"}\n`;
}

export function assertPackagePermissions(pkg: PackageContract, approved: string[]): void {
  const review = reviewPackagePermissions(pkg, approved);
  if (!review.allowed)
    throw new Error(`Package permissions require approval: ${review.unapproved.join(", ")}`);
}
