# Sebel — Product Spec v1

*Drafted 13 August 2026. Status: idea clarified, not yet requirements.*

A league platform for street and amateur sport. Organizers schedule and score their liga from a phone; the results become a permanent public record for players who have never had one.

---

## 1. The problem

Street leagues leave no trace of themselves. Games are played and the results evaporate into group chats and notebooks. Nothing is measured, so talent at this level is invisible by default — not under-rated, simply unrecorded.

The liga owner feels this as a business problem. Their income depends on people showing up at the cancha and buying drinks and food, and they have nothing to market the liga with: no table, no schedule anyone can find, no player anyone can point at.

---

## 2. Who it's for

| Actor | Role |
|---|---|
| **Liga organizer** — *primary* | Owns the league and runs it for money. The only one who can create the data, so nothing happens unless they adopt the product. Busy during matches, not especially patient with software. |
| **Venue (cancha / local)** — *pays* | Sometimes the same person as the organizer, sometimes an independent court renting time by the hour. **Both cases must work.** A venue with several ligas is the higher-value customer. |
| **Árbitro** — *operates scoring* | Runs the score during the match from a phone, replacing the manual marcador and the person operating it. Invited to a specific game rather than holding an account over the liga. Often paid cash per game, working across several ligas and canchas. |
| **Player** | Non-professional. Enters the system as a name typed onto a roster by someone else; can later claim that record as their own profile. |
| **Audience** | Family, the neighbourhood, eventually scouts. Never needs an account, never installs anything — they open a link. |

---

## 3. Goals

**A season published in one sitting.** An organizer describes their constraints and leaves with a full schedule and a public link, without hand-entering forty fixtures.

**A game captured courtside with no signal.** Scoring happens on a phone at the side of the court. If it needs connectivity, it will not get used.

**A record that outlives the league.** A player's numbers accumulate across seasons and across ligas, and stay reachable years later.

**Retire the physical scoreboard.** Today one person keeps the score by hand on a board that one crowd, in one place, can see. The árbitro runs it from a phone instead and the score is live on a link — which scales to every phone in the cancha, a TV on the wall, and anyone following from home, at no extra cost per screen. The marcador becomes software, and stops being limited to the people standing at the court.

**Measured by:** number of ligas published, and of those, how many captured a full season end to end without falling back to paper.

---

## 4. Money

Two products, sold separately.

- **Registration buys marketing** — the liga page, the schedule, where and when every game is played.
- **Game credits buy equipment** — the live digital marcador the árbitro runs, replacing the board and the person operating it.

They are different things and a customer can buy the first without the second.

| Who | Pays | When |
|---|---|---|
| Organizer | Per liga season | At registration, priced from teams and season length. Buys the public page, the generated schedule, and venue/kick-off details for every game — a liga may run across several canchas in one season. |
| Organizer | Per game scored | Live scoring for one match. Bought as a prepaid balance of credits, **never charged at the court.** Competes with the cost of a physical board plus someone to operate it, not with free. |
| Venue with volume | Monthly | Covers every liga at that cancha *including unlimited live scoring*. This is what makes "your court no longer needs a scoreboard" a sentence you can sell. |
| Scouts | Later | Paid access to player data across a region — the reason the archive is never deleted. |
| Players | Later | Pay to make their profile complete and public. Part free, part paid — the same shape as the article model. |

### Saldo, not currency

Scoring is prepaid, and **one credit is one match scored live** — never a token with an exchange rate. The balance reads "12 games left", not "1,200 credits". That maps onto prepaid phone top-ups, a model already familiar in this market, including for people without a bank account.

Registration is priced in plain money instead, because it is a considered purchase made once at a desk. Keeping the two separate stops credits from becoming an opaque internal currency.

The ladder gets cheaper per game as volume rises, because every additional match recorded is another row in the archive:

1. **Free saldo** — around ten games, capped per account *and* per cancha. Enough to run a few real match days and see the board on a TV.
2. **Credit packs** — bought in blocks. Blocks also keep payment fees survivable: a card fee of roughly 3% plus a fixed charge would eat a third of a single one-dollar game, and nothing at that price point can be sold one at a time.
3. **Season bundle** — every game of the season at a discount. Removes the per-game hesitation that would otherwise thin the archive.
4. **Venue monthly** — all ligas at that cancha, unlimited live scoring. Top of the ladder, best margin.

