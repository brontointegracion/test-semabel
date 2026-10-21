import { afterEach, describe, expect, it } from 'vitest'
import { exports } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { CAMPOS_PUBLICOS_JUGADORES, FILAS_MAXIMAS, LIMITES_JUGADORES_PUBLICO, RANGO_MAXIMO, rankear } from '../src/proyeccion-jugadores.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, Telefono, json, ligaSembrada, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'

// RANKINGS PÚBLICOS DE JUGADORES DE LA LIGA (GET /v1/ligas/{liga}/jugadores/publico). Todo sintético, en workerd real.

const BASE = 'https://backend.local'
const leerJugadores = (ligaId, init) => exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/jugadores/publico`, init))
const leerEquipo = (ligaId, equipoId) => exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/equipos/${equipoId}/publico`))
const claves = (o) => Object.keys(o).sort()
const ordenadas = (xs) => [...xs].sort()
afterEach(() => { control.limitesJugadores = null })

const ficha = (id, equipoId, extra = {}) => ({ id, equipoId, personaId: `persona-${id}`, activo: true, ...extra })
function payloadJugadores(ligaId) {
  const p = payloadDeLiga(ligaId)
  p.equipos = [{ id: 'E1', nombre: 'Alfa Norte' }, { id: 'E2', nombre: 'Beta Sur' }, { id: 'E3', nombre: 'Gama Este' }]
  p.jugadores = [
    ficha('J1', 'E1', { nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 0, fechaNacimiento: '2015-03-04', codigo: 'COD-SECRETO-1', nombreCamiseta: 'ANITA' }),
    ficha('J2', 'E1', { nombrePila: 'Saúl', apellido1: 'Montero', dorsal: 2 }),
    ficha('J6', 'E1', { nombrePila: 'Gemelo', apellido1: 'Igual', dorsal: 11 }),
    ficha('J7', 'E1', { nombrePila: 'Gemelo', apellido1: 'Igual', dorsal: 12 }), // mismo nombre, otra ficha
    ficha('K1', 'E2', { nombrePila: 'Eva', apellido1: 'Visita', dorsal: 1 }),
    ficha('K2', 'E2', { nombrePila: 'Hugo', apellido1: 'Cuatro', dorsal: 4 }),
    ficha('G1', 'E3', { nombrePila: 'Gil', apellido1: 'Tercero', dorsal: 4 }),
  ]
  p.partidos = [
    { id: 'P', localId: 'E1', visitaId: 'E2', programadoPara: '2026-11-01T19:00:00Z', sede: 'Cancha A' },
    { id: 'Q', localId: 'E3', visitaId: 'E1', programadoPara: '2026-11-08T19:00:00Z', sede: 'Cancha B' },
    { id: 'R', localId: 'E1', visitaId: 'E3', programadoPara: '2026-11-15T19:00:00Z' },
  ]
  p.credenciales = ['P', 'Q', 'R'].map((g) => ({ token: `tok-sintetico-${g}-${ligaId}-0001`, partidoId: g, deviceId: `tel-${g}`, actorId: `actor-${g}` }))
  return p
}
async function liga() {
  const ligaId = nuevaLiga()
  const base = await ligaSembrada(ligaId, payloadJugadores(ligaId))
  return { ...base, R: new Telefono(ligaId, 'R') }
}
const D = (jugadorId, equipoId = 'E1') => ({ equipoId, jugadorId })
async function jugarP(P) {
  let t = T0
  const ok = async (tipo, datos) => { t += 1000; const r = await P.mandar(tipo, datos, { t }); expect(r.cuerpo.resultado, tipo).toBe('aceptado'); return r }
  await ok('iniciar-partido', {})
  await ok('arrancar-reloj', {})
  const dos = await ok('anotar', { ...D('J2'), puntos: 2 })
  const tres = await ok('anotar', { ...D('J1'), puntos: 3 })
  await ok('anotar', { ...D('J6'), puntos: 1 })
  await ok('anotar', { ...D('K1', 'E2'), puntos: 2 })
  await ok('falta', D('J2'))
  await ok('falta', D('J2'))
  await ok('falta', D('K2', 'E2'))
  await ok('detener-reloj', {})
  await ok('cerrar-partido', {})
  return { dos: dos.sobre.cmdId, tres: tres.sobre.cmdId, siguiente: (tipo, datos) => ok(tipo, datos) }
}
const ver = async (ligaId) => json(await leerJugadores(ligaId))
const puntosDe = (c) => c.maximosAnotadores.map((x) => [x.rango, x.id, x.puntos])
const faltasDe = (c) => c.masFaltas.map((x) => [x.rango, x.id, x.faltas])

