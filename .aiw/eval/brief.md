# Resource Evaluator Brief

Analyze the signals below and draft resource proposals for this project.
Write each proposal as a YAML record in `.aiw/eval/proposals-draft.yml`.

## Signals

| id | key | value | evidence |
| --- | --- | --- | --- |
| fact-001 | build.system | node-npm | package.json |
| fact-002 | test.command | npm test | package.json |
| fact-003 | ci.provider | github-actions | .github/workflows |

## Limitations

- git-history-unavailable

## Instructions

1. Propose only resources this project needs; cite the fact ids above as `evidence`.
2. Every proposal record must define: `kind`, `signature`, `title`, `outline`, `evidence`.
3. Allowed kinds: skill | agent | rule | hook | template.
4. `evidence` entries must reference existing signal fact ids (for example `fact-001`);
   proposals citing unknown ids are rejected by `aiw proposals import`.
5. `outline` sketches the resource content grounded in the detected tooling —
   never generic advice.
6. Do not create or modify any other file; drafting is the only allowed write.

Example record:

```yaml
- kind: rule
  signature: gradle-test-before-done
  title: "Run Gradle tests before completing"
  outline: "Rule requiring ./gradlew test before any task completion, with the detected wrapper."
  evidence: [fact-001, fact-002]
```
