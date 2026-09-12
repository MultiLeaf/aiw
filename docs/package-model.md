# Package and Resource Model

An AI Workflow package is a versioned collection of capabilities.

```text
package/
├── package.yaml
├── skills/
├── rules/
├── agents/
├── hooks/
├── templates/
├── policies/
└── adapters/
```

## Resource types

- **Skill**: procedural knowledge for an agent.
- **Rule**: constraint or project policy.
- **Agent**: specialized role with inputs and outputs.
- **Hook**: lifecycle-triggered action.
- **Template**: structure for a project artifact.
- **Policy**: permissions, quality gates, or governance.
- **Adapter**: target-specific rendering metadata.

Packages may come from local paths, Git repositories, npm-compatible providers, Vercel Skills, or a future Multileaf registry.

Local directories and Git repositories are resolved with `aiw resolve --source=<source>`. A local source may be a package directory or its `package.yaml`; relative paths are resolved from the project. Git sources support `git+https`, HTTPS, SSH, and `file://` URLs. Git packages are cloned into an isolated temporary checkout, validated before the lockfile is changed, and removed after resolution. The lockfile records the selected provider and normalized source rather than trusting those fields from the fetched manifest. The legacy `--package=<path>` form remains available for direct manifest resolution.

Vercel Skills is exposed through `aiw skills search`, `inspect`, `install`, `check`, and `update`. AIW delegates to the official `npx skills` CLI with argument arrays, requires explicit `network:external` permission for network-mutating/check operations, and records installed skills and upstream integrity in `.aiw/lock.yml`. Update output is inspected for upstream failure text because some CLI releases may report failures with a successful process exit code.

Use `aiw audit-package --package=<path>` before resolution or installation to review requested permissions and their risk levels. Every permission must belong to AIW's known permission catalog, and every requested permission requires an exact `--allow=<permission>` approval. Unknown permissions are rejected even when passed through `--allow`; denied audits and approvals must not modify package state.

Organizations can install a versioned policy with `aiw organization-policy --file=<path>`. The policy defines approved provider/source patterns and denied permissions. A trailing `*` performs an explicit prefix match; all other entries require an exact match. Once configured, AIW validates the provider and source before loading a package, so unapproved Git sources are rejected before a clone or temporary checkout is created. HTTP(S), SSH, and Git-protocol sources require both organization approval and explicit `--allow=network:external` before the loader is called; local paths and `file://` sources do not require network approval. After loading an approved remote manifest, AIW validates every declared package permission before changing project state or the lockfile. Temporary checkouts created for approved Git sources are removed when manifest validation or permission validation fails. Replacing an existing policy requires the explicit `--replace` flag.

Repositories enforce the tracked policy in CI with `aiw policy-check --package=<path>`. The gate validates declared package permissions, every package source in the lockfile, and configured private registries. It fails when the organization policy is missing, malformed, or violated and is intended to run on pushes and pull requests after the normal quality pipeline.

Teams can commit a portable preset with package requirements and named registry references, then install it with `aiw preset --file=<path>`. AIW writes a deterministic copy to `.aiw/team-preset.yml`; replacing it requires `--replace`. Presets contain no credentials.

Private registries are configured with `aiw registry configure --file=<path>`. Each HTTPS registry entry stores a name, URL, and environment-variable reference such as `AIW_ENGINEERING_TOKEN`; inline secrets, URL credentials, query strings, and fragments are rejected. The complete document is validated before an atomic replacement, so malformed entries cannot apply a valid subset or overwrite the previous configuration. `aiw registry --private=<name> --search=<query>` reads the credential only at execution time, applies organization source and `network:external` policy before the request, validates the response and known permissions, and never serializes the token. Registry configuration is stored in `.aiw/registries.yml` and requires `--replace` for updates.

Every package must declare a non-empty identifier, package version, provider, source, resources, dependencies, permissions, and provenance source. All five resource sections must be present; unused sections use `[]`. Each resource has its own non-empty identifier, version, and normalized relative path. The YAML document is parsed with duplicate-key and unknown-field rejection, and malformed entries fail as a whole.

The project manifest stores requested version ranges. The lockfile stores the exact resolved version, provider, source, integrity information, requested permissions, and resource versions used by the project. For local and Git packages, `integrity` is `sha256-` followed by 64 lowercase hexadecimal digits. AIW hashes the exact `package.yaml` bytes and every declared resource file, ordered by normalized relative path. The hash input starts with `aiw-package-snapshot-v1\0`; each entry is framed by a four-byte big-endian UTF-8 path length, the path bytes, an eight-byte big-endian content length, and the exact file bytes. This detects content changes even when package identifiers and versions stay the same. It is an integrity digest, not a signature and does not prove who authored a package. Other providers may record their upstream integrity format. Resolve merges one package by id and preserves other valid entries. The CI policy gate parses every lock entry strictly and evaluates it independently from package manifests, including entries with matching identifiers. Updates compare the requested range with the resolved lockfile version and never rely on a filename or list position.

```yaml
packages:
  - id: multileaf/sdd-core
    requested: ^1.2.0
    provider: vercel-skills
    source: vercel-labs/agent-skills
```
