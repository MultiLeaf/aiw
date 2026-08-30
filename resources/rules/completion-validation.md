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
