# Technical Debt

Durable backlog of intentional, tracked compromises — not a general TODO list. An item belongs here when it was a deliberate tradeoff made to avoid broader scope inside a specific stage, with an explicit condition for when it should be revisited.

---

## Retire jugador.nombre compatibility field

**Origin:** Stage 3B / Decision 114 (`docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md`)

**Current state:**
`jugador.nombre` is persisted temporarily as a derived display/compatibility projection, regenerated from the structured name fields whenever Stage 3B Add/Edit mutates any of them. It is not itself authoritative.

**Canonical authority:**
`nombrePila` + `apellido1` + `apellido2`

**Target:**
Migrate all direct `jugador.nombre` display consumers to one shared name-display helper, sourced from the structured fields.

**Completion conditions:**
- Identify and migrate every consumer.
- Verify generated/display names remain correct.
- Add regression coverage where appropriate.
- Safely stop persisting `jugador.nombre`.
- Perform any required data migration.
- Remove the legacy field only after no consumers depend on it.

**Scope guard:**
Do not perform this refactor during Stage 3B unless a genuine defect forces reconsideration.

---

## Category-rule settings recorded but not yet enforced; scoring-console shirt-name alias

**Origin:** REPORT_175 (category rules), REPORT_179–182 (organizer flow).

**Current state:**
- The shot-clock and midcourt settings of each category (`relojTiro`, `medioCampo`) are stored with the pinned rules but nothing counts down; only the duration and the team-foul scope are applied.
- The scoring console does not display the shirt-name alias.

**Target:** implement the additional countdowns and the alias display as separate, specified work.

**Scope guard:** not part of the current release. The shirt-name alias fix is reserved for a separate task. Other deferred items (media and logos, advertising, continuous organizer TV link, league-wide player statistics, pending schedule work) are tracked in `backend/README.md`, "Updating between games, schema 7 and rollback".
