# Roster / Player Management MVP — Implementation Plan

Status: **Planning artifact. Ready for staged execution.** Derived from `docs/roster/ROSTER_MVP_SPEC.md` (the authoritative product specification — read that document first; this plan does not restate its rationale, only sequences its execution) plus fresh repository inspection performed while writing this plan.

This document is written so a future execution agent can work stage by stage, validating between each, without needing this conversation's history. Every stage cites exact current files/lines. Where this investigation surfaced something the spec did not anticipate, it is marked **[PLAN FINDING]** and treated as a repository fact the spec must be read alongside, not a contradiction of the spec's product intent.

---

## 0. Investigation summary (repository facts this plan depends on)

**Database (`src/db.js`):** Dexie database `sebel`, currently at `db.version(6)`. Every prior schema change (versions 1–6) is purely additive — new tables or new indexed fields, never a destructive reshape. `jugadores` is indexed `'id, ligaId, equipoId, codigo, personaId'` (`db.js:41`, since `version(5)`). No `activo`/`estado` field exists on `jugadores` at any version. No `personas` table exists — `personaId` is a bare scalar field on each `jugadores` row, not a foreign key into a canonical person record.

**[PLAN FINDING] — the app's own convention for "schema shape changed" is destructive and must not be used for this work.** `src/seed.js:8-10,144-150,255`: `sembrarSiHaceFalta()` compares a stored `SEMILLA` version constant (currently `12`) against `db.meta.get('semilla')`; on mismatch it runs `db.table(t).clear()` across every table and reseeds from scratch. The comment at `seed.js:8-9` literally instructs: *"Sube SEMILLA cuando cambie la forma de los datos"* (bump SEMILLA when the data shape changes) — i.e., the codebase's own established pattern for a shape change is wipe-and-reseed. **This plan explicitly forbids bumping `SEMILLA` as part of this work.** Schema evolution must go through Dexie's own additive `db.version(n).stores({...})` mechanism only, which does not clear existing data. This is the single most important risk in this plan (see Risk Register) and is called out again in Stage 1 and the Implementation-Agent Boundaries.

**Player creation (current, real):** only three code paths ever write to `db.jugadores` — `src/seed.js:216,472` (seed/demo, sets `personaId` correctly), `src/pantallas/NuevaLiga.jsx:97-108` (the only real interactive path, generates placeholder names, **does not set `personaId`**), and `src/pantallas/Jugador.jsx:39` (only flips `reclamado` on an existing row). No add/edit-player UI exists anywhere today.

**`nombre` compatibility surface (exhaustive, this investigation):** every consumer of `jugador.nombre` as a single display string: `Jugador.jsx` (`:13,15,44,49`), `Consola.jsx` (`:83,88-89,244`), `Liga.jsx` (`:259,281`), `Partido.jsx` (`:373,413,427`), `Inicio.jsx` (`:365,410`), `Equipo.jsx` (`:169`), `Figuras.jsx` (`:72`), `Reto.jsx` (`:113`), `Siguiendo.jsx` (via `jugador-fila` rows, `:156`), and `src/lib/enlaces.js:61` (`urlJugador` builds its slug from `jugador.nombre`). Every one of these expects a full display name in one field. None expect first/last name separately.

