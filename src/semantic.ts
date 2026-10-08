import { parseDocument } from "yaml";
import type { FileSystem } from "./types.js";
import { loadSettings } from "./settings.js";

export type SemanticConfig = {
  enabled: boolean;
  model: string;
  baseUrl: string;
  chunkChars: number;
  topK: number;
};

export type SemanticIndexChunk = { file: string; text: string; vector: number[] };
export type SemanticIndex = { schema: 1; model: string; chunks: SemanticIndexChunk[] };
export type SemanticMatch = { file: string; score: number; excerpt: string };

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
};

export function parseSemanticMapping(raw: unknown): SemanticConfig {
  if (!raw || typeof raw !== "object") throw new Error("semantic must be a YAML mapping");
  const raw2 = raw as Record<string, unknown>;
  const enabled = raw2.enabled;
  const model = raw2.model;
  const baseUrl = raw2.baseUrl;
  const chunkChars = raw2.chunkChars;
  const topK = raw2.topK;
  if (typeof enabled !== "boolean") throw new Error("semantic.enabled must be a boolean");
  if (!enabled) return { ...DEFAULT_SEMANTIC_CONFIG, enabled: false };
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
  return { enabled: true, model, baseUrl, chunkChars: parsedChunk, topK: parsedTopK };
}

export function serializeSemanticConfig(config: SemanticConfig): string {
  return `semantic:\n  enabled: ${config.enabled}\n  model: ${config.model}\n  baseUrl: ${config.baseUrl}\n  chunkChars: ${config.chunkChars}\n  topK: ${config.topK}\n`;
}

export function loadSemanticConfig(fs: FileSystem, aiwPath: string): SemanticConfig | undefined {
  const settings = loadSettings(fs, aiwPath);
  if (settings !== undefined)
    return "semantic" in settings ? parseSemanticMapping(settings.semantic) : undefined;
  const configPath = `${aiwPath}/${SEMANTIC_CONFIG_PATH}`;
  if (!fs.exists(configPath)) return undefined;
  return parseSemanticConfig(fs.read(configPath));
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

export function createOllamaEmbeddingProvider(config: SemanticConfig): EmbeddingProvider {
  const fetchImpl: FetchLike = (url, init) => fetch(url, init);
  return {
    async available(): Promise<boolean> {
      try {
        const response = await fetchImpl(`${config.baseUrl}/api/tags`);
        if (!response.ok) return false;
        const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
        const names = new Set(
          (body.models ?? []).flatMap((entry) =>
            typeof entry?.name === "string" && typeof entry?.model === "string"
              ? [entry.name, entry.model]
              : [],
          ),
        );
        return names.has(config.model);
      } catch {
        return false;
      }
    },
    async embed(texts: string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (const text of texts) {
        const response = await fetchImpl(`${config.baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: config.model, prompt: text }),
        });
        if (!response.ok) throw new Error(`Embedding request failed for model ${config.model}`);
        const body = (await response.json()) as { embedding?: unknown };
        if (!Array.isArray(body.embedding) || body.embedding.some((v) => typeof v !== "number"))
          throw new Error(`Embedding model ${config.model} returned an invalid vector`);
        vectors.push(body.embedding as number[]);
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

export async function buildSemanticIndex(
  files: string[],
  readContent: (file: string) => Promise<string | undefined>,
  provider: EmbeddingProvider,
  config: SemanticConfig,
): Promise<SemanticIndex> {
  const entries: { file: string; text: string }[] = [];
  for (const file of files) {
    const content = await readContent(file);
    if (content === undefined) continue;
    for (const chunk of chunkText(content, config.chunkChars)) entries.push({ file, text: chunk });
  }
  if (entries.length === 0) return { schema: 1, model: config.model, chunks: [] };
  const vectors = await provider.embed(entries.map((entry) => entry.text));
  return {
    schema: 1,
    model: config.model,
    chunks: entries.map((entry, index) => ({ ...entry, vector: vectors[index] })),
  };
}

export function serializeSemanticIndex(index: SemanticIndex): string {
  return JSON.stringify(index);
}

export function parseSemanticIndex(text: string): SemanticIndex {
  const parsed = JSON.parse(text) as SemanticIndex;
  if (parsed.schema !== 1 || typeof parsed.model !== "string" || !Array.isArray(parsed.chunks))
    throw new Error("Invalid semantic index");
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
