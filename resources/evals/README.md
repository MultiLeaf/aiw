# Behavioral evaluation scenarios (OPP-016)

Each file in this directory is a **behavioral scenario**: a fixture repository, a
bounded harness command, and deterministic state-outcome expectations. They
double as canonical examples of the workflow's behavioral contract — reading
them tells you exactly what a compliant agent does at the approval boundary,
in the light lane, under escalation, in the bugfix process, and after a
rejection.

They are the behavioral layer on top of the deterministic layers (OPP-011 text
invariants, OPP-006 command ratchet): OPP-011 proves the artifacts _say_ the
right things; replaying these scenarios against real harness CLIs checks that
agents _do_ them.

## Run

```sh
aiw eval run --scenarios                    # all scenarios, harnesses detected on PATH
aiw eval run --scenarios --harness=codex    # one harness only
aiw eval run --scenarios --filter=approval  # one family/id substring
aiw eval run --scenarios --advisory         # report-only: always exit 0
```

Results are written to `.aiw/generated/evals/scenario-results.yml` (schema
`aiw.scenario-results/v1`). A missing harness CLI marks its scenarios
`skipped-harness-unavailable` — never a silent pass. Failed scenarios exit 1
unless `--advisory` is set.

## Budgets

Per scenario: `budget.wallClockS` (wall clock kill → `aborted-timeout`) and
`budget.tokenCeiling` (reported usage above the ceiling → `aborted-budget`).
Pooled nightly budgets live in the target repository's `.aiw/budgets.yml`:

```yaml
evals:
  tokenCeiling: 2000000 # pooled across a run; exhausted → remaining scenarios aborted-pool
```

Token usage is recorded only when the harness reports it (usage sidecar);
absence is never fabricated.

## Statuses

| Status                        | Meaning                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `passed`                      | state outcomes matched on the first attempt              |
| `failed`                      | expectations violated (e.g. agent approved its own work) |
| `skipped-harness-unavailable` | harness CLI not on PATH                                  |
| `flaky-suspect`               | passed on the single retry after a transport failure     |
| `aborted-timeout`             | wall clock killed the harness (retried once)             |
| `aborted-budget`              | per-scenario token ceiling exceeded                      |
| `aborted-pool`                | pooled budget exhausted before the scenario started      |

## Advisory-first ratchet

Scenarios are report-only for two release cycles before any of them becomes a
CI gate (behavioral flakiness must be characterized before it can block). The
approval-boundary family is scheduled to gate first.
