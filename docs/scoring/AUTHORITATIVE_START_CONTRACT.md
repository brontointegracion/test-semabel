# SEBEL — Authoritative Initial-Start Contract

Document type: architecture and contract specification (documentation only).

This document defines the narrow contract that the shared server must satisfy before the initial Start of a match can be authoritative. It contains no code, no schema, no service selection, no pricing claim and no provisioning step. It does not authorize any implementation, including the disconnected snapshot reader (S6a).

## 0. How to read this document

Every statement carries one of these status labels. A statement without a label is explanatory text, not a requirement.

| Label | Meaning |
|---|---|
| **[A]** | Previously approved requirement **supplied by the tutor** in task instructions. It is not independently verifiable in the repository documents reviewed. |
| **[R]** | Repository contract, with a verified file and line reference (lines as read on the baseline below). |
| **[E]** | Behavior implemented in the S5a and S5b engine (`src/lib/motor/`), with its file and line. See section 1 for the evidence limits. |
| **[P]** | Proposed technical guarantee that **requires review**. It is not approved until reviewed. |
| **[O]** | Open infrastructure or implementation choice. It is deliberately not decided here. |

Baseline when this document was written: branch `feat/score-referee-interaction-shell`, HEAD `ddfbb20346516829b630bae37a8156953d78358d`, with uncommitted working-tree changes. Line references describe that working tree, not a commit.

## 1. Status and evidence limits

1. **[E]** S5a (the preparation context) and S5b (the optional `preparacionVersion` field, the Start gate, the atomic version comparison hook and the compatibility tests) are implemented in the pure engine under `src/lib/motor/`.
2. The S5b verification figures are **supplied REPORT_066 evidence**, not a fresh verification: 33 of 33 compatibility tests, 282 of 282 motor tests, 807 of 807 full-suite tests, and a passing build. This document does not repeat them and does not treat them as durable-server acceptance.
3. **[R]** The engine is disconnected from the application: no file outside `src/lib/motor/` imports it (checked by search of `src` while writing this document).
4. **[R]** The only adapter that exists is the test-only memory adapter. Its own header says it is not durable and does not test server restart, persistence, real concurrency between processes or real phones (`src/lib/motor/prueba/adaptador-memoria.js:3-5`). Memory-adapter tests therefore prove the engine's decision logic and the adapter contract's shape. They do not prove durable-server atomicity, restart safety, authentic or complete retrieval, real concurrency or pilot readiness.
5. **[R]** The application today is a frontend prototype on IndexedDB with no backend (`README.md:4`; `docs/scoring/SCORE_REFEREE_INTERACTION_SHELL_BRIEF.md:70`). `src/db.js:4-6` states that each local table is the one the backend would have.
6. **[R]** The connected application already enforces readiness for Start inside one browser database transaction: `iniciarPartido` runs through `comando` with `tablasExtra: [db.equipos, db.jugadores]` (`src/lib/reloj.js:135-138`), which opens one `rw` transaction (`reloj.js:72`) and re-reads both teams and their players in `verificarProntitud` (`reloj.js:122-130`). That is the local reference behavior. It is not server authority, shared persistence, authentication or offline readiness (Decision 115, "Still pending", `docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md:1929`).
7. **Known documentation lag (not edited by this task).** `docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md:1896` still says stale offline-start rejection "is proposed in a design plan and is not approved". `docs/roster/ROSTER_MVP_SPEC.md:456` and `:481` still say the engine has no readiness check. The first is superseded by the tutor-supplied approval in section 2; the second is superseded by S5a and S5b. Correcting those files is a separate, explicitly approved step.

## 2. Approved requirements supplied by the tutor

**[A]** The following are carried into this contract as given:

