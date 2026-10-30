// Paquete PARA EL ORGANIZADOR: solo datos deportivos, ids estables y avisos en lenguaje llano. Aqui NO entra ningun detalle de infraestructura (proveedor, objetos, versiones
// internas, tablas, despliegue): eso va al informe tecnico PRIVADO, que se escribe aparte y nunca dentro del paquete ni del ZIP.
import { aJson, csvDeCampos, sha256Hex } from './util-portable.mjs'

export const FORMATO_PAQUETE = 'sebel-portable-sports-data'
export const VERSION_PAQUETE = 2

const D = (nombre, tipo, nulable, descripcion) => ({ nombre, tipo, nulable, descripcion })

export const CONTRATO = Object.freeze({
  leagues: { archivo: 'leagues', titulo: 'Leagues', campos: [
    D('leagueId', 'string', false, 'Stable id of the league. Never changes; use it to join files.'),
    D('name', 'string', false, 'League name, exact text.'),
    D('sport', 'string', false, 'Sport code (e.g. baloncesto).'),
    D('minutesPerPeriod', 'integer', true, 'Configured minutes per period; null = not configured (unknown).'),
    D('category', 'string', true, 'Category code; null = unknown.'),
    D('subcategory', 'json', true, 'Subcategory object (JSON file: the value; CSV: its JSON text); null = unknown.'),
  ] },
  teams: { archivo: 'teams', titulo: 'Teams', campos: [
    D('teamId', 'string', false, 'Stable id of the team.'),
    D('leagueId', 'string', false, 'League the team belongs to.'),
    D('name', 'string', false, 'Team name, exact text.'),
    D('branch', 'string', true, "'masculino' | 'femenino' | 'mixta'; null = unknown (never inferred)."),
  ] },
  players: { archivo: 'players', titulo: 'Players (CURRENT roster only)', campos: [
    D('playerId', 'string', false, 'Stable id of the player record. Events refer to this id.'),
    D('teamId', 'string', false, "The player's team as of the export date. It is NOT the history of teams the player has played for."),
    D('leagueId', 'string', false, 'League of that team.'),
    D('givenName', 'string', true, 'Given name(s); null = not recorded.'),
    D('surname1', 'string', true, 'First surname; null = not recorded.'),
    D('surname2', 'string', true, 'Second surname; null = not recorded.'),
    D('legacyName', 'string', true, 'Full name as typed in older records; null = not recorded.'),
    D('currentJersey', 'integer', true, 'Jersey number as of the export date (0 is a valid number); null = none/unknown. NOT the number worn in past games.'),
    D('active', 'boolean', false, 'Whether the player is active in the roster as of the export date.'),
  ] },
  games: { archivo: 'games', titulo: 'Games', campos: [
    D('gameId', 'string', false, 'Stable id of the game.'),
    D('leagueId', 'string', false, 'League of the game.'),
    D('homeTeamId', 'string', true, "Home ('local') team id; null = not assigned."),
    D('awayTeamId', 'string', true, "Away ('visita') team id; null = not assigned."),
    D('state', 'string', true, "'programado' (scheduled) | 'vivo' (in progress or paused) | 'final' (finished). null only when the state is not recognised (see stateRecognised). Never deduced from the clock."),
    D('stateRecognised', 'boolean', false, 'FALSE when the game state is missing or not one of the three above. Such a game is exported for completeness, flagged, and is counted in no finished-game total.'),
    D('retired', 'boolean', false, 'TRUE when the organizer withdrew the game from the public site. Withdrawn games are exported, flagged; leave them out of league totals.'),
    D('scheduledFor', 'instant', true, 'Scheduled start, UTC instant; null = unknown. No country or time zone is stored or invented.'),
    D('startedAt', 'instant', true, "UTC instant the game was started (only when state is not 'programado'), as reported by the scoring phone; null = unknown."),
    D('venue', 'string', true, 'Venue text of this game, exact (accents preserved); null = unknown.'),
    D('sport', 'string', false, 'Sport of the league.'),
  ] },
  game_scores: { archivo: 'game_scores', titulo: 'Results as registered, beside points added up from events', campos: [
    D('gameId', 'string', false, 'Game id.'),
    D('state', 'string', true, 'Game state (see games).'),
    D('retired', 'boolean', false, 'Withdrawn-game flag.'),
    D('recordedScoreStatus', 'string', false, "'available' = the registered result is current; 'not-current' = a registered result exists but no longer matches the game, so it is NOT exported; 'unavailable' = no registered result exists."),
    D('recordedHomePoints', 'integer', true, "Home points AS REGISTERED. null when the status is not 'available' (unknown; never 0 and never an out-of-date value)."),
    D('recordedAwayPoints', 'integer', true, "Away points as registered; null unless 'available'."),
    D('recordedHomeFouls', 'integer', true, "Home team fouls (whole game) as registered; null unless 'available'."),
    D('recordedAwayFouls', 'integer', true, "Away team fouls (whole game) as registered; null unless 'available'."),
    D('recordedPeriod', 'integer', true, "Period shown as registered; null unless 'available'."),
    D('eventsHomePoints', 'integer', false, 'Home points added up from the valid (not annulled) point events of the home team; 0 when there are none.'),
    D('eventsAwayPoints', 'integer', false, 'Away points added up the same way.'),
    D('matchesEvents', 'boolean', true, "TRUE when the registered points equal the points added up from events; FALSE is reported in findings and never corrected; null unless 'available'."),
  ] },
  events: { archivo: 'events', titulo: 'Original sporting events (annulled ones included)', campos: [
    D('eventId', 'string', false, 'Stable id of the event.'),
    D('gameId', 'string', false, 'Game id.'),
    D('seq', 'integer', false, 'Order of the event inside the game.'),
    D('type', 'string', false, "'punto' (points) | 'falta' (foul) | 'periodo' (period change)."),
    D('teamId', 'string', true, "Team of the event; null for 'periodo'."),
    D('playerId', 'string', true, 'Player id; null = no player was assigned (unknown), never a real player.'),
    D('points', 'integer', true, "Points of a 'punto' event; 0 for 'falta'; null for 'periodo'."),
    D('period', 'integer', true, 'Period number stored on the event; null = not stored.'),
    D('annulled', 'boolean', false, 'TRUE when the event was undone/annulled. Annulled events are kept here and excluded from every total.'),
    D('reportedAt', 'instant', true, 'UTC instant reported by the scoring phone; not verified.'),
  ] },
  player_game_totals: { archivo: 'player_game_totals', titulo: 'Player totals by game (valid events only)', campos: [
    D('gameId', 'string', false, 'Game id.'),
    D('teamId', 'string', false, 'Team the events were recorded for.'),
    D('playerId', 'string', true, "Player id; null = the team's bucket of events with no player assigned."),
    D('gameState', 'string', true, 'State of the game.'),
    D('retired', 'boolean', false, 'Withdrawn-game flag (leave out of league totals).'),
    D('points', 'integer', false, 'Sum of points of the valid point events.'),
    D('fouls', 'integer', false, 'Number of valid foul events.'),
    D('pointEvents', 'integer', false, 'Number of valid point events.'),
    D('annulledEventsExcluded', 'integer', false, 'Annulled point/foul events of this row, left out of the totals.'),
  ] },
  findings: { archivo: 'findings', titulo: 'Findings: things to know about the data (reported, never corrected)', campos: [
    D('code', 'string', false, 'Finding code (see the list below).'),
    D('severity', 'string', false, "'discrepancy' (values disagree or are unavailable) | 'warning' (a value could not be read or needs care)."),
    D('gameId', 'string', true, 'Game concerned, if any.'),
    D('entityId', 'string', true, 'Other id concerned (team, player or event), if any.'),
    D('field', 'string', true, 'Field concerned, if any.'),
    D('recorded', 'string', true, 'Value as registered (text), if any.'),
    D('derived', 'string', true, 'Value added up from events (text), if any.'),
    D('message', 'string', false, 'Plain-language explanation in Spanish.'),
  ] },
})
export const ORDEN = Object.freeze(['leagues', 'teams', 'players', 'games', 'game_scores', 'events', 'player_game_totals', 'findings'])
export const ARCHIVOS_APROBADOS = Object.freeze([
  'LEEME.md', 'DATA_DICTIONARY.md', 'MANIFEST.json',
  ...ORDEN.flatMap((e) => [`${CONTRATO[e].archivo}.json`, `${CONTRATO[e].archivo}.csv`]),
].sort())

