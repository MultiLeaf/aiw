import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { join } from "path";
import { debugLog } from "./debug.js";
import type { FileSystem } from "./types.js";
import { loadSettings } from "./settings.js";

export type SemanticConfig = {
  enabled: boolean;
  model: string;
  baseUrl: string;
  chunkChars: number;
  topK: number;
  excludeLockfiles: boolean;
  apiKeyEnv?: string;
  timeoutMs?: number;
};

export const DEFAULT_SEMANTIC_AVAILABILITY_TIMEOUT_MS = 5_000;
export const DEFAULT_SEMANTIC_EMBED_TIMEOUT_MS = 30_000;

export type SemanticIndexChunk = { file: string; text: string; vector: number[] };
export type SemanticIndex = {
  schema: 1;
  model: string;
  chunkChars?: number;
  fileHashes?: Record<string, string>;
  chunks: SemanticIndexChunk[];
};
export type SemanticIndexBuildStats = {
  totalChunks: number;
  reusedChunks: number;
  embeddedChunks: number;
  embeddedChars: number;
  reusedFiles: number;
  embeddedFiles: number;
};
export type BuildSemanticIndexOptions = {
  existingIndex?: SemanticIndex;
  onStats?: (stats: SemanticIndexBuildStats) => void;
};
export type SemanticMatch = { file: string; score: number; excerpt: string };
export type RerankedMatch = SemanticMatch & { rerankScore?: number };
export type RerankOutcome = { matches: RerankedMatch[]; changedPositions: number };

export type DecisionReranker = (
  query: string,
  candidates: { id: string; text: string }[],
) => Promise<Record<string, number | undefined>>;

export type EmbeddingProvider = {
  available(): Promise<boolean>;
  embed(texts: string[]): Promise<number[][]>;
};

export const SEMANTIC_CONFIG_PATH = "semantic.yml";
export const SEMANTIC_INDEX_PATH = "semantic/index.json";

export const DEFAULT_SEMANTIC_CONFIG: SemanticConfig = {
  enabled: false,
  model: "embeddinggemma-2:latest",
  baseUrl: "http://localhost:11434",
  chunkChars: 1200,
  topK: 8,
  excludeLockfiles: true,
};

export const SEMANTIC_LOCKFILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "deno.lock",
  "flake.lock",
  "gemfile.lock",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

export function isExcludedIndexFile(file: string): boolean {
  return SEMANTIC_LOCKFILE_NAMES.has(file.split("/").pop()?.toLowerCase() ?? "");
}

