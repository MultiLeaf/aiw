---
name: project-init
description: Inspect a repository, build a project profile, and prepare AI Workflow configuration.
---

# Project Initialization

Use the host's native blocking question widget for uncertain project facts and setup decisions when available. Leave choices unselected; offer to confirm the evidence, correct it, or leave it unresolved. Do not make an uncertain inference project policy until the widget is explicitly submitted. If the host has no blocking widget, ask one numbered question in chat and wait for an explicit response before proceeding.

Inspect structure and configuration safely. Detect languages, frameworks, package managers, scripts, tests, quality tools, CI, and conventions. Record evidence and confidence in `.aiw/profile.yml`. Ask for confirmation before treating uncertain inferences as facts. Recommend capabilities with rationale, permissions, and conflicts.
