export type TeamPreset = {
  schema: 1;
  name: string;
  packages: string[];
  registries: string[];
};

export type PrivateRegistry = {
  name: string;
  url: string;
  tokenEnv: string;
};

export type PrivateRegistryConfiguration = {
  schema: 1;
  registries: PrivateRegistry[];
};

export interface PrivateRegistryClient {
  search(registry: PrivateRegistry, query: string, token: string): Promise<unknown>;
}

export const fetchPrivateRegistryClient: PrivateRegistryClient = {
  async search(registry, query, token) {
    const endpoint = new URL(registry.url);
    endpoint.searchParams.set("q", query);
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Private registry ${registry.name} returned HTTP ${response.status}.`);
    return response.json();
  },
};

export function parseTeamPreset(content: string): TeamPreset {
  assertSchema(content, "Team preset");
  const name = scalar(content, "name");
  if (!name) throw new Error("Team preset name is required.");
  return {
    schema: 1,
    name,
    packages: normalizedList(content, "packages", "Team preset"),
    registries: normalizedList(content, "registries", "Team preset"),
  };
}

export function serializeTeamPreset(preset: TeamPreset): string {
  return `schema: 1\nname: ${preset.name}\npackages: [${preset.packages.join(", ")}]\nregistries: [${preset.registries.join(", ")}]\n`;
}

export function parsePrivateRegistries(content: string): PrivateRegistryConfiguration {
  assertSchema(content, "Private registry configuration");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const entryLines = lines.slice(2);
  if (!/^schema:[ \t]*1[ \t]*$/.test(lines[0] ?? "") || !/^registries:[ \t]*$/.test(lines[1] ?? ""))
    throw new Error("Private registry configuration contains unsupported or malformed fields.");
  if (!entryLines.every((line) => /^[ \t]+-[ \t]+\{[^\r\n]+\}[ \t]*$/.test(line)))
    throw new Error("Private registry configuration contains unsupported or malformed fields.");
  const entries = entryLines.map((line) =>
    parseRegistryEntry(line.slice(line.indexOf("{") + 1, line.lastIndexOf("}"))),
  );
  if (!entries.length)
    throw new Error("Private registry configuration registries must not be empty.");
  const names = new Set<string>();
  for (const registry of entries) {
    if (names.has(registry.name)) throw new Error(`Duplicate private registry: ${registry.name}`);
    names.add(registry.name);
  }
  return { schema: 1, registries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function serializePrivateRegistries(configuration: PrivateRegistryConfiguration): string {
  return `schema: 1\nregistries:\n${configuration.registries
    .map(({ name, url, tokenEnv }) => `  - { name: ${name}, url: ${url}, token_env: ${tokenEnv} }`)
    .join("\n")}\n`;
}

function parseRegistryEntry(content: string): PrivateRegistry {
  const pairs = content.split(",").map((part) => {
    const separator = part.indexOf(":");
    if (separator < 1) throw new Error("Private registry entries must use key: value fields.");
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }) as [string, string][];
  if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
    throw new Error("Private registry entries must not contain duplicate fields.");
  const fields = new Map(pairs);
  const name = fields.get("name") ?? "";
  const url = fields.get("url") ?? "";
  const tokenEnv = fields.get("token_env") ?? "";
  if (!name || !url || !tokenEnv)
    throw new Error("Private registry entries require name, url, and token_env.");
  if (fields.has("token") || fields.has("password") || fields.size !== 3)
    throw new Error(
      "Private registry credentials must use token_env; secret values are forbidden.",
    );
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Invalid private registry name.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid private registry URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Private registry URLs must use HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("Private registry URLs must not contain credentials, query, or fragment data.");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) throw new Error("Invalid private registry token_env.");
  return { name, url: parsed.toString().replace(/\/$/, ""), tokenEnv };
}

function assertSchema(content: string, label: string): void {
  if (scalar(content, "schema") !== "1") throw new Error(`${label} schema must be version 1.`);
}

function scalar(content: string, key: string): string {
  return content.match(new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, "m"))?.[1]?.trim() ?? "";
}

function normalizedList(content: string, key: string, label: string): string[] {
  const value = scalar(content, key);
  if (!value.startsWith("[") || !value.endsWith("]"))
    throw new Error(`${label} ${key} must be an inline list.`);
  return [
    ...new Set(
      value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}