describe('1. admisión, método y contrato', () => {
  it('sin credenciales, sin caché; método incorrecto 405; liga no admitida: 404 uniforme sin tocar el binding; liga sin datos 404', async () => {
    const { ligaId } = await liga()
    const r = await leerJugadores(ligaId)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const m = await leerJugadores(ligaId, { method: 'POST', body: '{}' })
    expect(m.status).toBe(405)
    expect(m.headers.get('allow')).toBe('GET')
    const accesos = []
    const LIGA = new Proxy({}, { get(_, p) { accesos.push(String(p)); return () => { throw new Error('binding tocado') } } })
    const entorno = { ENTORNO: 'prueba', LIGAS_ADMITIDAS: 'SOLOESTA', LIGA }
    const referencia = await (await worker.fetch(new Request(`${BASE}/otra/ruta`), entorno)).text()
    const n = await worker.fetch(new Request(`${BASE}/v1/ligas/NOADMITIDA/jugadores/publico`), entorno)
    expect(n.status).toBe(404)
    expect(await n.text()).toBe(referencia)
    expect(accesos).toEqual([])
    expect((await leerJugadores(nuevaLiga())).status).toBe(404)
  })

  it('claves exactas y sin datos privados ni estadísticas no capturadas', async () => {
    const { ligaId, P } = await liga()
    await jugarP(P)
    const c = await ver(ligaId)
    expect(claves(c)).toEqual(ordenadas(CAMPOS_PUBLICOS_JUGADORES.raiz))
    expect(claves(c.liga)).toEqual(ordenadas(CAMPOS_PUBLICOS_JUGADORES.liga))
    expect(claves(c.sinJugador)).toEqual(ordenadas(CAMPOS_PUBLICOS_JUGADORES.sinJugador))
    for (const e of [...c.maximosAnotadores, ...c.masFaltas]) {
      expect(claves(e)).toEqual(ordenadas(CAMPOS_PUBLICOS_JUGADORES.entrada))
      expect(claves(e.equipo)).toEqual(ordenadas(CAMPOS_PUBLICOS_JUGADORES.equipo))
    }
    expect(c.alcance).toBe('partidos-finales-de-la-liga')
    expect(c.agrupacion).toBe('ficha-y-equipo')
    const texto = JSON.stringify(c)
    const prohibidos = ['2015-03-04', 'COD-SECRETO', 'ANITA', 'persona', 'fechaNacimiento', 'nombreCamiseta', 'codigo', 'tok-sintetico', 'tel-P', 'actor-P', 'deviceId',
      'token_hash', 'recibo', 'cmdId', 'clientSeq', 'bandeja', 'creadoEn', 'anulado', 'contacto', 'documento', 'telefono', 'correo', 'estado_json',
      'partidosJugados', 'jugados', '"gp"', 'GP', 'asistencias', 'rebotes', 'porcentaje', 'promedio']
    for (const x of prohibidos) expect(texto, `contiene «${x}»`).not.toContain(x)
  })
})

