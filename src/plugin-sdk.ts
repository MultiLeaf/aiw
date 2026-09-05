import { isAbsolute, relative, resolve } from "node:path";
import type { FileSystem } from "./types.js";
import { validatePackageContract, type PackageContract } from "./package-contract.js";

export type PluginDefinition = {
  id: string;
  version: string;
  description: string;
};

export type PluginScaffold = {
  root: string;
  files: Readonly<Record<string, string>>;
};

export function definePlugin(contract: PackageContract): Readonly<PackageContract> {
  return Object.freeze(contract);
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
    root,
    files: {
      "package.yaml": pluginManifest(definition, skillId, skillPath),
      [skillPath]: `---\nname: ${skillId}\ndescription: ${JSON.stringify(definition.description)}\n---\n\n# ${title(skillId)}\n\nDescribe the focused workflow this skill provides.\n`,
      "README.md": `# ${definition.id}\n\n${definition.description}\n\nValidate this plugin with \`aiw plugin validate --directory=.\`.\n`,
    },
  };
}

export function writePluginScaffold(fs: FileSystem, scaffold: PluginScaffold): void {
  const destinations = Object.keys(scaffold.files).map((path) => resolve(scaffold.root, path));
  const conflict = destinations.find((path) => fs.exists(path));
  if (conflict) throw new Error(`Plugin scaffold would overwrite an existing file: ${conflict}`);
  fs.mkdir(scaffold.root);
  Object.entries(scaffold.files).forEach(([path, content]) =>
    fs.write(resolve(scaffold.root, path), content),
  );
}

export function validatePluginDirectory(fs: FileSystem, directory: string): PackageContract {
  const manifestPath = resolve(directory, "package.yaml");
  if (!fs.exists(manifestPath)) throw new Error(`Plugin manifest does not exist: ${manifestPath}`);
  return validatePackageContract(fs.read(manifestPath), (path) =>
    fs.exists(resolve(directory, path)),
  );
}

export function resolvePluginDirectory(projectRoot: string, directory: string): string {
  if (!directory || isAbsolute(directory))
    throw new Error("Plugin directory must be a non-empty project-relative path.");
  const root = resolve(projectRoot);
  const destination = resolve(root, directory);
  const pathFromRoot = relative(root, destination);
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error("Plugin directory must stay inside the project.");
  return destination;
}

function assertPluginDefinition(definition: PluginDefinition): void {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(definition.id))
    throw new Error("Plugin id must use the owner/name format with lowercase letters and hyphens.");
  if (!/^\d+\.\d+\.\d+$/.test(definition.version))
    throw new Error("Plugin version must be an exact semantic version.");
  if (!definition.description.trim() || /[\r\n]/.test(definition.description))
    throw new Error("Plugin description must be a non-empty single line.");
}

function pluginManifest(definition: PluginDefinition, skillId: string, skillPath: string): string {
  return `schema: 1\nid: ${definition.id}\nversion: ${definition.version}\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: ${skillId}, version: ${definition.version}, path: ${skillPath} }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
}

function title(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
