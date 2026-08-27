# Roster MVP Stage 3 — Product and Design Decisions

## Status

**Decision discovery complete. Implementation not authorized.**

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

### Decision 41 — Complete Stage 3B decisions before Stage 3A implementation

Before implementing Stage 3A:

1. finish the remaining Stage 3B product/UI decisions;
2. prepare a precise Stage 3B v0.app design brief;
3. do not spend v0.app credits yet.

After the Stage 3 destination is sufficiently defined, Stage 3A may be separately authorized, implemented, and validated.

Stage 3A must still PASS before Stage 3B implementation begins, as established by Decision 20.

This sequencing decision does not authorize implementation.

### Decision 42 — No roster search/filter for MVP

`Team → Plantilla` will not include roster search or filtering in Stage 3 MVP.

Keep the roster interface simple and compact.

Search/filtering may be reconsidered later if actual roster sizes or user behavior demonstrate a need.

### Decision 43 — Active Plantilla ordering

Active players in `Team → Plantilla` are ordered by **jersey/player number ascending**.

Example:

`#4`
`#7`
`#10`
`#23`

### Decision 44 — Legacy ficha without jersey number

Legacy or migrated records that lack a jersey/player number must render safely rather than breaking the roster UI.

Display the missing number as:

`—`

However, a valid available jersey/player number is required before such a ficha can be reactivated or otherwise returned to active roster use.

This exception exists for compatibility with legacy/migrated data and does not change the normal Add Player requirement that jersey/player number is required.

### Decision 45 — Compact statistics remain in Plantilla

`Team → Plantilla` should preserve useful current player statistics already provided by the Team page.

The row hierarchy should remain compact:

1. jersey/player number and player name are primary;
2. sport-appropriate current statistics are secondary.

Do not turn every player into a large card merely to display statistics.

A future visual redesign must not accidentally remove useful existing sporting information.

### Decision 46 — Minimal player action menus

For an active ficha, the organizer action menu contains:

* `Editar jugador`
* `Desactivar jugador`

For an inactive ficha under `Ver inactivos`, the organizer action menu contains:

* `Editar jugador`
* `Reactivar jugador`

Do not add additional roster-management actions for Stage 3 MVP unless separately approved.

### Decision 47 — Non-blocking success feedback

After a successful roster mutation, show short non-blocking feedback rather than another confirmation modal.

Examples:

* `Jugador añadido`
* `Jugador actualizado`
* `Jugador desactivado`
* `Jugador reactivado`

The exact visual implementation may be a toast or equivalent lightweight feedback mechanism.

### Decision 48 — Preserve form state after validation/save failure

If adding or editing a player fails:

* keep the Add/Edit modal or bottom sheet open;
* preserve the organizer's entered values;
* show the error at or near the relevant field when applicable.

The organizer must not have to re-enter the form after a validation or save error.

### Decision 49 — Jersey/player number representation

For MVP, jersey/player number accepts:

* `0`;
* positive whole numbers.

`00` is **not** treated as a distinct jersey/player number from `0` in MVP.

Do not introduce separate string semantics for `00` at this stage.

### Decision 50 — Jersey/player number range

For MVP, valid jersey/player numbers are:

`0–99`, inclusive.

The value must be a whole number.

The existing approved uniqueness rule still applies among active players of the same team.

### Decision 51 — Date-of-birth validity

Date of birth remains optional.

When supplied:

* it must be a valid date;
* it must not be later than the current date.

### Decision 52 — No minimum roster-registration age

Sebel imposes no minimum age at the roster-registration level for MVP.

Minors may be registered as players.

This does not resolve or weaken separate future requirements involving:

* guardian consent;
* profile claiming;
* expanded personal profiles;
* privacy;
* competition-specific eligibility.

### Decision 53 — Do not publicly expose minor age/DOB in Plantilla

`Team → Plantilla` must not publicly display a minor player's:

