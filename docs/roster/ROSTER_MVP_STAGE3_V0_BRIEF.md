# v0 Brief — Sebel Team → Plantilla (Roster Management)

**Status: Draft for Master Tutor review — do not submit to v0 yet.**

**Source checkpoint:** `616f0da — checkpoint complete roster MVP stage 3 decision discovery`

**Authoritative decision source:** `docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md` (Decisions 1–113, decision discovery complete)

**v0 output is design reference only.** Nothing v0 produces is authoritative Sebel behavior, and generated code is not automatically production code.

---

## Scope

Design/refine **`Team → Plantilla`** only — the roster section of Sebel's existing Team page — and its roster-management interactions (Add, Edit, Deactivate, Reactivate, duplicate-identity resolution). Do **not** design the whole Team page. Do not touch `NuevaLiga`, Home, or any other screen.

This is a **constrained, credit-efficient design exercise, not an open-ended exploration.** Solve every state below coherently in **one response**. Do not ask follow-up questions and do not expand scope beyond what is requested here.

## Authoritative specs

This brief, plus `docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md`, are ground truth over any assumption you would otherwise make. Where you'd normally guess at a rule, a label, or a piece of content, this brief already answers it — do not invent an alternative.

## What this product is

Sebel is a **responsive web application / PWA**, not a marketing website or an admin dashboard. Team → Plantilla is a **sports roster**, not a back-office record list. A visitor and an organizer look at the same roster; the organizer simply gets extra controls layered on top of it. It is used the way an app is used — opened repeatedly, scanned fast, acted on with a thumb.

**Light theme only** — white/off-white canvas, matching Sebel's existing product (a single restrained red accent for emphasis/state, no dark mode, no dark treatment anywhere).

Sebel's existing Team page already renders a "Plantilla" list of compact rows (jersey number, name, secondary stat line) inside its established light, card/list-based visual system — do not replace that visual language with a denser or heavier one. Extend it.

## Direction (mandatory)

- Light theme, one restrained accent color used only for state/emphasis (e.g. an active/live indicator, a primary action) — never as decorative fill.
- Sports-first and app-like — not a SaaS admin dashboard, not a spreadsheet, not a back-office CRUD screen.
- Mobile and desktop are both first-class, genuinely composed for each — not one scaled from the other.
- Efficient vertical use on mobile; deliberate, considered use of width on desktop (not a stretched mobile column, not a dashboard grid).
- Organizer capabilities are layered onto the same sports-first roster experience a visitor sees — never a separate admin UI.
- No gradients-as-texture, no glassmorphism, no stacked drop shadows, no illustration-heavy empty states.

## Required states (all in one coherent response)

### 1. Public active Plantilla