### Two conditions on per-game pricing

**No transaction ever happens at the court.** Credits are bought at registration or topped up from home; a game silently consumes one. A card screen minutes before kick-off, on a weak signal, with twenty people waiting to play, loses the capture and the customer.

**Entering a final score by hand stays free.** Otherwise a priced archive is a thin archive, and the scout data has holes in it. Paying unlocks the live experience — real-time score on the public page and on screens at the cancha — not the right to record a result.

### The audience never pays

Not to watch the board, not to open the link, not to see a result. The link spreading *is* the marketing product the organizer bought; charging the people it spreads to would destroy the thing being sold.

---

## 5. Main flow

1. **Sign up** — Email plus a WhatsApp number, both verified. Enough to establish a real person without demanding a card.
2. **Describe the liga** — Sport, teams, start and end dates, which weekdays can be played, which time slots, which cancha(s).
3. **Generate the season** — The system proposes a full regular season fitted to those constraints and to the venue's existing bookings. The organizer reviews, moves what it got wrong, and approves.
4. **Publish and pay** — Price comes from what the schedule actually contains. Payment makes the liga public and returns the shareable link. Scoring credits are bought here too, while the organizer is at a desk on wifi.
5. **Game day** — The árbitro opens the match on their phone and runs the score. Works offline, syncs when signal returns; the public dashboard and any screen at the cancha follow it live. **One credit is consumed when the match is finalized, not when it is opened** — an abandoned game costs nothing.
6. **Or just the result** — No credits, no árbitro, nobody available: someone types the final score afterwards, free. The liga table and player records stay complete either way.
7. **Rain, or a lost court** — The organizer reschedules an affected game into a free slot. Everything else in the calendar stays where it was.
8. **Finals** — The regular season produces the table. The organizer or the venue publishes the semifinal and the final by hand.
9. **A player claims their record** — A player who wants a complete, public, professional-looking profile registers and consents at that moment. Before that they are a name with per-game lines inside their liga's results.

---

## 6. Hard rules

Constraints the whole design hangs on.

**A venue slot is sold once.** One liga occupies a given cancha at a given time, never two. This single invariant is what keeps venue-pays and organizer-pays from colliding.

**The public page is a scoreboard first** — not a results dashboard that also shows a score. During a live match the link is a marcador: enormous numerals, team names, period and clock, readable across a court and from the back of a room. The table, player lines and schedule live below it or behind a tap. A dashboard is read at arm's length; a scoreboard is read at fifteen metres, and that difference decides the whole layout.

**One link, every screen.** The same URL serves a phone in someone's hand and a TV on the cancha wall — no app, no hardware, no pairing, no per-screen cost. A TV also needs a **short numeric code** as an alternative to the URL, because typing a long address with a television remote is miserable enough to stop people using it. The board view keeps the screen awake and needs no login.

**Global free, paid country by country.** Anyone anywhere can sign up, run a liga on free saldo and publish a page, in Spanish or English. Paid plans switch on per country as payment rails come online. Keeps "global" honest without blocking launch behind twenty integrations — and the unpaid ligas become the market research that says which rail to build next.

**Spanish first, English second.** Not English translated into Spanish. The product's vocabulary is liga, cancha, árbitro, saldo, and designing in English and translating afterwards loses exactly the vernacular that makes it feel like it belongs at the court. Neutral Latin American Spanish, not Castilian. Liga and team names stay in whatever language the organizer typed — never machine-translated.

**Locale is data, not display.** Going global touches the schema, not just the strings:
- Money stored as amount + currency + rate at the time, never a bare number
- Kick-off times belong to the **cancha's** timezone, stored in UTC alongside it — a classic and expensive bug
- The week does not start on the same day everywhere, which the generator's "which weekdays" depends on directly
- Names carry accents and ñ, so collation and search must handle them
- Phone numbers stored in international format for WhatsApp verification

