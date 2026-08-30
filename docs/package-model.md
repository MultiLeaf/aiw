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

Every package must declare an identifier, package version, provider, source, engine compatibility, resources, dependencies, supported targets, permissions, and provenance. Each resource has its own stable identifier, version, and path.

The project manifest stores requested version ranges. The lockfile stores the exact resolved version, provider, source, integrity information, and resource versions used by the project. Updates compare the requested range with the resolved lockfile version and never rely on a filename or list position.

```yaml
packages:
  - id: multileaf/sdd-core
    requested: ^1.2.0
    provider: vercel-skills
    source: vercel-labs/agent-skills
```
