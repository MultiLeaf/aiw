# OPP-012: Standards discovery — extract codebase conventions into versioned standards

- Status: Implemented (2026-11-01, deterministic floor): aiw standards extract|list|confirm|reject with evidence-cited inferred standards; OPP-008 retrieval extension remains future
- Priority: P3 (depends on OPP-008 retrieval plumbing)
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Trend signal: Agent OS (5.5K★) built its positioning on "Discover Standards — extract patterns and conventions from your codebase into documented standards" and "Deploy Standards — inject relevant standards based on what you're building". AI Workflow generates rules from the detected **stack**; the trend is to extract them from the **codebase's actual conventions**, with evidence.

## Problem

AI Workflow generates project rules from detected and confirmed facts (stack, tools, scripts). What it does not capture: **how this codebase actually does things** — error-handling idiom, naming conventions, test structure, state management patterns. Consequences:

- generated guidance is generic ("this is a TypeScript project") rather than specific ("this repo wraps errors in `AppError` with `code` fields; tests live beside sources as `*.test.ts` using vitest `describe/it`");
- agents routinely propose idiomatic-but-foreign code that reviewers must correct;
- conventions live in senior developers' heads — exactly the knowledge agents lack.

## Proposal

1. **`aiw standards extract`** (read-only, evidence-linked): analyzes the repository (deterministic detectors first: file layout, test naming, config presence; semantic retrieval via OPP-008 when enabled for pattern instances) and produces **standards documents** under `.aiw/standards/<topic>.md` — each statement carries: the convention, **evidence citations** (file:line examples, N occurrences), and a confidence tier (detected-strong / detected-weak / proposed).
2. **Confirmation contract** (consistent with profile facts): standards are `inferred` until the human accepts/rejects/edits them via `aiw confirm`; accepted standards become `confirmed` and are versioned in the lockfile. AI output never silently becomes rule content.
3. **Injection into generated rules**: confirmed standards are rendered into project rules (and referenced from stage skills: "follow `.aiw/standards/error-handling.md`") through the existing generator — the same preserved-override/drift semantics as other generated content (GEN-002).
4. **Deterministic floor**: with no semantic mapping configured, extraction covers deterministic conventions only (naming patterns via glob/AST-lite heuristics, test layout, error-class presence) — no network, useful even offline. Retrieval only extends coverage (OPP-008's consumer, as anticipated).
5. **Freshness**: standards carry their extraction commit; `aiw scan` reports drift when the codebase diverges from recorded standards (files matching a standard's evidence changed) — advisory, consistent with drift detection elsewhere.

## Affected areas

- New `src/standards.ts` (extractors, confirmation state, rendering)
- `src/scanner.ts` (deterministic convention detectors), `src/semantic.ts` (OPP-008 retrieval for pattern instances)
- `src/generator.ts` (rule injection referencing confirmed standards), `src/drift.ts` (standards drift reporting)
- `.aiw/standards/` (new state directory), lockfile (confirmed standards)
- `docs/README.md`, `docs/architecture.md`, README

## Acceptance criteria

- Given a repository with consistent error-wrapping, when `aiw standards extract` runs offline, then the error-handling standard cites ≥2 file:line examples with occurrence counts and tier `detected-strong`, pending confirmation.
- Given inferred standards, when the human confirms one, then it becomes `confirmed`, is recorded in the lockfile, and appears in regenerated rules; rejected ones are never rendered.
- Given no semantic mapping configured, when extracting, then deterministic conventions still produce standards and no network request is made.
- Given confirmed standards, when a stage skill renders, then it references applicable standards by path (just-in-time, per the token-cost principle — standards content is loaded on demand, not inlined everywhere).
- Given a codebase change contradicting a confirmed standard, when `aiw scan` runs, then drift is reported as advisory with the diverging files named.

## Non-goals

- No auto-confirmation: all standards start inferred (profile-facts contract).
- No style-lint replacement: standards describe conventions; enforcement stays with the project's own linters.
- No cross-repository standards sharing in this iteration (org-level standards live in ENT-001/002 territory).

## Open questions

- Extractor taxonomy for v1: error handling, testing, naming, module layout — what else earns a dedicated extractor?
- Should standards participate in traceability (a rule citing a standard citing files)?
- Granularity: one document per topic vs one per convention-cluster (affects drift reporting precision)?