// Hallazgos internos -> avisos del organizador (sin motivos tecnicos). `null` = solo va al informe tecnico.
const T = (code, severity, message) => ({ code, severity, message })
export const HALLAZGOS = Object.freeze({
  'score-differs-from-events': T('registered-score-differs-from-events', 'discrepancy', 'El marcador registrado de este lado no coincide con los puntos sumados de los eventos válidos. Se exporta tal como está registrado; no se corrigió.'),
  'summary-missing': T('registered-score-unavailable', 'discrepancy', 'No hay marcador registrado disponible para este partido. No se muestra ningún valor (esto no significa 0).'),
  'summary-stale': T('registered-score-not-current', 'discrepancy', 'El marcador guardado ya no corresponde al estado actual del partido, así que no se exporta como marcador registrado. Los puntos sumados de los eventos se muestran aparte.'),
  'summary-stale-values': null,
  'game-state-unsupported': T('game-state-not-recognised', 'discrepancy', 'El estado del partido no se reconoce. Se exporta sin estado y no se cuenta como partido terminado.'),
  'event-team-not-in-game': T('event-from-other-team', 'discrepancy', 'Un evento pertenece a un equipo que no juega este partido. Se exporta, pero no se suma a ningún total.'),
  'event-player-team-mismatch': T('player-listed-in-other-team', 'discrepancy', 'El jugador del evento figura hoy en otro equipo. No se conserva el historial de plantillas, así que no se puede confirmar a qué equipo pertenecía entonces.'),
  'unattributed-points': T('points-without-player', 'warning', 'Hay puntos sin jugador asignado. Cuentan para el equipo, pero no para ningún jugador.'),
  'event-annulment-flag-missing': T('event-without-annulment-mark', 'warning', 'El evento no trae marca de anulación. Se cuenta como válido, igual que hace la aplicación.'),
  'instant-not-interpretable': T('date-not-readable', 'warning', 'Una fecha u hora guardada no se pudo interpretar. Se exporta vacía (desconocida).'),
  'instant-converted-to-utc': T('date-converted-to-utc', 'warning', 'Una fecha u hora guardada traía desplazamiento horario. Se convirtió a UTC.'),
  'jersey-not-interpretable': T('jersey-not-readable', 'warning', 'El número de camiseta guardado no es un número válido. Se exporta vacío (desconocido).'),
  'subcategory-not-interpretable': T('subcategory-not-readable', 'warning', 'La subcategoría guardada no se pudo leer. Se exporta vacía (desconocida).'),
  'game-without-team': T('game-without-team', 'warning', 'El partido no tiene asignado equipo local y/o visitante.'),
})
export const CODIGOS_DE_AVISO = Object.freeze(Object.fromEntries(Object.values(HALLAZGOS).filter(Boolean).map((h) => [h.code, h.message])))

