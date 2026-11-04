/**
 * OPP-018: supported migration path for legacy (pre-ownership) installations.
 *
 * Installations older than the ownership inventory (~≤0.9.x) entered a closed
 * loop: install preserves, uninstall refuses (ownership unverifiable), repair
 * ignores, sync demands ownership. `aiw migrate` breaks the loop with a
 * transactional, rollback-protected move to the modern state — archival never
 * deletes, ambiguity fails closed, and user configuration stays byte-identical.
 */

import { join } from "node:path";
import { createOwnedFile, serializeOwnership, type OwnedFile } from "./ownership.js";
import type { FileSystem } from "./types.js";

// lock.yml and recommendations.yml are LIVE files: their owning commands
// (`aiw recommend`, `aiw skills install`, `aiw sync`) rewrite them in the
// modern format, so migration leaves them in place rather than archiving.
const SUPERSEDED_FILES: string[] = [];
const PRESERVED_CONFIG = [
  "decision.yml",
  "semantic.yml",
  "organization.yml",
  "heartbeats.yml",
  "settings.yml",
  "usage.yml",
  "profile.yml",
];
const PRESERVED_DIRECTORIES = ["checkpoints", "generated", "context", "semantic", "resources"];

export function detectLegacyState(aiw: string, fs: FileSystem): boolean {
  return (
    fs.exists(join(aiw, "manifest.yml")) &&
    fs.exists(join(aiw, "lock.yml")) &&
    !fs.exists(join(aiw, "ownership.yml"))
  );
}

export type MigrationPlan = {
  archived: string[];
  preserved: string[];
  rebuilt: string[];
  /** Managed files that differ from shipped content — preserved as sync conflicts for manual review. */
  userModified: string[];
  manualActions: string[];
  rollbackSnapshot: string;
};

function listEntries(fs: FileSystem, directory: string): string[] {
  return fs.list?.(directory) ?? [];
}

/**
 * Classify the legacy layout. Managed candidates recorded in the rebuilt
 * ownership inventory with their CURRENT disk content — sync then treats stale
 * resources as safe updates, and anything that diverges from the shipped
 * content is reported for manual review instead of being silently overwritten.
 */
export function planLegacyMigration(
  root: string,
  aiw: string,
  fs: FileSystem,
  managedCandidates: { path: string; bundled?: string }[],
  now = new Date().toISOString(),
): MigrationPlan {
  const archived = SUPERSEDED_FILES.filter((name) => fs.exists(join(aiw, name))).map(
    (name) => `.aiw/${name}`,
  );
  const preserved = PRESERVED_CONFIG.filter((name) => fs.exists(join(aiw, name))).map(
    (name) => `.aiw/${name}`,
  );
  for (const directory of PRESERVED_DIRECTORIES) {
    if (fs.pathType?.(join(aiw, directory)) === "directory") {
      preserved.push(`.aiw/${directory}/`);
    }
  }
  const known = new Set([
    "manifest.yml",
    "ownership.yml",
    "migration-report.yml",
    "lock.yml",
    "recommendations.yml",
    ...PRESERVED_CONFIG,
    ...PRESERVED_DIRECTORIES.map((directory) => `${directory}/`),
  ]);
  const manualActions: string[] = [];
  for (const entry of listEntries(fs, aiw)) {
    const isDirectory = fs.pathType?.(join(aiw, entry)) === "directory";
    const key = isDirectory ? `${entry}/` : entry;
    if (!known.has(key))
      manualActions.push(`.aiw/${key} — unrecognized legacy entry; classify or remove manually`);
  }
  const rebuilt: string[] = [];
  const userModified: string[] = [];
  const rollbackSnapshot = join(aiw, "checkpoints", `migration-${now.replace(/[:.]/g, "-")}`);
  for (const candidate of managedCandidates) {
    const relativePath = candidate.path.startsWith(`${root}/`)
      ? candidate.path.slice(root.length + 1)
      : candidate.path;
    if (!fs.exists(candidate.path)) continue;
    rebuilt.push(relativePath);
    if (candidate.bundled !== undefined && fs.read(candidate.path) !== candidate.bundled) {
      userModified.push(
        `${relativePath} — legacy-user-modified (differs from shipped content); sync will preserve it as a conflict for manual review`,
      );
    }
  }
  return {
    archived,
    preserved,
    rebuilt,
    userModified,
    manualActions,
    rollbackSnapshot,
  };
}

export type ManagedCandidate = {
  /** Absolute path of the managed candidate file. */
  path: string;
  /** Current shipped content when identifiable; checksum semantics depend on it:
   *  disk == bundled → owned as disk (sync may update safely);
   *  disk != bundled → owned as bundled (sync preserves as a conflict for
   *  manual review — legacy-user-modified, never silently overwritten). */
  bundled?: string;
  metadata?: Parameters<typeof createOwnedFile>[2];
};