1. Shared server persistence is authoritative for organizations, leagues, teams, people and fichas, matches, grants, scoring and audit history.
2. Dexie holds caches, provisional offline work and local preferences. Existing local or demo data is not automatically production data.
3. Owners authenticate by verified email. Operators use a scoped private token or link plus a PIN, with assigned matches and one controlling session per match. Detailed provider and session mechanics are unresolved.
4. An owner takeover is approved: it invalidates the prior control while preserving events and audit history. Its mechanics are unresolved.
5. The application keeps portable contracts and infrastructure boundaries, starts modular, and avoids premature microservices and a frontend rewrite.
6. Accepted receipt replay precedes new readiness checks, after authorization.
7. Initial Start requires complete trusted roster retrieval and an atomic readiness-version comparison together with receipt, event and state acceptance.
8. Stale Start and preparation faults follow the approved definitive-rejection policy. A rejected Start and its dependent pending commands are preserved. Recovery refreshes authoritative state, requires operator confirmation, and creates a new `cmdId`. Nothing is rewritten or retransmitted automatically.
9. Live-game roster-edit policy remains unresolved. This contract introduces no new restriction or permission.

**[R]** Repository product contracts that this contract relies on:

- Initial Start must be enforced by the authoritative command with the same trusted roster context used for scoring; disabling a button is not sufficient (Decision 115 original item 10, `docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md:1949`; status `:1909`).
- Pilot roster rules: adding, editing and reactivating a player each require a valid jersey number from 0 to 99; uniqueness among the active players of the same team; no pending-number choice (`docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md:1889-1892`). Initial Start requires an existing league, two distinct existing teams of that league, and a valid, team-unique number for every active player of both teams; inactive records and team size do not block (`:1895`).
- Only the owner of the league a team belongs to may change that team's roster (`docs/roster/ROSTER_MVP_SPEC.md:83`); the permission question is asked in one place (`src/lib/sesion.js:35`, `esDuenoDe`).
- Incomplete source entries remain outside registered rosters until complete, and the system never invents a number (`docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md:1893`). Option C (an organizer completion link or portal) is deferred and not authorized (`:1897`).
- The league is authoritative for match state and score; a Sede dashboard only aggregates and projects (`docs/product/SEDE_PRODUCT_DISCOVERY.md:227-244, 417`).
- Offline capture with queued sync is a product requirement (`REQUISITOS.md:91, 248`).

## 3. Scope and non-goals

In scope: shared roster ownership and validated server writes; match-scoped authorization and single-controller validation; complete trusted preparation retrieval; atomic readiness comparison and Start acceptance; durable receipts, retries and restart behavior; publication after committed acceptance; how the existing pure engine participates; unresolved choices and a future validation plan.

Out of scope: UI and recovery presentation; scoring features beyond Start; payments and credits; Sede features; roster changes after a game has started (still an unresolved product question, Decision 115 `:1896`; this contract introduces no new restriction or permission); provider, session, lease or takeover mechanics; service selection; any code, schema or provisioning.

## 4. One scoring kernel

1. **[E]** The scoring and Start decision logic is the pure engine: `procesar` decides, `ejecutar` runs the sequence (authorize, read, decide, commit, publish) against an adapter (`src/lib/motor/orquestador.js`, `procesador.js`).
2. **[P]** The server participates by providing an adapter that satisfies the engine's written contract (`src/lib/motor/contrato-adaptador.js`) and by running `ejecutar` inside the adapter's protected boundary. The adapter supplies authorization, retrieval, storage and publication. It does not re-implement rules, gates or canonicalization.
3. **[P]** The phone-side queue (`src/lib/motor/cola.js`) uses the same rules for local validation. There is one kernel, not a second scorer on the server.
4. **[O]** The runtime in which the kernel runs on the server is unresolved. Any choice must run the same engine code or a verified-identical port with the S5b compatibility tests applied to it.
5. The disconnected Dexie snapshot reader proposed earlier is at most a phone-side capture primitive. It is never server authority and is not authorized by this document.

## 5. Shared roster ownership and validated server writes

1. **[A]** The shared store is the authority for rosters. Roster data read by the server for a Start decision comes from that store.
2. **[P]** Every roster write that can affect readiness reaches the shared store only through a server-side write surface that:
   1. authenticates and authorizes the actor as the owner of the league (section 7);
   2. enforces the pilot roster rules in section 2, including the 0 to 99 number, team-unique numbers among active players, and rejection of the former pending-number choice;
   3. writes the audit record in the same commit as the roster change. The connected application already does this locally (`src/lib/roster.js:249, 270`) and the server must preserve that behavior;
   4. preserves identity, history and permissions as the existing roster contract requires.
