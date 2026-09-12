import { parseDocument } from "yaml";
import { isAbsolute, join } from "node:path";
import { renderResourcePath } from "./adapter.js";
import { RESOURCE_TYPES, type ResourceType } from "./package-contract.js";
import type { Target } from "./types.js";

export type ResourceMigration = {
  source: string;
  destination: string;
  type: ResourceType;
  id: string;
  neutralSource: boolean;
};
export type MigrationDiagnostic = { path: string; reason: string };
export type ResourceMigrationPlan = {
  migrations: ResourceMigration[];
  diagnostics: MigrationDiagnostic[];
};
export type MigrationSnapshot = { path: string; existed: boolean; contentBase64: string };
export type MigrationCheckpoint = {
  snapshots: MigrationSnapshot[];
  postMigrationSnapshots?: MigrationSnapshot[];
};

export function planNeutralResourceMigration(
  neutralRoot: string,
  relativeFiles: string[],
  target: Target,
): ResourceMigrationPlan {
  const migrations: ResourceMigration[] = [];
  const diagnostics: MigrationDiagnostic[] = [];
  for (const relative of relativeFiles) {
    const parts = relative.split("/");
    const [candidateType, id, filename, extra] = parts;
    if (
      isAbsolute(relative) ||
      relative.includes("\\") ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      diagnostics.push({ path: relative, reason: "path is not normalized and project-relative" });
      continue;
    }
    if (
      extra ||
      parts.length !== 3 ||
      !(RESOURCE_TYPES as readonly string[]).includes(candidateType)
    ) {
      diagnostics.push({ path: relative, reason: "unsupported neutral resource path" });
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      diagnostics.push({ path: relative, reason: "resource identifier is invalid" });
      continue;
    }
    const type = candidateType as ResourceType;
    if (type === "skills" && id === "ai-init") {
      diagnostics.push({
        path: relative,
        reason: "skill id ai-init is reserved for the bootstrap skill",
      });
      continue;
    }
    const expectedFilename = type === "skills" ? "SKILL.md" : `${id}.md`;
    if (filename !== expectedFilename) {
      diagnostics.push({ path: relative, reason: `expected filename ${expectedFilename}` });
      continue;
    }
    migrations.push({
      source: join(neutralRoot, relative),
      destination: renderResourcePath(target, type, id),
      type,
      id,
      neutralSource: target === "universal",
    });
  }
  migrations.sort((left, right) =>
    left.destination < right.destination ? -1 : left.destination > right.destination ? 1 : 0,
  );
  diagnostics.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { migrations, diagnostics };
}

export function validateNeutralResourceDocument(
  relativePath: string,
  bytes: Uint8Array,
): string | undefined {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "resource is not valid UTF-8";
  }
  if (
    [...content].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code <= 0x08 || (code >= 0x0e && code <= 0x1f)) && code !== 0x09;
    })
  )
    return "resource contains unsupported control characters";
  let body = content.replace(/^\uFEFF/, "");
  if (body.startsWith("---\n") || body.startsWith("---\r\n")) {
    const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!frontmatter) return "resource frontmatter is not closed";
    const document = parseDocument(frontmatter[1], { uniqueKeys: true, strict: true });
    if (document.errors.length) return "resource frontmatter is malformed";
    const value: unknown = document.toJS();
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "resource frontmatter must be a mapping";
    const metadata = value as Record<string, unknown>;
    if (typeof metadata.name !== "string" || !metadata.name.trim())
      return "resource frontmatter requires a non-empty name";
    if (typeof metadata.description !== "string" || !metadata.description.trim())
      return "resource frontmatter requires a non-empty description";
    body = body.slice(frontmatter[0].length);
  }
  if (!/^#{1,6}\s+\S/m.test(body)) return "resource must contain a Markdown heading";
  if (!relativePath.endsWith(".md")) return "resource must use the .md format";
  return undefined;
}

