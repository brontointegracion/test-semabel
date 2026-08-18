# v0 Brief — Sebel Home Page

## Scope

Design the **Home page only** — a sports discovery screen for an amateur/street-sports platform called Sebel. Do not generate the whole product, other pages, or a design system beyond what this page needs.

## Authoritative specs

Two documents accompany this brief and are authoritative over any assumption you'd otherwise make:

- `HOME_SPEC.md` — what the page contains and does (content, data regions, filters, states, links).
- `HOME_UI_SPEC.md` — how it should look and adapt across screen sizes (hierarchy, composition, responsive rules, failure-prevention checklist).

Treat both as ground truth. Where you'd normally guess at a feature or a piece of content, check them first. **Do not invent product features not described there** — no calendar page, no notifications, no footer with legal links, no "trending" module, no extra sports beyond baloncesto and futsal, no match-day/round numbers, no country selector.

## What this product is

Sebel is a **responsive web application / PWA**, not a marketing website. It's used the way an app is used — opened repeatedly, scanned fast, acted on with a thumb. The product itself (real live scores, real teams) is the pitch. Do not design a landing page that sells the idea of the product instead of showing it.

Same product identity, same content regions, same priority order across mobile and desktop — but genuinely composed for each, not one stretched into the other.

Home is built for the visitor/fan first. Organizer acquisition is secondary — "Soy organizador" stays reachable, but it is not the hero's pitch.

## Direction

- **Light theme only.** White/off-white canvas. No dark mode, no dark hero.
- One strong, restrained accent color for live/active state — not a decorative fill.
- Sports/community energy in the spirit of **Strava**, and typographic/whitespace/responsive restraint in the spirit of **Pluralsight** — inspiration for quality and discipline only. Do not copy either product's layout, components, or branding.
- Clean, modern, professional. **Not** a SaaS admin dashboard. **Not** a stat-tile grid. **Not** an electronic-scoreboard theme applied to the whole page.
- No gradients-as-texture, no glassmorphism, no stacked drop shadows, no giant marketing hero pushing sport content down the page.
- No overlapping elements, no clipped essential text, at any width.

## Hierarchy (top to bottom / by visual weight)

1. Compact identity/nav (wordmark + session control — not a hero). A small value statement may exist below it — if so, it sells local discovery ("qué se juega cerca de ti, ahora"), not scheduling or scoring software.
2. Remembered filters: province, sport, category — shown as already-applied, not an empty form
3. **Ahora mismo** (live matches) — the dominant content when present; score is the single most legible element on the page
4. **Lo que viene** (upcoming) — important, but clearly secondary to Ahora mismo whenever live matches exist; follows immediately below with lower visual weight. When there are no live matches, Lo que viene may become the dominant sports region.
5. Local league/team discovery
6. Figures (top scorers, cross-league)
7. Search
8. Sponsor slot — always visually secondary; must never appear before the visitor has received live/upcoming sports content — its earliest legitimate position is after Lo que viene. Not required to be strictly last among everything that follows.

## Deliverables

- **Desktop and mobile**, both genuinely composed (not one scaled from the other). Check the failure-prevention checklist in `HOME_UI_SPEC.md` at 320/375/390/430px mobile widths, tablet, standard desktop, and wide desktop.
- Cover these real states, not just the happy path: multiple simultaneous live matches; zero live matches; many upcoming matches; zero ligas in a country (empty page state); zero search results; long team/liga/cancha names; different score digit lengths (single digit through triple digit).

## Placeholder content

Where sample content is unavoidable, use realistic **Latin American Spanish** names and terms consistent with the product's own vocabulary — liga, cancha, provincia, ahora mismo, lo que viene. Example flavor: team names like "Halcones", "Titanes del Norte", "Toros de David"; ligas like "Liga Barrial San Miguelito"; canchas like "Cancha Don Bosco", "Polideportivo El Chorrillo"; Panamanian provinces (Panamá, Chiriquí, Bocas del Toro, Darién). Do not use English placeholder copy ("Lorem ipsum", "Team A vs Team B") anywhere visible.

## Final instruction

Produce a polished, high-fidelity visual implementation of this page — desktop and mobile — that can later be exported and adapted into an existing production codebase. It should look and feel like a real screen of a real app, not a mockup or a marketing concept.
