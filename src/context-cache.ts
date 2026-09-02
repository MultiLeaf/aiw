import { checksumPackage } from "./package-integrity.js";

export type ContextSummaryCache = { sourceChecksum: string; summary: string };

export function createSummaryCache(source: string, summary: string): ContextSummaryCache {
  return { sourceChecksum: checksumPackage(source), summary };
}

export function isSummaryFresh(source: string, cache: ContextSummaryCache): boolean {
  return checksumPackage(source) === cache.sourceChecksum;
}

export function serializeSummaryCache(cache: ContextSummaryCache): string {
  return `schema: 1\nsource_checksum: ${cache.sourceChecksum}\nsummary: ${JSON.stringify(cache.summary)}\n`;
}

export function parseSummaryCache(content: string): ContextSummaryCache {
  const sourceChecksum = content.match(/^source_checksum:\s*(.+)$/m)?.[1]?.trim();
  const summary = content.match(/^summary:\s*(.+)$/m)?.[1];
  if (!sourceChecksum || summary === undefined) throw new Error("Invalid context summary cache.");
  return { sourceChecksum, summary: JSON.parse(summary) as string };
}
