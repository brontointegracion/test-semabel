# SEBEL — Sede / Venue Product Discovery

## Status

**CAPTURED FOR FUTURE PRODUCT / ARCHITECTURE DISCOVERY**

Implementation is **NOT authorized**.

This document preserves product direction discovered while Stage 3B roster work was in progress. It must not expand the current Stage 3B implementation scope.

The concepts here require future dedicated product and architecture discovery before implementation.


# 1. Purpose

Sebel should eventually support a first-class **Sede / Venue** concept.

A Sede represents a physical/business sports venue that may:

- contain or manage multiple canchas;
- host multiple leagues;
- host different sports;
- have multiple games happening in parallel;
- organize its own leagues;
- host leagues operated by independent organizers;
- provide a public dashboard showing sports activity occurring at the venue.

Example:

`Bar Cohete`

Possible future public route:

`/sede/bar-cohete`

The word `sede` currently appears preferable to `/local/...` for the Spanish product experience.

Final public URL naming is NOT decided and must eventually be reviewed together with Sebel's deferred multilingual/localized routing strategy.


# 2. A Sede is not another League page

A Sede and a League solve different problems.

A **League** represents a competition.

A **Sede** represents a physical/business venue and an additional public discovery surface.

The Sede page should aggregate relevant activity occurring at the venue.

It must not replace normal league pages or create a separate class of Sebel league.


# 3. Normal Sebel discovery remains

A league associated with a Sede remains a normal Sebel league.

It should continue participating in normal Sebel discovery, including concepts such as:

- Ahora mismo
- Lo que viene
- search
- sharing
- league pages
- standings
- players
- other normal league experiences

Sede association must NOT isolate leagues into a separate discovery silo or weaken Sebel's visitor-first discovery and marketing strategy.

A league page may eventually provide venue context such as:

`Sede: Bar Cohete`

or:

`Se juega en Bar Cohete`

with navigation to the public Sede page.

Exact wording and UI remain undecided.


# 4. League organizer and physical Sede are separate concepts

Who organizes a league and where it normally plays must not be treated as the same concept.

Examples:

## Case A — Independent league at Roberto Durán

An independent organizer creates and operates a normal league.

Its usual venue is Roberto Durán Gimnasio.

The league remains owned/operated by the independent organizer.


## Case B — Independent league at Bar Cohete

An independent organizer creates and operates a normal league.

Its usual venue is Bar Cohete.

The league remains owned/operated by that organizer.


## Case C — Bar Cohete organizes its own league

Bar Cohete creates and operates a league on its own courts.

This is still a full normal Sebel league, but it also has a stronger organizational relationship with the Sede.

These cases must not be collapsed into one ownership concept.


# 5. League-level Sede and match-level actual venue

A league may have a usual/home/associated Sede.

However, an individual match may need to move somewhere else.

Example:

League:

`Liga X`

Usual Sede:

`Bar Cohete`

Individual games:

`Match 14 → Roberto Durán`

`Match 15 → Bar Cohete`

This reflects real sports operations.

Therefore future architecture should distinguish:

- league-level Sede association;
- match-level actual Sede/place;
- match-level actual cancha.

An individual match must be able to override the league's usual location.

Do not assume that every match permanently inherits the league's Sede.


# 6. Sede and League association

A Sede may be associated with multiple leagues.

This association must be distinct from inclusion in the Sede's public dashboard.

There are at least two conceptual configuration levels.


## Level 1 — Leagues associated with the Sede

Example:

Bar Cohete has:

- Liga A
- Liga B
- Liga C

These leagues are legitimately associated with Bar Cohete.


## Level 2 — Leagues selected for the Sede dashboard

Bar Cohete may decide that only some associated leagues should appear in its public dashboard.

It must also eventually be possible to define their presentation order.

Example:

Associated leagues:

- Liga A
- Liga B
- Liga C

Public dashboard:

1. Liga B
2. Liga A

Liga C remains associated with Bar Cohete even though it is not currently selected for the dashboard.

Future architecture should therefore avoid collapsing Sede association and dashboard inclusion into one simplistic boolean.


# 7. Public-first Sede dashboard