* age;
* exact date of birth.

When DOB has been collected, it remains non-public information and may be used only for appropriate authorized purposes such as:

* identity/disambiguation;
* future eligibility rules.

This decision concerns the Team → Plantilla public surface and does not by itself define the complete Sebel minors/privacy policy.

### Decision 54 — Do not publicly expose adult age/DOB in Plantilla by default

`Team → Plantilla` also does not publicly display an adult player's:

* age;
* exact date of birth.

The public Plantilla remains focused on sporting information:

* jersey/player number;
* player name;
* compact sport-appropriate statistics.

Age/DOB may be used on another Sebel surface only when that surface has a defined product purpose and appropriate access/privacy rules.

### Decision 55 — Authorized organizer may view/edit recorded DOB

When an authorized organizer opens `Editar jugador`, an existing recorded date of birth is visible and editable.

DOB remains:

* non-public;
* optional;
* subject to the validation rules established by Decision 51.

Public `Team → Plantilla` behavior from Decisions 53–54 remains unchanged.

### Decision 56 — Previously recorded DOB may be removed

Because DOB is optional, an authorized organizer may remove a previously recorded DOB and return the field to empty.

Entering DOB once does not make it permanently mandatory.

### Decision 57 — DOB edits never automatically change established identity

Editing, correcting, or removing DOB must never automatically:

* split an established identity;
* unlink a ficha from its established `personaId`;
* merge identities;
* otherwise change the established `personaId`.

Identity correction is a separate controlled process.

### Decision 58 — Identity unlink/split correction deferred

If fichas were previously linked to the same `personaId` incorrectly and are later discovered to represent different people, normal Stage 3 roster management must not provide a general identity unlink/split operation.

Correcting that situation may affect historical matches, statistics, and person history.

A dedicated future identity-correction workflow must handle this class of correction.

That future workflow may eventually be AI/agent-assisted, but consequential identity changes remain controlled and human-authorized.

### Decision 59 — General merge of established people deferred

If two established person identities were previously treated as different people but are later discovered to represent the same human, Stage 3 MVP does not provide a general `merge people` operation.

This does not prevent the approved Add/Edit duplicate-resolution flow from linking to an existing person when the identity decision is being made in that controlled workflow.

Repairing already-established separate identities belongs to the future dedicated identity-correction workflow.

### Decision 60 — Show all relevant duplicate candidates

If same-league duplicate detection returns multiple plausible candidates, Sebel must show all relevant candidates to the organizer.

Sebel must not silently choose the most likely candidate.

The organizer explicitly selects:

* the matching existing person; or
* `Es otra persona`.

Candidate presentation remains subject to the privacy/context rules already approved for duplicate resolution.

### Decision 61 — Same person already active on same team UX

If the organizer chooses `Es la misma persona`, but that person already has an active ficha on the same team/registration context:

* do not create another active ficha;
* explain that the player is already on this team's active roster;
* provide an appropriate `Ver / Editar jugador` path to the existing ficha.

This is not treated merely as an unexplained generic validation error.

### Decision 62 — Public visitors do not see management controls

A visitor who is not an authorized organizer sees the public active `Team → Plantilla` normally but does not see roster-management controls.

Do not show:

* `Añadir jugador`;
* Edit/Deactivate action menus;
* `Ver inactivos`.

For MVP, omit unauthorized management controls rather than rendering disabled controls.

### Decision 63 — Authoritative revalidation at mutation/save time

Roster mutations must revalidate authoritative business rules at save/execution time.

Client/UI validation may provide early UX feedback, but it is not authoritative.

For example, if another operation assigns the same jersey number before the current organizer saves, the shared domain/application operation must detect the new conflict and reject the mutation safely.

When a save-time conflict occurs:

* preserve the organizer's form data;
* keep the interaction recoverable;
* explain the relevant conflict.

This extends Decisions 29 and 30: authoritative roster rules belong in reusable shared operations, not solely in React validation.

