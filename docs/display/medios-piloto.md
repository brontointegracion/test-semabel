# Pilot media for the big scoreboard (REPORT_191)

The big public scoreboard (`/liga/<league>/partido/<game>`) can show team logos, an organizer logo and sponsors.
Everything is **manually configured, local and static**: there is no upload service, no admin screen and no external image or font.

## Where the user supplies images

Put the files under **`public/medios/`** and describe them in **`public/medios/manifest.json`** (it ships empty:
`{ "version": 1, "ligas": {} }`). The app reads that one file once per page load; a missing, broken or partially wrong manifest only
means "no media" (each bad entry is skipped, the scoreboard never breaks).

```json
{
  "version": 1,
  "ligas": {
    "PLATINIUM-U10": {
      "organizador": { "logo": "PLATINIUM-U10/organizador.png" },
      "equipos": {
        "<TEAM_ID>": { "logo": "PLATINIUM-U10/equipos/cometas.png", "color": "#1F4FA3" }
      },
      "patrocinadores": [
        { "id": "agua", "formato": "tarjeta", "nombre": "Agua Pura", "descriptor": "Agua purificada",
          "logo": "PLATINIUM-U10/patrocinadores/agua.png", "fondo": "#0E6BA8", "texto": "#FFFFFF", "acento": "#BFE6FF" },
        { "id": "cantina", "formato": "arte", "nombre": "Cantina Ejemplo",
          "imagen": "PLATINIUM-U10/patrocinadores/cantina-1800x432.png",
          "imagenGrande": "PLATINIUM-U10/patrocinadores/cantina-1920x1200.png", "fondo": "#1C2B3A" }
      ]
    }
  }
}
```

(`PLATINIUM-U10`, `agua`, `cantina` … are placeholders in this example; the repository manifest contains no entries.)

Optional root entry `"semabel": { "logo": "SMB/semabel-logo.png" }` (REPORT_196): the Semabel logo used in Semabel's promotional cards and in the large promotion panel, instead of the red dot. It is **not** registered in the repository manifest (only in the local review setup); without it, or if the image fails to load, the previous dot-based presentation is shown. The logo already contains "semabel.com", so that address is not repeated beside it (the card's `semabel.com` descriptor and the organizer promotion's footer are omitted; the spectator footer keeps "Sin cuenta para mirar.").

**Live band rotation (implemented):** sponsors appear two at a time in manifest order, each slide ≈ 12 s, followed in every cycle by a dedicated Semabel slide (organizer-facing card + spectator-facing card). With an odd number of sponsors the last one is paired with the spectator-facing Semabel card, so that card appears twice per cycle (the minimum without repeating a sponsor or showing one tile alone). With 0 sponsors the Semabel slide is the only one. The between-period and final stage is unchanged (sponsor pair, then the promotion panel, alternating).

A sponsor uses one of two **formats** (`formato`), described and measured in `docs/display/sponsor-artwork-guidelines.md`:

* `"tarjeta"` (structured card, the v0 design): `nombre` (required), `descriptor`, `logo`, `fondo`, `texto`, `acento`, `borde` (`true` for an outline). Semabel renders name, descriptor and logo.
  * Optional `"disposicion": "logo"` (only with a valid `logo`) selects the **logo-led variant**: the complete logo fills the card instead of the small icon slot, the name is kept only as accessible text (the logo already carries it) and the descriptor is rendered text. Use it for logos that contain their own name. If the logo fails to load, the normal card with the visible name is shown.
* `"arte"` (finished artwork): `imagen` (required), `imagenGrande` (optional, for the expanded break/final slots and for phones), `fondo` (letterbox colour); `nombre`, `descriptor` and the colours are used only if every image fails.
* Without `formato`, entries from the REPORT_191 manifest keep working unchanged: with a valid `imagen` it is `arte`, otherwise a `tarjeta` built from `nombre`.
* Colours are `#RRGGBB` only (an unreadable `texto`/`acento` is corrected). Any other field (HTML, CSS, scripts, links) is ignored.

* **Keys are the stable ids**: the league id (exactly as in `LIGAS_ADMITIDAS`, e.g. `PLATINIUM-U10`) and the team id from the public
  league read (`GET /v1/ligas/<league>/publico` → `equipos[].id`). A league only ever sees its own entry.
