---
name: technical-design
description: Design modular technical solutions from approved requirements.
---

# Technical Design

For every approval, rejection, or optional skip, use the host's native blocking question widget, not a prose-only prompt when the widget is available. Leave choices unselected and offer “Approve and continue”, “Request changes”, and “Reject/stop”; for a skip, offer “Accept skip” or “Do not skip”. Wait for an actual submission before running `aiw approve`, `aiw reject`, or `aiw skip` or proceeding. Collect revision/skip reasons in a follow-up free-text widget. If the host has no blocking widget, use a numbered chat prompt and end the turn until an explicit reply arrives. The CLI records the decision but cannot verify that a widget was used.

Map requirements to components, interfaces, data flows, and validation strategy. Compare meaningful alternatives and record decisions with rationale, risks, and consequences. Prefer small cohesive modules, explicit contracts, dependency inversion, and reversible changes.

Write the reviewable design to `.aiw/generated/reports/technical-design.md` using the technical-design template. Link each design and ADR to affected requirements. Run `aiw gate technical-design`, present the exact design and decisions to the human, and ask for explicit approval. Stop and wait; do not create an implementation plan until approval arrives. Only after approval, record it with `aiw approve technical-design`. If changes are requested, first record `aiw reject technical-design --reason=<feedback>`, then revise the design/ADRs, rerun the gate, and ask again. If no technical design is needed, obtain explicit human acceptance and record `aiw skip technical-design --reason=<accepted reason>`. Use `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global CLI is available.