export function parseSemanticMapping(raw: unknown): SemanticConfig {
  if (!raw || typeof raw !== "object") throw new Error("semantic must be a YAML mapping");
  const raw2 = raw as Record<string, unknown>;
  const enabled = raw2.enabled;
  const model = raw2.model;
  const baseUrl = raw2.baseUrl;
  const chunkChars = raw2.chunkChars;
  const topK = raw2.topK;
  const rawExclude = raw2.excludeLockfiles;
  const apiKeyEnv = raw2.apiKeyEnv;
  const timeoutMs = raw2.timeoutMs;
  if (typeof enabled !== "boolean") throw new Error("semantic.enabled must be a boolean");
  const excludeLockfiles = rawExclude === undefined ? true : (rawExclude as boolean);
  if (!enabled) return { ...DEFAULT_SEMANTIC_CONFIG, enabled: false, excludeLockfiles };
  if (rawExclude !== undefined && typeof rawExclude !== "boolean")
    throw new Error("semantic.excludeLockfiles must be a boolean");
  if (
    apiKeyEnv !== undefined &&
    (typeof apiKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv))
  )
    throw new Error("semantic.apiKeyEnv must be an uppercase environment variable name");
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1)
  )
    throw new Error("semantic.timeoutMs must be a positive integer");
  if (typeof model !== "string" || model.trim() === "")
    throw new Error("semantic.model must be a non-empty string when semantic mapping is enabled");
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl))
    throw new Error("semantic.baseUrl must be an http(s) URL when semantic mapping is enabled");
  const parsedChunk = chunkChars === undefined ? DEFAULT_SEMANTIC_CONFIG.chunkChars : chunkChars;
  const parsedTopK = topK === undefined ? DEFAULT_SEMANTIC_CONFIG.topK : topK;

  if (typeof parsedChunk !== "number" || !Number.isInteger(parsedChunk) || parsedChunk < 200)
    throw new Error("semantic.chunkChars must be an integer of at least 200");
  if (typeof parsedTopK !== "number" || !Number.isInteger(parsedTopK) || parsedTopK < 1)
    throw new Error("semantic.topK must be a positive integer");
  return {
    enabled: true,
    model,
    baseUrl,
    chunkChars: parsedChunk,
    topK: parsedTopK,
    excludeLockfiles,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function serializeSemanticConfig(config: SemanticConfig): string {
  return `semantic:\n  enabled: ${config.enabled}\n  model: ${config.model}\n  baseUrl: ${config.baseUrl}\n  chunkChars: ${config.chunkChars}\n  topK: ${config.topK}\n  excludeLockfiles: ${config.excludeLockfiles}${config.apiKeyEnv ? `\n  apiKeyEnv: ${config.apiKeyEnv}` : ""}${config.timeoutMs !== undefined ? `\n  timeoutMs: ${config.timeoutMs}` : ""}\n`;
}

export function loadSemanticConfig(fs: FileSystem, aiwPath: string): SemanticConfig | undefined {
  const settings = loadSettings(fs, aiwPath);
  if (settings !== undefined)
    return "semantic" in settings ? parseSemanticMapping(settings.semantic) : undefined;
  const configPath = `${aiwPath}/${SEMANTIC_CONFIG_PATH}`;
  if (!fs.exists(configPath)) return undefined;
  return parseSemanticConfig(fs.read(configPath));
}

/** FRIC-001: semantic retrieval is usable when mapping is enabled and an index exists. */
export function semanticRetrievalAvailable(fs: FileSystem, aiwPath: string): boolean {
  const config = loadSemanticConfig(fs, aiwPath);
  return config?.enabled === true && fs.exists(join(aiwPath, SEMANTIC_INDEX_PATH));
}

function parseSemanticDocument(text: string): SemanticConfig {
  const document = parseDocument(text);
  const node = document.get("semantic");
  if (document.errors.length > 0 || !node || typeof node !== "object")
    throw new Error("Semantic configuration must be a YAML object with a `semantic` mapping");
  return parseSemanticMapping((node as { toJSON(): unknown }).toJSON());
}

export function parseSemanticConfig(text: string): SemanticConfig {
  return parseSemanticDocument(text);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const EMBED_BATCH_SIZE = 64;

function hasOllamaModel(
  models: { name?: unknown; model?: unknown }[] | undefined,
  configured: string,
): boolean {
  const names = new Set(
    (models ?? []).flatMap((entry) =>
      [entry?.name, entry?.model].filter((value): value is string => typeof value === "string"),
    ),
  );
  if (names.has(configured)) return true;
  if (!configured.includes(":") && names.has(`${configured}:latest`)) return true;
  return false;
}

export function createOllamaEmbeddingProvider(
  config: SemanticConfig,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmbeddingProvider {
  const externalToken = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
  const isExternal = config.apiKeyEnv !== undefined;
  const authHeaders = (extra: Record<string, string> = {}): Record<string, string> =>
    externalToken ? { ...extra, authorization: `Bearer ${externalToken}` } : extra;
  const embedTimeoutMs = config.timeoutMs ?? DEFAULT_SEMANTIC_EMBED_TIMEOUT_MS;
  const availabilityTimeoutMs = Math.min(embedTimeoutMs, DEFAULT_SEMANTIC_AVAILABILITY_TIMEOUT_MS);
  if (isExternal)
    return {
      async available(): Promise<boolean> {
        try {
          const response = await fetchImpl(`${config.baseUrl}/v1/models`, {
            headers: authHeaders(),
            signal: AbortSignal.timeout(availabilityTimeoutMs),
          });
          return response.ok;
        } catch (error) {
          debugLog("models", `external embedding availability failed for ${config.model}`, error);
          return false;
        }
      },
      async embed(texts: string[]): Promise<number[][]> {
        const vectors: number[][] = [];
        for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
          const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE);
          const response = await fetchImpl(`${config.baseUrl}/v1/embeddings`, {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            signal: AbortSignal.timeout(embedTimeoutMs),
            body: JSON.stringify({ model: config.model, input: batch }),
          });
          if (!response.ok) throw new Error(`Embedding request failed for model ${config.model}`);
          const body = (await response.json()) as { data?: { embedding?: unknown }[] };
          const rows = body.data ?? [];
          if (
            rows.length !== batch.length ||
            rows.some(
              (row) =>
                !Array.isArray(row.embedding) || row.embedding.some((v) => typeof v !== "number"),
            )
          )
            throw new Error(`Embedding model ${config.model} returned invalid vectors`);
          vectors.push(...rows.map((row) => row.embedding as number[]));
        }
        return vectors;
      },
    };
  return {
    async available(): Promise<boolean> {
      try {
        const response = await fetchImpl(`${config.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(availabilityTimeoutMs),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
        return hasOllamaModel(body.models, config.model);
      } catch (error) {
        debugLog("models", `ollama embedding availability failed for ${config.model}`, error);
        return false;
      }
    },
    async embed(texts: string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
        const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE);
        const response = await fetchImpl(`${config.baseUrl}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(embedTimeoutMs),
          body: JSON.stringify({ model: config.model, input: batch }),
        });
        if (!response.ok) throw new Error(`Embedding request failed for model ${config.model}`);
        const body = (await response.json()) as { embeddings?: unknown };
        if (
          !Array.isArray(body.embeddings) ||
          body.embeddings.length !== batch.length ||
          body.embeddings.some(
            (vector) => !Array.isArray(vector) || vector.some((v) => typeof v !== "number"),
          )
        )
          throw new Error(`Embedding model ${config.model} returned invalid vectors`);
        vectors.push(...(body.embeddings as number[][]));
      }
      return vectors;
    },
  };
}

