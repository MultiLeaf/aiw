import type { PackageContract } from "./package-contract.js";

export type PermissionReview = {
  allowed: boolean;
  requested: string[];
  unapproved: string[];
};

export function reviewPackagePermissions(
  pkg: PackageContract,
  approved: string[],
): PermissionReview {
  const unapproved = pkg.permissions.filter((permission) => !approved.includes(permission));
  return { allowed: unapproved.length === 0, requested: [...pkg.permissions], unapproved };
}

export function assertPackagePermissions(pkg: PackageContract, approved: string[]): void {
  const review = reviewPackagePermissions(pkg, approved);
  if (!review.allowed)
    throw new Error(`Package permissions require approval: ${review.unapproved.join(", ")}`);
}
