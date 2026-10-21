# Sponsor artwork guidelines (REPORT_192)

How to prepare advertising for the big scoreboard. **Measured** = taken from the implemented slots (headless Chrome, scratch build, canvas in
presenting/fullscreen mode; evidence in `~/Documents/SEBEL/evidence/REPORT_192/`). **Recommendation** = guidance, not enforced by the code.
Where the manifest goes and how it is validated: `docs/display/medios-piloto.md`.

## 1. Two formats

| | A. Structured card (`"formato": "tarjeta"`) | B. Finished artwork (`"formato": "arte"`) |
|---|---|---|
| Who composes it | Semabel (one consistent layout, the approved v0 card) | the advertiser/designer |
| You supply | company name, short descriptor, optional logo, brand colours | one finished image (optionally a second one for the expanded slot) |
| Shown as | rendered card: logo mark + descriptor (small, tracked capitals) + large name | the image, whole, centred, on its own background (`fondo`) |
| Text in the image | not needed: do **not** bake the name or descriptor into the logo | everything is in the image (Semabel adds no text) |
| Fits both slots | automatically (same card, scaled) | **no**: a 25:6 banner and an 8:5 panel are different compositions, see §3 |

Format is independent of who the advertiser is: organizer-supplied sponsorship and Semabel-supplied advertising use the same two formats and the
same display component. The manifest has **no** field for owner, package, price, priority, exposure or slot; none is implied (see §8).

### Fields Semabel renders for a structured card
`nombre` (required, large, ≤ 60 characters), `descriptor` (optional, ≤ 40 characters, shown in capitals with letter-spacing in the accent colour),
`logo` (optional local image), `fondo` (card background), `texto` (name colour), `acento` (descriptor colour), `borde` (`true` = thin outline, for white cards).
Nothing else is rendered: no slogan, address, phone, web address, QR code, price or offer. If an advertiser needs those, use format B.
Colours are `#RRGGBB` only. If `texto` is not readable on `fondo` (contrast below 3:1) the name is drawn in white or near-black instead; an unreadable
`acento` (below 2.2:1) falls back to the name colour. The six colour sets of the v0 design pass unchanged.

## 2. Measured slot geometry (canvas 1920×1080; every size scales with the canvas height)

| Slot | Where | Tile (CSS px) | Ratio | Rounded corner | Notes |
|---|---|---|---|---|---|
| **Live** | band under the scoreboard (two tiles side by side, gap 21.6 px) | 899.5 × 216 | 4.164 : 1 (≈ 25:6) | 19.4 px | permanent during play; rotates every ≈ 12 s |
| **Expanded, between periods** | stage under the score strip (two tiles) | 899.5 × 574.6 | 1.565 : 1 | 19.4 px | alternates with the Semabel promotion |
| **Expanded, final** | stage under the result cards (two tiles) | 899.5 × 553.0 | 1.627 : 1 | 19.4 px | alternates with the Semabel promotion |

Same slots at other canvas sizes (ratios are identical): 1280×720 → live 599.7 × 144, expanded 599.7 × 383.1 / 368.7; 3840×2160 → live 1799 × 432,
expanded 1799 × 1149.2 / 1106.
**Phone (≤ 640 px wide, measured at 390 px):** live tile 177 × 88 (2.0 : 1); expanded tile 362 × 166 (2.2 : 1, one tile per row). Phones are much squarer
than TVs: a 25:6 banner shows only 177 × 42.5 px there. When `imagenGrande` exists the phone uses it (also for the live band).

### Structured-card internals (measured, 1080p)
| | Live band | Expanded |
|---|---|---|
| Horizontal padding | 43.2 px | 43.2 px |
| Logo/mark area (height × max width) | 97.2 × 194.4 px (9u × 18u) | 162 × 216 px (15u × 20u) |
| Name | 86.4 px (8u), long names shrink: 6u / 5u / 4u | 129.6 px (12u), long names shrink: 9u / 7u / 6u |
| Descriptor | 25.9 px, tracking 0.14 em | 36.7 px, tracking 0.14 em |
| Name length classes | ≤ 12, ≤ 20, ≤ 40, > 40 characters: one line when it fits, up to 2 lines (3 for > 40 in the expanded slot) | |

