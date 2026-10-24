# Home "Próximos partidos" — recorded future UX (NOT implemented)

Status: notes only (REPORT_214). Nothing here exists in the code. Current behavior (REPORT_213): chronological list of `programado` games whose time has not passed, three
visible at first, "Ver más partidos" to reveal the rest (up to 20), undated games last under "Fecha por confirmar".

## Two DIFFERENT grouping concepts — do not merge them
1. **Organizer grouping** — group games by who organizes the league/tournament (for example, several leagues run by one organizer). Needs a *public* organizer
   identity that the public league read does not carry today (organizer ownership is private to the organizer session, and the organizer's name is deliberately never published).
   Prerequisite: an explicit product decision on what organizer information is public, then a public field.
2. **Court grouping** — group games by where they are played (the `sede` / venue of each game, or a court identifier). Today `sede` is free text and optional; grouping needs a stable
   court identifier or a normalization rule (so "Cancha A" and "cancha a" are one court), and a decision on how games without a venue are shown.

They answer different questions ("what is happening in my organizer's events?" versus "what is on at this court?"), have different data prerequisites and may be combined
with the date filter independently. Keep them as separate requirements, controls and tests.

## Related follow-up already noted
* A date filter ("Hoy / Mañana / todas") can reuse the Panama day keys the list already computes; no new data is needed.