### Decision 64 — Consecutive Add Player workflow

After successfully adding a player, the organizer may choose:

`Añadir otro jugador`

This provides an efficient path for entering several roster players consecutively.

The normal completion path may still return to the updated `Team → Plantilla`.

Do not require the organizer to navigate away and reopen the Add Player interaction for every player.

### Decision 65 — Añadir otro jugador starts fresh

When the organizer chooses `Añadir otro jugador`, open a fresh Add Player form.

Do not carry over the previous player's:

* `nombrePila`;
* `apellido1`;
* `apellido2`;
* DOB;
* jersey/player number.

This reduces accidental duplicate or stale player data during consecutive roster entry.

### Decision 66 — Each Add Player save is independent

Each successful `Añadir jugador` operation is an independently completed roster mutation.

After a player is successfully saved:

* that player is immediately registered;
* that player immediately becomes part of the active Plantilla;
* the save does not depend on completing any subsequent player entry.

`Añadir otro jugador` starts a new independent Add Player operation.

Consecutive player entry is **not** one batch transaction.

If an organizer successfully adds five players and stops while entering the sixth, the first five remain safely registered.

### Decision 67 — Responsive behavior during consecutive entry

During consecutive Add Player entry:

#### Desktop

The updated Plantilla may remain visible behind the Add Player modal.

After each successful addition, the roster reflected behind the modal should be capable of showing the newly added player.

#### Mobile

The bottom sheet remains the primary interaction focus.

Do not introduce unnecessary mobile UI complexity merely to keep the complete roster simultaneously visible while entering the next player.

Decision 66 remains authoritative: each successful addition is independently saved regardless of presentation.

### Decision 68 — Warn before discarding unsaved form changes

If the organizer attempts to close an Add/Edit Player modal or bottom sheet that contains unsaved changes, Sebel must warn before discarding those changes.

If the form is untouched/empty, it may close immediately without an unnecessary confirmation.

### Decision 69 — No Add/Edit form draft persistence for MVP

When warning about unsaved Add/Edit Player changes, provide two clear choices:

* `Seguir editando`
* `Descartar cambios`

Stage 3 MVP does not implement automatic draft saving or persistent player-form drafts.

Discarding changes explicitly removes the unsaved form state.

### Decision 70 — Clearly identify required and optional fields

The Add/Edit Player form must clearly distinguish required from optional fields.

Use the following field intent:

* `Nombre *` — required
* `Primer apellido *` — required
* `Segundo apellido` — optional
* `Número *` — required
* `Fecha de nacimiento` — optional

The exact visual treatment may be refined during UI design, but the required/optional distinction must be clear before submission.

### Decision 71 — Trim accidental surrounding whitespace

Before validation, duplicate comparison, and persistence, Sebel must trim leading and trailing whitespace from:

* `nombrePila`;
* `apellido1`;
* `apellido2`.

For example:

`"  Miguel "` → `"Miguel"`

This normalization prevents accidental whitespace from becoming part of the canonical stored value or interfering with duplicate detection.

### Decision 72 — Duplicate comparison is case-insensitive

Name-based duplicate candidate detection must be case-insensitive.

For example:

`miguel sam robles`

and:

`Miguel Sam Robles`

must be capable of producing the same normalized duplicate candidate.

Case-insensitive matching does not authorize automatic identity linking.

The organizer still resolves:

* same person; or
* different person.

### Decision 73 — Preserve canonical capitalization separately from matching normalization

Sebel must preserve the organizer-entered/canonical capitalization of player names for storage and display.

Do **not** lowercase the authoritative stored/display name merely to simplify matching.

Duplicate/identity candidate comparison uses a separate normalization process.

Conceptually:

Canonical/display:

`Miguel Sam Robles`

Comparison representation:

`miguel sam robles`