export function avisosParaOrganizador(internos) {
  const vistos = new Set()
  const filas = []
  for (const h of internos) {
    const t = HALLAZGOS[h.kind]
    if (t === undefined) throw new Error('hallazgo-sin-traduccion')
    if (t === null) continue
    const stale = h.kind === 'summary-stale'
    const f = { code: t.code, severity: t.severity, gameId: h.gameId, entityId: stale ? null : h.entityId, field: stale ? null : h.field, recorded: stale ? null : h.recorded, derived: stale ? null : h.derived, message: t.message }
    const llave = JSON.stringify(f)
    if (vistos.has(llave)) continue // varios motivos internos de un mismo marcador no vigente = un solo aviso
    vistos.add(llave); filas.push(f)
  }
  return filas
}

const ESTADO_MARCADOR = { coherent: 'available', stale: 'not-current', missing: 'unavailable' }
const PROYECCION = {
  game_scores: (f) => ({ ...f, recordedScoreStatus: ESTADO_MARCADOR[f.summaryStatus] }),
}
export function filasDelOrganizador(datos, avisos) {
  const out = {}
  for (const e of ORDEN) {
    const campos = CONTRATO[e].campos
    const fuente = e === 'findings' ? avisos : datos[e]
    out[e] = fuente.map((fila) => {
      const f = PROYECCION[e] ? PROYECCION[e](fila) : fila
      return Object.fromEntries(campos.map((c) => [c.nombre, f[c.nombre] === undefined ? null : f[c.nombre]]))
    })
  }
  return out
}

