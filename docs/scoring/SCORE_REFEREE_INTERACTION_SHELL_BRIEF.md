# SEBEL — Referee Console Interaction Shell Brief

Document type: implementation-ready specification (documentation only).
Baseline checkpoint: `155d062` — fix League navigation active tab visibility.
Audience: a fresh implementation agent with no access to the originating conversation.

**Revision 2 — superseded decisions (authoritative):**

1. The earlier single shot-clock with `24`/`14` “full/short reset” controls is **superseded**. Basketball has **two distinct timer areas**: a **shot/possession clock** and a **midcourt-crossing clock**. Category defaults and organizer overrides for their durations are **future domain configuration**, not decided or implemented here. The shell shows both areas visually, with local ephemeral state only (§9.3).
2. The earlier rule that the inactive-player console defect is “documented only, not repaired” is **superseded**. The later shell implementation **must repair** the selectable scoring roster using the existing `activoDe` compatibility predicate (§4, §5, §13 test 13).

Legend used throughout:

- **[BASELINE]** current implementation truth, verified by repository inspection.
- **[REQUIRED]** approved interaction requirement for this slice.
- **[PROTOTYPE]** prototype-only behavior; must never be mistaken for finished functionality.
- **[FUTURE]** future production behavior; described for orientation only and **not authorized**.
- **[NOT AUTHORIZED]** work this slice must not do.

---

## 1. Status and authorization

- This brief is a specification. Writing it changed no application code.
- It authorizes **one later implementation slice**: a reversible UI interaction shell for the referee console, confined to the files in §12.
- It does **not** authorize: v0 usage, deployment, Cloudflare provisioning, dependency changes, schema changes, branch creation by the *documentation* task, commits, or pushes. The implementation agent may create a branch and commit **only if separately instructed**; absent that, it must neither commit nor push (§19).
- Implementation must begin from HEAD `155d062` (or a later HEAD the owner explicitly confirms). If HEAD or the working tree differs unexpectedly, stop and report before changing anything.
- Known working-tree exception: untracked `docs/product/` is unrelated future work and must remain untouched.
- Shell gate outcomes are only **PASS — Interaction Shell** or **FAIL / REVISE** (§15). This slice can never conclude PASS — Basic Pilot, PASS — Extended Pilot, production ready, offline ready, or Cloudflare ready.

## 2. Pilot scope

The newest approved pilot scope supersedes any older two-customer wording:

- One pilot customer: **Deportivo-VIP**.
- One pilot sport: **basketball**.
- Target date: **18 October 2026**.
- Future multi-customer and multi-sport flexibility remains important but **must not expand this slice**. Do not add sport-specific abstractions, configuration systems or customer branding for it. Futsal keeps working exactly as today (see §5 constraint on non-basketball behavior).
- Language: Spanish-first, neutral Latin American terminology.

## 3. Objective

Create a reversible interaction shell so the referee-console layout can be validated on a **real Android phone** before the complete basketball statistics, possession/midcourt-crossing clock, audit, offline or Cloudflare domain logic exists.

The shell validates: layout, discoverability, reachability, touch safety, global panel switching, scrolling, and team switching — while the existing basic scoring behavior keeps working unchanged.

Principles preserved:

- The referee operates one-handed, standing, during live play.
- Scoring is deterministic, immediate and independent of AI. No AI in the scoring/capture path.
- The pilot eventually needs bounded offline capture; offline synchronization is outside this shell.
- Only **active** player registrations may be selectable for future scoring; historical players and events stay preserved.
- Existing working basketball scoring must not regress.

## 4. Current implementation baseline

All items verified at `155d062`. Treat this as current truth, not as the target.

1. `src/pantallas/Consola.jsx` (266 lines) is the approved foundation and is the single console screen.
2. Basketball supports direct player-attributed **+1, +2, +3** and **F** (`PUNTOS_POR_DEPORTE.baloncesto = [1,2,3]`, `LIMITE_FALTAS = 5`). Futsal has `[1]`.
3. Derived state recognizes three event types: `punto`, `falta`, `periodo` (`src/lib/marcador-calculo.js`).
4. Team score, player points, team/player fouls and current period are all **derived from the existing events list**; no stored counters.
5. **Undo / Redo / targeted Anular mutate existing event flags** (`anulado`, `anuladoEn`, `rehacerBloqueado`) on the original event rows (`src/lib/marcador.js`). This is **not** the approved final append-only correction model.
6. Clock state is stored **directly on the Match record** (`relojEstado`, `relojRestante`, `relojDesde`) via `db.partidos.update` (`src/lib/reloj.js`).
7. Clock actions (start, stop, adjust ±10 s, zero auto-stop) are **not audited domain events**. Only `siguientePeriodo` writes a `periodo` event, plus its clock reset.
8. **No shot/possession-clock model and no midcourt-crossing-clock model exist.**
9. **No advanced-statistics event or projection model exists** (no AST/RD/RO/TL-/ROB/BLQ anywhere).
10. **No automated tests cover** Consola, scoring mutations, Undo/Redo, clock actions or period transitions. Existing screen tests: `src/pantallas/Liga.test.jsx` and `Equipo.test.jsx` only.
11. Local timing survives reload because remaining time is derived from stored remaining duration plus a start timestamp (`restanteMs` in `reloj-calculo.js`). `Consola` also ticks every 500 ms and auto-stops the clock at zero.
12. **Cloudflare synchronization and server authority do not exist.** This is a frontend prototype on IndexedDB (Dexie).

