# Code Review

## Scope

RES-001 diff: `resources/skills/research.md` (new), `resources/package.yaml`, `src/recommendations.ts`, `src/recommendations.test.ts`, `src/opp011-evals.test.ts`, `README.md`, `docs/backlog.md`.

## Findings

None blocking. Advisory notes:
1. The skill's budget numbers (~10 steps / 3 turns) are contract text, not enforced runtime — acceptable for a packaged skill; the verification report already flags a future behavioral eval scenario.
2. The recommendation matches on the same project-signals predicate as other workflow capabilities rather than error/log-specific signals — deliberate: question-shaped need is not deterministically detectable, so universal advisory with manual selection keeps it proportional and avoids false precision.

## Checks

- Skill follows the established packaged-skill pattern (frontmatter, English, sections); policy-check and adapter contract pass.
- Emission commands in the skill (`task start --no-ticket --lane=light`, `task evidence`) exist and are covered by existing emission-usability tests.
- No CLI, settings, or network changes; AIW remains deterministic and offline.
- Redaction and provenance rules mirror the interpreter guardrails' posture.

## Residual Risks

None beyond the advisory notes.

## Decision

Accept.