* **Paths are relative to `/medios/`** and must be a png, jpg, webp, gif or svg file of this site. URLs, `//`, `..`, absolute paths,
  hidden files and any other extension are ignored.
* `equipos.<id>.logo` appears in the team crest; `color` (optional `#RRGGBB`) is the colour of the team's top bar. Without a logo
  (or if the file is missing/corrupt) the crest shows the team's initials.
* `organizador.logo` replaces the initials mark in the header. The organizer's *name* is never published: the header shows the league
  name (public data).
* `patrocinadores` (at most 12, shown two at a time in manifest order, each pair ≈ 12 s). No sponsors configured → the approved Semabel promotion cards; an odd last sponsor is paired with a Semabel card.
  The fictional v0 sponsors never appear in the repository or on real leagues.

Files in `public/medios/` are copied into the build. The PWA precaches only `png` and `svg` files (and a `png`/`svg` over 2 MiB fails the build); `jpg`/`webp` load from the network when first shown. Replace a file and rebuild to update it. See the artwork guidelines §7.

## What the user still has to provide

**Team logos** are not configured for any league (initials crests are shown). The organizer emblem and the twelve approved sponsors are registered for the real leagues (REPORT_212, below).

## Fonts

The v0 design uses Inter and Barlow Condensed from Google Fonts. The app has no external fonts (CSP `font-src 'self'`) and nothing was
installed, so the stack is system sans (Inter if the device has it) for text and `Barlow Condensed` if present, otherwise a system
condensed face (`Roboto Condensed`, `Arial Narrow`, `Liberation Sans Narrow`, …) for numbers. To get the exact v0 numerals, self-host
Barlow Condensed (OFL licence) with a `@font-face` in `src/pantallas/publico/marcador-tv.css`.

## Reusable for automatic organizer TV sequencing (the next task)

The pieces below are pure and take explicit inputs, so a future "organizer TV" screen can reuse them without changes:

* `src/lib/publico/vista-marcador.js`: `vistaDelMarcador` (server state → `programado | juego | fin-periodo | fin-tiempo | final`) and
  `proximoPartido(partidos, actual, alcance)`: returns the next game **only** for an explicit `alcance` (`{ sede: true }` today) and only
  when unambiguous. `PartidoPublico` accepts `alcanceProximo` but nothing passes it yet, so a fixed-game URL shows an honest "no next game" card.
* `src/pantallas/publico/MarcadorTv.jsx`: `VistaJuego`, `VistaDescanso`, `VistaEntrePartidos` (presentation only; the between-games view takes an
  already-resolved `proximo`).
* `src/lib/publico/hook-reconocimiento.js` + `reconocimiento.js`: baseline/new/duplicate/undo/reconnect logic for the scoring notice.
* `src/lib/publico/medios.js`: manifest reading, per-league media, sponsor pairing.
* Still missing for sequencing: a way for the organizer to choose/declare the scope and order (today `/tv` is a manual list), switching to
  the next game when the current one is finalized, and the policy for overlapping/tied start times.

## Production media registered in the repository (REPORT_202)

`public/medios/manifest.json` is no longer empty. It was prepared **locally** from the approved scratch configuration; nothing is published or deployed by this change.

**Shared branding (root, every league):**
* `semabel.logo` = `SMB/semabel-transparente.png` (652×333, RGBA, real alpha): used by Semabel's own promotional cards and the dashboard header. The older opaque `semabel-logo.png` is NOT shipped.

**Registered media (REPORT_209 and REPORT_212):**
* `SIMULACRO-PILOTO` (unchanged): organizer emblem `PLATINIUM/platinium-logo.png` (354×353) and six sponsors.
* `PLATINIUM-U10` and `PLATINIUM-U12` (two identical entries): the same emblem and **twelve sponsors**, in this order (all `formato: tarjeta`, `disposicion: logo`, no `descriptor`; the sponsor name is only
  accessible text, the lettering lives in the image): `parmigiana` (La Parmigiana, `PARM/parmigiana.jpeg`), `workings` (WORKINGS), `pce` (Panama Crystal Engineering), `javier-del-rio` (Javier del Rio Corp),
  `deportes-jimmy` (Deportes Jimmy), `pixeles` (Píxeles & Diseños, S.A.), then the six added in REPORT_212:

