# Roster MVP Stage 3 — Product and Design Decisions

## Status

**Decision discovery in progress. Implementation not authorized.**

This document is the durable checkpoint for approved Roster MVP Stage 3 product/design decisions.

Stage 3 implementation must not begin until the Master Tutor / Orchestrator explicitly closes decision discovery and authorizes implementation.

## Prior checkpoints

* Stage 1 foundation:
  `8efe516 — implement roster data foundation`
  Status: completed / committed.

* Stage 2 team-name decision:
  `c3f1fee — define roster team name uniqueness`
  Status: completed / committed.

* Stage 2 implementation:
  `b9aa9c9 — implement roster MVP stage 2`
  Status: PASS / completed / committed.

## Stage 3 working scope

Stage 3 focuses on **team roster management**.

The intended organizer entry point is:

`Team page → Plantilla → Añadir jugador`

Stage 3 must preserve the distinction between:

* `personaId`: the Sebel-wide identity of one real human.
* `ficha`: one participation/registration of that person with a team/competition context.

Cross-league Sebel-wide identity matching is not yet authorized for Stage 3 unless explicitly added later.

---

## Approved decisions

### Decision 1 — Minimum player information

To add a player, the organizer must provide:

* `nombre` — required
* `apellido1` — required
* player / jersey number — required

Date of birth and `apellido2` are handled by later decisions below.

### Decision 2 — Jersey-number uniqueness

Player / jersey number must be unique among the **active players of the same team**.

An inactive historical ficha does not permanently reserve the number.

A number used by an inactive former player may later be reused by another active player.

### Decision 3 — Date of birth

Date of birth is shown in the Add Player flow but is **optional**.

Missing date of birth must not block roster registration.

### Decision 4 — Player-name model

Store player name components separately as:

* `nombre` — required
* `apellido1` — required
* `apellido2` — optional

Do not flatten these fields into one authoritative full-name field.

This model is intended to support common LATAM naming patterns while still allowing people who use only one surname.

### Decision 5 — Exact duplicate-name warning

If a new player has an exact normalized match on:

`nombre + apellido1 + apellido2`

Sebel must **not automatically block or merge** the new entry.

The organizer must be warned and asked to decide whether the candidate is:

* the same person, or
* a different person.

Name equality alone is not sufficient proof of identity.

### Decision 6 — Same person already active on same team

If the organizer confirms that the entered player is the **same person** as an existing active player on the same team:

* do not create a duplicate active ficha;
* direct the organizer to the existing ficha;
* allow the organizer to edit/correct that existing ficha if needed.

One real person must not have duplicate active fichas for the same team/registration context.

### Decision 7 — Duplicate checking during name edits

If the organizer edits any of:

* `nombre`
* `apellido1`
* `apellido2`

Sebel reruns the same name-based duplicate check.

If the resulting name matches another person, the organizer must resolve:

* same person, or
* different person.

Editing only jersey number or date of birth does not trigger the name-based duplicate check.

### Decision 8 — Removing a player

Removing a player means **deactivating the ficha**, not deleting it.

After deactivation:

* the player is no longer part of the current active roster;
* the player cannot be selected for future matches through that ficha;
* historical matches remain;
* historical statistics remain;
* historical team/person relationships remain;
* `personaId` remains intact;
* the old jersey number becomes available for future active players.

Historical fichas must not be physically deleted.

### Decision 9 — Same person across multiple leagues and teams

The same person may participate in multiple leagues concurrently.

One real human uses the same `personaId` across those participations.

Each team/competition participation has its own ficha.

Example:

* Liga A → Equipo A → active ficha
* Liga B → Equipo X → active ficha
* Liga C → Equipo Z → active ficha

All may point to the same `personaId`.

Leaving one team deactivates only that ficha and must not deactivate the person's other active fichas.

The person's page should ultimately be capable of showing the person's combined sporting history across leagues, teams, seasons, and statistics.

### Decision 10 — Multi-sport identity

One real human keeps the same `personaId` across sports.

Example:

* basketball ficha(s)
* futsal ficha(s)

These participations remain separate, with sport-specific statistics, under the same person identity.

### Decision 11 — Roster-size limit

For MVP, Sebel has **no Sebel-wide maximum number of active players per team**.

Competition-specific roster limits may be introduced later as configurable rules if required.

### Decision 12 — Incomplete identity information

A player may be added even if identity information is incomplete.

Specifically:

* missing `apellido2` does not block registration;
* missing date of birth does not block registration.

Sebel may request stronger identity evidence later for identity matching, disambiguation, or profile-claim flows.

### Decision 13 — Roster-management permissions

For MVP, roster mutations are organizer-controlled.

The authorized league organizer/admin may:

* add players;
* edit players/fichas;
* deactivate players/fichas.

