# Semantic Mapping

AI Workflow can build a semantic index of the scanned project with a local embedding model such as `embeddinggemma-2` served by Ollama. Semantic mapping is opt-in and flag-gated: it activates only when a valid configuration exists, and every scan and flow query re-reads the flag.

## Configuration

Create `.aiw/semantic.yml`:

```yaml
semantic:
  enabled: true
  model: embeddinggemma-2:latest
  baseUrl: http://localhost:11434
  chunkChars: 1200 # optional, minimum 200
  topK: 8 # optional, results per query
```

- `enabled: false` (or a missing file) disables semantic mapping entirely; scans stay deterministic and make no network request.
- When enabled, `aiw scan` verifies that `model` is present at `baseUrl` (`GET /api/tags`) before indexing. A missing model fails the scan with an actionable error instead of producing a partial index.

## Indexing during scan

When semantic mapping is enabled, `aiw scan` additionally:

1. Reads the scanned files with strict UTF-8 decoding (unreadable files are skipped).
2. Splits each file into line-aligned chunks of at most `chunkChars` characters.
3. Embeds each chunk with `POST /api/embeddings`.
4. Writes the versioned index to `.aiw/semantic/index.json` (`schema: 1`).

The index stores the model name; queries against an index built with a different model fail explicitly.

## Queries during the flow

`aiw semantic query --text="<natural language>"` ranks indexed chunks by cosine similarity and returns the top `topK` matches with file, score, and excerpt. `aiw semantic status` reports whether mapping is configured and whether the index is built.

## Boundaries

- Semantic results are retrieval aids, not evidence. They never create confirmed project facts and never bypass human approval gates.
- The index is derived state; delete and rebuild it with `aiw scan` after structural changes.
