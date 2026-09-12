import { parseDocument, stringify } from "yaml";
import { isAbsolute } from "node:path";
import { checksumPackage } from "./package-integrity.js";
import { RESOURCE_TYPES, type ResourceType } from "./package-contract.js";
import { TARGETS, type Target } from "./types.js";

export type OwnedFile = {
  path: string;
  checksum: string;
  kind?: "neutral-resource" | "target-resource" | "ai-init" | "supporting-file";
  target?: Target;
  resourceType?: ResourceType;
  resourceId?: string;
};
export type OwnershipMetadata = Omit<OwnedFile, "path" | "checksum">;

export function createOwnedFile(
  path: string,
  content: string | Uint8Array,
  metadata: OwnershipMetadata = {},
): OwnedFile {
  validateOwnedPath(path);
  return { path, checksum: `sha256-${checksumPackage(content)}`, ...metadata };
}

export function serializeOwnership(files: OwnedFile[]): string {
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const unique = new Set<string>();
  for (const file of ordered) {
    validateOwnedPath(file.path);
    if (unique.has(file.path))
      throw new Error(`Ownership inventory contains a duplicate path: ${file.path}`);
    unique.add(file.path);
    if (!/^sha256-[a-f0-9]{64}$/.test(file.checksum))
      throw new Error(`Ownership inventory checksum is invalid: ${file.path}`);
  }
  return stringify({ schema: 1, files: ordered }, { lineWidth: 0 });
}

export function parseOwnership(content: string): OwnedFile[] {
  const document = parseDocument(content, { uniqueKeys: true, strict: true });
  if (document.errors.length)
    throw new Error(`Ownership inventory YAML is invalid: ${document.errors[0].message}`);
  const value: unknown = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ownership inventory must be a mapping.");
  const inventory = value as Record<string, unknown>;
  if (Object.keys(inventory).some((key) => !["schema", "files"].includes(key)))
    throw new Error("Ownership inventory contains an unsupported field.");
  if (inventory.schema !== 1 || !Array.isArray(inventory.files))
    throw new Error("Ownership inventory schema or files section is invalid.");
  const files = inventory.files.map((entry, index): OwnedFile => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`Ownership inventory entry ${index} is invalid.`);
    const file = entry as Record<string, unknown>;
    if (
      Object.keys(file).some(
        (key) =>
          !["path", "checksum", "kind", "target", "resourceType", "resourceId"].includes(key),
      )
    )
      throw new Error(`Ownership inventory entry ${index} contains an unsupported field.`);
    if (typeof file.path !== "string" || typeof file.checksum !== "string")
      throw new Error(`Ownership inventory entry ${index} is missing its path or checksum.`);
    validateOwnedPath(file.path);
    if (!/^sha256-[a-f0-9]{64}$/.test(file.checksum))
      throw new Error(`Ownership inventory checksum is invalid: ${file.path}`);
    if (
      file.kind !== undefined &&
      !["neutral-resource", "target-resource", "ai-init", "supporting-file"].includes(
        String(file.kind),
      )
    )
      throw new Error(`Ownership inventory kind is invalid: ${file.path}`);
    if (file.target !== undefined && !TARGETS.includes(file.target as Target))
      throw new Error(`Ownership inventory target is invalid: ${file.path}`);
    if (
      file.resourceType !== undefined &&
      !(RESOURCE_TYPES as readonly string[]).includes(String(file.resourceType))
    )
      throw new Error(`Ownership inventory resource type is invalid: ${file.path}`);
    if (
      file.resourceId !== undefined &&
      (typeof file.resourceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.resourceId))
    )
      throw new Error(`Ownership inventory resource id is invalid: ${file.path}`);
    return {
      path: file.path,
      checksum: file.checksum,
      ...(file.kind !== undefined ? { kind: file.kind as OwnedFile["kind"] } : {}),
      ...(file.target !== undefined ? { target: file.target as Target } : {}),
      ...(file.resourceType !== undefined
        ? { resourceType: file.resourceType as ResourceType }
        : {}),
      ...(file.resourceId !== undefined ? { resourceId: file.resourceId as string } : {}),
    };
  });
  if (new Set(files.map(({ path }) => path)).size !== files.length)
    throw new Error("Ownership inventory paths must be unique.");
  return files;
}

function validateOwnedPath(path: string): void {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes(":") ||
    [...path].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Ownership inventory paths must be normalized project-relative paths.");
}
