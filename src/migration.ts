import { join } from "node:path";
import { renderResourcePath } from "./adapter.js";
import { RESOURCE_TYPES, type ResourceType } from "./package-contract.js";
import type { Target } from "./types.js";

export type ResourceMigration = { source: string; destination: string };

export function planNeutralResourceMigration(
  neutralRoot: string,
  relativeFiles: string[],
  target: Target,
): ResourceMigration[] {
  return relativeFiles
    .flatMap((relative): ResourceMigration[] => {
      const [candidateType, id, filename, extra] = relative.split("/");
      if (extra || !RESOURCE_TYPES.includes(candidateType as ResourceType) || !id || !filename)
        return [];
      const type = candidateType as ResourceType;
      const expected = type === "skills" ? "SKILL.md" : `${id}.md`;
      if (filename !== expected) return [];
      return [
        { source: join(neutralRoot, relative), destination: renderResourcePath(target, type, id) },
      ];
    })
    .sort((left, right) => left.destination.localeCompare(right.destination));
}
