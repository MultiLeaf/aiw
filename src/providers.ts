import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type PackageSource = { provider: "local" | "git"; source: string };
export type LoadedPackageSource = PackageSource & {
  root: string;
  manifest: string;
  release(): void;
};
export interface PackageProvider {
  canResolve(source: string): boolean;
  normalize(source: string, root: string): PackageSource;
}
export interface PackageSourceLoader {
  load(source: string, root: string): LoadedPackageSource;
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
    source.startsWith("git+") ||
    source.startsWith("git@") ||
    source.startsWith("file://") ||
    /^https?:\/\//.test(source) ||
    source.endsWith(".git"),
  normalize: (source) => ({ provider: "git", source }),
};

export function resolveProvider(source: string, root: string): PackageSource {
  const provider = [gitProvider, localProvider].find((candidate) => candidate.canResolve(source));
  if (!provider) throw new Error(`Unsupported package source: ${source}`);
  return provider.normalize(source, root);
}

export const nodePackageSourceLoader: PackageSourceLoader = {
  load(source, projectRoot) {
    const normalized = resolveProvider(source, projectRoot);
    if (normalized.provider === "local") {
      if (!existsSync(normalized.source))
        throw new Error(`Local package source does not exist: ${normalized.source}`);
      const isDirectory = statSync(normalized.source).isDirectory();
      const packageRoot = isDirectory ? normalized.source : resolve(normalized.source, "..");
      const manifestPath = isDirectory ? join(packageRoot, "package.yaml") : normalized.source;
      if (!existsSync(manifestPath))
        throw new Error(`Package manifest does not exist: ${manifestPath}`);
      return {
        ...normalized,
        root: packageRoot,
        manifest: readFileSync(manifestPath, "utf8"),
        release(): void {},
      };
    }
    const checkout = mkdtempSync(join(tmpdir(), "aiw-package-"));
    try {
      const cloneSource = normalized.source.startsWith("git+")
        ? normalized.source.slice(4)
        : normalized.source;
      execFileSync("git", ["clone", "--depth", "1", "--", cloneSource, checkout], {
        stdio: "ignore",
      });
      const manifestPath = join(checkout, "package.yaml");
      if (!existsSync(manifestPath)) throw new Error("Git package does not contain package.yaml.");
      return {
        ...normalized,
        root: checkout,
        manifest: readFileSync(manifestPath, "utf8"),
        release: () => rmSync(checkout, { recursive: true, force: true }),
      };
    } catch (error) {
      rmSync(checkout, { recursive: true, force: true });
      throw new Error(`Unable to load Git package source: ${normalized.source}`, { cause: error });
    }
  },
};
