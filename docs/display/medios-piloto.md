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

Nothing is configured for the real leagues (`PLATINIUM-U10`, `PLATINIUM-U12`, `SIMULACRO-PILOTO`): there are no team logos,
organizer logos or sponsor artwork in the repository. Until they are supplied the scoreboard shows initials crests and the Semabel promotion.

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

**Registered only for `SIMULACRO-PILOTO` (one league entry; no other league, no scratch/fictional sponsors):**
* organizer emblem: `PLATINIUM/platinium-logo.png` (354×353);
* six sponsors, in this order (`formato: tarjeta`, `disposicion: logo`): `parmigiana` (La Parmigiana, `PARM/parmigiana.jpeg`), `workings` (WORKINGS, `WORKINGS/workings-logo.png`),
  `pce` (Panama Crystal Engineering, `PCE/pce-logo.png`), `javier-del-rio` (Javier del Rio Corp, `JDR/javier-del-rio.png`), `deportes-jimmy` (Deportes Jimmy, `JIMMY/deportes-jimmy.jpg`),
  `pixeles` (Píxeles & Diseños, S.A., `PIXELES/pixeles-logo.png`).

The other admitted leagues (`PLATINIUM-U10`, `PLATINIUM-U12`) get only Semabel's own promotion plus the shared Semabel logo, exactly as before. Files were copied byte-identically from the scratch fixture
(`~/Documents/SEBEL/rehearsals/REPORT_191/medios-fixture/`); only referenced files are present (guarded by `src/lib/publico/medios-produccion.test.js`). Largest asset: `JDR/javier-del-rio.png`
(1.27 MB; the PWA precache limit is 2 MiB per png, so a bigger png would fail `vite build`; jpg/webp are not precached).
