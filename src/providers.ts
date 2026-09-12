import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type PackageSource = { provider: "local" | "git"; source: string };
export type LoadedPackageSource = PackageSource & {
  root: string;
  manifest: string;
  manifestBytes?: Uint8Array;
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
    /^git\+(?:https?|ssh|git|file):\/\//i.test(source) ||
    source.startsWith("git@") ||
    source.startsWith("file://") ||
    /^ssh:\/\//i.test(source) ||
    /^git:\/\//i.test(source) ||
    /^https?:\/\//i.test(source) ||
    (source.endsWith(".git") && !/^[a-z][a-z\d+.-]*:\/\//i.test(source)),
  normalize: (source) => ({ provider: "git", source }),
};

export function resolveProvider(source: string, root: string): PackageSource {
  const provider = [gitProvider, localProvider].find((candidate) => candidate.canResolve(source));
  if (!provider) throw new Error(`Unsupported package source: ${source}`);
  return provider.normalize(source, root);
}

export function requiresExternalNetwork(source: PackageSource): boolean {
  if (source.provider !== "git") return false;
  const normalized = source.source.startsWith("git+") ? source.source.slice(4) : source.source;
  if (/^file:\/\//i.test(normalized)) return false;
  if (
    isAbsolute(normalized) ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith(".\\") ||
    normalized.startsWith("..\\") ||
    /^[a-z]:[\\/]/i.test(normalized)
  )
    return false;
  // Any remaining Git transport/reference is treated as external unless it is an explicit file path.
  return true;
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
      const manifestBytes = readFileSync(manifestPath);
      return {
        ...normalized,
        root: packageRoot,
        manifest: manifestBytes.toString("utf8"),
        manifestBytes,
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
      const manifestBytes = readFileSync(manifestPath);
      return {
        ...normalized,
        root: checkout,
        manifest: manifestBytes.toString("utf8"),
        manifestBytes,
        release: () => rmSync(checkout, { recursive: true, force: true }),
      };
    } catch (error) {
      rmSync(checkout, { recursive: true, force: true });
      throw new Error(`Unable to load Git package source: ${normalized.source}`, { cause: error });
    }
  },
};
