// REPORT_261 - convertidor OFFLINE de un respaldo `sebel-respaldo-sql` v1 de liga a un paquete portable (JSON + CSV).
// Solo datos SINTETICOS construidos aqui, en un directorio temporal. Sin red, sin produccion, sin abrir ningun respaldo real.
import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createHash } from 'node:crypto'
import { ENTIDADES, ErrorExportacion, ORDEN_ENTIDADES, aCsv, celdaCsv, convertir, escribirPaquete, sellar } from '../scripts/lib/exportar-portable.mjs'
import { ARCHIVOS_APROBADOS, CONTRATO, ORDEN } from '../scripts/lib/paquete-organizador.mjs'
import { ARCHIVOS_PERMITIDOS, TERMINOS_DE_INFRAESTRUCTURA, leerCsv, verificarPaquete } from '../scripts/lib/lector-portable.mjs'
import { ErrorEmpaquetado, empaquetar } from '../scripts/lib/empaquetar-portable.mjs'
import { crearZip, leerZip } from '../scripts/lib/zip-portable.mjs'

const CLI = new URL('../scripts/exportar-portable.mjs', import.meta.url).pathname
const RAIZ = mkdtempSync(join(tmpdir(), 'portable-export-'))
const AHORA = () => '2026-10-30T12:00:00.000Z'
let contador = 0
const nuevaRuta = (n = 'salida') => join(RAIZ, `${n}-${contador++}`)

// Centinelas que NUNCA deben aparecer en la salida.
const SECRETOS = ['SECRETO-HASH-0001', 'SECRETO-CODIGO-ORG', 'SECRETO-NACIMIENTO-1999-04-05', 'SECRETO-PERSONA-77', 'SECRETO-CAMISETA', 'SECRETO-DISPOSITIVO', 'SECRETO-RECIBO', 'SECRETO-CONTACTO', 'SECRETO-ACTOR']

// --------------------------- fabrica de respaldos sinteticos ---------------------------
const tabla = (nombre, columnas, filas) => ({ nombre, columnas: [...columnas], conRowid: true, filas: filas.length, datos: filas.map((f, i) => [i + 1, ...f]) })
const ev = (id, seq, o) => JSON.stringify({ id, partidoId: o.g, seq, tipo: o.tipo, equipoId: o.t ?? null, jugadorId: o.p ?? null, puntos: o.pts ?? null, periodo: o.per ?? 1, anulado: o.an ?? false, creadoEn: 1_790_000_000_000 + seq * 1000, anuladoEn: null, rehacerBloqueado: false, actorId: 'SECRETO-ACTOR', dispositivo: 'SECRETO-DISPOSITIVO', ...(o.extra ?? {}) })
const estado = (e, inicio = null) => JSON.stringify({ gameId: 'x', config: { deporte: 'baloncesto', minutosPorPeriodo: 10 }, partido: { estado: e, inicio, relojEstado: null, relojRestante: null, relojDesde: null } })

function base() {
  const T = {
    ligas: [['L1', 'Liga Ñandú', 'baloncesto', 10, 'infantil', '{"edad":"U10"}']],
    equipos: [['T1', 'L1', 'Águilas', 'masculino'], ['T2', 'L1', 'Café, "S.A."', null], ['T3', 'L1', "=HYPERLINK(\"http://x\")", 'mixta']],
    jugadores: [
      ['P1', 'T1', 'SECRETO-PERSONA-77', 'L1', 'Ana', 'Ana', 'Pérez', 'Núñez', 0, 1, 'SECRETO-CAMISETA', '2014-04-05', 'SECRETO-CODIGO-ORG'],
      ['P2', 'T1', null, null, null, 'Beto', 'Rojas', null, 7, 1, null, 'SECRETO-NACIMIENTO-1999-04-05', null],
      ['P3', 'T2', null, 'L1', 'Cleo', 'Cleo', 'Díaz', null, null, 1, null, null, null],
      ['P4', 'T2', null, 'L1', null, 'Dani', 'Ñ', null, 12, 0, null, null, null],
    ],
    partidos: [
      ['G1', 'L1', 'T1', 'T2', estado('final', '2026-10-30T15:00:00.000Z'), 9, 'bloqueo', '2026-10-30T14:00:00.000Z', 'Cancha Cañón', null],
      ['G2', 'L1', 'T1', 'T2', estado('final', '2026-10-31T15:00:00.000Z'), 5, null, '2026-10-31T14:00:00.000Z', '', null],
      ['G3', 'L1', 'T2', 'T1', estado('programado', '2026-11-01T14:00:00.000Z'), 0, null, null, null, null],
      ['G4', 'L1', 'T1', 'T3', estado('programado'), 0, null, '2026-11-02T14:00:00.000Z', 'Sede retirada', 1_790_100_000_000],
      ['G5', 'L1', 'T1', 'T2', estado('vivo', '2026-11-03T15:00:00.000Z'), 3, null, '2026-11-03T14:00:00.000Z', 'Cancha Cañón', null],
    ],
    eventos: [
      ['G1', 'e1', 1, ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2 })],
      ['G1', 'e2', 2, ev('e2', 2, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 3, an: true })],
      ['G1', 'e3', 3, ev('e3', 3, { g: 'G1', tipo: 'punto', t: 'T2', p: 'P3', pts: 3 })],
      ['G1', 'e4', 4, ev('e4', 4, { g: 'G1', tipo: 'falta', t: 'T2', p: 'P3', pts: 0 })],
      ['G1', 'e5', 5, ev('e5', 5, { g: 'G1', tipo: 'punto', t: 'T1', p: null, pts: 2 })],
      ['G1', 'e6', 6, ev('e6', 6, { g: 'G1', tipo: 'periodo', per: 1 })],
      ['G1', 'e7', 7, ev('e7', 7, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P2', pts: 1, per: 2 })],
      ['G2', 'f1', 1, ev('f1', 1, { g: 'G2', tipo: 'punto', t: 'T1', p: 'P1', pts: 3 })],
      ['G2', 'f2', 2, ev('f2', 2, { g: 'G2', tipo: 'punto', t: 'T1', p: 'P2', pts: 2 })],
      ['G2', 'f3', 3, ev('f3', 3, { g: 'G2', tipo: 'punto', t: 'T2', p: 'P3', pts: 3 })],
    ],
    resumen_partido: [
      ['G1', 'T1', 'T2', 5, 3, 0, 1, 2, 9, 2],
      ['G2', 'T1', 'T2', 6, 3, 0, 0, 1, 5, 2], // DISPUTADO: lo registrado dice 6, los eventos dicen 5
      ['G5', 'T1', 'T2', 0, 0, 0, 0, 1, 3, 2],
    ],
  }
  return T
}
const COLS = {
  ligas: ['id', 'nombre', 'deporte', 'minutos_por_periodo', 'categoria', 'subcategoria_json'],
  equipos: ['id', 'liga_id', 'nombre', 'rama'],
  jugadores: ['id', 'equipo_id', 'persona_id', 'liga_id', 'nombre', 'nombre_pila', 'apellido1', 'apellido2', 'dorsal', 'activo', 'nombre_camiseta', 'fecha_nacimiento', 'codigo'],
  partidos: ['id', 'liga_id', 'local_id', 'visita_id', 'estado_json', 'rev', 'bloqueo_json', 'programado_para', 'sede', 'retirado_en'],
  eventos: ['partido_id', 'id', 'seq', 'json'],
  resumen_partido: ['partido_id', 'local_id', 'visita_id', 'local_puntos', 'visita_puntos', 'local_faltas', 'visita_faltas', 'periodo', 'rev_fuente', 'version_proyeccion'],
}
// jugadores: nombre = P1 'Ana'; orden de columnas: id,equipo_id,persona_id,liga_id,nombre,nombre_pila,apellido1,apellido2,dorsal,activo,...
const PRIVADAS = {
  credenciales: [['SECRETO-HASH-0001', 'G1', 'SECRETO-DISPOSITIVO', 'SECRETO-ACTOR', 0]],
  codigos_partido: [['c1', 'G1', 'SECRETO-CODIGO-ORG']],
  recibos: [['G1', 'e1', 1, 'SECRETO-RECIBO']],
  auditoria_acceso: [[1, 1790000000000, 'x', 'G1', 'org', 'ses', 'SECRETO-CONTACTO']],
  meta: [['esquema', '9']],
}
const COLS_PRIV = {
  credenciales: ['token_hash', 'partido_id', 'device_id', 'actor_id', 'revocada'],
  codigos_partido: ['id', 'partido_id', 'secreto_hash'],
  recibos: ['partido_id', 'cmd_id', 'client_seq', 'json'],
  auditoria_acceso: ['id', 'ts', 'tipo', 'partido_id', 'organizador_id', 'sesion_id', 'detalle'],
  meta: ['clave', 'valor'],
}

