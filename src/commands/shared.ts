import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin } from "node:process";
import { describeBlockingReason, formatBlockingOutput } from "../blocking-reasons.js";
import { assertSafeProjectPath } from "../files.js";
import { type MigrationSnapshot, readResourceBytes, writeResourceBytes } from "../migration.js";
import {
  enforceOrganizationPolicy,
  parseOrganizationPolicy,
  type PackagePolicySubject,
} from "../organization-policy.js";
import type { RegistryPackage } from "../registry.js";
import type { CommandResult, FileSystem } from "../types.js";
import type { ProjectFileChange } from "./types.js";

export const EMPTY_LOCKFILE = "schema: 1\npackages:\n";

export async function readStdin(): Promise<string> {
  const terminal = createInterface({ input: stdin });
  try {
    return await new Promise<string>((resolvePromise, reject) => {
      let data = "";
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolvePromise(data));
      stdin.on("error", reject);
    });
  } finally {
    terminal.close();
  }
}

export function installationRequired(): CommandResult {
  return {
    exitCode: 1,
    error: formatBlockingOutput(
      describeBlockingReason("installation_required", {
        detail: "Run `aiw install` first.",
      }),
    ),
  };
}

export function stateMismatch(detail: string): CommandResult {
  return {
    exitCode: 1,
    error: formatBlockingOutput(describeBlockingReason("state_mismatch", { detail })),
  };
}

export function formatConfidence(confidence: number | undefined): string {
  return confidence === undefined ? "unknown" : confidence.toFixed(3);
}

export function formatNoul(noul: number | undefined): string {
  return noul === undefined ? "unknown" : noul.toFixed(3);
}

export function parseNamedOptions(
  args: string[],
  allowed: string[],
): Record<string, string> | undefined {
  const entries = args.map((arg) => arg.match(/^--([a-z-]+)=(.+)$/)?.slice(1));
  if (
    args.some((arg) => arg.indexOf("=") !== arg.lastIndexOf("=")) ||
    entries.some((entry) => !entry || !allowed.includes(entry[0])) ||
    new Set(entries.map((entry) => entry?.[0])).size !== entries.length
  )
    return undefined;
  return Object.fromEntries(entries as string[][]);
}

export function safeProjectFile(root: string, path: string, fs: FileSystem): string {
  if (
    !path ||
    isAbsolute(path) ||
    [...path].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    }) ||
    path.split(/[\\/]/).includes("..")
  )
    throw new Error("Orchestration plan must be a safe project-relative file.");
  const projectRoot = fs.realpath?.(resolve(root)) ?? resolve(root);
  const candidate = resolve(root, path);
  const candidateType = fs.pathType?.(candidate) ?? (fs.exists(candidate) ? "file" : "missing");
  if (!isInsidePath(resolve(root), candidate) || candidateType !== "file")
    throw new Error(`Orchestration plan does not exist or is not a file: ${path}`);
  const realCandidate = fs.realpath?.(candidate) ?? candidate;
  if (!isInsidePath(projectRoot, realCandidate))
    throw new Error("Orchestration plan must stay inside the project.");
  return candidate;
}

