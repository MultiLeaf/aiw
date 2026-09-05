# Plugin SDK and Package Authoring

AI Workflow plugins use the same neutral package contract as built-in resources. A plugin can contain skills, rules, agents, hooks, and templates while adapters remain responsible for target-specific rendering.

## Create a plugin

```bash
aiw plugin create \
  --directory=plugins/example \
  --id=acme/example \
  --version=1.0.0 \
  --description="Provide an example workflow."

aiw plugin validate --directory=plugins/example
```

Creation writes an English `README.md`, a valid `package.yaml`, and a starter skill. Output is deterministic. Destinations must remain inside the project, invalid definitions are rejected before writes, and existing scaffold files are never overwritten.

Validation checks the package contract and every declared resource path. It does not execute plugin content or grant permissions.

## TypeScript SDK

The package exports `@multileaf/ai-workflow/plugin-sdk` with:

- `definePlugin` for a typed, immutable package definition;
- `createPluginScaffold` for deterministic in-memory authoring;
- `writePluginScaffold` for conflict-safe persistence;
- `validatePluginDirectory` for project-root-confined contract and resource validation;
- `resolvePluginDirectory` for project-confined paths.

The filesystem boundary is injected, so hosts can test authoring without disk access. Package permissions and organization policies are still enforced by the normal installation and resolution workflow.
