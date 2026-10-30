// Lector INDEPENDIENTE del paquete portable (no importa el convertidor): verifica permisos, manifiesto, checksums, que el CSV diga lo mismo que el JSON,
// y RECALCULA conteos y totales efectivos desde events.json para compararlos con lo declarado. Solo imprime codigos y conteos, nunca datos.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sha = (b) => createHash('sha256').update(b).digest('hex')

/** CSV RFC 4180 -> filas de celdas { v: string, citada: boolean }. Un campo vacio SIN comillas es null; con comillas es texto vacio. */
export function leerCsv(texto) {
  const filas = []
  const n = texto.length
  let i = 0
  while (i < n) {
    const fila = []
    for (;;) {
      let v = ''
      let citada = false
      if (texto[i] === '"') {
        citada = true; i += 1
        for (;;) {
          if (i >= n) throw new Error('csv-comillas-sin-cerrar')
          if (texto[i] === '"') { if (texto[i + 1] === '"') { v += '"'; i += 2 } else { i += 1; break } } else { v += texto[i]; i += 1 }
        }
      } else {
        while (i < n && texto[i] !== ',' && texto[i] !== '\r' && texto[i] !== '\n') { v += texto[i]; i += 1 }
      }
      fila.push({ v, citada })
      if (texto[i] === ',') { i += 1; continue }
      if (texto[i] === '\r' && texto[i + 1] === '\n') { i += 2; break }
      if (i >= n) break
      throw new Error('csv-malformado')
    }
    filas.push(fila)
  }
  return filas
}

const celdaAValor = (c, tipo) => {
  if (!c.citada && c.v === '') return null
  if (tipo === 'integer') { if (!/^-?\d+$/.test(c.v)) throw new Error('csv-entero-invalido'); return Number(c.v) }
  if (tipo === 'boolean') { if (c.v !== 'true' && c.v !== 'false') throw new Error('csv-booleano-invalido'); return c.v === 'true' }
  if (tipo === 'json') return JSON.parse(c.v)
  return /^'[=+\-@\t\r]/.test(c.v) ? c.v.slice(1) : c.v
}

