# Home — UI/UX & Responsive Contract

Status: specification, not implementation. This document answers **how Home should behave visually across screen sizes.** It does not generate production CSS, and it does not prescribe pixel values where the underlying decision is genuinely open — those points are called out explicitly rather than guessed.

Companion document: `HOME_SPEC.md` defines *what* must be present. This document governs *how it looks and adapts*. Where the two would conflict, `HOME_SPEC.md` wins — behavior is never sacrificed for visual polish.

---

## 1. Product framing

> **Sebel is a responsive web application / PWA, not a responsive marketing website.**

It is used the way an app is used: opened repeatedly, scanned quickly, acted on with a thumb. It is not browsed the way a landing page is browsed. Every layout decision on Home should be judged against "does this help someone scan live/upcoming sports content fast," not "does this look impressive on first load."

> **Visual references such as Strava and Pluralsight are inspiration for quality and responsive discipline only, not templates to copy.**

Do not reproduce their layouts, components, color systems, logos, or any proprietary visual element. What to take from each:

- **Strava-like**: sports/community energy, activity-forward tone, a product that feels like it belongs to people who actually play, not to a marketing department.
- **Pluralsight-like**: restraint, whitespace discipline, calm typographic hierarchy, a responsive grid that doesn't feel like a stretched phone screen on desktop.

> **The primary Home user is the visitor/fan, not the organizer.** The primary job is fast local discovery: what's live now, what's coming next. "Soy organizador" stays clearly reachable everywhere — it is a utility control, never the thing the hero is selling.

## 2. Mandatory visual direction

- **Light theme.** White/off-white primary canvas. This is a firm requirement, not a placeholder — do not propose a dark theme, dark hero, or dark "scoreboard mode" for the page as a whole.
- One strong, restrained accent color used for state and emphasis (live indicators, active filter, primary action) — not as a decorative background fill.
- Sports-first and community-oriented, not corporate SaaS, not an admin dashboard, not a landing page selling the idea of sports data. The product itself — real scores, real teams, real players — is what has to do the convincing.
- Clean, modern, professional. Restraint over decoration: no gradients used as a texture, no glassmorphism, no drop-shadow stacking, no illustration-heavy empty states.
- Live match content keeps the **strongest visual priority on the page** at all times when any match is live — this is a content-hierarchy rule, not a "make it dark and huge" rule. Priority can be expressed through position, size, and restrained color/motion (a live indicator), without turning the whole page into a broadcast-graphics theme.

## 3. Design principles

1. **Hierarchy through position and type scale, not through decoration.** A live match should read as more important than a sponsor slot because of where it sits and how large its type is — not because one has a border and the other doesn't.
2. **One product, two first-class surfaces.** Mobile and desktop are not the same layout scaled — see §5–§6.
3. **Density is earned, not defaulted.** Show real information (score, time, venue) at a size that's actually legible; don't compress rows just to fit more on screen. See §11 on card/row height.
4. **Every filter and empty state is real UI, not a stub.** `HOME_SPEC.md` §10 lists five empty states that exist in the running product today — a generated design that only shows the "happy path" (multiple live matches, full search results) is incomplete.
5. **Nothing invents product behavior.** If a visual idea implies a feature not listed in `HOME_SPEC.md` (a calendar view, a notification bell, a "trending" module), it does not belong on this page.

## 4. Page regions and hierarchy (visual expression of `HOME_SPEC.md` §4)

In priority order, top to bottom on mobile and left-to-right/top-to-bottom by visual weight on desktop:

1. **Identity/navigation** — compact. A wordmark and the organizer/guest session control. This is a utility header, not a hero.
2. **Remembered context** — province / sport / category, shown as already-applied filters the visitor can change, not as an empty form they must fill out first. A returning visitor should never feel like they're starting over.
3. **Ahora mismo (live)** — the dominant content block whenever it has content. See §7.
4. **Lo que viene (upcoming)** — important, but clearly secondary to Ahora mismo whenever live matches exist; follows immediately below with lower visual weight. When there are no live matches, Lo que viene may become the dominant sports region.
5. **Local discovery** — ligas/teams relevant to the current filter (existing "ver todas las ligas" / search surface).
6. **Figures** — statistical podium, cross-liga.
7. **Search** — can be positioned as a persistent, lightweight entry point rather than strictly last in DOM order, since search is a scale mechanism (`HOME_SPEC.md` §9) that becomes more important as the number of ligas grows. Where exactly it sits relative to #5/#6 is an open decision — see §14.
8. **Sponsorship** — always visually secondary; must never appear before the visitor has received live/upcoming sports content — its earliest legitimate position is after `Lo que viene`. Not required to be strictly last among everything that follows.