The logo is shown with `object-fit: contain`: never stretched or cropped. A square logo fills the area; a logo wider than 2:1 (live) or 4:3 (expanded)
becomes proportionally smaller. **Wide wordmarks are better delivered as format B.** Do not put the company name inside the logo (it is already the large name).

### Logo-led structured card (`"disposicion": "logo"`, REPORT_194)
For a logo that already contains the company name (e.g. a 1600×1026 JPEG on black), the standard 9u/15u icon slot would shrink it. With `disposicion: "logo"` the card keeps the structured-card
system (background/text colours, rendered descriptor, accessible name) but gives the logo the card: live band = logo on the left at the card's full usable height and the descriptor beside it; expanded
slots and phones = logo on top, descriptor centred below. The name is *not* drawn as another title. Measured with a 1.56:1 logo at 1080p: live tile 825×198 → logo 259×166, descriptor 35.7 px;
expanded tile 825×527 → logo 639×410, descriptor 43.6 px; at 390 px: live 165×88 → logo 76×49, descriptor 10 px; expanded 338×164 → logo 188×120, descriptor 14 px. Set `fondo` to the logo's own background
colour so the logo's edges disappear. Use a high-resolution file (≥ 1200 px wide recommended); the logo is shown whole, never cropped or stretched.

## 3. Finished artwork: how it fits each slot

The image is drawn with `object-fit: contain` inside the tile, centred, on the `fondo` colour (white if omitted), inside the rounded corners.
It is never distorted or cropped; if its ratio differs from the tile, the difference appears as bars of `fondo`.

* `imagen` is used in the **live band** (TV) and as the fallback everywhere.
* `imagenGrande` (optional) is used in the **expanded slots** (between periods, final) and **on phones**. If absent, `imagen` is used there and letterboxed.
* Supply **two images** if the advertiser wants it to look intended in both slots: one banner (≈ 25:6) and one panel (≈ 8:5).
* If an image fails to load the next candidate is tried (`imagenGrande` → `imagen`); if none loads, the card built from `nombre` / `descriptor` / colours
  is shown; with no `nombre`, the Semabel promotion takes the place. A missing image never leaves an empty hole or a broken-image icon.

### Recommended pixel sizes (recommendation; derived from the measured ratios)
| Use | Ratio | Recommended file size | Why |
|---|---|---|---|
| `imagen` (live band) | 25:6 | **1800 × 432 px** | tile is 900 × 216 CSS px at 1080p (2× sharp) and 1799 × 432 at 4K (1:1); ratio matches within 0.1 % |
| `imagenGrande` (expanded, phones) | 8:5 | **1920 × 1200 px** | expanded tiles are 1.565–1.627:1, so 8:5 (1.6) leaves at most 1.1 % bars (top/bottom in the break slot, 0.8 % left/right in the final slot) |

Templates (no branding, guide layer in group `guias`, delete before export):
`docs/display/templates/sponsor-live-25x6-1800x432.svg` and `docs/display/templates/sponsor-expanded-8x5-1920x1200.svg`.

### Wide, tall and square artwork (measured results at 1080p)
| Artwork | In the live tile 899.5 × 216 | In the expanded tile ≈ 899.5 × 553 |
|---|---|---|
| 25:6 banner | fills it | 899.5 × 216 (letterboxed, 39 % of the height) |
| 8:5 panel | 345.6 × 216 (38 % of the width) | fills it (≤ 1.1 % bars) |
| 1:1 square | 216 × 216 | 553 × 553 |
| 1:2 tall | 108 × 216 (12 % of the width) | 276 × 553 |

So: do not use one image for both slots unless its content survives both crops; tall artwork is only sensible in the expanded slot.