A second persisted lowercase copy is **not required by this product decision**. The implementation may normalize at comparison time unless a later performance/search requirement justifies persisted/indexed normalized fields.

### Decision 74 — Accent-insensitive duplicate candidate detection

For duplicate candidate detection, Sebel should normalize accent/diacritic differences.

For example:

`José Pérez`

and:

`Jose Perez`

may be treated as possible duplicate candidates.

The canonical stored/display name must preserve its actual accents.

Accent-insensitive matching is for candidate detection only and must never automatically merge or link identities.

The organizer remains responsible for the same-person/different-person decision.

### Decision 75 — Collapse repeated internal whitespace for duplicate comparison

Duplicate-name normalization must collapse accidental repeated internal whitespace.

For example:

`Miguel  Sam   Robles`

should compare using an equivalent normalized representation to:

`Miguel Sam Robles`

This is a comparison rule.

The canonical displayed/stored name should remain properly formatted rather than preserving accidental repeated whitespace.

### Decision 76 — Keep punctuation meaningful for MVP matching

Stage 3 MVP must **not broadly strip punctuation** from names during duplicate candidate normalization.

Apostrophes, hyphens, and similar punctuation may be meaningful parts of a person's name.

For example, do not automatically assume equivalence merely by removing punctuation from cases such as:

* `D'Angelo` vs `DAngelo`
* `María-José` vs `María José`

This deliberately avoids overly aggressive candidate matching and false positives.

More sophisticated fuzzy/name matching may be evaluated later.

### Decision 77 — Normalize before required-field validation

Name normalization required for input hygiene must occur before required-field validation.

A required field containing only whitespace is therefore empty and invalid after trimming.

For example:

`Nombre = "   "`
→ trim
→ `""`
→ required-field validation fails.

Apply this behavior to required player-name fields such as:

* `nombrePila`;
* `apellido1`.

Show the resulting validation problem at the relevant field.

### Decision 78 — Maximum name-field length

After trimming, each individual canonical player-name field has a maximum length of **50 characters**:

* `nombrePila` / `Nombre` — max 50;
* `apellido1` / `Primer apellido` — max 50;
* `apellido2` / `Segundo apellido` — max 50 when supplied.

Do not use a combined full-name limit as a replacement for these individual field limits.

### Decision 79 — No digits in player-name fields

Player-name fields must reject digits `0–9`.

For example, a normal player name such as:

`Miguel123`

is invalid.

Do not implement an unnecessarily restrictive ASCII-only `letters` validator.

Legitimate names may contain Unicode letters, accents/diacritics, spaces, and meaningful punctuation such as apostrophes or hyphens, subject to the other approved validation rules.

### Decision 80 — No arbitrary multi-character minimum

Required player-name fields must not impose an arbitrary minimum such as two or three characters.

After normalization/trimming, a legitimate single-letter name or surname may be valid.

For required fields:

* minimum: at least one valid character satisfying the approved name rules;
* maximum: 50 characters;
* digits: prohibited.

Decision 82 further defines that punctuation alone is not sufficient.

### Decision 81 — Segundo apellido may be empty

`apellido2` / `Segundo apellido` is optional.

It may be completely empty without producing a validation error.

If supplied, it follows the applicable approved rules for:

* trimming;
* maximum 50 characters;
* no digits;
* canonical spelling/capitalization preservation;
* duplicate-comparison normalization.

### Decision 82 — Name fields cannot contain punctuation only

When a player-name field is supplied, it must contain at least **one letter**.

Spaces and meaningful punctuation such as apostrophes and hyphens may accompany letters.

Values consisting only of punctuation/spacing are invalid.

Examples of invalid supplied values include:

* `---`
* `'`

This applies to required name fields and to optional `apellido2` when a value is supplied.

### Decision 83 — Hybrid field validation UX

The Add/Edit Player form uses hybrid validation behavior.

