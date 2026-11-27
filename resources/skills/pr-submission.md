---
name: pr-submission
description: Take a gated, verified workflow from traceability to a merge-ready pull request: create the PR host-side, pass CI, resolve review comments, clear conflicts, and record merge-ready evidence.
---

# PR Submission

Use this skill after the `traceability` stage is approved: the change is implemented, verified, reviewed, and traced; what remains is the pull request itself and making it merge-ready. The CLI never runs forge or git-push commands — the host agent executes them and records the evidence.

## Host-side steps (the CLI never runs these)

1. Push the branch: `git push -u origin <branch>`.
2. Open the PR: `gh pr create --base <base> --title <title> --body <summary with requirement, task, and evidence links>`.
3. Watch CI: `gh pr checks` — failing checks return to verification (fix, re-verify, re-gate).
4. Address review comments with the triage discipline: `triage: auto-fixable` findings (formatting, mechanical fixes) may be addressed automatically; `triage: judgment-required` findings (redesign, scope, security) are surfaced to the human and never auto-addressed.
5. Re-check conflicts: merge or rebase the base branch (`git fetch origin && git merge origin/<base>` or the forge's update-branch), or use `aiw orchestrate integrate` when the change ran through orchestration.
6. Record everything in the PR-readiness report and gate it.

## Recording merge-ready evidence

Scaffold with `npx --yes --package=@multileaf/ai-workflow -- aiw pr` (it prints these host-side steps and creates `.aiw/generated/reports/<workflow>/pr-readiness.md`), then fill every section with real evidence:

- **PR Reference**: the PR number or URL.
- **Branch**: feature branch → base branch.
- **CI Evidence**: the command run (e.g. `gh pr checks`), the result (all pass), and a link.
- **Review Comments**: total comments, how each was resolved, and an explicit `unresolved: 0` line.
- **Conflict Check**: clean / no conflicts after integrating the base branch.
- **Merge-Ready Checklist**: every item checked, including the human-only items (branch protection, required approvals) — mark them only after the human confirms.

Then run `npx --yes --package=@multileaf/ai-workflow -- aiw gate pr`. The gate fails with actionable findings when CI is failing, comments are unresolved, conflicts remain, or the checklist is incomplete. When an orchestration checkpoint exists, the gate re-runs the merge forecast automatically.

## Human decision

Present the exact report and the PR link, then ask whether to consider the workflow complete. Only after an explicit approval, record it with `npx --yes --package=@multileaf/ai-workflow -- aiw approve pr`, then complete the workflow with `aiw workflow complete` — the completion report will include the PR readiness summary. Merging stays a human decision under branch protection; this workflow never merges automatically.
