import { parseDocument } from "yaml";

export const RESOURCE_TYPES = ["skills", "rules", "agents", "hooks", "templates"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type PackageResource = { id: string; version: string; path: string };
export type PackagePolicy = { id: string; value: string };
export type PackageContract = {
  schema: number;
  id: string;
  version: string;
  provider: string;
  source: string;
  resources: Record<ResourceType, PackageResource[]>;
  dependencies: string[];
  permissions: string[];
  provenance: { source: string; checksum?: string };
  policies?: PackagePolicy[];
  engines?: Record<string, string>;
  provides?: Record<ResourceType, string[]>;
  targets?: string[];
};

const TOP_LEVEL_KEYS = new Set([
  "schema",
  "id",
  "version",
  "description",
  "language",
  "provider",
  "source",
  "engines",
  "dependencies",
  "permissions",
  "policies",
  "provenance",
  "targets",
  "resources",
  "provides",
]);

export function validatePackageContract(
  content: string,
  resourceExists: (path: string) => boolean = () => true,
): PackageContract {
  const document = parseDocument(content, { uniqueKeys: true, strict: true });
  if (document.errors.length)
    throw new Error(`Package manifest YAML is invalid: ${document.errors[0].message}`);
  const value: unknown = document.toJS();
  const root = record(value, "manifest");
  for (const key of Object.keys(root)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`Package field '${key}' is not supported.`);
  }
  const schema = root.schema;
  if (schema !== 1) throw new Error("Package field 'schema' must be version 1.");
  const id = requiredString(root, "id");
  const version = requiredString(root, "version");
  const provider = requiredString(root, "provider");
  const source = requiredString(root, "source");
  optionalString(root, "description", "manifest");
  optionalString(root, "language", "manifest");
  const rawResources = record(root.resources, "resources");
  for (const key of Object.keys(rawResources)) {
    if (!(RESOURCE_TYPES as readonly string[]).includes(key))
      throw new Error(`Package resource section '${key}' is not supported.`);
  }
  const resources = {} as Record<ResourceType, PackageResource[]>;
  for (const type of RESOURCE_TYPES) {
    if (!(type in rawResources))
      throw new Error(`Package resource section '${type}' is required (use [] when empty).`);
    const entries = array(rawResources[type], `resources.${type}`);
    resources[type] = entries.map((entry, index) => {
      const item = record(entry, `resources.${type}[${index}]`);
      assertKeys(item, new Set(["id", "version", "path"]), `resources.${type}[${index}]`);
      const resource = {
        id: requiredString(item, "id", `resources.${type}[${index}]`),
        version: requiredString(item, "version", `resources.${type}[${index}]`),
        path: requiredString(item, "path", `resources.${type}[${index}]`),
      };
      validateResourcePath(resource.path, `resources.${type}[${index}].path`);
      if (!resourceExists(resource.path))
        throw new Error(`Package resource path does not exist: ${resource.path}`);
      return resource;
    });
    if (
      new Set(resources[type].map(({ id: resourceId }) => resourceId)).size !==
      resources[type].length
    )
      throw new Error(`Package resource identifiers in '${type}' must be unique.`);
  }
  if (!RESOURCE_TYPES.some((type) => resources[type].length))
    throw new Error("Package resources must contain at least one resource.");

  const provenance = record(root.provenance, "provenance");
  assertKeys(provenance, new Set(["source", "checksum"]), "provenance");
  const provenanceSource = requiredString(provenance, "source", "provenance");
  const checksum = optionalString(provenance, "checksum", "provenance");
  const policies =
    root.policies === undefined
      ? undefined
      : array(root.policies, "policies").map((entry, index) => {
          const policy = record(entry, `policies[${index}]`);
          assertKeys(policy, new Set(["id", "value"]), `policies[${index}]`);
          return {
            id: requiredString(policy, "id", `policies[${index}]`),
            value: requiredString(policy, "value", `policies[${index}]`),
          };
        });
  const engines = root.engines === undefined ? undefined : stringRecord(root.engines, "engines");
  const provides = root.provides === undefined ? undefined : parseProvides(root.provides);
  const targets = root.targets === undefined ? undefined : stringArray(root.targets, "targets");
  return {
    schema: 1,
    id,
    version,
    provider,
    source,
    resources,
    dependencies: stringArray(root.dependencies, "dependencies"),
    permissions: stringArray(root.permissions, "permissions"),
    provenance: { source: provenanceSource, ...(checksum ? { checksum } : {}) },
    ...(policies ? { policies } : {}),
    ...(engines ? { engines } : {}),
    ...(provides ? { provides } : {}),
    ...(targets ? { targets } : {}),
  };
}

export function validateResourcePath(path: string, field = "resource path"): void {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Package field '${field}' must be a normalized relative path.`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Package field '${field}' must be a mapping.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`Package field '${field}' must be a list (use [] when empty).`);
  return value;
}
function requiredString(value: Record<string, unknown>, key: string, parent = "manifest"): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim())
    throw new Error(
      `Package field '${parent === "manifest" ? key : `${parent}.${key}`}' must be a non-empty string.`,
    );
  return result.trim();
}
function optionalString(
  value: Record<string, unknown>,
  key: string,
  parent: string,
): string | undefined {
  if (value[key] === undefined) return undefined;
  return requiredString(value, key, parent);
}
function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim())
      throw new Error(`Package field '${field}[${index}]' must be a non-empty string.`);
    return entry.trim();
  });
}
function stringRecord(value: unknown, field: string): Record<string, string> {
  const result = record(value, field);
  return Object.fromEntries(
    Object.entries(result).map(([key, entry]) => {
      if (typeof entry !== "string" || !entry.trim())
        throw new Error(`Package field '${field}.${key}' must be a non-empty string.`);
      return [key, entry.trim()];
    }),
  );
}
function parseProvides(value: unknown): Record<ResourceType, string[]> {
  const result = record(value, "provides");
  for (const key of Object.keys(result))
    if (!(RESOURCE_TYPES as readonly string[]).includes(key))
      throw new Error(`Package provides section '${key}' is not supported.`);
  return Object.fromEntries(
    Object.entries(result).map(([key, entries]) => [key, stringArray(entries, `provides.${key}`)]),
  ) as Record<ResourceType, string[]>;
}
function assertKeys(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`Package field '${field}.${key}' is not supported.`);
}
