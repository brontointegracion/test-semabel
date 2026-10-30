# Current-production league capture: preparation and owner-run runbook (REPORT_265, corrected by REPORT_266)

**Status: PREPARED, NOT DEPLOYED, NOT EXECUTED.** Nothing in this document has been run against Cloudflare or production. It was written without network access, credentials, gate changes or any real backup. Every command below is for the OWNER to run, in order, after the preconditions are met. Spanish identifiers (`PLATINIUM-U10`, `ACCESO_ADMIN_HABILITADO`, status codes) are kept verbatim.

Each step is tagged: **[local]** touches only this machine; **[network: account]** talks to the Cloudflare account (needs the owner's login); **[network: GET]** or **[network: POST, no credential]** talks to `https://semabel.com` without any credential.

## 1. What this adds (exact)

A read-only league capture, ported selectively from backup precursor `a5a823f` (which sits on the older base `c082574`) onto this branch (`feat/portable-league-export`, base `ca7a2eb`). Nothing was copied wholesale.

| Change | Files |
|---|---|
| New: read-only export of ONE league object + recovery-bookmark helper | `backend/src/respaldo.js` (only `LigaDO` tables are recognised; anything else, e.g. an unknown table, fails with `409 respaldo-no-soportado`) |
| New: two operator routes, league-scoped | `backend/src/respaldo-rutas.js`: `POST /v1/admin/respaldo/ligas/{liga}/exportar` and `.../marcador` |
| +2 lines | `backend/src/worker.js` (import and one routing line, after the existing loader route) |
| +18 lines | `backend/src/liga-do.js` (import, `exportarRespaldoOperador`, `marcadorRecuperacionOperador`, `opcionesRespaldo`) |
| +1 line (test worker only) | `backend/test/worker-prueba.js` |
| New capture client | `backend/scripts/respaldo-privado.mjs`, `backend/scripts/lib/respaldo-privado.mjs` (league only; no `--acceso`) |
| New offline tools | portable converter, packager, public-read cross-check (`backend/scripts/*portable*`, `empaquetar-organizador.mjs`, `verificar-lecturas-publicas.mjs`) |
| New tests / docs | `backend/test/respaldo-liga.check.js`, `cli-respaldo-liga.node-test.mjs`, `respaldo-liga-invariantes.node-test.mjs`, `lecturas-publicas.node-test.mjs`, `docs/export/` |

**Not added, by design:** no export of the access object (organizers, sessions, codes), no import, restore or test-control endpoint, no schema/constructor/migration/binding/secret/vars change, `backend/wrangler.jsonc` byte-identical to `ca7a2eb`, `VERSION_ESQUEMA` stays 9, access schema stays 1, the operator gate stays `ACCESO_ADMIN_HABILITADO=0` in every environment. `respaldo-liga-invariantes.node-test.mjs` checks this against `git` (zero deleted lines in base files, allow-listed files only, SELECT-only SQL).

## 2. Compatibility, evidence and deployment effects (read BEFORE executing)

**Evidence (not a guarantee).**
- Compared with `ca7a2eb`: same schema version (9), same Durable Object constructors, no migration, no new table, no binding/variable/secret change, and the existing routes, scoring, standings, venue-spelling and TV code are byte-identical. The only additions are the read-only export code and its two operator routes. This is what the invariants test and an offline `wrangler deploy --dry-run --env production` showed: the same seven bindings and variables, `ACCESO_ADMIN_HABILITADO ("0")`, and a Worker bundle of 276,618 bytes versus 264,938 for a clean `ca7a2eb`.
- The new code does not write data of its own. That is evidence that a later move back to the previous code would not meet new stored data. It is not proof that rolling back is safe in any given situation.
- **A code rollback does not restore database contents** and does not undo data operations. The startup or repair logic of the rollback target can still write. Before any rollback, inspect the actual target (section 5) and the current state.
- The owner reported the active version as `2988a11d-787d-4076-a69b-c85c7b01e744`; the local record is tag `semabel-release-2026-10-28.2` = `ca7a2eb`. Local Git cannot prove what is deployed. This runbook ASSUMES `2988a11d` was built from `ca7a2eb`; Phase A step 2 makes the owner confirm it.
- The new routes answer `404` while the gate is closed, like the other `/v1/admin/*` routes. The frontend is unchanged; rebuilt with the SAME variables its asset file names must equal the live ones (Phase A step 3).

**What a deployment does.** It creates a new Worker version and routes 100% of traffic to it at once. Durable Objects restart on the new code (in-memory state only); a request in flight at that moment may fail once and scoring phones retry. **Do not deploy, open or close the gate while a game is being scored.** Choose a quiet window (for example the evening of 30 Oct, before the 31 Oct games). Every phase that deploys creates its own version: record every version ID.

**Limits.** Each league is captured separately (no cross-object atomicity; the tool says so in its manifest). The recovery bookmark, if the platform returns one, is separate evidence and NOT proof that a restore works. Do not call the capture a "production backup", "protected" or "restorable".

## 3. Preconditions

Test evidence from REPORT_265 is retained and is not repeated here: `exportar-portable` 60/60, `cli-respaldo-liga` 7/7, `respaldo-liga-invariantes` 6/6, `lecturas-publicas` 4/4, `config-produccion` 5/5, `respaldo-liga.check` 12/12, `esquema-migracion` 6/6, `publico-liga` 20/20, all at HEAD `ca7a2eb` plus the uncommitted work. Rerun a suite only if the code changes after it was committed.

1. **[local]** Commit and tag the exact reviewed code before deploying (the preparation left everything uncommitted). Deploying uncommitted code leaves no reproducible record of what runs in production. Then check `git status --short` is empty.
2. **[local]** Variables used below (none contain secrets). Never put the token on a command line; the capture tool reads it only from a 0600 file or `SEBEL_OPERADOR_TOKEN`.
   ```
   REPO=~/Documents/Claude-Projects/tmp/sebel.com-all/sebel.com-portable-export
   PROD=~/Documents/SEBEL/production/semabel-production
   TV_SEQ=~/Documents/SEBEL/preparacion/PLATINIUM-OCT31-NOV1-FIXTURES-20261028_131640/TV-SEQUENCE.txt
   TOKEN_FILE=<existing 0600 file holding the operator secret; never print it>
   STAMP=$(date +%Y%m%d_%H%M%S)
   CAP=$PROD/$STAMP-current-capture        # NEW; created by the capture tool; its parent must exist
   OUT=$PROD/$STAMP-current-export         # NEW parent for the deliverables
   ORIGIN=https://semabel.com
   ```
3. **The existing `ACCESO_ADMIN_TOKEN` secret is preserved and not touched by this runbook.** It must already exist and match `TOKEN_FILE`. **[network: account]** `./node_modules/.bin/wrangler secret list --env production` (names only, read-only) must show `ACCESO_ADMIN_TOKEN`. If it is absent, or you doubt that the file matches it: STOP. Do not create, overwrite or delete the shared secret as part of a routine capture or while troubleshooting authentication; that is an owner decision outside this runbook. Credential compromise is a separate incident procedure.

## 4. Procedure

### Phase A. Build and deploy with the gate CLOSED

1. **[local]** Confirm the production build inputs: `sha256sum "$TV_SEQ"` must print `a13b4a81a55b3bd8c3750b3816eac6cb981a8a956a67840817f788580e0df4aa` (the October 31 to November 1 ten-game sequence, 680 bytes, ten `LIGA/PARTIDO` pairs). The older October 23 file (`e2123283…`) must NOT be used. If the owner's records show production was built with a different file, STOP and ask.
2. **[network: account]** Confirm the live version in the dashboard (Worker `semabel-production`) or with `./node_modules/.bin/wrangler deployments list --env production` run from `backend/`: the active deployment must be `2988a11d-787d-4076-a69b-c85c7b01e744`. Record it as `PREVIOUS`. If it is a different version, STOP.
3. **[local]** Build the frontend exactly as production does (repository root):
   ```
   cd "$REPO" && git diff --stat ca7a2eb -- src index.html vite.config.js package.json package-lock.json public    # must print nothing
   [ -d node_modules ] || npm ci
   rm -rf dist
   VITE_MODO_COMPARTIDO=1 VITE_LIGAS_PUBLICAS=PLATINIUM-U10,PLATINIUM-U12 VITE_PAIS_PILOTO=PA VITE_TV_SECUENCIA="$(tr -d '\n' < "$TV_SEQ")" npm run build
   ls dist/assets | grep -E '^index-.*\.(js|css)$'
   ```
   **[network: GET]** `curl --fail --silent --show-error --connect-timeout 10 --max-time 30 --proto '=https' https://semabel.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)'`. The two lists of `index-*` names must be identical. If they differ, STOP (the build configuration is not the production one); do not deploy.
4. **[local]** Offline dry run: `cd "$REPO/backend" && ./node_modules/.bin/wrangler deploy --dry-run --env production --outdir <folder outside the repository>` must list exactly the seven bindings and variables in section 2, with `ACCESO_ADMIN_HABILITADO ("0")`.

   **If steps 1 to 4 fail, nothing was deployed and the account was not contacted by the deployment**; production is unchanged by this runbook. Fix and repeat. This is the only case in which "nothing changed" may be said.
5. **[network: account]** Deploy (gate closed): `cd "$REPO/backend" && ./node_modules/.bin/wrangler deploy --env production --message "league capture build, gate CLOSED"`. Always `--env production`. Record the new version ID as `VERSION_A`.

   **If the deploy command fails, times out, is interrupted or its output is unclear, DO NOT assume production is unchanged and do not simply rerun it.** Go to "Uncertain deployment" in section 5.
6. **[network]** Verify, with bounded timeouts:
   ```
   C="curl --silent --show-error --connect-timeout 10 --max-time 20 --proto =https"
   for L in PLATINIUM-U10 PLATINIUM-U12; do $C -o /dev/null -w "$L liga %{http_code}\n" $ORIGIN/v1/ligas/$L/publico; done                      # [GET] 200 200
   $C -o /dev/null -w 'capture route, no credential: %{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' $ORIGIN/v1/admin/respaldo/ligas/PLATINIUM-U10/exportar   # [POST, no credential] 404
   $C -o /dev/null -w 'venue route, no credential: %{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' $ORIGIN/v1/admin/ligas/PLATINIUM-U10/partidos/sede-ortografia   # [POST, no credential] 404
   ```
   Also open `https://semabel.com/` and the TV page: the first game and the "aprox." display must be unchanged. If anything is wrong, see "Code rollback" in section 5.

### Phase B. Gate window (ONE owner-run script; capture only)

Save the following as `gate-window.sh` OUTSIDE the repository (for example under `$PROD`), review it, and run it with `bash`. It opens the gate, captures only `PLATINIUM-U10` and `PLATINIUM-U12`, and ALWAYS tries to close the gate on the way out. It does not create, overwrite or delete any secret, and it does not convert or verify anything: that happens after the window is closed.

```bash
#!/usr/bin/env bash
# gate-window.sh - owner-run. Opens the operator gate, captures the two leagues, tries to close the gate.
set -Eeuo pipefail
umask 077
: "${REPO:?}" "${ORIGIN:?}" "${TOKEN_FILE:?}" "${CAP:?}"

WR="$REPO/backend/node_modules/.bin/wrangler"
ROUTE="$ORIGIN/v1/admin/respaldo/ligas/PLATINIUM-U10/exportar"
CLOSE_CMD="cd $REPO/backend && ./node_modules/.bin/wrangler deploy --env production --message 'gate CLOSE (manual recovery)'"
CHECK_CMD="curl -s -o /dev/null -w '%{http_code}\\n' -X POST -H 'content-type: application/json' -d '{}' $ROUTE   # must print 404"

# Status of the capture route without any credential: 404 = gate closed, 401 = gate open. 000 = no answer.
gate_status() {
  curl --silent --show-error --connect-timeout 10 --max-time 20 --proto '=https' -o /dev/null -w '%{http_code}' \
    -X POST -H 'content-type: application/json' -d '{}' "$ROUTE" 2>/dev/null || printf '000'
}

OPEN_ATTEMPTED=0
CLEANED=0

cleanup() {
  local rc=$?                 # exit status of the operation that ended the script
  trap '' INT TERM HUP        # a second Ctrl-C must not interrupt the closure
  set +e +u
  if [ "$CLEANED" = 1 ]; then exit "$rc"; fi
  CLEANED=1
  if [ "$OPEN_ATTEMPTED" = 1 ]; then
    printf '\n[gate-window] closing the operator gate ...\n' >&2
    local closed=0 attempt code
    for attempt in 1 2; do
      ( cd "$REPO/backend" && "$WR" deploy --env production --message "capture window closed, gate CLOSED" )
      code=$(gate_status)
      if [ "$code" = 404 ]; then closed=1; break; fi
      printf '[gate-window] check after closure attempt %s: HTTP %s (expected 404)\n' "$attempt" "$code" >&2
    done
    if [ "$closed" = 1 ]; then
      printf '[gate-window] gate closure CONFIRMED (HTTP 404 observed just now).\n' >&2
    else
      printf '\n!!!! [gate-window] GATE CLOSURE NOT CONFIRMED. THE OPERATOR GATE MAY STILL BE OPEN. !!!!\n' >&2
      printf '  Run now:   %s\n  Then check: %s\n' "$CLOSE_CMD" "$CHECK_CMD" >&2
      if [ "$rc" -eq 0 ]; then rc=90; fi     # a successful capture with an unconfirmed closure is still a failure
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT                 # installed BEFORE anything can open the gate; covers normal exit and set -e errors
trap 'exit 130' INT               # these turn the signal into an exit, so cleanup runs once
trap 'exit 143' TERM
trap 'exit 129' HUP

# ---- Pre-checks (the gate is still closed; nothing to clean up yet) ----
[ "$(stat -c %a "$TOKEN_FILE")" = 600 ] || { echo "token file must be mode 600" >&2; exit 10; }
[ ! -e "$CAP" ] || { echo "capture folder already exists: refusing to reuse it" >&2; exit 11; }
[ -d "$(dirname "$CAP")" ] || { echo "capture folder parent does not exist" >&2; exit 12; }
code=$(gate_status)
[ "$code" = 404 ] || { echo "gate is not closed before the window (HTTP $code): stop and diagnose" >&2; exit 13; }
( cd "$REPO/backend" && node scripts/respaldo-privado.mjs --origen "$ORIGIN" --remoto --liga PLATINIUM-U10 --liga PLATINIUM-U12 --salida "$CAP" )   # plan only: no request, no file
printf 'Type OPEN to open the operator gate and capture PLATINIUM-U10 and PLATINIUM-U12: '
read -r answer
[ "$answer" = OPEN ] || { echo "not confirmed" >&2; exit 14; }

# ---- The window ----
OPEN_ATTEMPTED=1                  # set BEFORE the command: an interrupted or uncertain open must still be closed
( cd "$REPO/backend" && "$WR" deploy --env production --var ACCESO_ADMIN_HABILITADO:1 --message "league capture window, gate OPEN" )
code=$(gate_status)
[ "$code" = 401 ] || { echo "expected HTTP 401 with the gate open, got $code" >&2; exit 20; }
( cd "$REPO/backend" && node scripts/respaldo-privado.mjs --origen "$ORIGIN" --remoto --liga PLATINIUM-U10 --liga PLATINIUM-U12 --salida "$CAP" --token-archivo "$TOKEN_FILE" --capturar )
echo "[gate-window] capture command finished (status 0); closing the gate."
```

What the script guarantees, and what it does not:
- The cleanup runs on normal exit, on an error (`set -e`), and on INT, TERM and HUP (terminal closed). It is installed before the open command, and the open is flagged first, so an interrupted or uncertain open is also followed by a closure attempt.
- The exit status of the failed operation is preserved. A successful capture with an unconfirmed closure exits 90. A closure failure is printed loudly with the manual command; it is never silent.
- **Cleanup is NOT guaranteed after SIGKILL, a crash, a power loss, a sleeping laptop, a lost network connection or a hung `wrangler`.** After ANY abnormal end, run the check in step 2 below yourself, and run the manual close command if it does not print 404.
- If the capture answers 401 (token and secret do not match) or anything else fails, the script closes the gate and stops. Do not touch the secret; diagnose first (section 3, step 3).
- Record the two version IDs `wrangler deploy` prints (`VERSION_B` = gate open, `VERSION_C` = gate closed). **`VERSION_B` must never be a rollback target.**

### Phase C. After the window (gate must already be closed)

1. **[local]** Read the script's last lines. Anything other than "gate closure CONFIRMED" and exit status 0 means the gate is an open incident until a 404 is observed.
2. **[network]** Verify the gate and public reads yourself (same `C` and commands as Phase A step 6): the capture route without a credential must print **404**, and both league reads **200**. If the gate does not answer 404, run the manual close command from section 5.
3. **[local]** Verify the capture folder offline (checksums, seals, permissions):
   ```
   cd "$REPO/backend" && node scripts/respaldo-privado.mjs --verificar "$CAP"
   ```
   Expected `ok: true` and the files `liga-PLATINIUM-U10.json`, `liga-PLATINIUM-U12.json`, their two `marcador-liga-*.json` and `MANIFIESTO.json`. A folder without `MANIFIESTO.json` is incomplete: do not use it.
4. Record `VERSION_C` as the current version and update the release record of the previous runbook.

### Phase D. Convert, package (offline)

**[local]**, run only after the gate is confirmed closed:
```
set -Eeuo pipefail; umask 077
cd "$REPO"
mkdir -m 700 "$OUT" "$OUT/private-technical" "$OUT/zip"       # fails if the folder already exists: evidence is never overwritten
for L in PLATINIUM-U10 PLATINIUM-U12; do
  node backend/scripts/exportar-portable.mjs --entrada "$CAP/liga-$L.json" --salida "$OUT/$L-package" --informe-tecnico "$OUT/private-technical/$L-technical-report.json"
  node backend/scripts/exportar-portable.mjs --verificar "$OUT/$L-package"
  node backend/scripts/empaquetar-organizador.mjs --paquete "$OUT/$L-package" --zip "$OUT/zip/$L-datos-deportivos-$STAMP.zip"
done
```
(Running those lines in an interactive shell after `set -e` can close the shell on the first error; prefer saving them as `convert.sh` and running `bash convert.sh`.)

### Phase E. Public-read download and cross-check

**Step E1 is a NETWORK operation (HTTPS GET to `semabel.com`, no credentials).** It is not offline work. Do it right after the gate is closed, so the reads and the capture describe nearly the same moment. Save as `public-reads.sh` outside the repository and run it with `bash`:

```bash
#!/usr/bin/env bash
# public-reads.sh - [network: GET] saves the public league reads. Never overwrites; stops before any comparison on the first failure.
set -Eeuo pipefail
umask 077
: "${REPO:?}" "${OUT:?}" "${ORIGIN:?}"
PUB="$OUT/public-reads"
mkdir -m 700 "$PUB"                         # fails if it exists: earlier evidence is never reused or overwritten

fetch() {                                   # fetch URL DEST
  local url=$1 dest=$2 tmp
  [ ! -e "$dest" ] || { echo "refusing to overwrite $dest" >&2; return 1; }
  tmp=$(mktemp "$PUB/.download.XXXXXX")
  # --fail: an HTTP error status is a failure; no redirects are followed; bounded connect time, total time and size
  if ! curl --fail --silent --show-error --connect-timeout 10 --max-time 30 --max-filesize 8000000 --proto '=https' -o "$tmp" "$url"; then
    rm -f "$tmp"; echo "download failed: $url" >&2; return 1
  fi
  [ -s "$tmp" ] || { rm -f "$tmp"; echo "empty response: $url" >&2; return 1; }
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$tmp" || { rm -f "$tmp"; echo "not JSON: $url" >&2; return 1; }
  ln "$tmp" "$dest"                         # fails if $dest appeared meanwhile; never replaces it
  rm -f "$tmp"
}

for L in PLATINIUM-U10 PLATINIUM-U12; do
  fetch "$ORIGIN/v1/ligas/$L/publico"            "$PUB/$L-liga.json"
  fetch "$ORIGIN/v1/ligas/$L/jugadores/publico"  "$PUB/$L-jugadores.json"
done
echo "[public-reads] all four downloads succeeded"

# ---- [local] comparison: reached ONLY if every download above succeeded (set -e) ----
for L in PLATINIUM-U10 PLATINIUM-U12; do
  node "$REPO/backend/scripts/verificar-lecturas-publicas.mjs" --paquete "$OUT/$L-package" --lectura-liga "$PUB/$L-liga.json" --lectura-jugadores "$PUB/$L-jugadores.json"
done
```

Acceptance for the final deliverable:
- `--verificar` is OK for both packages; both ZIPs were verified by the packager (it extracts to a private temporary folder and re-reads with the independent reader).
- The cross-check says `COINCIDE`. A difference is reported by code and id (for example `game-state-differs` if a game started between capture and the public read, or `public-game-missing-from-package` for a fixture added after the capture). Explain every difference; never edit data to make it match. If the downloads fail, no comparison is made: repeat later into a NEW `$OUT`.
- The packages include the CURRENT fixtures (`state` `programado`, with `scheduledFor` and `venue`) and every withdrawn game, clearly flagged `retired: true`. Their `dataAsOf` is the real capture instant.
- The packages and ZIPs contain no infrastructure detail and no private operational record (the reader scans `LEEME.md`, `DATA_DICTIONARY.md`, `MANIFEST.json` and the findings; the technical report stays in `private-technical/`).
- Review `findings` in each package (plain-language list) and the private technical report BEFORE anything is shared. Do not send anything until the owner approves.

## 5. Recovery

### Uncertain deployment (any deploy command that did not clearly succeed)
Applies to Phase A step 5 and to the deploys made by `gate-window.sh`. Do not assume production is unchanged and do not rerun blindly.
1. **[network: account]** Find the active deployment: `cd "$REPO/backend" && ./node_modules/.bin/wrangler deployments list --env production` (and `wrangler deployments status --env production`), or the dashboard. Compare it with `PREVIOUS` (`2988a11d-…`) and with the version IDs the command printed, if any.
2. **[network: POST, no credential]** Check the gate (route above): 404 = closed, 401 = open.
3. Decide from the evidence: still `PREVIOUS` and gate 404 means the deploy did not take effect; a new version means it did, so record it and treat it as deployed; a new or unknown version with the gate open means close the gate first (below), then investigate. If the evidence is unclear, treat the gate as open.

### Code rollback (only for a wrong deployed build; never to reopen anything)
Syntax: `cd "$REPO/backend" && ./node_modules/.bin/wrangler rollback <version-id> --env production -m "<reason>"`.
- **Verify the actual target first**: `./node_modules/.bin/wrangler versions view <version-id> --env production` (or the dashboard) and confirm it is the version you intend and that its `ACCESO_ADMIN_HABILITADO` is `"0"`. If you cannot confirm that, do not use it.
- **A rollback restores code only.** It does not restore database contents and undoes no data operation, and the target's startup or repair logic may still write. Check the target against the current data and state before and after.
- **Never** roll back to `VERSION_B` (gate open) or to `b6968ed6-8169-4c5f-9aaf-99cc497df2ea`.
- After any rollback or redeploy: gate route 404 and both public reads 200.

### Capture and gate problems
| Situation | Action |
|---|---|
| Capture tool stops (`estado: "detenido"`) | `gate-window.sh` closes the gate. No `MANIFIESTO.json` means incomplete: do not use the folder; keep it for diagnosis. The motive is a code: `http-401`: the token does not match the stored secret (**stop; do not create, overwrite or delete the secret**; diagnose per section 3, step 3); `http-404`: the gate is not open or the league is not admitted; `http-409` (`respaldo-no-soportado`): the stored data has something the exporter refuses (unknown table, KV entry, size limit): **stop; do not weaken the exporter**; report the motive; `http-503`: transient, retry once into a NEW folder after confirming the gate is closed. |
| Gate closure not confirmed (script message `GATE CLOSURE NOT CONFIRMED`, exit 90, or the check does not print 404) | Run the printed manual command: `cd "$REPO/backend" && ./node_modules/.bin/wrangler deploy --env production --message 'gate CLOSE (manual recovery)'` (no `--var`: the configuration value `"0"` applies), then check for 404. If a deploy keeps failing, use a verified gate-closed rollback target (see "Code rollback"; `VERSION_A` or `PREVIOUS` after inspecting them). Treat the gate as an open incident until a 404 is observed. Do not create, overwrite or delete `ACCESO_ADMIN_TOKEN` to close the gate. |
| Script killed hard, crash, power loss, closed laptop, lost connection | Cleanup did not necessarily run. Check the gate by hand (404 expected) and run the manual close command if not. |
| Suspected token exposure | A separate credential-incident procedure, not part of this runbook. Close the gate first. |
| Capture complete but conversion fails | Keep the capture untouched; the converter rejects with a code and writes nothing. Fix the converter in a reviewed change and rerun; do not patch data and do not re-capture unless the data changed. |
| Wrong league captured or extra files in `$CAP` | Do not use it; the verifier flags `archivo-ajeno`. Capture again into a new folder. |

After any recovery, record the version ID and confirm both: the gate route answers 404 and the public reads answer 200.

## 6. Remaining limitations

- Local Git cannot prove the active deployment; the assumption `2988a11d` = `ca7a2eb` must be confirmed by the owner (Phase A step 2).
- The frontend build reproduction (asset names equal to the live ones) is checked, not guaranteed in advance; the exact production `dist` hash is not recorded locally.
- `gate-window.sh` and `public-reads.sh` were written and reviewed but not executed against anything; they are given as the owner-run procedure. Their cleanup is best effort (see above).
- No cross-league atomicity; between capture and the public reads a game can change.
- The recovery bookmark is evidence only; no restore is implemented or tested here, so this is not a tested backup.
- The capture exercises the exporter on the real production object for the first time at execution; unsupported stored state stops the capture with a `409` (by design).
