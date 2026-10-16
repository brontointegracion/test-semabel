import { afterEach, describe, expect, it } from 'vitest'
import { exports } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { CAMPOS_PUBLICOS_EQUIPO, LIMITES_EQUIPO_PUBLICO, SQL_EVENTOS_DEL_EQUIPO, SQL_PARTIDOS_DEL_EQUIPO, nombrePublico } from '../src/proyeccion-equipo.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, Telefono, dentro, fijarEstadoDePartido, json, ligaSembrada, sembrar, sqlDe } from './ayuda.js'
import { llamarMedido, reconstruirResumenesDePrueba, sumar } from './ayuda-resumen.js'
import { control } from './worker-prueba.js'

// LECTURA PÚBLICA DE UN EQUIPO (GET /v1/ligas/{liga}/equipos/{equipo}/publico). Todo sintético, en workerd real.

const BASE = 'https://backend.local'
const leerEquipo = (ligaId, equipoId, init) => exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/equipos/${equipoId}/publico`, init))
const claves = (o) => Object.keys(o).sort()
const ordenadas = (xs) => [...xs].sort()
afterEach(() => { control.limitesEquipo = null })

const ficha = (id, equipoId, extra = {}) => ({ id, equipoId, personaId: `persona-${id}`, activo: true, ...extra })

/** Liga con nombres completos, compuestos, número 0, nombre antiguo, gemelos por nombre y campos privados. */
function payloadEquipos(ligaId) {
  const p = payloadDeLiga(ligaId)
  p.equipos = [{ id: 'E1', nombre: 'Alfa Norte' }, { id: 'E2', nombre: 'Beta Sur' }, { id: 'E3', nombre: 'Gama Este' }, { id: 'E5', nombre: 'Sin partidos' }]
  p.jugadores = [
    ficha('J1', 'E1', { nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 0 }),
    ficha('J2', 'E1', { nombrePila: 'Saúl', apellido1: 'Montero', dorsal: 2, fechaNacimiento: '2015-03-04', codigo: 'COD-SECRETO-1', nombreCamiseta: 'SAULITO' }),
    ficha('J3', 'E1', { nombrePila: 'María José', apellido1: 'de la Cruz', apellido2: 'Pérez', dorsal: 7 }),
    ficha('J4', 'E1', { nombre: 'Darío Antiguo', dorsal: 9 }), // ficha anterior: solo el nombre completo
    ficha('J6', 'E1', { nombrePila: 'Gemelo', apellido1: 'Igual', dorsal: 11 }), // mismo nombre…
    ficha('J7', 'E1', { nombrePila: 'Gemelo', apellido1: 'Igual', dorsal: 12 }), // …otra ficha
    ficha('JX', 'E1', { nombrePila: 'Retirado', apellido1: 'Ya', dorsal: 20, activo: false }), // inactivo sin eventos: no se publica
    ficha('K1', 'E2', { nombrePila: 'Eva', apellido1: 'Visita', dorsal: 1 }),
    ficha('K2', 'E2', { nombrePila: 'Hugo', apellido1: 'Cuatro', dorsal: 4 }),
    ficha('G1', 'E3', { nombrePila: 'Gil', apellido1: 'Tercero', dorsal: 4 }),
    ficha('W1', 'E5', { nombrePila: 'Pendiente', apellido1: 'Completo' }), // sin número
    ficha('W2', 'E5', {}), // sin nombre ni número
  ]
  p.partidos = [
    { id: 'P', localId: 'E1', visitaId: 'E2', programadoPara: '2026-11-01T19:00:00Z', sede: 'Cancha A' },
    { id: 'Q', localId: 'E3', visitaId: 'E1', programadoPara: '2026-11-08T19:00:00Z', sede: 'Cancha B' },
    { id: 'R', localId: 'E1', visitaId: 'E3', programadoPara: '2026-11-15T19:00:00Z' },
  ]
  p.credenciales = ['P', 'Q', 'R'].map((g) => ({ token: `tok-sintetico-${g}-${ligaId}-0001`, partidoId: g, deviceId: `tel-${g}`, actorId: `actor-${g}` }))
  return p
}
async function ligaConPartidos() {
  const ligaId = nuevaLiga()
  const base = await ligaSembrada(ligaId, payloadEquipos(ligaId))
  return { ...base, R: new Telefono(ligaId, 'R') }
}
const D = (jugadorId, equipoId = 'E1') => ({ equipoId, jugadorId })
/** P (E1 2-… E2) jugado y cerrado. Devuelve los ids de los eventos de J2 (punto 2) y J1 (triple). */
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
const porId = (xs) => Object.fromEntries(xs.map((x) => [x.id, x]))

describe('1. admisión, pertenencia y errores uniformes', () => {
  it('liga admitida: sin credenciales, sin caché y cabeceras de seguridad; método incorrecto 405', async () => {
    const { ligaId } = await ligaConPartidos()
    const r = await leerEquipo(ligaId, 'E1')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    const m = await leerEquipo(ligaId, 'E1', { method: 'POST', body: '{}' })
    expect(m.status).toBe(405)
    expect(m.headers.get('allow')).toBe('GET')
  })

  it('una liga NO admitida recibe el 404 uniforme y el binding no se toca', async () => {
    const accesos = []
    const LIGA = new Proxy({}, { get(_, p) { accesos.push(String(p)); return () => { throw new Error('binding tocado') } } })
    const entorno = { ENTORNO: 'prueba', LIGAS_ADMITIDAS: 'SOLOESTA', LIGA }
    const referencia = await (await worker.fetch(new Request(`${BASE}/otra/ruta`), entorno)).text()
    for (const metodo of ['GET', 'POST']) {
      const r = await worker.fetch(new Request(`${BASE}/v1/ligas/NOADMITIDA/equipos/E1/publico`, { method: metodo, body: metodo === 'POST' ? '{}' : undefined }), entorno)
      expect(r.status).toBe(404)
      expect(await r.text()).toBe(referencia)
    }
    expect(accesos).toEqual([])
  })

  it('equipo desconocido, equipo de otra liga o con otra liga en su fila: 404 sin detalle; liga sin datos: 404', async () => {
    const { ligaId } = await ligaConPartidos()
    const otra = nuevaLiga()
    const po = payloadDeLiga(otra)
    po.equipos = [{ id: 'X9', nombre: 'De otra liga' }]
    po.jugadores = []
    po.partidos = []
    po.credenciales = []
    expect((await sembrar(otra, po)).status).toBe(201)
    for (const [liga, equipo] of [[ligaId, 'NOEXISTE'], [ligaId, 'X9'], [otra, 'E1']]) {
      const r = await leerEquipo(liga, equipo)
      expect({ liga, equipo, status: r.status, cuerpo: await r.json() }).toEqual({ liga, equipo, status: 404, cuerpo: { error: 'no-encontrado' } })
    }
    await sqlDe(ligaId, "UPDATE equipos SET liga_id = 'OTRA' WHERE id = 'E5'")
    expect((await leerEquipo(ligaId, 'E5')).status).toBe(404) // la fila del equipo no pertenece a esta liga
    expect((await leerEquipo(nuevaLiga(), 'E1')).status).toBe(404)
  })
})

describe('2. contrato exacto y privacidad', () => {
  it('claves exactas en cada nivel; sin GP ni estadísticas no capturadas', async () => {
    const { ligaId, P } = await ligaConPartidos()
    await jugarP(P)
    const c = await json(await leerEquipo(ligaId, 'E1'))
    expect(claves(c)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.raiz))
    expect(claves(c.liga)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.liga))
    expect(claves(c.equipo)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.equipo))
    for (const j of c.plantilla) expect(claves(j)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.jugador))
    for (const h of c.historicos) expect(claves(h)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.historico))
    expect(c.resultados.length).toBe(1)
    for (const r of c.resultados) {
      expect(claves(r)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.resultado))
      expect(claves(r.local)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.lado))
    }
    expect(claves(c.estadisticas)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.estadisticas))
    for (const e of c.estadisticas.jugadores) expect(claves(e)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.estadistica))
    expect(claves(c.estadisticas.sinJugador)).toEqual(ordenadas(CAMPOS_PUBLICOS_EQUIPO.sinJugador))
    const texto = JSON.stringify(c)
    for (const mal of ['partidosJugados', 'jugados', '"gp"', 'GP', 'asistencias', 'rebotes', 'porcentaje', 'promedio']) expect(texto, mal).not.toContain(mal)
    expect(c.estadisticas.alcance).toBe('partidos-finales-del-equipo')
  })

  it('nunca sale fecha de nacimiento, código, nombre en camiseta, persona, credenciales, recibos ni eventos', async () => {
    const { ligaId, P } = await ligaConPartidos()
    await jugarP(P)
    const texto = await (await leerEquipo(ligaId, 'E1')).text()
    const prohibidos = [
      '2015-03-04', 'COD-SECRETO', 'SAULITO', 'persona', 'personaId', 'fechaNacimiento', 'fecha_nacimiento', 'nombreCamiseta', 'codigo',
      'tok-sintetico', 'tel-P', 'actor-P', 'deviceId', 'token_hash', 'recibo', 'cmdId', 'clientSeq', 'bandeja', 'creadoEn', 'anulado',
      'contacto', 'documento', 'telefono', 'correo', 'reclamado', 'rev_fuente', 'estado_json',
    ]
    for (const p of prohibidos) expect(texto, `contiene «${p}»`).not.toContain(p)
  })
})

describe('3. nombres completos, número 0 y datos incompletos', () => {
  it('nombre y apellidos tal cual (compuestos intactos), número 0 real, nombre antiguo conservado, sin inventar nada', async () => {
    const { ligaId } = await ligaConPartidos()
    const c = await json(await leerEquipo(ligaId, 'E1'))
    const p = porId(c.plantilla)
    expect(p.J1).toEqual({ id: 'J1', nombre: 'Ana Prueba', dorsalActual: 0 }) // el 0 es un número
    expect(p.J2).toEqual({ id: 'J2', nombre: 'Saúl Montero', dorsalActual: 2 })
    expect(p.J3).toEqual({ id: 'J3', nombre: 'María José de la Cruz Pérez', dorsalActual: 7 })
    expect(p.J4).toEqual({ id: 'J4', nombre: 'Darío Antiguo', dorsalActual: 9 })
    expect(c.plantilla.map((x) => x.id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J6', 'J7']) // por número, y el inactivo sin eventos no sale
    const sin = await json(await leerEquipo(ligaId, 'E5'))
    expect(sin.plantilla).toEqual([
      { id: 'W1', nombre: 'Pendiente Completo', dorsalActual: null },
      { id: 'W2', nombre: null, dorsalActual: null },
    ])
    expect(sin.resultados).toEqual([])
    expect(sin.estadisticas).toEqual({ alcance: 'partidos-finales-del-equipo', partidosFinales: 0, jugadores: [], sinJugador: { puntos: 0, faltas: 0 } })
  })

  it('nombrePublico: espacios, vacíos y solo el nombre antiguo', () => {
    expect(nombrePublico({ nombre_pila: '  Luz ', apellido1: ' Mar ', apellido2: '' })).toBe('Luz Mar')
    expect(nombrePublico({ nombre_pila: null, apellido1: 'Solo', apellido2: null, nombre: 'Ignorado' })).toBe('Solo')
    expect(nombrePublico({ nombre: '  Nombre Viejo ' })).toBe('Nombre Viejo')
    expect(nombrePublico({ nombre: '   ' })).toBeNull()
    expect(nombrePublico({})).toBeNull()
  })
})

describe('4. estadísticas: solo partidos finales, no anulados, por ficha estable', () => {
  it('solo cuentan los partidos finales; un partido en juego no mezcla provisionales; resultados salen del resumen', async () => {
    const { ligaId, P, Q } = await ligaConPartidos()
    await jugarP(P)
    await Q.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await Q.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await Q.mandar('anotar', { equipoId: 'E1', jugadorId: 'J3', puntos: 3 }, { t: T0 + 3000 }) // en vivo: provisional
    const c = await json(await leerEquipo(ligaId, 'E1'))
    expect(c.estadisticas.partidosFinales).toBe(1)
    expect(porId(c.estadisticas.jugadores)).toEqual({
      J1: { id: 'J1', puntos: 3, faltas: 0 }, J2: { id: 'J2', puntos: 2, faltas: 2 }, J6: { id: 'J6', puntos: 1, faltas: 0 },
    })
    expect(c.estadisticas.jugadores.some((x) => x.id === 'J3')).toBe(false) // el triple del partido en juego no cuenta
    expect(c.resultados).toEqual([{
      gameId: 'P', programadoPara: '2026-11-01T19:00:00.000Z', inicioReal: new Date(T0 + 1000).toISOString(), sede: 'Cancha A',
      local: { id: 'E1', nombre: 'Alfa Norte', puntos: 6, faltas: 2 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 2, faltas: 1 },
    }])
    // al cerrar Q, sus eventos pasan a contar
    await Q.mandar('detener-reloj', {}, { t: T0 + 4000 })
    await Q.mandar('cerrar-partido', {}, { t: T0 + 5000 })
    const d = await json(await leerEquipo(ligaId, 'E1'))
    expect(d.estadisticas.partidosFinales).toBe(2)
    expect(porId(d.estadisticas.jugadores).J3).toEqual({ id: 'J3', puntos: 3, faltas: 0 })
    expect(d.resultados.map((r) => r.gameId)).toEqual(['P', 'Q'])
    // el rival ve su propio lado de los mismos partidos
    const rival = await json(await leerEquipo(ligaId, 'E2'))
    expect(porId(rival.estadisticas.jugadores)).toEqual({ K1: { id: 'K1', puntos: 2, faltas: 0 }, K2: { id: 'K2', puntos: 0, faltas: 1 } })
  })

  it('deshacer, rehacer y anular tras el final cambian la SIGUIENTE lectura', async () => {
    const { ligaId, P } = await ligaConPartidos()
    const j = await jugarP(P)
    const pts = async (id = 'J2') => porId((await json(await leerEquipo(ligaId, 'E1'))).estadisticas.jugadores)[id]
    expect(await pts()).toEqual({ id: 'J2', puntos: 2, faltas: 2 })
    await j.siguiente('deshacer', {}) // quita la última acción viva de P: la falta de K2 (rival); no toca a E1
    expect((await pts()).faltas).toBe(2)
    await j.siguiente('anular-evento', { eventoId: j.dos }) // anula el +2 de J2
    expect(await pts()).toEqual({ id: 'J2', puntos: 0, faltas: 2 })
    expect((await json(await leerEquipo(ligaId, 'E1'))).resultados[0].local.puntos).toBe(4) // y el resultado sale del resumen actualizado
    await j.siguiente('rehacer', {}) // restituye lo último anulado
    expect(await pts()).toEqual({ id: 'J2', puntos: 2, faltas: 2 })
    await j.siguiente('anular-evento', { eventoId: j.tres })
    expect(await pts('J1')).toBeUndefined() // sin eventos vigentes la ficha deja de listarse en las estadísticas (se muestra 0 en pantalla)
    expect((await json(await leerEquipo(ligaId, 'E1'))).plantilla.map((x) => x.id)).toContain('J1') // pero sigue en la plantilla
  })

  it('fichas iguales por nombre o por número se agrupan por id estable; un cambio de número no mueve las estadísticas', async () => {
    const { ligaId, P } = await ligaConPartidos()
    const j = await jugarP(P)
    await j.siguiente('anular-evento', { eventoId: j.dos }) // J2 → 0 puntos
    await sqlDe(ligaId, "UPDATE jugadores SET dorsal = 12 WHERE id = 'J6'") // J6 pasa a usar el 12 de su gemelo J7 (ya no son únicos a propósito)
    const c = await json(await leerEquipo(ligaId, 'E1'))
    const est = porId(c.estadisticas.jugadores)
    expect(est.J6).toEqual({ id: 'J6', puntos: 1, faltas: 0 })
    expect(est.J7).toBeUndefined() // el gemelo no hereda nada por tener el mismo nombre ni el mismo número
    const p = porId(c.plantilla)
    expect(p.J6).toMatchObject({ nombre: 'Gemelo Igual', dorsalActual: 12 }) // número ACTUAL
    expect(p.J7).toMatchObject({ nombre: 'Gemelo Igual', dorsalActual: 12 })
    expect(c.estadisticas.jugadores.filter((e) => e.puntos === 1).length).toBe(1)
  })

  it('un jugador inactivo con eventos finales sigue en las estadísticas como histórico, separado de la plantilla; otro equipo y ficha ausente también', async () => {
    const { ligaId, P } = await ligaConPartidos()
    await jugarP(P)
    await sqlDe(ligaId, "UPDATE jugadores SET activo = 0, desactivado_en = 1 WHERE id = 'J2'")
    await sqlDe(ligaId, "UPDATE jugadores SET equipo_id = 'E2' WHERE id = 'J6'") // se fue a otro equipo
    await sqlDe(ligaId, "DELETE FROM jugadores WHERE id = 'J1'") // ficha ausente (dato histórico conservado)
    const c = await json(await leerEquipo(ligaId, 'E1'))
    expect(c.plantilla.map((x) => x.id)).not.toContain('J2')
    expect(c.plantilla.map((x) => x.id)).not.toContain('J6')
    expect(porId(c.historicos)).toEqual({
      J1: { id: 'J1', nombre: null, dorsalActual: null, motivo: 'no-encontrado' },
      J2: { id: 'J2', nombre: 'Saúl Montero', dorsalActual: 2, motivo: 'inactivo' },
      J6: { id: 'J6', nombre: 'Gemelo Igual', dorsalActual: 11, motivo: 'otro-equipo' },
    })
    expect(porId(c.estadisticas.jugadores)).toMatchObject({ J1: { puntos: 3 }, J2: { puntos: 2, faltas: 2 }, J6: { puntos: 1 } }) // nada se descarta
  })

  it('eventos sin ficha atribuida se informan aparte en vez de perderse', async () => {
    const { ligaId, P } = await ligaConPartidos()
    await jugarP(P)
    await sqlDe(ligaId, "UPDATE eventos SET json = json_set(json, '$.jugadorId', NULL) WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'punto' AND json_extract(json, '$.puntos') = 1")
    const c = await json(await leerEquipo(ligaId, 'E1'))
    expect(c.estadisticas.sinJugador).toEqual({ puntos: 1, faltas: 0 })
    expect(porId(c.estadisticas.jugadores).J6).toBeUndefined()
  })
})

describe('5. resumen no disponible y topes explícitos', () => {
  it('si falta el resumen de un partido final del equipo: 503 sin reconstruir; un resumen de OTRO partido no afecta', async () => {
    const { ligaId, P } = await ligaConPartidos()
    await jugarP(P)
    await sqlDe(ligaId, "DELETE FROM resumen_partido WHERE partido_id = 'R'") // programado: no importa
    expect((await leerEquipo(ligaId, 'E1')).status).toBe(200)
    await sqlDe(ligaId, "DELETE FROM resumen_partido WHERE partido_id = 'P'")
    const r = await leerEquipo(ligaId, 'E1')
    expect({ status: r.status, cuerpo: await r.json() }).toEqual({ status: 503, cuerpo: { error: 'resumen-no-disponible' } })
    expect(await sqlDe(ligaId, "SELECT COUNT(*) AS n FROM resumen_partido WHERE partido_id = 'P'")).toEqual([{ n: 0 }])
  })

  it('al rebasar un tope: 507 equipo-demasiado-grande, nunca totales parciales; justo en el tope cabe', async () => {
    const { ligaId, P } = await ligaConPartidos()
    await jugarP(P)
    const normal = LIMITES_EQUIPO_PUBLICO
    const eventosDeE1 = 7 // 4 puntos + 2 faltas de E1… más ninguno de E2: 3 puntos y 2 faltas = 5 eventos de E1
    for (const limites of [{ ...normal, partidos: 2 }, { ...normal, jugadores: 3 }, { ...normal, eventos: 4 }, { ...normal, equipos: 2 }]) {
      control.limitesEquipo = limites
      const r = await leerEquipo(ligaId, 'E1')
      expect({ limites, status: r.status, cuerpo: await r.json() }).toEqual({ limites, status: 507, cuerpo: { error: 'equipo-demasiado-grande' } })
    }
    control.limitesEquipo = { ...normal, partidos: 3, eventos: 5, equipos: 4, jugadores: 7 }
    const ok = await leerEquipo(ligaId, 'E1')
    expect(ok.status, `eventos de E1: ${eventosDeE1}`).toBe(200)
    expect(LIMITES_EQUIPO_PUBLICO).toEqual({ partidos: 100, jugadores: 300, eventos: 20_000, equipos: 100 })
  })
})

describe('6. coste: consultas, filas leídas, plan de índices y bytes (sintético)', () => {
  /** Equipo T1 con `finales` partidos finales de `porPartido` eventos (SQL DIRECTO: no pasan por el motor), más otros equipos en ruido. */
  async function construir({ finales, porPartido }) {
    const ligaId = nuevaLiga()
    const p = payloadDeLiga(ligaId)
    p.equipos = Array.from({ length: 12 }, (_, i) => ({ id: `T${i + 1}`, nombre: `Equipo ${i + 1}` }))
    p.jugadores = p.equipos.flatMap((e) => Array.from({ length: 12 }, (_, j) => ficha(`${e.id}J${j + 1}`, e.id, { nombrePila: `Nombre${j}`, apellido1: `Apellido${e.id}`, dorsal: j })))
    p.credenciales = []
    p.partidos = Array.from({ length: 60 }, (_, i) => ({ id: `G${i + 1}`, localId: `T${(i % 12) + 1}`, visitaId: `T${((i + 5) % 12) + 1}`, programadoPara: new Date(Date.UTC(2026, 10, 1 + (i % 30), 15)).toISOString() }))
    expect((await sembrar(ligaId, p)).status).toBe(201)
    const indicesT1 = p.partidos.map((x, i) => [x, i]).filter(([x]) => x.localId === 'T1' || x.visitaId === 'T1').map(([, i]) => i)
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      for (let i = 0; i < 60; i += 1) {
        const id = `G${i + 1}`
        const local = `T${(i % 12) + 1}`
        const visita = `T${((i + 5) % 12) + 1}`
        const deT1 = local === 'T1' || visita === 'T1'
        const esFinal = deT1 ? indicesT1.indexOf(i) < finales : true // los partidos de T1 que no son «finales» quedan programados
        for (let k = 1; k <= porPartido; k += 1) {
          const equipoId = k % 2 ? local : visita
          const jugadorId = `${equipoId}J${(k % 12) + 1}`
          const ev = k % 5 === 0 ? { tipo: 'falta', puntos: 0 } : { tipo: 'punto', puntos: 2 }
          sql.exec('INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', id, `${id}-e${k}`, k,
            JSON.stringify({ id: `${id}-e${k}`, partidoId: id, seq: k, equipoId, jugadorId, periodo: 1, anulado: k % 17 === 0, creadoEn: T0, ...ev })).toArray()
        }
        sql.exec('UPDATE partidos SET estado_json = ?, rev = ? WHERE id = ?',
          JSON.stringify({ auditSeq: 0, corridaSeq: null, cursorReloj: null, config: { deporte: 'baloncesto', minutosPorPeriodo: 10 }, partido: { estado: esFinal ? 'final' : 'programado', inicio: new Date(T0).toISOString(), relojEstado: 'detenido', relojRestante: 0, relojDesde: null } }),
          porPartido, id).toArray()
      }
    })
    await reconstruirResumenesDePrueba(ligaId)
    return ligaId
  }

  it('plan de consulta: los eventos se buscan por el índice del partido, sin recorrer toda la tabla', async () => {
    const ligaId = await construir({ finales: 2, porPartido: 50 })
    const plan = await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      const detalle = (q, ...a) => sql.exec(`EXPLAIN QUERY PLAN ${q}`, ...a).toArray().map((f) => f.detail)
      return { eventos: detalle(SQL_EVENTOS_DEL_EQUIPO, 'T1', 'T1', 'T1', 100), partidos: detalle(SQL_PARTIDOS_DEL_EQUIPO, 'T1', 'T1', 100) }
    })
    console.log(`PLAN ${JSON.stringify(plan)}`)
    const eventos = plan.eventos.join(' | ')
    expect(eventos).toMatch(/SEARCH e USING (COVERING )?INDEX/)
    expect(eventos).not.toMatch(/SCAN e\b/)
    expect(plan.partidos.join(' | ')).toMatch(/INDEX ix_partidos_(local|visita)|MULTI-INDEX OR/)
  })

  it('mide consultas, filas leídas y bytes con 2, 5 y 10 partidos finales del equipo, y 100, 200 y 400 eventos por partido', async () => {
    const mediciones = []
    for (const finales of [2, 5, 10]) {
      for (const porPartido of [100, 200, 400]) {
        const ligaId = await construir({ finales, porPartido })
        const m = await llamarMedido(ligaId, 'leerEquipoPublico', 'T1')
        expect(m.r.status).toBe(200)
        const s = sumar(m.sentencias)
        const bytes = JSON.stringify(m.r.cuerpo).length
        expect(m.r.cuerpo.estadisticas.partidosFinales).toBe(finales)
        expect(m.r.cuerpo.plantilla.length).toBe(12)
        mediciones.push({ finalesDelEquipo: finales, eventosPorPartido: porPartido, partidosEnLiga: 60, jugadoresEnLiga: 144, consultas: s.consultas, rowsRead: s.rowsRead, bytes })
      }
    }
    for (const m of mediciones) console.log(`MEDIDA ${JSON.stringify(m)}`)
    for (const m of mediciones) {
      expect(m.consultas).toBeLessThanOrEqual(8)
      expect(m.bytes).toBeLessThan(40 * 1024)
      // el coste depende de los eventos de ESTE equipo en SUS partidos finales (la mitad de cada partido), no de toda la liga
      expect(m.rowsRead).toBeLessThan(m.finalesDelEquipo * m.eventosPorPartido * 3 + 1500)
    }
  }, 120_000)
})
