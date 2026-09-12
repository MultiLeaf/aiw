---
name: prisma-data-access
description: Change Prisma schemas and data access safely within the repository's database conventions.
---

# Prisma Data Access

Read the active Prisma schema, client setup, existing migrations, and callers before changing data access. Preserve naming, relation, transaction, and repository patterns already used by the project. Do not apply migrations, reset databases, or run destructive commands without explicit approval. When schema changes are selected, explain migration impact, add or update tests around affected queries, and use the exact Prisma and test commands declared by the relevant workspace. Never copy connection strings or credentials into generated instructions.
