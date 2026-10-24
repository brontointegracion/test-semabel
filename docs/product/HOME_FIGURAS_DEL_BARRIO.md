# Home "Figuras del barrio" — shared mode (REPORT_215)

**Why it was empty.** `InicioCompartido` passed a fixed text prop (`pendiente="Todavía no disponible: las figuras se calcularán…"`) to `Podio`, so the section never read any data. It was an
intentional placeholder from the original shared-mode port (the prototype `Podio` expects `{ anotadores: [{ jugador, equipo, promedio }] }` with a *per-game average*, which the public contract
cannot provide: the server records no games played per player). The league "Jugadores" tab and the team page read real completed-game data through `GET /v1/ligas/{liga}/jugadores/publico` and
`GET /v1/ligas/{liga}/equipos/{equipo}/publico`; the Home simply was not connected (missing integration — not a data defect and not filtering).

**What it shows now.** One podium per league (no global ranking), from the existing public ranking `maximosAnotadores`: **total points in completed games** ("puntos totales").
* Selection: entries with `rango ≤ 3` (ties share the rank and are never cut by name), at most 5 rows per league; if more are tied, the section says how many remain in the league table.
  Order = the server's order (value descending; within a tie: name, number, id — stable, not a sporting criterion). Leagues appear in the Home's league order and respect the Home filters.
* Identity: each row is a registration (ficha) in ONE team, exactly as the server groups it; never merged by name, jersey or person. Rows link to the team page (existing friendly URL); there is no player-profile route.
  The league name heads each podium; each row shows `#number · team`. No private fields or shirt-name aliases are in the contract or on the page.
* States: loading ("Cargando las figuras…"), unavailable (names the league(s) that failed; other leagues still show), no completed games, completed games but no points.
* Requests: reuses `recursoJugadores` (same cache and cadence as the Jugadores tab: one read per configured league on opening the Home, then every 5 minutes while the page is visible; no faster polling).

**Decision still needed for any cross-league ranking.** Leagues differ in category, calendar and games played, and the contract has no games-played or average. A single "barrio" ranking would need an explicit
product rule (which leagues are comparable, which metric). Until then the Home presents per-league podiums only.