3. **[P]** A client roster context and any Dexie cache are not authoritative inputs to a Start decision. A write that originates from a cache or from a client-supplied roster is accepted only through the same validated write surface, never by replacing server data.
4. **Future imports.** **[P]** An import is a separate operation that requires an explicit preview, validation and authorization before any registration. Registration happens through the validated write surface of this section, so the numbered-player rule applies. Local or demo data is not automatically production data. **[R]** Option C, the organizer completion workflow, remains deferred and not authorized (`docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md:1897`). **[P]** Its preparation workflow is not a mandatory step for every future import. This document does not design or authorize any import.
5. **[O]** The storage representation, the shape of the write surface and the fichas and people schema are unresolved.

## 6. Preparation: what is authoritative and what is only compared

1. **[E]** The preparation context is built by `crearPreparacion` from the match, league, team rows, the **active** players with their stored number, and a `consultaEquipos` declaration (`src/lib/motor/preparacion.js:58-114`, content at `:106-113`). `preparacionIntegra` and `evaluarPreparacion` check integrity and readiness (`:124`, `:155`).
2. **[P]** The server independently constructs the authoritative preparation from its own trusted roster data, inside the consistency unit of section 9, and supplies it as `vista.preparacion` through `leerVista` (`contrato-adaptador.js:26-29`).
3. **Client-captured version.** **[E]** The client's `preparacionVersion` is an **input for comparison**: an optional field on an initial Start envelope (`src/lib/motor/sobre.js:157-159`, omitted from the normalized envelope when absent at `:192`). The engine compares it with the server's current preparation version (`procesador.js:58-60`). The server never takes the client's captured version, roster context or cache as the authoritative roster.
4. **[E]** The version is a hash of normalized content. It changes when readiness-relevant content changes (active membership, stored number, team membership of a player, team league, match team references, league existence) and does not change for display-only edits such as names, accents, alias, birth date, inactive players or team display data (`preparacion.js:106-113`).
5. **[E]** Readiness versions are separate from attribution fingerprints. The attribution fingerprint covers teams, player-to-team membership and eligibility, and excludes names and numbers (`src/lib/motor/atribucion.js:19-21, 34`). Neither is derived from the other.
6. **Limits.** **[R]** Hashes detect normalized content changes. They are a public, non-cryptographic detector and are not a security boundary (`preparacion.js:35-41`; `atribucion.js:34`). `consultaEquipos` declares query coverage and does not prove that all rows were retrieved (`preparacion.js:35-41`). Neither proves authentic, complete retrieval, and neither proves server atomicity. Complete and authentic retrieval is a duty of the server adapter inside its own consistency unit (section 9), and is demonstrated only by the real-storage validation in section 14.
7. **[P]** The readiness version definition is single. The server computes it with the same function the engine uses, so a roster write and the Start gate cannot disagree about what counts as readiness-relevant. A separately written definition is not acceptable without the S5a and S5b tests applied to it.

## 7. Match-scoped authorization and control validation

1. **[E]** Authorization precedes protected state and receipt reads. In `ejecutar`, the envelope is validated purely, then `autorizar` runs (`orquestador.js:41, 47`), the returned game and device are compared with the envelope (`:47-56`), and only then does `leerVista` run (`:58`). `procesar` repeats the identity checks before any receipt lookup (`procesador.js:91-97`).
2. **[P]** Authentication and authorization may read the security records they need to validate credentials. This contract does not promise zero database reads before authorization. It promises that no match state, roster data, receipt or rejection is read for the purpose of a decision or disclosed to the caller before authorization succeeds.
3. **[A]** Owners authenticate by verified email. Operators use a scoped private token or link plus a PIN, with assigned matches and one controlling session per match. **[P]** Owners are not required to hold operator-style match grants. The server derives the authorized actor and scope from the presented credential. The identity claims in the envelope (`gameId`, `deviceId`) are never trusted by themselves; they must equal what the server derived (`orquestador.js:49-56`; contract `contrato-adaptador.js:10-19`).
4. **[A]** Owner takeover invalidates the prior control while preserving events and audit history. **[O]** The session model, any lease, the provider and the takeover mechanics are unresolved and are not designed here.
5. **[P]** The single-controller rule is validated inside the same protected boundary as the command, at decision time and again at commit. A change of authorization or control between read and commit must prevent acceptance and cause an authoritative re-read. The engine already carries an authorization version in the commit comparison (`orquestador.js:62-72`; `contrato-adaptador.js:31-33`).
6. **[O]** How owner and operator credentials map to the `deviceId` that the engine requires, and whether control state is carried as the engine's authorization version or its block version, are unresolved.
7. **[P]** A receipt is disclosed only to a currently authorized caller. Replay does not bypass a later revocation or loss of control.

