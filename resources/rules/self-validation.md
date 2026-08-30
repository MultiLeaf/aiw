# Self-Validation Policy

AI Workflow must validate every change against its own repository whenever the current capabilities support the task.

For each change:

1. Run the generated or affected CLI command against this repository.
2. Inspect the generated files and configuration.
3. Run the complete quality gate.
4. Record validation evidence and any limitations.

Unit tests alone are not sufficient when the change affects installation, scanning, generation, migration, adapters, or project configuration.