Visitors may view appropriate public roster information but may not modify the roster.

Delegated team-manager/coach permissions are outside this Stage 3 scope unless explicitly added later.

### Decision 14 — Identity-matching boundary for Stage 3

Stage 3 identity matching is limited to the **current league**.

Do not yet implement Sebel-wide cross-league person matching or candidate suggestions across unrelated leagues.

Sebel-wide identity resolution belongs to a later identity-focused stage unless the Master Tutor explicitly changes this boundary.

### Decision 15 — Team page roster behavior

The Team page must gain a proper **Plantilla** section.

The Team page currently does not provide the team's complete roster.

The intended behavior is:

* public viewers can see the team's active roster;
* authorized organizers get roster-management actions;
* inactive former players do not appear as members of the current active roster;
* historical data for inactive players remains preserved elsewhere.

The existing League → Jugadores view remains distinct and must not be replaced by the Team → Plantilla view.

### Decision 16 — League → Jugadores includes zero-stat active players

`Liga → Jugadores` must include all players with an active ficha in that league, including players with:

* zero games;
* zero points/goals;
* zero current statistics.

Players with statistics may still be ranked ahead of players without statistics.

Being officially registered in an active roster is sufficient to appear in the active league-player view.

### Decision 17 — Inactive players and historical league statistics

When a ficha becomes inactive:

* the player should no longer appear as part of the current active-player roster/list;
* historical match events must remain;
* historical statistics must remain;
* prior performance must not disappear from historical rankings/results/statistical history.

Deactivation must never rewrite sporting history.

### Decision 18 — Primary organizer entry point

The primary Stage 3 roster-management entry point is:

`Team page → Plantilla → Añadir jugador`

Ongoing roster management must not be moved back into `NuevaLiga`.

The Team page is the natural context for adding, editing, and deactivating that team's players.

### Decision 19 — Evolve canonical player-name model

The previously implemented Stage 1 player-name model:

`nombrePila + apellido`

will evolve to:

* `nombrePila` — required
* `apellido1` — required
* `apellido2` — optional

This is an intentional evolution of the Stage 1 data model based on the newer Stage 3 product requirement.

Existing records must eventually migrate as follows:

* existing `nombrePila` remains `nombrePila`;
* existing `apellido` becomes `apellido1`;
* existing records receive an empty/missing `apellido2`;
* existing `personaId` values must be preserved;
* migration must not recreate people or change person identity merely because the name schema changes.

Example:

Before:

`nombrePila: "Miguel"`
`apellido: "Sam"`

After migration:

`nombrePila: "Miguel"`
`apellido1: "Sam"`
`apellido2: ""`

A newly entered player may then contain:

`nombrePila: "Miguel"`
`apellido1: "Sam"`
`apellido2: "Robles"`

---

## Known implementation reconciliation required

Decisions 1, 4, and 19 intentionally differ from the currently committed Stage 1 implementation and the earlier Stage 1 specification/plan.

Current committed implementation (`8efe516`, and `docs/roster/ROSTER_MVP_SPEC.md` / `docs/roster/ROSTER_MVP_PLAN.md` as written) uses:

`nombrePila + apellido`

Stage 3's approved target model is:

`nombrePila + apellido1 + optional apellido2`

This inconsistency is now **product-decided but not implementation-resolved**.

It requires an explicit schema/data migration and corresponding application updates before Stage 3 Add Player can safely be implemented against the new model.

The prior Stage 1 specification and plan documents are not modified by this checkpoint — this section records the reconciliation still owed, rather than rewriting those documents in place.

### Decision 20 — Stage 3 implementation sequencing

Stage 3 is divided into **Stage 3A — Name-model foundation** and **Stage 3B — Team roster management**.

Stage 3A evolves `nombrePila + apellido` to `nombrePila + apellido1 + optional apellido2`, including the required schema/data migration and corresponding application compatibility work.

Existing `personaId` values must be preserved.

Stage 3A must be implemented, tested, and validated independently.

Stage 3B must not begin until Stage 3A passes its validation checkpoint.

Stage 3B covers the Team → Plantilla roster-management functionality defined by the approved Stage 3 decisions.

This decision records sequencing only. Implementation remains unauthorized.

### Decision 21 — Compact Plantilla rows

`Team → Plantilla` should use compact roster rows rather than large cards.

Each row should show at minimum:

* jersey/player number;
* full player name.

The player name should link to the existing player/person page when the route exists.

Organizer-only actions should remain compact and must not dominate each row with large permanent buttons.

This is especially important for mobile efficiency and for keeping the Team page app-like rather than looking like an administration form.

### Decision 22 — Visible zero-roster state

A team with zero active players must still show the `Plantilla` section.

For public viewers, show a clear empty state indicating that the team has no registered players yet.