## 8. Command order for an initial Start

For a given authenticated and authorized caller:

1. **[E]** Envelope validity (pure), then identity checks (`procesador.js:91-97`).
2. **[E]** Receipt lookup by `cmdId`. An identical canonical content returns the original receipt; different canonical content returns `conflicto-contenido` and never replays a receipt (`procesador.js:101-105`). This precedes block, sequence and readiness checks. An accepted retry therefore returns the original receipt even after later readiness or roster changes, subject to current authorization (section 7, item 7).
3. **[E]** Block, sequence-occupied and gap outcomes (`procesador.js:107-114`).
4. **[E]** For a new initial Start on a match in `programado` state, the preparation gate (`procesador.js:52-67`, applied at `:116`), in this order:
   1. preparation integrity (`preparacion-no-disponible`);
   2. actual-game binding against the authenticated game (`preparacion-juego-distinto`; the rejection does not name another match);
   3. captured version missing (`preparacion-version-ausente`);
   4. captured version differs from the current version (`preparacion-desactualizada`);
   5. current readiness (`equipos-invalidos` or `plantilla-incompleta`).
5. **[E]** A match that is not `programado` keeps its existing `partido-no-disponible` outcome. The gate does not apply to other command types (`procesador.js:53`).
6. **[A]** Missing, malformed and wrong-match preparation, and stale Starts, use the definitive-rejection path: a stored rejection receipt that consumes the sequence number and leaves the match revision unchanged.
7. Each definitive rejection stored in step 6 returns the same receipt on retry (step 2). Outcomes that store no receipt (blocked, sequence-occupied, gap) are not replayed.

## 9. Atomicity contract

### 9.1 What must hold

This section states guarantees, not a storage technology.

1. **[P] Defined ordering.** A readiness-affecting roster write and an initial Start for a match that uses the affected team have a defined order. A write that committed earlier is seen by the Start decision. A write that commits later follows the Start and does not change an already accepted Start.
2. **[P] No acceptance from a stale read.** If a relevant change commits between the preparation read and the acceptance, acceptance based on the stale read must not occur. The result is a conflict, followed by an authoritative re-read and a re-decision. The re-decision may then accept, or reject as stale, according to the fresh preparation.
3. **[P] Rosters are shared across matches.** A team's roster is not owned by one match, and one write can affect several matches. Therefore a lock or serialization scoped to one match does not by itself protect the roster that the Start reads. The consistency unit must cover the roster data that the preparation reads together with the acceptance write, or must give an equivalent defined order against every readiness-affecting write. Which mechanism provides this is **[O]**.
4. **[P] Single commit.** The accepted Start's events, match state and clock, audit rows, receipt, revision, sequence cursor, clock cursor and pending-publication record commit together or not at all (`contrato-adaptador.js:31-42`). A definitive rejection commits its receipt and sequence cursor together.
5. **[P] Display-only changes.** Edits excluded from the readiness version (section 6, item 4) must not change the preparation version. They therefore must not cause a semantic stale-readiness rejection (`preparacion-desactualizada`) or a preparation-version conflict at commit. This does not promise that no storage-level transaction conflict or contention can ever occur: if the storage layer reports contention, a safe retry with a fresh authoritative read is acceptable, and it does not change the semantic outcome for a display-only edit.
6. **[A] No new restriction or permission.** Live-game roster-edit policy remains unresolved. This contract neither restricts nor grants roster edits during a live game. It defines only the ordering between a readiness-affecting roster write and an initial Start (items 1 and 2).

### 9.2 Mapping to the engine

