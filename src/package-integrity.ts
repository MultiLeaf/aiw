import { createHash } from "node:crypto";
import { validateResourcePath, type PackageContract } from "./package-contract.js";
import type { FileSystem } from "./types.js";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type PackageProvenance = {
  checksum: string;
  signature?: string;
  signer?: string;
};

export type SignatureVerifier = (content: string, signature: string, signer?: string) => boolean;

export function checksumPackage(content: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof content === "string") hash.update(content, "utf8");
  else hash.update(content);
  return hash.digest("hex");
}

/** Hash the exact package manifest and all declared resource bytes using a stable, framed format. */
export function checksumPackageSnapshot(
  manifest: Uint8Array,
  pkg: PackageContract,
  root: string,
  fs: FileSystem,
  manifestPath = "package.yaml",
): string {
  validateResourcePath(manifestPath, "manifest path");
  const files: Array<{ path: string; bytes: Uint8Array }> = [
    { path: manifestPath, bytes: manifest },
  ];
  const paths = new Set<string>([manifestPath]);
  for (const resources of Object.values(pkg.resources)) {
    for (const resource of resources) {
      validateResourcePath(resource.path);
      if (paths.has(resource.path))
        throw new Error(`Package resource path is duplicated: ${resource.path}`);
      paths.add(resource.path);
      const absolutePath = resolve(root, resource.path);
      const rel = relative(resolve(root), absolutePath);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error(`Package resource path escapes its package: ${resource.path}`);
      if (!fs.exists(absolutePath))
        throw new Error(`Package resource path does not exist: ${resource.path}`);
      if (fs.pathType && fs.pathType(absolutePath) !== "file")
        throw new Error(`Package resource must be a regular file: ${resource.path}`);
      if (fs.realpath) {
        const realRoot = fs.realpath(root);
        const realPath = fs.realpath(absolutePath);
        const realRelative = relative(realRoot, realPath);
        if (
          realRelative === ".." ||
          realRelative.startsWith(`..${sep}`) ||
          isAbsolute(realRelative)
        )
          throw new Error(`Package resource path escapes its package: ${resource.path}`);
      }
      const bytes = fs.readBytes
        ? fs.readBytes(absolutePath)
        : Buffer.from(fs.read(absolutePath), "utf8");
      files.push({ path: resource.path, bytes });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash("sha256").update("aiw-package-snapshot-v1\0", "utf8");
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const nameLength = Buffer.alloc(4);
    nameLength.writeUInt32BE(name.length);
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(file.bytes.byteLength));
    hash.update(nameLength).update(name).update(size).update(file.bytes);
  }
  return `sha256-${hash.digest("hex")}`;
}

export function verifyPackageProvenance(
  content: string,
  provenance: PackageProvenance,
  verifySignature?: SignatureVerifier,
): void {
  const actual = checksumPackage(content);
  if (actual !== provenance.checksum)
    throw new Error(
      `Package checksum mismatch: expected ${provenance.checksum}, received ${actual}.`,
    );
  if (provenance.signature && !verifySignature)
    throw new Error("Package signature requires a configured verifier.");
  if (
    provenance.signature &&
    verifySignature &&
    !verifySignature(content, provenance.signature, provenance.signer)
  )
    throw new Error("Package signature verification failed.");
}
