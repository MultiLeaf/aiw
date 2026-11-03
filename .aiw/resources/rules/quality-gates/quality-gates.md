# Quality Gates

A change is complete only when formatting, linting, strict type checking, relevant tests, full tests, and security checks pass.

## Detected project context

- Languages: javascript, typescript
- Test runner: vitest
- Test command: `vitest run`
- Linter: eslint
- Lint command: `eslint .`
- Formatter: prettier
- Format command: `prettier --write "src/**/*.{ts,js}" "docs/**/*.md" "*.{json,js}"`