| Guarantee | Engine hook | Status |
|---|---|---|
| The server's authoritative preparation is read inside the unit | `tx.leerVista(sobre)` returns `vista.preparacion` after authorization (`orquestador.js:58`; `contrato-adaptador.js:26-29`) | **[E]** hook; **[P]** adapter duty |
| The version read is remembered for the commit | `esperado.versionPreparacion`, set for `iniciar-partido` only, to the read preparation's version or `null` (`orquestador.js:70`) | **[E]** |
| The commit compares it with the current version | `tx.confirmar({ esperado, … })` returns `{ conflicto: true }` and writes nothing if any compared value changed (`contrato-adaptador.js:31-35`; memory model at `adaptador-memoria.js:44, 63`) | **[E]** hook and memory model; **[P]** durable adapter duty, inside the consistency unit, never from a cache |
| Conflict leads to a fresh re-read and re-decision | the loop in `ejecutar`, at most three attempts (`orquestador.js:23`, `:62-72`, retry on conflict at `:75-95`, then `contencion-excesiva` at `:115`) | **[E]** |
| Authorization changes between read and commit are caught | `esperado.versionAutorizacion` (`orquestador.js:66`) | **[E]** hook; **[O]** what the server version is |
| Accepted replay does not commit | a replayed receipt returns before `confirmar` (`procesador.js:101-105`; `orquestador.js:98`) | **[E]** |
| Publication after commit only | `publicarPendientes` runs after `confirmar` (`orquestador.js:106`) | **[E]** |

### 9.3 Open points

- **[O]** The exact mechanism that provides the defined ordering and the consistency unit across shared rosters.
- **Retry exhaustion and unknown acceptance.** What the engine establishes, and what it does not:
  1. **[E]** A conflict attempt itself writes nothing. `confirmar` and `registrarCuarentena` return `{ conflicto: true }` before assembling any write (`src/lib/motor/prueba/adaptador-memoria.js:97, 113`); the engine turns that into a retry (`orquestador.js:82, 89, 94, 101`); and the adapter stores a result only when a write was assembled (`adaptador-memoria.js:119-120`). The adapter contract requires the same of any adapter: on a change it "no escribe nada" (`contrato-adaptador.js:31-37`).
  2. **[E]** Exhaustion starts nothing further. After the last attempt the loop ends and `ejecutar` throws `contencion-excesiva` (`orquestador.js:115`). Publication is attempted only for an accepted outcome (`publicar: true` at `:83`, used at `:103-112`), so exhaustion publishes nothing and initiates no further acceptance. The memory test pins this (`orquestador.test.js:152-160`).
  3. **[E]** Those facts concern the attempts of that one call. They do not show that no earlier attempt committed. The engine's statement that an exception at commit leaves nothing written (`orquestador.js:19-20`) holds only if the adapter rolls back (`contrato-adaptador.js:6-8`). A durable adapter whose commit succeeds but whose response is lost, or a concurrent submission of the same envelope, looks to the caller like a failure. The memory adapter does not model commit followed by a lost response: its injected faults fire before the draft becomes the stored state (`adaptador-memoria.js:98-109, 119-120`). It does model a lost acknowledgment after a completed call, whose retry returns the original receipt (`orquestador.test.js:16`; `cola.test.js:201`).
  4. **[P]** Therefore, after retry exhaustion, a thrown error, a timeout or any lost response, acceptance is **unknown**. It is neither "rejected" nor "not applied". Unknown acceptance is resolved by resubmitting the **original immutable envelope with the same `cmdId`**, subject to current authorization. The authoritative receipt lookup then returns the original receipt if the command was committed (`procesador.js:101-105`) and decides it afresh if it was not. A new command, with a new `cmdId`, is never created merely because a transport response is unknown. The phone queue already preserves what this needs: an in-flight entry keeps its stored envelope and is the next thing sent (`cola.js:70`), a reused `cmdId` returns the stored command (`cola.js:50`), and `reanudar` refuses while an entry is in flight (`cola.js:145`).
  5. **[A]** This differs from a **confirmed definitive rejection**, where a receipt (or a replay) shows `rechazado`. Its approved recovery is refresh, operator confirmation and a new `cmdId` (section 10, item 6).
  6. **[E]** A replayed receipt does not publish. A replay returns with `publicacion: 'no-aplica'` and does not call `publicarPendientes` (`orquestador.js:98, 103-112`). A record left pending after a commit whose response or process was lost is therefore not re-triggered by the engine on replay.
  7. **[O]** The transport outcome for exhaustion, error and timeout; the client behavior that performs the resubmission (how often, and what the operator sees); and who resumes delivery of a pending publication record after a restart are not implemented anywhere and are unresolved.
