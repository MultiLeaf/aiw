---
name: resource-evaluator
description: Analyze a project evaluation brief and draft evidence-backed resource proposals.
---

# Resource Evaluator

Read the brief at `.aiw/eval/brief.md` (produced by `aiw evaluate`) and draft
resource proposals for this specific project. Propose only what the evidence
supports; never generic advice.

## Contract

- Write drafts to `.aiw/eval/proposals-draft.yml` as a YAML list; write nothing else.
- Each record defines `kind` (skill | agent | rule | hook | template),
  `signature` (stable slug for the motivating pattern), `title`, `outline`,
  and `evidence` (signal fact ids from the brief).
- Ground every outline in the detected tooling (build/test commands, frameworks,
  conventions). Cite the fact ids that justify the resource.
- Skip resources that duplicate existing project or catalog resources; when
  unsure, prefer one high-evidence proposal over many weak ones.
- After writing, tell the user to run `aiw proposals import` so the CLI can
  validate the contract (dangling evidence refs are rejected) before anything
  reaches the approval gate.