* Do not prematurely show errors on untouched fields.
* After the organizer has interacted with a field, obvious field-level validation problems may be shown when leaving the field or as appropriate during subsequent editing.
* On submit/save, validate the complete form again.
* Authoritative business rules must still be revalidated by the shared operation at mutation/save time as established by Decision 63.

UI validation improves feedback but is not the authoritative enforcement layer.

### Decision 84 — Explicit Add/Edit primary-action copy

Use operation-specific primary-action labels.

For Add Player:

`Añadir jugador`

For Edit Player:

`Guardar cambios`

Do not use generic `Guardar` for both operations.

### Decision 85 — Explicit lifecycle confirmation actions

Lifecycle confirmation dialogs/sheets use explicit action labels.

For deactivation:

* primary: `Desactivar jugador`
* secondary: `Cancelar`

For reactivation:

* primary: `Reactivar jugador`
* secondary: `Cancelar`

Avoid generic `Confirmar` as the primary lifecycle action.

### Decision 86 — Zero-player Plantilla empty state

When a team has zero active players, `Team → Plantilla` must show a purposeful empty state rather than blank roster space.

Use the product intent:

**Plantilla**

`Todavía no hay jugadores en este equipo.`

For an authorized organizer, provide:

`Añadir primer jugador`

For a public/unauthorized visitor, show the informative empty state but no roster-management action.

This must be represented in the later Stage 3B v0.app design brief.

### Decision 87 — Añadir jugador belongs with the Plantilla header

When the active Plantilla already contains players, the organizer's:

`+ Añadir jugador`

action belongs in or directly alongside the Plantilla section header.

Do not represent Add Player as another large player/roster card.

Mobile may adapt placement according to available width, but the action must remain clearly associated with Plantilla.

### Decision 88 — Compact row action menu

For an authorized organizer, each compact active-player row uses a `⋯` action menu at the end of the row.

The menu exposes the already-approved active-ficha actions:

* `Editar jugador`
* `Desactivar jugador`

Do not permanently display these management actions as large buttons on every roster row.

Public/unauthorized visitors do not see the action menu, consistent with Decision 62.

### Decision 89 — Ver inactivos remains inside Team → Plantilla

For Stage 3 MVP, `Ver inactivos` is not a separate route/page.

It is a secondary roster-management state within:

`Team → Plantilla`

Conceptual navigation:

`Plantilla → Ver inactivos → inactive roster → Volver a Plantilla`

Keep active and inactive roster management within the Team/Plantilla context.

### Decision 90 — Hide Ver inactivos when none exist

Show `Ver inactivos` only when the team has at least one inactive ficha.

If the inactive count is zero, omit the option.

Do not create an unnecessary empty management destination.

### Decision 91 — Inactive roster ordering

Within `Ver inactivos`, order inactive fichas by **most recently deactivated first**.

This requires enough lifecycle metadata to determine the latest deactivation time.

The ordering requirement therefore establishes a concrete product need for deactivation timestamp data.

### Decision 92 — Latest deactivation timestamp

If a ficha is:

`active → deactivated → reactivated → deactivated again`

the current lifecycle metadata must record the **latest deactivation timestamp**.

Stage 3 MVP does not require a complete lifecycle-event history solely to derive this ordering.

Current-state lifecycle data must be sufficient to support Decision 91.

### Decision 93 — Event-sourcing boundary for Stage 3

Stage 3 roster management uses **current-state persistence plus explicit lifecycle/audit events where useful**.

Stage 3 does **not** adopt full event sourcing for roster management.

The authoritative current roster/ficha state remains directly persisted.

Design roster operations so they can emit explicit domain/audit events without requiring replay of the complete event stream to reconstruct current roster state.

Full event sourcing remains a deliberate future architecture evaluation for domains where immutable history/replay may provide stronger value, especially:

* match play-by-play / scoring events;
* later identity-correction operations such as consequential merge/split/link repair.

Do not interpret this decision as authorizing full event sourcing in Stage 3.