- **[O]** How the version used in `esperado.versionPreparacion` is made equal to the version of the current authoritative content at commit time.

## 10. Durable receipts, retries and restart

1. **[P]** Accepted and rejected receipts are durable and immutable. The stored receipt for a `cmdId` is never rewritten, and a rejection receipt is not replaced by a later acceptance of the same `cmdId`.
2. **[E]** A retry with identical canonical content returns the original receipt; changed canonical content under the same `cmdId` returns `conflicto-contenido` (`procesador.js:101-105`). Canonicalization sorts object keys and omits `undefined` values (`sobre.js:48-61`). Input key order is therefore irrelevant, while adding a canonical field changes the content. `preparacionVersion` is omitted when absent so that envelopes and receipts accepted before S5b still replay (`sobre.js:192`).
3. **[P]** After a server restart, receipt lookup, the sequence cursor, the match revision and the pending-publication records are exactly what was committed. Retries sent after the restart behave as in item 2.
4. **[P]** A rejected Start retains its receipt and consumes its sequence number. Retrying the same envelope returns that same rejection.
5. **Phone-side handling.** **[E]** A definitive rejection stops the phone queue, marks the rejected command `rechazada` and its dependents `no-aplicada`, keeps their stored envelopes unchanged, and sends nothing automatically (`cola.js:118-119`; `proximoEnvio` at `:70`). Reusing the same `cmdId` returns the original stored command (`cola.js:50`). `reanudar` refuses unless the stop was a definitive rejection (`cola.js:141-145`).
6. **[A]** Recovery: refresh authoritative state, require explicit operator confirmation, and create a **new** `cmdId` carrying the current version. No automatic rewrite or retransmission. This applies to a confirmed definitive rejection only; unknown acceptance is resolved by resubmitting the original envelope and `cmdId` (section 9.3). **[O]** The refresh transport and the confirmation presentation are not designed here.

## 11. Publication after committed acceptance

1. **[E]** The accepted Start writes its pending-publication record in the same commit as the acceptance. Publication is attempted only after `confirmar` returned success (`orquestador.js:75-83, 106`; `contrato-adaptador.js:47-50`).
2. **[E]** A failed publication leaves the record pending and does not reapply the Start (`orquestador.js:108-111`).
3. **[P]** A rejected command publishes nothing. Publication and the live board are consumers of committed state and never decide acceptance.
4. **[O]** Delivery mechanism, retry schedule, ordering guarantees and the relationship to the live board are unresolved.

## 12. Disclosures and rejections

1. **[E]** A rejection for a wrong-match preparation does not name the other match, and its stored detail is empty (S5b compatibility tests; `procesador.js:57`).
2. **[E]** A stale rejection returns the current server version so the client can refresh. A readiness rejection carries only team-level detail, not player names.
3. **[P]** An unauthorized caller receives no receipt, no state and no preparation detail.

## 13. Unresolved infrastructure and implementation choices

**[O]** None of the following is decided by this document, and none may be settled by an unverified claim about a service. Each must be decided with evidence from the then-current official documentation and from validation against real storage:

1. The shared store, its transaction or consistency capabilities, and the mechanism that gives the ordering in section 9.
2. The server runtime that runs the engine, and how engine code is shared or ported.
3. The credential and session model, token and PIN verification, the control lease, takeover mechanics and the provider.
4. The mapping of owner and operator credentials to the engine's device identity (section 7, item 6).
5. The server write surface and schema for rosters, fichas, people and audit.
6. The shape of the receipt, sequence and publication-record storage.
7. The behavior on retry exhaustion, the transport and client handling of unknown acceptance, and the client refresh transport.
8. The publication and live-board delivery mechanism.
9. The future import tooling, preview and authorization.
10. The correction of the outdated roster documents (section 1, item 7).