**[PLAN FINDING] — `usePartido` is shared between a historical/public consumer and a future-selection consumer; the active/inactive filter must not be applied inside it.** `src/datos.js:129-151`'s `usePartido(codigo)` fetches every player in the match's league (`db.jugadores.where('ligaId').equals(partido.ligaId)`, unfiltered) and is consumed by **both** `Partido.jsx` (the public match page, which must keep showing a since-removed player exactly as they played, per spec §11) **and** `Consola.jsx` (`:55,71`, `const plantel = jugadores.filter(j => j.equipoId === equipo.id)`, the organizer's live-scoring roster picker, which must exclude inactive fichas). Filtering `usePartido` itself to active-only would silently break `Partido.jsx`'s historical rendering. The active-only filter belongs **only** in `Consola.jsx`'s local `plantel` derivation, not upstream in the shared hook.

**Queries that must stay historical/inclusive (never active-only-filtered), confirmed by inspection:** `usePartido` (`datos.js:129-151`), `useJugador` (`datos.js:154-183`, looks up by `codigo`, no active concept needed), `useFiguras` (`datos.js:304-...`, cross-liga leaderboard — a departed player's historical points must still count), `estadisticaJugadores` (`src/lib/marcador-calculo.js:104-128`, used by both `Liga.jsx`'s Jugadores tab and `Equipo.jsx`'s roster), `useOtrasFichas` (`datos.js:387-396`). **Queries that must become active-only:** `Consola.jsx`'s `plantel` (`:71`), and the Team-page "active roster" listing itself (§A of the spec — the organizer manages the *active* roster; inactive fichas are reached via the player's own profile, not the team's active list).

**Navigation to the Team page (confirmed, no new routes needed):** an organizer's path is `/ligas` (`Ligas.jsx`, no team links today) → tap a liga → `/l/:slug` (`Liga.jsx:173`, standings table already links `urlEquipo(f.equipo)`) → `/e/:slug` (`Equipo.jsx`). This already works end to end; Stage 3 adds controls to a page that's already reachable.

**[PLAN FINDING] — there is no "add a team to an existing league" flow, and this plan does not add one.** Teams are only ever created once, inside `NuevaLiga.jsx`'s `publicar()` (`:89-95`). The spec's Stage 2 scope (real team names, zero-player teams) is about that one creation moment, not about later team addition — out of scope here, consistent with the spec, and flagged so it isn't silently assumed to exist.

**Tests:** none exist anywhere in the repository (confirmed by a repo-wide search for `*.test.*`/`*.spec.*` outside `node_modules`, repeated for this plan). No test runner is configured in `package.json` (`scripts`: only `dev`, `build`, `preview`). Automated validation in this plan is therefore scoped to what a future implementer would need to *set up* (framework choice not decided here) alongside manual checks, consistent with the spec's own §22.

---

## Critical architecture questions — answered

**1. Safest compatibility strategy for today's combined `nombre`?**
Introduce two new fields (proposed names: `nombrePila` for first name, `apellido` for last name — exact naming is an implementation detail per spec §8/§20) as the new source of truth, and **keep `jugador.nombre` populated as the composed full name** (`` `${nombrePila} ${apellido}`.trim() ``) at every write. Every one of the nine existing consumers listed above keeps working with **zero changes**, because `nombre` continues to mean exactly what it always meant. This is the smallest-surface option and the one the spec already leans toward (§8's compatibility note); this investigation confirms it by exhaustively listing every reader that would otherwise need to change.

**2. Should persona, ficha, or a combination own first/last/DOB?**
**No `personas` table exists today** — `personaId` is a bare scalar on each ficha, not a foreign key into a person record. Introducing a real `personas` table would be a genuine new entity/store — a bigger structural change than this MVP calls for, and not required by the spec (which only requires `personaId` to be a stable, correctly-shared value, §17.1/§17.7 of the spec). **This plan keeps first name, last name, and DOB on the ficha**, exactly like `nombre`/`dorsal` already are today, and **does not introduce a `personas` table in this plan.**

**Accepted MVP architecture limitation, stated explicitly and without softening (from the Stage 1 architecture review):** Sebel currently has no canonical person record. First name, last name, and DOB are **duplicated per ficha** — if "Pedro Arauz" has three fichas, his DOB is stored three times, independently. **There is no reconciliation mechanism anywhere in Stages 1–7 of this plan.** Correcting a name or DOB on one ficha updates **only that ficha** — it does not propagate to any sibling ficha sharing the same `personaId`, silently or otherwise. The only synchronization point that exists is a one-time copy: when an organizer confirms "Es la misma persona" during matching (§9 of the spec), the *new* ficha's name/DOB fields are pre-filled from the matched candidate at that moment, so the two start in sync — but nothing keeps them in sync afterward, and nothing in this plan attempts to. This is accepted for the MVP because the application never renders "the person" independent of a specific ficha context today (`Jugador.jsx`'s "También jugó" list, `:95-117`, shows each ficha's own stored name per row, not one canonical name), so the missing canonical record does not currently produce a visibly inconsistent "person summary" screen. A canonical `personas` table that eliminates this duplication and enables real reconciliation is the natural next architectural step if the product later needs single-point-of-truth identity editing — explicitly out of scope here, and named in Implementation-Agent Boundaries so it isn't invented mid-implementation.

**3. How will existing seed/demo players without ideal identity data be handled?**
**Corrected from the original draft, per the Stage 1 architecture review: there is no reliable automatic way to split an existing Latin American full name into a first name and a last name.** A last-space split (everything before the final space → first name, last token → last name) is not a safe default for this population — compound paterno+materno surnames ("Sam Robles" as one two-part surname, with "Miguel" as the sole given name) are common, not an edge case, and a last-space heuristic has no way to distinguish that pattern from two given names plus one surname. Given that, Stage 1's migration:
- **Preserves the existing `nombre` value completely unchanged** as the legacy, authoritative display value — nothing about the split touches it.
- Still runs a best-effort last-space split to populate `nombrePila`/`apellido`, but these values are treated strictly as **low-confidence, organizer-reviewable prefill** — shown as already-filled-but-editable fields the first time an organizer opens that player's edit form, never presented or relied upon as settled identity data.
- **A bad split may reduce candidate-matching quality** (a real person might not be suggested as a candidate, or an irrelevant one might be) **but must never cause an automatic identity merge** — Stage 4's "never auto-merge, always explicit organizer confirmation" invariant applies regardless of split quality, so the failure mode of a bad legacy split is degraded match *suggestions*, not `personaId` corruption.
- **No blocking, no data loss, no silent "fixing"** of placeholder names (`"Jugador 1-1"` etc.) beyond this low-confidence prefill — cleaning up placeholder content is left to ordinary organizer editing once Stage 3 ships, not attempted by the migration itself.

**4. How will existing records with missing `personaId` be repaired safely?**
**This one requires a real backfill, not just a lenient runtime check.** Unlike `activo` (below), `personaId` cannot be treated as "any falsy value means the same thing" — if every legacy row with `personaId: undefined` were left as-is, Stage 4's "group candidates by `personaId`" step (spec §9) would incorrectly treat every one of those unrelated placeholder players as *the same person*, because they'd all share the one falsy grouping key. Stage 1's migration must give every row with a missing `personaId` its **own fresh, distinct** generated id — never a shared placeholder value. **Concretely: `uid()` must be called inside the per-row migration callback, once per row that needs it — never computed once outside the loop and reused across multiple legacy rows.** Hoisting the id generation out of the per-row callback is the single highest-consequence implementation mistake available in this stage: it would silently merge every previously-unidentified legacy player into one false shared identity, exactly the failure this backfill exists to prevent.

**5. Exact mechanism preserving old match/stat references when a ficha becomes inactive?**
An `activo` boolean flag on the `jugadores` row, defaulting to active. The ficha row's `id` never changes and is never deleted; `db.eventos` rows keep referencing `jugadorId` exactly as before (`Consola.jsx:82,87`); every historical read path (`Jugador.jsx`, `Partido.jsx`'s `TarjetaEquipo`, `Liga.jsx`'s stats, `Consola.jsx`'s own past-action log at `:244`) is untouched because none of them filter by `activo`. **`activo` does not require a data-backfill migration** — unlike `personaId`, treating a missing/undefined value as "active" (`j.activo !== false`) is semantically correct and safe: every pre-existing row (seed data, anything created before this field existed) should indeed default to active. A real migration is optional polish here, not a correctness requirement.

**6. Which queries must become active-only, and which must intentionally include historical/inactive fichas?**
Answered above in the investigation summary — restated here for visibility: **active-only:** `Consola.jsx`'s `plantel`; the Team page's "active roster" list (new, Stage 3). **Must stay inclusive:** `usePartido`, `useJugador`, `useFiguras`, `estadisticaJugadores`'s callers (`Liga.jsx`, `Equipo.jsx`), `useOtrasFichas`.

**7. How will current routes continue resolving existing players?**
Unaffected. `codigo` (the actual routing/lookup key for `/j/:slug`, `/e/:slug`, etc.) is untouched by every stage of this plan — no stage renames, regenerates, or reassigns any `codigo`.

**8. Does changing the name schema affect slugs/URLs or lookup behavior?**
No. `urlJugador` (`enlaces.js:61`) builds its human-readable slug text from `jugador.nombre` and its actual lookup key from `jugador.codigo`. Because `nombre` remains populated (answer to Q1), `urlJugador` needs zero code changes and produces identical URLs for identical names.

**9. Can Sebel-wide candidate matching be implemented locally, or does it expose an architectural limitation?**
**It exposes a real, important limitation, and this plan states it plainly rather than papering over it.** Sebel today is a fully client-side, per-browser Dexie/IndexedDB database with no backend and no cross-device sync (confirmed across every file inspected in this and prior sessions — `src/db.js`'s own top comment: *"Todo vive en el navegador."*). "Sebel-wide" matching, implemented against the local `db`, is only ever as wide as **that one browser's local data**. Within that scope it works exactly as specified: it will correctly find a match across every league, team, country, and sport whose data happens to live in that same browser (true for one organizer managing several leagues/sports in their own browser, and true for the shared demo/seed dataset). It **cannot** find a match against a different organizer's data on a different device — there is no shared store for it to query. Stage 4 implements the feature correctly and completely *for the current architecture*; this limitation is a property of the whole application, not a shortcut taken by this plan, and is not something this plan proposes to fix (see Q10 and Implementation-Agent Boundaries — no unauthorized backend rewrite).

**10. What would eventually need a backend before Sebel can safely support multiple independent organizers in production?**
Named here as acknowledgment only, not designed: (a) cross-device Sebel-wide candidate matching (Q9); (b) any real profile-claim authentication/account state (spec §16, already out of scope); (c) organizer-approval of a claim reaching the actual owning organizer's device, which today has no notion of "device" beyond the one browser; (d) any true multi-organizer concurrent-write safety — today `cuentaId: 'yo'` is a single hardcoded account (`src/lib/sesion.js:25`), so there is exactly one "organizer" possible per browser profile, and nothing in this plan changes that. None of this is solved or designed here.

---

## Stage 1 — Data compatibility foundation

**Objective:** Land the schema and identity foundation every later stage depends on — separate name fields (with full backward compatibility), guaranteed non-null `personaId`, and the active/inactive ficha concept — without any user-visible behavior change and without any data loss.

**Exact files likely affected:**
- `src/db.js` — new `db.version(7).stores({...})` block.
- `src/seed.js` — the main-loop and `sembrarTorneo` player objects should populate the two new name fields alongside the existing `nombre` (so freshly seeded data is already in the new shape); **no change to `SEMILLA`** (see below).
- New: a small identity-helper module (e.g. `src/lib/identidad.js`) housing `personaId` generation/backfill helpers and the `nombre` composition function, so Stage 3/4 don't duplicate this logic (spec's own stated goal for this stage).

**Data/schema impact:**
- Additive Dexie version bump: `version(6)` → `version(7)`. **The `jugadores` store's index declaration stays exactly:**
  ```js
  jugadores: 'id, ligaId, equipoId, codigo, personaId'
  ```
  **unchanged from `version(6)`.** `nombrePila` (first name), `apellido` (last name), and `activo` (boolean, semantically defaults to active when absent — see Q5) are added as **plain, unindexed object properties** — none of the three needs a b-tree index under this plan's own access pattern: Stage 4's candidate matching is a full-table scan with JS-side normalization (Dexie cannot index a case/accent-folded value), and Stage 3/6's active-only filtering is a client-side `.filter()`, not a `.where('activo')` query. The `version(7)` bump exists solely to attach the `.upgrade()` migration callback below — Dexie only runs an `.upgrade()` as part of a version transition — not because any new field requires indexing. `personaId` already exists as a field/index since `version(5)`; this stage does not change its index, only guarantees every row has a real value.
- **Migration `.upgrade()` step, required:** for every existing `jugadores` row —
  1. If `personaId` is missing, assign a freshly generated, distinct id (never a shared/placeholder value — Q4). **This `uid()` call must happen inside the per-row callback, once per row — never hoisted out of the loop and reused across rows** (see Q4 for why this is the highest-consequence mistake available in this stage).
  2. Best-effort split existing `nombre` into `nombrePila`/`apellido` as low-confidence, organizer-reviewable prefill — `nombre` itself is left completely unchanged (Q3).
  3. Do **not** set `activo` explicitly — safe to leave absent and treat as active everywhere via `!== false` (Q5); no backfill needed for this field, unlike `personaId`.
- **Defensive requirement:** the migration callback must not throw on malformed legacy data. Guard the name-split against `null`/empty/whitespace-only `nombre` (e.g. `(j.nombre || '').trim().split(' ').filter(Boolean)`) — under Dexie's transactional model, one throwing row aborts the *entire* upgrade for *every* user opening that database, not just that row.
- **If the upgrade transaction is rejected** (a thrown error, not a crash — a crash mid-upgrade rolls back atomically at the IndexedDB layer and is safe to retry on its own), **the app's bootstrap sequence (`src/main.jsx`) must surface an explicit error/failure state rather than leave a blank white screen.** This is new, minimal error handling this stage needs to add around the initial `db` access — today `main.jsx`'s bootstrap has no visible handling for a failed database open, and this migration is the first change with a plausible reason to reject.
- **Explicit prohibition, repeated from §0: do not bump `SEMILLA` in `src/seed.js` for this change.** Doing so triggers `sembrarSiHaceFalta()`'s full-table wipe (`seed.js:144-150`), destroying any real data already entered in that browser. This is a hard constraint, not a style preference.

**Behavior changed:** none visible to any user. This stage is purely additive schema plus a data backfill.

**Behavior explicitly preserved:** every existing screen, route, and read path continues to work unchanged, because `nombre` stays populated and no query is filtered by the new fields yet.

**Implementation steps:**
1. Add the identity-helper module: a `personaId` generator (reuse `uid()` from `src/db.js`), a `nombreCompleto(nombrePila, apellido)` composer, and a `activoDe(jugador)` predicate (`j.activo !== false`) — one place, reused by every later stage instead of being reimplemented per screen.
2. Add `db.version(7).stores({...})` to `src/db.js`, following the exact additive pattern of every prior version block, with the migration logic described above in an `.upgrade()` callback.
3. Update `src/seed.js`'s two player-creation sites (`:210-ish` main loop, `:464` tournament call-ups) to also populate `nombrePila`/`apellido` going forward, using real seed name data already available (the seed `NOMBRES` pool) rather than a mechanical split, since seed data is generated fresh, not migrated.
4. Guard the `.upgrade()` callback against malformed legacy rows (null/empty `nombre`), and add explicit error-state handling around the initial `db` open/upgrade call in `src/main.jsx` so a rejected upgrade surfaces a visible failure rather than a blank screen.
5. Verify (manually, per Validation below) that a browser with existing seeded data upgrades cleanly with no visible change.

**Automated validation (to be written, no test infra exists yet — see §0):**
- Unit test for the `nombre`-split prefill heuristic (simple two-word names, three-word names, single-word edge case, empty/null `nombre`) — asserting only that it produces *some* non-throwing prefill value, not that the split is semantically correct, since no automatic split can be relied upon for Latin American names (see Q3).
- Unit test confirming the migration assigns a **distinct** `personaId` to each of several rows that previously shared `undefined` — specifically covering the case where `uid()` is (incorrectly) hoisted outside the per-row loop, to catch that exact regression.
- Unit test confirming a thrown error inside the `.upgrade()` callback does not corrupt any row (transaction rolls back) and is surfaced as a bootstrap error state, not a silent blank screen.

**Manual validation:**
- Open the app against an existing seeded/populated IndexedDB (do not clear storage first) and confirm: Home, Liga, Equipo, Jugador, Partido, Consola, Figuras, Siguiendo all render exactly as before.
- Inspect (via browser DevTools → Application → IndexedDB) a handful of `jugadores` rows before/after upgrade to confirm `personaId` is now always present and distinct, and `nombrePila`/`apellido` are populated.
- Confirm `db.meta`'s `semilla` record's `version` is unchanged (proof `SEMILLA` was not bumped and no reseed occurred).

**Exit criteria:** app is fully usable with zero regressions on existing data; every `jugadores` row (seeded and, if present, previously-placeholder-generated) has a non-null, non-shared `personaId`; no data was cleared.

**Rollback/risk notes:** Dexie version bumps are not trivially reversible once a browser has upgraded (going back to `version(6)` code against an already-upgraded local database is not a supported Dexie pattern). Because this stage is purely additive and non-destructive, the practical rollback is "ship a follow-up fix forward," not "revert the schema." The one truly dangerous mistake this stage could make is bumping `SEMILLA` instead of (or in addition to) the Dexie version — flagged twice above because it is the single highest-consequence error available in this stage.

**Deployment risk — stale PWA tab opening a database another tab already upgraded:** Sebel is a PWA with a service worker (`vite.config.js:9`, `registerType: 'autoUpdate'` via `vite-plugin-pwa`). During rollout, a browser tab still running old, cached `version(6)`-declaring JS could attempt to open a database that a newer tab has already upgraded to `version(7)`. Dexie/IndexedDB refuses to open a database at a version lower than what's already on disk — this fails closed (the stale tab's `db` open rejects; no data is corrupted or touched), but that tab will appear broken until it reloads and picks up the new JS. `autoUpdate` mitigates this by updating the service worker promptly, but does not fully eliminate the window across multiple simultaneously open tabs. This is a standard PWA/Dexie deployment characteristic rather than something specific to this migration's design, and does not require any change to Stage 1's schema/migration approach — noted here as an operational awareness item for rollout, not an architecture gap.

---

## Stage 2 — Correct league/team initialization

**Objective:** Replace `NuevaLiga.jsx`'s auto-generated placeholder teams and players with real, organizer-entered team names and zero-player teams, per spec §12, without redesigning the rest of the wizard.

**Exact files likely affected:**
- `src/pantallas/NuevaLiga.jsx` — `equiposDemo` (`:36-44`), the team-count slider (`:242-246`), and the player-bulk-insert block (`:97-108`) inside `publicar()`.

**Data/schema impact:** none beyond Stage 1's already-landed fields. `db.equipos.bulkAdd` still runs with real organizer-entered names instead of `Equipo ${i+1}`; `db.jugadores.bulkAdd` for placeholder players is deleted entirely — teams are created with zero fichas.

**Behavior changed:**
- The "Equipos: N" range slider (`:242-246`) is replaced (or supplemented) with N text inputs for real team names — **minimal mobile approach:** keep the existing slider to pick the *count* first (already a single-thumb, thumb-friendly control proven to work on the current screen), then render exactly that many single-line text inputs directly below it, one per team, using the same `.campo`/`input` pattern already used elsewhere on this same screen (`:201-205`) — no new input component, no multi-step sub-wizard, no drag-to-reorder. This keeps the screen's existing vertical single-column flow (already mobile-first, per the app's established `.app` 760px/mobile-first architecture) and adds only repeated instances of a control the screen already has.
- `publicar()` no longer creates any `jugadores` rows.

