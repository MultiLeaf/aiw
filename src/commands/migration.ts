import { join, relative, resolve, sep } from "node:path";
import {
  describeResource,
  detectTarget,
  isTarget,
  normalizeTarget,
  renderAiInit,
  renderAiInitPath,
  renderResourcePath,
} from "../adapter.js";
import { loadBundledResources } from "../bundled-resources.js";
import { debugLog } from "../debug.js";
import { assertSafeProjectPath } from "../files.js";
import {
  applyMigration,
  detectLegacyState,
  planLegacyMigration,
  rollbackMigration,
  type ManagedCandidate,
} from "../legacy-migration.js";
import { parseManifest, serializeManifest } from "../manifest.js";
import {
  parseMigrationCheckpoint,
  planNeutralResourceMigration,
  readResourceBytes,
  serializeMigrationCheckpoint,
  serializeMigrationPreview,
  validateNeutralResourceDocument,
  writeResourceBytes,
  type MigrationDiagnostic,
  type MigrationSnapshot,
  type ResourceMigration,
} from "../migration.js";
import { createOwnedFile, parseOwnership, serializeOwnership } from "../ownership.js";
import { checksumPackage } from "../package-integrity.js";
import type { CommandResult } from "../types.js";
import {
  applyProjectFileChanges,
  expectedMigrationSnapshots,
  installationRequired,
  migrationSnapshotMatches,
  snapshotProjectFiles,
} from "./shared.js";
import type { CommandContext, CommandHandler, ProjectFileChange } from "./types.js";

