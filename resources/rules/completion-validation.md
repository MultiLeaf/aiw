# Completion Validation Policy

A task is complete only when every affected layer has been validated.

Required validation levels, when applicable:

1. Domain and unit tests.
2. Module or service integration tests.
3. CLI or adapter integration tests.
4. Generated artifact inspection.
5. End-to-end execution against this repository.
6. Documentation and traceability updates.
7. Formatting, linting, type checking, tests, and security checks.

Passing domain tests alone is not sufficient for a feature that affects the CLI, filesystem, providers, adapters, generated artifacts, or project configuration.

For every externally visible task, run an isolated integration validation with an AI subagent in a separate worktree. The subagent must exercise the packaged or executable workflow, report the commands and outcomes, and confirm that its worktree is clean. The main worktree must not be used as a substitute for this validation.

When launching a subagent, explicitly instruct it to send a direct Orca orchestration message to the coordinator terminal when it finishes; a mailbox-only notification is insufficient. The direct notification must include the final status, validation summary, failures if any, and worktree cleanliness.