export const COBERTURA = Object.freeze({
  events: 'All sporting events stored for the exported games, annulled ones included. Completeness is relative to what was stored; nothing here proves every action of a game was recorded.',
  validEvents: 'Events with annulled = false. A stored event without an annulment mark counts as valid, as the application does. Every total uses only valid events.',
  registeredResults: "Scores exactly as registered by the application, never corrected and not official. A registered result is exported only when it is current ('available'); out-of-date or missing ones export null. Only games with state 'final' and an available result have a final registered result.",
  pointsFromEvents: 'Points added up from valid events, shown beside the registered result. Differences are listed in findings and never reconciled.',
  playerTotals: "Derived only from events: points and fouls. A player with no row had no recorded point or foul in that game; their participation is UNKNOWN, not zero. Points with no player assigned go to the team's bucket (playerId null).",
  roster: 'Players and jersey numbers are the current roster at the export date only.',
})
export const NO_DISPONIBLE = Object.freeze([
  'Team membership history: the files show each player\'s team as of the export date, not the team they had in each past game.',
  'Jersey numbers worn in past games: only the current number is included.',
  'Minutes played, who was on court, lineups, assists, rebounds, or any statistic other than points and fouls.',
  'Country and time zone of leagues, teams or venues, and a precise venue identity (only the free text of each game).',
  'Event times other than the instant reported by the scoring phone.',
  'The date a game was withdrawn (only the flag is included).',
])

function diccionario() {
  const l = ['# SEBEL portable sports data - data dictionary', '', `Format \`${FORMATO_PAQUETE}\` version ${VERSION_PAQUETE}. Spanish import instructions are in \`LEEME.md\`.`, '', '## Conventions', '',
    '- **JSON is the reference.** Each `<name>.json` is `{ format, formatVersion, entity, count, fields, rows }` and keeps the exact text. The CSV files are a convenience copy.',
    '- **Unknown vs zero.** An unknown or not-recorded value is `null`. A numeric zero is `0`. They are never interchangeable.',
    '- **CSV null encoding.** A `null` is an EMPTY field with no quotes (`,,`). An empty text is `""`. Only a quote-aware reader can tell them apart; spreadsheets usually cannot, so use the JSON when the difference matters.',
    '- **CSV format.** UTF-8 without BOM, comma separated, CRLF line ends, text with quotes/commas/line breaks quoted, header row first. Booleans are `true`/`false`.',
    "- **Formula guard.** CSV text starting with `=`, `+`, `-`, `@`, TAB or CR is written with one leading apostrophe so spreadsheets do not run it; remove one leading apostrophe to recover the text. Numbers and booleans are never changed.",
    '- **Instants** are ISO-8601 UTC (`...Z`). No country or time zone is stored or invented.',
    '- **IDs** are stable and unchanged; join files by them.', '']
  for (const n of ORDEN) {
    const e = CONTRATO[n]
    l.push(`## ${e.archivo}.json / ${e.archivo}.csv - ${e.titulo}`, '', '| Field | Type | Nullable | Meaning |', '|---|---|---|---|')
    for (const c of e.campos) l.push(`| \`${c.nombre}\` | ${c.tipo} | ${c.nulable ? 'yes' : 'no'} | ${c.descripcion.replaceAll('|', '/')} |`)
    l.push('')
  }
  l.push('## Finding codes (`findings.code`)', '')
  for (const [k, v] of Object.entries(CODIGOS_DE_AVISO)) l.push(`- \`${k}\`: ${v}`)
  l.push('', '## Statistical coverage', '')
  for (const [k, v] of Object.entries(COBERTURA)) l.push(`- **${k}**: ${v}`)
  l.push('', '## Not included (and not inferred)', '')
  for (const v of NO_DISPONIBLE) l.push(`- ${v}`)
  l.push('')
  return l.join('\n')
}