### Decision 94 — Minimal roster lifecycle audit metadata

Stage 3 roster lifecycle/audit records must capture at least:

* action type;
* ficha ID;
* timestamp;
* actor/organizer ID when available.

Initial action types include:

* `created`
* `edited`
* `deactivated`
* `reactivated`

Richer before/after snapshots and full event-sourcing semantics are not required for Stage 3 MVP.

### Decision 95 — Audit every successful organizer ficha edit

Every successful organizer edit to a ficha should create an `edited` audit entry.

Do not restrict edit auditing only to changes considered identity-sensitive or lifecycle-sensitive.

This includes ordinary successful corrections such as jersey/player-number changes.

Failed validation attempts do not represent successful ficha edits.

### Decision 96 — Audit trail is internal/system-only for MVP

The roster audit trail is internal/system-only in Stage 3 MVP.

Capture the approved audit information, but do not add an organizer-facing audit-history UI in this stage.

A future product requirement may expose appropriate audit information later.

### Decision 97 — One sports-first Plantilla design for public and organizer states

`Team → Plantilla` uses fundamentally the same sports-first roster design for both public visitors and authorized organizers.

Do not create a separate admin-dashboard-style roster UI for organizers.

Public visitors see the roster's sporting information.

Authorized organizers see the same roster experience with management capabilities layered onto it.

Conceptually:

Public:

* jersey/player number;
* player name;
* compact sport-appropriate statistics.

Organizer:

* same sports-first roster;
* `Añadir jugador`;
* compact `⋯` row actions;
* `Ver inactivos` when applicable.

This provides one coherent responsive design target for Stage 3B and the later v0.app design brief.

### Decision 98 — Player name remains navigational

The player's name in `Team → Plantilla` remains clickable/tappable and navigates to Sebel's existing `Jugador` player/profile surface when the route exists.

Roster management must not replace the normal sports/discovery navigation behavior.

Organizer management remains separate through the approved `⋯` action menu.

### Decision 99 — Active-player row visual hierarchy

The active-player row uses a sports-first visual hierarchy.

Priority:

1. player name — primary identity;
2. jersey/player number — prominent and quickly scannable;
3. compact sport-appropriate statistics — secondary;
4. organizer `⋯` management affordance — available only when authorized.

The exact typography, spacing, sizing, and CSS are not decided here.

This decision establishes visual information hierarchy only.

### Decision 100 — Inactive rows are subdued, not deleted-looking

Inactive fichas under `Ver inactivos` remain recognizable historical roster records.

Use a compact row design that is visually subdued compared with active players.

Do **not** use strikethrough or other presentation implying that the player/history was deleted.

Retain useful identification such as:

* player name;
* last jersey/player number.

Lifecycle context such as `Inactivo` and deactivation date may appear as secondary information.

### Decision 101 — Use absolute deactivation dates

When showing deactivation information in `Ver inactivos`, use a stable human-readable absolute date rather than relative time.

Example:

`Inactivo · Desactivado 20 ago 2026`

Avoid relying on relative labels such as:

`hace 7 días`

for this lifecycle context.

The exact locale/date-format implementation may follow Sebel's existing formatting conventions.

### Decision 102 — Reactivation returns to active Plantilla

After successful reactivation:

* return the organizer to the active `Team → Plantilla`;
* immediately show the reactivated player in the active roster;
* show lightweight success feedback such as `Jugador reactivado`.

Do not leave the organizer stranded in `Ver inactivos` after a successful reactivation.

### Decision 103 — Deactivation remains on active Plantilla

After successful deactivation:

* remain on the active `Team → Plantilla`;
* immediately remove the deactivated ficha from the active roster display;
* show lightweight success feedback such as `Jugador desactivado`;
* preserve the ficha under `Ver inactivos`.

Do not automatically navigate the organizer into the inactive roster after deactivation.

### Decision 104 — Edit reuses Add Player responsive form pattern

