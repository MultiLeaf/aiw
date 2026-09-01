import { isAbsolute, resolve } from "node:path";

export type PackageSource = { provider: "local" | "git"; source: string };
export interface PackageProvider {
  canResolve(source: string): boolean;
  normalize(source: string, root: string): PackageSource;
}

export const localProvider: PackageProvider = {
  canResolve: (source) =>
    !source.includes(":") && !source.startsWith("git+") && !/^https?:\/\//.test(source),
  normalize: (source, root) => ({
    provider: "local",
    source: isAbsolute(source) ? source : resolve(root, source),
  }),
};

export const gitProvider: PackageProvider = {
  canResolve: (source) =>
    source.startsWith("git+") || /^https?:\/\//.test(source) || source.endsWith(".git"),
  normalize: (source) => ({ provider: "git", source }),
};

export function resolveProvider(source: string, root: string): PackageSource {
  const provider = [localProvider, gitProvider].find((candidate) => candidate.canResolve(source));
  if (!provider) throw new Error(`Unsupported package source: ${source}`);
  return provider.normalize(source, root);
}
