# Platinum release 2026-10-28.1 — record and recovery runbook

Documentation only. Facts below were supplied by the owner or read from preparation manifests; this document was written without querying Cloudflare or production and without reading any token, passphrase, journal or export content. Spanish identifiers and venue texts are kept verbatim.

## 1. Source

| Item | Value |
|---|---|
| Production baseline before this release | `c082574` — frontend matched exactly; the backend was identified by matching bundle size, **not** by cryptographic proof |
| Release commits | `0d9fab4` "aprox.", `58e9021` venue spelling capability |
| GitHub tag | `semabel-release-2026-10-28.1` at `58e9021` |
| Schema | stays **9** |
| `main` | stays `ddfbb20`. **Do not merge yet**: the owner chose roughly two days of production observation before acceptance |

## 2. Deployments (Worker `semabel-production`)

| Version ID | Meaning | Recovery target? |
|---|---|---|
| `19adb8a5-f571-464b-a023-4f57f51c3f7d` | Initial feature deployment | Only for a deliberate application rollback (section 6.1) |
| `b6968ed6-8169-4c5f-9aaf-99cc497df2ea` | Venue gate-open deployment (`ACCESO_ADMIN_HABILITADO=1`) | **NEVER.** It leaves the operator gate open |
| `11bf26ff-0abc-4019-a3cb-210309926ac4` | **FINAL CURRENT VERSION**, gate = 0; the owner confirmed the spelling endpoint returns HTTP 404 | Current state |
| `0fdc8140-a6f4-47d6-992b-94c1f15d4759` | Earlier gate-closed backup-precursor version (see 6.1) | Conditional, see 6.1 |

The owner visually confirmed, after a hard refresh, the new TV first game and the "aprox." display. The PWA update experience (how installed clients pick up a new version) needs a separate investigation and is **not** addressed here.

## 3. Data changes

### 3.1 Ten new fixtures (Oct 31–Nov 1)
- Four U10 and six U12 games were added. U10 period configuration was supplied as 8 minutes, U12 as 10.
- Fixture preparation folder: `~/Documents/SEBEL/preparacion/PLATINIUM-OCT31-NOV1-FIXTURES-20261028_131640/`.
- Payloads (cargaIds `carga-PLATINIUM-U10-partidos-20261031-1101-v1` and `carga-PLATINIUM-U12-partidos-20261031-1101-v1`):
  - U10 `PLATINIUM-U10-partidos-oct31-nov1.payload.json` sha256 `1715a6ac761185dbe94a1335af15c3f48a57818ae011e044d5f5a1621c5c1755`
  - U12 `PLATINIUM-U12-partidos-oct31-nov1.payload.json` sha256 `cc3b5cb2c09551bfe6ba4436be0b4818be289969ad06089ac085999491bd9c8f`
  - `fixtures-ten.json` `f11ab0e91cd68f8e916c4c6e74af47b53234f57fcee6ed13c467df8df1e6fc48`
- TV sequence (`TV-SEQUENCE.txt`, 679 characters in the prepared folder) sha256 `a13b4a81a55b3bd8c3750b3816eac6cb981a8a956a67840817f788580e0df4aa`. The previous TV sequence (production baseline) is `PLATINIUM-TV-BUILD-20261023_070130/TV-SEQUENCE.txt`, sha256 `e21232832a39022023493535c0f64240c7cb24d8c57356d5eae90da305a605f9`.
- Build variables as documented in that folder's README (the variables the build is specified to use; this document does not independently prove the owner's build command):
  - `VITE_MODO_COMPARTIDO=1`
  - `VITE_LIGAS_PUBLICAS=PLATINIUM-U10,PLATINIUM-U12`
  - `VITE_PAIS_PILOTO=PA`
  - `VITE_TV_SECUENCIA="$(tr -d '\n' < TV-SEQUENCE.txt)"`
- Owner's public-read verification passed for all ten new games; the five original game-list records per league were unchanged by loading.
- Pre-load public reads (kept outside Git): U10 `172ae762bd0979e69a2227d742719bda7c983e2b3deda30ee821277082169d9b`, U12 `dcacb02fee5418a092ea113e77496f9c061d590aa3b3ad98d2d5be012ab24c6d`.
- Private journal reference: `~/Documents/SEBEL/production/semabel-production/20261028-oct31-nov1-release/00-partidos.json` (not read here).