export function serializeMigrationPreview(
  target: Target,
  migrations: ResourceMigration[],
  existingDestinations: string[],
  removals: string[] = [],
  diagnostics: MigrationDiagnostic[] = [],
  conflicts: string[] = [],
  additionalChanges: string[] = [],
): string {
  const existing = new Set(existingDestinations);
  const changes = migrations.map(({ destination, neutralSource }) =>
    neutralSource
      ? `keep: ${destination} (neutral source)`
      : existing.has(destination)
        ? `update: ${destination}`
        : `add: ${destination}`,
  );
  changes.push(...removals.map((path) => `remove: ${path}`));
  changes.push(...conflicts.map((path) => `conflict: ${path}`));
  changes.push(...diagnostics.map(({ path, reason }) => `invalid: ${path} (${reason})`));
  changes.push(...additionalChanges);
  return `Migration preview for ${target}:\n${changes.join("\n")}${changes.length ? "\n" : ""}`;
}

export function serializeMigrationSnapshots(snapshots: MigrationSnapshot[]): string {
  snapshots.forEach(validateSnapshot);
  if (new Set(snapshots.map(({ path }) => path)).size !== snapshots.length)
    throw new Error("Migration resource snapshots contain duplicate paths.");
  return Buffer.from(JSON.stringify(snapshots), "utf8").toString("base64");
}

export function parseMigrationSnapshots(encoded: string): MigrationSnapshot[] {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Migration resource snapshots are invalid.");
  }
  if (!Array.isArray(value)) throw new Error("Migration resource snapshots are invalid.");
  const snapshots = value.map((snapshot) => {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      typeof (snapshot as MigrationSnapshot).path !== "string" ||
      typeof (snapshot as MigrationSnapshot).existed !== "boolean" ||
      typeof (snapshot as MigrationSnapshot).contentBase64 !== "string"
    )
      throw new Error("Migration resource snapshots are invalid.");
    const candidate = snapshot as MigrationSnapshot;
    if (Object.keys(snapshot).some((key) => !["path", "existed", "contentBase64"].includes(key)))
      throw new Error("Migration resource snapshots contain unsupported fields.");
    validateSnapshot(candidate);
    return candidate;
  });
  if (new Set(snapshots.map(({ path }) => path)).size !== snapshots.length)
    throw new Error("Migration resource snapshots contain duplicate paths.");
  return snapshots;
}

export function serializeMigrationCheckpoint(
  snapshots: MigrationSnapshot[],
  postMigrationSnapshots?: MigrationSnapshot[],
): string {
  if (!postMigrationSnapshots)
    return `schema: 2\nsnapshots_base64: ${serializeMigrationSnapshots(snapshots)}\n`;
  return `schema: 3\nsnapshots_base64: ${serializeMigrationSnapshots(snapshots)}\npost_migration_snapshots_base64: ${serializeMigrationSnapshots(postMigrationSnapshots)}\n`;
}

export function parseMigrationCheckpoint(content: string): MigrationCheckpoint {
  const document = parseDocument(content, { uniqueKeys: true, strict: true });
  if (document.errors.length) throw new Error("Migration backup is invalid.");
  const value: unknown = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Migration backup is invalid.");
  const checkpoint = value as Record<string, unknown>;
  if (
    checkpoint.schema === 2 &&
    Object.keys(checkpoint).length === 2 &&
    typeof checkpoint.snapshots_base64 === "string"
  )
    return { snapshots: parseMigrationSnapshots(checkpoint.snapshots_base64) };
  if (
    checkpoint.schema === 3 &&
    Object.keys(checkpoint).length === 3 &&
    typeof checkpoint.snapshots_base64 === "string" &&
    typeof checkpoint.post_migration_snapshots_base64 === "string"
  )
    return {
      snapshots: parseMigrationSnapshots(checkpoint.snapshots_base64),
      postMigrationSnapshots: parseMigrationSnapshots(checkpoint.post_migration_snapshots_base64),
    };
  throw new Error("Migration backup is invalid.");
}

function validateSnapshotPath(path: string): void {
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
    throw new Error("Migration snapshot path must be project-relative.");
}

function validateSnapshot(snapshot: MigrationSnapshot): void {
  validateSnapshotPath(snapshot.path);
  if (typeof snapshot.existed !== "boolean")
    throw new Error("Migration resource snapshots are invalid.");
  if (!snapshot.existed && snapshot.contentBase64 !== "")
    throw new Error("Migration resource snapshots are invalid.");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(snapshot.contentBase64)
  )
    throw new Error("Migration resource snapshots are invalid.");
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
