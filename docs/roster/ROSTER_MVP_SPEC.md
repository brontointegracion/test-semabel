# Roster / Player Management MVP — Specification

Status: **Revised after specification review — ready for implementation planning.** Written to be implementable without access to the conversation that produced it.

**Revision note:** this draft supersedes the original version's league-scoped duplicate matching, its "not specified" active/inactive removal semantics, its "combined `nombre`" recommendation, and its "not specified" answers on name-edit re-matching and ficha reactivation. Those five points are now resolved by approved decisions and are reflected throughout this document — see §9, §5, §8, §10, §11, and the reconciled §20.

This document is derived from three sources, kept distinct throughout:

- **[REQ]** — a direct citation from `REQUISITOS.md`.
- **[CODE]** — a fact about the current implementation, cited by file/line.
- **[DECISION]** — an approved product decision that is **not yet written into `REQUISITOS.md`**. Where a decision changes or overrides a prior approach described in `REQUISITOS.md` or the current code, that conflict is called out explicitly rather than silently folded in.

No requirement in this document was invented beyond what the approving product context (reproduced faithfully in each section) actually states.

---

## 1. Purpose

Define the smallest coherent MVP for organizer-managed rosters — creating players, correcting their information, removing them from an active roster, and preventing accidental duplicate identities — so that a future implementer can build it directly from this document, and so that duplicate-player and profile-claim behavior can subsequently be validated against a real, populated roster instead of auto-generated placeholder data.

## 2. Scope

In scope for this specification:

- Organizer-facing roster management on the **Team page** (view, add, edit, remove).
- Real team creation at league-creation time (no placeholder teams/players).
- `personaId` correctness for every newly created player, as **one identity per human across all of Sebel** — every sport, league, team, season, and country.
- Sebel-wide candidate-person matching and organizer-driven same-person/different-person resolution, at both player creation and name edits.
- The active/inactive ficha lifecycle: one new ficha per registration period, historical fichas preserved and never overwritten by rejoining.
- Date-of-birth as optional identity/disambiguation data, and the resulting "identity information incomplete" organizer reminder.
- Separate first-name/last-name fields, required at creation, independently editable.
- The League `Jugadores` view showing the complete registered roster, not only statistical leaders.
- The documented **boundary** of the profile-claim subsystem (what it must not do), without implementing it.

Out of scope (see §3, §20 for the full list): profile claiming itself, guardian/minor consent flows, government-ID collection, scouting/commercial features, payment/premium profiles.

## 3. Non-goals

- Do **not** implement `Reclamar mi perfil` / claim → account → `Verificación pendiente` → approval → `Perfil verificado` in this work. Only its boundary is documented (§16).
- Do **not** design the guardian-consent subsystem for minors. Only the boundary is documented (§15).
- Do **not** collect government ID/document as part of normal roster entry. **[DECISION]**
- Do **not** design a global maximum roster size. **[DECISION]**
- Do **not** design commercial/scouting dashboards (§K in the approved decisions — recorded only as future context in §20).
- Do **not** build a parallel admin system separate from the existing Team page, unless implementation later proves the existing architecture genuinely cannot support this (§17, §21).

## 4. Current implementation defects being corrected

Each defect below is cited to the exact current code, so an implementer can verify the starting state before changing it.

