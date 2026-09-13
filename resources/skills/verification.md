---
name: verification
description: Verify implementation against requirements and produce traceable evidence.
---

# Verification

Check every acceptance criterion, quality gate, security requirement, and affected adapter. Report passed checks, missing evidence, failures, and residual risks. A task is not complete when required evidence is missing.

Write `.aiw/generated/reports/verification-report.md` using the verification-report template and validate it with `npx --yes --package=@multileaf/ai-workflow -- aiw gate verification`. Present the exact report, checks, missing evidence, and residual risks to the human. Ask for explicit approval to proceed, end the turn, and wait; an automated gate pass is not human acceptance. Only after approval, record it with `aiw approve verification`. Do not start code review or final traceability before that command succeeds. If verification fails or changes are requested, record `aiw reject verification --reason=<feedback>` before editing the report or returning to implementation, then repeat verification, update the report, rerun the gate, and ask again. Use npx package invocation for other `aiw` commands when no global binary exists.
