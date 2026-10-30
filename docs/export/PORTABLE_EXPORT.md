# Offline portable export and organizer package (REPORT_261 to REPORT_263)

Converts ONE league backup (`sebel-respaldo-sql` v1, class `LigaDO`, schema 9) into (a) an **organizer package** of JSON plus UTF-8 CSV and (b) a separate **private technical report**. Node only: no network, no credentials, no production routes, no dependencies.

## Commands (run from the repository root)
```
node backend/scripts/exportar-portable.mjs --entrada BACKUP.json --salida NEW_PACKAGE_FOLDER --informe-tecnico NEW_REPORT.json
node backend/scripts/exportar-portable.mjs --verificar NEW_PACKAGE_FOLDER
node backend/scripts/empaquetar-organizador.mjs --paquete NEW_PACKAGE_FOLDER --zip NEW_FILE.zip
node --test backend/test/exportar-portable.node-test.mjs
```
All output paths must be NEW, outside any Git repository, with an existing parent. The input must be a regular file with no group/other permissions and is never modified. Folders are created 0700 and files 0600; nothing is overwritten. Everything is validated and built in memory first; nothing is written when the input is rejected. `MANIFEST.json` is written last: a folder without it (or renamed `*.INCOMPLETO`) is incomplete. Terminal output is counts, file names, sizes and checksum prefixes only.

## What goes where
- **Organizer package** (the 19 approved files, nothing else): `LEEME.md` (Spanish import instructions), `DATA_DICTIONARY.md`, `MANIFEST.json`, and `.json` + `.csv` for `leagues`, `teams`, `players`, `games`, `game_scores`, `events`, `player_game_totals`, `findings`. It carries sporting data, stable source ids and plain-language findings. It contains NO provider, object, table, schema/projection version, seal or deployment details; the independent reader scans the documentation, manifest and findings for such terms.
- **Private technical report** (`--informe-tecnico`, outside the package and never in the ZIP): source format/class/object/schema/seal, recognised private table names, per-game technical diagnostics (summary revision, projection version, stale reasons), the original finding kinds and the field-to-source mapping.
- **ZIP** (`empaquetar-organizador.mjs`): contains only the approved files under `datos-deportivos/`, with fixed timestamps (deterministic). The packager first verifies the package, refuses any other file, writes the ZIP 0600, then reads it back, extracts it into a private temporary folder (0700) and runs the independent reader on the extraction. A ZIP that does not verify is deleted.

## Semantics (checked against production source `ca7a2eb`)
- **Annulment flag.** Absent or null counts as active (`!e.anulado`; public SQL `COALESCE(anulado, 0) = 0`); the event is exported `annulled: false`, counted, and a `event-without-annulment-mark` warning is added. Any other non-boolean value is rejected.
- **Registered results.** Shown only when current (projection version 2, same game revision and same teams as production's `resumenValido`). `recordedScoreStatus` is `available`, `not-current` or `unavailable`; recorded values are null unless `available`. Event-derived points are always separate; disagreements go to `findings` and are never corrected.
- **Game states.** Only `programado`, `vivo`, `final`. Anything else is exported with `state: null`, `stateRecognised: false`, flagged and counted in no finished-game total.
- **Retired games** are exported with `retired: true`; leave them out of league aggregates. Annulled events are kept and excluded from totals. No historical team membership, jersey numbers, minutes, country or time zone is exported or inferred.

The data dictionary inside the package lists every field and the CSV rules (null = empty unquoted field, empty text = `""`, leading apostrophe on text starting with `= + - @ TAB CR`).