For an authorized organizer, the same empty state should also expose the primary action:

`+ Añadir jugador`

Do not hide `Plantilla` merely because the roster is empty.

### Decision 23 — Add Player interaction

`Añadir jugador` should stay in the Team → Plantilla context.

Use:

* **mobile:** bottom sheet;
* **desktop:** modal.

Do not create a separate Add Player page for MVP.

The Add Player form contains:

* `nombrePila` / Nombre — required;
* `apellido1` — required;
* `apellido2` — optional;
* player / jersey number — required;
* date of birth — optional.

After successful creation, return immediately to the updated Plantilla.

### Decision 24 — Reuse Add/Edit player form

`Editar jugador` should reuse the same form/component as `Añadir jugador`.

Edit mode opens the form prefilled with the player's current values.

The organizer may edit:

* `nombrePila`;
* `apellido1`;
* `apellido2`;
* player / jersey number;
* date of birth.

Existing approved validation rules continue to apply:

* changing a name field reruns duplicate-name detection;
* changing only player number or date of birth does not trigger the name-based duplicate check;
* active-team jersey-number uniqueness must still be enforced.

### Decision 25 — Deactivate, not delete

The roster UI must use:

`Desactivar jugador`

and must not expose a destructive:

`Eliminar jugador`

action for historical fichas.

Deactivation requires explicit confirmation.

The confirmation must clearly explain that:

* the player will no longer be available for future matches for that team;
* previous matches and statistics will remain preserved.

This is consistent with the approved ficha lifecycle: historical records are preserved rather than physically deleted.

### Decision 26 — Duplicate-name resolution is an identity decision

An exact normalized duplicate-name match must not be presented merely as a generic form-validation error.

Instead, Sebel should present an explicit identity-resolution interaction such as:

`Encontramos un jugador con el mismo nombre`

The organizer must choose:

* **Es la misma persona**
* **Es otra persona**

If the organizer chooses **same person**, reuse the existing `personaId`, subject to the rule that the same person cannot receive a duplicate active ficha for the same team/registration context.

If the organizer chooses **different person**, create a distinct `personaId` despite the identical name.

### Decision 27 — Context shown during duplicate resolution

During same-league duplicate resolution, Sebel may show useful sporting/disambiguation context available to that organizer, including:

* team;
* jersey/player number;
* age, when date of birth is available.

Do **not** expose the exact date of birth in the duplicate-resolution UI.

The purpose of this context is to help the organizer distinguish candidates without unnecessarily exposing sensitive identity data.

### Decision 28 — Future AI assistance remains human-authorized

Sebel may later provide AI/agent assistance during identity resolution.

A future agent may:

* analyze available evidence;
* compare candidates;
* explain its recommendation;
* guide the organizer;
* recommend whether a candidate is probably the same person or a different person.

The AI/agent must **not autonomously merge or link person identities**.

The organizer remains responsible for the final same-person / different-person confirmation.

After human confirmation, a deterministic Sebel domain/application operation performs the identity action.

This decision is intended to keep Stage 3 compatible with a future AI-first / agent-assisted workflow without adding AI implementation to the current Stage 3 scope.

### Decision 29 — Roster/identity operations separate from React UI

Stage 3 roster and identity business operations must be implemented outside React UI components.

React components may invoke those operations and display results/errors, but must not own the authoritative rules for:

* identity linking;
* duplicate handling;
* jersey-number uniqueness;
* ficha lifecycle;
* roster mutations.

These operations should be reusable by:

* current React UI flows;
* future non-UI callers;
* future AI/agent workflows.

This is an architectural decision only.

**Stage 3 implementation remains unauthorized.**

### Decision 30 — Explicit active-roster and match-selection reads

Active/inactive ficha filtering must be implemented in explicit shared data/application operations outside React UI components.

Do **not** place authoritative `activoDe()` filtering logic directly inside React screens such as:

* `Equipo.jsx`
* `Consola.jsx`

Do **not** globally hide inactive fichas inside generic reads that may also serve historical/statistical use cases.

Instead, Stage 3B should expose intent-specific shared reads/operations for cases such as:

* active team roster;
* players selectable for future matches;
* historical/person context that intentionally includes inactive fichas.

Conceptually, the architecture should support operations similar to:

* active roster for a team;
* match-selectable players for a team;
* historical/full ficha context for a person.

Exact function names are not decided by this product checkpoint.

The important rule is:

* current roster views use active-only reads;
* future match selection uses active-only reads;
* historical/statistical reads may include inactive fichas;
* React components consume those results rather than owning the lifecycle rule;
* future non-UI callers, including AI/agent workflows, should be able to reuse the same shared operations.

This decision extends Decision 29.

Stage 3 implementation remains unauthorized.

### Decision 31 — Reactivate an existing inactive ficha