1. **No organizer-facing way to create or edit a real player anywhere in the app.** The only paths that ever write to `db.jugadores` are `src/seed.js:216` and `src/seed.js:472` (demo/seed data), `src/pantallas/NuevaLiga.jsx:108` (auto-generated placeholders, see #2), and `src/pantallas/Jugador.jsx:39` (only flips the `reclamado` boolean on an existing record — never creates one). **[CODE]**
2. **League creation auto-generates fake placeholder teams and players.** `src/pantallas/NuevaLiga.jsx:36-44` generates `equiposDemo` named `Equipo ${i+1}`; `src/pantallas/NuevaLiga.jsx:89-108` bulk-inserts 6 players per team named `Jugador ${ei+1}-${i+1}` with `dorsal: i+4`. No form field exists anywhere in this screen for a real team or player name. **[CODE]** — conflicts with **[DECISION]** §G below, which requires real team names and zero auto-generated players.
3. **`personaId` is not set by the only real player-creation path.** `src/pantallas/NuevaLiga.jsx:97-107`'s bulk-inserted player objects have no `personaId` field at all, unlike `src/seed.js:210` (`personaId: uid()`) and `src/seed.js:464` (`personaId: j.personaId`, reused for tournament call-ups). Every player created through actual organizer use today has `personaId: undefined`. **[CODE]** — conflicts with **[DECISION]** §D, which requires every new person to receive a `personaId`.
4. **League `Jugadores` view hides players with zero games.** `src/pantallas/Liga.jsx:246` — `estadisticaJugadores(...).filter((s) => s.partidos > 0)` — discards any player who hasn't played yet before rendering `Máximos anotadores`/`Más faltas`. Note that the underlying `estadisticaJugadores` function (`src/lib/marcador-calculo.js:104-128`) already initializes a zero-value stat row for **every** player passed in and already sorts by `promedio` descending (§13) — the defect is isolated to this one `.filter` line in `Liga.jsx`, not in the stats computation itself. **[CODE]** — conflicts with **[DECISION]** §H.
5. **No duplicate-name detection anywhere.** Confirmed by the same grep as #1 — there is no name-matching logic at any `db.jugadores` write site. **[CODE]** — this is not a contradiction of any prior requirement (none existed), but it is a gap **[DECISION]** §E now requires closing.
6. **Profile claim immediately produces `Perfil verificado`.** `src/pantallas/Jugador.jsx:33-40` — `reclamar()` shows a plain `confirm()` dialog with no account/auth behind it, then runs `db.jugadores.update(jugador.id, { reclamado: true })`. `src/pantallas/Jugador.jsx:54-58` reads that same `reclamado` boolean directly to render `"Perfil verificado"` vs `"Sin reclamar"` — claimed and verified are the same bit today. **[CODE]** — explicitly a **known MVP defect**, not something this specification's implementation should preserve or extend (§16, §I of the approved decisions). This document does not fix it; it only marks it as deferred, out-of-scope work with a documented target direction.
7. **No active/inactive concept exists on `jugadores`.** The schema (`src/db.js:8-44`) has no `activo`/`estado` field on the `jugadores` table at any version. Removing a player today would have to mean deleting the row outright, which is unsafe (§11, §17). **[CODE]**

## 5. Terminology

| Term | Meaning | Status |
|---|---|---|
| **Persona** | The real human being. Not a database row by itself in the current schema — represented only by the `personaId` value shared across that person's fichas. | **[CODE]** concept, named in a comment at `src/seed.js:208-209`: *"personaId es el señor; la ficha es dónde está inscrito."* |
| **`personaId`** | A stable identifier field on each `jugadores` row, intended to be the same value across every ficha belonging to one real person, across teams/leagues/tournaments/time. | **[CODE]**, schema field since `src/db.js:41` (`db.version(5)`). |
| **Ficha / roster registration** | One row in `db.jugadores`: a specific registration to one `ligaId` + `equipoId` for one registration period. **Every new registration period — a new league season, a new team, a new sport, rejoining after leaving — creates a new ficha; an old ficha is never reactivated or overwritten.** One persona accumulates many fichas over time (own liga, tournament call-up, a later team, a different sport). This term is internal/domain vocabulary — nothing requires it to appear in organizer-facing UI copy. | **[CODE]** (row shape) + **[REQ]** `REQUISITOS.md:120,122` (a person is not a registration) + **[DECISION]** (the "new ficha per registration period, never reactivated" lifecycle rule is new, §D/§3 of the approved updates). |
| **Active ficha** | A ficha that is a member of its team's current active roster and is selectable for future matches. | **[DECISION]**, new — §11, §4 of the approved updates. |
| **Inactive ficha** | A ficha no longer on an active roster (player left, or superseded by a newer ficha for a new registration period). Preserved permanently for historical matches, statistics, and person history; never selectable for future matches; never physically deleted for this reason alone. | **[DECISION]**, new — §11, §4 of the approved updates. |
| **Active roster** | The set of *active fichas* for a team. | **[DECISION]**, new. |
| **Claimed profile** | `jugador.reclamado === true`. Today conflated with "verified" (§4.6). Under this specification's boundary (§16), claiming remains a distinct, earlier state than verified. | **[CODE]** field; **[DECISION]** redefines its meaning going forward. |
| **Verified profile** | `Perfil verificado` — the end state of the approved future claim flow (`claim → authenticated/account state → Verificación pendiente → organizer approval → Perfil verificado`). Does not exist as a separate state in code today (§4.6). | **[DECISION]**, not yet implemented; out of scope here (§16). |

## 6. User roles and permissions

Two roles exist in the current session model, `src/lib/sesion.js`: **[CODE]**

- `invitado` (guest) — the default, `asegurarSesion()` (`sesion.js:16-22`).
- `organizador` — set by `entrar()` (`sesion.js:24-26`), a single hardcoded account (`cuentaId: 'yo'`) in this prototype.
- Ownership check: `esDuenoDe(sesion, liga)` (`sesion.js:35-36`) — true only if the session is an organizer **and** `liga.organizadorId === sesion.cuentaId`.

For roster management:

- **Only the organizer who owns the liga a team belongs to** may add, edit, or remove players on that team's roster. This reuses `esDuenoDe(sesion, liga)` exactly as it already gates "Llevar el marcador" on `Partido.jsx:174-176` and the `/p/:slug/consola` route (`App.jsx:76`) — no new authorization concept is introduced.
- Guests retain full read access to rosters (team page, player profiles, league Jugadores view) — this specification does not change what a guest can see, only what a guest can do (nothing, same as today).
- There is no third "player account" role in the current system (see the identity-inspection finding this spec is built on) — none is introduced here either; that belongs to the deferred claim subsystem (§16).
- **Sebel-wide candidate matching (§9) is read-only outside the organizer's own league.** Surfacing a plausible candidate from another league/sport for disambiguation does not grant any edit, view-behind-the-warning, or management right over that other league's roster — `esDuenoDe` still gates all actual add/edit/remove actions to the liga being managed. What a non-owning organizer may see about a cross-league candidate is bounded by the cross-league candidate-disclosure rule in §9 (name, age, country, sport, sporting context — never exact DOB, contact information, ID/document, or account details).

## 7. Organizer roster-management user journeys

**Journey 1 — New league, empty rosters.**
Organizer creates a league (`/nueva`, `NuevaLiga.jsx`), typing real team names instead of accepting placeholders. Each team is created with 0 players. Organizer is directed (or navigates) to each team's page to begin adding players. **[DECISION]** §G.

**Journey 2 — Add a player.**
From the owning organizer's view of a Team page (`/e/:slug`, `Equipo.jsx`), the organizer adds a player with first name + last name (required), optionally jersey number and date of birth. If a plausible name match exists anywhere in Sebel, the organizer is asked to resolve it (§9) before the ficha is finalized. The player appears immediately in the roster list, including if they have zero games — no page reload or stats event required for visibility (§13, §4.4).

**Journey 3 — Correct information later.**
Organizer edits an existing roster entry's first name, last name, jersey number, or date of birth (§10) from the same Team page.

**Journey 4 — Clear the identity-incomplete reminder.**
Organizer adds a date of birth to a player who was created without one; the persistent reminder for that player clears (§14).

**Journey 5 — Remove a player from the active roster.**
Organizer removes a player who left the team; the ficha stops being selectable for future matches, but the player's historical games/stats remain exactly as they were, everywhere they already appear (§11).

**Journey 6 — Same person, new context.**
Organizer adding a player to a *different* team, league, country, or sport recognizes a candidate match surfaced by Sebel-wide matching, confirms "Es la misma persona," and the new ficha reuses the existing `personaId` instead of creating a new identity (§9). This is also the mechanism for a rejoin after removal (§11) — no separate reactivation path exists.

**Journey 7 — Correct a name and re-confirm identity.**
Organizer corrects a misspelled first or last name on an existing player; because the name changed, Sebel reruns candidate matching (§10) — if a new plausible match now appears, the organizer resolves it the same way as at creation before the edit is saved.

## 8. Add-player requirements

**Required at creation: [DECISION] §B**
- First name.
- Last name.

**Optional at creation: [DECISION] §B, §C**
- Jersey number (`dorsal`).
- Date of birth.

**Inherited from context, not entered by the organizer: [DECISION] §B**
- Team (`equipoId`) — the team page the organizer is on.
- League (`ligaId`) — the team's league.

**Explicitly not requested at creation, and not blocking creation if absent: [DECISION] §B**
- Email.
- Phone.
- WhatsApp.
- Government ID/document.
- Player account.
- Profile claim.

This directly resolves defect §4.1 (no creation path exists) and must not reintroduce defect §4.2 (no placeholders) or §4.3 (`personaId` must always be set, per §9's decision tree — either newly generated or reused, never left undefined).

**Field representation — resolved: [DECISION] §5 of the approved updates.** First name and last name are stored as **separate fields** on the `jugadores` row (e.g. `nombre` + `apellido`, exact naming an implementation detail). Both are required at creation. Both are independently editable later (§10). Display code composes them into a full name wherever the current UI shows one string. Sebel-wide candidate matching (§9) uses the normalized first-name and last-name fields as part of candidate discovery, not a single combined string.

**Compatibility flag:** the current `jugadores` schema stores name as a single `nombre` string today, and every existing consumer reads it that way — `Jugador.jsx`, `Consola.jsx`, `Liga.jsx`, `Partido.jsx`, `Inicio.jsx`, `Equipo.jsx`, `src/lib/enlaces.js:61`. **[CODE]** This means splitting the field requires either (a) a schema migration that backfills/derives first/last from existing `nombre` values for all seed/demo data, or (b) keeping `nombre` as a derived/composed display value alongside the two new fields so existing readers keep working unchanged. Which of these — and the exact migration mechanics — is an implementation concern, not decided by this document (§20).

## 9. Duplicate/candidate-person matching and confirmation behavior

**[DECISION] §1 and §2 of the approved updates — supersedes the original league-scoped version of this section.**

**Scope — Sebel-wide, not league-scoped.** When adding a new player, or editing an existing one's first or last name (§10), Sebel may surface plausible existing people **across all of Sebel** — other leagues, other teams, other countries, other seasons, other sports — not only the current league. This directly reflects the hard identity invariant in §17: one human is one `personaId` across every sport in Sebel, so candidate matching cannot correctly be limited to one league without missing exactly the cases (a player moving leagues, countries, or sports) the `personaId` model exists to handle.

**What counts as evidence, and what doesn't:**

- First name + last name (normalized: case-insensitive, accent-insensitive — the same normalization already used for search matching in `Buscador`'s `coincide()`, `Inicio.jsx:436`, is a reasonable existing pattern to reuse) is the baseline signal that surfaces candidates at all.
- Date of birth, when available on either the new entry or a candidate, and existing sporting context/history (which teams, leagues, countries, sports a candidate's other fichas belong to) are used to help the organizer **distinguish** between candidates.
- **None of this — alone or combined — proves identity.** Name equality, DOB equality, and shared sporting context are all evidence/context only. The organizer's explicit choice is the only thing that ever assigns or reuses a `personaId`.

**Behavior:**

- **Never hard-blocks creation.**
- **Never auto-merges**, regardless of how strong the evidence looks (**[DECISION]**, and consistent with the general principle in `REQUISITOS.md:126`, "The default is closed; the exception is consent" — applied here as: shared identity is never assumed, only explicitly confirmed).
- **Shows a warning with disambiguating context** for each plausible candidate, bounded by the cross-league candidate-disclosure rule below.
- **Requires an explicit organizer choice**, no default/skip:
  - **"Es la misma persona"** → the new ficha is created with `personaId` set to the **existing matched candidate's** `personaId`. This is architecturally identical to what `src/seed.js:464` already does for tournament call-ups (`personaId: j.personaId`) — no new mechanism, just an organizer-confirmed trigger for an existing pattern, now also usable across leagues/sports.
  - **"Es otra persona"** → a new ficha is created with a freshly generated `personaId` (`uid()`, same as `src/seed.js:210`), exactly as if no match had been found.
- **Multiple fichas already sharing one `personaId` should be presented as one candidate person**, not as separate duplicate hits — the matching UI groups by `personaId` (where already set) before presenting choices to the organizer, so a person with three prior fichas doesn't generate three separate prompts.

**Cross-league candidate-disclosure rule — [DECISION], resolves the previously open "Cross-league candidate visibility" question (formerly §18/§20).**

Because matching is Sebel-wide (above), a confirming organizer may be shown a candidate whose other fichas belong to a league that organizer does not own. What that candidate card may and may not disclose is now specified, not left to implementation judgment:

- **May show:** name, **age rather than exact date of birth**, country when appropriate, sport, and relevant prior league/team sporting context (e.g. "played basketball in Liga Barrial Río Abajo, Panamá, 2024 season") — the same class of disambiguating information already used for same-league matches (team, jersey number), extended to the Sebel-wide scope.
- **Must not disclose**, to an unrelated/non-owning organizer: **exact date of birth**, phone/WhatsApp, email, identification number/document, or any private account information. None of these are ever rendered in the candidate-matching UI outside the context of the organizer who already legitimately has that information for their own roster.
- **Sensitive fields may still participate internally in candidate matching without being displayed** — e.g. an exact DOB stored on two fichas may be compared server/client-side to help rank or surface a candidate as plausible, without that DOB value ever appearing in the disclosed card. Matching logic and display logic are treated as separate concerns: what a field is allowed to *do* (help identify a plausible match) is broader than what it is allowed to *show*.
- This rule applies **regardless of which side of the match is being displayed** — a non-owning organizer sees only the bounded disclosure above for the *existing* candidate; it does not relax what the *current* organizer already sees about the player they are actively adding (name, jersey number, DOB, etc. — all already entered by that same organizer for that same roster, so no cross-organizer disclosure is happening there).

This resolves defect §4.5 and, combined with §8, defect §4.3 — every new player, matched or not, leaves this flow with a real `personaId`. It also directly enables acceptance criteria for same-human-different-league and same-human-different-sport reuse (§19).

## 10. Edit-player requirements

**[DECISION] §F.** Organizer may update, on an existing ficha:

- First name.
- Last name.
- Jersey number.
- Date of birth (add if missing, correct if wrong).

Editing does not change `ligaId`, `equipoId`, or `codigo` — those remain the stable identifiers for the registration.

**Name edits rerun matching — resolved: [DECISION] §6 of the approved updates.**

- Editing **first name or last name** reruns the same Sebel-wide candidate-matching flow described in §9. If a plausible match exists (excluding the ficha being edited itself), the organizer must explicitly choose "Es la misma persona" / "Es otra persona" again, exactly as at creation, before the edit is saved.
- Editing **jersey number or date of birth alone** — with no change to first or last name — does **not** trigger the name-matching flow. These fields carry disambiguation value (§9, §14) but are not themselves name data.
- `personaId` is **never changed silently**. It only changes as a direct result of an explicit organizer choice in this matching flow (reused on "Es la misma persona," left alone on "Es otra persona" or when no match is found) — never as a side effect of any other edit.

## 11. Active/inactive ficha lifecycle, removal, and history preservation

**[DECISION] §F (original) + §3, §4 of the approved updates — the removal/reactivation semantics that were previously an open implementation question are now resolved product behavior.** Only the exact schema field name/type remains an implementation detail.

**Lifecycle rule:**

- Every new league/team registration period creates a **new ficha**. This applies uniformly across teams, leagues, seasons/registration periods, and sports.
- **Rejoining after leaving does not reactivate or overwrite the old, now-historical ficha.** A player who leaves and later returns — to the same team, a new season of the same league, a different team, or a different sport — gets a **new active ficha**, created through the normal add-player flow (§8), which reuses the same `personaId` once the organizer confirms "Es la misma persona" via candidate matching (§9) — exactly the same mechanism used for any other same-person match, with no special-cased "reactivation" code path.
- The old ficha remains permanently, unmodified, as **inactive/historical**. Future games use the new active ficha only.

**Active ficha:** member of a team's current active roster; selectable for future matches (scoring, lineups).

**Inactive ficha:** preserved for historical matches, statistics, and person history; not selectable for future matches; **never physically deleted** merely because the player left the roster.

**Removal, concretely:**

- Removing a player from a team's active roster marks that ficha **inactive** — it is not deleted, and it stops being selectable for future matches.
- Removal must **not**: delete the underlying person identity (`personaId`), erase historical games, erase historical statistics, or rewrite past match records. Past games must continue showing the player exactly as they occurred.

**Why hard deletion is ruled out, from the current data model (`src/db.js`, `src/pantallas/Consola.jsx`):**

`db.eventos` rows store `jugadorId` as a direct foreign key to a `jugadores.id` (`Consola.jsx:82,87`: `anotar({..., jugadorId: jugador.id, ...})` / `marcarFalta({..., jugadorId: jugador.id, ...})`), and at least one place already renders a fallback for a dangling reference — `Consola.jsx:244`: `{jugadoresPorId[e.jugadorId]?.nombre || 'Sin jugador'}`. If a ficha row were hard-deleted, every historical event referencing it would degrade to that "Sin jugador" fallback — a direct violation of "past games must continue showing the player exactly as they occurred." **[CODE]**-grounded, not a product preference.

**Implementation shape (schema-level detail, not a product decision):** an **active/inactive flag** on the `jugadores` row (e.g. `activo: boolean`, defaulting `true` for all existing and newly created fichas — a new Dexie schema version bump, following the existing pattern of additive `db.version(n).stores({...})` migrations already used for every prior schema change in `src/db.js`) is the minimal schema-compatible mechanism:

- The ficha row, its `id`, and every event referencing it are untouched — all historical rendering (`Jugador.jsx`, `Partido.jsx`'s `TarjetaEquipo`, `Liga.jsx`'s stats, `Consola.jsx`'s past-action log) continues to resolve correctly with no change to those read paths.
- "Stops being selectable for future matches" becomes: `Consola.jsx`'s `plantel` (`Consola.jsx:71`, currently `const plantel = jugadores`) must be filtered to `activo !== false` (or equivalent) when building the list of players available to score against — this is the one read path that actually needs to change.
- "Full active roster" on the Team page (§A of the approved decisions) means active fichas only; the person's inactive/historical fichas remain reachable through their player profile (`Jugador.jsx`, via `personaId`/`useOtrasFichas`) exactly as any other prior ficha already is today.
- This does not contradict any existing requirement — it is additive schema evolution of exactly the kind `src/db.js` already does at every version bump.

The exact field name/shape is the only part left to the implementer; the behavior above is no longer an open question.

## 12. New league/team initialization requirements

**[DECISION] §G — directly supersedes the current behavior in defect §4.2.**

- Real team names are **required** during league creation — the form must collect them, not synthesize `Equipo ${i+1}`.
- New teams may start with **0 players** — this is a valid, expected state, not an error.
- No auto-created placeholder teams.
- No auto-created placeholder players.
- Organizers populate rosters afterward, from each Team page (§7 Journey 1 → Journey 2).
- No fixed Sebel-wide maximum roster size in MVP.

**Team-name uniqueness — [DECISION], approved during Stage 2 pre-implementation review.**

- Within one league, team names must be unique.
- Comparison is on the trimmed, case-insensitive name — `"Halcones"`, `" halcones "`, and `"HALCONES"` conflict within the same league.
- A duplicate blocks league publication until the organizer changes one of the conflicting names — this is a hard validation gate, not a warning.
- **Accent-insensitive equivalence is explicitly not part of this rule** — `"Peña"` and `"Pena"` are treated as distinct team names; no additional normalization beyond trim + case-fold is introduced.
- **Team names are not globally unique across Sebel.** The same name may exist in different leagues without conflict — this uniqueness check is scoped to the single league being created, exactly like the pre-existing player-name duplicate-matching scope pattern in §9, but for a different purpose (a hard block here, versus candidate disambiguation there — the two must not be conflated).

This changes `src/pantallas/NuevaLiga.jsx`'s team-count-slider-plus-auto-generate model (`NuevaLiga.jsx:25,36-44,89-108`) into a model where the organizer enters N real team names directly, validated for uniqueness within that league, and the players array is not created at all during `publicar()` — team creation and roster population become two separate steps in time, not one atomic operation as today.

## 13. League `Jugadores` display requirements

**[DECISION] §H — directly supersedes defect §4.4.**

- Show **all registered players** in the league, including those with zero games, zero points, no statistics yet.
- Ordering: statistical leaders (Máximos anotadores) first, then remaining registered players.
- No player disappears solely because `partidos === 0`.
- No new/complex ranking algorithm beyond what `estadisticaJugadores` (`src/lib/marcador-calculo.js:104-128`) already computes — that function already produces a zero-value stat row for every player passed in and already sorts by `promedio` descending, which places zero-game players (promedio 0) after any player with a positive average, satisfying "leaders first, rest after" with no new logic. **[CODE]** — the fix is removing `Liga.jsx:246`'s `.filter((s) => s.partidos > 0)`, nothing else in the stats pipeline needs to change.
- `src/pantallas/Equipo.jsx:163-179`'s existing team-roster rendering (which already shows every `jugador` regardless of stats, with a `"Sin partidos"` fallback at `Equipo.jsx:172`) is the pattern to match — the League `Jugadores` view should end up behaviorally consistent with what the Team page already does correctly today.

## 14. Date-of-birth / incomplete-identity behavior

**[DECISION] §C.**

- Date of birth is optional at creation (§8).
- If missing, Sebel keeps an **organizer-visible "identity information incomplete" reminder/warning** for that player, persistently (i.e., it does not disappear on its own or require the organizer to remember — it should be visible wherever the organizer manages that player, at minimum on the Team page roster row and/or the edit form).
- Adding a date of birth later clears the reminder for that player (§7 Journey 4).
- Date of birth is **disambiguation/identity data, not proof of profile ownership** — it must not be treated as, or substituted for, the separate profile-claim/verification subsystem (§16).
- **Government ID/document must stay out of the normal roster flow entirely** — not collected, not requested, not referenced by this reminder.
- The exact UI wording/visual design of the reminder is explicitly **not** specified here — only its required behavior (persistent, organizer-visible, per-player, clears when DOB is added) is in scope for this document.
- **Explicitly unresolved, not silently decided:** whether anything beyond date of birth will ever be required or offered as additional identity/disambiguation evidence — and, if so, what and under what privacy/consent terms — is an open product/privacy-policy question. This document does not answer it, and DOB alone should not be read as this policy's final word (§20). (Separately, and now resolved: *how* an existing DOB is disclosed during cross-league candidate matching — never the exact value, only age — is specified in §9's cross-league candidate-disclosure rule.)

This is a genuinely new concept — no equivalent field, flag, or reminder exists anywhere in the current schema or UI (confirmed: no `nacimiento`/`fechaNacimiento`/age-related field exists on `jugadores` today). **[CODE]** confirms absence; **[DECISION]** introduces it.

## 15. Minors boundary

**[DECISION] §J**, consistent with `REQUISITOS.md:238` (*"Players under eighteen — affects the claim flow... The claim flow needs an age check and a guardian route, or under-18 profiles stay unclaimed and excluded from anything sold."*) **[REQ]**

- Organizers may roster under-18 players normally — same add/edit/remove flow as any player, no special gate.
- Their names and competition statistics may appear within ordinary league/results context (scoreboards, match figures, league Jugadores view, team roster) exactly as any other player's would.
- A minor must **not** be able to complete the expanded, player-owned public profile claim until a guardian-consent flow exists.
- Guardian consent itself is **explicitly deferred** — not designed here, matching `REQUISITOS.md:238`'s own framing as an open, unresolved item, not a silently-missing one.

This specification does not need a `fechaNacimiento`-derived age check to *block* claiming in this roster work, because claiming itself is out of scope (§16) — the boundary only needs to be documented, not enforced, by this deliverable.

## 16. Profile-claim boundary / deferred work

**[DECISION] §I — explicitly not implemented as part of this specification's scope.** Recorded so a future implementer knows the target shape and does not extend the current broken behavior:

- `Reclamar mi perfil` is free.
- Clicking claim must **never** immediately produce `Perfil verificado`.
- Approved future direction: `claim → authenticated/account state → Verificación pendiente → organizer approval → Perfil verificado`.
- Organizer approval is limited to the organizer with authority over the relevant league/record — i.e., reuse `esDuenoDe(sesion, liga)` (`sesion.js:35-36`, §6), the same check already used for scoring authority. No new authorization primitive is implied.
- ID/manual verification is **fallback/escalation** for disputes or when organizer verification is unavailable — not the default claim mechanism.
- Payment/premium is a separate concern from claiming identity.

**Current code is explicitly marked as a known defect, not a baseline to preserve:** `src/pantallas/Jugador.jsx:33-40,54-58` (§4.6). Anyone implementing the roster work in this specification must **not** copy this pattern for anything new, and must not treat `reclamado` as equivalent to "verified" if roster work happens to touch `Jugador.jsx` for unrelated reasons (e.g. rendering an updated name).

**Two further boundaries, added by product decisions §8/§K of the approved updates, also explicitly deferred here:**

- **Multi-sport profile presentation is deferred.** §17 invariant 8 establishes that a person's history *accumulates* across sports internally under one `personaId` — but how that multi-sport history is *presented* on a claimed public profile (one unified profile, sport-segmented sections, etc.) is a claim-subsystem design question, not answered by this roster specification.
- **Commercial/scouting access to unclaimed-person data is a separate, unresolved consent/privacy/business-policy question.** §K of the approved decisions records that reliable `personaId`, clean history, duplicate avoidance, and data quality "may later support professional/scouting use cases" — this is recorded here strictly as forward context. **Nothing in this specification approves, authorizes, or designs any scouting/commercial access to person data, claimed or unclaimed.** That remains a fully open question for a future, separate decision.

## 17. Data integrity invariants

These must hold after any roster operation defined in this specification:

1. Every `jugadores` row has a non-null `personaId` at creation time — no code path may insert a player without one (closes defect §4.3).
2. `personaId` is never assigned by name-matching alone — only by explicit organizer confirmation (§9) or fresh generation.
3. A ficha's `id`, `codigo`, and every `eventos` row referencing its `jugadorId` are immutable once created — removal (§11) never deletes or renumbers them.
4. `ligaId` and `equipoId` on a ficha are fixed at creation — moving a player to a different team is a new ficha (possibly reusing `personaId` per §9), not an edit of `equipoId` on the existing one, since a ficha is defined as belonging to one team registration (`REQUISITOS.md:120,122`).
5. Team names are required and non-empty at league creation (§12) — no team exists without a real name.
6. A team may legitimately have zero fichas at any point in time (freshly created, or every player removed) — this is not an error state anywhere in the system.
7. **One human = one `personaId` across all sports in Sebel. [DECISION] §2 of the approved updates — hard invariant.** Basketball, futsal/football, different leagues, different teams, different seasons, and different countries never justify a separate person identity for the same real human. Sport-specific registrations and statistics remain separate *beneath* the same `personaId` — each ficha still carries its own `ligaId`/`equipoId` and its own event-derived stats (§13's `estadisticaJugadores` scoping is unaffected); only the person-level identity is unified.
8. **A person's history accumulates across every one of their fichas, active and inactive alike, under one `personaId`.** This history may span multiple teams, leagues, seasons, countries, and sports (invariant 7). Being unclaimed (`reclamado === false`, §16) does not erase or weaken this internal linkage — `personaId` grouping (e.g. `useOtrasFichas`, `src/datos.js:387-396`) applies identically to claimed and unclaimed persons; claiming only concerns the public-facing profile and consent, not the internal data model. **[DECISION]** §8 of the approved updates.

## 18. Edge cases

- **Adding the very first player to a brand-new, 0-player team.** Candidate matching (§9) is Sebel-wide, not team- or league-scoped, so it still runs and may surface a match from anywhere in Sebel even though the team itself has no other players yet.
- **Two different real people, same name, added by two different organizers to two different teams — same league or different leagues/countries — both choosing "Es otra persona."** Correct and expected — the system must not force a merge; two distinct `personaId` values result, exactly as intended, regardless of scope.
- **Editing a player's name into a collision that didn't exist at creation time.** **Resolved (§10, §6 of the approved updates):** any edit to first or last name reruns the Sebel-wide matching flow; jersey number/DOB-only edits do not.
- **Removing a player who has a pending duplicate-decision context (e.g., mid-flow).** Not specified — assume removal only applies to an already-created ficha; the duplicate-decision flow in §9 happens before a ficha exists, so no overlap should occur if implemented as specified.
- **A player with no jersey number.** Already representable — `dorsal` is not in the required set (§8); existing rendering already handles absence gracefully in some places (e.g. `Equipo.jsx:167` renders `{j.dorsal}` directly with no fallback shown — implementer should verify this doesn't render `undefined` visibly and add a fallback if needed; this is a pre-existing minor gap, not introduced by this specification).
- **A removed player who is later re-added to any team, league, or sport.** **Resolved (§11, §3 of the approved updates):** this always creates a **new** active ficha (via the normal add-player flow, reusing `personaId` through the standard "Es la misma persona" confirmation) — the old ficha is never reactivated and stays inactive/historical. No separate "reactivate" code path is needed or specified.
- **Tournament call-ups (`sembrarTorneo`-style) referencing a player created through this new flow.** Should work correctly as long as `personaId` is always set (§17.1) — this specification's fix to defect §4.3 is a prerequisite for call-ups to function correctly on real (non-seeded) data, closing a risk noted in the identity-inspection work this document is built on.
- **Cross-league candidate visibility.** **Resolved (§9, cross-league candidate-disclosure rule):** because matching is Sebel-wide, an organizer adding a player may see a candidate whose other fichas belong to a league they do not own. That candidate card is bounded to name, age (not exact DOB), country when appropriate, sport, and relevant prior sporting context — exact DOB, phone/WhatsApp, email, ID/document, and account information are never disclosed to a non-owning organizer, even though those sensitive fields may still be used internally to help identify the candidate as plausible.

## 19. Acceptance criteria

All of the following must hold for this specification to be considered correctly implemented:

1. Create a team with 0 players — succeeds, no placeholder players generated.
2. Add a player using only first + last name — succeeds; `dorsal` and date of birth are absent without error.
3. A player added without date of birth shows a persistent, organizer-visible "identity information incomplete" reminder.
4. Adding a date of birth to that player clears the reminder.
5. Adding a player whose normalized name matches an existing player **anywhere in Sebel** triggers an explicit "Es la misma persona" / "Es otra persona" choice — creation does not proceed silently either way.
6. Choosing "Es la misma persona" results in the new ficha sharing the existing player's `personaId`.
7. Choosing "Es otra persona" results in a new, distinct `personaId`.
8. Every newly created player, matched or not, has a non-null `personaId` (no `undefined` case survives).
9. Organizer can edit first name, last name, jersey number, and date of birth on an existing player.
10. Removing a player from the active roster does not delete or alter any historical match record, event, or statistic already attributed to that player — past match pages continue to display them exactly as before.
11. A removed player cannot be selected when scoring a future match from that team's roster (`Consola.jsx` plantel).
12. The League `Jugadores` view shows a newly registered player with 0 games, positioned after players with recorded statistics.
13. No code path auto-creates placeholder players (`Jugador N-M`) or placeholder teams (`Equipo N`) at league creation.
14. No global maximum roster size is enforced anywhere.
15. Profile claiming (`Reclamar mi perfil`) is untouched/not implemented as part of this work — its current behavior (defect §4.6) is neither fixed nor extended by this specification.
16. A minor (player with a date of birth indicating under 18, where DOB is present) can be rostered, appear in results/statistics, and edited exactly like any other player, but has no path in this specification to complete an expanded claimed/verified public profile (because that subsystem isn't built here at all — the check is that nothing in this work accidentally exposes one).
17. A person already registered in **another league** can be matched as a candidate when added to a new league/team, and choosing "Es la misma persona" reuses their existing `personaId` across the league boundary.
18. A person already registered under **a different sport** (e.g. futsal) is matched as a candidate when added to a basketball roster (or vice versa), and confirming "Es la misma persona" reuses the same `personaId` across sports — no separate per-sport identity is created.
19. Two different real people with the same first + last name can each end up with a **distinct** `personaId` when the organizer correctly chooses "Es otra persona" for the second one, even with strong contextual similarity (e.g. same league, similar age).
20. A player removed from a team, then later re-added (same team, a new season, a different team, or a different sport), results in a **new active ficha** that reuses the original `personaId` — the original ficha remains, unmodified, as inactive/historical.
21. An inactive ficha remains fully visible in historical match pages, the player's own profile, and league/team statistics, but does not appear as selectable in `Consola.jsx`'s roster for a new match.
22. Editing a player's first or last name reruns candidate matching and requires an explicit same-person/different-person choice when a plausible match exists.
23. Editing only a player's jersey number or date of birth does **not** trigger the name-matching flow.
24. First name and last name are stored as separate fields on the player record, both required at creation and independently editable afterward.
25. A person's fichas across multiple sports (e.g. a basketball registration and a futsal registration) both resolve to the same `personaId` and are both reachable as that person's history (e.g. via the existing `useOtrasFichas` mechanism, `src/datos.js:387-396`).
26. A cross-league candidate card shown to a non-owning organizer displays name, age (not exact date of birth), country when appropriate, sport, and relevant prior sporting context — and does **not** display exact date of birth, phone/WhatsApp, email, identification number/document, or account information.
27. A candidate with a stored exact date of birth can still be surfaced/ranked as a plausible match using that value internally, even though the disclosed card shows only age, not the exact date.
28. Two team names that normalize identically (trimmed, case-insensitive) within the **same** newly created league block publication until the organizer changes one; the same team name used in **two different** leagues is not blocked.

## 20. Explicit deferred items (reconciled after specification review)

**Resolved by this revision — no longer listed as open** (kept here only as a pointer to where each was resolved, for anyone comparing against the original draft):

- Whether editing a player's name should re-trigger candidate matching → resolved, §10, §18.
- Whether a re-added, previously removed player reactivates the old ficha or gets a new one → resolved, §11, §18 (always a new ficha; old one stays inactive/historical).
- Whether first/last name remain combined in the existing `nombre` field → resolved, §8 (stored separately).
- Active/inactive product/data behavior for removal → resolved, §11 (only the schema field's exact name/type remains open, see below).
- Duplicate/candidate-person matching scope → resolved, §9 (Sebel-wide, not league-scoped).
- What a non-owning organizer may see about a cross-league candidate → resolved, §9's cross-league candidate-disclosure rule, §6, §18.
- Whether team names must be unique, and at what scope → resolved, §12 (unique within one league, trimmed/case-insensitive, not accent-insensitive, not global — flagged during Stage 2 pre-implementation review, now decided).

**Still genuinely open**, not designed or implemented by this specification, listed so they are not mistaken for silent gaps:

- The entire profile-claim/verification subsystem (§16): authenticated player accounts, `Verificación pendiente` state, organizer-approval UI/action, ID/manual escalation flow.
- Guardian-consent flow for minors (§15) — implementation itself, not the boundary, which is documented.
- The exact schema field name/type for the active/inactive flag on `jugadores` (§11) — architecture direction and product behavior are specified; only the concrete field name/type is left to the implementer.
- Wording/visual design of the "identity information incomplete" reminder (§14).
- **Migration strategy for the existing combined `nombre` field** (§8) — splitting into separate first/last fields requires either backfilling existing `nombre` values or keeping `nombre` as a derived/composed value for existing readers; which approach, and the exact mechanics, are not decided here.
- **Richer person-match UX** — the exact visual presentation of a candidate card (layout, ranking of multiple candidates, wording) beyond the fields it is and isn't allowed to disclose, which is now specified (§9's cross-league candidate-disclosure rule).
- **Exact additional identifier/privacy policy beyond date of birth** (§14) — whether anything further will ever be required or offered as identity evidence, and under what consent/privacy terms, is unresolved.
- Government-ID/document collection as a fallback verification mechanism (§16) — named as a future escalation path, not designed here.
- **Scouting/commercial data access policy** (§16, §K of the approved decisions): reliable `personaId`, clean history, duplicate avoidance, consent, and data quality "may later support professional/scouting use cases" — recorded strictly as forward context. **Not** an MVP requirement, and no scouting feature, dashboard, data product, or access policy is implied, approved, or designed by this document.
- Multi-sport profile presentation on a claimed public profile (§16) — deferred to the claim subsystem.

## 21. Implementation-impact inventory

Files/components/data functions likely involved if this specification is implemented later, without implementing them here:

- **`src/pantallas/NuevaLiga.jsx`** — replace team-count slider + auto-generated `equiposDemo`/placeholder-player bulk-insert (`:25,36-44,89-108`) with real team-name entry and no player creation at league-creation time.
- **`src/pantallas/Equipo.jsx`** — extend the existing "Plantilla" roster list (`:155-179`) with organizer-only (`esDuenoDe`) add/edit/remove controls; needs a new `useSesion`/`esDuenoDe` import (currently absent from this file).
- **`src/pantallas/Liga.jsx`** — `Jugadores` function (`:244-273`): remove the `.filter((s) => s.partidos > 0)` at `:246`.
- **`src/pantallas/Consola.jsx`** — `plantel` (`:71`, currently `const plantel = jugadores`): filter to active fichas only once the active/inactive flag exists.
- **`src/pantallas/Jugador.jsx`** — not modified by this work except incidentally if a name-field change affects rendering; `reclamar()`/`reclamado` (`:33-40,54-58`) explicitly untouched (§16).
- **`src/datos.js`** — likely a new write/mutation helper (alongside existing read hooks like `useEquipo`, `:218-250`) for add/edit/remove-player and the Sebel-wide candidate-matching lookup (§9), which — unlike everything else in this file — queries across `db.jugadores` unfiltered by `ligaId`, grouped by `personaId` where already set; `useEquipo`'s player query (`:225`) may need an active-only variant depending on how §11 is implemented. This lookup's return shape must implement §9's cross-league candidate-disclosure rule — the sensitive fields (exact DOB, and any future phone/WhatsApp/email/ID fields) should be usable by the matching logic but excluded from what's returned to the candidate-card UI, not merely hidden in rendering.
- **`src/db.js`** — a new additive Dexie schema version (following the existing `db.version(n).stores({...})` pattern already used for every prior change, e.g. `:37-41`) adding: the active/inactive field to `jugadores`; separate first-name/last-name fields (§8); optionally a `fechaNacimiento`/date-of-birth field. This is the schema-migration surface referenced by the "migration strategy for existing combined `nombre`" deferred item (§20).
- **`src/seed.js`** — not required to change for this specification, but implementer should confirm seed data remains a valid example of the corrected model (real team names, `personaId` always set — both already true in seed data today) if seed data is used for any future testing of this flow.
- **`src/lib/enlaces.js`** — no change anticipated; `urlEquipo`/`urlJugador` (`:58-61`) remain valid regardless of roster edits.

## 22. Validation plan

**Manual cases** (no automated test suite currently exists in this repository — confirmed by a repo-wide search for `*.test.*`/`*.spec.*` outside `node_modules`, which returns nothing):

- All twenty-seven acceptance criteria in §19, exercised by hand against the running app.
- Privacy check: as a non-owning organizer, confirm a surfaced cross-league candidate never renders exact DOB, phone/WhatsApp, email, ID/document, or account information, while an owning organizer's own roster view is unaffected (their own players' full entered data, including exact DOB, remains visible to them as normal).
- Sebel-wide matching specifically: create a candidate in one league/sport, then add/edit a player elsewhere in Sebel and confirm the candidate surfaces regardless of league or sport boundary.
- Visual check: newly added zero-game player appears correctly in both the Team page roster and the League `Jugadores` view, in the right position.
- Visual check: identity-incomplete reminder appears/clears correctly as DOB is added.
- Duplicate flow: trigger with an exact name match, an accent/case-variant match (if normalization is implemented per §9), and a genuinely different name (no false positive).
- Removal flow: confirm a removed player still renders correctly on every historical match page, their own player profile page, and league/team stats, while no longer appearing in `Consola.jsx`'s scoring roster for a new match.

**Automated-test cases that should eventually exist** (none exist today for any part of this app):

- Unit tests for the duplicate-name normalization/matching function (§9): exact match, case-insensitive match, accent-insensitive match, no match.
- Unit tests confirming every player-creation code path sets a non-null `personaId` (§17.1).
- Unit test confirming `estadisticaJugadores` (unchanged) still returns zero-game players in its output, to guard against `Liga.jsx`'s filter (§4.4) being reintroduced.
- Unit/integration test confirming a removed (inactive) ficha is excluded from `Consola.jsx`'s scoring roster but still resolves correctly in historical event/statistic lookups.
- Integration test for the full "Es la misma persona" path confirming the new ficha's `personaId` equals the matched player's `personaId`, and the "Es otra persona" path confirming they differ.
- Integration test confirming candidate matching finds a person across a league boundary and across a sport boundary (not only within the current league).
- Integration test confirming multiple existing fichas sharing one `personaId` are presented as a single candidate, not several.
- Integration test confirming a name-only edit (first/last) reruns matching, while a jersey-number/DOB-only edit does not.
- Integration test confirming a rejoin (remove, then re-add) produces a new ficha with the same `personaId` and leaves the original ficha inactive and unmodified.
- Unit test confirming the candidate-card serialization/view-model excludes exact DOB, phone/WhatsApp, email, and ID/document fields entirely (not merely hides them client-side), while still allowing the matching function itself to read those fields.

---

*This document was generated from repository inspection (`REQUISITOS.md`, `src/db.js`, `src/pantallas/NuevaLiga.jsx`, `src/pantallas/Equipo.jsx`, `src/pantallas/Liga.jsx`, `src/pantallas/Jugador.jsx`, `src/pantallas/Consola.jsx`, `src/lib/sesion.js`, `src/lib/marcador-calculo.js`, `src/seed.js`, `src/lib/enlaces.js`, `src/datos.js`) plus the approved product decisions it encodes. It does not itself constitute an amendment to `REQUISITOS.md`.*
