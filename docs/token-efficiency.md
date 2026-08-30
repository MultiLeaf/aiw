# Token Efficiency

Token efficiency is a runtime concern, not only a prompt-writing concern.

## Strategies

- Store facts, decisions, and conversation summaries separately.
- Load context by task and dependency rather than sending the whole repository.
- Use stable identifiers for requirements and decisions.
- Send deltas after the first context load.
- Cache project profiles and generated summaries.
- Track context freshness and invalidate stale summaries.
- Apply budgets by workflow stage.
- Measure tokens per agent, package, task, and verification cycle.

The runtime should prefer references such as `AUTH-REQ-04` and retrieve their content only when needed.