- Full active roster shown at once — **no pagination, no "Ver más," no virtualization.**
- Row hierarchy: player name is primary identity; jersey number is prominent and scannable; existing sport-specific statistics (already shown on Sebel's Team page today) are secondary, compact information beneath/beside the name.
- Player name is conceptually a link to the existing player profile page.
- Ordered by jersey number ascending.
- Do not invent new statistics beyond what a sports roster already shows (points/goals-style per-game info, already-existing pattern).
- Do not turn this into large individual player cards, and do not turn desktop into a column-headered spreadsheet/admin table (`Número | Jugador | PTS | ...`). It must still read as a sports roster/list at every width.

### 2. Authorized organizer active Plantilla

Same sports-first roster as the public view, plus:

- `+ Añadir jugador` associated with the Plantilla section header (not a large card of its own).
- A compact `⋯` action menu at the end of each active row, containing exactly:
  - `Editar jugador`
  - `Desactivar jugador`
- `Ver inactivos`, shown only when the team has at least one inactive ficha (omit entirely otherwise).

Management controls must stay visually secondary to the roster itself — no large permanent buttons on every row.

### 3. Zero-player empty state

Plantilla is still shown (never hidden) when the team has zero active players.

- Heading: **Plantilla**
- Message: `Todavía no hay jugadores en este equipo.`
- Authorized organizer additionally sees: `Añadir primer jugador`
- Public visitor sees the message only, no action.

### 4. Add Player

- **Desktop:** modal. **Mobile:** bottom sheet.
- Fields, in this order, with required/optional clearly distinguished:
  - `Nombre *`
  - `Primer apellido *`
  - `Segundo apellido` (optional)
  - `Número *`
  - `Fecha de nacimiento` (optional)
- Primary action: `Añadir jugador`
- After a successful save, offer `Añadir otro jugador` as a lightweight continuation — design it as opening a **fresh, empty** form, not a prefilled one. Each save is its own independent, already-completed action; do not present this as a multi-step wizard or a batch operation.
- Do not invent additional fields (no email, phone, photo, position, etc.).

### 5. Edit Player

- Reuses the exact same form/visual system as Add Player (desktop modal / mobile bottom sheet), opened prefilled with the player's current values.
- Primary action: `Guardar cambios` (never reuse the `Añadir jugador` label here).
- Not a separate page.

### 6. Duplicate-candidate / identity-resolution state

**This state must be included** — it is part of the same responsive Add/Edit interaction system, not a separate flow.

- Trigger concept: `Encontramos un jugador con el mismo nombre`
- Show one or more candidate cards. Each candidate card may show only: player name, team, jersey number, and age (never exact date of birth).
- Organizer choices: select a specific candidate as the same person, or `Es otra persona`.
- If the selected/matching candidate already has an active ficha on the same team, show instead: `Este jugador ya está en la plantilla de este equipo.` with a path to `Ver / Editar jugador` for that existing entry, rather than a generic error.

**Presentation only.** Do not invent or change: the matching/fuzzy-matching algorithm, what counts as a candidate, any automatic or AI-driven merging, what data is disclosed on a candidate card beyond what's listed above, or who has authority to decide — the organizer is always the one who confirms same-person vs. different-person; nothing in this screen decides it for them.

### 7. Deactivate confirmation

- **Desktop:** confirmation modal. **Mobile:** confirmation bottom sheet.
- Must clearly explain: the player becomes unavailable for future matches for this team; historical matches and statistics remain preserved.
- Actions: `Cancelar` / `Desactivar jugador` (primary).
- Must not visually read as permanent deletion. Never use the label `Eliminar jugador`.

### 8. Inactive roster — `Ver inactivos`

- Stays inside Team → Plantilla as a secondary state, **not** a separate page/route: `Plantilla → Ver inactivos → Volver a Plantilla`.
- Rows are compact and visually subdued compared to active rows — **no strikethrough**, no "deleted" framing.
- Each row shows: player name, last jersey number, `Inactivo`, and an absolute deactivation date (e.g. `Desactivado 20 ago 2026` — never a relative time like "hace 7 días").
- Ordered most-recently-deactivated first.
- Organizer `⋯` menu here contains exactly: `Editar jugador`, `Reactivar jugador`.

### 9. Reactivate confirmation

- **Desktop:** modal. **Mobile:** bottom sheet.
- Shows at minimum: player, team, and the jersey number that will become active.
- Actions: `Cancelar` / `Reactivar jugador` (primary).
- You may design a visual error/conflict state for when that jersey number is already taken by another active player on the team, but do not invent the resolution behavior beyond "the organizer must pick a different, available number" — no automatic renumbering of anyone.

### 10. Feedback and error states

- Lightweight, non-blocking success feedback (e.g. a toast) for: `Jugador añadido`, `Jugador actualizado`, `Jugador desactivado`, `Jugador reactivado`.
- On a form validation/save error: keep the modal/bottom sheet open, preserve everything the organizer already typed, and show the error at/near the relevant field — never force re-entry.
- If the organizer tries to close an Add/Edit form with unsaved changes, show: `Seguir editando` / `Descartar cambios`. (An untouched/empty form may close without this prompt.) Do not design an autosaved-draft concept.

## Information hierarchy

An active row should feel approximately like:

`#10  Miguel Sam Robles`

with the existing compact sport-specific stat line beneath or beside it as clearly secondary information. Exact type/spacing/color choices are yours to explore — the ordering of visual importance (name and number first, stats second, management controls last/least) is not.

## Mobile requirements

- Compact rows, efficient vertical use, no large player cards.
- Bottom sheets for every Add/Edit and lifecycle-confirmation interaction.
- Thumb-friendly tap targets throughout.
- Avoid any dense, admin-table-like presentation.
- Preserve Sebel's existing light, app-like PWA feel.

## Desktop requirements

- Still a sports roster/list, not a spreadsheet or admin table — no prominent column headers like `Número | Jugador | PTS`.
- Modal interactions (not bottom sheets) for Add/Edit and lifecycle confirmations.
- Free to use available width thoughtfully (e.g. a wider single roster column with breathing room, not a cramped narrow column stretched onto a wide canvas).
- During consecutive `Añadir otro jugador` entry, the updated Plantilla may remain visible behind the modal so a newly added player is visible without closing the dialog.

## Explicit prohibitions

Do **not**:

- Redesign the entire Team page, the League page, or `NuevaLiga`.
- Redesign Sebel's statistics model or invent new metrics.
- Invent routes, backend/database behavior, or new data fields.
- Invent or change identity-matching/duplicate-detection logic.
- Design an AI agent, chatbot, or any autonomous identity-decision UI.
- Show or imply automatic merging of people.
- Expose exact date of birth anywhere, for anyone.
- Publicly expose any player's age or date of birth in the public Plantilla view (minor or adult).
- Add roster search or filtering.
- Add pagination, "load more," or virtualization to the active roster.
- Design a hard-delete ("Eliminar jugador") path for any ficha.
- Frame deactivation as, or make it look like, permanent deletion.
- Turn Plantilla into an admin dashboard at any width.
- Change Sebel's light-theme, PWA-first direction.

## AI-first compatibility (context only — not a task)

Do not design an AI agent or chatbot as part of this work. The identity-resolution flow (state 6) is intentionally deterministic and human-confirmed today: candidate shown → organizer confirms → a controlled operation executes. A future AI assistant may eventually participate in *offering* candidates or explanations within that same flow, but designing that assistant is explicitly not part of this brief — just don't design state 6 in a way that would preclude it later (e.g. don't hard-code the confirmation UI as if there could only ever be one candidate).

## Placeholder content

Use realistic Latin American Spanish names consistent with Sebel's own vocabulary — e.g. player names like "Miguel Sam Robles," "José Pérez," "Ana Julia Rodríguez"; team names already established in Sebel's own placeholder style (e.g. "Halcones," "Toros de David"). Do not use English placeholder copy ("Lorem ipsum," "Player One") anywhere visible.

## Deliverables

- Both **desktop and mobile**, genuinely composed for each, covering all ten states above in one coherent response.
- Prioritize, in this order: (1) information hierarchy, (2) responsive behavior, (3) interaction clarity, (4) sports-first visual quality, (5) consistency with Sebel's existing light PWA direction. Backend completeness is not a priority — this is a visual/interaction reference only.

## Final instruction to v0

This is a single, carefully scoped design exercise with limited iteration budget. Produce one polished, coherent, high-fidelity responsive design covering every state listed above — do not ask clarifying questions, do not propose scope beyond Team → Plantilla, and do not leave any of the ten required states unaddressed.
