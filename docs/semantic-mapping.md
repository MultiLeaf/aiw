# Semantic Mapping

AI Workflow can build a semantic index of the scanned project with a local embedding model such as `embeddinggemma-2` served by Ollama. Semantic mapping is opt-in and flag-gated: it activates only when a valid configuration exists, and every scan and flow query re-reads the flag. Configuration lives in the local user settings file `.aiw/settings.yml` under the `semantic` section; the legacy `.aiw/semantic.yml` file is still read when `settings.yml` does not exist.

The provider can be Ollama (default, `http://localhost:11434`) or any OpenAI-compatible embeddings endpoint: set `apiKeyEnv` to the name of the environment variable holding the bearer token, and requests go to `<baseUrl>/v1/embeddings` with `Authorization: Bearer <token>` instead of Ollama's `/api/embed`. The token is read from the environment at call time and never stored in settings.

During an interactive `aiw install`, the installer walks through provider selection: it probes the configured Ollama endpoint (`GET /api/tags`), offers Ollama or an external provider (external only, when Ollama is unreachable), lists the locally available embedding models — filtering to embedding-type models — and asks permission to run `ollama pull embeddinggemma-2` when none exist. External configuration asks for the endpoint URL, model name, and an optional token environment variable. The chosen setup is validated with a live request before being recorded in `.aiw/settings.yml`; a failed validation can be retried or skipped, and the next capability (decision triage) follows the same flow. Answering `n`, or installing non-interactively, leaves the section absent.

## Configuration

Add a `semantic` section to `.aiw/settings.yml`:

```yaml
semantic:
  enabled: true
  model: embeddinggemma-2:latest
  baseUrl: http://localhost:11434
  chunkChars: 1200 # optional, minimum 200
  topK: 8 # optional, results per query
  excludeLockfiles: true # optional, skip lockfiles and generated vendor manifests (default: true)
  apiKeyEnv: AIW_EMBED_KEY # optional, external OpenAI-compatible endpoint bearer token
```

- `enabled: false` (or a missing file) disables semantic mapping entirely; scans stay deterministic and make no network request.
- When enabled, `aiw scan` verifies that `model` is present at `baseUrl` (`GET /api/tags`) before indexing. A missing model fails the scan with an actionable error instead of producing a partial index.

## Indexing during scan

When semantic mapping is enabled, `aiw scan` additionally:

1. Reads the scanned files with strict UTF-8 decoding (unreadable files are skipped). Lockfiles and generated vendor manifests (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`, `composer.lock`, `deno.lock`, `bun.lock`, `bun.lockb`, `uv.lock`, `Pipfile.lock`, `flake.lock`, `npm-shrinkwrap.json`) are skipped by default because they contribute noise chunks without retrieval value; set `excludeLockfiles: false` to index them explicitly.
2. Splits each file into line-aligned chunks of at most `chunkChars` characters.
3. Embeds chunks in batches of up to 64 per request with `POST /api/embed` (Ollama batch embeddings endpoint) instead of one request per chunk.
4. Writes the versioned index to `.aiw/semantic/index.json` (`schema: 1`).

The index stores the model name; queries against an index built with a different model fail explicitly.

## Usage visibility

Every `aiw scan` reports the models it actually used, for example:

```text
Project profile generated.
Models used:
- embedding: embeddinggemma-2:latest — indexed 824 chunks in 13 batch requests (~45,000 tokens)
- interpreter: gpt-oss:20b — 5 facts from 12 files (~3,800 tokens)
```

Token estimates are also recorded per stage in `.aiw/usage.yml` (`scan.embedding`, `scan.interpreter`; the latest scan overwrites its stage entry) and can be inspected with `aiw token-usage`. Scans that use no models report `Models used: none (deterministic scan).`

## Queries during the flow

`aiw semantic query --text="<natural language>" [--rerank]` ranks indexed chunks by cosine similarity and returns the top `topK` matches with file, score, and excerpt. With `--rerank`, and only when a decision model is also enabled and available, the decision model additionally scores each retrieved candidate 0–1 for query relevance and the output is reordered by that advisory score; matches without a decision score keep their cosine order. The command reports the ranking influence (how many positions were reordered) and the per-match `rerank` score; cosine recall itself is unchanged and reranking never creates confirmed facts. `aiw semantic status` reports whether mapping is configured and whether the index is built.

## Boundaries

- Semantic results are retrieval aids, not evidence. They never create confirmed project facts and never bypass human approval gates.
- The index is derived state; delete and rebuild it with `aiw scan` after structural changes.

## Interpreter scoping

When semantic mapping is enabled and a valid index built with the active model exists, `aiw scan` scopes the AI interpreter's context semantically instead of alphabetically:

1. A deterministic set of key files (README, contributing/architecture docs, and primary package manifests such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`) is always included first, in a fixed priority order.
2. The remaining context is the top semantically relevant files for a deterministic analysis query derived from the detected profile (languages, frameworks, package manager), ranked through the existing embedding index.
3. Everything else is excluded, so measured token usage decreases while inferred-fact evidence still points at real scoped files.

Without semantic mapping (or when the index is missing, built with another model, or the embedding model is unavailable), the interpreter keeps the previous deterministic alphabetical scoping and scans make no network request for scoping purposes.

## Planned integration (OPP-008)

The next planned retrieval consumers follow the same contracts: covering-test detection for `aiw risk assess` (a semantic hit prevents a false `untested_regression` flag; absence fails safe toward `high`) and judge context scoping for the adversarial review skills (bounded retrieved chunks labeled as context aids). Deterministic fallbacks are unchanged; unconfigured behavior is byte-identical. See [OPP-008](opportunities/OPP-008-embedding-covering-tests-judge-context.md).