**The site scopes itself to the visitor's country, automatically.** Someone opening it from Panamá gets Panamá: its ligas, its canchas, its news, and a province filter within it — Bocas del Toro, Chiriquí, Darién, and the rest. Other countries are not shown. The country is detected from the visitor's IP address; when that lookup fails — no connection, an ad blocker, a service worker serving the page offline — it falls back to the device's timezone, which is right nearly always and depends on nobody. The country is never displayed and cannot be changed — not by a guest, not by an organizer, not by a venue owner. Nobody picks which country they see. The consequence, accepted deliberately: a visitor whose IP resolves to a country with no ligas sees an empty site, and someone abroad cannot follow a liga back home.

**What is public, and what belongs to the owner.** Anyone — no account, no install — gets the home page, a liga's page with its table and calendar, a match with its scoreboard and figures, player profiles, and the news. Everything that *changes* something belongs to the person who owns that liga: their list of ligas, creating one, the saldo, and the console that keeps the score. Being an organizer is not enough to score somebody else's match; the check is ownership of that specific liga, never the role alone. A guest who reaches an owner's screen by typing the URL is sent back to the home page.

**Fouls are events, exactly like points.** Same list, same undo, same audit trail. That makes discipline a first-class statistic — most-fouled player per team, team fouls per period — without a second system, and it is what lets the match page show figures rather than only a score.

**Advertising never touches the match.** A small sponsored slot belongs on discovery surfaces — the home page, the news list. Never over the scoreboard, never inside a live match, never between a person and the score they opened the link to see. The organizer sold attention to their liga, not to us.

**The score is a list of events, never a number.** Every action is stored as its own fact — *two points, team A, number 7, second period, 14:32* — and the score is what you get by adding them up. Undo then voids the last event and redo reinstates it, both exact and unambiguous. Storing a running total makes undo a guess, and throws away the per-player lines the archive is built on. This one decision gives scoring, correction, player stats and provenance from the same structure.

**Mistakes are normal, not exceptional.** Scoring happens fast, one-handed, while the match continues. Wrong team, wrong player and double taps are guaranteed. Undo is a permanent visible control, never buried in a menu, with the last few actions listed and tappable to correct. A short delay before pushing to the public board means an immediate fix-up never appears on the TV at all.

**Corrections are recorded, never erased.** A voided event stays in the log, marked void, with who did it and when. These numbers become player records and are eventually sold to scouts, so the trail of how a score was arrived at is worth more than a clean-looking database — and it is the cheapest credibility this platform will ever get.

**Nothing is deleted.** Seasons, results and player records persist permanently. The archive is the asset that later revenue depends on.

**Lapsed payment locks the office, not the shop window.** Scheduling and capture stop. Public pages and every link already shared stay live. Taking pages dark would punish the audience for the organizer's lapse and break the player records the premise rests on.

**Money never appears at the court.** Live scoring is priced per game but paid for in advance. Nothing in the game-day flow can block on a payment, a card, or a connection to a payment provider.

**Recording a result is always free.** Credits buy the live experience. They never buy the right to have a game exist. A rained-out or replayed match consumes nothing, so nobody hesitates to reschedule.

**Free usage is capped twice.** Around ten games per free account, *and* a limited number of free games per physical cancha regardless of how many accounts point at it. Account-level caps alone are farmable with new emails; venue-level caps alone punish a busy court hosting several honest new ligas.

**A cancha is a real place.** Venue identity is anchored to an address and coordinates, with near-duplicate detection when a new venue is registered close to an existing one. Without it, "Cancha Municipal" and "Cancha Municipal #1" are two venues and the free-tier cap is decorative.

**Consent is captured at claim.** Registering to complete a profile is the moment permission is granted — for the full public profile and for inclusion in anything later sold.

---

## 7. Scope

### In v1

- Constraint-based regular-season generator, across one or several canchas
- Rescheduling without cascading the calendar
- Manually published semifinal and final
- Offline-first courtside scoring, PWA
- Árbitro role, invited per match
- Live board view: one link, phone or TV, short code for televisions
- Real-time score push while the match is in play
- Undo and redo, plus a tappable log of recent actions
- Free manual entry of a final result
- Team result plus a small per-player line, one model for all sports
- Fouls per player and per team, on the same event log
- Match figures: top scorer and most-fouled player for each team
- Country detected on arrival; everything scoped to it, with a province filter inside
- Discovery home: sport filter, then "ahora mismo" / "lo que viene"
- News section, part free and part paid
- One small sponsored slot on discovery surfaces only
- Public dashboard: no install, no account to view
- Venue as a first-class entity with location
- Organizer-typed rosters, claimable by players
- Guest and owner roles: console, ligas list, saldo and liga creation are owner-only
- Open worldwide signup, email + WhatsApp verified
- Season payment, prepaid scoring saldo, venue subscription, free-tier caps
- Spanish and English, local currency display
- Card plus the dominant local rail, country by country