const LEEME = `# Datos deportivos exportados (SEBEL)

Este paquete contiene los datos deportivos de una liga: ligas, equipos, jugadores, partidos, resultados, eventos originales y totales por jugador y partido. Los resultados están **tal como registrados**: no son resultados oficiales, no se verificaron y **no se corrigió nada**.

## Archivos y cómo se relacionan
Cada conjunto viene en dos formatos: \`.json\` (la referencia exacta) y \`.csv\` (copia cómoda para hojas de cálculo).

- \`leagues\` → liga (\`leagueId\`).
- \`teams\` → equipos; \`leagueId\` apunta a la liga.
- \`players\` → jugadores; \`teamId\` apunta a su equipo **actual**.
- \`games\` → partidos; \`homeTeamId\` y \`awayTeamId\` apuntan a \`teams\`.
- \`game_scores\` → un renglón por partido (\`gameId\`): marcador registrado y, al lado, los puntos sumados de los eventos.
- \`events\` → cada punto, falta y cambio de periodo (\`gameId\`, \`teamId\`, \`playerId\`).
- \`player_game_totals\` → puntos y faltas por jugador en cada partido (\`gameId\`, \`teamId\`, \`playerId\`).
- \`findings\` → avisos en lenguaje llano sobre los datos (léalos antes de usar los resultados).
- \`DATA_DICTIONARY.md\` → cada campo. \`MANIFEST.json\` → conteos, definiciones y sumas de comprobación (SHA-256) de cada archivo.

## Identificadores (IDs)
Los IDs (\`leagueId\`, \`teamId\`, \`playerId\`, \`gameId\`, \`eventId\`) son estables y se conservan tal cual: úselos para unir archivos. No los edite ni los reconstruya a partir de nombres.

## Nulo frente a cero
- **Vacío / \`null\` = se desconoce o no se registró.** **\`0\` = cero real.** Un partido sin marcador disponible tiene el marcador vacío, no 0.
- En el CSV, un campo vacío **sin comillas** es desconocido y \`""\` es un texto vacío. Excel y otras hojas normalmente no distinguen esa diferencia: si importa, use el JSON.

## Limitaciones del CSV
- Codificación UTF-8 sin BOM: al abrir en Excel use "Importar datos" y elija UTF-8 para ver bien las tildes y la ñ.
- Los textos que empiezan por \`=\`, \`+\`, \`-\`, \`@\` llevan un apóstrofo delante para que la hoja no los ejecute como fórmula; quítelo si necesita el texto original (el JSON lo conserva exacto).
- Las fechas son instantes UTC (\`...Z\`). No se guarda ni se inventa país ni zona horaria.

## Eventos anulados
Los eventos anulados **se conservan** en \`events\` con \`annulled: true\`, pero **no suman** en ningún total. Un evento sin marca de anulación se cuenta como válido.

## Cobertura estadística
- Solo hay **puntos y faltas** (no minutos, quintetos, asistencias ni rebotes).
- Un jugador sin renglón en \`player_game_totals\` no tuvo puntos ni faltas registrados en ese partido; **no** significa que no jugó.
- Los puntos sin jugador asignado cuentan para el equipo (\`playerId\` vacío), no para un jugador.
- La plantilla y los dorsales son los **actuales**; no hay historial de equipos ni de números por partido.
- Los partidos con \`retired: true\` fueron retirados por el organizador: se incluyen marcados, pero no deben contarse en totales de la liga.

## Resultados "tal como registrados"
\`game_scores\` muestra el marcador tal como quedó registrado cuando está disponible (\`recordedScoreStatus\` = \`available\`). Si no está disponible (\`unavailable\`) o ya no corresponde al partido (\`not-current\`), los valores quedan vacíos y no se sustituyen por nada. Los puntos sumados de los eventos van en otras columnas; si difieren, \`findings\` lo avisa y **no se reconcilia**. Solo los partidos con estado \`final\` tienen resultado final.
`