| id | name | file | px | bytes |
|---|---|---|---|---|
| `rodsan` | Casa de campo RODSAN | `RODSAN/rodsan-logo-recorte-v2.jpeg` (square crop of the complete badge; `nombreEnBanda: true`, background `#323436`) | 802×802 | 177 015 |
| `effort-bull-kennels` | Effort Bull Kennels | `EFFORT/effort-bull-kennels.jpeg` | 1156×988 | 156 242 |
| `adminplayers` | AdminPlayers | `ADMINPLAYERS/adminplayers-recorte.jpeg` | 653×668 | 99 684 |
| `panteras` | Club Deportivo Panteras | `PANTERAS/panteras-logo.png` | 1598×1480 | 179 964 |
| `bethancourt-asociados` | Bethancourt & Asociados | `BETHANCOURT/bethancourt-asociados-blanco.png` | 931×762 | 354 257 |
| `symisa` | SYMISA | `SYMISA/symisa.jpeg` | 849×829 | 36 483 |

**Team logos (REPORT_216).** `PLATINIUM-U10` and `PLATINIUM-U12` register `equipos` entries (`{ "logo": "EQUIPOS/<slug>.jpg" }`, no colour) for **eighteen separate team IDs** that reuse **nine** image files; sharing a file never merges teams
(each ID keeps its own record, name, initials fallback and history). Mapping (confirmed by the user and matching the labels printed beside each image in the proposal PDF's schedule table): `deportivo-vip.jpg` ← U10 Deportivo, U10 VIP, U12 Deportivo VIP;
`unity-basketball.jpg` ← U10/U12 Unity Basketball; `correcaminos.jpg` ← U10/U12 Correcaminos; `hardwork.jpg` ← U10/U12 Hardwork Basketball, U12 Hardwork West; `west-hornets.jpg` ← U10/U12 West Hornets; `grizzlies.jpg` ← U10/U12 Grizzlies;
`grillos-vip.jpg` ← U10/U12 Grillos VIP; `cross-level.jpg` ← U10 Cross Level; `west-boys.jpg` ← U12 West Boys. The files are the embedded JPEG originals extracted from that PDF unchanged (1271–1536 px tall, 1.6 MB in total); the PDF itself is used only as a
logo source (its dates and fixtures are outdated and are not imported) and is kept outside the repository, as are the extracted originals and the contact sheet. The scoreboard already consumed `equipos` logos (crest with `object-fit: contain`; a missing or broken file falls back to the team's initials).
JPEGs are not in the PWA precache glob, so these logos load on first use and are not available offline. `SIMULACRO-PILOTO` has no team logos.
**Visual approval (recorded in REPORT_217):** the user approved all nine team logos and all eighteen mappings from REPORT_216 after reviewing the contact sheet, **including West Boys as supplied** (its original artwork keeps a small text fragment at the bottom edge; it stays unedited).
This is a visual approval of the artwork and mappings only; it is not a production or physical-device acceptance, and nothing is deployed.

`La Parmigiana` has no descriptor («Restaurante italiano» was removed in REPORT_209). Files were copied byte-identically from the review fixture (`~/Documents/SEBEL/rehearsals/REPORT_191/medios-fixture/`);
originals, superseded crops, PDFs and backup manifests are NOT shipped; only referenced files are present (guarded by `src/lib/publico/medios-produccion.test.js`). Largest asset: `JDR/javier-del-rio.png`
(1.27 MB; the PWA precache limit is 2 MiB per file, so a bigger png would fail `vite build`). **Precache:** the PWA precaches only `png|svg|js|css|html|woff2` (`vite.config.js`), so the two new PNGs
(Panteras, Bethancourt: +0.51 MiB) join the precache while every `.jpg/.jpeg` (including the earlier Parmigiana and Jimmy, and now RODSAN, Effort Bull, AdminPlayers, SYMISA) is fetched from the network on first use and is
not available offline. The six sponsors requested later that were still missing in REPORT_209 are now supplied (items 7–12 above).
