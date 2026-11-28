import { describe, expect, it } from "vitest";
import type { FileSystem } from "./types.js";
import {
  buildSemanticIndex,
  chunkText,
  cosineSimilarity,
  createOllamaEmbeddingProvider,
  parseSemanticMapping,
  DEFAULT_SEMANTIC_CONFIG,
  parseSemanticConfig,
  parseSemanticIndex,
  querySemanticIndex,
  rerankSemanticMatches,
  serializeSemanticIndex,
  suggestSemanticContext,
  type EmbeddingProvider,
  type SemanticConfig,
  type SemanticIndexBuildStats,
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

  it("reuses unchanged file chunks incrementally and re-embeds only modified/new files (FLOW-001)", async () => {
    const embeddedTexts: string[] = [];
    const trackingProvider: EmbeddingProvider = {
      async available(): Promise<boolean> {
        return true;
      },
      async embed(texts: string[]): Promise<number[][]> {
        embeddedTexts.push(...texts);
        return texts.map((text) => [text.length, 1]);
      },
    };
    const contents: Record<string, string> = {
      "a.ts": "export const a = 1;",
      "b.ts": "export const b = 2;",
    };
    const first = await buildSemanticIndex(
      ["a.ts", "b.ts"],
      async (file) => contents[file],
      trackingProvider,
      enabledConfig,
    );
    expect(embeddedTexts).toHaveLength(2);
    expect(first.fileHashes).toBeDefined();

    embeddedTexts.length = 0;
    contents["b.ts"] = "export const b = 200;";
    contents["c.ts"] = "export const c = 3;";
    let stats: SemanticIndexBuildStats | undefined;
    const second = await buildSemanticIndex(
      ["a.ts", "b.ts", "c.ts"],
      async (file) => contents[file],
      trackingProvider,
      enabledConfig,
      {
        existingIndex: first,
        onStats: (recorded) => {
          stats = recorded;
        },
      },
    );
    expect(embeddedTexts).toEqual(["export const b = 200;", "export const c = 3;"]);
    expect(stats?.reusedFiles).toBe(1);
    expect(stats?.embeddedFiles).toBe(2);
    expect(stats?.reusedChunks).toBe(1);
    expect(stats?.embeddedChunks).toBe(2);
    expect(second.chunks.map((chunk) => chunk.file).sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("validates timeoutMs and matches Ollama models without explicit :latest tag (FLOW-001)", async () => {
    const parsed = parseSemanticMapping({
      enabled: true,
      model: "nomic-embed-text",
      baseUrl: "http://localhost:11434",
      timeoutMs: 4500,
    });
    expect(parsed.timeoutMs).toBe(4500);
    expect(() =>
      parseSemanticMapping({
        enabled: true,
        model: "nomic-embed-text",
        baseUrl: "http://localhost:11434",
        timeoutMs: -1,
      }),
    ).toThrow(/timeoutMs/);

    const seenInits: RequestInit[] = [];
    const provider = createOllamaEmbeddingProvider(parsed, async (_url, init) => {
      seenInits.push(init ?? {});
      return new Response(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }), {
        status: 200,
      });
    });
    expect(await provider.available()).toBe(true);
    expect(seenInits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("suggests advisory semantic context and degrades silently when offline (FLOW-001)", async () => {
    const vectors = new Map<string, number[]>([
      ["auth token", [1, 0]],
      ["export function verifyToken() {}", [0.95, 0.05]],
    ]);
    const index = await buildSemanticIndex(
      ["src/auth.ts"],
      async () => "export function verifyToken() {}",
      fakeProvider(vectors),
      enabledConfig,
    );
    const fs = memoryFileSystem({
      ".aiw/settings.yml":
        "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
      ".aiw/semantic/index.json": serializeSemanticIndex(index),
    });
    const section = await suggestSemanticContext(fs, ".aiw", "auth token", fakeProvider(vectors));
    expect(section).toContain("## Relevant Context (Semantic Retrieval — Advisory)");
    expect(section).toContain("`src/auth.ts`");

    const offlineProvider: EmbeddingProvider = {
      async available(): Promise<boolean> {
        return false;
      },
      async embed(): Promise<number[][]> {
        throw new Error("offline");
      },
    };
    expect(await suggestSemanticContext(fs, ".aiw", "auth token", offlineProvider)).toBeUndefined();
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

describe("external embedding provider", () => {
  const externalConfig = {
    ...enabledConfig,
    baseUrl: "https://api.example.com",
    apiKeyEnv: "AIW_EMBED_KEY",
  };
  it("uses /v1/embeddings with a bearer token", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const provider = createOllamaEmbeddingProvider(
      externalConfig,
      async (url, init) => {
        seen.push({ url, init: init ?? {} });
        if (url.endsWith("/v1/models")) return new Response("{}", { status: 200 });
        return new Response(
          JSON.stringify({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
          { status: 200 },
        );
      },
      { AIW_EMBED_KEY: "tok" },
    );
    expect(await provider.available()).toBe(true);
    const vectors = await provider.embed(["a", "b"]);
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(seen[0].url).toBe("https://api.example.com/v1/models");
    expect(seen[1].url).toBe("https://api.example.com/v1/embeddings");
    expect(JSON.parse(String(seen[1].init.body)).input).toEqual(["a", "b"]);
    expect((seen[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("validates the external response shape", async () => {
    const provider = createOllamaEmbeddingProvider(
      externalConfig,
      async () => new Response(JSON.stringify({ data: [{ embedding: [1] }] }), { status: 200 }),
      { AIW_EMBED_KEY: "tok" },
    );
    await expect(provider.embed(["a", "b"])).rejects.toThrow(/invalid vectors/i);
  });
  it("parses apiKeyEnv from settings and rejects invalid names", () => {
    expect(parseSemanticMapping({ ...enabledConfig, apiKeyEnv: "AIW_EMBED_KEY" }).apiKeyEnv).toBe(
      "AIW_EMBED_KEY",
    );
    expect(() => parseSemanticMapping({ ...enabledConfig, apiKeyEnv: "nope" })).toThrow(
      /semantic.apiKeyEnv/,
    );
  });
});

// ---- OPP-008: covering-test retrieval + judge context scoping ----

function memoryFs(files: Record<string, string>): import("./types.js").FileSystem {
  return {
    exists: (path: string): boolean => path in files,
    read: (path: string): string => {
      if (!(path in files)) throw new Error(`missing: ${path}`);
      return files[path];
    },
    write: (path: string, content: string): void => {
      files[path] = content;
    },
    mkdir: (): void => {},
    remove: (path: string): void => {
      delete files[path];
    },
  };
}

import {
  buildCoveringTestQuery,
  renderJudgeContext,
  semanticCoveringEvidence,
} from "./semantic.js";

describe("covering-test retrieval (OPP-008)", () => {
  it("builds path-semantics queries without generic terms", () => {
    expect(buildCoveringTestQuery("src/auth/token.ts")).toContain("auth");
    expect(buildCoveringTestQuery("src/auth/token.ts")).toContain("token");
    expect(buildCoveringTestQuery("src/index.ts")).not.toContain("src");
  });

  it("counts differently-named test chunks as covering evidence (REQ-001)", async () => {
    const aiw = ".aiw";
    const fs = memoryFs({
      [`${aiw}/settings.yml`]:
        "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
      [`${aiw}/semantic/index.json`]: JSON.stringify({
        schema: 1,
        model: "test-model",
        chunks: [
          { file: "tests/integration.spec.ts", text: "exercises token issuance", vector: [1, 0] },
        ],
      }),
    });
    const provider = {
      available: async (): Promise<boolean> => true,
      embed: async (): Promise<number[][]> => [[1, 0]],
    };
    const result = await semanticCoveringEvidence(fs, aiw, ["src/auth/token.ts"], provider);
    expect(result?.covering).toEqual(["src/auth/token.ts"]);
    expect(result?.degraded).toBe(false);
  });

  it("returns no coverage when retrieval finds nothing (fail-safe)", async () => {
    const aiw = ".aiw";
    const fs = memoryFs({
      [`${aiw}/settings.yml`]:
        "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
      [`${aiw}/semantic/index.json`]: JSON.stringify({
        schema: 1,
        model: "test-model",
        chunks: [{ file: "src/other.ts", text: "unrelated", vector: [1, 0] }],
      }),
    });
    const result = await semanticCoveringEvidence(fs, aiw, ["src/auth/token.ts"], {
      available: async () => true,
      embed: async () => [[0, 1]],
    });
    expect(result?.covering).toEqual([]);
  });

  it("degrades to empty coverage when the provider fails (REQ-004)", async () => {
    const aiw = ".aiw";
    const fs = memoryFs({
      [`${aiw}/settings.yml`]:
        "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
      [`${aiw}/semantic/index.json`]: JSON.stringify({
        schema: 1,
        model: "test-model",
        chunks: [{ file: "tests/a.spec.ts", text: "x", vector: [1, 0] }],
      }),
    });
    const result = await semanticCoveringEvidence(fs, aiw, ["src/a.ts"], {
      available: async () => true,
      embed: async () => {
        throw new Error("endpoint down");
      },
    });
    expect(result?.covering).toEqual([]);
    expect(result?.degraded).toBe(true);
  });

  it("is undefined without semantic config or index (byte-identical floor)", async () => {
    const fs = memoryFs({});
    expect(await semanticCoveringEvidence(fs, ".aiw", ["src/a.ts"])).toBeUndefined();
    const fsConfigOnly = memoryFs({
      ".aiw/settings.yml":
        "semantic:\n  enabled: true\n  model: m\n  baseUrl: http://localhost:11434\n",
    });
    expect(await semanticCoveringEvidence(fsConfigOnly, ".aiw", ["src/a.ts"])).toBeUndefined();
  });
});

describe("judge context rendering (OPP-008)", () => {
  it("puts the diff first and labels chunks as context aids within budget (REQ-003)", () => {
    const rendered = renderJudgeContext(
      "diff --git a/src/a.ts",
      [
        { file: "src/caller.ts", excerpt: "calls a() from the changed module" },
        { file: "src/types.ts", excerpt: "shared contract types" },
      ],
      160,
    );
    expect(rendered.indexOf("diff --git")).toBeLessThan(rendered.indexOf("src/caller.ts"));
    expect(rendered).toContain("context aid (retrieval");
    expect(rendered).toContain("src/caller.ts");
    expect(rendered).not.toContain("src/types.ts"); // over budget
  });
});
