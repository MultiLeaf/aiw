# Release Backlog

## Version 0.1.0

- [x] **REL-001** Prepare a reproducible release candidate. _Acceptance:_ metadata, changelog, package allowlist, clean compilation, automated release checks, exact-tarball smoke tests, and provenance-ready CI are present and validated.
- [x] **REL-002** Approve the public package license and configure secure npm publishing for `MultiLeaf/aiw`. _Acceptance:_ MIT is approved, the granular bootstrap token is stored only as an environment secret, and the protected GitHub `npm` environment requires review, rejects administrative bypass, and accepts only version tags.
- [ ] **REL-003** Publish and verify version `0.1.0`. _Acceptance:_ the signed Git tag, GitHub release, npm package, provenance statement, clean `npx` installation, and post-publication smoke tests all agree on the immutable version.
