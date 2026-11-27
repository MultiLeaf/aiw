import type { PolicyDecision } from "./policy-gate.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type PolicyRuleRecord = {
  id: string;
  paths: string[];
  decision: PolicyDecision;
  /** Normalized to decision always-require-human when true. */
  alwaysRequireHuman?: boolean;
};

export type OrganizationPolicy = {
  schema: 1;
  name: string;
  approvedSources: string[];
  deniedPermissions: string[];
  /** REQ-001: optional path-scoped rules; absent means flat behavior. */
  rules?: PolicyRuleRecord[];
};

export const POLICY_DECISIONS: readonly PolicyDecision[] = [
  "allow",
  "require-approval",
  "always-require-human",
  "deny",
];
const MAX_RULES = 64;

/** Parse the optional `rules:` block (the only block-style section). */
function parseRules(content: string): PolicyRuleRecord[] | undefined {
  const block = content.match(/^rules:\s*\n([\s\S]*)$/m)?.[1];
  if (block === undefined) {
    if (/^rules:/m.test(content))
      throw new Error("Organization policy rules must be a block list.");
    return undefined;
  }
  const value: unknown = parseYaml(`rules:\n${block}`)?.rules;
  if (!Array.isArray(value)) throw new Error("Organization policy rules must be a list.");
  if (value.length > MAX_RULES)
    throw new Error(`Organization policy cannot exceed ${MAX_RULES} rules.`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error(`Organization policy rule ${index + 1} must be a mapping.`);
    const record = entry as Record<string, unknown>;
    const id = String(record.id ?? "");
    const decision = String(record.decision ?? "");
    const paths = record.paths;
    if (!id.trim()) throw new Error(`Organization policy rule ${index + 1} requires an id.`);
    if (seen.has(id)) throw new Error(`Organization policy rule id is duplicated: ${id}`);
    seen.add(id);
    if (!POLICY_DECISIONS.includes(decision as PolicyDecision))
      throw new Error(
        `Organization policy rule ${id} has an invalid decision: ${decision || "(missing)"}`,
      );
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.some((p) => typeof p !== "string" || !p.trim())
    )
      throw new Error(`Organization policy rule ${id} requires a non-empty paths list.`);
    const alwaysRequireHuman = record["always-require-human"] === true;
    return {
      id,
      paths: (paths as string[]).map((p) => p.trim()),
      decision: alwaysRequireHuman
        ? ("always-require-human" as PolicyDecision)
        : (decision as PolicyDecision),
      ...(alwaysRequireHuman ? { alwaysRequireHuman: true } : {}),
    };
  });
}

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
  const rules = parseRules(content);
  if (!approvedSources.length)
    throw new Error("Organization policy approved_sources must not be empty.");
  return {
    schema: 1,
    name,
    approvedSources: [...new Set(approvedSources)].sort(),
    deniedPermissions: [...new Set(list(content, "denied_permissions"))].sort(),
    ...(rules ? { rules } : {}),
  };
}

export function serializeOrganizationPolicy(policy: OrganizationPolicy): string {
  const flat = `schema: 1\nname: ${policy.name}\napproved_sources: [${policy.approvedSources.join(", ")}]\ndenied_permissions: [${policy.deniedPermissions.join(", ")}]\n`;
  if (!policy.rules?.length) return flat;
  const rules = policy.rules.map((rule) => ({
    id: rule.id,
    paths: rule.paths,
    decision: rule.decision,
    ...(rule.alwaysRequireHuman ? { "always-require-human": true } : {}),
  }));
  return `${flat}${stringifyYaml({ rules }, { lineWidth: 0 })}`;
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
  const value = content.match(new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, "m"))?.[1]?.trim() ?? "";
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  )
    return value.slice(1, -1).trim();
  return value;
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