const ARCHIVOS = ['leagues', 'teams', 'players', 'games', 'game_scores', 'events', 'player_game_totals', 'findings']
/** Lista cerrada de archivos que puede contener el paquete del organizador (el lector no importa el convertidor). */
export const ARCHIVOS_PERMITIDOS = Object.freeze(['LEEME.md', 'DATA_DICTIONARY.md', 'MANIFEST.json', ...ARCHIVOS.flatMap((e) => [`${e}.json`, `${e}.csv`])].sort())
/** Terminos de infraestructura que NO pueden aparecer en la documentacion, el manifiesto ni los avisos del paquete (los datos deportivos de equipos o jugadores no se revisan). */
export const TERMINOS_DE_INFRAESTRUCTURA = Object.freeze(/cloudflare|worker|durable|ligado|accesodo|sqlite|\bd1\b|resumen_partido|estado_json|retirado_en|[a-z]_json\b|projection|proyecci[oó]n|schema|esquema|respaldo|backup|wrangler|deploy|despliegue|production|producci[oó]n|credential|credencial|token|session|sesi[oó]n|rowid|\bseal|summary|revision|revisi[oó]n|migrat|binding|namespace/i)
const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function verificarPaquete(ruta) {
  const r = resolve(ruta)
  const problemas = []
  const p = (c) => problemas.push(c)
  if (!existsSync(r)) return { ok: false, problemas: ['carpeta-inexistente'] }
  if ((statSync(r).mode & 0o077) !== 0) p('carpeta-con-permisos-abiertos')
  const mf = join(r, 'MANIFEST.json')
  if (!existsSync(mf)) return { ok: false, problemas: [...problemas, 'sin-manifiesto-paquete-incompleto'] }
  let m
  try { m = JSON.parse(readFileSync(mf, 'utf8')) } catch { return { ok: false, problemas: [...problemas, 'manifiesto-ilegible'] } }
  if (m?.format !== 'sebel-portable-sports-data' || m.formatVersion !== 2 || m.status !== 'complete' || !Array.isArray(m.files)) return { ok: false, problemas: [...problemas, 'manifiesto-invalido'] }
  if ((statSync(mf).mode & 0o077) !== 0) p('permisos:MANIFEST.json')
  if (JSON.stringify(m.files.map((f) => f.name).sort()) !== JSON.stringify(ARCHIVOS_PERMITIDOS.filter((n) => n !== 'MANIFEST.json'))) p('archivos-no-aprobados')
  const esperados = new Set(['MANIFEST.json', ...m.files.map((f) => f.name)])
  for (const f of m.files) {
    const q = join(r, f.name)
    if (!existsSync(q)) { p(`falta:${f.name}`); continue }
    if ((statSync(q).mode & 0o077) !== 0) p(`permisos:${f.name}`)
    const b = readFileSync(q)
    if (b.length !== f.bytes || sha(b) !== f.sha256) p(`checksum:${f.name}`)
  }
  for (const nombre of readdirSync(r)) if (!esperados.has(nombre)) p(`archivo-ajeno:${nombre}`)
  if (problemas.length) return { ok: false, problemas }
  for (const nombre of ['LEEME.md', 'DATA_DICTIONARY.md', 'MANIFEST.json', 'findings.json', 'findings.csv']) {
    const t = readFileSync(join(r, nombre), 'utf8')
    if (TERMINOS_DE_INFRAESTRUCTURA.test(t)) p(`infraestructura-en:${nombre}`)
  }
  if (problemas.length) return { ok: false, problemas }

  const json = {}
  for (const e of ARCHIVOS) {
    let doc
    try { doc = JSON.parse(readFileSync(join(r, `${e}.json`), 'utf8')) } catch { p(`json-ilegible:${e}`); continue }
    if (doc.entity !== e || doc.count !== doc.rows?.length || m.counts?.[e] !== doc.rows.length) p(`conteo:${e}`)
    json[e] = doc
    let csv
    try { csv = leerCsv(readFileSync(join(r, `${e}.csv`), 'utf8')) } catch (x) { p(`${x.message}:${e}`); continue }
    const cab = csv[0]?.map((c) => c.v) ?? []
    if (!iguales(cab, doc.fields.map((f) => f.name))) { p(`cabecera:${e}`); continue }
    if (csv.length - 1 !== doc.rows.length) { p(`filas-csv:${e}`); continue }
    try {
      doc.rows.forEach((fila, k) => {
        const celdas = csv[k + 1]
        if (celdas.length !== doc.fields.length) throw new Error('ancho')
        doc.fields.forEach((campo, c) => { if (!iguales(celdaAValor(celdas[c], campo.type), fila[campo.name])) throw new Error('valor') })
      })
    } catch (x) { p(`csv-distinto-del-json:${e}:${x.message}`) }
  }
  if (problemas.length) return { ok: false, problemas }

  // Recalculo independiente desde events.json
  const efectivos = json.events.rows.filter((e) => !e.annulled)
  const puntos = efectivos.filter((e) => e.type === 'punto').reduce((n, e) => n + e.points, 0)
  const faltas = efectivos.filter((e) => e.type === 'falta').length
  const d = m.derived
  if (puntos !== d.validPoints) p('total-efectivo-puntos')
  if (faltas !== d.validFouls) p('total-efectivo-faltas')
  if (json.events.rows.filter((e) => e.annulled).length !== d.annulledEvents) p('total-anulados')
  if (json.games.rows.filter((g) => g.retired).length !== d.retiredGames) p('total-retirados')
  if (json.games.rows.filter((g) => g.state === 'final').length !== d.finalGames) p('total-finales')
  const cuenta = (f) => json.game_scores.rows.filter(f).length
  if (cuenta((x) => x.recordedScoreStatus === 'available') !== d.registeredScoresAvailable || cuenta((x) => x.recordedScoreStatus === 'not-current') !== d.registeredScoresNotCurrent || cuenta((x) => x.recordedScoreStatus === 'unavailable') !== d.registeredScoresUnavailable) p('conteo-de-marcadores')
  if (json.game_scores.rows.some((x) => x.recordedScoreStatus !== 'available' && (x.recordedHomePoints !== null || x.recordedAwayPoints !== null || x.matchesEvents !== null))) p('resumen-no-vigente-presentado-como-registrado')
  if (json.games.rows.filter((g) => !g.stateRecognised).length !== d.unsupportedStateGames || json.games.rows.some((g) => !g.stateRecognised && g.state !== null)) p('estados-no-soportados')
  if (json.player_game_totals.rows.reduce((n, t) => n + t.points, 0) !== d.playerGameTotalsPoints) p('total-jugadores-puntos')
  // Los puntos por jugador solo cuentan equipos del partido: se recalculan por clave.
  const juegos = new Map(json.games.rows.map((g) => [g.gameId, g]))
  const calc = new Map()
  for (const e of efectivos) {
    if (e.type === 'periodo') continue
    const g = juegos.get(e.gameId)
    if (!g || (e.teamId !== g.homeTeamId && e.teamId !== g.awayTeamId)) continue
    const k = `${e.gameId}|${e.teamId}|${e.playerId}`
    const t = calc.get(k) ?? { points: 0, fouls: 0 }
    if (e.type === 'punto') t.points += e.points; else t.fouls += 1
    calc.set(k, t)
  }
  for (const t of json.player_game_totals.rows) {
    const c = calc.get(`${t.gameId}|${t.teamId}|${t.playerId}`) ?? { points: 0, fouls: 0 }
    if (c.points !== t.points || c.fouls !== t.fouls) p('totales-por-jugador-no-reproducibles')
  }
  for (const s of json.game_scores.rows) {
    const g = juegos.get(s.gameId)
    let h = 0; let a = 0
    for (const e of efectivos) if (e.gameId === s.gameId && e.type === 'punto') { if (e.teamId === g.homeTeamId) h += e.points; else if (e.teamId === g.awayTeamId) a += e.points }
    if (h !== s.eventsHomePoints || a !== s.eventsAwayPoints) p('marcador-de-eventos-no-reproducible')
  }
  return { ok: problemas.length === 0, problemas, counts: m.counts, derived: m.derived, archivos: m.files.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256.slice(0, 12) })) }
}
