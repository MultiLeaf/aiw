# OPP-006: Emission ≠ usability — test that named commands actually work

- Status: Proposed
- Priority: P2
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A

## Problem

AI Workflow's test suite is strong on behavior and contracts, but there is no explicit policy category for the failure mode where a user-facing message _names a command_ and that command is wrong, incomplete, or does not resolve the situation. A test can verify a message is emitted with exact text — all green — while the command it names has never been executed by anyone. That is a dead end shipped with green coverage.

## Source concept (RDD)

The founding anecdote of Gentle-AI's audit story:

> There was a message telling you "to get out of this, run this command". There were tests. They verified the message was emitted, with its exact text. All green. **Nobody had ever run the command the message named.** When I ran it, it did not work. I had been sending people into a dead end, with green test coverage, for months.

From this, the governing rule: a message may name a command only if running that command resolves the block. Related lessons from the same document that this policy should encode:

- "A guard nobody calls is not a guard" — a correct, well-documented check wired to nothing reads like coverage and is more dangerous than missing code.
- Guide steps written without running them failed three times when testers followed them; the rule that came out: _before naming a continuation, execute it_.
- A changelog overclaiming a fix ("fixed the tool so it stopped _printing_ the broken form, not the parser so it would accept it") cost a user real time.

References:

- Gentle-AI `docs/architecture/the-organic-rdd-story.md` — "The audits: the ones that did not" and "The mistakes I made"

## Proposal

1. **Policy** (added to `docs/quality.md`, "Completion validation"): every user-facing message, gate output, skill instruction, or generated prompt that names an `aiw` command must be covered by a test that **executes that command** in the state the message describes and asserts it resolves or advances that state. Emission assertions alone are insufficient for messages that name commands.
2. **Extraction helper**: a small test utility that scans emitted messages (and optionally generated skill artifacts) for `aiw ...` invocations and executes them against fixture repositories, so coverage is systematic rather than hand-picked. Feeds naturally from OPP-004's `next_command`/reason-code contract.
3. **Guidance for generated artifacts**: the same rule applies to skills and rules rendered through adapters — if a generated skill tells the agent to run a command, a test executes that rendered command in a fixture. (The generated `ai-init` skill is the highest-value first target.)
4. **Changelog/review discipline** (soft rule, docs-only): a fix is described as fixing the _parser_, not the _printing_ — i.e., the claim is bound to the behavior tested, not the symptom observed.

## Affected areas

- `docs/quality.md` (new policy section)
- New test helper + fixtures (pattern: `src/fixtures/`, existing e2e tests for install/init/migration)
- Existing message-emitting modules get incremental coverage as they are touched (no big-bang retrofit required)
- Enforces OPP-004; the two share the reason-code/`next_command` contract

## Acceptance criteria

- Given a user-facing output that names an `aiw` command, when the policy applies, then a test executes that command in the described state and asserts progress (resolve or advance).
- Given the extraction helper, when run over CLI outputs in fixtures, then every discovered `aiw` invocation either has executing coverage or is an allowlisted non-actionable mention.
- Given the generated `ai-init` skill for each adapter, when rendered in tests, then every `aiw` command it instructs has been executed at least once in the e2e suite.
- Given `docs/quality.md`, when a reviewer applies completion validation, then emission-only tests are explicitly insufficient for command-naming messages.

## Non-goals

- No retroactive mandate to fix every existing message in one pass: the policy applies to new and touched code (ratchet).
- No enforcement inside the product at runtime — this is a development-time test policy, not a CLI feature.

## Open questions

- Allowlist format for legitimate _informational_ command mentions (e.g., docs examples that are not continuations)?
- Should the extraction helper live as a vitest utility or a `scripts/` check runnable in CI independent of unit tests?