## 4. Safe margins (recommendation) and the rounded corners (measured)

* The card corners are rounded (radius 19.4 px at 1080p = 9 % of the live height). A point 0.3 × radius inside each corner is already clear of the curve.
* Televisions may crop the edges (overscan). Keep every logo, name and phrase inside a **5 % safe area on each side**: for 1800 × 432 that is 90 px left/right and 22 px top/bottom;
  for 1920 × 1200, 96 px left/right and 60 px top/bottom (the templates draw it).
* Make the artwork's outer edge the same colour as `fondo` so letterbox bars are invisible.

## 5. Legibility (recommendation, expressed with the measured proportions of Semabel's own card)

The approved v0 card text is the reference for "readable on a TV": in the live band the descriptor is 12 % of the tile height and the name 40 %; in the expanded slots
6.6 % and 23 %. Artwork text should not be smaller than that:

| | Smallest text | Main name |
|---|---|---|
| 1800 × 432 (live) | ≥ 52 px | ≥ 170 px |
| 1920 × 1200 (expanded) | ≥ 80 px | ≥ 280 px |

Keep it to a name, one short line and (optionally) a logo. Long sentences, phone numbers or addresses are not readable at a distance.
Viewing distance was not measured; do not assume more than this.

## 6. Colour and contrast
* Use a deliberate, opaque background and set `fondo` to it. Do not rely on transparency: a transparent PNG with white lettering on the default white `fondo` is invisible.
* Aim for contrast of at least 4.5:1 between text and background (WCAG large-text minimum is 3:1; the card guard uses 3:1). Avoid pure-white artwork on the cream scoreboard surround; the card
  border or a coloured `fondo` separates it.
* Test the artwork in both the dark and light surround of the scoreboard canvas (`#F5F3EE`).

## 7. File formats and sizes
* **Allowed (enforced):** `png`, `jpg`/`jpeg`, `webp`, `gif`, `svg`, as local files under `public/medios/`, referenced by a relative path (letters, digits, `._-/`, ≤ 120 characters; no URLs, no `..`, no hidden folders).
  SVG is loaded as an image: scripts and external references do not run; embed or outline fonts, because the viewer's fonts are not available. Use a static image (not an animated GIF).
* **Measured build limit:** the build precaches `png` and `svg` files only up to **2 MiB**; a larger one *fails `vite build`* (checked with a 2.6 MB test file, then removed). `jpg` and `webp`
  are not in the precache pattern: they load from the network when first shown (no offline copy).
* **Recommendation:** keep each file ≤ 500 KB (PNG/SVG ideal for a venue with weak connectivity), at most ~12 sponsors, and rebuild after replacing a file.

## 8. Commercial context (documentation only)
The user wants both organizer-supplied sponsorship (potentially a higher-priced package) and Semabel-supplied advertising. **Nothing about prices, packages, exposure guarantees, slot allocation or priority is
implemented or implied.** The code only does this today: sponsors in the manifest appear two at a time in manifest order, each pair for ≈ 12 s; an odd last sponsor is paired with a Semabel promotion card;
with no sponsors the Semabel promotions are shown. That is behaviour, not a commercial commitment. Artwork format (§1) is deliberately independent of who supplies the advertising or under which package; any
ownership/package/priority rules are a separate product decision.

## 9. Preview checklist
1. Put the files in `public/medios/`, add the entry to `public/medios/manifest.json`, rebuild.
2. Open a live game, a game between periods and a finished game of that league; wait through the rotation (≈ 12 s per pair).
3. At 1920×1080 and 1280×720 (browser fullscreen) and at 390 px wide: the name/logo are fully visible, inside the safe area, not touching the rounded corners.
4. Artwork: no stretching, bars invisible, the same impression in the live and the expanded slot (or a deliberate `imagenGrande`).
5. Rename the file temporarily to check the fallback (card with the name, or the Semabel promotion): nothing broken or empty.
6. Check contrast on the actual TV (glare, distance) before the event; this was not measured here.