**Behavior explicitly preserved:** league creation still produces a real `liga`, real `equipos`, a real generated calendar/`partidos` set, and navigates to the new liga's page exactly as today (`NuevaLiga.jsx:124`). The two-step "Nueva liga" → "Calendario propuesto" flow (`paso` state, `:33,127-191`) is unchanged.

**Implementation steps:**
1. Replace `equiposDemo`'s `nombre: \`Equipo ${i+1}\`` generation with organizer-entered values, sourced from N new text inputs bound to a `nombresEquipos` array state, kept in sync as `nEquipos` changes (add/remove trailing entries, preserving already-typed names when the count increases — do not clear typed input on a slider nudge).
2. Update the `listo` gate (`:58`) to also require every team name non-empty, alongside the existing name/cancha/día/franja checks, with an updated helper message (`:299-303`) reflecting the new requirement.
3. Remove the player bulk-insert block (`:97-108`) from `publicar()` entirely.
4. Confirm the "Calendario propuesto" review step (`paso === 2`) still renders correctly using the now-organizer-named teams (`equiposDemo.find(...)` lookups at `:157-158` already key off `.id`/`.nombre`, unaffected by the source of the name).

**Automated validation:**
- Unit test confirming `publicar()` produces `equipos` rows with organizer-entered names and zero associated `jugadores` rows.

