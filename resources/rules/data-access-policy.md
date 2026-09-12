# Data Access Policy

- Follow the repository's existing data-access and transaction boundaries.
- Scope commands and tests to the workspace that owns the database schema or query.
- Review migration contents before applying them; never run destructive database commands without explicit approval.
- Keep credentials in the project's approved secret store or environment, never in source, logs, or generated AI instructions.
- Validate data-access changes with relevant tests and report any migration or compatibility impact.