export function isInsidePath(root: string, destination: string): boolean {
  const path = relative(root, destination);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function snapshotProjectFiles(
  fs: FileSystem,
  root: string,
  paths: string[],
): MigrationSnapshot[] {
  const snapshots: MigrationSnapshot[] = [];
  for (const path of [...new Set(paths)]) {
    assertSafeProjectPath(fs, root, path);
    const type = fs.pathType?.(path);
    if (type === "missing") {
      snapshots.push({
        path: relative(root, path).split(sep).join("/"),
        existed: false,
        contentBase64: "",
      });
      continue;
    }
    if (type !== "file")
      throw new Error(`Migration path is not a regular project file: ${relative(root, path)}`);
    snapshots.push({
      path: relative(root, path).split(sep).join("/"),
      existed: true,
      contentBase64: Buffer.from(readResourceBytes(fs, path)).toString("base64"),
    });
  }
  return snapshots;
}

export function expectedMigrationSnapshots(
  root: string,
  changes: ProjectFileChange[],
): MigrationSnapshot[] {
  return [...new Map(changes.map((change) => [change.path, change])).values()].map(
    ({ path, content }) => ({
      path: relative(root, path).split(sep).join("/"),
      existed: content !== undefined,
      contentBase64: content ? Buffer.from(content).toString("base64") : "",
    }),
  );
}

export function migrationSnapshotMatches(
  fs: FileSystem,
  path: string,
  expected: MigrationSnapshot,
): boolean {
  const type = fs.pathType?.(path);
  if (!expected.existed) return type === "missing";
  if (type !== "file") return false;
  return Buffer.from(readResourceBytes(fs, path)).equals(
    Buffer.from(expected.contentBase64, "base64"),
  );
}

export function applyProjectFileChanges(
  fs: FileSystem,
  root: string,
  changes: ProjectFileChange[],
): void {
  const ordered = [...new Map(changes.map((change) => [change.path, change])).values()];
  if (ordered.some(({ content }) => content === undefined) && !fs.remove)
    throw new Error("Filesystem cannot remove obsolete migration resources.");
  const snapshots = snapshotProjectFiles(
    fs,
    root,
    ordered.map(({ path }) => path),
  );
  try {
    for (const change of ordered) {
      if (change.content === undefined) {
        if (fs.exists(change.path)) fs.remove?.(change.path);
      } else {
        writeResourceBytes(fs, change.path, change.content);
      }
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const snapshot of [...snapshots].reverse()) {
      const path = resolve(root, snapshot.path);
      try {
        if (snapshot.existed)
          writeResourceBytes(fs, path, Buffer.from(snapshot.contentBase64, "base64"));
        else if (fs.exists(path)) fs.remove?.(path);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed)
      throw new Error("Migration failed and automatic rollback was incomplete; use aiw rollback.", {
        cause: error,
      });
    throw error;
  }
}

export function parsePrivateRegistryPackages(
  payload: unknown,
  registryUrl: string,
): RegistryPackage[] {
  if (!Array.isArray(payload)) throw new Error("Private registry response must be an array.");
  return payload.map((value, index) => {
    if (!value || typeof value !== "object")
      throw new Error(`Private registry package ${index} is invalid.`);
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.version !== "string" ||
      typeof item.description !== "string" ||
      !Array.isArray(item.permissions) ||
      !item.permissions.every((permission) => typeof permission === "string")
    )
      throw new Error(`Private registry package ${index} is invalid.`);
    if (
      !item.id ||
      !item.version ||
      /[\r\n]/.test(item.id) ||
      /[\r\n]/.test(item.version) ||
      /[\r\n]/.test(item.description)
    )
      throw new Error(`Private registry package ${index} contains unsafe text.`);
    return {
      id: item.id,
      version: item.version,
      description: item.description,
      provider: "private-registry" as const,
      source: `${registryUrl}/${item.id}`,
      permissions: item.permissions as string[],
    };
  });
}

export function containsCredential(
  value: unknown,
  credential: string,
  visited: Set<object> = new Set(),
): boolean {
  if (typeof value === "string") return value.includes(credential);
  if (!value || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some((entry) => containsCredential(entry, credential, visited));
}

export function parseApprovedPermissions(args: string[]): string[] {
  return args
    .filter((arg) => arg.startsWith("--allow="))
    .flatMap((arg) => arg.slice("--allow=".length).split(","))
    .map((permission) => permission.trim())
    .filter(Boolean);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function enforceConfiguredOrganizationPolicy(
  fs: FileSystem,
  aiw: string,
  subject: PackagePolicySubject,
): void {
  const path = join(aiw, "organization.yml");
  if (fs.exists(path)) enforceOrganizationPolicy(parseOrganizationPolicy(fs.read(path)), subject);
}

export function skillIntegrity(fs: FileSystem, root: string, skill: string): string {
  if (!fs.exists(join(root, "skills-lock.json"))) return "unknown";
  const lock = fs.read(join(root, "skills-lock.json"));
  const escaped = escapeRegExp(skill);
  return (
    lock.match(
      new RegExp(
        `"${escaped}"\\s*:\\s*\\{[\\s\\S]*?"(?:computedHash|skillFolderHash)"\\s*:\\s*"([^"]+)"`,
      ),
    )?.[1] ?? "unknown"
  );
}

export function writeVercelSkillLock(
  fs: FileSystem,
  root: string,
  aiw: string,
  source: string,
  skill: string,
): void {
  const lockPath = join(aiw, "lock.yml");
  const current = fs.exists(lockPath) ? fs.read(lockPath) : EMPTY_LOCKFILE;
  const id = `${source}/${skill}`;
  const withoutExisting = current.replace(
    new RegExp(`  - id: ${escapeRegExp(id)}\\n(?:    [^\\n]+\\n){4,5}`, "g"),
    "",
  );
  fs.write(
    lockPath,
    `${withoutExisting.replace(/\n*$/, "\n")}  - id: ${id}\n    version: latest\n    provider: vercel-skills\n    source: ${source}\n    integrity: ${skillIntegrity(fs, root, skill)}\n    permissions: [network:external]\n`,
  );
}

export function refreshVercelSkillLocks(fs: FileSystem, root: string, aiw: string): void {
  const lockPath = join(aiw, "lock.yml");
  if (!fs.exists(lockPath)) return;
  const content = fs
    .read(lockPath)
    .replace(
      /( {2}- id: ([^\n]+)\n {4}version: latest\n {4}provider: vercel-skills\n {4}source: ([^\n]+)\n {4}integrity: )([^\n]+)/g,
      (_entry, prefix: string, id: string): string =>
        `${prefix}${skillIntegrity(fs, root, id.split("/").at(-1) ?? id)}`,
    );
  fs.write(lockPath, content);
}
