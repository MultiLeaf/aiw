import type { PackageContract } from "./package-contract.js";

export type LockedPackage = {
  id: string;
  version: string;
  provider: string;
  source: string;
  integrity: string;
};

export function resolvePackage(pkg: PackageContract): LockedPackage {
  return {
    id: pkg.id,
    version: pkg.version,
    provider: pkg.provider,
    source: pkg.source,
    integrity: `sha256-${pkg.id}@${pkg.version}`,
  };
}

export function serializeLock(packages: LockedPackage[]): string {
  const ordered = [...packages].sort((a, b) => a.id.localeCompare(b.id));
  return `schema: 1\npackages:\n${ordered.map((pkg) => `  - id: ${pkg.id}\n    version: ${pkg.version}\n    provider: ${pkg.provider}\n    source: ${pkg.source}\n    integrity: ${pkg.integrity}\n`).join("")}`;
}