export function armarPaqueteOrganizador(datos, avisosInternos, { generadoEn, datosAl }) {
  const avisos = avisosParaOrganizador(avisosInternos)
  const filas = filasDelOrganizador(datos, avisos)
  const archivos = new Map()
  for (const e of ORDEN) {
    const c = CONTRATO[e]
    archivos.set(`${c.archivo}.json`, aJson({ format: FORMATO_PAQUETE, formatVersion: VERSION_PAQUETE, entity: e, count: filas[e].length,
      fields: c.campos.map((x) => ({ name: x.nombre, type: x.tipo, nullable: x.nulable })), rows: filas[e] }))
    archivos.set(`${c.archivo}.csv`, csvDeCampos(c.campos, filas[e]))
  }
  archivos.set('DATA_DICTIONARY.md', diccionario())
  archivos.set('LEEME.md', LEEME)
  const lista = [...archivos].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, contenido]) => {
    const bytes = Buffer.from(contenido, 'utf8')
    const ent = ORDEN.find((n) => name === `${CONTRATO[n].archivo}.json` || name === `${CONTRATO[n].archivo}.csv`)
    return { name, bytes: bytes.length, sha256: sha256Hex(bytes), entity: ent ?? null, rows: ent ? filas[ent].length : null }
  })
  const sc = filas.game_scores
  const ev = filas.events.filter((e) => !e.annulled)
  const manifiesto = {
    format: FORMATO_PAQUETE, formatVersion: VERSION_PAQUETE, status: 'complete', generatedAt: generadoEn, dataAsOf: datosAl,
    counts: Object.fromEntries(ORDEN.map((n) => [n, filas[n].length])),
    derived: {
      finalGames: filas.games.filter((g) => g.state === 'final').length,
      retiredGames: filas.games.filter((g) => g.retired).length,
      unsupportedStateGames: filas.games.filter((g) => !g.stateRecognised).length,
      registeredScoresAvailable: sc.filter((s) => s.recordedScoreStatus === 'available').length,
      registeredScoresNotCurrent: sc.filter((s) => s.recordedScoreStatus === 'not-current').length,
      registeredScoresUnavailable: sc.filter((s) => s.recordedScoreStatus === 'unavailable').length,
      annulledEvents: filas.events.filter((e) => e.annulled).length,
      validPointEvents: ev.filter((e) => e.type === 'punto').length,
      validPoints: ev.filter((e) => e.type === 'punto').reduce((n, e) => n + e.points, 0),
      validFouls: ev.filter((e) => e.type === 'falta').length,
      playerGameTotalsPoints: filas.player_game_totals.reduce((n, t) => n + t.points, 0),
      playerGameTotalsFouls: filas.player_game_totals.reduce((n, t) => n + t.fouls, 0),
      scoreInconsistencies: filas.findings.filter((f) => f.code === 'registered-score-differs-from-events').length,
      findings: filas.findings.length,
    },
    coverage: COBERTURA,
    notIncluded: NO_DISPONIBLE,
    disclaimer: 'Results are exported as registered by the application. They are not official, were not verified and no disputed game was corrected. The package is complete only with respect to the data that was stored.',
    files: lista,
  }
  archivos.set('MANIFEST.json', aJson(manifiesto))
  return { manifiesto, archivos, filas }
}
