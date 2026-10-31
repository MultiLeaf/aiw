# Quality and Testing

Development follows TDD:

```text
Red → Green → Refactor → Verify
```

## Required checks

- Unit tests for pure functions and domain services.
- Integration tests for filesystem and package workflows.
- Contract tests for every adapter.
- End-to-end tests for install, init, sync, migration, and rollback.
- ESLint for code quality.
- Prettier for formatting.
- TypeScript strict compilation.
- Dependency and code security scans.

No feature is complete without tests for its happy path, invalid input, conflicts, and safe failure behavior.

## Emission is not usability

A test that verifies a message was emitted does not verify it is usable. Any user-facing message, gate output, skill instruction, or generated prompt that names an `aiw` command must be covered by a test that executes that command in the state the message describes and asserts it resolves or advances that state. Emission-only assertions are insufficient for messages that name commands.

`src/command-evidence.ts` extracts command mentions from shipped artifacts; a ratchet test in `src/command-evidence.test.ts` executes every command named by the generated skills and the READMEs and fails when a named command is not real. Blocking continuations follow the stronger rule from [OPP-004](opportunities/OPP-004-exact-continuation-commands.md): a message may name a command only when running that command resolves the block it was printed for — verified by executing the printed continuation.

## Completion validation

A feature is complete only when all affected layers are validated: domain, module integration, CLI or adapter integration, generated artifacts, end-to-end behavior, documentation, traceability, and security. Domain tests alone are insufficient for changes that affect external behavior or generated project state.

Externally visible tasks also require an isolated integration run by an AI subagent in a separate worktree. That run must use the packaged or executable workflow, record its outcomes, and leave the validation worktree clean.

Every launched subagent must be instructed to send a direct Orca orchestration message to the coordinator terminal when it finishes; a mailbox-only notification is insufficient. The message must include its status, validation summary, failures, and worktree cleanliness.

## Self-validation

AI Workflow must use itself to validate changes whenever the current capabilities support the task. Changes affecting installation, scanning, generation, migration, adapters, or project configuration must be executed against this repository and their generated output must be inspected. Unit tests alone are not sufficient for these changes.
