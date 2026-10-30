// Contraste offline paquete portable <-> lecturas publicas guardadas. Datos SINTETICOS; sin red.
import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { convertir, escribirPaquete, sellar } from '../scripts/lib/exportar-portable.mjs'
import { compararLecturasPublicas } from '../scripts/lib/lecturas-publicas.mjs'

const CLI = new URL('../scripts/verificar-lecturas-publicas.mjs', import.meta.url).pathname
const RAIZ = mkdtempSync(join(tmpdir(), 'lecturas-publicas-')); let n = 0
const ev = (id, seq, o) => JSON.stringify({ id, partidoId: o.g, seq, tipo: o.tipo, equipoId: o.t ?? null, jugadorId: o.p ?? null, puntos: o.pts ?? null, periodo: 1, anulado: o.an ?? false, creadoEn: 1_790_000_000_000 + seq * 1000 })
const est = (e, inicio = null) => JSON.stringify({ config: { deporte: 'baloncesto' }, partido: { estado: e, inicio } })
const tabla = (nombre, columnas, filas) => ({ nombre, columnas, conRowid: true, filas: filas.length, datos: filas.map((f, i) => [i + 1, ...f]) })
const respaldo = (mod = (t) => t) => {
  const T = mod({
    ligas: [['L1', 'Liga Ñandú', 'baloncesto', 10, null, null]],
    equipos: [['T1', 'L1', 'Águilas', 'masculino'], ['T2', 'L1', 'Café', null]],
    jugadores: [['P1', 'T1', 'L1', null, 'Ana', 'Pérez', null, 4, 1], ['P2', 'T2', 'L1', null, 'Beto', 'Ruiz', null, null, 1]],
    partidos: [
      ['G1', 'L1', 'T1', 'T2', est('final', '2026-10-30T15:00:00.000Z'), 5, '2026-10-30T14:00:00.000Z', 'Cancha Cañón', null],
      ['G2', 'L1', 'T2', 'T1', est('programado'), 0, '2026-11-01T14:00:00.000Z', 'Cancha Cañón', null],
      ['G3', 'L1', 'T1', 'T2', est('programado'), 0, '2026-11-02T14:00:00.000Z', 'Sede retirada', 1_790_100_000_000],
    ],
    eventos: [
      ['G1', 'e1', 1, ev('e1', 1, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 2 })], ['G1', 'e2', 2, ev('e2', 2, { g: 'G1', tipo: 'punto', t: 'T1', p: 'P1', pts: 3, an: true })],
      ['G1', 'e3', 3, ev('e3', 3, { g: 'G1', tipo: 'punto', t: 'T2', p: 'P2', pts: 3 })], ['G1', 'e4', 4, ev('e4', 4, { g: 'G1', tipo: 'falta', t: 'T1', p: 'P1', pts: 0 })],
      ['G1', 'e5', 5, ev('e5', 5, { g: 'G1', tipo: 'punto', t: 'T1', p: null, pts: 1 })],
    ],
    resumen_partido: [['G1', 'T1', 'T2', 3, 3, 1, 0, 1, 5, 2], ['G2', 'T2', 'T1', 0, 0, 0, 0, 1, 0, 2], ['G3', 'T1', 'T2', 0, 0, 0, 0, 1, 0, 2]],
  })
  const C = {
    ligas: ['id', 'nombre', 'deporte', 'minutos_por_periodo', 'categoria', 'subcategoria_json'], equipos: ['id', 'liga_id', 'nombre', 'rama'],
    jugadores: ['id', 'equipo_id', 'liga_id', 'nombre', 'nombre_pila', 'apellido1', 'apellido2', 'dorsal', 'activo'],
    partidos: ['id', 'liga_id', 'local_id', 'visita_id', 'estado_json', 'rev', 'programado_para', 'sede', 'retirado_en'], eventos: ['partido_id', 'id', 'seq', 'json'],
    resumen_partido: ['partido_id', 'local_id', 'visita_id', 'local_puntos', 'visita_puntos', 'local_faltas', 'visita_faltas', 'periodo', 'rev_fuente', 'version_proyeccion'],
  }
  return sellar({ formato: 'sebel-respaldo-sql', version: 1, clase: 'LigaDO', objeto: 'L1', versionEsquema: 9, bytesBase: 1, capturadoEnMs: 1_790_200_000_000, internasDeLaPlataforma: [],
    esquema: [], tablas: Object.entries(C).map(([k, c]) => tabla(k, [...c], T[k])) })
}
const paquete = () => { const p = convertir(respaldo(), { ahora: () => '2026-10-30T12:00:00.000Z' }); return { p, dir: escribirPaquete(join(RAIZ, `pkg-${n++}`), p) } }
const datos = (p) => ({ leagues: p.datos.leagues, teams: p.datos.teams, games: p.datos.games, game_scores: p.datos.game_scores.map((s) => ({ ...s, recordedScoreStatus: { coherent: 'available', stale: 'not-current', missing: 'unavailable' }[s.summaryStatus] })), player_game_totals: p.datos.player_game_totals })