> Do not let a large generic marketing hero push live sports activity far down the page. A small brand/value statement may exist if useful, but the product itself is the main attraction.

## 5. Desktop composition

> **Desktop is a first-class product surface, not an enlarged mobile layout.**

- Deliberately use available horizontal width. No narrow phone-width column floating in a wide viewport with large empty margins on either side.
- Multi-column composition where it genuinely helps scanning — e.g., live matches and upcoming matches occupying more horizontal room than a single mobile-width card would allow, or a primary content column plus a secondary column for figures/search/sponsor.
- Generous whitespace is a feature, not wasted space — but "generous" means breathing room around real content, not large decorative empty zones.
- Strong hierarchy must survive the extra width: a wider viewport should not flatten live/upcoming/figures into visually equal blocks just because there's room for all of them side by side.
- Information density should feel like a considered product screen, not a dashboard grid of stat tiles. Desktop Home is still a discovery page for humans, not an operations console.

## 6. Mobile composition

> **Mobile is a first-class product surface, not a reduced desktop layout.**

- App-like, touch-first, primarily single-column.
- Excellent one-handed scanning: the most important information (is anything live, what's the score) should be legible without the visitor needing to read carefully or zoom.
- Live scores must be understood at a glance — team, opponent, score, and live status recognizable in under a second of looking, without requiring the visitor to parse a paragraph of metadata first.
- Navigation appropriate to mobile: the app already uses a bottom tab bar (`src/App.jsx` — Inicio / Mis ligas (organizer only) / Siguiendo / Saldo (organizer only)) for primary navigation. Home's own header stays minimal; do not duplicate primary navigation inside the page body.
- No horizontal layout breakage at any of the required widths (§10): no element may force horizontal scrolling of the page itself, and no text may be clipped in a way that hides essential information (a score, a team name it's identified by, a live/upcoming state).

## 7. Live match visual priority

- When one or more matches are live, that section must be the visually dominant content of the page — largest type for the score, clearest status signal, positioned immediately after the remembered-context filters.
- The **score itself** is the single most important piece of information in a live card: team names, current score, and live status must all be legible without close reading. Clock/period is secondary but present (`RelojVivo` — see `HOME_SPEC.md` §6).
- A live indicator (badge, dot, label — implementation open) should be immediately recognizable and consistent every place "live" appears on the page, but must not rely on motion alone (see §16, accessibility) and must not turn the surrounding card or page into a dark/broadcast-styled treatment. Live is communicated by a focused signal within the light theme, not by re-theming the region around it.
- Multiple simultaneous live matches (§10) must remain individually legible — do not compress live cards to fit more per screen at the cost of score legibility.
- When there are zero live matches, "Lo que viene" may become the dominant sports region for that visit — the empty live state (`HOME_SPEC.md` §10.2) should feel like a calm, ordinary state of the product, not an error or a dead end.

## 8. Upcoming match presentation

- Each row/card must make **who plays, when, and where** legible without requiring a tap — team names, kickoff time, and venue are the three load-bearing facts (`HOME_SPEC.md` §7).
- Day-grouping (Hoy / Mañana / date) must remain visually distinct as a section break within the upcoming list, not just another row.
- Cancha/venue information must not be the first thing truncated when space is tight — per `REQUISITOS.md`, "getting there is part of the product," so venue legibility is a product requirement, not a nice-to-have.
- With many upcoming matches (§10), the list must degrade by becoming a longer, still-legible list (scroll, pagination, or a capped "view more" — implementation open, see §14), never by shrinking row height until information is lost.

## 9. Filters

- Province, sport, and category render as already-selected, easily-changeable controls — chips, segmented control, dropdown, or another pattern is an open implementation choice (§14), but whichever is chosen must:
  - Show the current (remembered) selection clearly without requiring interaction.
  - Support "no filter"/"all" as a real, reachable option for province and category.
  - Handle **many options gracefully** — a country with a dozen provinces or several categories must not overflow, wrap unpredictably, or force horizontal scroll of the whole page. Horizontal scroll *within a single filter row* is an acceptable, common mobile pattern; horizontal scroll of the page is not.
  - Never present a country selector (`HOME_SPEC.md` §8 — country is invisible and unchangeable).
- Sport is a fixed two-option set today (baloncesto, futsal) plus "todos" — do not design a sport-filter treatment that assumes many more sports than that; it should look correct with 2 options and not break if a 3rd is added later, but should not be built as if there are already 6.
- Filters that are conditionally absent (single-province or single-category countries — `HOME_SPEC.md` §8) must not leave a visible empty gap in the layout.

## 10. Explicit failure-prevention requirements

The design must be verified against every one of these before being considered acceptable:

- **No overlapping elements** at any supported width.
- **No text clipping that hides essential information** — a truncated team/liga/cancha name is acceptable *only* if the full name remains available on tap/hover or on the destination page; a truncated score, live-status label, or time is never acceptable.
- **Long team names** (e.g., "Guerreros 24 de Diciembre", "Universidad de Panamá") must truncate gracefully with ellipsis, never overflow their container or push a score off-screen.
- **Long liga names** (e.g., "Liga Barrial San Miguelito", "Copa Chorrillo Fútbol Sala") — same requirement.
- **Long cancha names** (e.g., "Polideportivo El Chorrillo", "Gimnasio Ernesto Sánchez") — same requirement, and must not be the first thing sacrificed (§8).
- **Multiple simultaneous live matches** — must lay out as a legible list/grid, not stack into an unreadably long single column with no visual break, and not compress score type size below legibility.
- **Zero live matches** — the section must not look broken, blank, or like an error; see `HOME_SPEC.md` §10.
- **Many upcoming matches** — must degrade via scroll/pagination/cap, not via shrinking rows (§8).
- **All five empty states from `HOME_SPEC.md` §10** must have an explicit, designed treatment.
- **Different score digit lengths** (single digit through triple digit, e.g. futsal 1–2 vs basketball 60–120) — score typography must accommodate this without the layout shifting or the digits looking mismatched in size between two teams on the same card.
- **Filters with many options** and **filter overflow/wrapping** — see §9.
- **Required breakpoints/widths**: mobile 320px, 375px, 390px, 430px; tablet; standard desktop; wide desktop. The design must be checked at each, not just at one "mobile" and one "desktop" reference size.
- **Navigation must adapt** between mobile (bottom tab bar, already existing) and desktop (a wider viewport should not simply stretch the mobile tab bar full-width — desktop navigation treatment is an open decision, see §14, but it must be considered, not ignored).
- **Sponsor placement** must remain visually subordinate to sport content at every width, including desktop where there is more room and a temptation to give it equal billing.
- **Consistent spacing rhythm** — a single, repeated spacing scale across the page, not ad hoc gaps that vary by section.
- **Touch target size** — every tappable element (filter chip, card, link) must be comfortably tappable on a real phone, not just visually present.
- **Responsive typography** — type scales down for mobile and up for desktop deliberately, not via uniform browser zoom-like scaling that ignores hierarchy.
- **Cards/rows must not become excessively tall or dense** — neither failure mode is acceptable; both are named explicitly because both have occurred in prior iterations of this page.
- **Desktop must not become a stretched mobile layout**, and **mobile must not become a compressed desktop layout** — each is a first-class surface (§5–§6).

## 11. Typography hierarchy (relative, not literal)

Governed by content role, not by copying any reference product's exact type scale:

1. Live score numerals — largest, boldest, most legible role on the page, always tabular/monospaced-figure so digits align and don't jitter in width as they change.
2. Section headings (Ahora mismo / Lo que viene / Figuras, etc.) — clearly larger and heavier than body content, but not competing with the score for dominance.
3. Team/liga/player names — legible at a glance, weight sufficient to read as the "headline" of a row/card.
4. Metadata (time, venue, period/clock, filter labels) — clearly secondary, smaller and/or lower-contrast, but never so faint it fails basic legibility.
5. Body/brand copy (hero paragraph, sponsor copy) — the least visually assertive text role on the page.

## 12. Spacing, surfaces, borders — restraint

- One consistent spacing rhythm/scale applied throughout, not per-component ad hoc values.
- Surfaces (cards, panels) should read as calm, light, low-contrast containers — not stacked drop shadows, not heavy borders everywhere, not competing outline weights.
- Border/radius usage should be restrained and consistent — a small number of radius values reused everywhere, not a different radius per component.
- Accent color usage should be deliberate and sparse: live indicators, the active filter state, and primary calls to action are legitimate uses; using the accent as a general decorative fill (large colored blocks, colored backgrounds behind ordinary content) is not.

## 13. Accessibility fundamentals

- Live status must not be communicated by color alone (a live indicator needs a label/icon, not just a red dot) — this matters both for accessibility and because the previous dark/scoreboard exploration relied heavily on a pulsing color dot as sole signal.
- Sufficient contrast for all text roles in §11 against the light background, including secondary/metadata text.
- Visible focus states for every interactive element (filters, cards, links, the search input) — consistent with the existing app's `:focus-visible` convention of a visible outline, without prescribing the exact token here.
- Respect reduced-motion preferences for any live/pulsing indicator — an equivalent static treatment must exist.
- Touch targets sized for real use (§10).

## 14. Genuinely open decisions

These are not resolved by product requirements or by the mandatory direction above. A generated design may propose an answer, but should not be treated as having "gotten it wrong" if it differs from another reasonable choice here:

- **Filter control pattern** — chips vs. segmented control vs. dropdown vs. another pattern for province/sport/category.
- **Live indicator visual form** — dot + label, badge, border treatment, etc., as long as it satisfies §7 and §13.
- **Exact placement of Search relative to Figures/local-discovery** (§4, item 7) — search's importance grows with scale, but its exact vertical position among the "secondary discovery" regions is not dictated.
- **How "many upcoming matches" degrades** — scroll, "show more" pagination, or a hard cap with a link to a fuller view. `HOME_SPEC.md` confirms no dedicated calendar page currently exists, so "link to full calendar" is not assumable without new product scope.
- **Desktop navigation treatment** — whether the existing bottom tab bar simply persists at desktop width, moves, or is supplemented, is not specified by the current app (`App.jsx` renders the same `tabbar` regardless of viewport today) and is open for the redesign to address thoughtfully.
- **Multi-column arrangement specifics on desktop** — how many columns, and which regions share a row, are open, governed only by the hierarchy and anti-flattening rules in §5.
- **Sponsor visual treatment** — its specific card/banner form, and exactly where it sits *among the regions after `Lo que viene`*, remain open. Whether it can appear before `Lo que viene` is not open — it can't (§4).

## 15. Visual non-goals

Explicitly out of scope for this redesign, regardless of how it's approached:

- Dark theme, dark hero, or an "electronic scoreboard" aesthetic applied to the whole page (this was the previously-explored direction and is now historical only).
- SaaS/admin-dashboard aesthetic — no stat-tile grids, no sidebar-nav-plus-content-panel enterprise layout.
- Large generic marketing hero that pushes sport content down.
- Gradients used as decorative texture, glassmorphism, stacked drop shadows.
- Any visual element that implies a feature not in `HOME_SPEC.md` (calendar view, notifications, trending module, footer with legal pages).
- Literal reproduction of Strava's or Pluralsight's layouts, components, or branding.
- Hero copy that explains organizer/software capabilities (scheduling, scoring, league management) instead of what a visitor gets from opening the page.

## 16. Desktop/mobile parity principle

> The same product information and functionality should remain recognizable across both.

A visitor moving from phone to laptop should recognize Home as the same product with the same content regions in the same relative priority — not a different feature set, not a cut-down mobile version, not a desktop-only richer version. What's allowed to differ: layout (columns vs. stack), information density per screen, and navigation chrome placement. What must not differ: which regions exist, what each region contains, and the relative priority order in §4.

## 17. Quality criteria for approving a generated design

A candidate design should be checked against this list before being accepted:

- [ ] Light theme, restrained single accent color, no dark treatment anywhere on the page.
- [ ] Live content (when present) is unmistakably the most visually dominant region.
- [ ] All eight hierarchy regions from §4 are present, in the specified relative order.
- [ ] All five empty states from `HOME_SPEC.md` §10 have a designed treatment, not a blank gap.
- [ ] Country selector is absent; province/sport/category filters are present and show remembered state.
- [ ] Long names (team/liga/cancha) tested and truncate without breaking layout or hiding essential facts.
- [ ] Multiple live matches and zero live matches both look correct.
- [ ] Checked at 320/375/390/430px, tablet, standard desktop, and wide desktop.
- [ ] Desktop uses horizontal space with real multi-region composition, not a stretched phone column.
- [ ] Mobile is single-column, thumb-usable, with the live score legible in under a second.
- [ ] Hero (if present) communicates local sports discovery, not organizer software capabilities.
- [ ] Sponsor content never appears before `Ahora mismo`/`Lo que viene`, and is unmistakably the quietest region at every width.
- [ ] No invented features (calendar page, notifications, footer, trending, extra sports, match-day numbers).
- [ ] No overlapping elements, no essential text clipped, at any tested width.
