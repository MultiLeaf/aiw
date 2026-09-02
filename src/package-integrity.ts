import { createHash } from "node:crypto";

export type PackageProvenance = {
  checksum: string;
  signature?: string;
  signer?: string;
};

export type SignatureVerifier = (content: string, signature: string, signer?: string) => boolean;

export function checksumPackage(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