/** Apply the migration: snapshot, archive superseded files, rebuild ownership. */
export function applyMigration(
  root: string,
  aiw: string,
  fs: FileSystem,
  managedCandidates: ManagedCandidate[],
  plan: MigrationPlan,
): void {
  if (plan.manualActions.length > 0)
    throw new Error(`Migration requires manual action first: ${plan.manualActions.join("; ")}`);
  // Transactional snapshot of everything the migration touches.
  const snapshot = plan.rollbackSnapshot;
  fs.mkdir(snapshot);
  fs.mkdir(join(snapshot, "original"));
  for (const name of PRESERVED_CONFIG) {
    const path = join(aiw, name);
    if (fs.exists(path)) fs.write(join(snapshot, "original", name), fs.read(path));
  }
  const ownershipEntries: OwnedFile[] = [];
  for (const candidate of managedCandidates) {
    if (!fs.exists(candidate.path)) continue;
    const relativePath = candidate.path.startsWith(`${root}/`)
      ? candidate.path.slice(root.length + 1)
      : candidate.path;
    const disk = fs.read(candidate.path);
    fs.write(join(snapshot, "original", candidate.path), disk);
    const ownedContent =
      candidate.bundled !== undefined && disk !== candidate.bundled ? candidate.bundled : disk;
    ownershipEntries.push(createOwnedFile(relativePath, ownedContent, candidate.metadata));
  }
  for (const name of SUPERSEDED_FILES) {
    const path = join(aiw, name);
    if (fs.exists(path)) {
      fs.write(join(snapshot, "original", name), fs.read(path));
      fs.remove?.(path);
    }
  }
  fs.write(join(aiw, "ownership.yml"), serializeOwnership(ownershipEntries));
  // Normalize legacy manifests: the modern doctor requires the English
  // artifact-language policy, which ancient manifests never carried.
  const manifestPath = join(aiw, "manifest.yml");
  if (fs.exists(manifestPath)) {
    const manifest = fs.read(manifestPath);
    if (!manifest.includes("artifact_language")) {
      fs.write(
        manifestPath,
        `${manifest.replace(/\n*$/, "")}\npolicies:\n  artifact_language: en\n`,
      );
    }
  }
  fs.write(
    join(aiw, "migration-report.yml"),
    [
      "schema: 1",
      `archived: [${plan.archived.map((entry) => JSON.stringify(entry)).join(", ")}]`,
      `preserved: [${plan.preserved.map((entry) => JSON.stringify(entry)).join(", ")}]`,
      `rebuilt: [${plan.rebuilt.map((entry) => JSON.stringify(entry)).join(", ")}]`,
      `manualActions: [${plan.manualActions.map((entry) => JSON.stringify(entry)).join(", ")}]`,
      `userModified: [${plan.userModified.map((entry) => JSON.stringify(entry)).join(", ")}]`,
      `rollbackSnapshot: ${JSON.stringify(snapshot)}`,
      "",
    ].join("\n"),
  );
}

/** Restore the latest migration snapshot atomically. */
export function rollbackMigration(root: string, aiw: string, fs: FileSystem): string {
  const base = join(aiw, "checkpoints");
  const snapshots = (fs.list?.(base) ?? [])
    .filter((entry) => entry.startsWith("migration-"))
    .sort()
    .reverse();
  if (snapshots.length === 0) throw new Error("No migration snapshot found; nothing to roll back.");
  const snapshot = join(base, snapshots[0], "original");
  // Remove files the migration itself created (the snapshot originals never
  // contained them): ownership + report. Unwinding a later sync is out of scope.
  fs.remove?.(join(aiw, "ownership.yml"));
  fs.remove?.(join(aiw, "migration-report.yml"));
  for (const entry of listEntries(fs, snapshot)) {
    const source = join(snapshot, entry);
    if (fs.pathType?.(source) === "directory") {
      copyDirectory(fs, source, join(aiw, entry));
    } else {
      fs.write(join(aiw, entry), fs.read(source));
    }
  }
  return join(base, snapshots[0]);
}

function copyDirectory(fs: FileSystem, source: string, target: string): void {
  fs.mkdir(target);
  for (const entry of listEntries(fs, source)) {
    const sourcePath = join(source, entry);
    const targetPath = join(target, entry);
    if (fs.pathType?.(sourcePath) === "directory") copyDirectory(fs, sourcePath, targetPath);
    else fs.write(targetPath, fs.read(sourcePath));
  }
}
