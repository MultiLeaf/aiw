# Release Process

AI Workflow releases are reproducible, evidence-backed, and published only from a clean protected branch.

## Preconditions

- The release version follows Semantic Versioning and matches the intended Git tag.
- `CHANGELOG.md` contains the release date and user-visible changes.
- The package declares an approved license. `UNLICENSED` intentionally blocks public publication.
- The npm account is authenticated and authorized for the `@multileaf` scope.
- `main` is clean, synchronized with `origin/main`, and the complete backlog remains validated.

## Validation

```bash
npm ci
npm run release:check
```

The release check runs formatting, linting, strict type checks, a build, tests, dependency audit, organization policy enforcement, and package-content validation. The package validator rejects internal state, source files, test output, fixtures, or nested tarballs and requires the executable, public declarations, resources, documentation, README, and changelog.

Install the exact candidate tarball in a new temporary project and exercise at least installation, help, doctor, scan, target migration dry-run, and the public SDK exports. Record its SHA-256 digest in the release evidence.

## Publication

After human review of the package contents and legal license, create and push a signed version tag. The release workflow validates the exact tagged source and publishes with npm trusted publishing and provenance:

```bash
git tag -s v0.1.0 -m "AI Workflow v0.1.0"
git push origin v0.1.0
```

Configure `MultiLeaf/aiw` as a trusted publisher for `@multileaf/ai-workflow` before pushing the tag. Publish each tag only once; never reuse, move, or overwrite a published version.