### 3.2 Venue accent correction (ten original finished games)
`Centro Educativo Bilingue Ricardo Miro` → `Centro Educativo Bilingüe Ricardo Miró` (spelling only; scores, events, clocks and schedules untouched).
- Preparation folder: `~/Documents/SEBEL/preparacion/PLATINIUM-VENUE-ACCENT-PRODUCTION-20261028_145413/`.
- Payloads (cargaIds `ortografia-PLATINIUM-U10-bilingue-miro-prod-20261028-v2`, `ortografia-PLATINIUM-U12-bilingue-miro-prod-20261028-v2`; five games each):
  - U10 sha256 `be5b03df50bf96aba2305170a8a0ecaebd452f6d95136b9ac13d2a9503b093c6`
  - U12 sha256 `57e353938ae046a7004f02d233f8a50c4202c4cb0817f5a331ce2d20baa26663`
- ORIGINAL pre-operation baselines (never overwrite or recapture):
  - U10 sha256 `9b7c7e23bcbd04195de4c34cffd0411ecf93c33f0c3368404bd0b11d5de51887`
  - U12 sha256 `0f9a1a3474a57f07da6f4f8b808a1a09be2a702e036708206e4fc865c24dc7ea`
- Apply: complete (two operations applied). Verification against the ORIGINAL baselines passed in league and direct reads.
- The new fixtures already had the accents and were excluded.
- Private journal reference: `…/20261028-oct31-nov1-release/10-sede-ortografia-journal.json` (not read here).
- **Scope of evidence:** these checks are public league/direct reads against baselines. They are **not** a complete production table-by-table audit.

## 4. Backup

- Backup precursor: commit `a5a823f`, pushed on branch `backup-precursor/c082574`.
- Private pre-release backup: folder `20261028-pre-release-backup` under the production parent folder (contents not read here).
- Offline export integrity DID pass: U10 2429 rows, U12 2759 rows, access 78 rows. This is distinct from production bookmark availability/correspondence, which was not independently confirmed.
- AES256 GPG archive creation and a decrypt/archive-read check passed. The owner confirmed an encrypted off-computer copy.
- The backup **predates** the fixture loading and the venue correction.
- Coverage excludes `SIMULACRO-PILOTO`, Worker secrets, static assets and Cloudflare account settings.
- A synthetic cloud PITR/import test succeeded. **Restoring production from this backup is NOT tested.**
- Export/bookmark validity and cross-object atomic consistency are **not claimed** (objects are read sequentially).
- No production import endpoint exists in the Worker.

## 5. Decision table: which recovery?

Keep these four problems separate. Never restore a database automatically because of a code problem.

| Symptom | Use | Touches data? |
|---|---|---|
| Frontend/Worker code misbehaves, data is fine | 6.1 Application rollback | Does not restore database contents; application startup/repair logic may still write data. Compatibility must be checked. |
| Venue text wrong | 6.2 Venue reversal | Yes, venue only, via a new operation |
| A new fixture must disappear | 6.3 Fixture retirement | Yes, via existing retire operation |
| Data lost/corrupted | 6.4 Full database restoration (separately reviewed) | Yes, high risk |

## 6. Recovery procedures

### 6.1 Application rollback (code only; database contents are not restored)
Syntax confirmed from local Wrangler help only (`wrangler rollback --help`: positional `version-id`, `-e/--env`, `-m/--message`; **not executed**, no account queried). Run from `backend/`:

    ./node_modules/.bin/wrangler rollback <version-id> --env production -m "<reason>"

The version ID comes from the Cloudflare dashboard or the owner's records above. Always pass `--env production` explicitly.

- **Never** target `b6968ed6-…` (gate open). After any rollback or redeploy, confirm the gate is closed (see section 7, check 1, and the deployment configuration).
- `0fdc8140-a6f4-47d6-992b-94c1f15d4759` is the previous gate-closed backup-precursor version. It carries the **OLD** frontend and TV sequence: rolling back to it **loses the new TV selection and the "aprox." display** while retaining all database data (ten new fixtures, corrected venues). It has **not** been rehearsed as a post-release compatibility test (schema 9 is unchanged, but this is not proven for the combined state).
- Rolling back does not restore database contents and does not undo data operations, but application startup/repair logic of the target version may still write data. Check compatibility of the target version with the current data before and after.

