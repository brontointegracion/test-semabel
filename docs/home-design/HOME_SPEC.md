# Home — Behavior & Content Contract

Status: specification, not implementation. Describes what the existing `/` route (`src/pantallas/Inicio.jsx`) contains and does today, as the authoritative content contract for any visual redesign. Source of truth: `REQUISITOS.md`, `src/pantallas/Inicio.jsx`, `src/App.jsx`, and the hooks/helpers `Inicio.jsx` imports.

This document answers **what Home must contain and do.** It does not prescribe visual styling — see `HOME_UI_SPEC.md` for that.

---

## 1. Page mission

Home is Sebel's public sports-discovery surface. Per `REQUISITOS.md` §3 ("Goals") and §6 ("Hard rules — What is public, and what belongs to the owner"), it is the entry point that lets anyone — no account, no install — find out what is being played right now, what is coming up, and who the standout players are, scoped to their own country and to whatever they've already told the product they care about (province, sport, category).

Home is not a marketing page that happens to mention sports. Per the product's own framing: **the product is the marketing.** A live score is the pitch; a paragraph about live scores is not.

## 2. Actors

| Actor | What they get on Home |
|---|---|
| **Guest** (no account) | Everything on this page. No login wall exists anywhere on `/`. |
| **Organizer** (session established via the button in `<Marca />`) | The same page, plus an additional tab bar entry (`Mis ligas`, `Saldo`) rendered by `App.jsx`, not by `Inicio.jsx` itself. Home's own content does not change based on organizer status. |

Confirmed in `src/App.jsx`: `/` has no route guard (`SoloOrganizador` wraps only owner-only routes like `/nueva`, `/saldo`, `/canchas`, the console, and `/l/:slug/retar`). Home is unconditionally public.

## 3. Public access behavior

- Reachable from a cold, unauthenticated link with zero setup.
- Must render fully for a first-time visitor whose country has already been detected (see §4) — this is not optional per-visitor state, it is app-wide state set before the router mounts.
- No modal, paywall, or interstitial may block any part of Home's content from an unauthenticated visitor.

## 4. Information hierarchy (existing, authoritative)

In current `Inicio.jsx` order:

1. `<Marca />` — brand wordmark + organizer/guest session control (shared header, not part of Home's own layout).
2. Hero block — headline, one paragraph, and a small stat strip (ligas / provincias / canchas counts for the visitor's country).
3. Sponsor banner.
4. Empty state (if the visitor's country has zero ligas) — short-circuits everything below.
5. Filters — province, sport, category.
6. Live/upcoming switch and its content (`Ahora mismo` / `Lo que viene`).
7. Cross-category link (only when a specific category + specific sport are both selected).
8. Figures podium (top 3 scorers in the region).
9. Search (ligas/equipos/jugadores) with a "view all ligas" fallback.

**Per your instruction, the target hierarchy for a redesign is:**

1. Sebel identity/navigation
2. Remembered context (province/sport/category)
3. Live activity — `Ahora mismo`
4. Upcoming — `Lo que viene`
5. Local league/team/player discovery
6. Figures/statistical discovery
7. Search/discovery
8. Sponsorship (always visually secondary; must never interrupt or compete with live or upcoming sports content, but its exact responsive position is not fixed to last)

This reorders presentation only. Every data source, hook, and behavior listed below must survive the reorder unchanged.

## 5. Content/data regions and their real Sebel source

| Region | Backing hook / data | Notes |
|---|---|---|
| Stat strip (ligas/provincias/canchas counts) | `useDescubrir()` → `totales`, computed from `ligas.filter(l => l.pais === region.pais)` | Counts are **country-scoped**, not global. |
| Province filter | `useRegion()` for current value; `provincias` computed via `useMemo` from `d.ligas` filtered to `region.pais`; `cambiarProvincia()` from `lib/region.js` to change it | Includes an explicit "todas las provincias" option. Only rendered when more than one province exists in-country. |
| Sport filter | `DEPORTES` constant (`todos` / `baloncesto` / `futsal` — **exactly these two sports**, no more); `cambiarDeporte()` | Sport list is fixed in code, not data-driven. |
| Category filter | `categorias` computed via `useMemo` from `d.ligas`, excluding `'Libre'`; `cambiarCategoria()` | Only rendered when more than one non-Libre category exists. Categories are free-form strings set per liga (e.g. `40+`, `45+`) — not a fixed enum. |
| Live section (`Ahora mismo`) | `vivosF` = `d.vivos` filtered by `pasa()` (country + sport + province + category); each match's score from `marcadorEquipo(eventos, equipoId)` computed from live event data, not a stored total; live clock/period from `<RelojVivo />` | See §6 for full live-state contract. |
| Upcoming section (`Lo que viene`) | `proximosF` = `d.proximos` filtered by `pasa()`, capped at 20, grouped by day | See §7. |
| Cross-category link | Rendered only when `categoria !== 'todas' && deporte !== 'todos'`; links to `/cat/:deporte/:categoria` | Existing route `Categoria.jsx`, not part of Home itself — only the entry link is. |
| Figures podium | `useFiguras()` → `figuras.anotadores`, top 3 shown, each with team badge, name, points-per-game average; links to `/figuras` for the full table | Cross-liga, scoped to the visitor's region. |
| Search | Local `busca` state; matches ligas/equipos/jugadores by substring on name, case-insensitive, **only after 2+ characters typed**; capped results (5 ligas / 6 equipos / 6 jugadores); "ver todas las ligas" toggle as a fallback when no search is active | Search is a scale mechanism — the product is explicitly designed to work at hundreds of ligas, not just the seeded handful. |
| Sponsor banner | Static placeholder content ("Espacio patrocinado", "TU LOGO") | No dynamic sponsor data exists yet. See `REQUISITOS.md` §6: "Advertising never touches the match... belongs on discovery surfaces — the home page, the news list." Home is a legitimate, sanctioned location for this. |

## 6. Live state — exact contract

- A match is "live" per its stored `estado` field (`'vivo'`), independent of anything client-computed.
- **Score is never a stored number.** It is `marcadorEquipo(eventos, equipoId)`, a sum over that match's event log, recomputed reactively. Any redesign must keep score display wired to this live-recomputed value, not a snapshot.
- Clock/period come from `<RelojVivo />` (`src/ui.jsx`), which self-ticks only while the match clock is actually running (`corriendo(partido)`), throttled to avoid redraw storms, and is period-aware per sport (`PERIODOS[liga.deporte]`, `nombrePeriodo()` → "cuarto" for basketball, "tiempo" for futsal).
- Multiple simultaneous live matches are a normal, expected state, not an edge case — the seeded data regularly has more than one live match across ligas.
- Zero live matches is a normal, expected state — most of the time, most visitors will see zero live matches for their filtered slice. This is not treated as broken or degraded; see empty states (§10).
- Each live match card shows: both team names, both team badges (`<Escudo />`), current score for both sides, liga name, cancha name, and the live clock/period.

## 7. Upcoming state — exact contract

- Sourced from `estado === 'programado'` matches, same filter pipeline as live, capped at 20 results, sorted chronologically (already sorted upstream in `useDescubrir()`).
- **Grouped by day**, with a day-separator (`diaRelativo()` → "Hoy" / "Mañana" / a short date) inserted whenever the day changes between consecutive matches in the sorted list.
- Each row shows: kickoff time (`hora()`), both team badges + names, and the cancha (currently: cancha's `barrio`, not full name — a detail worth preserving or deliberately upgrading, not silently changing).
- Per `REQUISITOS.md` §6 ("Getting there is part of the product"): cancha information on upcoming matches is not decorative — it exists because navigation-to-venue (Waze/Maps) is a stated product requirement on unplayed matches. Home's upcoming rows are one of the surfaces where "where" has to be legible, even if the map links themselves live on the match page rather than in the Home row.

## 8. Filtering behavior — exact contract

- **Country is not a filter the visitor controls.** Per `REQUISITOS.md` §6: detected automatically from IP (falling back to device timezone), never shown, never changeable by anyone — guest, organizer, or venue owner. Home must not present any country selector, ever.
- Province, sport, and category **are** visitor-controlled filters, and all three persist across visits (`lib/region.js`, stored outside React state). A returning visitor sees their last-chosen combination applied immediately, with no re-selection step.
- Filters combine with AND logic (`pasaLiga()`): a match/liga must pass country scoping, then sport (if not "todos"), then province (if not "todas", with an explicit exception for international ligas — see next point), then category (if not "todas").
- **International ligas/tournaments bypass the province filter.** `visibleEn(liga, region.pais)` and the `!liga.internacional` clause in `pasaLiga()` mean a cross-border tournament remains visible regardless of which single province is selected, as long as the country matches. This is deliberate (`REQUISITOS.md` §6: "The border opens only where two communities chose to connect") and must not be simplified away.
- Province and category filter chips are only rendered when there is more than one option to choose from in the current country/data — a single-province or single-category country shows no chip row for that dimension. This is existing conditional behavior, not a loading state.

## 9. Search/discovery behavior

- Single text input, searching ligas, equipos (teams), and jugadores (players) simultaneously by substring match on name.
- Activates only at 2+ typed characters; below that, no search UI is shown and the "ver todas las ligas" fallback list toggle is available instead.
- Results are capped per type (ligas 5, equipos 6, jugadores 6) — this is a deliberate scale decision, not an arbitrary UI limit, and must not be redesigned into an unbounded list.
- A "no results" empty state exists for the case of a query that matches nothing.
- Search results are already scoped to the currently-filtered ligas (`ligasF`), not the whole country — searching does not bypass the province/sport/category filters above it.

## 10. Empty states — exact inventory

All of the following exist today and must have a designed treatment, not a placeholder:

1. **Zero ligas in the visitor's country at all** — short-circuits the entire page below the hero/sponsor; message: "Todavía no hay ligas por aquí. Si organizas una, puedes ser la primera." This is a real, expected outcome for most countries in a global-from-day-one product (`REQUISITOS.md` §6: "Global free, paid country by country").
2. **Zero live matches** for the current filter — "No hay partidos jugándose en este momento. Prueba «Lo que viene»."
3. **Zero upcoming matches** for the current filter — "No hay partidos programados con ese filtro."
4. **Zero search results** for a 2+ character query — "No encontramos nada con «‹query›»."
5. **Zero figures** (`useFiguras()` returns nothing) — the podium component renders nothing at all rather than an empty placeholder (silent omission is the existing behavior).

## 11. Links/navigation from Home

Every one of these is a real route today and must remain reachable from Home:

- A live or upcoming match card → `urlPartido(partido, local, visita)` → match/scoreboard page.
- A figures-podium entry → `urlJugador(jugador)` → player profile.
- "Ver la tabla completa" → `/figuras`.
- A search result → `urlEquipo()`, `urlJugador()`, or `urlLiga()` respectively.
- A liga in the "ver todas" fallback list → `urlLiga(liga)`.
- The cross-category card → `/cat/:deporte/:categoria`.
- `<Marca />`'s session button → toggles organizer session in place (no navigation).

Home does not currently link to: a dedicated calendar view, a footer, or any `/privacidad` `/terminos` `/contacto` `/soporte` page. **None of these exist in the app.** Do not assume or invent them.

## 12. Product constraints (non-negotiable, from `REQUISITOS.md`)

- **Spanish-first, Latin American, not Castilian.** Product vocabulary (liga, cancha, árbitro, provincia, ahora mismo, lo que viene) is not to be translated or genericized.
- **Country is invisible and unchangeable** on this page (§8).
- **No AI in the capture path** — irrelevant to Home directly, but confirms scores shown here are always human-entered event data, never generated or estimated.
- **Sponsorship is always secondary and never touches match/score content** — it may appear on Home, but must not visually compete with or interrupt live match content.
- **The public page's scoreboard-first principle** (`REQUISITOS.md` §6) applies most strongly to the individual match page, not Home itself — Home is a discovery/index surface, the match page is the scoreboard. Do not import "enormous numerals readable from fifteen metres" as a literal requirement for every match preview card on Home; that requirement is about the match page one tap away. Home's job is legible triage across possibly many matches at once.

## 13. Explicit non-goals for this page

- Home is not an admin/organizer console. No editing, creating, or scoring happens here.
- Home is not a login/signup page.
- Home does not show every country's activity — only the visitor's own.
- Home does not show a running feed/timeline of arbitrary events (no "activity feed" concept exists in the product).
- Home does not currently include a dedicated calendar page, notifications center, or footer with legal/contact links — do not add these silently.

## 14. Behavior a visual generation tool must NOT invent

- Do not invent additional sports beyond baloncesto/futsal.
- Do not invent a country selector.
- Do not invent match-day/round numbers ("Jornada 8") — no such field exists in the data model reaching Home.
- Do not invent a footer, legal pages, or contact links.
- Do not invent push notifications, live-updating toasts, or sound effects.
- Do not invent authentication flows, onboarding, or a sign-up call to action distinct from the existing organizer-session button.
- Do not invent sample content that implies real venues, teams, or players beyond generically plausible Latin American placeholder names (see `HOME_V0_BRIEF.md` for placeholder-content guidance).
- Do not invent a "trending" or algorithmic recommendation concept — the podium and search are the only discovery mechanisms that exist.

## 15. Mapping summary (quick reference)

| Concept | File / symbol |
|---|---|
| Region/context state | `src/lib/region.js` (`cambiarProvincia`, `cambiarDeporte`, `cambiarCategoria`) |
| Discovery data | `src/datos.js` (`useDescubrir`, `useFiguras`, `visibleEn`) |
| Score computation | `src/lib/marcador.js` (`marcadorEquipo`) |
| Live clock component | `src/ui.jsx` (`RelojVivo`) |
| Team badge | `src/ui.jsx` (`Escudo`) |
| URL builders | `src/lib/enlaces.js` (`urlLiga`, `urlPartido`, `urlEquipo`, `urlJugador`) |
| Header/session | `src/ui.jsx` (`Marca`) |
| Route wiring | `src/App.jsx` |