**Manual validation:**
- Create a league end to end on a narrow (mobile-width) viewport with 4, 8, and 12 teams; confirm all name inputs are reachable, typeable, and retained when adjusting the team-count slider up and down.
- Confirm the published league's team page (`/e/:slug`) shows the real name and an empty roster.
- Confirm the calendar/schedule review step and final publish still work unchanged.

**Exit criteria:** no league can be published with a placeholder team or player name; every new team starts at zero players; existing league-creation behavior (calendar generation, pricing display, publish/navigate) is unaffected.

**Rollback/risk notes:** low risk — this stage only removes code (the placeholder generator) and extends an existing form; it does not touch the schema or any other screen. The main risk is a regression in the "Calendario propuesto" review step if team-name lookups elsewhere assumed a specific placeholder format — inspection found none (`:157-158` key off `.id`, not name format).

---

## Stage 3 — Team roster management

**Objective:** Build the actual add/edit/remove-player surface on the Team page — the capability that has never existed in this application — per spec §7 (Journeys 2–5), §8, §10, §11, §14.

**Exact files likely affected:**
- `src/pantallas/Equipo.jsx` — extend the existing "Plantilla" list (`:155-179`) with organizer-only controls; needs a new `useSesion`/`esDuenoDe` import (currently absent from this file, confirmed by inspection).
- `src/pantallas/Consola.jsx` — `plantel` (`:71`) filtered to active-only.
- `src/datos.js` — new write/mutation functions (add/edit/remove-player), and `useEquipo`'s player query (`:225`) likely split into "active roster" vs. an unfiltered variant if the Team page ever needs both (this stage only strictly needs active; see Stage 5 note on whether an inactive-history view belongs here).
- Identity-helper module from Stage 1, reused (not reimplemented).