// Lecturas publicas SINTETICAS con la forma de proyeccion-publica.js / proyeccion-jugadores.js
const publicas = () => ({
  liga: { liga: { id: 'L1', nombre: 'Liga Ñandú' }, equipos: [{ id: 'T1', nombre: 'Águilas', rama: 'masculino' }, { id: 'T2', nombre: 'Café', rama: null }],
    partidos: [
      { gameId: 'G1', estado: 'final', programadoPara: '2026-10-30T14:00:00.000Z', inicioReal: '2026-10-30T15:00:00.000Z', sede: 'Cancha Cañón', local: { id: 'T1', nombre: 'Águilas', puntos: 3, faltas: 1 }, visita: { id: 'T2', nombre: 'Café', puntos: 3, faltas: 0 } },
      { gameId: 'G2', estado: 'programado', programadoPara: '2026-11-01T14:00:00.000Z', inicioReal: null, sede: 'Cancha Cañón', local: { id: 'T2', nombre: 'Café', puntos: 0, faltas: 0 }, visita: { id: 'T1', nombre: 'Águilas', puntos: 0, faltas: 0 } },
    ] },
  jugadores: { liga: { id: 'L1', nombre: 'Liga Ñandú' }, partidosFinales: 1, sinJugador: { puntos: 1, faltas: 0 }, recortado: false,
    maximosAnotadores: [{ rango: 1, id: 'P2', equipo: { id: 'T2' }, puntos: 3, faltas: 0 }, { rango: 2, id: 'P1', equipo: { id: 'T1' }, puntos: 2, faltas: 1 }],
    masFaltas: [{ rango: 1, id: 'P1', equipo: { id: 'T1' }, puntos: 2, faltas: 1 }] },
})
const comparar = (mutar) => { const { p } = paquete(); const pub = publicas(); mutar?.(pub); return compararLecturasPublicas({ paquete: datos(p), lecturaLiga: pub.liga, lecturaJugadores: pub.jugadores }) }