### 6.2 Venue reversal (new operation only)
- Build a **NEW** payload with the two texts swapped, a **NEW** `cargaId`, a **NEW** private journal and a new baseline; same CLI: `corregir-ortografia-sede` (dry run first), `capturar-base-ortografia` (GET), apply, `verificar-ortografia-sede`.
- The original payloads, baselines and journal stay untouched as evidence.
- **Never** repurpose the original load payloads (`…partidos-oct31-nov1…`) to update venues.
- Uncertain result (lost response / 503 `resultado-desconocido`): retry the **SAME** original payload with the **SAME** journal.
- A failed verification: keep the ORIGINAL baseline, payload and journal; explain each difference; do not recapture a baseline and present a later pass as proof.
- The operator gate must be opened and closed deliberately by the owner (redeploying with a gate var, as in the release procedure), never left open.

### 6.3 Fixture retirement
Use the existing retire operation (`retirar` / `verificar-retiro`, restore = `restaurar` / `verificar-restauracion`) with new operation IDs and a new journal. Per the existing server guards, retiring needs a game that is `programado` **without activity** (rev 0, no events/receipts/clock audit/tray/quarantine, no active phone credential, no lock), not merely "not live"; otherwise the whole batch is refused (`retiro-no-seguro`). A game referenced by the explicit TV sequence (`VITE_TV_SECUENCIA`) must **not** be retired without a coordinated TV-sequence change, otherwise the TV may show an error. No retirement or TV change is requested now. Retirement hides a game; it is not a database restore.

### 6.4 Full database restoration
- No production import endpoint exists; no production restore has been tested; this needs a **separately reviewed** procedure written before use.
- First **preserve the current state**. The current release does **not** contain the precursor export routes, so this needs a separately reviewed, compatible capture plan; the precursor capture command is not available on the current Worker and must not be assumed to be. The capture would contain every legitimate write since the backup.
- Review all legitimate later writes: the backup predates the ten fixtures and the venue correction, plus any scores, events, organizer-code activity and acceptances since. Restoring loses them unless re-applied.
- The cloud PITR test was synthetic only; the real production bookmark/restore behaviour is unverified.

## 7. Post-recovery checks
1. Operator gate closed: send `POST https://semabel.com/v1/admin/ligas/PLATINIUM-U10/partidos` with JSON body `{}` and **no credential**; expected gate-closed result HTTP 404. This route exists in both the release and the backup-precursor versions. HTTP 404 on `…/partidos/sede-ortografia` does **not** prove the gate is closed on older code, where that route is absent. Also check the deployment configuration (`ACCESO_ADMIN_HABILITADO` = 0 in the active version's variables).
2. `GET /v1/ligas/PLATINIUM-U10/publico` and `…U12/publico` return 200; game counts U10 = 9 and U12 = 11 (as of release); original finished games keep scores/rev.
3. Venue text of the ten original games and the ten fixtures as expected for the chosen recovery.
4. TV page shows the expected first game; "aprox." display present only if the new frontend is live (hard refresh; PWA caveat in section 2).
5. For data changes: run the matching `verificar-*` command against the original baseline.

## 8. Known limits and unresolved gaps
- Production restoration from the backup is untested; no import path exists.
- The backup is not a point-in-time copy of the current state.
- Baseline-identification of `c082574` on the backend was by bundle size only.
- Verification was public-read based, not a table-by-table production audit.
- PWA update behaviour is unexplained and unfixed.
- The premature-period clock incident and wrong scores are **not** claimed fixed.
- Cleanup of the disposable synthetic cloud-test Worker/resources (e.g. `sebel-backup-pitr-test-20261027-8994f`) remains **unconfirmed**.
- `0fdc8140-…` rollback is not rehearsed against the post-release data.
- `main` (`ddfbb20`) is not merged; merge after the observation period.
