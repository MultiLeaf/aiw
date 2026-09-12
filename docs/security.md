# Security and Trust

AI Workflow can install instructions and execute hooks, so packages are supply-chain inputs.

## Controls

- Validate manifests before installation.
- Pin resolved versions in `lock.yaml`.
- Record source and checksums where available.
- Declare filesystem, shell, network, and secret permissions.
- Require organization source approval and explicit `network:external` consent before loading remote package sources.
- Require confirmation for privileged hooks.
- Exclude secret files and ignored paths from scans.
- Redact credential assignments (including common cloud/provider key names, JSON/YAML and quoted forms), bearer credentials, recognizable provider tokens, and private-key blocks before project context reaches an AI provider. Files that fail reading or UTF-8 decoding are omitted from the request.
- Provide `--dry-run`, audit output, and rollback.
- Run dependency and code security scans in CI.
- Enforce the tracked organization policy on every push and pull request with `npm run policy:check`.
- Keep telemetry disabled by default and exclude arguments, paths, content, output, errors, credentials, and identifiers from its event contract.

Packages with critical or high vulnerabilities, malicious provenance, archival status, or stale maintenance should be rejected or require an explicit documented override.

Context redaction is defense in depth, not a complete secret detector. Sensitive file exclusions remain mandatory, and unusual encodings or unreadable files fail closed by omission.
