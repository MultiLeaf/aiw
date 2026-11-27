import { join, relative, resolve, sep } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  describeResource,
  detectTarget,
  isTarget,
  renderAiInit,
  renderAiInitPath,
  renderResourcePath,
} from "../adapter.js";
import { describeBlockingReason, formatBlockingOutput } from "../blocking-reasons.js";
import { loadBundledResources } from "../bundled-resources.js";
import { BASE_DIRECTORIES, WORKFLOW_DIRECTORY } from "../constants.js";
import { assertSafeProjectPath, writeProjectFilesAtomically } from "../files.js";
import {
  detectStageListDrift,
  parseApprovalLedgerLenient,
  parseWorkflowSession,
  recordDriftSkip,
  serializeApprovalLedger,
  stageDefinition,
  type StageListDrift,
} from "../human-approval.js";
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
import { configureOptionalModels } from "../model-onboarding.js";
import { listManagedWorktrees } from "../orchestration.js";
import {
  createOwnedFile,
  parseOwnership,
  serializeOwnership,
  type OwnershipMetadata,
} from "../ownership.js";
import { checksumPackage } from "../package-integrity.js";
import { parsePrivateRegistries, parseTeamPreset } from "../team-configuration.js";
import {
  loadTelemetryConfig,
  maybeOfferTelemetryConsent,
  offerTelemetryConsent,
  parseTelemetryConfig,
} from "../telemetry.js";
import type { CommandResult } from "../types.js";
import {
  applyProjectFileChanges,
  EMPTY_LOCKFILE,
  expectedMigrationSnapshots,
  installationRequired,
  migrationSnapshotMatches,
  snapshotProjectFiles,
} from "./shared.js";
import type { CommandContext, CommandHandler, ProjectFileChange } from "./types.js";
import { readWorkflowState, workflowNextAction } from "./workflow-state.js";

