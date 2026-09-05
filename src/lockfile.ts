import type { PackageContract } from "./package-contract.js";

export type LockedPackage = {
  id: string;
  version: string;
  provider: string;
  source: string;
  integrity: string;
  permissions?: string[];
};

export function resolvePackage(pkg: PackageContract): LockedPackage {
  return {
    id: pkg.id,
    version: pkg.version,
    provider: pkg.provider,
    source: pkg.source,
    integrity: `sha256-${pkg.id}@${pkg.version}`,
    permissions: [...pkg.permissions].sort(),
  };
}

export function serializeLock(packages: LockedPackage[]): string {
  const ordered = [...packages].sort((a, b) => a.id.localeCompare(b.id));
  return `schema: 1\npackages:\n${ordered.map((pkg) => `  - id: ${pkg.id}\n    version: ${pkg.version}\n    provider: ${pkg.provider}\n    source: ${pkg.source}\n    integrity: ${pkg.integrity}\n    permissions: [${[...(pkg.permissions ?? [])].sort().join(", ")}]\n`).join("")}`;
}

export function parseLock(content: string): LockedPackage[] {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "schema: 1") throw new Error("Lockfile schema must be version 1.");
  if (lines[1] !== "packages:") throw new Error("Lockfile packages section is required.");
  const packages: LockedPackage[] = [];
  for (let index = 2; index < lines.length;) {
    const id = requiredLockValue(lines[index], /^ {2}- id: (.+)$/, "id");
    const version = requiredLockValue(lines[index + 1], /^ {4}version: (.+)$/, "version");
    const provider = requiredLockValue(lines[index + 2], /^ {4}provider: (.+)$/, "provider");
    const source = requiredLockValue(lines[index + 3], /^ {4}source: (.+)$/, "source");
    const integrity = requiredLockValue(lines[index + 4], /^ {4}integrity: (.+)$/, "integrity");
    index += 5;
    let permissions: string[] | undefined;
    if (lines[index]?.startsWith("    permissions:")) {
      const value = lines[index].match(/^ {4}permissions: \[([^\]]*)\]$/)?.[1];
      if (value === undefined) throw new Error(`Lockfile permissions are invalid: ${id}`);
      permissions = value === "" ? [] : value.split(",").map((permission) => permission.trim());
      if (permissions.some((permission) => permission.length === 0))
        throw new Error(`Lockfile permissions are invalid: ${id}`);
      index += 1;
    }
    packages.push({
      id,
      version,
      provider,
      source,
      integrity,
      ...(permissions ? { permissions } : {}),
    });
  }
  if (new Set(packages.map(({ id }) => id)).size !== packages.length)
    throw new Error("Lockfile package identifiers must be unique.");
  return packages;
}

function requiredLockValue(line: string | undefined, pattern: RegExp, field: string): string {
  const value = line?.match(pattern)?.[1]?.trim();
  if (!value) throw new Error(`Lockfile package field is invalid: ${field}`);
  return value;
}
