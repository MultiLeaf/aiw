import type { PackageContract } from "./package-contract.js";

export type UpdateStatus = "update" | "current" | "incompatible" | "conflict";
export type UpdatePlan = { status: UpdateStatus; reason?: string };

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function planPackageUpdate(
  current: { id: string; version: string } | undefined,
  candidate: PackageContract,
  target: string,
  lockedVersions: Map<string, string> = new Map(),
): UpdatePlan {
  const supportedTargets = (candidate as PackageContract & { targets?: string[] }).targets;
  if (
    supportedTargets &&
    !supportedTargets.includes(target) &&
    !supportedTargets.includes("universal")
  )
    return {
      status: "incompatible",
      reason: `${candidate.id} does not support target '${target}'.`,
    };
  const dependencyConflict = candidate.dependencies.find((dependency) => {
    const locked = lockedVersions.get(dependency);
    return locked !== undefined && compareVersions(locked, candidate.version) !== 0;
  });
  if (dependencyConflict)
    return {
      status: "conflict",
      reason: `Dependency '${dependencyConflict}' is locked at an incompatible version.`,
    };
  if (current && compareVersions(candidate.version, current.version) <= 0)
    return { status: "current", reason: `${candidate.id} is already at ${current.version}.` };
  return { status: "update" };
}
