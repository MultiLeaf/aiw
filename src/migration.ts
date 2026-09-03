import { join } from "node:path";
import { renderResourcePath } from "./adapter.js";
import { RESOURCE_TYPES, type ResourceType } from "./package-contract.js";
import type { Target } from "./types.js";

export type ResourceMigration = { source: string; destination: string };
export type MigrationSnapshot = { path: string; existed: boolean; contentBase64: string };

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

export function serializeMigrationPreview(
  target: Target,
  migrations: ResourceMigration[],
  existingDestinations: string[],
): string {
  const existing = new Set(existingDestinations);
  const changes = migrations.map(({ destination }) =>
    existing.has(destination) ? `update: ${destination}` : `add: ${destination}`,
  );
  return `Migration preview for ${target}:\n${changes.join("\n")}${changes.length ? "\n" : ""}remove: previous target ai-init\n`;
}

export function serializeMigrationSnapshots(snapshots: MigrationSnapshot[]): string {
  return Buffer.from(JSON.stringify(snapshots), "utf8").toString("base64");
}

export function parseMigrationSnapshots(encoded: string): MigrationSnapshot[] {
  const value: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (!Array.isArray(value)) throw new Error("Migration resource snapshots are invalid.");
  return value.map((snapshot) => {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      typeof (snapshot as MigrationSnapshot).path !== "string" ||
      typeof (snapshot as MigrationSnapshot).existed !== "boolean" ||
      typeof (snapshot as MigrationSnapshot).contentBase64 !== "string"
    )
      throw new Error("Migration resource snapshots are invalid.");
    return snapshot as MigrationSnapshot;
  });
}

export function readResourceBytes(
  fs: {
    read(path: string): string;
    readBytes?(path: string): Uint8Array;
  },
  path: string,
): Uint8Array {
  return fs.readBytes?.(path) ?? Buffer.from(fs.read(path), "utf8");
}

export function writeResourceBytes(
  fs: {
    write(path: string, content: string): void;
    writeBytes?(path: string, content: Uint8Array): void;
  },
  path: string,
  content: Uint8Array,
): void {
  if (fs.writeBytes) fs.writeBytes(path, content);
  else fs.write(path, Buffer.from(content).toString("utf8"));
}