describe('2. solo partidos finales', () => {
  it('liga sin partidos finales: listas vacías (verificado), con partidosFinales 0; programado y en vivo no cuentan; al cerrar sí', async () => {
    const { ligaId, P, Q } = await liga()
    const vacio = await ver(ligaId)
    expect(vacio).toMatchObject({ partidosFinales: 0, maximosAnotadores: [], masFaltas: [], recortado: false, sinJugador: { puntos: 0, faltas: 0 } })
    await Q.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await Q.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await Q.mandar('anotar', D('J2'), { t: T0 + 2500 }) // intento sin puntos: lo que el motor acepte, sigue en vivo
    await Q.mandar('anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 }, { t: T0 + 3000 })
    await Q.mandar('falta', D('J2'), { t: T0 + 3500 })
    const enVivo = await ver(ligaId)
    expect(enVivo.partidosFinales).toBe(0)
    expect(enVivo.maximosAnotadores).toEqual([])
    expect(enVivo.masFaltas).toEqual([])
    await jugarP(P)
    const c = await ver(ligaId)
    expect(c.partidosFinales).toBe(1)
    expect(puntosDe(c)).toEqual([[1, 'J1', 3], [2, 'K1', 2], [2, 'J2', 2], [4, 'J6', 1]]) // lo de Q (en vivo) no suma
    await Q.mandar('detener-reloj', {}, { t: T0 + 4000 })
    await Q.mandar('cerrar-partido', {}, { t: T0 + 5000 })
    const d = await ver(ligaId)
    expect(d.partidosFinales).toBe(2)
    expect(d.maximosAnotadores.find((x) => x.id === 'J2').puntos).toBe(5) // 2 de P + 3 de Q
  })
})

describe('3. deshacer, rehacer y anular tras el final', () => {
  it('cambian la SIGUIENTE lectura; un evento anulado nunca cuenta y una ficha sin eventos vigentes sale de la lista', async () => {
    const { ligaId, P } = await liga()
    const j = await jugarP(P)
    const pts = async (id) => (await ver(ligaId)).maximosAnotadores.find((x) => x.id === id)?.puntos
    expect(await pts('J2')).toBe(2)
    await j.siguiente('deshacer', {}) // quita la falta de K2
    expect((await ver(ligaId)).masFaltas.find((x) => x.id === 'K2')).toBeUndefined()
    await j.siguiente('anular-evento', { eventoId: j.dos })
    expect(await pts('J2')).toBeUndefined()
    await j.siguiente('rehacer', {})
    expect(await pts('J2')).toBe(2)
    await j.siguiente('anular-evento', { eventoId: j.tres })
    expect(await pts('J1')).toBeUndefined() // sin eventos vigentes no aparece
  })
})

describe('4. empates, orden determinista y puestos compartidos', () => {
  it('«1, 2, 2, 4»; el orden dentro del empate es nombre y se repite igual; faltas con su propio ranking', async () => {
    const { ligaId, P } = await liga()
    await jugarP(P)
    const a = await ver(ligaId)
    expect(puntosDe(a)).toEqual([[1, 'J1', 3], [2, 'K1', 2], [2, 'J2', 2], [4, 'J6', 1]]) // «Eva Visita» < «Saúl Montero»
    expect(faltasDe(a)).toEqual([[1, 'J2', 2], [2, 'K2', 1]])
    const b = await ver(ligaId)
    expect({ ...b, servidorAhoraMs: 0 }).toEqual({ ...a, servidorAhoraMs: 0 }) // misma lectura, mismo orden
    const j2 = a.maximosAnotadores.find((x) => x.id === 'J2')
    expect(j2).toEqual({ rango: 2, id: 'J2', nombre: 'Saúl Montero', dorsalActual: 2, equipo: { id: 'E1', nombre: 'Alfa Norte' }, enPlantilla: true, puntos: 2, faltas: 2 })
    expect(a.maximosAnotadores.find((x) => x.id === 'J1').dorsalActual).toBe(0) // el 0 es un número real
  })

  it('rankear: sin ceros, empate en el corte se completa, tope de filas y marca de recorte', () => {
    const e = (id, puntos, nombre = id) => ({ id, nombre, dorsalActual: null, equipo: { id: 'E' }, puntos, faltas: 0 })
    const lista = [e('a', 5), e('b', 0), ...Array.from({ length: 12 }, (_, i) => e(`t${String(i).padStart(2, '0')}`, 3))]
    const r = rankear(lista, 'puntos', 3, 50)
    expect(r.filas.map((x) => [x.rango, x.id])).toEqual([[1, 'a'], ...Array.from({ length: 12 }, (_, i) => [2, `t${String(i).padStart(2, '0')}`])]) // los 12 empatados en el puesto 2 entran
    expect(r.recortado).toBe(false)
    const corto = rankear(lista, 'puntos', 3, 5)
    expect(corto.filas.length).toBe(5)
    expect(corto.recortado).toBe(true)
    expect(rankear(Array.from({ length: 30 }, (_, i) => e(`z${i}`, 30 - i)), 'puntos').filas.length).toBe(RANGO_MAXIMO)
    expect(FILAS_MAXIMAS).toBeGreaterThanOrEqual(RANGO_MAXIMO)
    expect(rankear([e('x', 0)], 'puntos').filas).toEqual([])
    const sinNombre = rankear([{ ...e('n', 4), nombre: null }, e('m', 4, 'Zeta')], 'puntos').filas.map((x) => x.id)
    expect(sinNombre).toEqual(['m', 'n']) // sin nombre al final del empate
  })
})

describe('5. ficha estable: nombres iguales, varias inscripciones, inactivos', () => {
  it('dos jugadores con el mismo nombre son dos entradas; el cambio de número no mueve nada', async () => {
    const { ligaId, P } = await liga()
    const j = await jugarP(P)
    await sqlDe(ligaId, "UPDATE eventos SET json = json_set(json, '$.jugadorId', 'J7') WHERE partido_id = 'P' AND json_extract(json, '$.jugadorId') = 'J2' AND json_extract(json, '$.tipo') = 'punto'") // el +2 pasa a J7
    await sqlDe(ligaId, "UPDATE jugadores SET dorsal = 12 WHERE id = 'J6'") // J6 y J7: mismo nombre y mismo número
    const c = await ver(ligaId)
    const gem = c.maximosAnotadores.filter((x) => x.nombre === 'Gemelo Igual')
    expect(gem.map((x) => [x.id, x.puntos, x.dorsalActual])).toEqual([['J7', 2, 12], ['J6', 1, 12]]) // dos entradas, cada una con lo suyo
    expect(j.dos).toBeTruthy()
  })

  it('misma persona en dos fichas (dos equipos) = dos entradas; una ficha con puntos en dos equipos = una entrada por equipo', async () => {
    const { ligaId, P, Q } = await liga()
    await jugarP(P)
    await sqlDe(ligaId, "UPDATE jugadores SET persona_id = 'persona-comun' WHERE id IN ('J1', 'K1')")
    let t = T0
    const ok = async (tipo, datos) => { t += 1000; const r = await Q.mandar(tipo, datos, { t }); expect(r.cuerpo.resultado, tipo).toBe('aceptado') }
    await ok('iniciar-partido', {})
    await ok('arrancar-reloj', {})
    await ok('anotar', { equipoId: 'E3', jugadorId: 'G1', puntos: 2 })
    await ok('detener-reloj', {})
    await ok('cerrar-partido', {})
    await sqlDe(ligaId, "UPDATE eventos SET json = json_set(json, '$.jugadorId', 'J1') WHERE partido_id = 'Q' AND json_extract(json, '$.tipo') = 'punto'") // J1 anota también por E3
    const c = await ver(ligaId)
    const j1 = c.maximosAnotadores.filter((x) => x.id === 'J1')
    expect(j1.map((x) => [x.equipo.id, x.puntos, x.enPlantilla]).sort()).toEqual([['E1', 3, true], ['E3', 2, false]])
    expect(c.maximosAnotadores.some((x) => x.id === 'K1')).toBe(true) // la persona compartida no fusiona K1 con J1
    expect(JSON.stringify(c)).not.toContain('persona')
  })

  it('inactivos, fichas movidas y fichas ausentes conservan su historia, marcados fuera de plantilla; nada se inventa', async () => {
    const { ligaId, P } = await liga()
    await jugarP(P)
    await sqlDe(ligaId, "UPDATE jugadores SET activo = 0, desactivado_en = 1 WHERE id = 'J2'")
    await sqlDe(ligaId, "UPDATE jugadores SET equipo_id = 'E2' WHERE id = 'J6'")
    await sqlDe(ligaId, "DELETE FROM jugadores WHERE id = 'J1'")
    const c = await ver(ligaId)
    const por = Object.fromEntries(c.maximosAnotadores.map((x) => [x.id, x]))
    expect(por.J2).toMatchObject({ nombre: 'Saúl Montero', enPlantilla: false, puntos: 2, faltas: 2, equipo: { id: 'E1' } })
    expect(por.J6).toMatchObject({ enPlantilla: false, puntos: 1, equipo: { id: 'E1' } }) // el equipo de entonces
    expect(por.J1).toMatchObject({ nombre: null, dorsalActual: null, enPlantilla: false, puntos: 3 })
    expect(por.K1.enPlantilla).toBe(true)
    expect(c.masFaltas.find((x) => x.id === 'J2')).toMatchObject({ faltas: 2, enPlantilla: false })
  })

  it('eventos sin ficha atribuida van a sinJugador y no entran en ningún ranking', async () => {
    const { ligaId, P } = await liga()
    await jugarP(P)
    await sqlDe(ligaId, "UPDATE eventos SET json = json_set(json, '$.jugadorId', NULL) WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'punto' AND json_extract(json, '$.puntos') = 1")
    const c = await ver(ligaId)
    expect(c.sinJugador).toEqual({ puntos: 1, faltas: 0 })
    expect(c.maximosAnotadores.some((x) => x.id === 'J6')).toBe(false)
  })
})

describe('6. coincide con las estadísticas del equipo', () => {
  it('para cada equipo, cada ficha del ranking de la liga suma lo mismo que su fila en la página del equipo (mismos partidos finales)', async () => {
    const { ligaId, P, Q } = await liga()
    await jugarP(P)
    let t = T0
    const ok = async (tipo, datos) => { t += 1000; const r = await Q.mandar(tipo, datos, { t }); expect(r.cuerpo.resultado, tipo).toBe('aceptado'); return r }
    await ok('iniciar-partido', {})
    await ok('arrancar-reloj', {})
    await ok('anotar', { equipoId: 'E3', jugadorId: 'G1', puntos: 3 })
    await ok('anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 })
    await ok('anotar', { equipoId: 'E1', jugadorId: 'J7', puntos: 2 })
    await ok('falta', { equipoId: 'E3', jugadorId: 'G1' })
    const x = await ok('anotar', { equipoId: 'E1', jugadorId: 'J6', puntos: 2 })
    await ok('anular-evento', { eventoId: x.sobre.cmdId })
    await ok('detener-reloj', {})
    await ok('cerrar-partido', {})
    const lig = await ver(ligaId)
    const mapa = new Map()
    for (const e of [...lig.maximosAnotadores, ...lig.masFaltas]) mapa.set(`${e.id}|${e.equipo.id}`, e)
    expect(mapa.size).toBeGreaterThan(5)
    for (const equipoId of ['E1', 'E2', 'E3']) {
      const eq = await json(await leerEquipo(ligaId, equipoId))
      for (const s of eq.estadisticas.jugadores) {
        const e = mapa.get(`${s.id}|${equipoId}`)
        if (s.puntos > 0 || s.faltas > 0) expect(e, `${s.id} en ${equipoId}`).toBeDefined()
        if (e) expect({ id: s.id, puntos: e.puntos, faltas: e.faltas }).toEqual(s)
      }
    }
  })
})

describe('7. topes explícitos', () => {
  it('al rebasar un tope: 507 liga-demasiado-grande, nunca totales parciales; justo en el tope cabe', async () => {
    const { ligaId, P } = await liga()
    await jugarP(P)
    const normal = LIMITES_JUGADORES_PUBLICO
    for (const limites of [{ ...normal, partidos: 2 }, { ...normal, equipos: 2 }, { ...normal, jugadores: 3 }]) {
      control.limitesJugadores = limites
      const r = await leerJugadores(ligaId)
      expect({ limites, status: r.status, cuerpo: await r.json() }).toEqual({ limites, status: 507, cuerpo: { error: 'liga-demasiado-grande' } })
    }
    control.limitesJugadores = { partidos: 3, equipos: 3, jugadores: 7 }
    expect((await leerJugadores(ligaId)).status).toBe(200) // 3 partidos, 3 equipos y 7 fichas
    expect(LIMITES_JUGADORES_PUBLICO).toEqual({ partidos: 300, equipos: 100, jugadores: 3000 })
  })
})
