# Security and Trust

AI Workflow can install instructions and execute hooks, so packages are supply-chain inputs.

## Controls

- Validate manifests before installation.
- Pin resolved versions in `lock.yaml`.
- Record source and checksums where available.
- Declare filesystem, shell, network, and secret permissions.
- Require confirmation for privileged hooks.
- Exclude secret files and ignored paths from scans.
- Provide `--dry-run`, audit output, and rollback.
- Run dependency and code security scans in CI.
- Enforce the tracked organization policy on every push and pull request with `npm run policy:check`.
- Keep telemetry disabled by default and exclude arguments, paths, content, output, errors, credentials, and identifiers from its event contract.

Packages with critical or high vulnerabilities, malicious provenance, archival status, or stale maintenance should be rejected or require an explicit documented override.
