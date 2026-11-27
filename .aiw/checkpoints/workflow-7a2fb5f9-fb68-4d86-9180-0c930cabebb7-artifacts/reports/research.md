# Research: Brechas del flujo de ai-workflow para llegar de idea a un PR listo para merge

## Question

¿Qué brechas tiene el flujo actual de ai-workflow (artefactos, etapas y comandos) para llevar una idea desde brainstorm/research hasta un PR listo para merge (CI pasado, comentarios de review resueltos, sin conflictos), y dónde encajarían ADRs, PRD y matrices de pruebas QA?

## Sources

- src/human-approval.ts:77-88 (STAGE_DEFINITIONS) — consulta 2026-11-27
- src/workflow.ts:3212-3232 (comando `aiw adr`), 1185+ (orchestrate integrate / merge forecast)
- resources/templates/ (listado completo: decision-record.md, test-plan.md, specification.md, …) — consulta 2026-11-27
- src/quality-gates.ts:54-113 (gates por etapa: specification, verification, review)
- src/adapter.ts:71 (guía de adaptadores: ADRs en technical-design)
- Grep de `gh pr|pull request|PR create` en src/ y resources/ → sin resultados — consulta 2026-11-27
- src/orchestration.ts:104-120 (branches, currentBranch, forecast de merge)
- Claude Ship article (claude.dev/blog/the-work-after-you-open-a-pr/) — consultado 2026-11-27 en la sesión anterior (patrones de destino: PR watch, checks, resolución de comentarios, criterios de merge)

## Findings

- El comando `aiw adr` ya existe y escribe ADRs en `.context/adrs/ADR-<id>-<slug>.md` con Context/Alternatives/Decision/Rationale/Consequences — state: fact — source: src/workflow.ts:3212-3232 — confidence: high
- Existe template `resources/templates/decision-record.md` y la guía del adaptador pide "record consequential choices as ADRs" durante technical-design — state: fact — source: src/adapter.ts:71, resources/templates/ — confidence: high
- Ninguna gate exige ni referencia ADRs: el gate de technical-design (Context/Proposed Design/Alternatives/Interfaces/Risks/Validation) no verifica que existan ADRs vinculados — state: fact — source: src/quality-gates.ts + grep sin resultados en gates — confidence: high
- No existe un artefacto PRD: el rol de requisitos lo cubre la etapa `specification` (REQ-### + acceptance criteria); no hay template/etapa de PRD de producto — state: fact — source: src/quality-gates.ts:54, resources/templates/ (sin prd.md) — confidence: high
- Existe template `resources/templates/test-plan.md` con secciones Behavioral/Integration/Failure Cases — base natural para una matriz de pruebas QA — pero no está conectada a ninguna etapa, gate ni skill (grep vacío en quality-gates.ts y skills) — state: fact — source: resources/templates/test-plan.md + grep — confidence: high
- No existe ningún comando de creación de PR: grep de `gh pr|pull request|pr create` en src/ y resources/ no devuelve resultados; el flujo termina en `traceability` + `workflow complete` (reporte de uso/costo, no de PR) — state: fact — source: grep 2026-11-27; src/completion-report.ts — confidence: high
- La primitiva más cercana a "sin conflictos" ya existe: `aiw orchestrate integrate` produce un forecast de merge por rama (clean/conflicts) — state: fact — source: src/workflow.ts (rama integrate), src/orchestration.ts:104-120 — confidence: high
- No hay integración con estado de CI: el único CI es el propio del repo (.github/workflows/ci.yml, verificado por src/ci.test.ts); ninguna etapa observa checks externos — state: fact — source: src/ci.test.ts:6-9, grep sin `gh run` — confidence: high
- El patrón de destino (watch de PR: checks fallidos, conflictos, comentarios, merge-ready) está descrito por el artículo de Claude Ship; sus equivalentes mapean a etapas nuevas: `pr` (crear), observación de CI, ciclo de comentarios de review, re-chequeo de conflictos — state: hypothesis — basis: análisis del artículo (sesión anterior) + brechas confirmadas arriba — confidence: medium
- Un PRD como artefacto previo encajaría como etapa opcional `product-requirements` entre brainstorm y specification (o como template + gate ligero reutilizando el modelo REQ), y la matriz QA encajaría en verification reutilizando test-plan.md como template exigible por gate — state: hypothesis — basis: estructura de STAGE_DEFINITIONS opcional/required (src/human-approval.ts:77-88) + templates existentes — confidence: medium

## Budget

steps used: 8 / cap 10 · stop reason: confirmed (cada brecha confirmada por ≥2 fuentes: código + templates/guías + grep negativo)

## Open questions

- ¿PR creado por CLI (`aiw pr create` vía `gh` como subproceso host-side, con permisos de red) o solo guidance en skills/adapter dejando la ejecución al host? Depende de la postura de trust boundaries (docs/trust-boundaries.md) — siguiente fuente: decisión de diseño.
- ¿Debe el estado de CI observarse (polling de `gh run`) o solo registrarse como evidencia manual/`aiw pr status`? — siguiente fuente: análisis de Claude Ship (watch local vs. Claude Approvals cloud).
- ¿PRD como etapa nueva vs. extensión del template de specification (sección "User/Outcome" ya existe en brainstorm)? — siguiente fuente: brainstorm con stakeholders.
- ¿La matriz QA reemplaza o complementa el reporte de verification actual (Requirements Checked/Checks Passed/…)? — siguiente fuente: especificación.
