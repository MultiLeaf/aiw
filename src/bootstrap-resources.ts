import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { renderResourcePath } from "./adapter.js";
import { RESOURCE_TYPES, validatePackageContract, type ResourceType } from "./package-contract.js";
import type { Target } from "./types.js";

const resourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../resources");

export type BootstrapResource = { type: ResourceType; id: string; path: string; content: string };

export function loadBootstrapResources(target: Target): BootstrapResource[] {
  const manifestPath = join(resourceRoot, "package.yaml");
  const manifest = readFileSync(manifestPath, "utf8");
  const contract = validatePackageContract(manifest, (path) => {
    const candidate = resolve(resourceRoot, path);
    const rel = relative(resourceRoot, candidate);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && existsSync(candidate);
  });
  if (contract.targets && !contract.targets.includes(target))
    throw new Error(`The bundled workflow resources do not support target: ${target}`);

  return RESOURCE_TYPES.flatMap((type) =>
    contract.resources[type].map(({ id, path }) => {
      const source = resolve(resourceRoot, path);
      const rel = relative(resourceRoot, source);
      if (rel === ".." || rel.startsWith(`..${sep}`))
        throw new Error(`Bundled resource path escapes the package: ${path}`);
      return {
        type,
        id,
        path: renderResourcePath(target, type, id),
        content: readFileSync(source, "utf8"),
      };
    }),
  );
}