**Data/schema impact:** none new — this stage is the first to actually *write* using Stage 1's fields (`nombrePila`, `apellido`, `activo`, `personaId` reused-or-fresh) through real UI, plus the first `db.jugadores.update`/equivalent for edits and the `activo` flip for removal. No Sebel-wide matching yet — this stage's add/edit flow calls into matching (Stage 4) as a dependency, but building the roster CRUD shell and the DOB-reminder UI can be sequenced first with matching temporarily stubbed as "always no match found," per the dependency map below, if the execution agent wants to parallelize.

**Behavior changed:** the Team page gains, for the owning organizer only: an "Añadir jugador" action (first/last name required, jersey/DOB optional), inline edit on each roster row, a "quitar" (remove) action per row, and a persistent identity-incomplete indicator on any active roster row missing DOB.

**Behavior explicitly preserved:** the existing read-only "Plantilla" rendering for guests is untouched in shape (`.lista`/`.jugador-fila`, `:162-179`) — organizer controls are additive to the same list, not a replacement UI. `Consola.jsx`'s scoring flow is unaffected except that its `plantel` now excludes inactive fichas (a correctness fix, not a new feature — an inactive player was never supposed to be scorable, this was simply unenforced before Stage 1/3 existed).

**Likely components/functions and state transitions:**
- `Equipo.jsx` gains a local `editando`/`agregando` UI-state (which row, if any, is in edit mode; whether the add-form is open) — no new route, this stays a same-page state machine like the existing `verTodas` pattern already used in `Inicio.jsx`'s Buscador history.
- States per ficha, from this stage's perspective: **new** (being entered, not yet saved) → **active, complete** (DOB present) → **active, incomplete** (DOB absent, reminder shown) → **inactive** (removed). Stage 4 inserts a **pending-match-decision** sub-state between "new" and "active" when a candidate is found — that transition is Stage 4's responsibility, not this stage's; this stage can ship with that sub-state absent (matching always resolves to "no match, create new person") and Stage 4 slots it in without reshaping this stage's component structure.
- Add-player function signature (illustrative, not literal code): `agregarJugador({ equipoId, ligaId, nombrePila, apellido, dorsal?, fechaNacimiento?, personaId })` — `personaId` supplied by the caller (either freshly generated here, or passed in by Stage 4's matching flow when reused) so this stage's CRUD layer never itself decides identity, only persists it (keeps the "no automatic merges" invariant enforced in exactly one place).
- Remove function: sets `activo: false` on the ficha; never calls `.delete()`.

**Implementation steps:**
1. Add `useSesion`/`esDuenoDe(sesion, liga)` to `Equipo.jsx`, gating all new controls exactly as `Partido.jsx:174` already gates "Llevar el marcador."
2. Build the add-player form (first name, last name required; jersey number, DOB optional) reusing the app's existing `.campo`/input styling (no new form-field component).
3. Wire "Añadir jugador" to a new `datos.js` mutation that, for this stage alone (Stage 4 not yet wired), always generates a fresh `personaId` — i.e., ships correct and safe in isolation, with Stage 4 later inserting the matching decision before this call.
4. Add inline edit (first/last/jersey/DOB) per roster row, writing directly to the existing ficha (no `personaId` change from an edit alone, per spec §10 — Stage 4 adds the name-edit-reruns-matching behavior on top of this).
5. Add the persistent "identity information incomplete" indicator, rendered whenever `!ficha.fechaNacimiento`, next to the row and/or in the edit form (wording/visual design explicitly left open by the spec, §14, §20).
6. Add "quitar" (remove) — sets `activo: false`, no confirmation-dialog design mandated here beyond whatever the app's existing destructive-action pattern is (there is none in this app today beyond browser `confirm()` in `Jugador.jsx:34` — reuse that pattern for consistency rather than inventing a new one).
7. Filter `Equipo.jsx`'s displayed roster to active fichas only (§A of the spec: "full active roster").
8. Update `Consola.jsx:71`'s `plantel` to exclude inactive fichas.

**Automated validation:**
- Unit tests for the add/edit/remove mutation functions in isolation (given a mock/in-memory Dexie or a thin wrapper, per whatever test infra Stage 1 introduces).
- Unit test confirming a removed ficha's `id` and prior `eventos` references are untouched.

**Manual validation:**
- On a real narrow-viewport device/emulator: add three players to a zero-player team using only first+last name; confirm each appears immediately with a visible identity-incomplete indicator.
- Add DOB to one and confirm the indicator clears for that row only.
- Edit a jersey number and confirm no unrelated fields change.
- Remove a player who has **not** played any match; confirm they disappear from the active roster and cannot be selected in `Consola.jsx` for a new match on that team.
- Remove a player who **has** played a match; confirm their historical match page (`Partido.jsx`) and their own profile (`Jugador.jsx`) are unchanged, and `Liga.jsx`'s Jugadores tab and `Equipo.jsx`'s (still-current) stats continue to include their historical numbers.

**Exit criteria:** every add-player acceptance criterion in spec §19 (##1–4, 8–11, 24 at minimum) passes manually; guests see no new controls; `Consola.jsx` never offers an inactive ficha for scoring.

**Rollback/risk notes:** this is the largest single stage in the plan and the first to expose real organizer-facing UI. Because Stage 1 already guarantees schema safety, the risk here is contained to `Equipo.jsx`/`Consola.jsx`/`datos.js` — a broken add-player form does not endanger existing data, only blocks the new feature, which is safe to ship disabled (feature-flag or simply incomplete/unreachable in the UI) if this stage needs to be split further.

---

## Stage 4 — Sebel-wide person matching

**Objective:** Implement the candidate-matching and same-person/different-person confirmation flow, per spec §9, §10, §17.7 — scoped, per the architecture answer to Q9 above, to the local Dexie instance (i.e., correctly "Sebel-wide" within this browser's data, not across organizers/devices).

**Exact files likely affected:**
- New: a matching module, e.g. `src/lib/identidad.js` (extending Stage 1's helper) or a dedicated `src/lib/coincidencias.js` — houses the normalized-name lookup, grouping-by-`personaId`, and the candidate-disclosure view-model shaping (see privacy note below). **This belongs in a reusable domain/data helper, not inline in `Equipo.jsx`** — both the add-player flow (Stage 3) and the edit-name flow (also Stage 3's edit form, per spec §10/§6-of-updates) need to call the identical matching logic; duplicating it in two places in the component risks the two call sites drifting out of sync on exactly the kind of identity-safety logic that must not drift.
- `src/pantallas/Equipo.jsx` — add-player and edit-name flows call into the new matching module and render its result as a confirmation UI step.
- `src/datos.js` — the mutation functions from Stage 3 gain a `personaId` parameter sourced from this stage's confirmation flow rather than always generating fresh.

**Data/schema impact:** none new. Pure read (candidate search) plus the same write shape Stage 3 already established (`personaId` on the ficha).

**Behavior changed:** adding a player, or editing an existing player's first/last name, may now surface a candidate confirmation step before the write completes.

**Behavior explicitly preserved:** editing jersey number or DOB alone never triggers this flow (spec §10); creation and edits are still never hard-blocked by a match (spec §9); no merge ever happens without the explicit choice.

**Implementation steps:**
1. Build the normalized-name lookup (case-insensitive, accent-insensitive — reuse the exact normalization already used by `Buscador`'s `coincide()`, `Inicio.jsx:436`, rather than inventing a second normalization function) against `db.jugadores` **unfiltered by `ligaId`** — this is the one query in the whole app deliberately not scoped to a single league, and should be commented as such so a future reader doesn't "fix" it into being league-scoped by habit.
2. Group raw hits by `personaId` (spec §9: "multiple fichas already sharing one `personaId` should be presented as one candidate person").
3. **Shape the candidate view-model to implement the disclosure rule at the data layer, not the render layer** (spec §9's privacy note, restated by this task): the object returned to the UI must not contain exact DOB, and must contain only name, an age computed from DOB (not the DOB value itself), country when appropriate, sport, and team/league sporting context. Fields like phone/email/ID do not exist in the schema at all yet (spec §8 explicitly excludes them from roster creation), so there is nothing to accidentally leak there today — this step is really about DOB, and about not widening the returned object later without re-checking this rule.
4. Build the confirmation UI (candidate card(s) + "Es la misma persona" / "Es otra persona" buttons) — reuse existing row/card styling (`.jugador-fila`-family), no new visual language required by the spec.
5. Wire the add-player flow (Stage 3) to call this module before finalizing a new ficha; wire the edit-name flow to call it before saving a first/last-name change, excluding the ficha being edited itself from its own candidate results.
6. On "Es la misma persona": pass the matched candidate's `personaId` into the existing Stage 3 mutation, and pre-fill (not silently overwrite without display) the new/edited ficha's name/DOB fields from the candidate, per the Q2 tradeoff above.
7. On "Es otra persona": generate a fresh `personaId`, exactly as Stage 3 already does when no match exists.

**Automated validation:**
- Unit tests for the normalized matcher (exact, case-variant, accent-variant, no-match).
- Unit test confirming the candidate view-model never contains an exact DOB field, only a derived age.
- Unit test confirming grouping collapses multiple same-`personaId` fichas into one candidate.
- Integration test: same-person confirmation reuses `personaId`; different-person confirmation produces a distinct one.

**Manual validation:**
- Within one browser: create "Pedro Arauz" in League A. Add "Pedro Arauz" to a team in League B (different league, same browser) — confirm the candidate surfaces with the disclosure-limited card (name, age not DOB, country/sport/context) and that choosing "Es la misma persona" reuses the `personaId`.
- Repeat across two different sports (e.g. a basketball league and a futsal league in the same browser) — confirm cross-sport matching works identically.
- Create two genuinely different people sharing a name in the same league; confirm "Es otra persona" for the second produces a distinct `personaId` and no merge occurs.
- Confirm editing only a jersey number or DOB never opens the matching UI; confirm editing the first or last name does.

**Exit criteria:** every matching-related acceptance criterion in spec §19 (##5–8, 17–19, 22–23, 26–27) passes manually; no code path can set two different fichas' `personaId` to the same value without an explicit organizer confirmation somewhere in its call chain.

**Rollback/risk notes:** this stage is the most identity-sensitive in the plan. Because Stage 3 already ships safely without it (always-fresh-`personaId` behavior), Stage 4 can be developed and tested behind a feature flag or simply merged when ready without blocking Stages 3/5/6/7 — but it should land before any real multi-league organizer usage, since without it every cross-league registration of the same real person silently creates a duplicate identity (functionally correct per Stage 3 alone, just not yet deduplicated).

---

## Stage 5 — Rejoin / ficha lifecycle integrity

**[Sequencing note, as requested by the planning brief]: this stage's substance is already distributed across Stages 1, 3, and 4 rather than being its own block of new code — reordering explained below, not deferred.**

- The **schema** for "new ficha per registration period, old one never reactivated" is Stage 1's `activo` field — there is no separate "reactivate" flag or code path to build, by design (spec §11: rejoining always creates a new ficha through the normal add-player flow).
- The **mechanism** — "rejoin" is simply the ordinary Stage 3 add-player flow, run again for a team the person previously left — requires no new UI beyond what Stage 3 already ships.
- The **identity continuity** — the new ficha reusing the old one's `personaId` — is exactly Stage 4's "Es la misma persona" path, with no special-cased "this is a rejoin" branch (the system has no way to distinguish "a genuine rejoin" from "any other same-person match" and, per spec §9/§11, is not supposed to try — it's the same confirmation either way).

**What this stage actually needs to add, concretely, once Stages 1/3/4 exist:**
1. Confirm (design + a manual test, not new production code) that `Consola.jsx`'s `plantel` correctly shows only the **new, active** ficha for a rejoined player, never the old inactive one, in a team that has both.
2. Confirm the player's own profile page (`Jugador.jsx`, via `useOtrasFichas`/`personaId`) surfaces **both** the old inactive ficha and the new active one as part of "También jugó" (`Jugador.jsx:95-117`) — this already works today for any two fichas sharing a `personaId` (it's how tournament call-ups already render, `seed.js:464`), so this is a verification step, not new code.

**Objective:** verify, not build — the lifecycle logic falls out of Stages 1/3/4 correctly by construction; this stage exists in the plan as an explicit checkpoint so "rejoin" is tested as its own scenario rather than assumed to work because its parts individually work.

**Automated validation:** an integration test spanning Stage 3 + Stage 4's functions together: add → remove → re-add (same team) → assert two fichas exist, same `personaId`, only the second is active.

**Manual validation:** the two checks listed above, plus repeating "remove → re-add" across a team change and a sport change (not just the same team).

**Exit criteria:** spec §19 acceptance criteria #20–21 pass.

**Rollback/risk notes:** none beyond Stages 1/3/4's own — this stage is verification, not new surface area.

---

## Stage 6 — League `Jugadores` completeness

**Objective:** Show every registered player in the League `Jugadores` view, statistical leaders first, per spec §13 — the smallest stage in this plan.

**Exact files likely affected:**
- `src/pantallas/Liga.jsx` — `Jugadores` function, specifically the `.filter((s) => s.partidos > 0)` at `:246`.

**Data/schema impact:** none. `estadisticaJugadores` (`src/lib/marcador-calculo.js:104-128`) already initializes a zero-value stat row for every player passed in and already sorts by `promedio` descending — confirmed unchanged by this investigation. The defect is isolated to the one filter line.

**Behavior changed:** players with zero games now appear in the League `Jugadores` view, after statistical leaders.

**Behavior explicitly preserved:** `Máximos anotadores`/`Más faltas` ordering, the `.slice(0, 15)`/`.slice(0, 8)` caps, and every other part of `Liga.jsx`'s Jugadores tab are unchanged. `Equipo.jsx`'s roster rendering (which already shows every player, `:163-179`, confirmed by this investigation to already be correct) is the pattern being matched — this stage brings `Liga.jsx` in line with a pattern `Equipo.jsx` already implements correctly today.

**Implementation steps:**
1. Remove `.filter((s) => s.partidos > 0)` at `Liga.jsx:246`.
2. Confirm zero-game players render with `Liga.jsx`'s existing per-row markup (no new markup needed — `Equipo.jsx:172`'s `"Sin partidos"` fallback pattern is a reasonable model if `Liga.jsx`'s row currently assumes a non-zero stat; verify and adjust only if it visibly breaks).
3. Consider whether the existing `.slice(0, 15)` cap should become "top 15 by stats, then all remaining registered players uncapped below" versus "cap the whole list at 15" — spec §13 says "leaders first, then remaining registered players," implying the cap should not hide zero-game players entirely; this is the one small judgment call this stage needs to make explicitly rather than silently, since the spec doesn't give an exact number.

**Automated validation:** unit test confirming a league with N total players and M players who've scored shows all N, with the M sorted first.

**Manual validation:** visually confirm on both the League page and (already-correct) Team page that a freshly added zero-game player from Stage 3 appears in the right place.

**Exit criteria:** spec §19 acceptance criterion #12 passes; no existing Liga.jsx tab (standings, calendar, etc.) is affected.

**Rollback/risk notes:** minimal — smallest, most isolated change in the plan.

---

## Stage 7 — Regression and MVP validation

**Objective:** Confirm the whole feature set together, and confirm nothing else in the application regressed.

**Scope, mapped to what changed:**
- League creation (Stage 2): create with 4/8/12 real-named teams, all starting at zero players.
- Team roster CRUD (Stage 3): add/edit/remove across several teams.
- DOB reminder lifecycle (Stage 3/spec §14): appears, clears, reappears if DOB is cleared via edit (if editing DOB back to empty is even exposed — confirm the edit form's behavior here, since the spec doesn't explicitly forbid clearing a previously-entered DOB).
- Sebel-wide matching (Stage 4): same person across leagues, across sports; distinct people, same name; disclosure boundary (age not DOB, no contact/ID fields — none of which exist in the schema yet regardless).
- Rejoin lifecycle (Stage 5): old ficha inactive/historical, new ficha active, both visible on the person's profile.
- Match-console selection (Stage 3): inactive fichas never selectable; active ones still are.
- Historical rendering (Stages 1/3): a past match involving a since-removed player renders identically to before.
- Statistics (Stage 6, and Stages 1/3 not breaking existing stats): `Liga.jsx`, `Equipo.jsx`, `Figuras.jsx`, `Jugador.jsx` all still compute correctly with the new fields present.
- League `Jugadores` (Stage 6): zero-game players visible, correctly ordered.
- Player page (`Jugador.jsx`): unaffected reading, `reclamar()`/`reclamado` still exactly as before (spec §16 — must remain untouched by this whole plan).
- Mobile roster management (Stage 2/3): both the team-name entry and the add/edit-player forms usable one-handed on a real narrow viewport.
- Existing Home behavior/routes: unaffected — nothing in this plan touches `Inicio.jsx`'s own logic; it only reads `jugador.nombre`/`.dorsal` (`:365,410`), both still populated as before.

**Automated validation:** whatever test suite Stages 1–6 introduced, run together; this stage does not add new automated tests of its own beyond an end-to-end smoke pass if such infra exists by this point.

**Manual validation:** a single scripted walkthrough covering every bullet above in one session, on both a desktop-width and a phone-width viewport.

**Exit criteria:** every acceptance criterion in spec §19 (all 27) passes; no pre-existing screen (Home, Liga, Partido, Categoria, Reto, Siguiendo, Figuras, Noticias) shows any behavioral change.

**Rollback/risk notes:** if a regression is found here that traces to an earlier stage, the fix belongs in that stage's code, not patched over in Stage 7 — this stage is validation, not a catch-all implementation step.

---

## Dependency map

```
Stage 1 (data compatibility foundation)
  └─→ Stage 2 (league/team init)         — independent of Stage 1's identity fields beyond schema existing;
  │                                          could theoretically run in parallel with early Stage 1 work,
  │                                          but should land after Stage 1 to avoid two concurrent schema-touching efforts.
  └─→ Stage 3 (team roster CRUD)          — hard dependency on Stage 1 (fields must exist) and
        │                                    soft dependency on Stage 2 (needs zero-player teams to add to,
        │                                    though Stage 3 could be built/tested against a seeded team first).
        └─→ Stage 4 (Sebel-wide matching) — hard dependency on Stage 3 (needs the add/edit call sites to hook into).
              └─→ Stage 5 (rejoin/lifecycle) — verification-only; depends on Stages 1+3+4 all existing.
Stage 6 (League Jugadores completeness)  — fully independent; touches only Liga.jsx/marcador-calculo.js,
                                             can be built and shipped at any point, including before Stage 1.
Stage 7 (regression/MVP validation)      — depends on everything above.
```

Practical ordering recommendation: **1 → 2 → 3 → 4 → 5 → 6 → 7**, matching the brief's candidate sequence, with Stage 6 optionally pulled earlier (even before Stage 1) if the team wants a quick, low-risk, independently shippable win first — nothing else in this plan depends on Stage 6's timing.

---

## Risk register

| Risk | Category | Where it lives | Mitigation in this plan |
|---|---|---|---|
| Bumping `SEMILLA` instead of/alongside the Dexie version, wiping real data | **Data-loss/history** | Stage 1 | Explicit prohibition stated three times in this document; named again below in Implementation-Agent Boundaries |
| Legacy `personaId: undefined` rows being grouped together as one false "person" by matching | **Identity-corruption** | Stage 1 → Stage 4 | Stage 1's backfill assigns each a distinct fresh id before Stage 4 ever runs |
| `usePartido` being filtered to active-only at the source, silently hiding a departed player from historical match pages | **Data-loss/history** (of display, not underlying data) | Stage 3 | Explicitly called out (§0, Q6) — filter belongs only in `Consola.jsx`'s local `plantel`, never upstream |
| Candidate-matching UI exposing exact DOB or other sensitive data to a non-owning organizer | **Privacy** | Stage 4 | Disclosure shaped at the data-layer view-model, not the render layer (spec's own explicit requirement, restated in Stage 4 step 3) |
| `nombre` losing its "full display name" meaning, breaking any of the nine identified consumers | **Route/behavior compatibility** | Stage 1 | `nombre` stays composed/derived, never redefined |
| A ficha's `codigo` or `id` changing as a side effect of any edit | **Route compatibility** | Stage 3/4 | Explicitly listed as immutable in spec §17.3/§17.4; no stage in this plan touches either field on edit |
| `Consola.jsx`'s `plantel` still offering an inactive player for scoring | **Match-console regression** | Stage 3 | Direct implementation step (§Stage 3 step 8), verified in Stage 5/7 |
| `estadisticaJugadores`/`Liga.jsx`/`Equipo.jsx`/`Figuras.jsx` accidentally excluding inactive fichas' historical contributions | **Statistics regression** | Stages 3/6 | These functions are explicitly listed as "must stay inclusive" (§0) and are not modified by any stage to add an active filter |
| Team-name/add-player forms unusable on a real phone (small tap targets, off-screen fields) | **Mobile UX** | Stages 2/3 | Explicit mobile-first implementation steps in both stages, reusing already-proven-mobile patterns from the same screens rather than new components |
| A stale PWA tab (cached `version(6)` JS) fails to open a database another tab already upgraded to `version(7)` | **Deployment/versioning** | Stage 1 | Fails closed (Dexie/IndexedDB refuses to open at a lower version; no data touched); `autoUpdate` service-worker registration limits the window; documented as an operational rollout note, not a schema-design gap |

---

## Proposed commits/checkpoints

The brief's candidate list maps cleanly onto this plan's stages with one adjustment: Stage 6 is safe to land independently and early, so it's listed as checkpoint 2 rather than last, though a team preferring strict stage order can simply move it to the end without any dependency conflict.

1. **Roster identity/data compatibility foundation** (Stage 1) — schema + migration + identity-helper module. No user-visible change; safe to ship alone and observe in production data for a day before continuing.
2. **League `Jugadores` completeness** (Stage 6) — independent, tiny, safe to land any time; listed here as an early low-risk win.
3. **Real team initialization without placeholder players** (Stage 2).
4. **Team roster CRUD** (Stage 3).
5. **Sebel-wide identity matching** (Stage 4).
6. **Rejoin/lifecycle verification** (Stage 5) — mostly test/verification commits, may be small enough to fold into checkpoint 5's tail rather than standing alone; judgment call for the execution agent based on how much new code Stage 5 actually ends up needing (per this plan's analysis, likely very little).
7. **Final roster MVP validation** (Stage 7) — a validation/test-hardening commit, not new product code.

---

## Implementation-agent boundaries

A future execution agent working from this plan must **not** decide any of the following autonomously — each is either explicitly out of scope per the spec, or a genuine open product question this plan does not answer:

- No government-ID collection policy (spec §14, §16) — not even a "just in case" optional field.
- No profile-claim implementation (spec §16) — `Jugador.jsx`'s `reclamar()`/`reclamado` stay exactly as they are, defect and all.
- No guardian-consent design (spec §15) — minors are rostered normally; nothing more.
- No commercial/scouting access design or data export (spec §16, §K of the spec's approved updates).
- No automatic identity merges under any circumstance, including "obviously" identical names — every merge is an explicit organizer choice, no exceptions, no confidence-threshold auto-accept.
- No destructive history deletion — no stage in this plan ever calls `.delete()` on a `jugadores` row or an `eventos` row; "remove" always means `activo: false`.
- No new sport-specific persona identities — one `personaId` per human, full stop, enforced by Stage 4's grouping logic, never bypassed for "cleanliness."
- No unrelated Home redesign, or any other screen not named in this plan's file lists.
- **No bumping `SEMILLA` in `src/seed.js`**, and no other mechanism that clears `db.jugadores`, `db.eventos`, `db.partidos`, or any other table as a side effect of shipping this work.
- No introduction of a canonical `personas` table without a separate, explicit decision — this plan deliberately keeps identity fields on the ficha (Q2) and names the tradeoff rather than silently building the bigger structure.
- No attempt to solve the cross-device/cross-organizer matching limitation (Q9) with an unauthorized backend or sync layer.

---

## Final readiness assessment

`ROSTER MVP IMPLEMENTATION PLAN: READY`

Every stage is grounded in current, cited code; every open question the brief asked this plan to answer has a concrete, architecture-consistent answer (not a deferral); the one genuine contradiction discovered (the app's own `SEMILLA`-reseed convention versus this task's non-destructive-migration requirement) is resolvable by simply not invoking that mechanism, and is documented prominently rather than silently avoided. No stage requires a product decision this plan doesn't already have from `docs/roster/ROSTER_MVP_SPEC.md`.

---

*This document was generated from `docs/roster/ROSTER_MVP_SPEC.md` plus direct inspection of `src/db.js`, `src/seed.js`, `src/pantallas/NuevaLiga.jsx`, `src/pantallas/Equipo.jsx`, `src/pantallas/Liga.jsx`, `src/pantallas/Ligas.jsx`, `src/pantallas/Jugador.jsx`, `src/pantallas/Consola.jsx`, `src/pantallas/Partido.jsx`, `src/pantallas/Figuras.jsx`, `src/pantallas/Reto.jsx`, `src/pantallas/Retar.jsx`, `src/pantallas/Categoria.jsx`, `src/pantallas/Siguiendo.jsx`, `src/pantallas/Inicio.jsx`, `src/lib/sesion.js`, `src/lib/marcador-calculo.js`, `src/lib/enlaces.js`, `src/datos.js`, and `package.json`. It is a planning artifact only and does not itself constitute an amendment to `REQUISITOS.md` or to `docs/roster/ROSTER_MVP_SPEC.md`.*