The Sede dashboard should be **public-first**.

Its purpose is to help visitors answer questions such as:

- What is happening at Bar Cohete now?
- What is coming next?
- Which leagues are playing here?
- What is happening on each court?

A future Sede experience could conceptually expose information such as:

- Ahora
- Lo que viene
- current games
- upcoming games
- cancha
- league
- score/live status
- links into the normal league experience

Exact UI is NOT decided.


# 8. League remains the source of truth

The Sede dashboard is an aggregation/presentation surface.

It must NOT become an independent source of truth for league-owned sports data.

For an independently operated league, that league remains authoritative for information such as:

- match state;
- score;
- live-scoring state;
- standings;
- league dashboard;
- other league-owned competition data.

Conceptually:

Independent League
→ authoritative sports state

Sede Dashboard
→ aggregates/projects that authoritative state


# 9. Example — independent league with live scoring

Suppose an independent organizer operates Liga X at Bar Cohete.

The organizer has the relevant Sebel live-scoring capability.

On Liga X's own page, visitors can see the normal league dashboard/live experience.

If Bar Cohete selects Liga X for its Sede dashboard, Bar Cohete may display the same authoritative match information as part of:

`/sede/bar-cohete`

Bar Cohete does not own or duplicate that score.

The league remains the source of truth.


# 10. Dashboard inclusion and live scoring are separate

Being selected for a Sede dashboard does NOT guarantee that every game has a live score.

These are separate concepts:

1. Sede association
2. Dashboard inclusion/configuration
3. League live-scoring capability
4. Current match live-scoring availability/status

The future architecture must preserve these distinctions.


# 11. Marcador no disponible

A dashboard-enabled league may have a particular game for which Sebel does not currently have live scoring available.

That game should not automatically disappear from the public Sede dashboard.

Instead, Sebel should tell the truth.

Example:

Tiburones vs Halcones

Cancha 2 · 8:00 PM

**Marcador no disponible**

This preserves the value of the dashboard as an answer to:

"What is happening at this Sede?"

without falsely suggesting that Sebel has live data.

The Sede dashboard must never fabricate or imply a live score when none is available.


# 12. Sede-organized leagues

A Sede such as Bar Cohete may organize its own leagues on its courts and potentially across different sports.

Those leagues:

- remain full normal Sebel leagues;
- use the normal league flows;
- may have a strong relationship with the Sede;
- may appear on `/sede/bar-cohete`;
- remain discoverable through normal Sebel discovery outside the Sede page.

In theory, Sede-organized leagues normally play at the physical Sede.

However, an individual game must still be allowed to move to another Sede/place when reality requires it.


# 13. Independent leagues hosted at a Sede

An independent organizer may negotiate with a Sede owner to run a league or individual games at that venue.

Example:

An organizer operates Liga X.

Liga X plays at Bar Cohete.

The organizer and Bar Cohete determine court availability and any private commercial arrangement between themselves.

That relationship does not make Bar Cohete the owner of Liga X.


# 14. Private organizer ↔ Sede business arrangements

Sebel should not infer, police or automatically monetize the private business agreement between an independent organizer and a Sede.

Examples could include:

- court rental;
- scheduling;
- revenue sharing;
- sponsorship;
- other private agreements.

Unless Sebel explicitly creates a future product for one of these activities, they remain outside the Sebel commercial boundary.

Sebel charges each customer for the Sebel service that customer buys.


# 15. Distinct paying customer types

The future model contains at least two distinct business customers.


## Independent organizer

An independent organizer pays Sebel according to the organizer/league product or plan.

That purchase provides the applicable Sebel capabilities for operating the organizer's league.


## Sede operator

A Sede such as Bar Cohete can have a dedicated monthly Sebel Sede plan.

This is a distinct customer/product relationship.


# 16. Sede monthly plan and capacity

A Sede plan may include a defined capacity or budget.

Conceptual example only:

Monthly Sede plan:

- up to 10 leagues;
- public Sede dashboard;
- multiple-court aggregation;
- other Sede-specific capabilities.

The number `10` is only an example.

The following are NOT decided:

- actual price;
- actual league limit;
- overage behavior;
- tiers;
- included features;
- billing mechanics.