## 14. Future validation plan (documentation only)

None of this has been run. Each item needs real shared storage, not the memory adapter, and is separate from real-device and offline acceptance.

**Real shared-storage validation**

1. Concurrent readiness-affecting roster edits and initial Start, in both orderings, with forced conflicts. Show that an earlier committed edit is seen, a later edit follows the Start, and a change between read and acceptance prevents acceptance and causes a fresh re-read and re-decision.
2. The same with rosters shared by several matches of the same team.
3. Display-only edits during a Start do not change the preparation version, cause no semantic stale rejection and no preparation-version conflict. Any storage-level contention that does occur is handled by a safe retry with a fresh read and does not change the semantic outcome.
4. Authorization or control changes before commit prevent acceptance and cause a re-read; owner takeover invalidates prior control and preserves events and audit.
5. Restart: accepted and rejected receipts, sequence cursor, revision and pending-publication records survive and replay immutably.
6. Changed canonical content under the same `cmdId` returns `conflicto-contenido` and replays no receipt; a legacy envelope without the field still replays its original receipt.
7. Preparation faults (absent, malformed, corrupted, wrong-match with its own matching version) produce the approved definitive rejection without naming another match and without writing partial state.
8. A durable rejected Start and its dependent commands remain retained and unchanged; nothing is retransmitted automatically; recovery uses refreshed state and a new `cmdId`.
9. Outbox: a publication failure after commit leaves the record pending and never reapplies the Start.
10. Authorization failures cause no state or receipt disclosure and no decision read.
11. Retry exhaustion: the conflicting attempts write nothing and exhaustion initiates no further acceptance or publication. The outcome is reported as unknown acceptance, not as a rejection.
12. Commit-response loss: force a commit to succeed while its response is lost (including after exhaustion and across a restart). Resubmitting the original immutable envelope and `cmdId`, after authorization, returns the original receipt with the Start applied exactly once. No new command is created, and a concurrent duplicate submission applies once.
13. A publication record left pending by a lost response or a restart is delivered by an explicitly defined mechanism without reapplying the Start, since a replay does not itself publish.
14. Retrieval completeness and authenticity: tests showing that every active player of both teams is retrieved inside the consistency unit, and that a context from another source is not accepted as authoritative. Hashes and `consultaEquipos` do not substitute for this.

**Later, separate acceptance**

- Real Android devices, bounded offline capture and queued sync, and the live board.
- Pilot readiness. This document does not declare it.

## 15. Acceptance criteria for this document

1. It states that roster writes and Start decisions share one authoritative store, and that the client-captured version is a comparison input while client roster context and Dexie caches are not authoritative.
2. It preserves verified owner authentication and scoped operator token or link plus PIN without requiring owners to use operator-style grants, and states that the server derives actor and scope from credentials.
3. It records owner takeover as approved and leaves its mechanics open.
4. It states the order: authorization, receipt replay, then (for new `programado` Starts) integrity, game binding, missing version, stale version, current readiness.
5. It defines an ordering between readiness-affecting roster writes and Start, and requires a conflict and re-read when a relevant change commits between read and acceptance, without prescribing a technology or claiming a per-match lock suffices.
6. It maps the guarantees to `leerVista.preparacion`, `esperado.versionPreparacion`, `confirmar` and `ejecutar`.
7. It states that hashes detect changes, `consultaEquipos` declares coverage, and neither proves authentic, complete retrieval or atomicity.
8. It states that imports need explicit preview, validation and authorization, that local or demo data is not production data, and that Option C is deferred and not mandatory for every import.
9. It labels every requirement as tutor-supplied, repository, implemented engine, proposed or open, and treats REPORT_066 as supplied evidence.
10. It keeps one scoring kernel, leaves live-game roster-edit policy unresolved and introduces no new restriction or permission, does not reopen the stale-Start policy, selects no service, and authorizes no implementation.
11. It distinguishes unknown acceptance (resolved by resubmitting the original envelope and `cmdId`) from a confirmed definitive rejection (recovered with a new `cmdId`), and qualifies what retry exhaustion does and does not establish.