function handleTarget({ args, root, aiw, fs }: CommandContext): CommandResult {
  const rawTarget = args[1];
  if (!rawTarget) return { exitCode: 1, error: "Usage: aiw target <target>" };
  const target = normalizeTarget(rawTarget);
  if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
  const manifestPath = join(aiw, "manifest.yml");
  if (!fs.exists(manifestPath)) return installationRequired();
  const dryRun = args.includes("--dry-run");
  const targetPath = join(root, renderAiInitPath(target));
  const neutralAiInit = join(aiw, "resources/skills/ai-init.md");
  assertSafeProjectPath(fs, root, manifestPath);
  const manifest = parseManifest(fs.read(manifestPath));
  const previousTarget = manifest.target.active;
  const previousTargetPath = join(root, renderAiInitPath(previousTarget));
  const inventoryPath = join(aiw, "ownership.yml");
  if (!fs.exists(inventoryPath))
    return {
      exitCode: 1,
      error: "AIW ownership inventory is required for safe target migration.",
    };
  assertSafeProjectPath(fs, root, inventoryPath);
  if (fs.pathType?.(inventoryPath) !== "file")
    return { exitCode: 1, error: "AIW ownership inventory is not a regular project file." };
  const inventory = parseOwnership(fs.read(inventoryPath));
  const ownedByPath = new Map(inventory.map((entry) => [entry.path, entry]));
  const resourceRoot = join(aiw, "resources");
  if (fs.exists(resourceRoot)) assertSafeProjectPath(fs, root, resourceRoot);
  const relativeFiles = fs.exists(resourceRoot)
    ? (fs.listFiles?.(resourceRoot) ?? []).filter((path) => path !== "skills/ai-init.md")
    : [];
  const plan = planNeutralResourceMigration(resourceRoot, relativeFiles ?? [], target);
  const diagnostics: MigrationDiagnostic[] = [...plan.diagnostics];
  if (fs.exists(resourceRoot) && !fs.listFiles)
    diagnostics.push({
      path: ".aiw/resources",
      reason: "filesystem cannot enumerate neutral resources safely",
    });
  const migrations: ResourceMigration[] = [];
  const migrationBytes = new Map<string, Uint8Array>();
  for (const migration of plan.migrations) {
    const relativeSource = relative(resourceRoot, migration.source).split(sep).join("/");
    try {
      assertSafeProjectPath(fs, root, migration.source);
      if (!fs.exists(migration.source) || fs.pathType?.(migration.source) !== "file") {
        diagnostics.push({
          path: relativeSource,
          reason: "resource is missing or is not a regular file",
        });
        continue;
      }
      const bytes = readResourceBytes(fs, migration.source);
      const reason = validateNeutralResourceDocument(relativeSource, bytes);
      if (reason) {
        diagnostics.push({ path: relativeSource, reason });
        continue;
      }
      migrations.push(migration);
      migrationBytes.set(migration.source, bytes);
    } catch (error) {
      debugLog("setup", `failed to read neutral resource ${relativeSource}`, error);
      diagnostics.push({ path: relativeSource, reason: "resource cannot be read safely" });
    }
  }

  const conflicts = new Set<string>();
  const removals = new Set<string>();
  const fileChanges = new Map<string, Uint8Array | undefined>();
  const resourceDestinations = new Set<string>();
  for (const migration of migrations) {
    const destination = join(root, migration.destination);
    resourceDestinations.add(destination);
    const desiredBytes = migrationBytes.get(migration.source)!;
    inspectMigrationDestination(destination, desiredBytes);
  }
  const hasNeutralAiInit = fs.exists(neutralAiInit);
  let aiInitBytes: Uint8Array = Buffer.from(renderAiInit(target), "utf8");
  if (hasNeutralAiInit) {
    try {
      assertSafeProjectPath(fs, root, neutralAiInit);
      if (fs.pathType?.(neutralAiInit) !== "file")
        diagnostics.push({
          path: ".aiw/resources/skills/ai-init.md",
          reason: "resource is not a regular file",
        });
      else aiInitBytes = readResourceBytes(fs, neutralAiInit);
    } catch (error) {
      debugLog("setup", "failed to read neutral ai-init resource", error);
      diagnostics.push({
        path: ".aiw/resources/skills/ai-init.md",
        reason: "resource cannot be read safely",
      });
    }
  }
  const aiInitDiagnostic = validateNeutralResourceDocument("skills/ai-init/SKILL.md", aiInitBytes);
  if (hasNeutralAiInit && aiInitDiagnostic)
    diagnostics.push({ path: ".aiw/resources/skills/ai-init.md", reason: aiInitDiagnostic });
  const targetAiPath = targetPath;
  resourceDestinations.add(targetAiPath);
  if (targetAiPath === neutralAiInit) fileChanges.set(targetAiPath, aiInitBytes);
  else inspectMigrationDestination(targetAiPath, aiInitBytes);

  const previousTargetEntries =
    previousTarget === "universal"
      ? []
      : inventory.filter(
          (entry) =>
            (entry.kind === "target-resource" || entry.kind === "ai-init") &&
            entry.target === previousTarget,
        );
  const oldTargetPaths = new Set(previousTargetEntries.map(({ path }) => resolve(root, path)));
  if (previousTarget !== "universal") {
    for (const migration of migrations) {
      const oldPath = join(
        root,
        renderResourcePath(
          previousTarget,
          migration.type as Parameters<typeof renderResourcePath>[1],
          migration.id,
        ),
      );
      oldTargetPaths.add(oldPath);
      if (oldPath !== join(root, migration.destination)) inspectOwnedRemoval(oldPath);
    }
    if (previousTargetPath !== targetPath) inspectOwnedRemoval(previousTargetPath);
  }
  for (const oldPath of oldTargetPaths) {
    if (resourceDestinations.has(oldPath)) continue;
    if (fs.exists(oldPath)) inspectOwnedRemoval(oldPath);
    else removals.add(relative(root, oldPath).split(sep).join("/"));
  }

  const existingDestinations = [...resourceDestinations]
    .filter((path) => fs.exists(path))
    .map((path) => relative(root, path).split(sep).join("/"));
  const conflictPaths = [...conflicts].map((path) => relative(root, path).split(sep).join("/"));
  const removalPaths = [...removals];
  const previewActions = [
    target === "universal" && hasNeutralAiInit
      ? "keep: .aiw/resources/skills/ai-init.md (neutral source)"
      : `${fs.exists(targetAiPath) ? "update" : "add"}: ${relative(root, targetAiPath).split(sep).join("/")}`,
    ...(hasNeutralAiInit && target !== "universal"
      ? ["keep: .aiw/resources/skills/ai-init.md (neutral source)"]
      : []),
  ];
  const preview = serializeMigrationPreview(
    target,
    migrations,
    existingDestinations,
    removalPaths,
    diagnostics,
    conflictPaths,
    previewActions,
  );
  if (dryRun) return { exitCode: diagnostics.length || conflicts.size ? 1 : 0, output: preview };
  if (diagnostics.length || conflicts.size)
    return {
      exitCode: 1,
      error: `Migration blocked. Review the dry-run diagnostics:\n${preview}`,
    };
  if ([...fileChanges.values()].some((value) => value === undefined) && !fs.remove)
    return { exitCode: 1, error: "Filesystem cannot remove obsolete target resources." };

  const nextInventory = new Map(inventory.map((entry) => [entry.path, entry]));
  for (const relativePath of removals) nextInventory.delete(relativePath);
  for (const [path, bytes] of fileChanges) {
    if (bytes === undefined) continue;
    const relativePath = relative(root, path).split(sep).join("/");
    const matchingMigration = migrations.find((entry) => join(root, entry.destination) === path);
    const metadata =
      path === targetAiPath
        ? {
            kind: "ai-init" as const,
            target,
            resourceType: "skills" as const,
            resourceId: "ai-init",
          }
        : matchingMigration
          ? {
              kind: "target-resource" as const,
              target,
              resourceType: matchingMigration.type,
              resourceId: matchingMigration.id,
            }
          : {};
    nextInventory.set(relativePath, createOwnedFile(relativePath, bytes, metadata));
  }
  const inventoryBytes = Buffer.from(serializeOwnership([...nextInventory.values()]), "utf8");
  fileChanges.set(inventoryPath, inventoryBytes);
  fileChanges.set(
    manifestPath,
    Buffer.from(serializeManifest({ ...manifest, target: { active: target } }), "utf8"),
  );

  const changes = [...fileChanges].map(([path, content]) => ({ path, content }));
  const snapshots = snapshotProjectFiles(
    fs,
    root,
    changes.map(({ path }) => path),
  );
  const backupPath = join(aiw, "checkpoints/migration-backup.yml");
  assertSafeProjectPath(fs, root, backupPath);
  const previousBackup = fs.exists(backupPath) ? readResourceBytes(fs, backupPath) : undefined;
  const postMigrationSnapshots = expectedMigrationSnapshots(root, changes);
  const backupContent = serializeMigrationCheckpoint(snapshots, postMigrationSnapshots);
  fs.write(backupPath, backupContent);
  try {
    applyProjectFileChanges(fs, root, changes);
  } catch (error) {
    if (error instanceof Error && error.message.includes("automatic rollback was incomplete"))
      throw error;
    try {
      if (previousBackup) writeResourceBytes(fs, backupPath, previousBackup);
      else if (fs.exists(backupPath)) fs.remove?.(backupPath);
    } catch {
      throw new Error("Migration failed and its prior checkpoint could not be restored.", {
        cause: error,
      });
    }
    throw error;
  }
  return {
    exitCode: 0,
    output: `Target changed to ${target}; rendered ${migrations.length} neutral resources and removed ${removals.size} obsolete resources.`,
  };

  function inspectMigrationDestination(destination: string, desired: Uint8Array): void {
    try {
      assertSafeProjectPath(fs, root, destination);
      if (!fs.exists(destination)) {
        fileChanges.set(destination, desired);
        return;
      }
      if (fs.pathType?.(destination) !== "file") {
        conflicts.add(destination);
        return;
      }
      const currentBytes = readResourceBytes(fs, destination);
      const currentChecksum = `sha256-${checksumPackage(currentBytes)}`;
      const relativeDestination = relative(root, destination).split(sep).join("/");
      const owner = ownedByPath.get(relativeDestination);
      if (Buffer.compare(Buffer.from(currentBytes), Buffer.from(desired)) === 0) {
        if (owner && owner.checksum !== currentChecksum) conflicts.add(destination);
        return;
      }
      if (!owner || owner.checksum !== currentChecksum) {
        conflicts.add(destination);
        return;
      }
      fileChanges.set(destination, desired);
    } catch (error) {
      debugLog("setup", `migration destination conflict check failed for ${destination}`, error);
      conflicts.add(destination);
    }
  }

  function inspectOwnedRemoval(path: string): void {
    try {
      assertSafeProjectPath(fs, root, path);
      if (!fs.exists(path)) {
        removals.add(relative(root, path).split(sep).join("/"));
        return;
      }
      if (fs.pathType?.(path) !== "file") {
        conflicts.add(path);
        return;
      }
      const relativePath = relative(root, path).split(sep).join("/");
      const owner = ownedByPath.get(relativePath);
      const actual = `sha256-${checksumPackage(readResourceBytes(fs, path))}`;
      if (!owner || owner.checksum !== actual) {
        conflicts.add(path);
        return;
      }
      removals.add(relativePath);
      fileChanges.set(path, undefined);
    } catch (error) {
      debugLog("setup", `owned removal check failed for ${path}`, error);
      conflicts.add(path);
    }
  }
}