An authorized organizer may reactivate an existing inactive ficha instead of creating a new ficha for that same team registration.

Reactivation must:

* preserve the existing ficha;
* preserve its history;
* preserve its `personaId`;
* restore the ficha to the active roster only after current active-roster validations pass.

Do not create a replacement ficha merely because the existing ficha was previously inactive.

### Decision 32 — Jersey-number conflict during reactivation

If an inactive ficha's previous jersey/player number is currently assigned to another active player on the same team, reactivation must be blocked until the organizer selects an available number.

Sebel must not automatically change:

* the reactivating player's number; or
* the currently active player's number.

The organizer resolves the conflict explicitly.

### Decision 33 — Organizer access to inactive fichas

The authorized organizer should have a secondary roster-management option:

`Team → Plantilla → Ver inactivos`

The normal Plantilla continues to show the active roster.

`Ver inactivos` provides access to the team's inactive historical fichas and allows appropriate management actions such as reactivation.

Do not mix inactive fichas into the normal active Plantilla list.

### Decision 34 — Ver inactivos is organizer-only

For MVP, `Plantilla → Ver inactivos` is an organizer-management view and is not exposed as a separate former-player roster to ordinary visitors.

Former players' legitimate sporting history may still appear through appropriate public historical surfaces such as:

* previous matches;
* statistics;
* player/person history.

### Decision 35 — Editing an inactive ficha

An authorized organizer may edit an inactive ficha to correct historical or identity information.

Editing an inactive ficha must **not reactivate it automatically**.

Reactivation remains a separate, explicit operation.

### Decision 36 — Duplicate checking when editing inactive fichas

If an organizer edits the name fields of an inactive ficha, the same approved same-league duplicate/identity-resolution rules apply.

Inactive status does not bypass identity integrity.

A resulting duplicate-name candidate must use the approved:

* same person; or
* different person

resolution workflow.

### Decision 37 — No normal permanent deletion of inactive fichas

An inactive ficha cannot be permanently deleted through the normal organizer workflow.

Once a ficha exists as a sporting registration, Sebel preserves it for history and identity integrity.

Normal lifecycle operations are:

* correction/edit;
* deactivate;
* reactivate.

Physical deletion is not part of the normal organizer workflow.

### Decision 38 — Zero-history fichas also use deactivation

The no-hard-delete rule also applies when a ficha was created by mistake and has:

* zero matches;
* zero statistics.

For MVP, Sebel still uses deactivation rather than physical deletion.

This deliberately keeps one consistent lifecycle:

`create → active → deactivate ⇄ reactivate`

Normal hard-delete is not part of this lifecycle.

### Decision 39 — No mandatory deactivation reason for MVP

The organizer is not required to provide a reason when deactivating a ficha.

Do not introduce a required reason taxonomy such as:

* left team;
* injury;
* duplicate;
* mistake;
* other.

This avoids unnecessary MVP friction.

Basic audit information such as who performed the lifecycle action and when may be preserved by the implementation architecture.

Structured deactivation reasons remain future scope.

### Decision 40 — Reactivation confirmation

Reactivating an inactive ficha requires a lightweight explicit confirmation.

The confirmation should identify at least:

* player;
* team;
* jersey/player number that will become active.

If the previous number conflicts with an active teammate, Decision 32 must be resolved before reactivation can complete.

Reactivation must remain an explicit organizer action and must not occur implicitly through editing.

---

## Deferred / not yet decided

The following are explicitly not resolved by this checkpoint unless added later:

* Sebel-wide cross-league identity-matching UX.
* Privacy rules for cross-organizer identity candidate disclosure.
* Profile-claim behavior.
* Guardian-consent flow for minors.
* Delegated coach/team-manager permissions.
* Competition-specific roster-size limits.
* Full visual redesign of the Team or NuevaLiga pages.
* Final v0.app visual brief for Stage 3.
* Exact implementation architecture/files for Stage 3.
* Stage 3 implementation authorization.

## UI direction note

A focused v0.app design exercise may be used after Stage 3 product decisions are sufficiently complete.

Any v0 brief must be based on Sebel's real behavior and must not invent product features.

Likely Stage 3 UI surfaces include:

* Team → Plantilla section
* zero-player roster state
* active roster rows
* organizer-only `Añadir jugador`
* add/edit-player flow
* duplicate-name warning / same-person-vs-different-person decision
* deactivate-player action
* responsive desktop and mobile behavior
* light, app-like PWA direction

Real Sebel data, behavior, routes, permissions, and identity rules remain authoritative over v0 mock behavior.

## Recovery rule

A replacement Master Tutor must be able to recover these decisions from this document without depending on previous ChatGPT conversation history.

If repository implementation, another durable artifact, and this decision document disagree, report the inconsistency before continuing.
