import { describe, expect, it } from "vitest";
import type { FileSystem } from "./types.js";
import {
  buildSemanticIndex,
  chunkText,
  cosineSimilarity,
  createOllamaEmbeddingProvider,
  DEFAULT_SEMANTIC_CONFIG,
  parseSemanticConfig,
  parseSemanticIndex,
  querySemanticIndex,
  rerankSemanticMatches,
  serializeSemanticIndex,
  type EmbeddingProvider,
  type SemanticConfig,
} from "./semantic.js";

function memoryFileSystem(files: Record<string, string> = {}): FileSystem {
  return {
    exists: (path): boolean => path in files,
    read: (path): string => {
      if (!(path in files)) throw new Error(`missing: ${path}`);
      return files[path];
    },
    write: (path, content): void => {
      files[path] = content;
    },
    mkdir: (): void => {},
  };
}

function fakeProvider(vectors: Map<string, number[]>): EmbeddingProvider {
  let counter = 0;
  return {
    async available(): Promise<boolean> {
      return true;
    },
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text): number[] => {
        const preset = vectors.get(text);
        if (preset) return preset;
        counter += 1;
        return [counter, counter % 2];
      });
    },
  };
}

const enabledConfig: SemanticConfig = {
  enabled: true,
  model: "test-model",
  baseUrl: "http://localhost:11434",
  chunkChars: 1200,
  topK: 2,
  excludeLockfiles: true,
};
describe("semantic configuration", () => {
  it("disables semantic mapping when enabled is false", () => {
    const config = parseSemanticConfig("semantic:\n  enabled: false\n");
    expect(config.enabled).toBe(false);
    expect(config.model).toBe(DEFAULT_SEMANTIC_CONFIG.model);
  });

  it("requires a model and http(s) base URL when enabled", () => {
    const config = parseSemanticConfig(
      "semantic:\n  enabled: true\n  model: embeddinggemma-2:latest\n  baseUrl: http://localhost:11434\n",
    );
    expect(config.enabled).toBe(true);
    expect(config.model).toBe("embeddinggemma-2:latest");
    expect(() => parseSemanticConfig("semantic:\n  enabled: true\n")).toThrow(/model/);
    expect(() =>
      parseSemanticConfig("semantic:\n  enabled: true\n  model: m\n  baseUrl: ftp://host\n"),
    ).toThrow(/baseUrl/);
    expect(() =>
      parseSemanticConfig(
        "semantic:\n  enabled: true\n  model: m\n  baseUrl: http://h\n  chunkChars: 10\n",
      ),
    ).toThrow(/chunkChars/);
    expect(() => parseSemanticConfig("other: true\n")).toThrow(/semantic/);
  });
});

describe("semantic chunking", () => {
  it("splits content into line-aligned chunks", () => {
    const chunks = chunkText("a\n".repeat(50), 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10);
  });

  it("drops empty content", () => {
    expect(chunkText("   \n\n", 100)).toEqual([]);
  });
});

