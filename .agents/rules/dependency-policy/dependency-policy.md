# Dependency Policy

Evaluate dependency health before adding packages. Commit lockfiles and reject known critical or high vulnerabilities unless risk is explicitly documented.

## Detected project context

- Languages: javascript, typescript
- Test runner: vitest
- Test command: `vitest run`
- Linter: eslint
- Lint command: `eslint .`
- Formatter: prettier
- Format command: `prettier --write "src/**/*.{ts,js}" "docs/**/*.md" "*.{json,js}"`