### Out of v1

- Per-sport box scores — rebounds, assists, cards
- Video and skills footage
- Group stages, cups, generated brackets
- Any verification that reported stats are true
- Scout marketplace and data licensing
- Paid player profile upgrades
- Articles, free or paid
- Ticketing and payments between fans and ligas
- Languages beyond Spanish and English
- Paid plans in countries with no rail integrated yet

---

## 8. Still open

Each of these changes what gets built.

**How data ownership is worded** — *blocks monetization.* "All data becomes Sebel's" does not hold as written in most places: personal data is not property that can be signed over, and Latin American data-protection regimes and the GDPR both grant rights that survive a checkbox. The same commercial outcome comes from a broad, perpetual, sublicensable licence to publish and commercialize, plus explicit consent for scout access. Worth getting the wording right once, because it is what makes the archive sellable.

**Players under eighteen** — *affects the claim flow.* Street leagues carry minors, who cannot grant that consent themselves. The claim flow needs an age check and a guardian route, or under-18 profiles stay unclaimed and excluded from anything sold.

**The exception to "never delete"** — A player who asks to be removed needs a suppression path (hidden from public view and from every dataset) that does not erase the liga's record of the game. Retention and suppression are different operations.

**Which rails to build, and in what order** — *blocks revenue.* Card is the global baseline, but in most of this market money moves on a local rail: Yappy in Panama, PIX in Brazil, SPEI and OXXO in Mexico, Nequi in Colombia, Yape in Peru, Mercado Pago in Argentina. Integrating those one by one is a company's worth of work, so the pragmatic path is an aggregator covering the region plus cards, with direct integrations only where coverage or fees hurt. Yappy in particular is domestic to Panama and may need a direct integration — worth checking before it becomes a surprise.

**Who can change a score after the final whistle** — During the match the árbitro corrects freely. Once finalized, the numbers become part of a player's permanent record, so silent rewriting has to stop. Likely answer: post-match corrections belong to the organizer, are visible as corrections on the public page, and are limited to a window of a day or two. The alternative — nobody can fix an obvious error — is worse.

**What the árbitro gets out of it** — *biggest risk.* Scoring moves from the organizer to the referee, but the referee is usually paid cash per game and has no stake in the platform. They are handed a new task, on their own phone, using their own data, for no extra money. If they refuse, live scoring — the thing being charged for — does not happen. Options worth testing: the organizer pays them slightly more, the árbitro builds a public record of matches officiated, or the organizer keeps scoring and the árbitro is optional.

**Offline capture versus a live board** — *architectural.* These two requirements pull against each other. If the árbitro's phone has no signal, nothing can be real-time, and a board showing a stale score without saying so is worse than no board. Workable shape: live push when connected, queued sync when not, and a public board that states plainly how old the number is. Note that the canchas most likely to hang a TV are the ones with wifi — so the venues paying monthly are exactly where live works properly.

**Venue deduplication at global scale** — Anchoring a cancha to an address and coordinates is easy to imagine in one country and hard across every address format in the world. Since that dedup is what makes the per-venue free-tier cap real, decide whether the cap leans more on geolocation proximity (universal) than on address matching (not).

**Build order** — *recommendation.* The generator and billing both sit ahead of the first published liga, and neither is small. Consider shipping a version where the organizer enters a schedule by hand and pays nothing, to get real ligas on real canchas before either exists — then the generator sells itself to people already using the product. Real-time push being a v1 requirement rather than a later optimization strengthens this: the engineering is better spent on the board than on the generator.

**One stat model across every sport** — A team result plus a small per-player line was chosen to stay sport-agnostic. Worth testing with a real basketball organizer whether points-only feels worth the courtside effort, or whether basketball needs enough more that per-sport models arrive sooner than planned.