describe("semantic similarity", () => {
  it("scores identical vectors highest and orthogonal vectors zero", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("semantic index", () => {
  it("builds and serializes an index deterministically", async () => {
    const index = await buildSemanticIndex(
      ["a.ts", "missing.ts"],
      async (file) => (file === "a.ts" ? "export const a = 1;" : undefined),
      fakeProvider(new Map()),
      enabledConfig,
    );
    expect(index.model).toBe("test-model");
    expect(index.chunks.map((chunk) => chunk.file)).toEqual(["a.ts"]);
    expect(parseSemanticIndex(serializeSemanticIndex(index))).toEqual(index);
    expect(() => parseSemanticIndex("{}")).toThrow(/Invalid semantic index/);
  });

  it("returns an empty index when no content is indexable", async () => {
    const index = await buildSemanticIndex(
      ["missing.ts"],
      async () => undefined,
      fakeProvider(new Map()),
      enabledConfig,
    );
    expect(index.chunks).toEqual([]);
    expect(
      await querySemanticIndex(index, "anything", fakeProvider(new Map()), enabledConfig),
    ).toEqual([]);
  });

  it("ranks query matches by cosine similarity up to topK", async () => {
    const vectors = new Map<string, number[]>([
      ["query", [1, 0]],
      ["alpha", [0.9, 0.1]],
      ["beta", [0, 1]],
    ]);
    const index = await buildSemanticIndex(
      ["alpha.ts", "beta.ts"],
      async (file) => (file === "alpha.ts" ? "alpha" : "beta"),
      fakeProvider(vectors),
      enabledConfig,
    );
    const matches = await querySemanticIndex(index, "query", fakeProvider(vectors), enabledConfig);
    expect(matches[0].file).toBe("alpha.ts");
    expect(matches).toHaveLength(2);
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it("excludes lockfiles from the index unless disabled", async () => {
    const files = ["src/a.ts", "package-lock.json", "pnpm-lock.yaml"];
    const included = await buildSemanticIndex(
      files,
      async (file) => `content of ${file}`,
      fakeProvider(new Map()),
      enabledConfig,
    );
    expect(included.chunks.map((chunk) => chunk.file)).toEqual(["src/a.ts"]);
    const overridden = await buildSemanticIndex(
      files,
      async (file) => `content of ${file}`,
      fakeProvider(new Map()),
      { ...enabledConfig, excludeLockfiles: false },
    );
    expect(overridden.chunks.map((chunk) => chunk.file)).toEqual(files);
  });

  it("rejects queries against an index built with a different model", async () => {
    const index = await buildSemanticIndex(
      ["a.ts"],
      async () => "content",
      fakeProvider(new Map()),
      enabledConfig,
    );
    await expect(
      querySemanticIndex(index, "query", fakeProvider(new Map()), {
        ...enabledConfig,
        model: "other-model",
      }),
    ).rejects.toThrow(/other-model/);
  });

  it("reranks matches with the decision model and reports influence", async () => {
    const matches = [
      { file: "alpha.ts", score: 0.9, excerpt: "alpha" },
      { file: "beta.ts", score: 0.8, excerpt: "beta" },
      { file: "gamma.ts", score: 0.7, excerpt: "gamma" },
    ];
    const outcome = await rerankSemanticMatches(matches, "query", async () => ({
      match_0: 0.1,
      match_1: 0.9,
      match_2: undefined,
    }));
    expect(outcome.matches.map((match) => match.file)).toEqual(["beta.ts", "gamma.ts", "alpha.ts"]);
    expect(outcome.changedPositions).toBe(3);
    expect(outcome.matches[0].rerankScore).toBe(0.9);
    expect(outcome.matches[2].rerankScore).toBe(0.1);
    expect(outcome.matches[1].rerankScore).toBeUndefined();
  });

  it("leaves the order untouched when no decision scores are provided", async () => {
    const matches = [
      { file: "alpha.ts", score: 0.9, excerpt: "alpha" },
      { file: "beta.ts", score: 0.8, excerpt: "beta" },
    ];
    const outcome = await rerankSemanticMatches(matches, "query", async () => ({}));
    expect(outcome.matches.map((match) => match.file)).toEqual(["alpha.ts", "beta.ts"]);
    expect(outcome.changedPositions).toBe(0);
  });

  it("handles empty match sets", async () => {
    const outcome = await rerankSemanticMatches([], "query", async () => ({}));
    expect(outcome).toEqual({ matches: [], changedPositions: 0 });
  });
});

describe("ollama embedding provider", () => {
  const calls: { url: string; body: string }[] = [];
  const fetchLike = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init?.body ?? "") });
    const input = (JSON.parse(String(init?.body ?? "{}")) as { input: string[] }).input;
    return new Response(JSON.stringify({ embeddings: input.map((_, index) => [index, 1]) }), {
      status: 200,
    });
  };
  it("embeds in batches through /api/embed", async () => {
    calls.length = 0;
    const provider = createOllamaEmbeddingProvider(enabledConfig, fetchLike as typeof fetch);
    const vectors = await provider.embed(Array.from({ length: 130 }, (_, i) => `t${i}`));
    expect(vectors).toHaveLength(130);
    expect(calls.every((call) => call.url.endsWith("/api/embed"))).toBe(true);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0].body).input).toHaveLength(64);
    expect(JSON.parse(calls[2].body).input).toHaveLength(2);
  });
  it("fails on malformed batch responses", async () => {
    const bad = async (): Promise<Response> =>
      new Response(JSON.stringify({ embeddings: [[0, 0]] }), { status: 200 });
    const provider = createOllamaEmbeddingProvider(enabledConfig, bad as typeof fetch);
    await expect(provider.embed(["a", "b"])).rejects.toThrow(/invalid vectors/i);
  });
});

describe("memory file system fixture", () => {
  it("supports write and exists", () => {
    const fs = memoryFileSystem();
    expect(fs.exists(".aiw/semantic.yml")).toBe(false);
    fs.write(".aiw/semantic.yml", "semantic:\n  enabled: false\n");
    expect(fs.exists(".aiw/semantic.yml")).toBe(true);
  });
});