export function chunkText(content: string, chunkChars: number): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > chunkChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length > 0 && current.join("").trim().length > 0) chunks.push(current.join("\n"));
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length && index < b.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function buildSemanticIndex(
  files: string[],
  readContent: (file: string) => Promise<string | undefined>,
  provider: EmbeddingProvider,
  config: SemanticConfig,
  options: BuildSemanticIndexOptions = {},
): Promise<SemanticIndex> {
  const existing = options.existingIndex;
  const canReuse =
    existing !== undefined &&
    existing.model === config.model &&
    (existing.chunkChars === undefined || existing.chunkChars === config.chunkChars) &&
    existing.fileHashes !== undefined;
  const existingByFile = new Map<string, SemanticIndexChunk[]>();
  if (canReuse && existing) {
    for (const chunk of existing.chunks) {
      const list = existingByFile.get(chunk.file);
      if (list) list.push(chunk);
      else existingByFile.set(chunk.file, [chunk]);
    }
  }

  const reusedChunks: SemanticIndexChunk[] = [];
  const pendingEntries: { file: string; text: string }[] = [];
  const fileHashes: Record<string, string> = {};
  let reusedFiles = 0;
  let embeddedFiles = 0;

  for (const file of files) {
    if (config.excludeLockfiles && isExcludedIndexFile(file)) continue;
    const content = await readContent(file);
    if (content === undefined) continue;
    const digest = hashFileContent(content);
    fileHashes[file] = digest;
    if (canReuse && existing?.fileHashes?.[file] === digest) {
      const prior = existingByFile.get(file) ?? [];
      reusedChunks.push(...prior);
      reusedFiles += 1;
      continue;
    }
    const chunks = chunkText(content, config.chunkChars);
    for (const chunk of chunks) pendingEntries.push({ file, text: chunk });
    if (chunks.length > 0) embeddedFiles += 1;
  }

  const vectors =
    pendingEntries.length > 0
      ? await provider.embed(pendingEntries.map((entry) => entry.text))
      : [];
  const embeddedChunks: SemanticIndexChunk[] = pendingEntries.map((entry, index) => ({
    ...entry,
    vector: vectors[index],
  }));
  const allChunks = [...reusedChunks, ...embeddedChunks];
  options.onStats?.({
    totalChunks: allChunks.length,
    reusedChunks: reusedChunks.length,
    embeddedChunks: embeddedChunks.length,
    embeddedChars: embeddedChunks.reduce((total, chunk) => total + chunk.text.length, 0),
    reusedFiles,
    embeddedFiles,
  });
  return {
    schema: 1,
    model: config.model,
    chunkChars: config.chunkChars,
    fileHashes,
    chunks: allChunks,
  };
}