async function handleInstall({ args, root, aiw, fs }: CommandContext): Promise<CommandResult> {
  const flag = args.indexOf("--target");
  const requestedTarget = flag >= 0 ? args[flag + 1] : undefined;
  const target = requestedTarget || detectTarget(root, fs) || "codex";
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
  const manifestPath = join(aiw, "manifest.yml");
  assertSafeProjectPath(fs, root, manifestPath);
  if (fs.pathType?.(manifestPath) === "file") {
    const manifest = fs.read(manifestPath);
    const active = manifest.match(/^\s*active:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
    const legacyHint = detectLegacyState(aiw, fs)
      ? "\nLegacy pre-ownership state detected. Run `aiw migrate --dry-run` to review, then `aiw migrate` to upgrade to the current state layout."
      : "";
    return {
      exitCode: 0,
      output: `AI Workflow is already installed for target: ${active}. Existing state preserved.${legacyHint}`,
    };
  }
  const aiInitPath = join(root, renderAiInitPath(target));
  const neutralAiInitPath = join(aiw, "resources/skills/ai-init.md");
  const aiInitContent = renderAiInit(target);
  const desiredResources = new Map<string, string>([[aiInitPath, aiInitContent]]);
  const ownershipMetadata = new Map<string, OwnershipMetadata>();
  ownershipMetadata.set(aiInitPath, {
    kind: "ai-init",
    target,
    resourceType: "skills",
    resourceId: "ai-init",
  });
  if (neutralAiInitPath !== aiInitPath) {
    desiredResources.set(neutralAiInitPath, aiInitContent);
    ownershipMetadata.set(neutralAiInitPath, {
      kind: "neutral-resource",
      target: "universal",
      resourceType: "skills",
      resourceId: "ai-init",
    });
  }
  const conflicts: string[] = [];
  const pendingWrites = new Map<string, string>();
  const inspectDesiredFile = (path: string, content: string, allowExisting = false): void => {
    assertSafeProjectPath(fs, root, path);
    const type = fs.pathType?.(path);
    if (type === "missing") {
      pendingWrites.set(path, content);
      return;
    }
    if (type === "file" && (allowExisting || fs.read(path) === content)) return;
    conflicts.push(path);
  };

  for (const [path, content] of desiredResources) inspectDesiredFile(path, content);
  if (conflicts.length)
    return {
      exitCode: 1,
      error: `Installation would overwrite an existing file: ${conflicts.join(", ")}. Move it or merge its contents, then retry.`,
    };

  inspectDesiredFile(join(aiw, "profile.yml"), "schema: 1\nstatus: pending-scan\n");
  inspectDesiredFile(join(aiw, "lock.yml"), EMPTY_LOCKFILE);
  inspectDesiredFile(manifestPath, "");
  const adrIndex = join(root, ".context/adrs/INDEX.md");
  assertSafeProjectPath(fs, root, adrIndex);
  if (fs.pathType?.(adrIndex) === "missing")
    pendingWrites.set(adrIndex, "# Architecture Decision Records\n\n");

  const ownershipPath = join(aiw, "ownership.yml");
  assertSafeProjectPath(fs, root, ownershipPath);
  if (fs.exists(ownershipPath)) conflicts.push(ownershipPath);
  if (conflicts.length)
    return {
      exitCode: 1,
      error: `Installation found conflicting project state: ${conflicts.join(", ")}. Review and move it before retrying.`,
    };
  const ownedPaths = new Set(desiredResources.keys());
  if (pendingWrites.has(adrIndex)) ownedPaths.add(adrIndex);
  const ownedFiles = [...ownedPaths]
    .filter((path) => pendingWrites.has(path))
    .map((path) =>
      createOwnedFile(
        relative(root, path).split(sep).join("/"),
        pendingWrites.get(path)!,
        ownershipMetadata.get(path) ?? { kind: "supporting-file" },
      ),
    );
  pendingWrites.set(ownershipPath, serializeOwnership(ownedFiles));
  pendingWrites.delete(manifestPath);
  pendingWrites.set(
    manifestPath,
    `schema: 1\nproject:\n  name: ${root.split("/").pop()}\ntarget:\n  active: ${target}\npolicies:\n  artifact_language: en\n`,
  );
  writeProjectFilesAtomically(
    fs,
    root,
    [...pendingWrites].map(([path, content]) => ({ path, content })),
    [...BASE_DIRECTORIES.map((directory) => join(aiw, directory)), join(root, ".context/adrs")],
  );
  let optionalModels: string[] = [];
  let telemetryEnabled: boolean | undefined;
  if (stdin.isTTY) {
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      optionalModels = await configureOptionalModels(fs, aiw, (question) =>
        terminal.question(question),
      );
      telemetryEnabled = await offerTelemetryConsent(fs, aiw, (question) =>
        terminal.question(question),
      );
    } finally {
      terminal.close();
    }
  }
  return {
    exitCode: 0,
    output:
      `AI Workflow initialized for target: ${target} with only the ai-init skill. Run /ai-init to scan the project and choose which resources to install.` +
      (optionalModels.length
        ? ` Optional models enabled: ${optionalModels.join(", ")}. They activate once the models are available.`
        : "") +
      (telemetryEnabled !== undefined
        ? telemetryEnabled
          ? " Telemetry enabled (command name and outcome only); disable anytime with `aiw telemetry disable`."
          : " Telemetry disabled; enable anytime with `aiw telemetry enable`."
        : ""),
  };
}