function handleRollback({ root, aiw, fs }: CommandContext): CommandResult {
  const backup = join(aiw, "checkpoints/migration-backup.yml");
  assertSafeProjectPath(fs, root, backup);
  if (!fs.exists(backup)) return { exitCode: 1, error: "No migration backup is available." };
  const content = fs.read(backup);
  if (fs.pathType?.(backup) !== "file")
    return { exitCode: 1, error: "Migration backup is not a regular project file." };
  const checkpoint = parseMigrationCheckpoint(content);
  const { snapshots, postMigrationSnapshots } = checkpoint;
  const backupRelative = relative(root, backup).split(sep).join("/");
  if (snapshots.some(({ path }) => path === backupRelative))
    return { exitCode: 1, error: "Migration backup cannot contain itself as a snapshot." };
  if (!postMigrationSnapshots)
    return {
      exitCode: 1,
      error:
        "Migration backup does not include validated post-migration state; refusing unsafe rollback.",
    };
  if (
    postMigrationSnapshots.length !== snapshots.length ||
    postMigrationSnapshots.some((snapshot, index) => snapshot.path !== snapshots[index]?.path)
  )
    return { exitCode: 1, error: "Migration backup post-migration state is invalid." };
  const conflicts: string[] = [];
  const restorable: MigrationSnapshot[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const path = resolve(root, snapshot.path);
    try {
      assertSafeProjectPath(fs, root, path);
      const expected = postMigrationSnapshots?.[index];
      if (!expected || migrationSnapshotMatches(fs, path, expected)) restorable.push(snapshot);
      else conflicts.push(snapshot.path);
    } catch (error) {
      debugLog("setup", `rollback snapshot check failed for ${snapshot.path}`, error);
      conflicts.push(snapshot.path);
    }
  }
  if (
    restorable.some((snapshot) => !snapshot.existed && fs.exists(resolve(root, snapshot.path))) &&
    !fs.remove
  )
    return { exitCode: 1, error: "Filesystem cannot remove obsolete migration resources." };
  const rollbackChanges: ProjectFileChange[] = restorable.map((snapshot) => ({
    path: resolve(root, snapshot.path),
    content: snapshot.existed ? Buffer.from(snapshot.contentBase64, "base64") : undefined,
  }));
  if (conflicts.length) {
    const remaining = snapshots.filter((snapshot) => conflicts.includes(snapshot.path));
    const remainingPostMigration = postMigrationSnapshots.filter((snapshot) =>
      conflicts.includes(snapshot.path),
    );
    rollbackChanges.push({
      path: backup,
      content: Buffer.from(serializeMigrationCheckpoint(remaining, remainingPostMigration), "utf8"),
    });
  } else {
    rollbackChanges.push({ path: backup, content: undefined });
  }
  applyProjectFileChanges(fs, root, rollbackChanges);
  if (conflicts.length) {
    return {
      exitCode: 1,
      error: `Migration rollback preserved modified/conflicting files: ${[...new Set(conflicts)].sort().join(", ")}`,
    };
  }
  return {
    exitCode: 0,
    output: "Migration rolled back; prior resources, ownership, and target state were restored.",
  };
}