`Editar jugador` reuses the same responsive interaction/component pattern as `Añadir jugador`.

Use:

* desktop: modal;
* mobile: bottom sheet.

Edit mode opens with the current values prefilled.

The underlying form structure should be shared where practical.

Primary actions remain:

Add:
`Añadir jugador`

Edit:
`Guardar cambios`

This extends Decisions 23, 24, and 84.

### Decision 105 — Responsive lifecycle confirmation UI

Deactivation and reactivation confirmations use Sebel's responsive confirmation interaction rather than browser-native confirmation dialogs.

Use:

* desktop: confirmation modal;
* mobile: confirmation bottom sheet.

Use the explicit lifecycle action labels established by Decision 85.

For deactivation, the confirmation must explain that:

* the ficha/player will no longer be available for future matches for that team;
* historical matches and statistics remain preserved.

Do not use browser-native `confirm()` as the intended Stage 3 UX.

### Decision 106 — Show the full active Plantilla

For Stage 3 MVP, Team → Plantilla shows the full active roster.

Do not introduce:

- pagination;
- virtualization;
- Ver más / Load more behavior

for the active roster in this stage.

The approved compact-row design should make the complete roster practical to scan.

If future real-world roster sizes or performance demonstrate a need, roster pagination/virtualization may be evaluated later.

### Decision 107 — Mobile uses compact roster rows, not large player cards

On mobile, Plantilla remains a compact roster/list experience.

Do not turn every player into a large individual card.

The exact responsive composition may be explored during design, but it must prioritize:

- efficient vertical use;
- fast roster scanning;
- player identity;
- jersey/player number;
- secondary statistics;
- organizer action affordance when authorized.

This extends the sports-first and compact-row direction already established.

### Decision 108 — Desktop remains a sports roster, not an admin table

On desktop, Plantilla also remains visually a sports roster/list.

Do not redesign it as a traditional spreadsheet/admin table with prominent column headers such as:

Número | Jugador | PTS | AST | ...

Implementation may use grid/alignment techniques internally, but the visible product experience must remain sports-first rather than dashboard/admin-table-first.

### Decision 109 — Reuse existing sport-specific statistics

Stage 3 roster management does not define a new universal player-statistics model.

Plantilla should preserve/reuse the sport-appropriate player statistics Sebel already provides.

Statistics remain secondary to:

- player identity;
- jersey/player number.

The Stage 3 implementation and v0 design must not invent fictional/new metrics merely to fill the roster UI.

Any future statistics redesign is separate work.

### Decision 110 — v0 brief must cover the responsive system and important states

The Stage 3B v0.app design brief should request a coherent responsive Plantilla system covering both mobile and desktop.

At minimum, the design exploration must account for:

- active Plantilla with players;
- zero-player empty state;
- authorized organizer controls;
- Add Player interaction;
- Edit Player interaction;
- inactive roster / Ver inactivos;
- deactivate confirmation;
- reactivate confirmation.

The purpose is to use scarce v0 design effort efficiently by evaluating the important responsive states together rather than discovering them piecemeal across multiple requests.

### Decision 111 — v0 must not redesign the whole Team page

The Stage 3B v0.app task is scoped to:

Team → Plantilla

and its roster-management interactions.

v0 must not treat this as authorization to redesign the complete Team page.

The Plantilla design must fit within Sebel's existing Team experience and established product/visual direction.

Broader Team-page redesign remains outside this Stage 3 task unless separately authorized.

### Decision 112 — v0 is a design reference, not implementation authority

v0 acts as a design/reference agent for Stage 3B.

It may propose or refine:

- layout;
- responsive composition;
- information hierarchy;
- interaction presentation;
- modal/bottom-sheet design;
- visual polish.

v0 must not override or invent authoritative Sebel behavior.

The following remain authoritative over v0 output:

- repository requirements/specifications;
- existing Sebel routes and real data;
- approved Stage 3 decisions;
- roster/identity business rules;
- permissions;
- lifecycle rules;
- identity-linking rules;
- architecture boundaries.

Generated v0 code is not automatically authoritative production code.

Useful visual/design ideas may later be deliberately ported into the real Sebel implementation by the execution agent.

### Decision 113 — Include duplicate-candidate identity resolution in the v0 design scope

The Stage 3B v0.app design brief must include the approved duplicate-candidate / identity-resolution interaction as part of the responsive Add/Edit Player interaction system.

This is a presentation/design requirement only.

v0 may explore how the interaction is presented on:

- desktop;
- mobile;
- modal/bottom-sheet flows;
- candidate comparison/selection states.

The authoritative identity behavior remains defined by the existing Stage 3 decisions.

v0 must not invent or change:

- duplicate-matching rules;
- matching algorithms;
- automatic identity merging;
- autonomous same-person decisions;
- candidate disclosure/privacy rules;
- persona-linking rules;
- same-person/different-person authorization;
- additional personal data to display.

The design must use only the candidate context and organizer-authorized choices already approved in the Stage 3 decision artifact.

The organizer remains the authority for the same-person / different-person resolution established by the existing decisions.

This extends Decision 110's minimum v0 state set.

---

## Stage 3 decision-discovery closure

Decision discovery closed at Decision 113.

A read-only readiness/gap audit was performed after Decisions 1–112.

The audit found no blocking gaps.

Stage 3A implementation-definition readiness was READY.

Stage 3B architecture readiness was READY.

Stage 3B v0-brief readiness was READY after resolving the duplicate-resolution design-scope question through Decision 113.

The minimum-necessary-decisions principle was used to stop further speculative decision creation.

Stage 3A and Stage 3B implementation remain unauthorized.

Stage 3B implementation remains sequenced after a successful Stage 3A implementation/validation checkpoint.

This closure note does not represent the readiness audit itself as implementation validation.

---

## Architecture clarification — audit events are not current state

Keep the distinction explicit:

**Current ficha/roster state**
→ remains directly persisted and authoritative for normal application reads.

**Lifecycle/audit records**
→ provide traceability of successful roster operations.

**Full event sourcing**
→ is not being adopted for Stage 3 roster management.

The architecture should avoid coupling React components directly to audit persistence. Roster operations remain responsible for authoritative mutation behavior under Decisions 29, 30, and 63.

---

## Normalization boundary

Decisions 71–76 establish a deliberate distinction:

**Canonical player data**
→ preserves the person's human-readable name.

**Duplicate candidate normalization**
→ may normalize case, accents/diacritics, and accidental whitespace.

**Identity decision**
→ remains human-authorized.

Normalization must **never itself merge identities**.

---

## Product-level finding discovered during Stage 3 — Youth participation and monetization

**This is a product-level finding, not a numbered Stage 3 decision, and does not authorize implementation.**

Sebel's emerging product/business principle is that **children and their personal data must not become the product being monetized**.

At the same time, this principle does **not** require every service surrounding youth competition to be free.

Youth/player access and organizer/business services may have separate economic models.

Potential youth participation subsidies/free access can support:

* sport and health;
* community participation;
* family engagement;
* Sebel awareness and legitimate traffic.

However:

* do not hard-code an age such as 7 or 9 as the permanent business boundary;
* the qualifying youth threshold must eventually be configurable;
* sponsorship/subsidy may be explored but must not be assumed to exist, especially for early leagues;
* Sebel's economic sustainability must still be considered if youth usage grows substantially.

Keep these concepts architecturally distinct:

* age/privacy rules;
* competition eligibility rules;
* pricing/subsidy rules.

The exact youth age threshold, pricing model, subsidy model, sponsor model, legal requirements, and full minors policy remain **future product/business work**.

This product-level finding must not be interpreted as Stage 3 implementation authorization.

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
