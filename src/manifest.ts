import type { Target } from "./types.js";
import { TARGETS } from "./types.js";

export type Manifest = {
  schema: number;
  project: { name: string };
  target: { active: Target };
  policies: { artifactLanguage: string };
};

export function parseManifest(content: string): Manifest {
  const schema = valueOf(content, "schema");
  const name = valueOf(content, "name");
  const target = valueOf(content, "active");
  const language = valueOf(content, "artifact_language");
  if (schema !== "1") throw new Error("Manifest schema must be version 1.");
  if (!name) throw new Error("Manifest project.name is required.");
  if (!TARGETS.includes(target as Target))
    throw new Error(`Manifest target.active is unsupported: ${target || "missing"}.`);
  if (language !== "en") throw new Error("Manifest policies.artifact_language must be en.");
  return {
    schema: 1,
    project: { name },
    target: { active: target as Target },
    policies: { artifactLanguage: language },
  };
}

function valueOf(content: string, key: string): string {
  return content.match(new RegExp(`^\\s*${key}:\\s*(.+)\\s*$`, "m"))?.[1]?.trim() ?? "";
}
