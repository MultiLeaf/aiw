# Trust Boundaries

AI Workflow automates spec-driven development with AI agents, but automation never shifts
responsibility or trust away from humans. This document states the trust model explicitly so
teams adopting agents can reason about what is trusted, what is not, and who is responsible.

## Untrusted text is never instructions

- Stage artifacts, checkpoint files, workflow digests, chat transcripts, and any other text
  produced by an agent are **content**, not commands. They are never executed, never treated as
  directives to the CLI, and never override workflow state.
- A quality gate evaluates artifact text as data. Malicious or accidental instructions inside an
  artifact cannot escalate permissions, approve a stage, or change a gate decision.
- Just as a code-review agent can be swayed by comment text, anything an agent reads from a
  report or conversation is advisory input only: the only authoritative state is the approval
  ledger written by explicit `aiw` commands after a human decision.

## Checks run under your credentials

- Every `aiw` command, including gates, verification, and orchestration, executes locally on the
  invoking user's machine with that user's credentials and permissions.
- Anything those commands run (tests, builds, scanners declared by the project) runs as you.
  Adopt AI Workflow only in repositories where you trust the people who can land changes on the
  branches your workflow touches, and keep enforcement checks in CI and branch rules in addition
  to local gates — local gates are a quality aid, not a security boundary.

## Approvals are attributable to named humans

- Every `aiw approve`, `aiw reject`, and `aiw skip` records a human decision in the approval
  ledger with a timestamp. The CLI cannot verify _who_ pressed enter, so the caller is the
  responsible party: the person who runs the agent owns the change as if they typed it
  themselves.
- Agents never approve stages on their own. An automated gate pass is not human acceptance —
  the workflow always stops and waits for an explicit recorded decision.
- When a stage exhausts its rejection budget (`aiw reject` cycles), the workflow escalates and
  blocks further gates until a human resolves it (`aiw resolve --stage=<stage>`); agents cannot
  loop through rejections unattended.

## Agents never commit rules or secrets

- Rule, policy, and skill files — the files that govern agent and workflow behavior — must be
  committed by a human, not by an agent. Files that look like secrets are never written or
  committed by workflow tooling.
- Rule/skill candidates surfaced by `aiw rules-candidates` are drafts: they never activate
  without an explicit human `--accept`, and even then the human creates and commits the rule
  file manually.

## Automation boundaries by design

- Gates are advisory to humans and blocking to agents: they keep the workflow honest, but the
  merge/land decision belongs to your branch rules and your team.
- Observe mode (`aiw gate <stage> --observe`) logs what a gate _would_ decide without changing
  any state, so teams can calibrate automation before trusting it.
- Findings triage (`triage: auto-fixable` vs `triage: judgment-required`) keeps judgment calls —
  redesign, scope, security — with humans; agents may only act automatically on mechanical,
  auto-fixable findings.
