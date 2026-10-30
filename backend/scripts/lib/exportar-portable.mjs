// Convertidor OFFLINE: respaldo `sebel-respaldo-sql` v1 de UNA liga (LigaDO) -> paquete de datos deportivos portable (JSON + CSV UTF-8).
// Solo Node. Sin red, sin credenciales, sin importar nada de `src/` de produccion. Todo se valida y se arma EN MEMORIA antes de escribir un solo archivo.
// Los sellos se verifican con el mismo algoritmo del precursor (a5a823f, `verificarSellos` en backend/src/respaldo.js), portado aqui para no depender de ese checkout.
import { chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { aJson, celdaCsv, csvDeCampos, sha256Hex } from './util-portable.mjs'
import { armarPaqueteOrganizador } from './paquete-organizador.mjs'

export { celdaCsv, sha256Hex }

export const VERSION_EXPORTADOR = '2.0.0'
export const FORMATO_ORIGEN = 'sebel-respaldo-sql'
export const VERSION_FORMATO_ORIGEN = 1
export const VERSION_ESQUEMA_SOPORTADA = 9
// `VERSION_PROYECCION` de backend/src/resumen-publico.js en ca7a2eb: un resumen con otra version NO es servible en produccion (resumenValido).
export const VERSION_PROYECCION_SOPORTADA = 2

export class ErrorExportacion extends Error {
  constructor(codigo, detalle) { super(codigo); this.name = 'ErrorExportacion'; this.codigo = codigo; this.detalle = detalle ?? null }
}
const falla = (codigo, detalle) => { throw new ErrorExportacion(codigo, detalle) }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Tablas. Solo las de USO se leen; las PRIVADAS se reconocen por nombre y NUNCA se exportan; cualquier otra rechaza el respaldo.
// ---------------------------------------------------------------------------------------------------------------------------------------------
export const TABLAS_DE_USO = Object.freeze({
  ligas: ['id', 'nombre', 'deporte', 'minutos_por_periodo', 'categoria', 'subcategoria_json'],
  equipos: ['id', 'liga_id', 'nombre', 'rama'],
  jugadores: ['id', 'equipo_id', 'liga_id', 'nombre', 'nombre_pila', 'apellido1', 'apellido2', 'dorsal', 'activo'],
  partidos: ['id', 'liga_id', 'local_id', 'visita_id', 'estado_json', 'rev', 'programado_para', 'sede', 'retirado_en'],
  eventos: ['partido_id', 'id', 'seq', 'json'],
  resumen_partido: ['partido_id', 'local_id', 'visita_id', 'local_puntos', 'visita_puntos', 'local_faltas', 'visita_faltas', 'periodo', 'rev_fuente', 'version_proyeccion'],
})
export const TABLAS_PRIVADAS = Object.freeze([
  'auditoria_acceso', 'auditoria_plantilla', 'auditoria_reloj', 'bandeja', 'cargas', 'codigos_partido', 'credenciales', 'cuarentena',
  'limite_fuente', 'meta', 'operaciones_plantilla', 'recibos', 'sqlite_sequence',
])

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Sellos (portado de a5a823f). El conjunto cubre clase, version, esquema y los hashes de tabla; NO la hora de captura.
// ---------------------------------------------------------------------------------------------------------------------------------------------
const contenidoDeTabla = (t) => JSON.stringify({ nombre: t.nombre, columnas: t.columnas, conRowid: t.conRowid, datos: t.datos })
const resumenParaSello = (r) => JSON.stringify({ formato: r.formato, version: r.version, clase: r.clase, objeto: r.objeto, versionEsquema: r.versionEsquema, esquema: r.esquema, tablas: r.tablas.map((t) => [t.nombre, t.filas, t.sha256]) })

/** Reconstruye los sellos de un respaldo (lo usan las pruebas para fabricar entradas sinteticas validas). */
export function sellar(r) {
  const tablas = r.tablas.map((t) => ({ ...t, filas: t.datos.length, sha256: sha256Hex(contenidoDeTabla(t)) }))
  const cuerpo = { ...r, tablas }
  return { ...cuerpo, sha256: sha256Hex(resumenParaSello(cuerpo)) }
}

function verificarEstructuraYSellos(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) falla('respaldo-no-es-objeto')
  if (r.formato !== FORMATO_ORIGEN) falla('formato-no-soportado')
  if (r.version !== VERSION_FORMATO_ORIGEN) falla('version-de-formato-no-soportada')
  if (r.clase !== 'LigaDO') falla('clase-no-soportada') // un respaldo de acceso (AccesoDO) nunca se convierte
  if (typeof r.objeto !== 'string' || r.objeto === '') falla('objeto-ilegible')
  if (r.versionEsquema !== VERSION_ESQUEMA_SOPORTADA) falla('esquema-no-soportado', String(r.versionEsquema).slice(0, 12))
  if (!Array.isArray(r.tablas) || !Array.isArray(r.esquema)) falla('estructura-invalida')
  if (typeof r.sha256 !== 'string') falla('sello-ausente')
  const vistos = new Set()
  for (const t of r.tablas) {
    if (t === null || typeof t !== 'object' || typeof t.nombre !== 'string' || !Array.isArray(t.columnas) || !Array.isArray(t.datos) || typeof t.conRowid !== 'boolean') falla('tabla-malformada')
    if (vistos.has(t.nombre)) falla('tabla-duplicada', t.nombre.slice(0, 40))
    vistos.add(t.nombre)
    if (t.filas !== t.datos.length) falla('filas-no-coinciden', t.nombre.slice(0, 40))
    const ancho = t.columnas.length + (t.conRowid ? 1 : 0)
    if (t.columnas.some((c) => typeof c !== 'string') || new Set(t.columnas).size !== t.columnas.length) falla('columnas-invalidas', t.nombre.slice(0, 40))
    for (const f of t.datos) if (!Array.isArray(f) || f.length !== ancho) falla('fila-malformada', t.nombre.slice(0, 40))
    if (sha256Hex(contenidoDeTabla(t)) !== t.sha256) falla('sello-de-tabla-invalido', t.nombre.slice(0, 40))
  }
  if (sha256Hex(resumenParaSello(r)) !== r.sha256) falla('sello-del-conjunto-invalido')
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Lectura tipada de filas. NULL del origen = null (desconocido); el cero es cero.
// ---------------------------------------------------------------------------------------------------------------------------------------------
function valor(v, tabla, columna) {
  if (v === null || typeof v === 'string') return v
  if (typeof v === 'number') { if (!Number.isSafeInteger(v)) falla('entero-fuera-de-rango', `${tabla}.${columna}`); return v }
  if (v && typeof v === 'object' && Object.keys(v).length === 1) {
    if (typeof v.r === 'string') { const n = v.r === '-0' ? -0 : Number(v.r); if (!Number.isFinite(n)) falla('real-no-valido', `${tabla}.${columna}`); return n }
    if (typeof v.b === 'string') falla('blob-en-columna-exportada', `${tabla}.${columna}`)
  }
  return falla('valor-no-valido', `${tabla}.${columna}`)
}

function filasDe(r, nombre) {
  const t = r.tablas.find((x) => x.nombre === nombre)
  if (!t) return falla('tabla-requerida-ausente', nombre)
  const cols = TABLAS_DE_USO[nombre]
  const idx = cols.map((c) => { const i = t.columnas.indexOf(c); if (i < 0) falla('columna-requerida-ausente', `${nombre}.${c}`); return i + (t.conRowid ? 1 : 0) })
  return t.datos.map((fila) => Object.fromEntries(cols.map((c, k) => [c, valor(fila[idx[k]], nombre, c)])))
}

const texto = (v, t, c, { nulo = true } = {}) => {
  if (v === null) { if (!nulo) falla('nulo-inesperado', `${t}.${c}`); return null }
  if (typeof v !== 'string') falla('tipo-inesperado', `${t}.${c}`)
  return v
}
const entero = (v, t, c, { nulo = true, min = 0 } = {}) => {
  if (v === null) { if (!nulo) falla('nulo-inesperado', `${t}.${c}`); return null }
  if (!Number.isSafeInteger(v) || v < min) falla('tipo-inesperado', `${t}.${c}`)
  return v
}
const unico = (filas, clave, tabla) => {
  const m = new Map()
  for (const f of filas) { const k = clave(f); if (m.has(k)) falla('identificador-duplicado', tabla); m.set(k, f) }
  return m
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
/** Instante ISO guardado -> UTC. Con `Z` se conserva EXACTAMENTE el texto; con desplazamiento se convierte a UTC (y se avisa); ilegible -> null (y se avisa). */
function instante(v, aviso) {
  if (typeof v !== 'string' || v === '') return null
  if (!RE_ISO.test(v) || !Number.isFinite(Date.parse(v))) { aviso('instant-not-interpretable'); return null }
  if (v.endsWith('Z')) return v
  aviso('instant-converted-to-utc')
  return new Date(Date.parse(v)).toISOString()
}
const instanteDeMs = (ms, aviso) => {
  if (!Number.isSafeInteger(ms) || Math.abs(ms) > 8.64e15) { aviso('instant-not-interpretable'); return null }
  return new Date(ms).toISOString()
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Contrato de salida: UNA lista de campos por entidad. De ella salen el JSON, el CSV y el diccionario de datos.
// tipo: string | integer | boolean | instant | json
// ---------------------------------------------------------------------------------------------------------------------------------------------
const C = (nombre, tipo, nulable, origen, descripcion) => ({ nombre, tipo, nulable, origen, descripcion })
export const ENTIDADES = Object.freeze({
  leagues: {
    archivo: 'leagues', titulo: 'Leagues', clave: ['leagueId'],
    campos: [
      C('leagueId', 'string', false, 'ligas.id', 'Sporting source id of the league (preserved).'),
      C('name', 'string', false, 'ligas.nombre', 'League display name, exact stored text.'),
      C('sport', 'string', false, 'ligas.deporte', 'Sport code as stored (e.g. baloncesto).'),
      C('minutesPerPeriod', 'integer', true, 'ligas.minutos_por_periodo', 'Configured minutes per period; null = not configured (unknown), never 0 unless stored as 0.'),
      C('category', 'string', true, 'ligas.categoria', 'Category code as stored; null = unknown.'),
      C('subcategory', 'json', true, 'ligas.subcategoria_json', 'Subcategory object as stored (JSON file: parsed value; CSV: its JSON text); null = unknown.'),
    ],
  },
  teams: {
    archivo: 'teams', titulo: 'Teams', clave: ['teamId'],
    campos: [
      C('teamId', 'string', false, 'equipos.id', 'Sporting source id of the team (preserved).'),
      C('leagueId', 'string', false, 'equipos.liga_id', 'League the team is registered in.'),
      C('name', 'string', false, 'equipos.nombre', 'Team display name, exact stored text.'),
      C('branch', 'string', true, 'equipos.rama', "'masculino' | 'femenino' | 'mixta' as stored; null = unknown (never inferred)."),
    ],
  },
  players: {
    archivo: 'players', titulo: 'Players (CURRENT roster snapshot only)', clave: ['playerId'],
    campos: [
      C('playerId', 'string', false, 'jugadores.id', 'Sporting source id of the player record (ficha); stable id referenced by events.'),
      C('teamId', 'string', false, 'jugadores.equipo_id', "The player's team AT CAPTURE TIME. Not historical membership."),
      C('leagueId', 'string', false, 'equipos.liga_id (via teamId)', 'League of that team.'),
      C('givenName', 'string', true, 'jugadores.nombre_pila', 'Given name(s); null = not recorded.'),
      C('surname1', 'string', true, 'jugadores.apellido1', 'First surname; null = not recorded.'),
      C('surname2', 'string', true, 'jugadores.apellido2', 'Second surname; null = not recorded.'),
      C('legacyName', 'string', true, 'jugadores.nombre', 'Legacy single-field name as stored; null = not recorded.'),
      C('currentJersey', 'integer', true, 'jugadores.dorsal', "Jersey number AT CAPTURE TIME (0 is a valid number); null = none/unknown. NOT the number worn in past games."),
      C('active', 'boolean', false, 'jugadores.activo', 'Whether the record was active in the roster at capture time.'),
    ],
  },
  games: {
    archivo: 'games', titulo: 'Games', clave: ['gameId'],
    campos: [
      C('gameId', 'string', false, 'partidos.id', 'Sporting source id of the game (preserved).'),
      C('leagueId', 'string', false, 'partidos.liga_id', 'League of the game.'),
      C('homeTeamId', 'string', true, 'partidos.local_id', "Home ('local') team id; null = not assigned."),
      C('awayTeamId', 'string', true, 'partidos.visita_id', "Away ('visita') team id; null = not assigned."),
      C('state', 'string', true, 'partidos.estado_json.partido.estado', "'programado' (scheduled) | 'vivo' (live or paused) | 'final'; null ONLY when the stored state is not one of those (see stateRecognised). Never deduced from time."),
      C('stateRecognised', 'boolean', false, 'derived', 'FALSE when the stored game state is missing or not programado/vivo/final. Such a game is UNSUPPORTED: it is exported for completeness, flagged, and counted in no final-game aggregate.'),
      C('retired', 'boolean', false, 'partidos.retirado_en IS NOT NULL', 'TRUE when the operator RETIRED the game (a mark apart from state). Retired games are hidden on the public site; they are exported here, flagged. Leave them out of league aggregates.'),
      C('scheduledFor', 'instant', true, 'partidos.programado_para', 'Scheduled UTC instant; null = unknown. No timezone or country is stored or invented.'),
      C('startedAt', 'instant', true, 'partidos.estado_json.partido.inicio', "UTC instant the game was started, only when state is not 'programado'; reported by the controlling phone. null = unknown."),
      C('venue', 'string', true, 'partidos.sede', 'Venue text of THIS game, exact stored text (accents preserved); null = unknown.'),
      C('revision', 'integer', false, 'partidos.rev', 'Source revision of the game (+1 per accepted command).'),
      C('sport', 'string', false, 'ligas.deporte', 'Sport of the league.'),
    ],
  },
  game_scores: {
    archivo: 'game_scores', titulo: 'Recorded scores per game (current coherent summaries only) beside event-derived points', clave: ['gameId'],
    campos: [
      C('gameId', 'string', false, 'resumen_partido.partido_id', 'Game id.'),
      C('state', 'string', true, 'games.state', "Only rows with state 'final' and summaryStatus 'coherent' are recorded FINAL scores; other states are snapshots of a game not finished."),
      C('retired', 'boolean', false, 'games.retired', 'Retired game flag.'),
      C('summaryStatus', 'string', false, 'derived (same test as production resumenValido)', "'coherent' = a summary row exists, has projection version 2, the SAME revision as the game row and the SAME home/away team ids (production serves only these); 'stale' = a summary row exists but fails one of those tests; 'missing' = no summary row. Production answers 503 resumen-no-disponible for stale and missing."),
      C('summaryStaleReasons', 'string', true, 'derived', "Comma-separated reasons when stale: revision, projection-version, teams. null otherwise."),
      C('recordedHomePoints', 'integer', true, 'resumen_partido.local_puntos', "Home points AS RECORDED by a COHERENT summary. null when the summary is stale or missing (unknown, never 0, never a stale value)."),
      C('recordedAwayPoints', 'integer', true, 'resumen_partido.visita_puntos', 'Away points as recorded by a coherent summary; null otherwise.'),
      C('recordedHomeFouls', 'integer', true, 'resumen_partido.local_faltas', 'Home team fouls (whole game) recorded by a coherent summary; null otherwise.'),
      C('recordedAwayFouls', 'integer', true, 'resumen_partido.visita_faltas', 'Away team fouls (whole game) recorded by a coherent summary; null otherwise.'),
      C('recordedPeriod', 'integer', true, 'resumen_partido.periodo', 'Visible period recorded by a coherent summary; null otherwise.'),
      C('summaryRevision', 'integer', true, 'resumen_partido.rev_fuente', 'Game revision the summary row was derived from (informational; present for coherent and stale summaries); null = missing.'),
      C('summaryProjectionVersion', 'integer', true, 'resumen_partido.version_proyeccion', 'Projection version of the summary row (informational); null = missing.'),
      C('eventsHomePoints', 'integer', false, 'derived from events', 'Home points re-derived from NON-annulled point events of the home team (0 when there are none).'),
      C('eventsAwayPoints', 'integer', false, 'derived from events', 'Away points re-derived the same way.'),
      C('matchesEvents', 'boolean', true, 'derived', 'TRUE when the COHERENT recorded points equal the event-derived points for both sides; null when the summary is stale or missing. A FALSE value is reported in discrepancies, never corrected.'),
    ],
  },
  events: {
    archivo: 'events', titulo: 'Original sporting events (as stored, annulled ones included)', clave: ['gameId', 'seq'],
    campos: [
      C('eventId', 'string', false, 'eventos.id', 'Source event id (command id).'),
      C('gameId', 'string', false, 'eventos.partido_id', 'Game id.'),
      C('seq', 'integer', false, 'eventos.seq', 'Stable order of the event inside the game.'),
      C('type', 'string', false, 'eventos.json.tipo', "'punto' (points) | 'falta' (foul) | 'periodo' (period change)."),
      C('teamId', 'string', true, 'eventos.json.equipoId', "Team of the event; null for 'periodo'."),
      C('playerId', 'string', true, 'eventos.json.jugadorId', "Player record id; null = UNATTRIBUTED (unknown player), never a real player."),
      C('points', 'integer', true, 'eventos.json.puntos', "Points of a 'punto' event; 0 for 'falta'; null for 'periodo'."),
      C('period', 'integer', true, 'eventos.json.periodo', 'Period number stored on the event; null = not stored.'),
      C('annulled', 'boolean', false, 'eventos.json.anulado', 'TRUE when undone/annulled. Annulled events are kept and excluded from every effective total.'),
      C('reportedAt', 'instant', true, 'eventos.json.creadoEn (ms)', 'UTC instant reported by the controlling phone. NOT trusted as a server time.'),
    ],
  },
  player_game_totals: {
    archivo: 'player_game_totals', titulo: 'Derived player totals by game (effective = non-annulled events)', clave: ['gameId', 'teamId', 'playerId'],
    campos: [
      C('gameId', 'string', false, 'derived', 'Game id.'),
      C('teamId', 'string', false, 'derived', 'Team the events were recorded for.'),
      C('playerId', 'string', true, 'derived', 'Player record id; null = the UNATTRIBUTED bucket of that team in that game.'),
      C('gameState', 'string', true, 'games.state', 'State of the game.'),
      C('retired', 'boolean', false, 'games.retired', 'Retired game flag (exclude from league aggregates).'),
      C('points', 'integer', false, 'derived', 'Sum of points of NON-annulled point events.'),
      C('fouls', 'integer', false, 'derived', 'Count of NON-annulled foul events.'),
      C('pointEvents', 'integer', false, 'derived', 'Number of non-annulled point events.'),
      C('annulledEventsExcluded', 'integer', false, 'derived', 'Annulled point/foul events of this bucket, excluded above.'),
    ],
  },
  discrepancies: {
    archivo: 'discrepancies', titulo: 'Discrepancies and interpretation warnings (reported, never corrected)', clave: [],
    campos: [
      C('kind', 'string', false, 'derived', 'Machine code of the finding (see the data dictionary).'),
      C('severity', 'string', false, 'derived', "'discrepancy' (source values disagree) | 'warning' (a source value could not be interpreted)."),
      C('gameId', 'string', true, 'derived', 'Game concerned, if any.'),
      C('entityId', 'string', true, 'derived', 'Other id concerned (team, player or event), if any.'),
      C('field', 'string', true, 'derived', 'Field concerned, if any.'),
      C('recorded', 'string', true, 'derived', 'Value as recorded in the source (text).'),
      C('derived', 'string', true, 'derived', 'Value derived by this converter (text).'),
    ],
  },
})
export const ORDEN_ENTIDADES = Object.freeze(['leagues', 'teams', 'players', 'games', 'game_scores', 'events', 'player_game_totals', 'discrepancies'])

export const TIPOS_DE_HALLAZGO = Object.freeze({
  'score-differs-from-events': 'Recorded game points differ from the points re-derived from non-annulled events. Reported as recorded; not corrected.',
  'summary-missing': 'The game has no summary row, so recorded points are unknown (null).',
  'summary-stale': 'A summary row exists but is not current (field = reason: revision, projection-version or teams; recorded = value in the summary, derived = value the game row requires). Its scores are NOT exported as recorded scores.',
  'summary-stale-values': 'The scores held by a stale summary (recorded = "home-away" points), kept only as evidence; they are not the current recorded score.',
  'event-team-not-in-game': 'An event belongs to a team that is neither home nor away of the game; excluded from derived totals.',
  'event-player-team-mismatch': "The event's player record belongs to another team today. Historical membership is not stored, so this is reported, not resolved.",
  'unattributed-points': 'Point events without a player; counted in the team total and in the unattributed bucket only.',
  'event-annulment-flag-missing': 'The stored event has no annulment flag (absent or null). Production scoring treats that as ACTIVE (marcador-calculo.js: !e.anulado; public SQL: COALESCE(anulado, 0) = 0), so the event is exported with annulled = false and counted in effective totals. A flag that is not true/false/0/1 is rejected instead.',
  'game-state-unsupported': 'The stored game state is missing or not programado/vivo/final. The game is exported with state null and stateRecognised = false and is excluded from final-game aggregates.',
  'instant-not-interpretable': 'A stored instant could not be read as an ISO instant; exported as null.',
  'instant-converted-to-utc': 'A stored instant carried an offset and was converted to UTC.',
  'subcategory-not-interpretable': 'A stored subcategory is not valid JSON; exported as null.',
  'jersey-not-interpretable': 'A stored jersey number is not a non-negative integer; exported as null.',
  'game-without-team': 'The game has no home and/or away team assigned; derived team totals are unavailable for that side.',
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------------------------------------------------------
const TIPOS_EVENTO = new Set(['punto', 'falta', 'periodo'])
const ESTADOS = new Set(['programado', 'vivo', 'final'])

export function convertir(respaldo, { ahora = () => new Date().toISOString() } = {}) {
  verificarEstructuraYSellos(respaldo)
  const nombres = new Set(respaldo.tablas.map((t) => t.nombre))
  const privadas = []
  for (const n of nombres) {
    if (TABLAS_DE_USO[n]) continue
    if (TABLAS_PRIVADAS.includes(n)) { privadas.push(n); continue }
    falla('tabla-no-reconocida', n.slice(0, 40))
  }

  const hallazgos = []
  const hallar = (kind, severity, p = {}) => hallazgos.push({ kind, severity, gameId: p.gameId ?? null, entityId: p.entityId ?? null, field: p.field ?? null, recorded: p.recorded ?? null, derived: p.derived ?? null })
  const avisoDe = (p) => (codigo, severidad = 'warning') => hallar(codigo, severidad, p)

  // --- ligas
  const ligasRaw = filasDe(respaldo, 'ligas')
  if (ligasRaw.length === 0) falla('sin-liga')
  const ligas = unico(ligasRaw, (f) => texto(f.id, 'ligas', 'id', { nulo: false }), 'ligas')
  if (ligas.size !== 1 || !ligas.has(respaldo.objeto)) falla('liga-no-corresponde-al-objeto')
  const filasLiga = ligasRaw.map((f) => {
    let sub = null
    if (f.subcategoria_json !== null) {
      try { sub = JSON.parse(texto(f.subcategoria_json, 'ligas', 'subcategoria_json')) } catch { hallar('subcategory-not-interpretable', 'warning', { entityId: f.id, field: 'subcategory' }); sub = null }
    }
    return { leagueId: f.id, name: texto(f.nombre, 'ligas', 'nombre', { nulo: false }), sport: texto(f.deporte, 'ligas', 'deporte', { nulo: false }),
      minutesPerPeriod: entero(f.minutos_por_periodo, 'ligas', 'minutos_por_periodo'), category: texto(f.categoria, 'ligas', 'categoria'), subcategory: sub }
  })
  const deporteDeLiga = new Map(filasLiga.map((l) => [l.leagueId, l.sport]))

  // --- equipos
  const equiposRaw = filasDe(respaldo, 'equipos')
  const equipos = unico(equiposRaw, (f) => texto(f.id, 'equipos', 'id', { nulo: false }), 'equipos')
  const filasEquipo = equiposRaw.map((f) => {
    const leagueId = texto(f.liga_id, 'equipos', 'liga_id', { nulo: false })
    if (!ligas.has(leagueId)) falla('relacion-rota', 'equipos.liga_id')
    return { teamId: f.id, leagueId, name: texto(f.nombre, 'equipos', 'nombre', { nulo: false }), branch: texto(f.rama, 'equipos', 'rama') }
  })

  // --- jugadores (plantilla ACTUAL)
  const jugadoresRaw = filasDe(respaldo, 'jugadores')
  const jugadores = unico(jugadoresRaw, (f) => texto(f.id, 'jugadores', 'id', { nulo: false }), 'jugadores')
  const filasJugador = jugadoresRaw.map((f) => {
    const teamId = texto(f.equipo_id, 'jugadores', 'equipo_id', { nulo: false })
    const eq = equipos.get(teamId)
    if (!eq) falla('relacion-rota', 'jugadores.equipo_id')
    if (f.liga_id !== null && f.liga_id !== eq.liga_id) falla('relacion-inconsistente', 'jugadores.liga_id')
    let jersey = null
    if (f.dorsal !== null) {
      if (Number.isSafeInteger(f.dorsal) && f.dorsal >= 0) jersey = f.dorsal
      else hallar('jersey-not-interpretable', 'warning', { entityId: f.id, field: 'currentJersey' })
    }
    if (f.activo !== 0 && f.activo !== 1) falla('tipo-inesperado', 'jugadores.activo')
    return { playerId: f.id, teamId, leagueId: eq.liga_id, givenName: texto(f.nombre_pila, 'jugadores', 'nombre_pila'), surname1: texto(f.apellido1, 'jugadores', 'apellido1'),
      surname2: texto(f.apellido2, 'jugadores', 'apellido2'), legacyName: texto(f.nombre, 'jugadores', 'nombre'), currentJersey: jersey, active: f.activo === 1 }
  })

  // --- partidos
  const partidosRaw = filasDe(respaldo, 'partidos')
  const partidos = unico(partidosRaw, (f) => texto(f.id, 'partidos', 'id', { nulo: false }), 'partidos')
  const juegos = new Map()
  const filasJuego = partidosRaw.map((f) => {
    const leagueId = texto(f.liga_id, 'partidos', 'liga_id', { nulo: false })
    if (!ligas.has(leagueId)) falla('relacion-rota', 'partidos.liga_id')
    for (const c of ['local_id', 'visita_id']) if (f[c] !== null && !equipos.has(texto(f[c], 'partidos', c))) falla('relacion-rota', `partidos.${c}`)
    for (const c of ['local_id', 'visita_id']) if (f[c] !== null && equipos.get(f[c]).liga_id !== leagueId) falla('relacion-inconsistente', `partidos.${c}`)
    let e
    try { e = JSON.parse(texto(f.estado_json, 'partidos', 'estado_json', { nulo: false })) } catch { return falla('estado-json-ilegible', 'partidos') }
    if (e === null || typeof e !== 'object' || e.partido === null || typeof e.partido !== 'object') falla('estado-json-ilegible', 'partidos')
    const aviso = avisoDe({ gameId: f.id })
    let state = null
    if (typeof e.partido.estado === 'string' && ESTADOS.has(e.partido.estado)) state = e.partido.estado
    const estadoReconocido = state !== null
    if (!estadoReconocido) aviso('game-state-unsupported', 'discrepancy')
    if (f.local_id === null || f.visita_id === null) aviso('game-without-team')
    const retired = entero(f.retirado_en, 'partidos', 'retirado_en') !== null
    const row = {
      gameId: f.id, leagueId, homeTeamId: f.local_id, awayTeamId: f.visita_id, state, stateRecognised: estadoReconocido, retired,
      scheduledFor: instante(f.programado_para, aviso),
      startedAt: state !== null && state !== 'programado' ? instante(e.partido.inicio, aviso) : null,
      venue: texto(f.sede, 'partidos', 'sede'), revision: entero(f.rev, 'partidos', 'rev', { nulo: false }), sport: deporteDeLiga.get(leagueId),
    }
    juegos.set(f.id, row)
    return row
  })

  // --- eventos
  const eventosRaw = filasDe(respaldo, 'eventos')
  const clavesEvento = new Set()
  const porJuego = new Map()
  const filasEvento = eventosRaw.map((f) => {
    const gameId = texto(f.partido_id, 'eventos', 'partido_id', { nulo: false })
    const juego = juegos.get(gameId)
    if (!juego) falla('relacion-rota', 'eventos.partido_id')
    let j
    try { j = JSON.parse(texto(f.json, 'eventos', 'json', { nulo: false })) } catch { return falla('evento-ilegible', 'eventos.json') }
    if (j === null || typeof j !== 'object' || Array.isArray(j)) falla('evento-ilegible', 'eventos.json')
    const eventId = texto(f.id, 'eventos', 'id', { nulo: false })
    const seq = entero(f.seq, 'eventos', 'seq', { nulo: false, min: 1 })
    if (j.id !== undefined && j.id !== eventId) falla('evento-inconsistente', 'eventos.id')
    if (j.seq !== undefined && j.seq !== seq) falla('evento-inconsistente', 'eventos.seq')
    if (j.partidoId !== undefined && j.partidoId !== gameId) falla('evento-inconsistente', 'eventos.partido_id')
    if (clavesEvento.has(`${gameId}\u0000${seq}`) || clavesEvento.has(`${gameId}\u0000id:${eventId}`)) falla('identificador-duplicado', 'eventos')
    clavesEvento.add(`${gameId}\u0000${seq}`); clavesEvento.add(`${gameId}\u0000id:${eventId}`)
    if (typeof j.tipo !== 'string' || !TIPOS_EVENTO.has(j.tipo)) falla('tipo-de-evento-no-soportado', 'eventos.json.tipo')
    const type = j.tipo
    const aviso = avisoDe({ gameId, entityId: eventId })
    const teamId = j.equipoId === undefined || j.equipoId === null ? null : j.equipoId
    if (type !== 'periodo' && typeof teamId !== 'string') falla('evento-sin-equipo', 'eventos.json.equipoId')
    if (teamId !== null && (typeof teamId !== 'string' || !equipos.has(teamId))) falla('relacion-rota', 'eventos.json.equipoId')
    const playerId = j.jugadorId === undefined || j.jugadorId === null ? null : j.jugadorId
    if (playerId !== null && (typeof playerId !== 'string' || !jugadores.has(playerId))) falla('relacion-rota', 'eventos.json.jugadorId')
    let points = null
    if (type === 'punto') { if (!Number.isSafeInteger(j.puntos) || j.puntos < 0) falla('puntos-invalidos', 'eventos.json.puntos'); points = j.puntos }
    else if (type === 'falta') points = 0
    let annulled
    if (j.anulado === true || j.anulado === false) annulled = j.anulado
    else if (j.anulado === 0 || j.anulado === 1) annulled = j.anulado === 1
    else if (j.anulado === undefined || j.anulado === null) { annulled = false; aviso('event-annulment-flag-missing') }
    else falla('tipo-inesperado', 'eventos.json.anulado')
    const period = j.periodo === undefined || j.periodo === null ? null : (Number.isSafeInteger(j.periodo) && j.periodo >= 0 ? j.periodo : falla('tipo-inesperado', 'eventos.json.periodo'))
    const reportedAt = j.creadoEn === undefined || j.creadoEn === null ? null : instanteDeMs(j.creadoEn, aviso)
    const fila = { eventId, gameId, seq, type, teamId, playerId, points, period, annulled, reportedAt }
    if (!porJuego.has(gameId)) porJuego.set(gameId, [])
    porJuego.get(gameId).push(fila)
    return fila
  })
  filasEvento.sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : a.seq - b.seq))

  // --- resumen (marcador REGISTRADO)
  const resumenRaw = filasDe(respaldo, 'resumen_partido')
  const resumenes = unico(resumenRaw, (f) => texto(f.partido_id, 'resumen_partido', 'partido_id', { nulo: false }), 'resumen_partido')
  for (const id of resumenes.keys()) if (!juegos.has(id)) falla('relacion-rota', 'resumen_partido.partido_id')

  // --- derivados
  const filasMarcador = []
  const totales = new Map()
  for (const j of filasJuego) {
    const evs = porJuego.get(j.gameId) ?? []
    let eh = 0; let ea = 0
    for (const e of evs) {
      if (e.type === 'periodo') continue
      const dentro = e.teamId === j.homeTeamId || e.teamId === j.awayTeamId
      if (!dentro) { hallar('event-team-not-in-game', 'discrepancy', { gameId: j.gameId, entityId: e.eventId }); continue }
      if (e.playerId !== null && jugadores.get(e.playerId).equipo_id !== e.teamId) hallar('event-player-team-mismatch', 'discrepancy', { gameId: j.gameId, entityId: e.eventId, field: 'playerId' })
      const k = `${j.gameId}\u0000${e.teamId}\u0000${e.playerId === null ? '-' : `p:${e.playerId}`}`
      let t = totales.get(k)
      if (!t) { t = { gameId: j.gameId, teamId: e.teamId, playerId: e.playerId, gameState: j.state, retired: j.retired, points: 0, fouls: 0, pointEvents: 0, annulledEventsExcluded: 0 }; totales.set(k, t) }
      if (e.annulled) { t.annulledEventsExcluded += 1; continue }
      if (e.type === 'punto') { t.points += e.points; t.pointEvents += 1; if (e.teamId === j.homeTeamId) eh += e.points; else ea += e.points }
      else t.fouls += 1
    }
    const r = resumenes.get(j.gameId) ?? null
    let rec = { h: null, a: null, hf: null, af: null, p: null }
    let estadoResumen = 'missing'
    let razones = null
    let rv = null
    let pv = null
    if (r === null) hallar('summary-missing', 'discrepancy', { gameId: j.gameId })
    else {
      const num = (c) => entero(r[c], 'resumen_partido', c, { nulo: false })
      const h = num('local_puntos'); const a = num('visita_puntos'); const hf = num('local_faltas'); const af = num('visita_faltas')
      const periodo = num('periodo'); rv = num('rev_fuente'); pv = num('version_proyeccion')
      const motivos = []
      if (rv !== j.revision) { motivos.push('revision'); hallar('summary-stale', 'discrepancy', { gameId: j.gameId, field: 'revision', recorded: String(rv), derived: String(j.revision) }) }
      if (pv !== VERSION_PROYECCION_SOPORTADA) { motivos.push('projection-version'); hallar('summary-stale', 'discrepancy', { gameId: j.gameId, field: 'projection-version', recorded: String(pv), derived: String(VERSION_PROYECCION_SOPORTADA) }) }
      if (r.local_id !== j.homeTeamId || r.visita_id !== j.awayTeamId) { motivos.push('teams'); hallar('summary-stale', 'discrepancy', { gameId: j.gameId, field: 'teams', recorded: `${r.local_id}/${r.visita_id}`, derived: `${j.homeTeamId}/${j.awayTeamId}` }) }
      if (motivos.length === 0) { estadoResumen = 'coherent'; rec = { h, a, hf, af, p: periodo } }
      else { estadoResumen = 'stale'; razones = motivos.join(','); hallar('summary-stale-values', 'warning', { gameId: j.gameId, field: 'points', recorded: `${h}-${a}` }) }
    }
    const coincide = estadoResumen === 'coherent' ? rec.h === eh && rec.a === ea : null
    if (coincide === false) {
      if (rec.h !== eh) hallar('score-differs-from-events', 'discrepancy', { gameId: j.gameId, field: 'home', recorded: String(rec.h), derived: String(eh) })
      if (rec.a !== ea) hallar('score-differs-from-events', 'discrepancy', { gameId: j.gameId, field: 'away', recorded: String(rec.a), derived: String(ea) })
    }
    filasMarcador.push({ gameId: j.gameId, state: j.state, retired: j.retired, summaryStatus: estadoResumen, summaryStaleReasons: razones, recordedHomePoints: rec.h, recordedAwayPoints: rec.a,
      recordedHomeFouls: rec.hf, recordedAwayFouls: rec.af, recordedPeriod: rec.p, summaryRevision: rv, summaryProjectionVersion: pv, eventsHomePoints: eh, eventsAwayPoints: ea, matchesEvents: coincide })
  }
  for (const t of totales.values()) if (t.playerId === null && t.pointEvents > 0) hallar('unattributed-points', 'warning', { gameId: t.gameId, entityId: t.teamId, recorded: String(t.points) })
  const cmp = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)
  const filasTotales = [...totales.values()].sort((a, b) => cmp(a.gameId, b.gameId) || cmp(a.teamId, b.teamId) || cmp(a.playerId, b.playerId))

  const ordena = (filas, ...claves) => [...filas].sort((a, b) => { for (const c of claves) { const d = cmp(a[c], b[c]); if (d) return d } return 0 })
  const datos = {
    leagues: ordena(filasLiga, 'leagueId'),
    teams: ordena(filasEquipo, 'teamId'),
    players: ordena(filasJugador, 'playerId'),
    games: ordena(filasJuego, 'gameId'),
    game_scores: ordena(filasMarcador, 'gameId'),
    events: filasEvento,
    player_game_totals: filasTotales,
    discrepancies: hallazgos.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.gameId, b.gameId) || cmp(a.entityId, b.entityId) || cmp(a.field, b.field)),
  }

  return armarPaquete(datos, respaldo, privadas.sort(), ahora())
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Paquete del organizador (sin infraestructura) + informe tecnico PRIVADO (aparte)
// ---------------------------------------------------------------------------------------------------------------------------------------------
/** CSV de la vista INTERNA (la usan las pruebas); el paquete del organizador usa su propio contrato. */
export const aCsv = (entidad, filas) => csvDeCampos(ENTIDADES[entidad].campos, filas)

function armarPaquete(datos, respaldo, privadas, generadoEn) {
  const capturado = Number.isSafeInteger(respaldo.capturadoEnMs) && Math.abs(respaldo.capturadoEnMs) <= 8.64e15 ? new Date(respaldo.capturadoEnMs).toISOString() : null
  const paquete = armarPaqueteOrganizador(datos, datos.discrepancies, { generadoEn, datosAl: capturado })
  const tecnico = {
    format: 'sebel-portable-export-technical-report', formatVersion: 1, confidential: 'PRIVATE: never include in the organizer package or its ZIP.', generatedAt: generadoEn,
    converter: { name: 'exportar-portable', version: VERSION_EXPORTADOR },
    source: { format: respaldo.formato, formatVersion: respaldo.version, class: respaldo.clase, object: respaldo.objeto, schemaVersion: respaldo.versionEsquema, projectionVersionSupported: VERSION_PROYECCION_SOPORTADA,
      sealSha256: respaldo.sha256, capturedAtMs: Number.isSafeInteger(respaldo.capturadoEnMs) ? respaldo.capturadoEnMs : null, capturedAt: capturado, sealsVerified: true,
      platformInternalTables: Array.isArray(respaldo.internasDeLaPlataforma) ? [...respaldo.internasDeLaPlataforma].sort() : [], privateTablesRecognisedAndExcluded: privadas },
    organizerPackage: { manifestSha256: sha256Hex(paquete.archivos.get('MANIFEST.json')), counts: paquete.manifiesto.counts, files: paquete.manifiesto.files.map((f) => ({ name: f.name, sha256: f.sha256 })) },
    internalCounts: Object.fromEntries(ORDEN_ENTIDADES.map((n) => [n, datos[n].length])),
    games: datos.games.map((g) => ({ gameId: g.gameId, sourceRevision: g.revision })).sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    summaries: datos.game_scores.map((x) => ({ gameId: x.gameId, status: x.summaryStatus, staleReasons: x.summaryStaleReasons, summaryRevision: x.summaryRevision, projectionVersion: x.summaryProjectionVersion }))
      .sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    findings: datos.discrepancies,
    findingKinds: TIPOS_DE_HALLAZGO,
    fieldSources: Object.fromEntries(ORDEN_ENTIDADES.map((n) => [n, ENTIDADES[n].campos.map((c) => ({ field: c.nombre, source: c.origen, note: c.descripcion }))])),
  }
  return { manifiesto: paquete.manifiesto, archivos: paquete.archivos, datos, informeTecnico: tecnico }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Escritura: carpeta NUEVA 0700 fuera de Git, archivos NUEVOS 0600 (wx), MANIFEST.json el ultimo. Un fallo a medias renombra la carpeta a *.INCOMPLETO.
// ---------------------------------------------------------------------------------------------------------------------------------------------
export function carpetaPrivadaNueva(ruta) {
  const r = resolve(ruta)
  for (let d = dirname(r); ; d = dirname(d)) {
    if (existsSync(`${d}/.git`)) falla('salida-dentro-de-un-repositorio')
    if (dirname(d) === d) break
  }
  if (!existsSync(dirname(r))) falla('salida-sin-carpeta-padre')
  if (existsSync(r) || existsSync(`${r}.INCOMPLETO`)) falla('salida-ya-existe')
  mkdirSync(r, { mode: 0o700 })
  chmodSync(r, 0o700)
  return r
}

function escribirNuevo(ruta, contenido) {
  const fd = openSync(ruta, 'wx', 0o600)
  try { writeSync(fd, contenido); if ((fstatSync(fd).mode & 0o077) !== 0) falla('permisos-abiertos') } finally { closeSync(fd) }
}

/** Ruta del informe tecnico: archivo NUEVO, fuera de Git, con carpeta padre existente y FUERA de la carpeta del paquete. */
export function comprobarRutaDeInforme(rutaInforme, carpetaPaquete) {
  const r = resolve(rutaInforme)
  const c = resolve(carpetaPaquete)
  if (r === c || r.startsWith(c + sep)) falla('informe-dentro-del-paquete')
  for (let d = dirname(r); ; d = dirname(d)) {
    if (existsSync(`${d}/.git`)) falla('informe-dentro-de-un-repositorio')
    if (dirname(d) === d) break
  }
  if (!existsSync(dirname(r))) falla('informe-sin-carpeta-padre')
  if (existsSync(r)) falla('informe-ya-existe')
  return r
}

export function escribirPaquete(carpetaSalida, paquete, { alEscribir = () => {}, rutaInforme = null } = {}) {
  const informe = rutaInforme === null ? null : comprobarRutaDeInforme(rutaInforme, carpetaSalida)
  const carpeta = carpetaPrivadaNueva(carpetaSalida)
  try {
    for (const [nombre, contenido] of paquete.archivos) {
      if (nombre === 'MANIFEST.json') continue
      escribirNuevo(`${carpeta}/${nombre}`, contenido)
      alEscribir(nombre)
    }
    if (informe !== null) escribirNuevo(informe, aJson(paquete.informeTecnico)) // antes del manifiesto: si falla, el paquete no parece completo
    escribirNuevo(`${carpeta}/MANIFEST.json`, paquete.archivos.get('MANIFEST.json'))
  } catch (e) {
    try { renameSync(carpeta, `${carpeta}.INCOMPLETO`) } catch { /* sin manifiesto: ya no parece completo */ }
    throw e
  }
  return carpeta
}
