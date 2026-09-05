import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FileSystem, PathType } from "./types.js";
import { validatePackageContract, type PackageContract } from "./package-contract.js";

export type PluginDefinition = { id: string; version: string; description: string };
export type PluginScaffold = {
  projectRoot: string;
  root: string;
  files: Readonly<Record<string, string>>;
};
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export function definePlugin(contract: PackageContract): DeepReadonly<PackageContract> {
  return deepFreeze(contract);
}

export function createPluginScaffold(
  projectRoot: string,
  directory: string,
  definition: PluginDefinition,
): PluginScaffold {
  assertPluginDefinition(definition);
  const root = resolvePluginDirectory(projectRoot, directory);
  const skillId = definition.id.split("/").at(-1) ?? definition.id;
  const skillPath = `skills/${skillId}/SKILL.md`;
  return {
    projectRoot: resolve(projectRoot),
    root,
    files: {
      "package.yaml": pluginManifest(definition, skillId, skillPath),
      [skillPath]: `---\nname: ${skillId}\ndescription: ${JSON.stringify(definition.description)}\n---\n\n# ${title(skillId)}\n\nDescribe the focused workflow this skill provides.\n`,
      "README.md": `# ${definition.id}\n\n${definition.description}\n\nValidate this plugin from the project root with \`aiw plugin validate --directory=${directory}\`.\n`,
    },
  };
}

export function writePluginScaffold(fs: FileSystem, scaffold: PluginScaffold): void {
  const destinations = Object.keys(scaffold.files).map((path) => {
    if (isAbsolute(path)) throw new Error(`Plugin scaffold path must be relative: ${path}`);
    const destination = resolve(scaffold.root, path);
    if (!isInside(scaffold.root, destination))
      throw new Error(`Plugin scaffold path must stay inside its root: ${path}`);
    return destination;
  });
  assertNoSymlinkTraversal(fs, scaffold.projectRoot, scaffold.root);
  const ancestors = new Set(destinations.flatMap((path) => ancestorsUntil(path, scaffold.root)));
  const obstructed = [...ancestors].find((path) => {
    const type = pathType(fs, path);
    return type !== "missing" && type !== "directory";
  });
  if (obstructed)
    throw new Error(`Plugin scaffold has an unsafe or obstructed ancestor: ${obstructed}`);
  const conflict = destinations.find((path) => pathType(fs, path) !== "missing");
  if (conflict) throw new Error(`Plugin scaffold would overwrite an existing file: ${conflict}`);
  fs.mkdir(scaffold.root);
  Object.entries(scaffold.files).forEach(([path, content]) =>
    fs.write(resolve(scaffold.root, path), content),
  );
}

export function validatePluginDirectory(
  fs: FileSystem,
  projectRoot: string,
  directory: string,
): PackageContract {
  const pluginRoot = resolvePluginDirectory(projectRoot, directory);
  assertNoSymlinkTraversal(fs, resolve(projectRoot), pluginRoot);
  if (pathType(fs, pluginRoot) !== "directory")
    throw new Error(`Plugin directory does not exist or is not a directory: ${pluginRoot}`);
  const realProjectRoot = fs.realpath?.(resolve(projectRoot)) ?? resolve(projectRoot);
  const realPluginRoot = fs.realpath?.(pluginRoot) ?? pluginRoot;
  if (!isInside(realProjectRoot, realPluginRoot))
    throw new Error("Plugin directory resolves outside the project.");
  const manifestPath = resolve(pluginRoot, "package.yaml");
  if (pathType(fs, manifestPath) !== "file")
    throw new Error(`Plugin manifest does not exist: ${manifestPath}`);
  const content = fs.read(manifestPath);
  assertPluginManifestSyntax(content);
  return validatePackageContract(content, (path) => {
    if (isAbsolute(path)) return false;
    const resource = resolve(pluginRoot, path);
    if (!isInside(pluginRoot, resource) || pathType(fs, resource) !== "file") return false;
    const realResource = fs.realpath?.(resource) ?? resource;
    return isInside(realPluginRoot, realResource);
  });
}

export function resolvePluginDirectory(projectRoot: string, directory: string): string {
  if (!directory || directory === "." || isAbsolute(directory) || /[\0\r\n]/.test(directory))
    throw new Error("Plugin directory must be a non-empty project-relative path.");
  const root = resolve(projectRoot);
  const destination = resolve(root, directory);
  if (!isInside(root, destination))
    throw new Error("Plugin directory must stay inside the project.");
  return destination;
}

function assertPluginDefinition(definition: PluginDefinition): void {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(definition.id))
    throw new Error("Plugin id must use the owner/name format with lowercase letters and hyphens.");
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(definition.version))
    throw new Error("Plugin version must be an exact semantic version.");
  if (!definition.description.trim() || /[\r\n\u0085\u2028\u2029]/.test(definition.description))
    throw new Error("Plugin description must be a non-empty single line.");
}

function assertPluginManifestSyntax(content: string): void {
  const topLevel = [...content.matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
  const allowed = new Set([
    "schema",
    "id",
    "version",
    "provider",
    "source",
    "dependencies",
    "permissions",
    "provenance",
    "resources",
    "policies",
    "engines",
    "provides",
    "targets",
  ]);
  if (topLevel.some((key) => !allowed.has(key)) || new Set(topLevel).size !== topLevel.length)
    throw new Error("Plugin manifest has unknown or duplicate top-level fields.");
  const id = content.match(/^id:\s*(.*)$/m)?.[1]?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error("Plugin manifest id must use the lowercase owner/name format.");
  const version = content.match(/^version:\s*(.*)$/m)?.[1]?.trim() ?? "";
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version))
    throw new Error("Plugin manifest version must be an exact semantic version.");
  for (const key of ["dependencies", "permissions", "targets"]) {
    const line = content.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1];
    if (line !== undefined) {
      const list = line.trim();
      const body = list.slice(1, -1);
      if (!list.startsWith("[") || !list.endsWith("]") || body.includes("[") || body.includes("]"))
        throw new Error(`Plugin manifest field '${key}' must be an inline list.`);
    }
  }
  if (/^[^\s#][^:]*$/m.test(content)) throw new Error("Plugin manifest syntax is invalid.");
}

function pluginManifest(definition: PluginDefinition, skillId: string, skillPath: string): string {
  return `schema: 1\nid: ${definition.id}\nversion: ${definition.version}\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: ${skillId}, version: ${definition.version}, path: ${skillPath} }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
}

function assertNoSymlinkTraversal(fs: FileSystem, projectRoot: string, destination: string): void {
  let current = destination;
  while (isInside(projectRoot, current)) {
    if (pathType(fs, current) === "symlink")
      throw new Error(`Plugin path cannot traverse a symbolic link: ${current}`);
    if (current === projectRoot) return;
    current = dirname(current);
  }
  throw new Error("Plugin path must stay inside the project.");
}

function ancestorsUntil(path: string, root: string): string[] {
  const ancestors: string[] = [];
  let current = dirname(path);
  while (isInside(root, current)) {
    ancestors.push(current);
    if (current === root) break;
    current = dirname(current);
  }
  return ancestors;
}

function pathType(fs: FileSystem, path: string): PathType {
  return fs.pathType ? fs.pathType(path) : fs.exists(path) ? "file" : "missing";
}

function isInside(root: string, destination: string): boolean {
  const path = relative(root, destination);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): DeepReadonly<T> {
  if (!value || typeof value !== "object" || visited.has(value)) return value as DeepReadonly<T>;
  visited.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, visited));
  return Object.freeze(value) as DeepReadonly<T>;
}

function title(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
