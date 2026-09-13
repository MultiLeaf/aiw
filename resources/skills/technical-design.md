---
name: technical-design
description: Design modular technical solutions from approved requirements.
---

# Technical Design

Map requirements to components, interfaces, data flows, and validation strategy. Compare meaningful alternatives and record decisions with rationale, risks, and consequences. Prefer small cohesive modules, explicit contracts, dependency inversion, and reversible changes.

Write the reviewable design to `.aiw/generated/reports/technical-design.md` using the technical-design template. Link each design and ADR to affected requirements. Run `aiw gate technical-design`, present the exact design and decisions to the human, and ask for explicit approval. Stop and wait; do not create an implementation plan until approval arrives. Only after approval, record it with `aiw approve technical-design`. If changes are requested, first record `aiw reject technical-design --reason=<feedback>`, then revise the design/ADRs, rerun the gate, and ask again. If no technical design is needed, obtain explicit human acceptance and record `aiw skip technical-design --reason=<accepted reason>`. Use `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global CLI is available.