describe('contraste paquete <-> lecturas publicas', () => {
  it('coincide cuando la lectura publica es la esperada: partido retirado ausente, marcador, programacion, sede y totales', () => {
    const r = comparar()
    assert.deepEqual(r.detalle, []); assert.equal(r.ok, true); assert.ok(r.comprobaciones > 30)
  })
  it('detecta cada diferencia con un codigo concreto', () => {
    const caso = (mutar, code) => assert.ok(comparar(mutar).porCodigo[code] >= 1, code)
    caso((p) => { p.liga.partidos[0].local.puntos = 4 }, 'game-score-differs')
    caso((p) => { p.liga.partidos[0].local.faltas = 2 }, 'game-fouls-differ')
    caso((p) => { p.liga.partidos[1].sede = 'Otra' }, 'game-venue-differs')
    caso((p) => { p.liga.partidos[1].programadoPara = '2026-11-01T15:00:00.000Z' }, 'game-schedule-differs')
    caso((p) => { p.liga.partidos[0].estado = 'vivo' }, 'game-state-differs')
    caso((p) => { p.liga.partidos.pop() }, 'game-missing-publicly')
    caso((p) => { p.liga.partidos.push({ gameId: 'G3', estado: 'programado', local: { id: 'T1' }, visita: { id: 'T2' } }) }, 'retired-game-visible-publicly')
    caso((p) => { p.liga.partidos.push({ gameId: 'G9', estado: 'programado', local: { id: 'T1' }, visita: { id: 'T2' } }) }, 'public-game-missing-from-package')
    caso((p) => { p.liga.equipos.pop() }, 'team-missing-publicly')
    caso((p) => { p.liga.equipos[0].nombre = 'Otro' }, 'team-name-differs')
    caso((p) => { p.liga.equipos[1].rama = 'mixta' }, 'team-branch-differs')
    caso((p) => { p.jugadores.maximosAnotadores[0].puntos = 9 }, 'player-puntos-differ')
    caso((p) => { p.jugadores.masFaltas[0].faltas = 4 }, 'player-faltas-differ')
    caso((p) => { p.jugadores.sinJugador.puntos = 0 }, 'unattributed-totals-differ')
    caso((p) => { p.jugadores.partidosFinales = 2 }, 'final-game-count-differs')
    caso((p) => { p.jugadores.maximosAnotadores.shift() }, 'player-puntos-missing-from-public-ranking')
    caso((p) => { p.jugadores.maximosAnotadores.push({ rango: 3, id: 'P7', equipo: { id: 'T1' }, puntos: 1, faltas: 0 }) }, 'player-puntos-differ')
  })
  it('un evento anulado nunca suma: P1 tiene 2 puntos, no 5', () => {
    const r = comparar((p) => { p.jugadores.maximosAnotadores[1].puntos = 5 })
    assert.equal(r.porCodigo['player-puntos-differ'], 1)
  })
  it('linea de comandos: coincide (0) o falla (1) sin imprimir nombres ni registros; rechaza un paquete que no verifica', () => {
    const { dir } = paquete(); const pub = publicas()
    const f = (nombre, o) => { const r = join(RAIZ, nombre); writeFileSync(r, JSON.stringify(o), { mode: 0o600 }); chmodSync(r, 0o600); return r }
    const ok = spawnSync(process.execPath, [CLI, '--paquete', dir, '--lectura-liga', f('liga.json', pub.liga), '--lectura-jugadores', f('jug.json', pub.jugadores)], { encoding: 'utf8' })
    assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /COINCIDE/)
    pub.liga.partidos[0].local.puntos = 9
    const mal = spawnSync(process.execPath, [CLI, '--paquete', dir, '--lectura-liga', f('liga2.json', pub.liga), '--lectura-jugadores', f('jug.json', pub.jugadores)], { encoding: 'utf8' })
    assert.equal(mal.status, 1); assert.match(mal.stdout, /game-score-differs: 1/)
    for (const t of ['Águilas', 'Café', 'Ñandú', 'Ana', 'Pérez']) assert.ok(!mal.stdout.includes(t) && !mal.stderr.includes(t), t)
    writeFileSync(join(dir, 'teams.csv'), 'x', { mode: 0o600 })
    const roto = spawnSync(process.execPath, [CLI, '--paquete', dir, '--lectura-liga', f('liga.json', pub.liga), '--lectura-jugadores', f('jug.json', pub.jugadores)], { encoding: 'utf8' })
    assert.equal(roto.status, 1); assert.match(roto.stderr, /NO VERIFICA/)
    assert.equal(spawnSync(process.execPath, [CLI, '--paquete', dir], { encoding: 'utf8' }).status, 2)
  })
})
