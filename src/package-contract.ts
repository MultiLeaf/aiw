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

export function validatePackageContract(content: string): PackageContract {
  const required = [
    "schema",
    "id",
    "version",
    "provider",
    "source",
    "resources",
    "dependencies",
    "permissions",
    "provenance",
  ];
  for (const field of required) {
    if (!new RegExp(`^${field}:`, "m").test(content))
      throw new Error(`Package field '${field}' is required.`);
  }
  const schema = scalar(content, "schema");
  if (schema !== "1") throw new Error("Package schema must be version 1.");
  const resources = Object.fromEntries(
    RESOURCE_TYPES.map((type) => [type, parseResources(content, type)]),
  ) as Record<ResourceType, PackageResource[]>;
  if (
    !resources.skills.length &&
    !resources.rules.length &&
    !resources.agents.length &&
    !resources.hooks.length &&
    !resources.templates.length
  )
    throw new Error("Package resources must contain at least one resource.");
  return {
    schema: 1,
    id: scalar(content, "id"),
    version: scalar(content, "version"),
    provider: scalar(content, "provider"),
    source: scalar(content, "source"),
    resources,
    dependencies: list(content, "dependencies"),
    permissions: list(content, "permissions"),
    provenance: {
      source: scalar(content, "source"),
      ...(nestedScalar(content, "checksum") ? { checksum: nestedScalar(content, "checksum") } : {}),
    },
    policies: parsePolicies(content),
    ...(scalar(content, "ai_workflow")
      ? { engines: { ai_workflow: scalar(content, "ai_workflow") } }
      : {}),
    ...(list(content, "targets").length ? { targets: list(content, "targets") } : {}),
  };
}

function parsePolicies(content: string): PackagePolicy[] {
  const section = content.match(/policies:\n((?:\s{2}- .*\n?)+)/)?.[1] ?? "";
  return [...section.matchAll(/id:\s*([^,]+),\s*value:\s*([^ }]+)/g)].map((match) => ({
    id: match[1].trim(),
    value: match[2].trim(),
  }));
}

function scalar(content: string, key: string): string {
  return (
    content
      .match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
      ?.replaceAll('"', "")
      .trim() ?? ""
  );
}

function nestedScalar(content: string, key: string): string {
  return (
    content
      .match(new RegExp(`^\\s{2,}${key}:\\s*(.+)$`, "m"))?.[1]
      ?.replaceAll('"', "")
      .trim() ?? ""
  );
}

function list(content: string, key: string): string[] {
  const value = scalar(content, key);
  return value === "[]"
    ? []
    : value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseResources(content: string, type: ResourceType): PackageResource[] {
  const section = content.match(new RegExp(`  ${type}:\\n((?:    - \\{.*\\}\\n?)+)`))?.[1] ?? "";
  return [...section.matchAll(/id:\s*([\w-]+), version:\s*([\d.]+), path:\s*([^ }]+)/g)].map(
    (match) => ({ id: match[1], version: match[2], path: match[3] }),
  );
}
