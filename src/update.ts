import { join } from "path";
import type { FileSystem } from "./types.js";
import type { Target } from "./types.js";
import { parseOwnership, createOwnedFile, type OwnedFile } from "./ownership.js";
import { loadBundledResources } from "./bundled-resources.js";
import { checksumPackage } from "./package-integrity.js";
import { resourcesForCapabilities } from "./recommendations.js";

export type UpdatePlan = {
  updated: { path: string; content: string }[];
  conflicts: string[];
  newIds: string[];
  unchanged: number;
  install: { type: string; id: string; content: string }[];
};

export type UpdatePlanInput = {
  fs: FileSystem;
  root: string;
  aiw: string;
  target: Target;
  add: string[];
  /** Catalog contents by `type/id` (injected for tests; defaults to the bundled package). */
  bundle?: Map<string, { type: string; id: string; content: string }>;
  /** Personalizer for desired bytes (defaults to the raw catalog content). */
  personalize?: (type: string, id: string, content: string) => string;
  /** Render path resolver per target (defaults to bundled path mapping). */
  renderPath?: (type: string, id: string, target: Target) => string;
};

/**
 * UPD-001: diff installed bundled resources against the catalog using the
 * ownership checksum as the drift oracle. `--add` ids are validated against
 * the catalog and appended additively.
 */
export function computeUpdatePlan(input: UpdatePlanInput): UpdatePlan {
  const { fs, root, aiw, target, add } = input;
  const ownershipPath = join(aiw, "ownership.yml");
  const owned: OwnedFile[] = fs.exists(ownershipPath) ? parseOwnership(fs.read(ownershipPath)) : [];
  const bundle =
    input.bundle ?? new Map(loadBundledResources(target).map((r) => [`${r.type}/${r.id}`, r]));
  const personalize =
    input.personalize ?? ((_t: string, _i: string, content: string): string => content);

  // Unknown --add ids fail closed with the available ids.
  const catalogResourceIds = [...bundle.keys()];
  const catalogCapabilityResources = new Set(
    resourcesForCapabilities([...catalogResourceIds]).map((r) => `${r.type}/${r.id}`),
  );
  const addKeys = add.map((id) => (id.includes("/") ? id : capabilityResourceKey(id, bundle)));
  for (const key of addKeys)
    if (!bundle.has(key) && !catalogCapabilityResources.has(key))
      throw new Error(
        `Unknown resource id: ${key}. Available: ${catalogResourceIds.sort().join(", ")}`,
      );

  const installedKeys = new Set<string>();
  const conflicts: string[] = [];
  const updated: { path: string; content: string }[] = [];
  let unchanged = 0;

  for (const file of owned) {
    if (file.resourceType === undefined || file.resourceId === undefined) {
      unchanged += 1; // supporting/legacy entries are never touched by update
      continue;
    }
    const key = `${file.resourceType}/${file.resourceId}`;
    installedKeys.add(key);
    const resource = bundle.get(key);
    if (!resource) {
      unchanged += 1; // resource no longer in the catalog: leave untouched
      continue;
    }
    const filePath = join(root, file.path);
    if (!fs.exists(filePath)) {
      unchanged += 1;
      continue;
    }
    const bytes = fs.read(filePath);
    const drifted = `sha256-${checksumPackage(bytes)}` !== file.checksum;
    if (drifted) {
      conflicts.push(file.path);
      continue;
    }
    const desired = personalize(resource.type, resource.id, resource.content);
    if (desired === bytes) unchanged += 1;
    else updated.push({ path: file.path, content: desired });
  }

  const newIds: string[] = [];
  const install: { type: string; id: string; content: string }[] = [];
  for (const key of catalogResourceIds) {
    const [type, id] = key.split("/");
    if (installedKeys.has(key)) continue;
    newIds.push(key);
    if (addKeys.includes(key))
      install.push({ type, id, content: personalize(type, id, bundle.get(key)!.content) });
  }

  return { updated, conflicts, newIds, unchanged, install };
}

function capabilityResourceKey(
  capabilityId: string,
  bundle: Map<string, { type: string; id: string; content: string }>,
): string {
  const resources = resourcesForCapabilities([capabilityId]);
  for (const resource of resources)
    if (bundle.has(`${resource.type}/${resource.id}`)) return `${resource.type}/${resource.id}`;
  return capabilityId;
}

/** Refreshed ownership entries after applying an update (checksums recomputed). */
export function refreshOwnershipChecksums(
  owned: OwnedFile[],
  fs: FileSystem,
  root: string,
): OwnedFile[] {
  return owned.map((file) => {
    const filePath = join(root, file.path);
    if (!fs.exists(filePath)) return file;
    return createOwnedFile(file.path, fs.read(filePath), {
      kind: file.kind,
      target: file.target,
      resourceType: file.resourceType,
      resourceId: file.resourceId,
    });
  });
}