function handleTarget({ args, root, aiw, fs }: CommandContext): CommandResult {
  const target = args[1];
  if (!target) return { exitCode: 1, error: "Usage: aiw target <target>" };
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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

function handleStatus({ aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml")))
    return { exitCode: 0, output: "AI Workflow is not installed." };
  try {
    const manifest = fs.read(join(aiw, "manifest.yml"));
    parseManifest(manifest);
    const workflowPath = join(aiw, "workflow.yml");
    if (!fs.exists(workflowPath)) return { exitCode: 0, output: manifest };
    const { session, ledger } = readWorkflowState(aiw, fs, false);
    return {
      exitCode: 0,
      output: `${manifest}\nSDD workflow ${session.workflowId} (${session.status})\n${workflowNextAction(ledger)}`,
    };
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleDoctor({ args, root, aiw, fs }: CommandContext): Promise<CommandResult> {
  const fixRequested = args.includes("--fix");
  if (fixRequested && args.length > 2) return { exitCode: 1, error: "Usage: aiw doctor [--fix]" };
  const required = ["manifest.yml", "profile.yml", "lock.yml", "ownership.yml"];
  const missing = required.filter((file) => !fs.exists(join(aiw, file)));
  if (missing.length) {
    if (detectLegacyState(aiw, fs))
      return {
        exitCode: 1,
        error:
          formatBlockingOutput(
            describeBlockingReason("migration_required", {
              detail: "Legacy pre-ownership state detected; review the migration plan first.",
            }),
          ) + "\nNext: run `aiw migrate --dry-run`, then `aiw migrate`.",
      };
    return { exitCode: 1, error: `Missing AI Workflow files: ${missing.join(", ")}` };
  }
  const leakedWorktrees = listManagedWorktrees(root, aiw);
  if (leakedWorktrees.length > 0)
    return {
      exitCode: 1,
      error: formatBlockingOutput(
        describeBlockingReason("worktrees_leaked", {
          detail: `${leakedWorktrees.length} managed orchestration worktree(s) leaked: ${leakedWorktrees.join(", ")}`,
        }),
      ),
    };
  try {
    parseManifest(fs.read(join(aiw, "manifest.yml")));
    parseOwnership(fs.read(join(aiw, "ownership.yml")));
    if (fs.exists(join(aiw, "team-preset.yml")))
      parseTeamPreset(fs.read(join(aiw, "team-preset.yml")));
    if (fs.exists(join(aiw, "registries.yml")))
      parsePrivateRegistries(fs.read(join(aiw, "registries.yml")));
    if (fs.exists(join(aiw, "telemetry.yml")))
      parseTelemetryConfig(fs.read(join(aiw, "telemetry.yml")));
    loadTelemetryConfig(fs, aiw);
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
  // AIW-001 (REQ-001): diagnose stage-list drift in the active workflow.
  if (fs.exists(join(aiw, "workflow.yml"))) {
    const session = parseWorkflowSession(fs.read(join(aiw, "workflow.yml")));
    if (session.status === "active" && fs.exists(join(aiw, "approvals.yml"))) {
      let drift: StageListDrift[];
      try {
        drift = detectStageListDrift(
          parseApprovalLedgerLenient(fs.read(join(aiw, "approvals.yml"))),
        );
      } catch (error) {
        return {
          exitCode: 1,
          error: `Approval ledger is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (drift.length > 0) {
        const lines = drift.map(
          (entry) =>
            `- ${entry.stage} is decided but its prerequisites are unresolved: ${entry.unresolvedPrerequisites.join(", ")}`,
        );
        // AIW-001 (REQ-002): the fix records skips for optional prerequisites only.
        const blockedRequired = [
          ...new Set(
            drift.flatMap((entry) =>
              entry.unresolvedPrerequisites.filter(
                (prerequisite) => !stageDefinition(prerequisite).optional,
              ),
            ),
          ),
        ];
        if (fixRequested) {
          if (blockedRequired.length > 0)
            return {
              exitCode: 1,
              error: `aiw doctor --fix cannot skip required stage(s): ${blockedRequired.join(", ")}. Run them with the normal stage commands; only optional prerequisites can be repaired with a recorded skip.`,
            };
          let ledger = parseApprovalLedgerLenient(fs.read(join(aiw, "approvals.yml")));
          const repaired: string[] = [];
          for (const entry of drift)
            for (const prerequisite of entry.unresolvedPrerequisites) {
              if (ledger.stages[prerequisite]) continue; // never overwrite an existing record
              ledger = recordDriftSkip(
                ledger,
                prerequisite,
                `Stage introduced after ${entry.stage} was decided (process list drift); recorded by aiw doctor --fix`,
                new Date().toISOString(),
              );
              repaired.push(prerequisite);
            }
          fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(ledger));
          const remaining = detectStageListDrift(ledger);
          if (remaining.length > 0)
            return {
              exitCode: 1,
              error: `Repair left drift unresolved: ${remaining
                .map((entry) => `${entry.stage} (${entry.unresolvedPrerequisites.join(", ")})`)
                .join("; ")}`,
            };
          return {
            exitCode: 0,
            output: `Stage-list drift repaired: recorded skips for ${repaired.join(", ")}. No decided stage was modified and no approval was invented.`,
          };
        }
        return {
          exitCode: 1,
          error: `Stage-list drift detected (the workflow was started with an older process stage list):\n${lines.join("\n")}\nNext: ${blockedRequired.length === 0 ? "run `aiw doctor --fix` to record the missing prerequisite skips, or record them yourself with `aiw skip <stage> --reason=...`" : `at least one unresolved prerequisite is a required stage (${blockedRequired.join(", ")}); run it with the normal stage commands (it cannot be auto-skipped)`}`,
        };
      }
    }
  }
  // FRIC-004: interactive doctor offers telemetry consent once when unset.
  let telemetryNote = "";
  if (stdin.isTTY) {
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      const consent = await maybeOfferTelemetryConsent(fs, aiw, true, (question) =>
        terminal.question(question),
      );
      if (consent.prompted)
        telemetryNote = consent.enabled
          ? "\nTelemetry enabled. Disable anytime with `aiw telemetry disable`."
          : "\nTelemetry remains disabled. Enable anytime with `aiw telemetry enable`.";
    } finally {
      terminal.close();
    }
  }
  return { exitCode: 0, output: `AI Workflow health check passed.${telemetryNote}` };
}

function handleRepair({ root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml")))
    return { exitCode: 1, error: "AI Workflow is not installed." };
  BASE_DIRECTORIES.forEach((dir) => fs.mkdir(join(aiw, dir)));
  if (!fs.exists(join(root, ".context/adrs/INDEX.md")))
    fs.write(join(root, ".context/adrs/INDEX.md"), "# Architecture Decision Records\n\n");
  return { exitCode: 0, output: "AI Workflow state repaired." };
}

function handleUninstall({ args, root, aiw, fs }: CommandContext): CommandResult {
  const manifestPath = join(aiw, "manifest.yml");
  assertSafeProjectPath(fs, root, manifestPath);
  if (!fs.exists(manifestPath)) return { exitCode: 1, error: "AI Workflow is not installed." };
  const ownershipPath = join(aiw, "ownership.yml");
  assertSafeProjectPath(fs, root, ownershipPath);
  if (!fs.exists(ownershipPath))
    return {
      exitCode: 1,
      error:
        "AIW ownership inventory is missing; refusing to remove resources whose ownership cannot be verified.",
    };
  if (fs.pathType?.(ownershipPath) !== "file")
    throw new Error("AIW ownership inventory is not a regular in-project file.");
  const ownedFiles = parseOwnership(fs.read(ownershipPath));
  const stateFiles = [
    "manifest.yml",
    "profile.yml",
    "lock.yml",
    "overrides.yml",
    "settings.yml",
    "recommendations.yml",
    "team-preset.yml",
    "registries.yml",
    "telemetry.yml",
    "checkpoints/migration-backup.yml",
  ];
  const dryRun = args.includes("--dry-run");
  if (!dryRun && !fs.remove)
    return { exitCode: 1, error: "Filesystem cannot remove AIW-owned files." };
  const removable: string[] = [];
  const conflicts: string[] = [];
  for (const file of ownedFiles) {
    const path = resolve(root, file.path);
    try {
      assertSafeProjectPath(fs, root, path);
      if (!fs.exists(path)) continue;
      if (fs.pathType?.(path) !== "file") {
        conflicts.push(file.path);
        continue;
      }
      const actual = `sha256-${checksumPackage(fs.readBytes?.(path) ?? fs.read(path))}`;
      if (actual === file.checksum) removable.push(path);
      else conflicts.push(file.path);
    } catch {
      conflicts.push(file.path);
    }
  }
  const statePaths: string[] = [];
  for (const file of stateFiles) {
    const path = join(aiw, file);
    if (!fs.exists(path)) continue;
    assertSafeProjectPath(fs, root, path);
    if (fs.pathType?.(path) !== "file") conflicts.push(`${WORKFLOW_DIRECTORY}/${file}`);
    else statePaths.push(path);
  }
  const uniqueConflicts = [...new Set(conflicts)].sort();
  const allRemovable = [...new Set([...removable, ...statePaths, ownershipPath])];
  const relativeRemovable = allRemovable
    .map((path) => relative(root, path).split(sep).join("/"))
    .sort();
  if (dryRun) {
    const report = [`Would remove: ${relativeRemovable.join(", ") || "none"}`];
    if (uniqueConflicts.length)
      report.push(`Would preserve modified/conflicting files: ${uniqueConflicts.join(", ")}`);
    return { exitCode: uniqueConflicts.length ? 1 : 0, output: report.join("\n") };
  }
  removable.forEach((path) => fs.remove?.(path));
  statePaths
    .filter((path) => !path.endsWith(`${sep}manifest.yml`))
    .forEach((path) => fs.remove?.(path));
  if (statePaths.includes(manifestPath)) fs.remove?.(manifestPath);
  fs.remove?.(ownershipPath);
  const removed = relativeRemovable.filter((path) => !uniqueConflicts.includes(path));
  return {
    exitCode: uniqueConflicts.length ? 1 : 0,
    output: [
      `AI Workflow-owned files removed: ${removed.join(", ") || "none"}.`,
      ...(uniqueConflicts.length
        ? [`Preserved modified/conflicting files: ${uniqueConflicts.join(", ")}`]
        : []),
    ].join("\n"),
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

export const setupMigrationCommands: Record<string, CommandHandler> = {
  install: handleInstall,
  target: handleTarget,
  rollback: handleRollback,
  status: handleStatus,
  doctor: handleDoctor,
  repair: handleRepair,
  uninstall: handleUninstall,
  migrate: handleMigrate,
};