function respaldo(mod = (t) => t, extra = {}) {
  const T = mod(base())
  const tablas = [
    ...Object.entries(COLS).map(([n, c]) => tabla(n, c, T[n])),
    ...Object.entries(PRIVADAS).map(([n, f]) => tabla(n, COLS_PRIV[n], f)),
  ]
  return sellar({ formato: 'sebel-respaldo-sql', version: 1, clase: 'LigaDO', objeto: 'L1', versionEsquema: 9, bytesBase: 4096, capturadoEnMs: 1_790_200_000_000,
    internasDeLaPlataforma: ['_cf_KV'], esquema: [{ tipo: 'table', nombre: 'ligas', tabla: 'ligas', sql: 'CREATE TABLE ligas (...)' }], tablas, ...extra })
}
const rechaza = (r, codigo) => assert.throws(() => convertir(r, { ahora: AHORA }), (e) => e instanceof ErrorExportacion && e.codigo === codigo, `se esperaba ${codigo}`)
const archivoEntrada = (obj, modo = 0o600) => { const r = nuevaRuta('entrada') + '.json'; writeFileSync(r, JSON.stringify(obj), { mode: modo }); chmodSync(r, modo); return r }
const exportar = (r = respaldo()) => { const p = convertir(r, { ahora: AHORA }); const dir = escribirPaquete(nuevaRuta(), p); return { p, dir } }
const filas = (p, e) => p.datos[e]
const sha = (b) => createHash('sha256').update(b).digest('hex')
const texto = (dir) => readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n')

