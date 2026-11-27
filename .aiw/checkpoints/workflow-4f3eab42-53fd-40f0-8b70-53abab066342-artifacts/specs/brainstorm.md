# Brainstorm: Improve ai-workflow using post-PR automation patterns

- Workflow ID: 4f3eab42-53fd-40f0-8b70-53abab066342
- Version: 1 (draft)
- Date: 2026-11-27
- Input source: Analysis of "The work after you open a PR" (claude.dev blog, Claude Ship: Code Review, PR Steward, Claude Approvals)

## Goal

Identify which patterns from the Claude Ship article transfer to ai-workflow, and turn the highest-value ones into concrete workflow/skill improvements so agent-driven spec work becomes more bounded, calibratable, and trustworthy.

## Facts

- The article describes three agents: Code Review (GA), PR Steward (beta), Claude Approvals (beta).
- Claude Approvals supports an "observe mode" that logs decisions it *would* make before enforcement; teams are told to monitor it for one to two weeks and compare with reviewer behavior.
- PR Steward caps itself at 3 pushes per issue, then escalates to the author, on the reasoning that repeated failure of the same check means the approach is wrong.
- PR Steward auto-fixes small items and elevates big ones (redesign, security, scope changes) to humans.
- Rule/policy files live in the repo, are code-reviewed, and "strictest rule wins" on conflict; some paths always require a human with no override.
- Agents never commit rule files or secret-looking files; commits of those must be manual.
- The article is explicit about trust boundaries: watches run commands under the user's credentials, text-parsing agents can be fooled by comments, and agent commits bypass git hooks (so checks must live in CI/branch rules).
- The article advocates persisting repeated instructions/patterns into repo rule files and skills instead of re-typing them.
- ai-workflow currently has: stage gates with human approval, checkpoints, skills (including brainstorming, verification, review judges/refuter), legacy + workflow-scoped artifact paths, and no observe mode, retry budget, or rule-conflict semantics.

## Hypotheses

- An observe/dry-run mode for aiw gates (log the decision a gate would make, without blocking) would let teams calibrate gate strictness and reduce false-positive gate rejections.
- A bounded retry budget on gate-driven revision loops (e.g., after N rejections, escalate to a named human with a summary of attempts) would prevent agents silently looping on failing artifacts.
- Persisting recurring rejection reasons as candidate rules/skills (a feedback loop from checkpoints to skill/rule authoring) would compound value across workflows.
- Classifying gate findings as auto-fixable vs. judgment-required would reduce human toil on mechanical feedback.
- Explicit trust-boundary documentation per workflow (what text is untrusted, whose credentials run checks, who is responsible for agent-produced changes) would improve ai-workflow's security posture.
- "Strictest rule wins" conflict semantics and never-overridable path rules would make future ai-workflow policy files safe to automate.

## Decisions

- None yet; this artifact is the first draft for human review.

## Open Questions

- Which of the hypotheses should be in scope: observe mode, retry budgets, rule persistence, finding triage, trust boundaries, policy semantics — or all?
- Should observe mode apply to all stages or only quality-gated ones (specification, verification, review)?
- What is the right retry budget (the article uses 3) and where is it enforced: CLI, skill, or gate?
- Do policy/rules currently exist in ai-workflow in a form where "strictest wins" semantics are needed, or is that a later-stage concern?
- Should rejection-reason persistence target skills (skill-authoring loop) or a separate rules file?

## Users

- Developers and tech leads using ai-workflow to run spec-driven development with AI agents.
- Teams adopting ai-workflow who want to calibrate automation before enforcing gates.

## Desired Outcomes

- Gates and agent loops that are bounded, observable, and calibratable.
- Less repeated manual feedback; recurring guidance becomes persistent rules/skills.
- Clear, documented trust and responsibility boundaries for agent-produced changes.

## Constraints

- ai-workflow is portable across agent targets (codex, claude, cursor); changes must stay target-neutral.
- Existing gate/approval flow and artifact layout must keep working (legacy fallback path exists).
- Keep human approval mandatory for stage progression (the article's "human owns the decision" principle).

## Risks

- Observe mode adds CLI complexity and may be skipped in practice without monitoring guidance.
- Retry budgets could mask a genuinely wrong approach if escalation summaries are weak.
- Persisting rules automatically could let unvetted guidance become policy; rules must go through review like code.
- Over-automating mechanical fixes may reduce human awareness of changes landing in the repo.

## Non-Goals

- Implementing GitHub-native automation (PR watching, branch protection, approvals on GitHub) — ai-workflow is repo/workflow-level, not a hosted bot.
- Weakening or removing the human approval requirement for any stage.

## Scope Candidates (for requirements, if approved)

1. Gate observe/dry-run mode with logged would-be decisions.
2. Bounded retry + escalation on gate rejection loops.
3. Rejection-reason → rule/skill persistence loop (checkpoints feedback).
4. Finding triage classification (auto-fixable vs. judgment-required) in review/verification skills.
5. Trust-boundary documentation for the workflow (untrusted text, credentials, responsibility of caller).
6. Policy conflict semantics: strictest-rule-wins and never-overridable rules.
