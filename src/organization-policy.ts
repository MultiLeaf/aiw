export type OrganizationPolicy = {
  schema: 1;
  name: string;
  approvedSources: string[];
  deniedPermissions: string[];
};

export type PackagePolicySubject = {
  provider: string;
  source: string;
  permissions: string[];
};

export function parseOrganizationPolicy(content: string): OrganizationPolicy {
  const schema = scalar(content, "schema");
  const name = scalar(content, "name");
  if (schema !== "1") throw new Error("Organization policy schema must be version 1.");
  if (!name) throw new Error("Organization policy name is required.");
  const approvedSources = list(content, "approved_sources");
  if (!approvedSources.length)
    throw new Error("Organization policy approved_sources must not be empty.");
  return {
    schema: 1,
    name,
    approvedSources: [...new Set(approvedSources)].sort(),
    deniedPermissions: [...new Set(list(content, "denied_permissions"))].sort(),
  };
}

export function serializeOrganizationPolicy(policy: OrganizationPolicy): string {
  return `schema: 1\nname: ${policy.name}\napproved_sources: [${policy.approvedSources.join(", ")}]\ndenied_permissions: [${policy.deniedPermissions.join(", ")}]\n`;
}

export function enforceOrganizationPolicy(
  policy: OrganizationPolicy,
  subject: PackagePolicySubject,
): void {
  const candidate = `${subject.provider}:${subject.source}`;
  const approved = policy.approvedSources.some((pattern) =>
    pattern.endsWith("*") ? candidate.startsWith(pattern.slice(0, -1)) : candidate === pattern,
  );
  if (!approved) throw new Error(`Package source is not approved by ${policy.name}: ${candidate}`);
  const denied = subject.permissions.filter((permission) =>
    policy.deniedPermissions.includes(permission),
  );
  if (denied.length)
    throw new Error(`Package permissions are denied by ${policy.name}: ${denied.join(", ")}`);
}

function scalar(content: string, key: string): string {
  return content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

function list(content: string, key: string): string[] {
  const value = scalar(content, key);
  if (!value.startsWith("[") || !value.endsWith("]"))
    throw new Error(`Organization policy ${key} must be an inline list.`);
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
