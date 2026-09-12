---
name: verification
description: Verify implementation against requirements and produce traceable evidence.
---

# Verification

Check every acceptance criterion, quality gate, security requirement, and affected adapter. Report passed checks, missing evidence, failures, and residual risks. A task is not complete when required evidence is missing.

Create the verification report and validate it with `npx --yes --package=@multileaf/ai-workflow -- aiw gate verification`. Then hand off to `code-review` when installed; after review, update traceability and completion evidence.