describe('conversion valida y lector independiente', () => {
  it('produce los 8 conjuntos y un lector separado reproduce conteos y totales efectivos', () => {
    const { p, dir } = exportar()
    assert.deepEqual(p.manifiesto.counts, { leagues: 1, teams: 3, players: 4, games: 5, game_scores: 5, events: 10, player_game_totals: 7, findings: p.manifiesto.counts.findings })
    const v = verificarPaquete(dir)
    assert.deepEqual(v.problemas, [])
    assert.equal(v.ok, true)
    // Totales efectivos a mano: G1 = 2+3+2+1 = 8 ; G2 = 3+2+3 = 8
    assert.equal(v.derived.validPoints, 16)
    assert.equal(v.derived.annulledEvents, 1)
    assert.equal(v.derived.validFouls, 1)
    assert.equal(v.derived.retiredGames, 1)
    assert.equal(v.derived.finalGames, 2)
  })

  it('conserva los ids deportivos y las relaciones', () => {
    const { p } = exportar()
    assert.deepEqual(filas(p, 'teams').map((t) => [t.teamId, t.leagueId]), [['T1', 'L1'], ['T2', 'L1'], ['T3', 'L1']])
    assert.deepEqual(filas(p, 'players').map((x) => [x.playerId, x.teamId]), [['P1', 'T1'], ['P2', 'T1'], ['P3', 'T2'], ['P4', 'T2']])
    assert.equal(filas(p, 'players').find((x) => x.playerId === 'P2').leagueId, 'L1') // liga_id nulo en la ficha: sale del equipo
    assert.deepEqual(filas(p, 'events').filter((e) => e.gameId === 'G1').map((e) => e.eventId), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'])
  })

  it('es determinista: dos conversiones iguales dan los mismos bytes', () => {
    const a = convertir(respaldo(), { ahora: AHORA }); const b = convertir(respaldo(), { ahora: AHORA })
    for (const [n, c] of a.archivos) assert.equal(c, b.archivos.get(n), n)
  })
})

describe('nulo frente a cero y texto vacio', () => {
  it('JSON: desconocido = null; cero = 0; sin resumen = puntos registrados null (no 0)', () => {
    const { p } = exportar()
    assert.equal(filas(p, 'players').find((x) => x.playerId === 'P1').currentJersey, 0)
    assert.equal(filas(p, 'players').find((x) => x.playerId === 'P3').currentJersey, null)
    const g3 = filas(p, 'game_scores').find((s) => s.gameId === 'G3')
    assert.equal(g3.recordedHomePoints, null)
    assert.equal(g3.matchesEvents, null)
    assert.equal(g3.eventsHomePoints, 0) // derivado de eventos: aqui 0 es un cero real (no hay eventos)
    const g5 = filas(p, 'game_scores').find((s) => s.gameId === 'G5')
    assert.equal(g5.recordedHomePoints, 0) // registrado como 0
    assert.equal(filas(p, 'leagues')[0].minutesPerPeriod, 10)
    assert.equal(filas(p, 'games').find((g) => g.gameId === 'G3').scheduledFor, null)
    assert.equal(filas(p, 'games').find((g) => g.gameId === 'G2').venue, '') // texto vacio guardado: sigue siendo ''
    assert.equal(filas(p, 'games').find((g) => g.gameId === 'G3').venue, null)
  })

  it('CSV: null = campo vacio sin comillas; cadena vacia = ""; un lector atento a comillas los distingue', () => {
    const { dir } = exportar()
    const csv = leerCsv(readFileSync(join(dir, 'games.csv'), 'utf8'))
    const cab = csv[0].map((c) => c.v)
    const fila = (id) => csv.find((f) => f[0].v === id)
    const i = cab.indexOf('venue')
    assert.deepEqual(fila('G2')[i], { v: '', citada: true })
    assert.deepEqual(fila('G3')[i], { v: '', citada: false })
    assert.match(readFileSync(join(dir, 'games.csv'), 'utf8'), /G2,L1,T1,T2,final,true,false,2026-10-31T14:00:00\.000Z,2026-10-31T15:00:00\.000Z,"",baloncesto/)
    assert.match(readFileSync(join(dir, 'game_scores.csv'), 'utf8'), /^G3,programado,false,unavailable,{6}0,0,$/m)
    assert.match(readFileSync(join(dir, 'players.csv'), 'utf8'), /^P1,T1,L1,Ana,Pérez,Núñez,Ana,0,true$/m)
  })

  it('un instante invalido o con desplazamiento se avisa; no se inventa pais ni zona horaria', () => {
    const { p } = exportar(respaldo((t) => { t.partidos[0][7] = 'ayer por la tarde'; t.partidos[1][7] = '2026-10-31T09:00:00-05:00'; return t }))
    const g = (id) => filas(p, 'games').find((x) => x.gameId === id)
    assert.equal(g('G1').scheduledFor, null)
    assert.equal(g('G2').scheduledFor, '2026-10-31T14:00:00.000Z')
    const k = filas(p, 'discrepancies').map((d) => d.kind)
    assert.ok(k.includes('instant-not-interpretable') && k.includes('instant-converted-to-utc'))
    for (const e of ORDEN_ENTIDADES) for (const c of ENTIDADES[e].campos) assert.ok(!/country|timezone|tz/i.test(c.nombre), c.nombre)
  })
})

describe('acentos, CSV y formulas', () => {
  it('conserva acentos y ñ exactos en JSON (autoritativo) y CSV UTF-8 sin BOM', () => {
    const { dir } = exportar()
    const json = JSON.parse(readFileSync(join(dir, 'teams.json'), 'utf8'))
    assert.equal(json.rows[0].name, 'Águilas')
    assert.equal(JSON.parse(readFileSync(join(dir, 'leagues.json'), 'utf8')).rows[0].name, 'Liga Ñandú')
    const bytes = readFileSync(join(dir, 'teams.csv'))
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
    assert.ok(bytes.toString('utf8').includes('Águilas'))
    assert.ok(readFileSync(join(dir, 'games.csv'), 'utf8').includes('Cancha Cañón'))
  })

  it('escapa comas, comillas y saltos de linea, y las formulas de hoja de calculo', () => {
    assert.equal(celdaCsv('a,b'), '"a,b"')
    assert.equal(celdaCsv('di "hola"'), '"di ""hola"""')
    assert.equal(celdaCsv('l1\nl2'), '"l1\nl2"')
    assert.equal(celdaCsv('=1+1'), "'=1+1")
    assert.equal(celdaCsv('+SUM(A1)'), "'+SUM(A1)")
    assert.equal(celdaCsv('-cmd'), "'-cmd")
    assert.equal(celdaCsv('@x'), "'@x")
    assert.equal(celdaCsv('\tx'), "'\tx")
    assert.equal(celdaCsv(-5), '-5') // un numero nunca se protege
    assert.equal(celdaCsv(false), 'false')
    const { p, dir } = exportar()
    const eq = JSON.parse(readFileSync(join(dir, 'teams.json'), 'utf8')).rows
    assert.equal(eq[2].name, '=HYPERLINK("http://x")') // el JSON conserva el texto EXACTO
    const csv = readFileSync(join(dir, 'teams.csv'), 'utf8')
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`))
    assert.ok(csv.includes('"Café, ""S.A."""'))
    assert.ok(csv.endsWith('\r\n') && !/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')))
    assert.deepEqual(leerCsv(aCsv('teams', p.datos.teams)).length, 4)
  })
})

describe('eventos anulados, puntos sin jugador y partidos retirados', () => {
  it('conserva el evento anulado con su bandera y lo excluye de los totales efectivos', () => {
    const { p } = exportar()
    const e2 = filas(p, 'events').find((e) => e.eventId === 'e2')
    assert.equal(e2.annulled, true)
    assert.equal(e2.points, 3)
    const p1 = filas(p, 'player_game_totals').find((t) => t.gameId === 'G1' && t.playerId === 'P1')
    assert.equal(p1.points, 2)
    assert.equal(p1.annulledEventsExcluded, 1)
    assert.equal(p1.pointEvents, 1)
  })

  it('los puntos sin jugador van a un cubo del equipo (playerId null) y se avisan; no se asignan a nadie', () => {
    const { p } = exportar()
    const sin = filas(p, 'player_game_totals').find((t) => t.gameId === 'G1' && t.teamId === 'T1' && t.playerId === null)
    assert.equal(sin.points, 2)
    assert.ok(filas(p, 'discrepancies').some((d) => d.kind === 'unattributed-points' && d.gameId === 'G1'))
    // Los jugadores sin evento no tienen fila: su participacion es desconocida, no 0.
    assert.ok(!filas(p, 'player_game_totals').some((t) => t.playerId === 'P4'))
  })

  it('un jugador cuyo unico evento esta anulado tiene fila con 0 efectivo (cero real)', () => {
    const { p } = exportar(respaldo((t) => { t.eventos.push(['G5', 'h1', 1, ev('h1', 1, { g: 'G5', tipo: 'punto', t: 'T1', p: 'P2', pts: 2, an: true })]); return t }))
    const f = filas(p, 'player_game_totals').find((x) => x.gameId === 'G5' && x.playerId === 'P2')
    assert.equal(f.points, 0); assert.equal(f.annulledEventsExcluded, 1)
  })

  it('identifica claramente los partidos retirados y los exporta marcados', () => {
    const { p } = exportar()
    assert.equal(filas(p, 'games').find((g) => g.gameId === 'G4').retired, true)
    assert.equal(filas(p, 'games').find((g) => g.gameId === 'G1').retired, false)
    assert.equal(filas(p, 'game_scores').find((g) => g.gameId === 'G4').retired, true)
    assert.ok(!JSON.stringify(p.datos).includes('1790100000000')) // la hora de retiro (unidad no documentada) no se exporta
  })

  it('un evento de un equipo ajeno al partido se avisa y se excluye de los totales; la ficha de otro equipo se avisa', () => {
    const { p } = exportar(respaldo((t) => {
      t.eventos.push(['G5', 'z1', 1, ev('z1', 1, { g: 'G5', tipo: 'punto', t: 'T3', p: null, pts: 2 })])
      t.eventos.push(['G5', 'z2', 2, ev('z2', 2, { g: 'G5', tipo: 'punto', t: 'T1', p: 'P3', pts: 2 })])
      return t
    }))
    const k = filas(p, 'discrepancies').map((d) => d.kind)
    assert.ok(k.includes('event-team-not-in-game') && k.includes('event-player-team-mismatch'))
    assert.ok(!filas(p, 'player_game_totals').some((t) => t.gameId === 'G5' && t.teamId === 'T3'))
  })
})

describe('marcador registrado y discrepancias', () => {
  it('exporta el marcador TAL COMO ESTA REGISTRADO y reporta la diferencia sin corregirla', () => {
    const { p } = exportar()
    const g2 = filas(p, 'game_scores').find((s) => s.gameId === 'G2')
    assert.equal(g2.recordedHomePoints, 6)
    assert.equal(g2.eventsHomePoints, 5)
    assert.equal(g2.matchesEvents, false)
    const d = filas(p, 'discrepancies').filter((x) => x.kind === 'score-differs-from-events')
    assert.deepEqual(d.map((x) => [x.gameId, x.field, x.recorded, x.derived]), [['G2', 'home', '6', '5']])
    assert.equal(filas(p, 'game_scores').find((s) => s.gameId === 'G1').matchesEvents, true)
    assert.equal(p.manifiesto.derived.scoreInconsistencies, 1)
    assert.match(p.manifiesto.disclaimer, /not official/)
  })

  it('avisa si el resumen es de otra revision o de otros equipos', () => {
    const { p } = exportar(respaldo((t) => { t.resumen_partido[0][8] = 4; t.resumen_partido[0][1] = 'T2'; return t }))
    const razones = filas(p, 'discrepancies').filter((d) => d.kind === 'summary-stale' && d.gameId === 'G1').map((d) => d.field).sort()
    assert.deepEqual(razones, ['revision', 'teams'])
  })

  const resumenDe = (p, id) => filas(p, 'game_scores').find((s) => s.gameId === id)
  const sinRegistrado = (s) => ['recordedHomePoints', 'recordedAwayPoints', 'recordedHomeFouls', 'recordedAwayFouls', 'recordedPeriod', 'matchesEvents'].every((c) => s[c] === null)

  it('distingue resumen vigente, desactualizado y ausente', () => {
    const { p } = exportar()
    assert.equal(resumenDe(p, 'G1').summaryStatus, 'coherent')
    assert.equal(resumenDe(p, 'G1').summaryStaleReasons, null)
    assert.equal(resumenDe(p, 'G3').summaryStatus, 'missing')
    assert.ok(sinRegistrado(resumenDe(p, 'G3')))
    assert.equal(p.manifiesto.derived.registeredScoresAvailable, 3)
    assert.equal(p.manifiesto.derived.registeredScoresUnavailable, 2)
    assert.equal(p.manifiesto.derived.registeredScoresNotCurrent, 0)
  })

  for (const [nombre, mod, razon, campo] of [
    ['otra revision', (t) => { t.resumen_partido[0][8] = 8 }, 'revision', ['8', '9']],
    ['otra version de proyeccion', (t) => { t.resumen_partido[0][9] = 1 }, 'projection-version', ['1', '2']],
    ['otros equipos', (t) => { t.resumen_partido[0][1] = 'T3' }, 'teams', ['T3/T2', 'T1/T2']],
  ]) {
    it(`un resumen con ${nombre} NO se presenta como marcador registrado vigente`, () => {
      const { p, dir } = exportar(respaldo((t) => { mod(t); return t }))
      const s = resumenDe(p, 'G1')
      assert.equal(s.summaryStatus, 'stale')
      assert.equal(s.summaryStaleReasons, razon)
      assert.ok(sinRegistrado(s), 'los valores registrados deben ser null')
      assert.equal(s.eventsHomePoints, 5) // lo derivado de los eventos sigue aparte
      assert.equal(s.eventsAwayPoints, 3)
      const h = filas(p, 'discrepancies')
      assert.deepEqual(h.filter((d) => d.kind === 'summary-stale' && d.gameId === 'G1').map((d) => [d.field, d.recorded, d.derived]), [[razon, ...campo]])
      assert.deepEqual(h.filter((d) => d.kind === 'summary-stale-values' && d.gameId === 'G1').map((d) => d.recorded), ['5-3']) // evidencia, no marcador
      assert.ok(!h.some((d) => d.kind === 'score-differs-from-events' && d.gameId === 'G1'))
      assert.equal(p.manifiesto.derived.registeredScoresNotCurrent, 1)
      assert.equal(verificarPaquete(dir).ok, true)
    })
  }

  it('un resumen desactualizado con valores distintos a los eventos no genera una falsa discrepancia ni un marcador registrado', () => {
    const { p } = exportar(respaldo((t) => { t.resumen_partido[0][8] = 3; t.resumen_partido[0][3] = 99; return t }))
    const s = resumenDe(p, 'G1')
    assert.equal(s.recordedHomePoints, null)
    assert.ok(!JSON.stringify(s).includes('99'))
    assert.ok(filas(p, 'discrepancies').some((d) => d.kind === 'summary-stale-values' && d.recorded === '99-3'))
  })

  it('el lector rechaza un paquete que presente un resumen no vigente como marcador registrado', () => {
    const { dir } = exportar(respaldo((t) => { t.resumen_partido[0][8] = 8; return t }))
    const f = JSON.parse(readFileSync(join(dir, 'game_scores.json'), 'utf8'))
    f.rows.find((x) => x.gameId === 'G1').recordedHomePoints = 5
    chmodSync(join(dir, 'game_scores.json'), 0o600); writeFileSync(join(dir, 'game_scores.json'), `${JSON.stringify(f, null, 2)}\n`)
    const m = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8')); const e = m.files.find((x) => x.name === 'game_scores.json')
    const b = readFileSync(join(dir, 'game_scores.json')); e.bytes = b.length; e.sha256 = sha(b)
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(m))
    assert.ok(verificarPaquete(dir).problemas.some((x) => x === 'resumen-no-vigente-presentado-como-registrado' || x.startsWith('csv-distinto-del-json:game_scores')))
  })
})

describe('privacidad: lista blanca de campos', () => {
  it('ningun dato privado aparece en ningun archivo y las tablas privadas solo se nombran', () => {
    const { p, dir } = exportar()
    const todo = texto(dir)
    for (const s of SECRETOS) assert.ok(!todo.includes(s), `se filtro ${s}`)
    assert.deepEqual(p.informeTecnico.source.privateTablesRecognisedAndExcluded, ['auditoria_acceso', 'codigos_partido', 'credenciales', 'meta', 'recibos'])
    assert.ok(!JSON.stringify(p.manifiesto).includes('auditoria_acceso'))
    for (const e of ORDEN_ENTIDADES) {
      const permitidos = new Set(ENTIDADES[e].campos.map((c) => c.nombre))
      for (const f of p.datos[e]) assert.deepEqual(Object.keys(f).filter((k) => !permitidos.has(k)), [], e)
    }
    for (const prohibido of ['persona', 'birth', 'nacimiento', 'codigo', 'token', 'device', 'actor', 'jersey_name', 'camiseta']) {
      for (const e of ORDEN_ENTIDADES) for (const c of ENTIDADES[e].campos) assert.ok(!c.nombre.toLowerCase().includes(prohibido), `${e}.${c.nombre}`)
    }
  })

  it('campos extra dentro del JSON de un evento no se copian', () => {
    const { dir } = exportar(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2, extra: { telefono: 'SECRETO-CONTACTO', recibo: 'SECRETO-RECIBO' } }); return t }))
    const todo = texto(dir)
    assert.ok(!todo.includes('SECRETO-CONTACTO') && !todo.includes('SECRETO-RECIBO'))
  })

  it('un respaldo del objeto de acceso (organizadores, sesiones) nunca se convierte', () => {
    rechaza(respaldo((t) => t, { clase: 'AccesoDO' }), 'clase-no-soportada')
  })
})

describe('rechazo de entradas no soportadas o inconsistentes (antes de publicar nada)', () => {
  const resellada = (mod) => { const r = respaldo(); mod(r); return r }
  it('formato, version, esquema y estructura', () => {
    rechaza(respaldo((t) => t, { formato: 'otro' }), 'formato-no-soportado')
    rechaza(respaldo((t) => t, { version: 2 }), 'version-de-formato-no-soportada')
    rechaza(respaldo((t) => t, { versionEsquema: 8 }), 'esquema-no-soportado')
    rechaza(respaldo((t) => t, { versionEsquema: 10 }), 'esquema-no-soportado')
    rechaza(null, 'respaldo-no-es-objeto')
    rechaza({ ...respaldo(), tablas: 'no' }, 'estructura-invalida')
    rechaza(respaldo((t) => t, { objeto: '' }), 'objeto-ilegible')
  })
  it('sellos: una fila alterada, un conteo alterado o un sello del conjunto alterado', () => {
    rechaza(resellada((r) => { r.tablas[0].datos[0][1] = 'Otra liga' }), 'sello-de-tabla-invalido')
    rechaza(resellada((r) => { r.tablas[1].filas = 99 }), 'filas-no-coinciden')
    rechaza(resellada((r) => { r.sha256 = '0'.repeat(64) }), 'sello-del-conjunto-invalido')
    rechaza(resellada((r) => { r.tablas[0].datos[0].push('x') }), 'fila-malformada')
    rechaza(resellada((r) => { r.tablas.push({ ...r.tablas[0] }) }), 'tabla-duplicada')
  })
  it('tablas: desconocida, requerida ausente, columna ausente, blob', () => {
    const ext = respaldo(); rechaza(sellar({ ...ext, tablas: [...ext.tablas, tabla('tabla_nueva', ['a'], [[1]])] }), 'tabla-no-reconocida')
    const sin = respaldo(); rechaza(sellar({ ...sin, tablas: sin.tablas.filter((t) => t.nombre !== 'eventos') }), 'tabla-requerida-ausente')
    const sc = respaldo(); sc.tablas.find((t) => t.nombre === 'equipos').columnas[3] = 'rama_x'
    rechaza(sellar(sc), 'columna-requerida-ausente')
    const bl = respaldo(); bl.tablas.find((t) => t.nombre === 'equipos').datos[0][3] = { b: 'AAEC' }
    rechaza(sellar(bl), 'blob-en-columna-exportada')
  })
  it('relaciones rotas e inconsistentes', () => {
    rechaza(respaldo((t) => { t.equipos[0][1] = 'L9'; return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.jugadores[0][1] = 'T9'; return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.partidos[0][2] = 'T9'; return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.eventos[0][0] = 'G9'; return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P9', pts: 2 }); return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T9', p: 'P1', pts: 2 }); return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.resumen_partido[0][0] = 'G9'; return t }), 'relacion-rota')
    rechaza(respaldo((t) => { t.jugadores[0][3] = 'L2'; return t }), 'relacion-inconsistente')
    rechaza(respaldo((t) => { t.ligas[0][0] = 'L2'; t.equipos.forEach((e) => { e[1] = 'L2' }); t.partidos.forEach((e) => { e[1] = 'L2' }); return t }), 'liga-no-corresponde-al-objeto')
    rechaza(respaldo((t) => { t.ligas = []; return t }), 'sin-liga')
  })
  it('identificadores duplicados, eventos mal formados y valores invalidos', () => {
    rechaza(respaldo((t) => { t.equipos.push([...t.equipos[0]]); return t }), 'identificador-duplicado')
    rechaza(respaldo((t) => { t.eventos.push(['G1', 'ex', 1, ev('ex', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2 })]); return t }), 'identificador-duplicado')
    rechaza(respaldo((t) => { t.eventos[0][3] = '{no es json'; return t }), 'evento-ilegible')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'canasta', t: 'T1', p: 'P1', pts: 2 }); return t }), 'tipo-de-evento-no-soportado')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: -2 }); return t }), 'puntos-invalidos')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2.5 }); return t }), 'puntos-invalidos')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2, extra: { id: 'otro' } }); return t }), 'evento-inconsistente')
    rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2, an: 'si' }); return t }), 'tipo-inesperado')
    rechaza(respaldo((t) => { t.partidos[0][4] = 'no json'; return t }), 'estado-json-ilegible')
    rechaza(respaldo((t) => { t.resumen_partido[0][3] = null; return t }), 'nulo-inesperado')
    rechaza(respaldo((t) => { t.equipos[0][2] = null; return t }), 'nulo-inesperado')
    rechaza(respaldo((t) => { t.jugadores[0][9] = 2; return t }), 'tipo-inesperado')
  })
  it('un REAL entero o un entero enorme no se interpreta a ciegas', () => {
    const r = respaldo(); r.tablas.find((t) => t.nombre === 'equipos').datos[0][3] = 9_007_199_254_740_993
    rechaza(sellar(r), 'entero-fuera-de-rango')
  })
  it('valores interpretables solo con aviso: dorsal no entero, estado desconocido, bandera de anulacion ausente', () => {
    const { p } = exportar(respaldo((t) => {
      t.jugadores[1][8] = -3
      t.partidos[4][4] = estado('suspendido')
      t.eventos[0][3] = JSON.stringify({ id: 'e1', seq: 1, tipo: 'punto', equipoId: 'T1', jugadorId: 'P1', puntos: 2 })
      return t
    }))
    const k = filas(p, 'discrepancies').map((d) => d.kind)
    assert.ok(k.includes('jersey-not-interpretable') && k.includes('game-state-unsupported') && k.includes('event-annulment-flag-missing'))
    assert.equal(filas(p, 'players').find((x) => x.playerId === 'P2').currentJersey, null)
    assert.equal(filas(p, 'games').find((x) => x.gameId === 'G5').state, null)
    assert.equal(filas(p, 'games').find((x) => x.gameId === 'G5').stateRecognised, false)
    assert.equal(filas(p, 'events').find((x) => x.eventId === 'e1').annulled, false)
  })
})

describe('permisos, no sobrescritura y salida incompleta', () => {
  it('carpeta 0700 y archivos 0600; el manifiesto declara todos los archivos con checksum', () => {
    const { p, dir } = exportar()
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    for (const n of readdirSync(dir)) assert.equal(statSync(join(dir, n)).mode & 0o777, 0o600, n)
    assert.deepEqual(readdirSync(dir).sort(), [...p.archivos.keys()].sort())
    for (const f of p.manifiesto.files) assert.equal(sha(readFileSync(join(dir, f.name))), f.sha256)
    assert.ok(p.manifiesto.files.some((f) => f.name === 'DATA_DICTIONARY.md'))
    assert.equal(p.manifiesto.formatVersion, 2)
    assert.equal(p.informeTecnico.source.sealSha256, respaldo().sha256)
    assert.ok(p.manifiesto.coverage.validEvents && p.manifiesto.notIncluded.length > 0)
  })

  it('no sobrescribe: una carpeta existente se rechaza y su contenido no cambia', () => {
    const dir = nuevaRuta(); mkdirSync(dir, { mode: 0o700 }); writeFileSync(join(dir, 'leagues.json'), 'previo', { mode: 0o600 })
    assert.throws(() => escribirPaquete(dir, convertir(respaldo(), { ahora: AHORA })), (e) => e.codigo === 'salida-ya-existe')
    assert.equal(readFileSync(join(dir, 'leagues.json'), 'utf8'), 'previo')
    assert.deepEqual(readdirSync(dir), ['leagues.json'])
  })

  it('rechaza una salida dentro de un repositorio Git y un padre inexistente', () => {
    const repo = nuevaRuta('repo'); mkdirSync(join(repo, '.git'), { recursive: true })
    assert.throws(() => escribirPaquete(join(repo, 'salida'), convertir(respaldo(), { ahora: AHORA })), (e) => e.codigo === 'salida-dentro-de-un-repositorio')
    assert.ok(!existsSync(join(repo, 'salida')))
    assert.throws(() => escribirPaquete(join(RAIZ, 'no-existe', 'x'), convertir(respaldo(), { ahora: AHORA })), (e) => e.codigo === 'salida-sin-carpeta-padre')
  })

  it('una escritura interrumpida no parece completa: sin MANIFEST.json, carpeta renombrada INCOMPLETO y el verificador la rechaza', () => {
    const dir = nuevaRuta(); let n = 0
    assert.throws(() => escribirPaquete(dir, convertir(respaldo(), { ahora: AHORA }), { alEscribir: () => { n += 1; if (n === 3) throw new Error('disco lleno') } }), /disco lleno/)
    assert.ok(!existsSync(dir))
    assert.ok(existsSync(`${dir}.INCOMPLETO`))
    assert.ok(!existsSync(join(`${dir}.INCOMPLETO`, 'MANIFEST.json')))
    assert.deepEqual(verificarPaquete(`${dir}.INCOMPLETO`).problemas, ['sin-manifiesto-paquete-incompleto'])
    assert.throws(() => escribirPaquete(dir, convertir(respaldo(), { ahora: AHORA })), (e) => e.codigo === 'salida-ya-existe')
  })

  it('el lector detecta manipulacion: checksum, archivo ajeno, permisos, CSV distinto del JSON y totales no reproducibles', () => {
    const rehacer = (dir, nombre, nuevo) => {
      writeFileSync(join(dir, nombre), nuevo, { mode: 0o600 })
      const m = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'))
      const f = m.files.find((x) => x.name === nombre); f.bytes = Buffer.byteLength(nuevo); f.sha256 = sha(Buffer.from(nuevo))
      writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(m), { mode: 0o600 })
    }
    let { dir } = exportar()
    writeFileSync(join(dir, 'teams.csv'), 'x', { mode: 0o600 })
    assert.ok(verificarPaquete(dir).problemas.includes('checksum:teams.csv'))
    ;({ dir } = exportar()); writeFileSync(join(dir, 'extra.txt'), 'x', { mode: 0o600 })
    assert.ok(verificarPaquete(dir).problemas.includes('archivo-ajeno:extra.txt'))
    ;({ dir } = exportar()); chmodSync(join(dir, 'events.csv'), 0o644)
    assert.ok(verificarPaquete(dir).problemas.includes('permisos:events.csv'))
    ;({ dir } = exportar()); rehacer(dir, 'teams.csv', readFileSync(join(dir, 'teams.csv'), 'utf8').replace('Águilas', 'Aguilas'))
    assert.ok(verificarPaquete(dir).problemas.some((x) => x.startsWith('csv-distinto-del-json:teams')))
    ;({ dir } = exportar())
    const ej = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8')); ej.rows.find((e) => e.eventId === 'e1').points = 9
    rehacer(dir, 'events.json', `${JSON.stringify(ej, null, 2)}\n`)
    assert.ok(verificarPaquete(dir).problemas.some((x) => x.startsWith('csv-distinto-del-json:events') || x === 'total-efectivo-puntos'))
  })
})

describe('compatibilidad con las reglas de produccion (ca7a2eb)', () => {
  const leer = (r) => readFileSync(new URL(`../../${r}`, import.meta.url), 'utf8')

  it('una bandera de anulacion ausente o nula cuenta como evento ACTIVO, igual que en produccion (regla fijada contra el codigo fuente)', () => {
    assert.match(leer('src/lib/marcador-calculo.js'), /const vivos = \(eventos, tipo\) => eventos\.filter\(\(e\) => !e\.anulado && e\.tipo === tipo\)/)
    assert.match(leer('backend/src/proyeccion-jugadores.js'), /COALESCE\(json_extract\(e\.json, '\$\.anulado'\), 0\) = 0/)
    for (const flag of [undefined, null]) {
      const { p } = exportar(respaldo((t) => {
        const o = JSON.parse(t.eventos[1][3]) // e2: 3 puntos de P1, normalmente anulado
        if (flag === undefined) delete o.anulado; else o.anulado = flag
        t.eventos[1][3] = JSON.stringify(o)
        t.resumen_partido[0][3] = 8 // lo que produccion registraria: 2 + 3 + 2 + 1 = 8 para T1
        return t
      }))
      const e2 = filas(p, 'events').find((e) => e.eventId === 'e2')
      assert.equal(e2.annulled, false)
      assert.equal(filas(p, 'player_game_totals').find((x) => x.gameId === 'G1' && x.playerId === 'P1').points, 5)
      assert.equal(filas(p, 'game_scores').find((x) => x.gameId === 'G1').eventsHomePoints, 8)
      assert.equal(filas(p, 'game_scores').find((x) => x.gameId === 'G1').matchesEvents, true)
      assert.ok(filas(p, 'discrepancies').some((d) => d.kind === 'event-annulment-flag-missing' && d.entityId === 'e2' && d.severity === 'warning'))
    }
  })

  it('una bandera ambigua (texto, numero distinto de 0/1) se rechaza y no se escribe nada', () => {
    for (const v of ['no', 'false', 2, -1, {}, []]) rechaza(respaldo((t) => { t.eventos[0][3] = ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2, an: v }); return t }), 'tipo-inesperado')
  })

  it('la prueba de resumen vigente es la de produccion: version, revision y equipos (regla fijada contra el codigo fuente)', () => {
    const f = leer('backend/src/resumen-publico.js')
    assert.match(f, /export const VERSION_PROYECCION = 2/)
    assert.match(f, /r\.version_proyeccion === VERSION_PROYECCION\s*&& r\.rev_fuente === p\.rev\s*&& r\.local_id === p\.local_id\s*&& r\.visita_id === p\.visita_id/)
  })

  it('un estado de partido no reconocido (o ausente) se marca no soportado y no entra en los agregados de partidos finales', () => {
    for (const mal of [estado('suspendido'), estado('FINAL'), estado(null), JSON.stringify({ partido: {} })]) {
      const { p, dir } = exportar(respaldo((t) => { t.partidos[0][4] = mal; return t }))
      const g = filas(p, 'games').find((x) => x.gameId === 'G1')
      assert.equal(g.state, null); assert.equal(g.stateRecognised, false); assert.equal(g.startedAt, null)
      assert.ok(filas(p, 'discrepancies').some((d) => d.kind === 'game-state-unsupported' && d.gameId === 'G1' && d.severity === 'discrepancy'))
      assert.equal(p.manifiesto.derived.unsupportedStateGames, 1)
      assert.equal(p.manifiesto.derived.finalGames, 1) // solo G2
      assert.equal(filas(p, 'game_scores').find((x) => x.gameId === 'G1').state, null)
      assert.equal(filas(p, 'player_game_totals').filter((x) => x.gameId === 'G1').every((x) => x.gameState === null), true)
      assert.equal(verificarPaquete(dir).ok, true)
    }
  })

  it('el lector rechaza un paquete que declare un estado no reconocido como si lo fuera', () => {
    const { dir } = exportar(respaldo((t) => { t.partidos[0][4] = estado('suspendido'); return t }))
    const g = JSON.parse(readFileSync(join(dir, 'games.json'), 'utf8')); g.rows.find((x) => x.gameId === 'G1').state = 'final'
    writeFileSync(join(dir, 'games.json'), `${JSON.stringify(g, null, 2)}\n`)
    assert.equal(verificarPaquete(dir).ok, false) // el checksum ya no coincide
  })
})

describe('linea de comandos', () => {
  const correr = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } })

  it('exporta, imprime solo conteos, nombres y prefijos de checksum, y verifica; no modifica la entrada', () => {
    const entrada = archivoEntrada(respaldo()); const antes = sha(readFileSync(entrada)); const salida = nuevaRuta(); const informe = nuevaRuta('informe') + '.json'
    const r = correr('--entrada', entrada, '--salida', salida, '--informe-tecnico', informe)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /exportacion: completa/)
    for (const prohibido of [...SECRETOS, 'Águilas', 'Ñandú', 'Cañón', 'Pérez', 'G1', 'e1']) assert.ok(!r.stdout.includes(prohibido) && !r.stderr.includes(prohibido), prohibido)
    assert.match(r.stdout, /leagues\.json \d+ [0-9a-f]{12}\n/)
    assert.equal(sha(readFileSync(entrada)), antes)
    const v = correr('--verificar', salida)
    assert.equal(v.status, 0, v.stdout)
    assert.match(v.stdout, /verificacion: OK/)
  })

  it('rechaza una entrada inconsistente sin crear la carpeta de salida y sin imprimir datos', () => {
    const malo = respaldo(); malo.tablas[0].datos[0][1] = 'Alterada'
    const salida = nuevaRuta()
    const r = correr('--entrada', archivoEntrada(malo), '--salida', salida, '--informe-tecnico', nuevaRuta('informe') + '.json')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /RECHAZADA sello-de-tabla-invalido \(ligas\)/)
    assert.ok(!existsSync(salida) && !existsSync(`${salida}.INCOMPLETO`))
    assert.ok(!r.stderr.includes('Alterada'))
  })

  it('rechaza entradas con permisos abiertos, inexistentes, no JSON, salidas existentes y argumentos mal formados', () => {
    const inf = () => ['--informe-tecnico', nuevaRuta('informe') + '.json']
    assert.match(correr('--entrada', archivoEntrada(respaldo(), 0o644), '--salida', nuevaRuta(), ...inf()).stderr, /entrada-con-permisos-abiertos/)
    assert.match(correr('--entrada', join(RAIZ, 'nada.json'), '--salida', nuevaRuta(), ...inf()).stderr, /entrada-inexistente/)
    const noJson = nuevaRuta('nojson'); writeFileSync(noJson, 'hola', { mode: 0o600 })
    assert.match(correr('--entrada', noJson, '--salida', nuevaRuta(), ...inf()).stderr, /entrada-no-es-json/)
    const existente = nuevaRuta(); mkdirSync(existente, { mode: 0o700 })
    assert.match(correr('--entrada', archivoEntrada(respaldo()), '--salida', existente, ...inf()).stderr, /salida-ya-existe/)
    assert.equal(correr('--entrada', 'a').status, 2)
    assert.equal(correr('--entrada', archivoEntrada(respaldo()), '--salida', nuevaRuta()).status, 2) // el informe tecnico es obligatorio
    assert.equal(correr('--salida', 'a', '--entrada', 'b', '--extra', 'c').status, 2)
  })
})

describe('contrato documentado', () => {
  it('el diccionario de datos lista cada campo del paquete, la codificacion CSV y la cobertura', () => {
    const { p } = exportar()
    const d = p.archivos.get('DATA_DICTIONARY.md')
    for (const e of ORDEN) for (const c of CONTRATO[e].campos) assert.ok(d.includes(`\`${c.nombre}\``), `${e}.${c.nombre}`)
    for (const frase of ['CSV null encoding', 'Formula guard', 'Finding codes', 'Statistical coverage', 'Not included', 'Team membership history', 'Minutes played']) assert.ok(d.includes(frase), frase)
    for (const e of ORDEN) {
      const j = JSON.parse(p.archivos.get(`${CONTRATO[e].archivo}.json`))
      assert.equal(j.formatVersion, 2); assert.equal(j.count, j.rows.length)
      assert.deepEqual(j.fields.map((c) => c.name), CONTRATO[e].campos.map((c) => c.nombre))
      for (const f of j.rows) assert.deepEqual(Object.keys(f), CONTRATO[e].campos.map((c) => c.nombre), e)
    }
  })

  it('los sellos reproducen un resultado conocido calculado por el precursor a5a823f (sin depender de ningun otro checkout)', () => {
    const r = sellar({ formato: 'sebel-respaldo-sql', version: 1, clase: 'LigaDO', objeto: 'KA', versionEsquema: 9, bytesBase: 1, capturadoEnMs: 1, internasDeLaPlataforma: [],
      esquema: [{ tipo: 'table', nombre: 'ligas', tabla: 'ligas', sql: 'CREATE TABLE ligas (id TEXT)' }],
      tablas: [{ nombre: 'ligas', columnas: ['id', 'nombre'], conRowid: true, filas: 2, datos: [[1, 'KA', 'Ñandú'], [2, null, { r: '1.5' }]] }] })
    assert.equal(r.tablas[0].sha256, '887a69e3b9c91e2c378b8547b33040d46c6f909f1944c56e4d7ff962bd1dea81')
    assert.equal(r.sha256, 'ee6db15f21e808ae077fffa24de6080d7b5bf78c7ba5d8c88808b0b809e9d442')
  })

  const RUTA_PRECURSOR = new URL('../../../sebel.com-backup-precursor/backend/src/respaldo.js', import.meta.url)
  it('OPCIONAL: coincide con el verificador del precursor si ese checkout hermano esta presente (solo lectura; se omite si no)', { skip: !existsSync(RUTA_PRECURSOR.pathname) && 'checkout hermano ausente' }, async () => {
    const ruta = RUTA_PRECURSOR
    const { verificarSellos } = await import(ruta.href)
    const v = await verificarSellos(respaldo())
    assert.deepEqual(v, { ok: true, errores: [] })
    const r = respaldo(); r.tablas[0].datos[0][1] = 'x'
    assert.equal((await verificarSellos(r)).ok, false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// REPORT_263 - paquete para el organizador: sin infraestructura, avisos en lenguaje llano, informe tecnico aparte, ZIP verificado
// ---------------------------------------------------------------------------------------------------------------------------------------------
const INFRA_DEL_FIXTURE = ['LigaDO', 'sebel-respaldo-sql', '_cf_KV', 'credenciales', 'codigos_partido', 'recibos', 'auditoria', 'resumen_partido', 'sqlite', 'cloudflare', 'worker', 'durable', 'projection',
  'proyeccion', 'schema', 'esquema', 'versionEsquema', 'estado_json', 'retirado_en', 'sealSha256', 'wrangler', 'deploy', 'production', 'produccion', 'revision', 'summary']
const todoElTexto = (dir) => readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n')

describe('el paquete del organizador no contiene infraestructura', () => {
  it('ningun archivo (manifiesto, diccionario, LEEME, avisos, datos) nombra proveedor, objetos, tablas, versiones internas ni despliegue', () => {
    // fixture con TODAS las situaciones: marcador no vigente, ausente, discrepante, estado no soportado, evento ajeno...
    const { dir } = exportar(respaldo((t) => {
      t.resumen_partido[0][8] = 4; t.resumen_partido[0][9] = 1; t.resumen_partido[0][1] = 'T3'
      t.partidos[4][4] = estado('suspendido')
      t.eventos.push(['G2', 'z1', 9, ev('z1', 9, { g: 'G2', tipo: 'punto', t: 'T3', p: null, pts: 2 })])
      return t
    }))
    const todo = todoElTexto(dir).toLowerCase()
    for (const t of INFRA_DEL_FIXTURE) assert.ok(!todo.includes(t.toLowerCase()), `se filtro "${t}"`)
    assert.ok(!/\b(ligas|partidos|eventos|jugadores|equipos)\.[a-z_]+/.test(todo), 'referencia a columna interna')
    for (const n of ['LEEME.md', 'DATA_DICTIONARY.md', 'MANIFEST.json', 'findings.json', 'findings.csv']) assert.ok(!TERMINOS_DE_INFRAESTRUCTURA.test(readFileSync(join(dir, n), 'utf8')), n)
    assert.ok(!todo.includes(respaldo().sha256))
    assert.equal(verificarPaquete(dir).ok, true)
  })

  it('el manifiesto solo trae formato, fecha de los datos, conteos, totales, cobertura y archivos', () => {
    const { p } = exportar()
    assert.deepEqual(Object.keys(p.manifiesto), ['format', 'formatVersion', 'status', 'generatedAt', 'dataAsOf', 'counts', 'derived', 'coverage', 'notIncluded', 'disclaimer', 'files'])
    assert.equal(p.manifiesto.dataAsOf, '2026-09-23T21:46:40.000Z')
  })

  it('contenido exacto: los 19 archivos aprobados y ninguno mas', () => {
    const { dir } = exportar()
    assert.deepEqual(readdirSync(dir).sort(), [...ARCHIVOS_APROBADOS])
    assert.deepEqual([...ARCHIVOS_APROBADOS], [...ARCHIVOS_PERMITIDOS]) // el lector independiente tiene la misma lista cerrada
    assert.equal(ARCHIVOS_APROBADOS.length, 19)
  })

  it('los avisos son claros, en espanol, sin motivos tecnicos y sin duplicar un marcador no vigente', () => {
    const { p } = exportar(respaldo((t) => {
      t.resumen_partido[0][8] = 4; t.resumen_partido[0][9] = 1; t.resumen_partido[0][1] = 'T3' // tres motivos internos
      t.partidos[4][4] = estado('suspendido')
      return t
    }))
    const f = JSON.parse(p.archivos.get('findings.json')).rows
    const cod = (c) => f.filter((x) => x.code === c)
    assert.equal(cod('registered-score-not-current').filter((x) => x.gameId === 'G1').length, 1)
    assert.equal(cod('registered-score-not-current')[0].field, null)
    assert.equal(cod('registered-score-differs-from-events').length, 1) // G2: registrado 6, eventos 5
    assert.deepEqual([cod('registered-score-differs-from-events')[0].recorded, cod('registered-score-differs-from-events')[0].derived], ['6', '5'])
    assert.ok(cod('registered-score-unavailable').some((x) => x.gameId === 'G3'))
    assert.ok(cod('game-state-not-recognised').some((x) => x.gameId === 'G5'))
    assert.ok(cod('points-without-player').length >= 1)
    for (const x of f) assert.match(x.message, /[A-Za-zÁÉÍÓÚáéíóúñ]{4,}.*\.$/)
    assert.ok(!f.some((x) => /summary-stale-values|stale/.test(x.code)))
    assert.match(cod('registered-score-unavailable')[0].message, /esto no significa 0/)
    assert.match(cod('registered-score-differs-from-events')[0].message, /no se corrigió/)
  })

  it('LEEME.md explica en espanol relaciones, IDs, nulo/cero, CSV, anulados, cobertura y resultados "tal como registrados"', () => {
    const { p } = exportar()
    const l = p.archivos.get('LEEME.md')
    for (const frase of ['Archivos y cómo se relacionan', 'Identificadores (IDs)', 'Nulo frente a cero', 'Limitaciones del CSV', 'Eventos anulados', 'Cobertura estadística', 'tal como registrados', 'no se corrigió nada', 'UTF-8', 'apóstrofo', 'sin comillas', 'recordedScoreStatus']) assert.ok(l.includes(frase), frase)
    assert.ok(l.length < 7000) // conciso
    for (const e of ORDEN) assert.ok(l.includes(`\`${e}\``), e)
  })
})

describe('informe tecnico privado, aparte del paquete', () => {
  it('guarda el detalle tecnico en un archivo 0600 NUEVO, fuera de la carpeta del paquete y del ZIP', () => {
    const r = respaldo((t) => { t.resumen_partido[0][8] = 4; t.resumen_partido[0][9] = 1; return t })
    const p = convertir(r, { ahora: AHORA })
    const informe = nuevaRuta('informe') + '.json'; const dir = escribirPaquete(nuevaRuta(), p, { rutaInforme: informe })
    assert.equal(statSync(informe).mode & 0o777, 0o600)
    assert.ok(!readdirSync(dir).some((n) => /tecnic|technical|informe/i.test(n)))
    const t = JSON.parse(readFileSync(informe, 'utf8'))
    assert.equal(t.source.class, 'LigaDO'); assert.equal(t.source.schemaVersion, 9); assert.equal(t.source.sealSha256, r.sha256)
    assert.ok(t.source.privateTablesRecognisedAndExcluded.includes('credenciales'))
    assert.deepEqual(t.summaries.find((x) => x.gameId === 'G1'), { gameId: 'G1', status: 'stale', staleReasons: 'revision,projection-version', summaryRevision: 4, projectionVersion: 1 })
    assert.ok(t.findings.some((x) => x.kind === 'summary-stale-values'))
    assert.equal(t.organizerPackage.manifestSha256, sha(readFileSync(join(dir, 'MANIFEST.json'))))
    assert.ok(t.fieldSources.games.some((c) => /partidos\./.test(c.source)))
    for (const s of SECRETOS) assert.ok(!JSON.stringify(t).includes(s), s) // ni siquiera el informe tecnico lleva datos privados
  })

  it('rechaza un informe dentro del paquete, dentro de Git, existente o sin carpeta padre, sin crear el paquete', () => {
    const p = convertir(respaldo(), { ahora: AHORA })
    const dir = nuevaRuta()
    assert.throws(() => escribirPaquete(dir, p, { rutaInforme: join(dir, 'x.json') }), (e) => e.codigo === 'informe-dentro-del-paquete')
    const repo = nuevaRuta('repo'); mkdirSync(join(repo, '.git'), { recursive: true })
    assert.throws(() => escribirPaquete(dir, p, { rutaInforme: join(repo, 'x.json') }), (e) => e.codigo === 'informe-dentro-de-un-repositorio')
    const previo = nuevaRuta('informe'); writeFileSync(previo, 'previo', { mode: 0o600 })
    assert.throws(() => escribirPaquete(dir, p, { rutaInforme: previo }), (e) => e.codigo === 'informe-ya-existe')
    assert.equal(readFileSync(previo, 'utf8'), 'previo')
    assert.throws(() => escribirPaquete(dir, p, { rutaInforme: join(RAIZ, 'no-hay', 'x.json') }), (e) => e.codigo === 'informe-sin-carpeta-padre')
    assert.ok(!existsSync(dir) && !existsSync(`${dir}.INCOMPLETO`))
  })
})

describe('ZIP del organizador', () => {
  const paquete = (r = respaldo()) => exportar(r).dir
  const zipEn = () => nuevaRuta('zip') + '.zip'
  const correrZip = (...a) => spawnSync(process.execPath, [new URL('../scripts/empaquetar-organizador.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH } })

  it('crea un ZIP NUEVO 0600 con solo los archivos aprobados, lo extrae a una carpeta temporal privada y lo verifica con el lector independiente', () => {
    const dir = paquete(); const zip = zipEn()
    const r = empaquetar({ paquete: dir, zip })
    assert.equal(r.verificado, true)
    assert.equal(statSync(zip).mode & 0o777, 0o600)
    const entradas = leerZip(readFileSync(zip))
    assert.deepEqual(entradas.map((e) => e.nombre).sort(), ARCHIVOS_APROBADOS.map((n) => `datos-deportivos/${n}`))
    for (const e of entradas) assert.ok(e.datos.equals(readFileSync(join(dir, e.nombre.replace('datos-deportivos/', '')))), e.nombre)
    // Reproduce conteos y totales declarados desde el contenido del ZIP
    assert.equal(r.conteos.events, 10)
    // El archivo ZIP no contiene el informe tecnico ni infraestructura
    const texto = entradas.map((e) => e.datos.toString('utf8')).join('\n').toLowerCase()
    for (const t of INFRA_DEL_FIXTURE) assert.ok(!texto.includes(t.toLowerCase()), t)
  })

  it('es determinista y un lector externo (unzip) lo acepta, si esta instalado', () => {
    const dir = paquete(); const a = zipEn(); const b = zipEn()
    empaquetar({ paquete: dir, zip: a }); empaquetar({ paquete: dir, zip: b })
    assert.ok(readFileSync(a).equals(readFileSync(b)))
    const u = spawnSync('unzip', ['-tq', a], { encoding: 'utf8' })
    if (u.error) return // unzip no esta instalado: la prueba propia de arriba es la obligatoria
    assert.equal(u.status, 0, u.stdout)
  })

  it('rechaza: contenido no aprobado, paquete alterado, ZIP existente, dentro de Git o del paquete, y no deja ZIP a medias', () => {
    const dir = paquete(); const zip = zipEn()
    writeFileSync(join(dir, 'informe-tecnico.json'), '{}', { mode: 0o600 })
    assert.throws(() => empaquetar({ paquete: dir, zip }), (e) => e instanceof ErrorEmpaquetado && e.codigo === 'paquete-no-verificado')
    assert.ok(!existsSync(zip))
    const alt = paquete(); writeFileSync(join(alt, 'teams.csv'), 'x', { mode: 0o600 })
    assert.throws(() => empaquetar({ paquete: alt, zip }), (e) => e.codigo === 'paquete-no-verificado')
    const ok = paquete(); const previo = zipEn(); writeFileSync(previo, 'previo', { mode: 0o600 })
    assert.throws(() => empaquetar({ paquete: ok, zip: previo }), (e) => e.codigo === 'zip-ya-existe'); assert.equal(readFileSync(previo, 'utf8'), 'previo')
    const repo = nuevaRuta('repo'); mkdirSync(join(repo, '.git'), { recursive: true })
    assert.throws(() => empaquetar({ paquete: ok, zip: join(repo, 'a.zip') }), (e) => e.codigo === 'zip-dentro-de-un-repositorio')
    assert.throws(() => empaquetar({ paquete: ok, zip: join(ok, 'a.zip') }), (e) => e.codigo === 'zip-dentro-del-paquete')
    assert.throws(() => empaquetar({ paquete: ok, zip: join(RAIZ, 'sin-extension') }), (e) => e.codigo === 'zip-sin-extension')
    assert.throws(() => empaquetar({ paquete: ok, zip: join(RAIZ, 'no-hay', 'a.zip') }), (e) => e.codigo === 'zip-sin-carpeta-padre')
  })

  it('el lector de ZIP rechaza rutas peligrosas, duplicados, CRC erroneo y archivos truncados', () => {
    const fecha = { fechaIso: '2026-10-30T12:00:00Z' }
    for (const nombre of ['../x', '/abs', 'a/../b', 'a b', 'a\\b']) assert.throws(() => leerZip(crearZip([{ nombre, datos: Buffer.from('x') }], fecha)), (e) => e.codigo === 'zip-nombre-no-seguro', nombre)
    assert.throws(() => leerZip(crearZip([{ nombre: 'a', datos: Buffer.from('x') }, { nombre: 'a', datos: Buffer.from('y') }], fecha)), (e) => e.codigo === 'zip-nombre-no-seguro')
    const bueno = crearZip([{ nombre: 'a.txt', datos: Buffer.from('hola mundo hola mundo') }], fecha)
    assert.equal(leerZip(bueno)[0].datos.toString(), 'hola mundo hola mundo')
    const malo = Buffer.from(bueno); malo[30 + 'a.txt'.length + 2] ^= 0xff // un byte de los datos comprimidos
    assert.throws(() => leerZip(malo), (e) => e.codigo === 'zip-corrupto')
    assert.throws(() => leerZip(bueno.subarray(0, bueno.length - 10)), (e) => e.codigo === 'zip-sin-directorio-central')
    assert.throws(() => leerZip(Buffer.from('no es un zip pero tiene mas de veintidos bytes')), (e) => e.codigo === 'zip-sin-directorio-central')
  })

  it('un ZIP cuyo contenido no verifica se borra y no queda en disco', () => {
    const dir = paquete(); const zip = zipEn()
    // Alterar el manifiesto con un termino de infraestructura y volver a firmarlo: el lector independiente lo rechaza ANTES de crear el ZIP.
    const m = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'))
    const l = `${readFileSync(join(dir, 'LEEME.md'), 'utf8')}\nProveedor: Cloudflare Worker\n`
    writeFileSync(join(dir, 'LEEME.md'), l); const f = m.files.find((x) => x.name === 'LEEME.md'); f.bytes = Buffer.byteLength(l); f.sha256 = sha(Buffer.from(l))
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(m))
    const v = verificarPaquete(dir)
    assert.ok(v.problemas.includes('infraestructura-en:LEEME.md'))
    assert.throws(() => empaquetar({ paquete: dir, zip }), (e) => e.codigo === 'paquete-no-verificado')
    assert.ok(!existsSync(zip))
  })

  it('linea de comandos: solo imprime nombres, tamanos y prefijo de checksum; rechaza argumentos mal formados', () => {
    const dir = paquete(); const zip = zipEn()
    const r = correrZip('--paquete', dir, '--zip', zip)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /empaquetado: completo y verificado/)
    assert.match(r.stdout, /datos-deportivos\/games\.json \d+/)
    for (const t of ['Águilas', 'Ñandú', 'Cañón', ...SECRETOS, 'G1']) assert.ok(!r.stdout.includes(t) && !r.stderr.includes(t), t)
    assert.equal(correrZip('--paquete', dir, '--zip', zip).status, 1) // ya existe
    assert.equal(correrZip('--paquete', dir).status, 2)
    assert.equal(correrZip('--zip', zipEn(), '--paquete', 'x', '--otra', 'y').status, 2)
  })
})