The durable product principle is:

**Sede monthly plan → clearly defined included capacity/budget and Sede capabilities.**

The commercial offer should be simple and easy for the customer to understand.


# 17. Avoid accidental cross-subsidy

The Sede subscription must not silently grant all paid capabilities belonging to an unrelated independent organizer.

Likewise, Sebel should not necessarily treat every league owned by a paying Sede as though it were an unrelated independent organizer requiring a completely separate subscription.

The two customer products have different purposes.

Future pricing discovery must preserve this distinction.


# 18. Independent league on the Sede dashboard

Bar Cohete may include an eligible independent organizer's league in its public dashboard.

This does not transfer ownership of the league to Bar Cohete.

It also does not make the Sede the source of truth for the league's sports data.

If the independent league has Sebel live scoring:

League page
→ normal authoritative live/dashboard experience

Bar Cohete Sede page
→ aggregates that authoritative information

If a displayed match does not currently have live score data:

Sede page
→ `Marcador no disponible`


# 19. Sede as another discovery entry point

The Sede concept should complement Sebel's existing discovery strategy rather than compete with it.

Possible discovery paths include:

Visitor
→ Ahora mismo
→ League
→ Sede

Visitor
→ Lo que viene
→ League
→ Sede

Visitor
→ `/sede/bar-cohete`
→ current game
→ League

Visitor
→ shared Sede link
→ Bar Cohete
→ League

This potentially creates another public acquisition/discovery surface while preserving normal league discovery.


# 20. Future player jersey / sports display name

A separate future product idea was discovered during the same discussion and is preserved here because it relates to sports presentation.

A player should eventually be able to have an optional sports/display name distinct from their authoritative structured identity name.

Examples:

Authoritative name:

`Miguel Sam`

Possible jersey/display name:

`M. Sam`

Another example:

Authoritative name:

`Jose Santos`

Possible jersey/display name:

`Gato`

This value may represent the name the player wants shown on a jersey, sports presentation, or similar public sporting context.


# 21. Player identity remains authoritative

The sports/display name must NOT replace the structured identity model.

The authoritative identity fields remain:

- `nombrePila`
- `apellido1`
- `apellido2`

The sports/display name is an optional presentation field.


# 22. Naming of the player display field remains open

Do not automatically call the future database field simply `alias`.

Sebel may eventually have other meanings for alias, particularly around URLs, localized routes or identifiers.

Possible names to evaluate later include:

- `nombreCamiseta`
- `nombreDeportivo`
- `displayNameDeportivo`

No field name is currently authorized.


# 23. Explicitly unresolved questions

This discovery does NOT yet decide:

- final Sede schema;
- Sede ownership/permissions model;
- how a Sede account is claimed or verified;
- how independent leagues are approved for a Sede;
- who may remove a league from a Sede;
- exact Sede ↔ Cancha cardinality;
- exact league ↔ Sede cardinality;
- dashboard configuration schema;
- live-state schema;
- pricing;
- subscription tiers;
- league limits;
- overage behavior;
- payment implementation;
- final Sede page UI;
- final dashboard UI;
- sponsorship behavior;
- Sede analytics;
- venue search/ranking;
- SEO behavior;
- multilingual public routes;
- canonical URLs;
- Sede naming/rename redirects;
- player sports-display-name schema;
- player sports-display-name editing permissions.

These require future dedicated discovery.


# 24. Relationship to current Stage 3B

This artifact was created while Stage 3B Slice 4 was undergoing validation.

It does NOT modify Stage 3A or Stage 3B requirements.

It does NOT authorize:

- Sede implementation;
- database/schema changes;
- new routes;
- pricing implementation;
- player display-name implementation;
- new Stage 3 roster decisions.

Current Stage 3B work should continue independently.


# 25. Discovery checkpoint

Current Sede / Venue discovery is intentionally **STOPPED HERE**.

There is enough durable product direction to recover the concept later without continuing speculative design during current roster work.

Future continuation should begin by reading this artifact and then performing a dedicated product/architecture discovery phase.

Do not expand or implement this feature until explicitly authorized by the Master Tutor / Orchestrator.