export function serializeSemanticIndex(index: SemanticIndex): string {
  return JSON.stringify(index);
}

export function parseSemanticIndex(text: string): SemanticIndex {
  const parsed = JSON.parse(text) as SemanticIndex;
  if (parsed.schema !== 1 || typeof parsed.model !== "string" || !Array.isArray(parsed.chunks))
    throw new Error("Invalid semantic index");
  if (
    parsed.chunkChars !== undefined &&
    (typeof parsed.chunkChars !== "number" || !Number.isInteger(parsed.chunkChars))
  )
    throw new Error("Invalid semantic index chunkChars");
  if (
    parsed.fileHashes !== undefined &&
    (typeof parsed.fileHashes !== "object" ||
      parsed.fileHashes === null ||
      Array.isArray(parsed.fileHashes) ||
      Object.values(parsed.fileHashes).some((value) => typeof value !== "string"))
  )
    throw new Error("Invalid semantic index fileHashes");
  for (const chunk of parsed.chunks) {
    if (
      typeof chunk.file !== "string" ||
      typeof chunk.text !== "string" ||
      !Array.isArray(chunk.vector) ||
      chunk.vector.some((value) => typeof value !== "number")
    )
      throw new Error("Invalid semantic index chunk");
  }
  return parsed;
}

export async function querySemanticIndex(
  index: SemanticIndex,
  query: string,
  provider: EmbeddingProvider,
  config: SemanticConfig,
): Promise<SemanticMatch[]> {
  if (index.model !== config.model)
    throw new Error(
      `Semantic index was built with ${index.model} but the active semantic model is ${config.model}`,
    );
  if (index.chunks.length === 0) return [];
  const [vector] = await provider.embed([query]);
  return index.chunks
    .map((chunk) => ({
      file: chunk.file,
      score: cosineSimilarity(vector, chunk.vector),
      excerpt: chunk.text.split("\n").slice(0, 3).join("\n").slice(0, 200),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topK);
}

export async function rerankSemanticMatches(
  matches: SemanticMatch[],
  query: string,
  reranker: DecisionReranker,
): Promise<RerankOutcome> {
  if (matches.length === 0) return { matches: [], changedPositions: 0 };
  const candidates = matches.map((match, index) => ({
    id: `match_${index}`,
    text: `${match.file}\n${match.excerpt}`,
  }));
  const scores = await reranker(query, candidates);
  const reranked: RerankedMatch[] = matches.map((match, index) => {
    const rerankScore = scores[`match_${index}`];
    return Number.isFinite(rerankScore)
      ? { ...match, rerankScore: rerankScore as number }
      : { ...match };
  });
  reranked.sort((a, b) => (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score));
  let changedPositions = 0;
  for (let index = 0; index < reranked.length; index += 1)
    if (reranked[index].file !== matches[index].file) changedPositions += 1;
  return { matches: reranked, changedPositions };
}

/** OPP-008: path-semantics-only query for covering tests (no symbol parsing). */
export function buildCoveringTestQuery(path: string): string {
  const generic = new Set(["src", "lib", "app", "index", "main", "test", "tests", "spec"]);
  const terms = path
    .split(/[/.-]/)
    .filter((segment) => segment && !generic.has(segment.toLowerCase()));
  return `tests exercising ${terms.join(" ") || path}`;
}

const TEST_FILE_PATTERN = /(\.test\.|\.spec\.|(^|\/)tests?\/)/;

export type CoveringEvidence = { covering: string[]; degraded: boolean };

/**
 * OPP-008 REQ-001: retrieval-aided covering-test detection. `undefined` keeps
 * the deterministic sibling heuristic byte-identical (no config/index).
 * Provider failures degrade to empty coverage (REQ-004: fail safe).
 */
export async function semanticCoveringEvidence(
  fs: FileSystem,
  aiwPath: string,
  paths: string[],
  provider?: EmbeddingProvider,
): Promise<CoveringEvidence | undefined> {
  const config = loadSemanticConfig(fs, aiwPath);
  if (!config?.enabled) return undefined;
  const indexPath = join(aiwPath, SEMANTIC_INDEX_PATH);
  if (!fs.exists(indexPath)) return undefined;
  try {
    const index = parseSemanticIndex(fs.read(indexPath));
    const embed = provider ?? createOllamaEmbeddingProvider(config);
    if (!(await embed.available())) return { covering: [], degraded: true };
    const covering: string[] = [];
    for (const path of paths) {
      const matches = await querySemanticIndex(index, buildCoveringTestQuery(path), embed, config);
      if (matches.some((match) => TEST_FILE_PATTERN.test(match.file))) covering.push(path);
    }
    return { covering, degraded: false };
  } catch (error) {
    debugLog("models", "semantic covering evidence degraded", error);
    return { covering: [], degraded: true };
  }
}

/**
 * FLOW-001: advisory semantic context lookup for SDD artifact scaffolds.
 * Never throws; returns undefined when semantic retrieval is disabled, missing,
 * offline, or yields no matches.
 */
export async function suggestSemanticContext(
  fs: FileSystem,
  aiwPath: string,
  query: string,
  provider?: EmbeddingProvider,
  maxItems = 5,
): Promise<string | undefined> {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const config = loadSemanticConfig(fs, aiwPath);
  if (!config?.enabled) return undefined;
  const indexPath = join(aiwPath, SEMANTIC_INDEX_PATH);
  if (!fs.exists(indexPath)) return undefined;
  try {
    const index = parseSemanticIndex(fs.read(indexPath));
    if (index.model !== config.model || index.chunks.length === 0) return undefined;
    const embed = provider ?? createOllamaEmbeddingProvider(config);
    if (!(await embed.available())) return undefined;
    const matches = await querySemanticIndex(index, trimmed, embed, {
      ...config,
      topK: Math.min(config.topK, maxItems),
    });
    if (matches.length === 0) return undefined;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const match of matches) {
      if (seen.has(match.file)) continue;
      seen.add(match.file);
      const snippet = match.excerpt.replace(/\s+/g, " ").trim().slice(0, 120);
      lines.push(`- \`${match.file}\` (score ${match.score.toFixed(3)}): ${snippet}`);
      if (lines.length >= maxItems) break;
    }
    if (lines.length === 0) return undefined;
    return `\n## Relevant Context (Semantic Retrieval — Advisory)\n\n${lines.join("\n")}\n`;
  } catch (error) {
    debugLog("models", `semantic context suggestion degraded for query "${trimmed}"`, error);
    return undefined;
  }
}

/** OPP-008 REQ-003: diff first, retrieved chunks fill the remaining budget, labeled as aids. */
export function renderJudgeContext(
  diff: string,
  chunks: { file: string; excerpt: string }[],
  budget: number,
): string {
  const lines: string[] = [diff];
  let used = diff.length;
  for (const chunk of chunks) {
    const block = `\n- ${chunk.file} (context aid (retrieval — not a confirmed fact)): ${chunk.excerpt}`;
    if (used + block.length > budget) break;
    lines.push(block);
    used += block.length;
  }
  return lines.join("");
}
