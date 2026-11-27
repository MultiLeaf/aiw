import { join, relative, sep } from "node:path";
import { describeResource, renderAiInitPath, renderResourcePath } from "../adapter.js";
import { BlockingError, describeBlockingReason } from "../blocking-reasons.js";
import { loadBundledResources } from "../bundled-resources.js";
import { assertSafeProjectPath } from "../files.js";
import { generateProjectResources } from "../generator.js";
import { stageFingerprint } from "../human-approval.js";
import { parseManifest } from "../manifest.js";
import {
  createOwnedFile,
  parseOwnership,
  serializeOwnership,
  type OwnershipMetadata,
} from "../ownership.js";
import { parseProjectProfile, profileProject, type ProjectProfile } from "../profile.js";
import {
  recommendCapabilities,
  resourcesForCapabilities,
  serializeRecommendations,
} from "../recommendations.js";
import { semanticRetrievalAvailable } from "../semantic.js";
import type { CommandResult, FileSystem } from "../types.js";
import { computeUpdatePlan } from "../update.js";
import { applyProjectFileChanges } from "./shared.js";
import type { ProjectFileChange, WorkflowServices } from "./types.js";

/** UPD-001: bundled-resource update — diff, drift-safe apply, additive --add. */
export async function runBundledUpdate(
  args: string[],
  root: string,
  fs: FileSystem,
  aiw: string,
  services: WorkflowServices,
): Promise<CommandResult> {
  const dryRun = args.includes("--dry-run");
  const addArg = args.find((argument) => argument.startsWith("--add="))?.slice(6);
  const add = addArg
    ? addArg
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
  if (
    args.some(
      (argument) =>
        argument.startsWith("--") &&
        !["--dry-run", "--add", "--json"].some(
          (allowed) => argument === allowed || argument.startsWith(`${allowed}=`),
        ),
    )
  )
    return {
      exitCode: 1,
      error:
        "Usage: aiw update [--dry-run] [--add=type/id,...] | aiw update --package=path --target=target",
    };
  const target = parseManifest(fs.read(join(aiw, "manifest.yml"))).target.active;
  const profilePath = join(aiw, "profile.yml");
  const profile = /^status:\s*scanned$/m.test(fs.exists(profilePath) ? fs.read(profilePath) : "")
    ? parseProjectProfile(fs.read(profilePath))
    : await (services.profiler?.profile(root) ?? profileProject(root));
  const personalize = (type: string, id: string, content: string): string =>
    personalizeBundledResource(
      type as "skills" | "rules" | "agents" | "hooks" | "templates",
      id,
      content,
      profile,
    );
  let plan;
  try {
    plan = computeUpdatePlan({ fs, root, aiw, target, add, personalize });
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
  const lines = [
    `updated: ${plan.updated.length}${plan.updated.map((entry) => `\n  - ${entry.path}`).join("")}`,
    `new available: ${plan.newIds.length}${plan.newIds.length ? ` (${plan.newIds.slice(0, 12).join(", ")}${plan.newIds.length > 12 ? ", …" : ""})` : ""}`,
    `unchanged: ${plan.unchanged}`,
    plan.conflicts.length ? `conflicts (preserved): ${plan.conflicts.join(", ")}` : "",
    plan.install.length
      ? `installing: ${plan.install.map((r) => `${r.type}/${r.id}`).join(", ")}`
      : "",
  ].filter(Boolean);
  if (dryRun) return { exitCode: 0, output: lines.join("\n") };
  if (plan.conflicts.length)
    throw new BlockingError(
      describeBlockingReason("update_conflict", {
        detail: plan.conflicts.join(", "),
      }),
    );
  // Drift-safe apply: replace unmodified files, refresh their checksums.
  for (const entry of plan.updated) fs.write(join(root, entry.path), entry.content);
  const ownershipPath = join(aiw, "ownership.yml");
  const owned = parseOwnership(fs.read(ownershipPath));
  const updatedPaths = new Set(plan.updated.map((entry) => entry.path));
  const nextOwned = owned.map((file) =>
    updatedPaths.has(file.path)
      ? createOwnedFile(file.path, fs.read(join(root, file.path)), {
          kind: file.kind,
          target: file.target,
          resourceType: file.resourceType,
          resourceId: file.resourceId,
        })
      : file,
  );
  // Additive --add: render new resources and register ownership.
  for (const resource of plan.install) {
    const type = resource.type as "skills" | "rules" | "agents" | "hooks" | "templates";
    const neutralPath = renderResourcePath("universal", type, resource.id);
    const targetPath = renderResourcePath(target, type, resource.id);
    fs.write(join(root, neutralPath), resource.content);
    nextOwned.push(
      createOwnedFile(neutralPath, resource.content, {
        kind: "neutral-resource",
        target: "universal",
        resourceType: type,
        resourceId: resource.id,
      }),
    );
    if (targetPath !== neutralPath) {
      fs.write(join(root, targetPath), resource.content);
      nextOwned.push(
        createOwnedFile(targetPath, resource.content, {
          kind: "target-resource",
          target,
          resourceType: type,
          resourceId: resource.id,
        }),
      );
    }
  }
  fs.write(ownershipPath, serializeOwnership(nextOwned));
  if (plan.install.length) {
    // Record the additive selection so future syncs keep the added resources.
    const recommendations =
      services.recommender?.recommend(profile) ?? recommendCapabilities(profile);
    const previousSelection = readSelectedRecommendations(fs, aiw);
    const selection = [...new Set([...previousSelection, ...add])];
    fs.write(
      join(aiw, "recommendations.yml"),
      serializeRecommendations(recommendations, selection),
    );
  }
  return {
    exitCode: 0,
    output:
      lines.join("\n") +
      `\nUpdate applied${plan.install.length ? "" : " (no new resources installed; use --add=type/id to install)"}.`,
  };
}

export function syncSelectedResources(
  fs: FileSystem,
  root: string,
  aiw: string,
  profile: ProjectProfile,
  selected: string[],
  apply = false,
  approvedFingerprint?: string,
): {
  output?: string;
  error?: string;
  preview?: string;
  fingerprint?: string;
  conflicts?: string[];
} {
  const target = parseManifest(fs.read(join(aiw, "manifest.yml"))).target.active;
  const resourceSelections = resourcesForCapabilities(selected);
  const bundled = loadBundledResources(target);
  const bundleByKey = new Map(
    bundled.map((resource) => [`${resource.type}/${resource.id}`, resource]),
  );
  const desired = new Map<string, { content: string; metadata: OwnershipMetadata }>();
  const generatedFiles = new Map<string, string>();

  const addOwned = (path: string, content: string, metadata: OwnershipMetadata): void => {
    const previous = desired.get(path);
    if (previous && previous.content !== content)
      throw new Error(`Selected resources render conflicting content at ${path}`);
    desired.set(path, { content, metadata });
  };
  const addResource = (
    type: "skills" | "rules" | "agents" | "hooks" | "templates",
    id: string,
    content: string,
  ): void => {
    const neutralPath = join(root, renderResourcePath("universal", type, id));
    const targetPath = join(root, renderResourcePath(target, type, id));
    addOwned(neutralPath, content, {
      kind: "neutral-resource",
      target: "universal",
      resourceType: type,
      resourceId: id,
    });
    if (targetPath !== neutralPath)
      addOwned(targetPath, content, {
        kind: "target-resource",
        target,
        resourceType: type,
        resourceId: id,
      });
  };

  const semanticRetrieval = semanticRetrievalAvailable(fs, aiw);

  for (const reference of resourceSelections) {
    const key = `${reference.type}/${reference.id}`;
    const resource = bundleByKey.get(key);
    if (!resource) return { error: `Bundled resource is unavailable: ${key}` };
    addResource(
      reference.type,
      reference.id,
      personalizeBundledResource(reference.type, reference.id, resource.content, profile),
    );
  }

  generateProjectResources(
    profile,
    selected,
    (path, content) => {
      generatedFiles.set(join(aiw, path), content);
      const rule = path.match(
        /^generated\/rules\/(project-quality|tdd-project-policy|semantic-retrieval)\.md$/,
      );
      if (rule) addResource("rules", rule[1], content);
      const rootContext = path === "generated/context/root-context.md";
      if (rootContext) {
        const neutralContextPath = join(
          root,
          describeResource("universal", "context", "project").path,
        );
        addOwned(neutralContextPath, content, {
          kind: "neutral-resource",
          target: "universal",
          resourceType: "context",
          resourceId: "project",
        });
        const targetContextPath = describeResource(target, "context", "project").path;
        if (targetContextPath !== renderAiInitPath(target)) {
          addOwned(join(root, targetContextPath), content, {
            kind: "target-resource",
            target,
            resourceType: "context",
            resourceId: "project",
          });
        }
      }
    },
    semanticRetrieval,
  );

  const ownershipPath = join(aiw, "ownership.yml");
  if (fs.pathType?.(ownershipPath) !== "file")
    return {
      error: "AI Workflow ownership inventory is missing or unsafe; reinstall before syncing.",
    };
  const inventory = parseOwnership(fs.read(ownershipPath));
  const nextInventory = new Map(inventory.map((entry) => [entry.path, entry]));
  const changes: ProjectFileChange[] = [];
  const changeActions = new Map<string, "add" | "update">();
  const preserved = new Map<string, { path: string; state: string; contentFingerprint?: string }>();
  const conflicts: string[] = [];
  const preserve = (path: string, type: string | undefined, content?: string): void => {
    preserved.set(path, {
      path,
      state: type ?? "unknown",
      ...(content === undefined ? {} : { contentFingerprint: stageFingerprint(content) }),
    });
  };

  for (const [path, { content, metadata }] of desired) {
    assertSafeProjectPath(fs, root, path);
    const relativePath = relative(root, path).split(sep).join("/");
    const type = fs.pathType?.(path);
    const owned = nextInventory.get(relativePath);
    if (type === "missing") {
      changes.push({ path, content: Buffer.from(content, "utf8") });
      changeActions.set(relativePath, "add");
      nextInventory.set(relativePath, createOwnedFile(relativePath, content, metadata));
      continue;
    }
    if (type !== "file" || !owned) {
      conflicts.push(relativePath);
      preserve(relativePath, type);
      continue;
    }
    const actual = fs.read(path);
    if (createOwnedFile(relativePath, actual).checksum !== owned.checksum) {
      conflicts.push(relativePath);
      preserve(relativePath, type, actual);
      continue;
    }
    if (actual !== content) {
      changes.push({ path, content: Buffer.from(content, "utf8") });
      changeActions.set(relativePath, "update");
    } else preserve(relativePath, type, actual);
    nextInventory.set(relativePath, createOwnedFile(relativePath, content, metadata));
  }

  for (const [path, content] of generatedFiles) {
    assertSafeProjectPath(fs, root, path);
    const type = fs.pathType?.(path);
    const relativePath = relative(root, path).split(sep).join("/");
    if (type === "missing") {
      changes.push({ path, content: Buffer.from(content, "utf8") });
      changeActions.set(relativePath, "add");
    } else if (type !== "file" || fs.read(path) !== content) {
      conflicts.push(relative(root, path).split(sep).join("/"));
      preserve(relativePath, type, type === "file" ? fs.read(path) : undefined);
    } else preserve(relativePath, type, fs.read(path));
  }
  const nextOwnership = serializeOwnership([...nextInventory.values()]);
  if (fs.read(ownershipPath) !== nextOwnership) {
    changes.push({ path: ownershipPath, content: Buffer.from(nextOwnership, "utf8") });
    changeActions.set(relative(root, ownershipPath).split(sep).join("/"), "update");
  }
  const plan = {
    target,
    selected: [...new Set(selected)].sort(),
    changes: changes
      .map(({ path, content }) => ({
        path: relative(root, path).split(sep).join("/"),
        action: changeActions.get(relative(root, path).split(sep).join("/")) ?? "update",
        contentFingerprint: stageFingerprint(content ?? new Uint8Array()),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    preserved: [...preserved.values()].sort((a, b) => a.path.localeCompare(b.path)),
    conflicts: [...new Set(conflicts)].sort(),
    externalPending: selected.includes("react-best-practices")
      ? [
          {
            id: "vercel-react-best-practices",
            source: "vercel-labs/agent-skills",
            permissions: ["network:external"],
            approval: "separate human decision required",
          },
        ]
      : [],
  };
  const fingerprint = stageFingerprint(JSON.stringify(plan));
  const preview = `${JSON.stringify({ plan, fingerprint }, null, 2)}\n`;
  if (!apply) return { preview, fingerprint, conflicts: plan.conflicts };
  if (!approvedFingerprint) return { preview, fingerprint, conflicts: plan.conflicts };
  if (approvedFingerprint !== fingerprint)
    return { error: `The sync plan changed after review; current fingerprint is ${fingerprint}.` };
  if (plan.conflicts.length)
    return { error: `Sync plan has conflicts and made no changes: ${plan.conflicts.join(", ")}` };
  if (changes.length) applyProjectFileChanges(fs, root, changes);
  return {
    output: `Synchronized ${resourceSelections.length} selected bundled resources for ${target} and generated ${generatedFiles.size} project-specific files.`,
    preview,
    fingerprint,
    conflicts: plan.conflicts,
  };
}

export function personalizeBundledResource(
  type: "skills" | "rules" | "agents" | "hooks" | "templates",
  id: string,
  content: string,
  profile: ProjectProfile,
): string {
  const contextual =
    (type === "rules" &&
      [
        "quality-gates",
        "tdd-policy",
        "dependency-policy",
        "architecture-policy",
        "data-access-policy",
      ].includes(id)) ||
    (type === "skills" &&
      ["nestjs-development", "prisma-data-access", "vite-frontend"].includes(id)) ||
    (type === "agents" &&
      ["technical-architect", "typescript-engineer", "nestjs-engineer", "prisma-engineer"].includes(
        id,
      ));
  if (!contextual) return content;
  const signals = [
    profile.runtime.languages.length ? `- Languages: ${profile.runtime.languages.join(", ")}` : "",
    profile.frameworks.length ? `- Frameworks: ${profile.frameworks.join(", ")}` : "",
    profile.testing ? `- Test runner: ${profile.testing.name}` : "",
    profile.testing?.command
      ? `- Test command: \`${safeProjectSignal(profile.testing.command)}\``
      : "",
    profile.quality.linter ? `- Linter: ${profile.quality.linter.name}` : "",
    profile.quality.linter?.command
      ? `- Lint command: \`${safeProjectSignal(profile.quality.linter.command)}\``
      : "",
    profile.quality.formatter ? `- Formatter: ${profile.quality.formatter.name}` : "",
    profile.quality.formatter?.command
      ? `- Format command: \`${safeProjectSignal(profile.quality.formatter.command)}\``
      : "",
    ...(profile.modules ?? []).map((module) => {
      const parts = [
        module.name
          ? `${safeProjectSignal(module.name)} (${safeProjectSignal(module.path)})`
          : safeProjectSignal(module.path),
        module.frameworks.length ? `frameworks: ${module.frameworks.join(", ")}` : "",
        ...(module.architecture ?? []).map((item) => `architecture: ${safeProjectSignal(item)}`),
        ...(module.patterns ?? []).map((item) => `patterns: ${safeProjectSignal(item)}`),
        module.testing
          ? `tests: ${module.testing.name}${module.testing.command ? ` (${safeProjectSignal(module.testing.command)})` : ""}`
          : "",
        module.quality.linter
          ? `linter: ${module.quality.linter.name}${module.quality.linter.command ? ` (${safeProjectSignal(module.quality.linter.command)})` : ""}`
          : "",
      ].filter(Boolean);
      const evidence = (module.evidence ?? []).slice(0, 8).map(safeProjectSignal);
      return `- Module ${parts.join("; ")}${evidence.length ? `; evidence: ${evidence.join(", ")}` : ""}`;
    }),
  ].filter(Boolean);
  return signals.length
    ? `${content.trimEnd()}\n\n## Detected project context\n\n${signals.join("\n")}\n`
    : content;
}

export function safeProjectSignal(value: string): string {
  return value
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "`"
        ? " "
        : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

export function profileSummaryForRanking(profile: ProjectProfile): string {
  return [
    `languages: ${profile.runtime.languages.join(", ") || "none"}`,
    `frameworks: ${profile.frameworks.join(", ") || "none"}`,
    `package-manager: ${profile.packageManager}`,
    `testing: ${profile.testing?.name ?? "none"}`,
    `linter: ${profile.quality.linter?.name ?? "none"}`,
  ].join("; ");
}

export function readSelectedRecommendations(fs: FileSystem, aiw: string): string[] {
  if (!fs.exists(join(aiw, "recommendations.yml"))) return [];
  const content = fs.read(join(aiw, "recommendations.yml"));
  const selections = content
    .split(/^\s{2}- id: /m)
    .slice(1)
    .flatMap((block) => {
      const id = block.split("\n", 1)[0].trim();
      const selectedCapability = /^\s{4}selected: true$/m.test(block) ? [id] : [];
      const selectedResources =
        block
          .match(/^\s{4}selected_resources: \[([^\]]*)\]$/m)?.[1]
          ?.split(",")
          .map((resource) => resource.trim())
          .filter(Boolean) ?? [];
      return [...selectedCapability, ...selectedResources];
    });
  return [...new Set(selections)];
}