function handleMigrate({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const dry = args.includes("--dry-run");
  const doRollback = args.includes("--rollback");
  if (doRollback) {
    const restored = rollbackMigration(root, aiw, fs);
    return { exitCode: 0, output: `Legacy state restored from snapshot: ${restored}` };
  }
  if (!detectLegacyState(aiw, fs))
    return {
      exitCode: 0,
      output: "Nothing to migrate: state already includes the ownership inventory.",
    };
  const manifestPath = join(aiw, "manifest.yml");
  const manifestTarget =
    /^\s*active:\s*(.+)$/m.exec(fs.read(manifestPath))?.[1]?.trim() ||
    detectTarget(root, fs) ||
    "codex";
  if (!isTarget(manifestTarget)) throw new Error(`Unsupported target: ${manifestTarget}`);
  const managedCandidates: ManagedCandidate[] = [];
  for (const resource of loadBundledResources(manifestTarget)) {
    managedCandidates.push({
      path: join(root, renderResourcePath(manifestTarget, resource.type, resource.id)),
      bundled: resource.content,
      metadata: {
        target: manifestTarget,
        resourceType: resource.type,
        resourceId: resource.id,
        kind: "target-resource",
      },
    });
  }
  managedCandidates.push({
    path: join(root, describeResource(manifestTarget, "context", "project").path),
    metadata: {
      target: manifestTarget,
      resourceType: "context",
      resourceId: "project",
      kind: "target-resource",
    },
  });
  const plan = planLegacyMigration(root, aiw, fs, managedCandidates);
  const report = [
    `Target: ${manifestTarget}`,
    plan.archived.length ? `Archived (superseded machine state): ${plan.archived.join(", ")}` : "",
    plan.preserved.length ? `Preserved byte-identical: ${plan.preserved.join(", ")}` : "",
    `Rebuilt: ownership inventory (${plan.rebuilt.length} managed paths)`,
    ...plan.userModified.map(
      (entry) => `Legacy-user-modified (sync preserves for review): ${entry}`,
    ),
    ...plan.manualActions.map((entry) => `MANUAL ACTION REQUIRED: ${entry}`),
    dry ? "Mode: dry-run — nothing written." : `Rollback snapshot: ${plan.rollbackSnapshot}`,
  ].filter((line) => line.length > 0);
  if (dry) return { exitCode: 0, output: ["Migration plan (dry-run):", ...report].join("\n") };
  try {
    applyMigration(root, aiw, fs, managedCandidates, plan);
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
  return { exitCode: 0, output: ["Migration complete.", ...report].join("\n") };
}

export const migrationCommands: Record<string, CommandHandler> = {
  target: handleTarget,
  rollback: handleRollback,
  migrate: handleMigrate,
};
