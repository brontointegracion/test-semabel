# Backup precursor (REPORT_246) — read-only export and recovery-bookmark methods on top of c082574

Status: **implemented and rehearsed LOCALLY with synthetic data only. NOT deployed. NOT a production backup. NOT a tested cloud PITR recovery.**
Branch `backup-precursor/c082574` of a separate local clone; the validated release candidate is untouched.

## What it adds (and only this)
- `src/respaldo.js`: read-only export of one Durable Object, plus a recovery-bookmark helper.
- `src/respaldo-rutas.js` + 3 added lines in `src/worker.js`: four operator routes (same gate as the loaders: `ACCESO_ADMIN_HABILITADO=1` + operator Bearer; an organizer cookie does not work; the league must be admitted before any object is touched; POST with an empty or `{}` body):
  - `POST /v1/admin/respaldo/ligas/{liga}/exportar` and `/marcador`
  - `POST /v1/admin/respaldo/acceso/exportar` and `/marcador`
- Two methods per Durable Object class (`exportarRespaldoOperador`, `marcadorRecuperacionOperador`) and an overridable `opcionesRespaldo()`; constructors, `crearEsquema`, migrations, scoring, assets, bindings, vars and object identity are unchanged (`VERSION_ESQUEMA` stays 9, access schema 1; no migration; `wrangler.jsonc` byte-identical). `test/respaldo-precursor.node-test.mjs` enforces this against `git diff c082574` (zero deleted lines in base files, allow-listed files only).

## Export format `sebel-respaldo-sql` v1
`{ formato, version, clase, objeto, versionEsquema, bytesBase, capturadoEnMs, internasDeLaPlataforma, esquema[], tablas[], sha256 }`.
- `esquema`: every table/index/trigger from `sqlite_master` with its exact SQL text (auto-indexes included with `sql: null`).
- `tablas`: every application table, with `rowid`, column names, row count, a per-table SHA-256 and the rows. `sqlite_sequence` (AUTOINCREMENT counters) is exported as a table with its rowids.
- Values are lossless, typed from SQLite `typeof()`: NULL → `null`; INTEGER → safe integer (anything else is refused); REAL → `{"r":"<text>"}` (distinguishes 1.0 from 1, keeps `-0`, `Infinity`); TEXT → string; BLOB → `{"b":"<base64>"}`. Identifiers are validated and double-quoted.
- `sha256` covers class, version, schema and the per-table hashes, **not** the capture time (two reads of an unchanged object give the same seal).
- Platform tables (`_cf_*`, `__cf_kv`, and `__miniflare_*` in local development) are not data and are **named** in `internasDeLaPlataforma`, never silently dropped.

## Unsupported state fails explicitly (HTTP 409 `respaldo-no-soportado` + code, no partial body)
unknown table (`tabla-no-reconocida`), view, virtual table, table without rowid, KV-API entries (`kv-no-soportado`), a scheduled alarm, an integer outside ±(2^53−1), unknown type, database above 16 MiB or export text above 48 MiB (`respaldo-demasiado-grande`; nothing is truncated).

## Consistency limits (read this before relying on it)
- One object = one synchronous read (`transactionSync`, no `await` between reads), so a single object's export is a consistent snapshot. A concurrent write cannot enter halfway (tested).
- **There is no atomic snapshot across objects** (each league and the access object are captured one after another) and **none between an export and its recovery bookmark**. They are separate evidence; `correspondeConExportacion` is always `false`.
- `AccesoDO` sessions and rate-limit rows keep changing while you capture.
- The only asynchronous read is the alarm check, taken just before the synchronous pass.

## Recovery bookmarks
`getCurrentBookmark()` is exposed only if the platform offers it and returns a real value. Local development returns an all-zero placeholder: it is reported as `disponible:false, motivo:'marcador-local-de-relleno'`. PITR restoration is **not implemented and not tested here**; it needs a separately approved disposable Cloudflare environment.

## Private capture tool
`scripts/respaldo-privado.mjs` (dry plan by default; `--capturar` to request; `--verificar DIR` offline). Exact destination (local, or `--remoto` with exactly `https://semabel.com`), normal TLS, no redirects, operator Bearer from `SEBEL_OPERADOR_TOKEN` or a 0600 `--token-archivo` (never as an argument). Output folder must be NEW, outside any Git repository, created 0700; every file 0600, never overwritten. Each export is verified (all seals) before it is written; the first failure stops the run and leaves no manifest (= incomplete). Nothing from the data is printed: file names, sizes and a 12-character checksum prefix only. Encryption (for example `gpg`), copies and retention are separate, documented steps.

## Restore (rehearsal only)
`ensayo/` (NOT imported by `src/`, NOT in the production bundle, not the `main` of any production config): `worker-ensayo.js` (adds `/v1/ensayo/respaldo/.../importar`, only when `ENTORNO=ensayo-respaldo`, with the operator gate and Bearer), `importar.js`, `restaurar-ensayo.mjs` (local destinations only), `wrangler.ensayo.jsonc` (own name, no routes, no account, synthetic secrets), `ensayo-restauracion.mjs` (end-to-end rehearsal), `verificar-paquete.mjs` (production bundle check).
The import requires a NEW empty object of the SAME code version: all seals valid, same class, identical schema text, empty tables (except the `meta` row its constructor just wrote). It restores EXACTLY, including sessions and credentials; invalidating sessions or rotating credentials afterwards is a separate recovery step (use the existing operator routes) that must be decided explicitly.

## Not covered
Cloud PITR; a restore into any production object (never done); schema-11 correction tables (not part of this baseline; test them separately); cross-object atomicity; encryption and off-machine storage; confirmation that the deployed worker equals c082574 beyond the bundle-size match (REPORT_245).