Additional observed layout facts relevant to the shell:

- Layout order today: Topbar → score/period/clock header → clock panel (only when `estado === 'vivo'`) → team selector → roster rows → sticky `.barra-deshacer` (Undo/Redo) → transient `.aviso` → “Últimas acciones” (last 10 `punto`/`falta`, each with a per-row `anular` pill) → “Cerrar el partido”.
- Each player row (`.jugador-fila`) holds dorsal, name, points/fouls line, and `.anota` buttons.
- Current touch sizes are **below the required minimum**: `.anota button` is `min-width: 38px` with `padding: 8px 0` and the F button `min-width: 34px`. The `-10s/+10s` ajuste buttons have `min-width: 62px` but no explicit height. The shell must fix this for the controls it touches (§10).
- `.barra-deshacer` is `position: sticky; bottom: calc(var(--tab-h) + 10px)`.
- Haptics: `avisar()` calls `navigator.vibrate?.(12)` and shows a 1.2 s `.aviso` toast.
- The “Anular” action appears on each recent-action row and is already reachable.

### Pre-existing roster defect — repair is REQUIRED in this slice

> **[DEFECT — roster compatibility, pre-existing]** The roster specification (`docs/roster/ROSTER_MVP_SPEC.md` §11/§19 #21 and `ROSTER_MVP_PLAN.md`) requires that `Consola.jsx`’s local `plantel` exclude inactive fichas, with the filter applied **only in Consola**, never inside the shared `usePartido` hook. At `155d062`, `Consola.jsx:71-73` builds `plantel` from `jugadores.filter(j => j.equipoId === equipo.id)` with **no activity filter**, and `usePartido` (`src/datos.js:129-151`) returns all league players. Inactive registrations therefore **can currently appear and be scored** in the console roster.

Approved resolution (supersedes the earlier “documented only” position): the later shell implementation **must** repair this in `Consola.jsx` using the existing compatibility predicate, exported from `src/lib/identidad.js`:

```js
export const activoDe = (jugador) => jugador?.activo !== false
```

Rules for the repair:

- Import and use `activoDe` (already used by `src/lib/roster.js`); do **not** re-implement or inline a different predicate. Records with a missing/undefined `activo` count as active, exactly as `activoDe` defines.
- Apply it **only to the console’s selectable scoring roster** (the local `plantel` derivation in `Consola.jsx`), e.g. `jugadores.filter((j) => j.equipoId === equipo.id && activoDe(j))`. Equivalent use of `rosterActivo` is **not** preferred because it is async/DB-bound; the in-component filter keeps `usePartido` data intact.
- **Do not** filter inside `usePartido` or any shared hook/query, and do not change `datos.js`, `roster.js` or `identidad.js`. Historical rendering must be unaffected: `jugadoresPorId` (used by “Últimas acciones” to name players) must keep resolving **inactive** players’ names for past events; past events and totals of inactive players stay preserved and visible in history.
- Inactive players must not be selectable in **any** panel (Puntos, Estadísticas, Defensa), including prototype actions.
- Sorting by `dorsal` and every other existing roster behavior is unchanged.

## 5. In scope

[REQUIRED] — all within `Consola.jsx`, console CSS, and a new test file:

1. A single **global panel selector** with three panels (Puntos, Estadísticas, Defensa).
2. Rendering each player row’s action area from the selected panel, using the fixed labels in §7.
3. Preservation of the selected panel across team switching, within the console session.
4. A **basketball timer shell** with **two distinct areas** — shot/possession clock and midcourt-crossing clock (prototype-only, component-local state; §9.3).
5. A persistent **“prototipo / no guardado” validation notice**.
6. Prototype-action visual/haptic feedback that explicitly says “Prototipo · no guardado”.
7. Layout adjustments needed so the selector, Undo/Redo, clocks and roster work at 360×800 with 8–12 players per team, without horizontal page scroll or obscured controls.
8. Raising touch targets of the controls the shell touches to the §10 minimums, **without changing their behavior**.
9. Repositioning “Ajustar reloj” (−10s/+10s) only if the mobile layout requires it, keeping current −10/+10 behavior.
10. A new `src/pantallas/Consola.test.jsx` (§13).
11. **Repair of the selectable scoring roster** in `Consola.jsx` via `activoDe` (§4), with regression tests.

Constraint: futsal console behavior must not regress. The panel selector and advanced/timer areas are a basketball shell concern; futsal must keep rendering and scoring as it does today (the implementer chooses the minimal safe gating, e.g. showing the extra panels only for `liga.deporte === 'baloncesto'`, and states the choice in the report).

## 6. Explicitly out of scope

[NOT AUTHORIZED] in this slice:

- Any advanced-statistics event types, schema, projections, box score or leaderboard changes.
- Any persisted shot/possession-clock or midcourt-crossing-clock model; sync of either with the game clock; auditing of either.
- Defining, storing or editing timer **durations**: category defaults and organizer overrides are **future domain configuration** and are not decided, modeled or hard-coded as product values by this slice.
- The final game-clock contract (paused-only −1/+1, hold-to-repeat, exact-time entry, audited clock events) — described in §9 only as **[FUTURE]**.
- Append-only compensating correction events, or any rewrite of Undo/Redo/Anular semantics.
- Offline capture queue, service-worker changes, sync, conflict handling, server authority, Cloudflare provisioning or code.
- AI features of any kind.
- Any inactive-player handling beyond the single `activoDe` roster filter in `Consola.jsx` (§4); no changes to `usePartido`, `datos.js`, `roster.js`, `identidad.js` or historical read paths.
- Changes to `marcador.js`, `marcador-calculo.js`, `reloj.js`, `reloj-calculo.js`, the Dexie schema/`db.js`, `seed.js`, `datos.js`, service worker, build configuration, or `package.json` dependencies — unless a later reviewed specification expressly expands scope.
- Use of v0 or any generated-UI tool; deployment; branch/commit/push without separate instruction.
- Changes to `docs/product/` or any other documentation.
- Multi-customer / multi-sport generalization.

## 7. Required interaction model

### 7.1 Global selector

- One selector, exactly three options in this order: **Puntos**, **Estadísticas**, **Defensa**.
- **Puntos is the default** on console load.
- The selected panel applies to **every visible player row**. There is no per-row panel state anywhere (no state keyed by player id).
- Panel state lives at the Consola component level (one value), is **independent of `ladoActivo`**, and **survives switching teams** during the current console session. It need not survive reload (§11).
- Selection is by **visible tap**. Selector options are real buttons (or a `role="tablist"`/`tab` or radio-group pattern; see §10) with an unmistakable selected state.
- **Horizontal swipe is optional and secondary.** It may be added only if it cannot generate accidental actions: swipe handling must not trigger on or beneath action buttons’ taps, must require a clear horizontal threshold with vertical-scroll tolerance, must never call any scoring/foul/clock function, and must never cause a click on a button the finger lands on. If this cannot be guaranteed, **omit swipe**. Tap selection alone fully satisfies the slice.
- **Return to Puntos:** after **one action** (a completed +1/+2/+3/F, or a prototype advanced action tap), the console returns to **Puntos** automatically — one action, one return. Switching panels, team switches, clock buttons, Undo/Redo/Anular and timer-area taps do not by themselves count as the “action” (state this precisely in the implementation report; if ambiguity arises, the rule is: *any tap on a player-row action button returns to Puntos*). Additionally the operator must be able to return to Puntos at any time by tapping the Puntos option once.
- Switching panels must **not** change the score and must **not** create sporting events.
- The selector remains **visible or reachable** while navigating realistic 8–12-player rosters (e.g. sticky placement that does not hide player identity, totals or action buttons — see §8).
- **Scroll position:** preserve the roster scroll position across panel switches where technically reasonable (do not re-mount the roster list on panel change; use stable keys; do not call `scrollTo`). Validation: see §13 note and manual step M-scroll (§14). Preservation across *team* switch is not required (the list contents change), but a team switch must not leave the page scrolled to an unreachable position.
- **No horizontal page scrolling** may be introduced (document `scrollWidth` must not exceed `clientWidth` at 360 px).

### 7.2 Player action labels (fixed)

| Panel | Buttons, in order |
| --- | --- |
| Puntos | `+1`, `+2`, `+3`, `F` |
| Estadísticas | `AST`, `RD`, `RO`, `TL-` |
| Defensa | `ROB`, `BLQ` |

Each button needs an accessible name containing the player name and a plain-Spanish action (e.g. “Ana Pérez: asistencia (prototipo, no guardado)”). Keep existing accessible names for Puntos buttons unchanged where possible (`{nombre} más {v}`, `Falta de {nombre}`), because tests and any later automation depend on them.

Glossary for neutral Latin American Spanish, for use in accessible names/tooltips only (visible labels stay the short codes): AST = asistencia; RD = rebote defensivo; RO = rebote ofensivo; TL- = tiro libre fallado; ROB = robo; BLQ = bloqueo (tapón). Do not invent additional actions.

## 8. Required visual/layout behavior

- Android portrait-first; Chrome browser first, installed PWA later. Validate ~360–430 CSS px widths; **360×800 is the minimum reference viewport**.
- Test with realistic rosters: **8–12 players on each team**.
- No clipping, no overlap, no horizontal page scroll, at 360 px width, including with long names (use ellipsis on name only; dorsal, totals and action buttons must remain fully visible).
- The player row must fit: dorsal, name, points/fouls line, and the action buttons of the widest panel (4 buttons). The implementer may restructure the row (e.g. action buttons on a second line under identity) to satisfy touch sizes; it must remain one row-card per player and the same structure for every player.
- Sticky/fixed elements (selector, `.barra-deshacer`, tab bar) must **never** cover player identity, totals, or action buttons for any row at rest or while scrolling; the page must reserve scroll padding so the last player row can be scrolled fully clear of sticky elements. Total sticky height budget should be stated in the report.
- Order guidance (may be adjusted if validation shows a better reach): score/period/game clock header → clock controls → timer shell (two areas) → team selector → global panel selector → roster → Undo/Redo → Últimas acciones. Both team selector and panel selector must stay reachable during roster scroll; if both cannot stay sticky within a sane height, make the **panel selector** sticky and keep the team selector in normal flow, and record the choice.
- The persistent prototype notice (§9) must be visible without scrolling the roster, concise (one or two short lines), and must not be dismissible during the validation build.
- Respect the existing design tokens (`--acento`, `--ink`, `--line`, `--r-md`, etc.). Do not reference undefined CSS variables (a prior regression: `var(--accent)` vs `--acento`, see `Liga.test.jsx`). Do not add dependencies or fonts.
- Honor `prefers-reduced-motion` for any added transition.
- Selected panel and active team must be indicated by **more than color alone** (§10).

## 9. Functional versus prototype-only controls

### 9.1 Existing functional (must keep working, unchanged behavior)

`+1`, `+2`, `+3`, `F`, Undo (↺ Deshacer), Redo (↻ Rehacer), targeted Anular (per recent-action pill), game-clock Arrancar/Detener, period transition (“Empezar el Nº cuarto” / “Terminar … antes de tiempo”), “Comenzar el partido”, “Cerrar el partido”, and the current clock adjustment (−10s/+10s) **if retained** (it must be retained unless the layout needs a reposition; it must not be removed or silently re-semanticized).

### 9.2 Prototype-only advanced actions [PROTOTYPE]

`AST`, `RD`, `RO`, `TL-`, `ROB`, `BLQ`. They may give immediate **local visual/haptic** feedback for phone-layout testing, but they must:

- **never** write to IndexedDB (no `db.*` call, no `marcador.js` write function);
- **never** create or alter sporting events;
- **never** change score, fouls, player totals, team totals, or “Últimas acciones”;
- **never** survive reload (no localStorage/sessionStorage persistence either);
- clearly display **“Prototipo · no guardado”** in their feedback (toast text and, e.g., a visible badge on the panel);
- be visually distinguishable from functional controls (e.g. dashed border plus a “PROTOTIPO” marker, not color alone) and impossible to mistake for completed pilot functionality.

Feedback must reuse a separate message state from the functional `ultimoToque` toast (or tag messages) so a prototype message can never be confused with, or appended to, a saved-action confirmation. Vibration for prototype taps should be distinguishable from or no stronger than the functional one; it must not use the functional confirmation wording.

### 9.3 Basketball timer shell [PROTOTYPE]

Basketball has **two distinct timers**. The shell shows them as **two separate, clearly labeled areas** — never merged into one control, never presented as “full” vs “short” resets of a single clock:

1. **Reloj de posesión** (shot/possession clock) — area with its own value display and its own reset control.
2. **Reloj de cruce de medio campo** (midcourt-crossing clock) — area with its own value display and its own reset control.

Each area shows: a visible value placement, a reset control (≥ 44×44, §10), and the status text “Prototipo · no guardado”. Accessible names must identify the area (e.g. “Reiniciar reloj de posesión (prototipo, no guardado)”, “Reiniciar reloj de cruce de medio campo (prototipo, no guardado)”).

Duration values (domain boundary):

- **Category defaults and organizer overrides are future domain configuration.** This slice must not model, persist, or present any duration as an approved product rule, and must not claim a category/sport default.
- For layout validation only, the shell may display **sample placeholder values** held in a single clearly named local constant marked in a code comment as *non-authoritative sample values for layout validation, not product configuration*. Prefer rendering them so they cannot be mistaken for configured rules (e.g. visually marked “muestra”). The earlier fixed pair of `24`/`14` reset buttons for one clock is **removed from this spec**; no control, label, test name or copy may describe two reset values of one shot clock.
- The shell has **no** duration setting UI, no category selector, and no override UI.

Allowed: component-local ephemeral state (`useState`) **solely** to validate placement and touch behavior (each reset sets that area’s displayed value; the two areas’ state is independent — resetting one never changes the other).

Forbidden for both areas: writing state to IndexedDB (or any storage); claiming sync with the game clock; claiming auditing; claiming offline recovery; surviving reload; **any effect on game-clock state** (`relojEstado`, `relojRestante`, `relojDesde`, period events). No `reloj.js` write functions or `db.*` calls are used by these handlers.

The default and recommended shell is **static value + reset taps, no countdown**, to avoid implying working timers. A visual countdown is allowed only if explicitly decorative and local-only.

### 9.4 Persistent validation notice

A single persistent notice, visible whenever the console is shown for basketball, in the spirit of:

> “Prueba de diseño: estadísticas avanzadas, reloj de posesión y reloj de cruce de medio campo son prototipos. No se guardan.”

(Wording may be refined; it must say both that they are prototypes and that they are not saved.)

### 9.5 Game-clock boundary

- Preserve existing working game-clock behavior.
- Reposition “Ajustar reloj” (−10s/+10s) only if the mobile layout requires it.
- Do **not** implement the final contract in this slice and do not silently replace −10/+10 with partial production semantics.
- **[FUTURE — not authorized]** the intended final clock contract: adjustment allowed only while paused; ±1 s steps with hold-to-repeat; exact-time entry; every clock action recorded as an audited domain event; clock state recoverable offline and reconcilable by the server. Recorded here only so the shell’s layout leaves room for it.

### 9.6 Correction boundary

- Preserve current Undo/Redo/Anular behavior exactly.
- Do **not** implement append-only compensating correction events.
- Do not state or imply in UI copy or docs that current correction storage satisfies the production audit contract. (The existing helper text “Nada se borra: lo anulado queda con su hora.” is pre-existing; leave unchanged.)
- Clock actions remain **outside** generic Undo/Redo (Undo continues to target only the last live `punto`/`falta`/`periodo` event as today; do not make it touch the clock).
- Prototype actions are **not** undoable and must not be reachable by Undo/Redo/Anular.

## 10. Accessibility and touch requirements

- Primary action targets (+1/+2/+3/F, prototype action buttons, game-clock Arrancar/Detener, panel selector options, team selector, Undo/Redo, reset controls of both timer areas): **48×48 CSS px where possible; absolute minimum 44×44 CSS px**, measured as the rendered hit area (padding counts; invisible hit-slop allowed only if it does not overlap neighbors).
- Secondary targets (−10s/+10s, per-event “anular” pills) must also meet the **44×44 absolute minimum** (the current pill is a small text pill; enlarge hit area or restructure).
- Adjacent controls must be **safely separated** (≥ 8 CSS px gap between touch targets in the same row; larger between a destructive-ish control and a frequent one). Never place Anular/Undo adjacent to a primary scoring button without that gap.
- Disabled and prototype-only states are **unmistakable**: disabled uses reduced opacity **and** `disabled`/`aria-disabled`; prototype uses an explicit text marker. Never rely on color alone.
- **The active panel cannot be indicated by color alone**: use `aria-selected="true"` (tabs) or `aria-pressed`/`aria-checked`, plus a non-color cue (e.g. check mark/underline/weight/bold border). Same for the active team in the team selector (already color-fill today; add a non-color cue if touched).
- Semantics: selector exposes exactly three controls named “Puntos”, “Estadísticas”, “Defensa” within a labelled group (`role="tablist"` with `aria-label` such as “Panel de acciones”, with `role="tab"` children, or an equivalent accessible pattern); the roster region reflects the active panel (`role="tabpanel"` or `aria-labelledby`).
- Every action button has an accessible name including player name and action (§7.2). Visible text alone (“+2”, “AST”) is not sufficient as the sole name.
- Keyboard: selector options are focusable and operable with Enter/Space; visible focus indicator retained.
- Feedback: successful **functional** scoring actions keep immediate visual feedback and vibration (`navigator.vibrate?.(12)`) where supported. The toast should use `role="status"`/`aria-live="polite"` if touched.
- Tap safety: use `touch-action` appropriately so vertical scrolling is never blocked and a scroll gesture never fires an action; do not trigger actions on `pointerdown`/`touchstart` (use click), so a scroll that begins on a button does not score.
- Text legibility: minimum 14 px visible text for labels the operator must read mid-game; tabular numerals for clocks/score (already used).

## 11. State and persistence boundaries

| State | Where it lives | Persists? |
| --- | --- | --- |
| Score, fouls, player totals, period, Últimas acciones | `db.eventos` (existing) derived via `marcador-calculo` | Yes (existing; unchanged) |
| Game clock | `db.partidos` fields (existing) | Yes (existing; unchanged) |
| Selected panel | Consola component state (`useState`) | No — resets to Puntos on reload; survives team switch within session |
| Active team side | Consola component state (existing `ladoActivo`) | No (existing) |
| Prototype feedback message | Component state, timed | No |
| Possession-clock and midcourt-crossing-clock shell values (independent) | Component-local `useState` | No — must not survive reload |

Hard rules: no new IndexedDB tables/fields/indices, no Dexie version bump, no `localStorage`/`sessionStorage`/cookie writes for any shell state, no new events, no changes to existing event shapes. The implementation must not call `db.*` from any prototype or panel handler.

## 12. Files expected to change during later implementation

Likely and allowed:

- `src/pantallas/Consola.jsx` (including the `activoDe` roster repair; imports `activoDe` from `src/lib/identidad.js` without modifying that file)
- `src/styles.css` (console-related section only; new classes preferred over editing shared ones; do not alter styles used by other screens)
- `src/pantallas/Consola.test.jsx` (new)

Not authorized unless a later reviewed spec expands scope: `src/lib/marcador.js`, `src/lib/marcador-calculo.js`, `src/lib/reloj.js`, `src/lib/reloj-calculo.js`, `src/db.js` / schema, `src/datos.js`, `src/seed.js`, service worker / PWA config, Cloudflare/infra, `package.json` and lockfile, any docs.

If the implementer believes another file *must* change, it must **stop and report** rather than edit.

## 13. Automated test requirements

Create `src/pantallas/Consola.test.jsx`. Follow the conventions in `Liga.test.jsx`:

- first line `/** @vitest-environment jsdom */`; `import 'fake-indexeddb/auto'`;
- Vitest (`describe/it/expect/beforeEach/afterEach`), `@testing-library/react` (`render`, `screen`, `cleanup`), `@testing-library/user-event`;
- `MemoryRouter` + `Routes`/`Route`;
- delete the IndexedDB database named `sebel` in `beforeEach` and `afterEach` (same `borrarBd` helper pattern) so each test is isolated;
- dynamic `import('../db.js')` / `import('./Consola.jsx')` after DB deletion, as `Liga.test.jsx` does.

Because `Consola` requires an owner session, a live match, a league, two teams and players, tests must seed these through `db` and the session mechanism used by `useSesion`/`useCuenta`/`esDuenoDe` (inspect `src/datos.js` and `src/lib/sesion.js` to seed correctly; do not modify them). The route is `/…/consola` style with a `:slug` resolved by `codigoDe(slug)`; inspect `src/lib/enlaces.js`/the router to build the correct path. Set `navigator.vibrate` to a spy where useful; stub `confirm` if needed.

The tests must prove at minimum:

1. **Puntos is selected by default.**
2. The global selector exposes **exactly** Puntos, Estadísticas and Defensa.
3. Changing panels affects **all player rows globally** (every visible row shows the new panel’s labels; none shows the old).
4. Panel selection **survives team switching** (select Estadísticas, switch to the other team and back; still Estadísticas on both).
5. Panel switching creates **no scoring/statistic event** (`db.eventos` count unchanged; score unchanged).
6. **+1/+2/+3/F retain existing functional behavior** (events written with correct player/team/points/period; score, player points and fouls update; recent actions list updates).
7. **Advanced prototype actions create no IndexedDB event and change no projection** (events table identical before/after; score, fouls, player totals, Últimas acciones unchanged).
8. **Prototype action feedback explicitly says it is not saved** (text contains “Prototipo · no guardado” or the agreed exact string).
9. **Both timer areas** (possession and midcourt-crossing) are present as **two distinct, separately named areas**; each reset changes only its own ephemeral shell state (displayed value changes; the other area is unaffected; no `db` change).
10. **Neither timer area’s interaction ever changes game-clock persistence** (`partidos` row’s `relojEstado`, `relojRestante`, `relojDesde` identical before/after; no `periodo` event).
11. **Undo / Redo / Anular remain reachable** and behave as today (Undo anulates the last live event; Redo restores; targeted Anular marks a chosen event).
12. **Clock actions are not affected by panel selection** (Arrancar/Detener and period controls behave identically in each panel; panel selection never writes clock fields).
13. **Inactive players are not selectable.** Seed a team with active players, one with `activo: false`, and one with `activo` undefined. Assert: the `activo: false` player is absent from the roster in **every** panel (Puntos, Estadísticas, Defensa) and has no action buttons; the undefined-`activo` player is present (matches `activoDe`); a past event of the inactive player still appears in “Últimas acciones” with the player’s name and still counts in team score; switching teams and panels never reveals the inactive player.
14. **Appropriate accessible names and selected-state semantics exist** (`getByRole` for the three selector controls with selected state; named action buttons per player).
15. **No test treats advanced statistics or either timer area as production-complete** (test titles/comments/labels must say “prototipo”; no assertion implies persistence or scoring of AST/RD/RO/TL-/ROB/BLQ, or fixed duration values for either timer).

Test-design notes:

- Timers: fake timers or short waits for the 500 ms tick and the 1.2 s toast; avoid flakiness.
- jsdom has no layout: touch-size and horizontal-scroll criteria are validated **manually** (§14); optionally assert CSS-class presence but do not claim layout verification from jsdom.
- Scroll-position preservation cannot be proven in jsdom; assert instead that the roster list container is not re-mounted on panel change (same DOM node identity before/after) and leave pixel validation to M-scroll.
- Run the new file in isolation (`npx vitest run src/pantallas/Consola.test.jsx`), then the full suite (`npm test`), then `npm run build`.

## 14. Manual Android validation script

Environment: Android phone, Chrome, portrait, viewport ≈ 360–430 CSS px (note device model and exact CSS width); repeat once later in installed-PWA mode (not required for this gate). Use the dev/preview build on the LAN or a preview deploy **made by the owner** (this brief authorizes no deployment). Seed **two basketball teams with 8–12 players each** (e.g. 12 and 9), including **at least one inactive player on each team** (with a past event on one of them, to check history preservation), referee/owner session, match in `vivo` state.

Script (record the running expected totals as you go; use a paper table):

0. **Roster:** confirm each team’s console roster lists only its active players (inactive ones absent in all three panels) while the inactive player’s past event is still named in Últimas acciones.
1. **Baseline layout:** at 360×800 confirm: no horizontal page scroll; score, period, game clock, notice, both timer areas, team selector, panel selector all visible/reachable without clipping; Puntos selected.
2. **Local team, scoring (≥ 10 actions):** in Puntos, perform on distinct players a mix: at least 2× +1, 3× +2, 2× +3, 3× F (including two on the same player). After each, confirm toast, vibration (if supported), correct player totals, team score and fouls. Write expected totals.
3. **Scroll:** scroll the full roster to the bottom and back; confirm panel selector remains visible/reachable, nothing hidden under sticky bars, last player’s buttons fully tappable above Undo/Redo and the tab bar.
4. **Switch team:** switch to visitor; confirm roster and totals are the visitor’s; selected panel unchanged.
5. **Visitor scoring (≥ 10 actions):** same mix as step 2 across the visitor roster (including the last-scrolled players). Total functional actions across both teams ≥ 20.
6. **Panel switching:** select Estadísticas → every row shows AST/RD/RO/TL-; select Defensa → every row shows ROB/BLQ; return to Puntos with one tap. Confirm **no** score/history change and no accidental event from the switching taps. Scroll the roster in Estadísticas, switch to Defensa, and note whether scroll position is preserved (M-scroll: pass if the first visible row is unchanged ±1 row).
7. **Team switch preserves panel:** in Defensa, switch team and back; Defensa still selected on both.
8. **Auto-return:** from Estadísticas tap one AST on a player; confirm “Prototipo · no guardado” feedback, the console returns to Puntos, and score/totals/history are unchanged.
9. **Prototype taps:** tap each of AST, RD, RO, TL-, ROB, BLQ at least once (on different players, across both teams); confirm none appears in Últimas acciones or totals; reload the page and confirm no trace remains.
10. **Timer-area taps:** tap the possession-clock reset and the midcourt-crossing-clock reset repeatedly, alternating and rapidly; confirm each area changes only its own displayed value, the two are never confused, and the game clock display/running state is unaffected. Reload: both timer areas reset, game clock state intact.
11. **Gesture safety:** perform vertical flicks starting on action buttons and horizontal swipes over the roster and selector (if swipe was implemented, also across rows); confirm **no** event created and no panel change except an intentional swipe-driven panel change.
12. **Undo:** tap Undo twice; confirm the two most recent live functional events are annulled, totals reduce correctly, prototype taps are not involved.
13. **Redo:** tap Redo once; confirm the most recent annulled event returns; then perform a new +2 and confirm Redo becomes unavailable (existing rule).
14. **Targeted Anular:** in Últimas acciones, tap “anular” on a specific older event (not the latest); confirm exactly that event is struck and totals adjust.
15. **Game clock:** Arrancar, wait ≥ 10 s, Detener; confirm time ran down and stopped; use the retained −10s/+10s adjustment; confirm results as today. Switch panels while clock running; confirm no effect. Reload while running and while stopped; confirm remaining time is consistent with the existing behavior.
16. **Period controls:** with time remaining use “Terminar … antes de tiempo”, confirm period increments, clock resets, periodo event does not appear in Últimas acciones; confirm period transition works from each panel selection.
17. **Touch measurement:** using Chrome remote-debugging element inspection (or the device’s pointer-location overlay), verify the rendered hit areas of: +1/+2/+3/F, AST/RD/RO/TL-/ROB/BLQ, selector options, team selector, Undo/Redo, Arrancar/Detener, −10s/+10s, both timer-area reset controls, “anular” pills. Record any below 48×48 and any below 44×44.
18. **Overlap/clipping scan** at 360, 393 and 430 widths with the longest player name and 12 players: no overlap, no clipping, no horizontal scroll.
19. **Final reconciliation.**

Expected results (all must hold):

- Final score of each team **exactly matches** the paper script total of non-annulled functional actions.
- Each player’s points and fouls **exactly match** the script.
- “Últimas acciones” **exactly matches** the functional sporting actions (last 10; annulled ones marked) — **prototype actions never appear** in history or totals.
- No accidental event occurred during swiping, scrolling or panel/team switching.
- Reload shows no prototype residue; persisted game-clock and events are intact.

## 15. Acceptance criteria

The shell gate **PASSES — Interaction Shell** only if all hold:

1. All §13 tests exist, pass in isolation, and the full suite and `npm run build` pass.
2. The manual script (§14) completes with every expected result met on a real Android phone.
3. Only the files in §12 changed; none of the §6 prohibitions were violated.
4. All touch targets listed in §10 meet ≥ 44×44, and primary ones meet 48×48 where possible (any exceptions listed in the report with reason).
5. No horizontal page scroll; no clipping/overlap at 360–430 px.
6. Prototype actions and both timer areas are visibly labeled “Prototipo · no guardado” and demonstrably unpersisted.
7. Existing score, fouls, correction and game-clock behavior unchanged.
7a. Inactive players are not selectable in any panel; their history is preserved (§4).
8. Implementation report (§19) is complete and truthful.

Outcome vocabulary — only:

- **PASS — Interaction Shell**
- **FAIL / REVISE**

This gate must **not** conclude PASS — Basic Pilot, PASS — Extended Pilot, production ready, offline ready, or Cloudflare ready. Those require later implementation (statistics events, possession and midcourt-crossing clock models with category/organizer configuration, audited clock/corrections, offline capture, Cloudflare) and separate validation.

## 16. Automatic failure conditions

Any one yields **FAIL / REVISE**:

- wrong player, team or action recorded;
- duplicate or missing scoring action;
- a gesture (scroll, swipe, panel switch) generates a sporting event;
- a prototype action is persisted (any IndexedDB write, any storage, any appearance in totals/history);
- either timer-area prototype mutates game-clock state;
- the two timers are merged, or presented as two reset values of one clock;
- timer durations presented or stored as product configuration;
- an inactive player is selectable for scoring in any panel, or inactive players’ history is hidden/lost;
- the roster fix is applied inside `usePartido`/shared hooks or uses a predicate other than `activoDe`;
- any primary control below the 44×44 absolute minimum;
- inaccessible or overlapping controls;
- horizontal page scrolling;
- inability to return immediately to Puntos;
- per-row panel divergence (any row showing a different panel);
- sticky controls hiding essential player information (identity, totals, or action buttons);
- regression in existing score, fouls, correction (Undo/Redo/Anular) or clock behavior;
- UI copy or tests claiming prototype features are complete, saved, audited, synchronized or offline-capable;
- any change outside the authorized file list, or a new dependency/schema change.

## 17. Rollback boundary

The shell must be **fully reversible**: reverting the implementation commit(s) (or discarding changes to `Consola.jsx`, the console CSS and `Consola.test.jsx`) restores the exact `155d062` behavior. Therefore: no schema/data migrations, no new persisted fields, no changes to shared libraries, no changes to other screens’ CSS. Data created during validation (real events from functional taps) uses only existing event shapes and needs no cleanup logic. Prototype state leaves no data to clean up.

## 18. Implementation-agent prohibitions

The implementation agent must **not**:

- implement advanced-statistics events/projections, a possession-clock or midcourt-crossing-clock model, timer duration configuration (category defaults/overrides), the final clock contract, append-only corrections, offline capture or any Cloudflare work;
- edit `marcador*.js`, `reloj*.js`, `db.js`/schema, `datos.js`, `seed.js`, service worker, config, or dependencies;
- persist any prototype/shell state (IndexedDB, localStorage, sessionStorage, cookies);
- add AI to the capture path;
- use v0 or any generated-UI service; deploy; provision anything;
- fix the inactive-player defect any way other than the single `activoDe` filter in `Consola.jsx` (§4); no edits to `usePartido`, `datos.js`, `roster.js` or `identidad.js`;
- touch `docs/product/` or any documentation;
- create a branch, commit or push unless **separately instructed**;
- declare PASS — Basic Pilot / Extended Pilot / production / offline / Cloudflare readiness;
- invent features beyond this brief (no extra actions, panels, or settings);
- weaken or delete existing behavior to make tests easier.

If a requirement cannot be met within the authorized files, **stop and report**; do not widen scope.

## 19. Required implementation report

The implementation agent must finish with a clearly labeled **REPORT** containing:

- **Branch and HEAD** (exact `git rev-parse --abbrev-ref HEAD` and `git log --oneline -1`);
- **Files changed** (exact list);
- **Behavior implemented** (state explicitly how the `activoDe` roster repair was applied);
- **Behavior intentionally not implemented** (reference §6);
- **Tests added** (names mapped to §13 items 1–15, with the handling chosen for item 13);
- **Focused-test result** (`npx vitest run src/pantallas/Consola.test.jsx`);
- **Full-suite result** (`npm test`);
- **Build result** (`npm run build`);
- **Manual validation still required** (§14 steps not run; Android/PWA);
- **Known limitations** (including jsdom’s inability to verify layout/scroll, any touch-size exceptions, futsal gating choice, swipe included or omitted, sticky height budget);
- **Exact Git status** (`git status --short`);
- **No commit/push** unless separately authorized — state explicitly whether any occurred.

Overall outcome statement must be one of: **“Interaction Shell — ready for manual Android validation”** (before the manual gate) or, after the manual gate, **PASS — Interaction Shell** / **FAIL / REVISE** — and nothing stronger.
