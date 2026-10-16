import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { LIMITES_ESTADO_CONTROL } from '../src/lectura-estado-control.js'
import { abrirAlmacen, actualizarVisualizacion, aplicarRecibo, crearSesion, encolar, leerSesion, marcarEnviando } from '../../src/lib/control/sesion-almacen.js'
import { construirSesion, evaluarInicio, ordenDeInicio } from '../../src/lib/control/sesion-motor.js'
import { datosParaMostrar, descripcionDeJugador } from '../../src/lib/control/sesion-visualizacion.js'
import { tokenDe } from './fixtures/sintetico.js'
import { leerEstado, postComando } from './ayuda.js'
import { control } from './ayuda-acceso.js'
import { accion, escenarioPlantilla, payloadPlantilla } from './ayuda-plantilla.js'

// REPORT_127 contra el Worker REAL: la lectura protegida /estado trae los nombres y números para mostrar en una lista blanca; la
// sesión S1a (base sobre fake-indexeddb de la raíz, dentro de workerd) los valida, los guarda en su contabilidad y los recupera tras
// reabrir SIN red. Datos sintéticos y desechables.

const BASE = 'https://backend.local'
const SERVIDOR = 1_700_000_000_000 + 10_000_000
afterEach(() => { control.ahoraMs = null; control.limitesEstado = null })
let n = 0
const ver = async (r) => { const texto = await r.text(); let cuerpo = null; try { cuerpo = JSON.parse(texto) } catch { /* sin JSON */ } return { status: r.status, texto, cuerpo } }
const ctx = { ahoraEstimado: SERVIDOR, actorId: 'viz', enLinea: true, ahora: SERVIDOR }
const tiempo = (ts) => ({ accionTs: ts, accionTsCrudo: ts, ajusteTsMs: 0, discontinuidad: null })

/** La plantilla de siempre más una ficha SIN número ni partes de nombre (heredada: solo `nombre`) en el equipo visitante. */
const payloadConHeredada = (ligaId) => {
  const p = payloadPlantilla(ligaId)
  p.jugadores.push({ id: 'JN', equipoId: 'E2', nombre: 'Nombre Heredado Completo', dorsal: null, personaId: 'persona-JN' })
  return p
}

async function entorno({ conHeredada = true } = {}) {
  const e = await escenarioPlantilla({ payload: conHeredada ? payloadConHeredada : payloadPlantilla })
  const token = tokenDe(e.ligaId, 'P')
  control.ahoraMs = SERVIDOR
  const nombre = `viz-http-${++n}-${Math.random().toString(36).slice(2)}`
  const almacen = await abrirAlmacen({ nombre })
  const t = {
    e, ligaId: e.ligaId, token, almacen, nombre, id: `${e.ligaId}:P`, revision: 0,
    nota(r) { if (r?.vista) t.revision = r.vista.revision; return r },
    estado: async () => ver(await leerEstado(e.ligaId, 'P', token)),
    prep: async () => ver(await exports.default.fetch(new Request(`${BASE}/v1/ligas/${e.ligaId}/partidos/P/preparacion`, { headers: { authorization: `Bearer ${token}` } }))),
    leer: async () => { const r = await leerSesion(almacen, t.id, ctx); if (r.ok) t.revision = r.sesion.revision; return r },
    async crear() {
      const est = await t.estado()
      const s = construirSesion({ ligaId: e.ligaId, partidoId: 'P', cuerpoEstado: est.cuerpo })
      expect(s.ok, JSON.stringify(s)).toBe(true)
      return { est, s, creada: t.nota(await crearSesion(almacen, s.sesion)) }
    },
  }
  return t
}

describe('E4a — la lectura protegida real trae los datos para mostrar en una lista blanca', () => {
  it('claves exactas; el 0 es un número real; un hueco es null (no 0); fichas heredadas sin partes de nombre; nada sensible', async () => {
    const t = await entorno()
    const est = await t.estado()
    expect(est.status).toBe(200)
    const v = est.cuerpo.visualizacion
    expect(Object.keys(v).sort()).toEqual(['equipos', 'jugadores'])
    expect(v.equipos).toEqual([{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }])
    for (const j of v.jugadores) expect(Object.keys(j).sort()).toEqual(['activo', 'apellido1', 'dorsal', 'equipoId', 'id', 'nombrePila'])
    const por = Object.fromEntries(v.jugadores.map((j) => [j.id, j]))
    expect(por.J1).toEqual({ id: 'J1', equipoId: 'E1', nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 0, activo: true })
    expect(por.J2).toMatchObject({ nombrePila: 'Beto', apellido1: 'Muestra', dorsal: 7 })
    expect(por.J9).toMatchObject({ dorsal: 1, activo: true })
    expect(por.JN).toEqual({ id: 'JN', equipoId: 'E2', nombrePila: null, apellido1: null, dorsal: null, activo: true })
    expect(por.JX).toBeUndefined() // inactivo y sin eventos: no hace falta
    const crudo = JSON.stringify(v)
    for (const prohibido of ['2015-03-12', '4321', 'persona-', 'ANA', 'fechaNacimiento', 'codigo', 'personaId', 'apellido2', 'nombreCamiseta', 'Heredado', 'token', 'tel-P', 'actor-']) expect(crudo, prohibido).not.toContain(prohibido)
    expect(new TextEncoder().encode(crudo).length).toBeLessThan(2 * 1024)
    // sin credencial: nada
    expect((await ver(await leerEstado(t.ligaId, 'P', 'token-que-no-existe-0000'))).texto).not.toContain('Alfa')
    expect(new TextEncoder().encode(est.texto).length).toBeLessThan(LIMITES_ESTADO_CONTROL.maxBytes)
  })

  it('REAL → validado → guardado → base reabierta SIN red: nombres y números intactos, también el 0 y los huecos', async () => {
    const t = await entorno()
    const { s, creada } = await t.crear()
    expect(s.visualizacion).toEqual({ estado: 'ok' })
    expect(creada.ok).toBe(true)
    const otra = await abrirAlmacen({ nombre: t.nombre }) // recarga: sin fetch de por medio
    const l = await leerSesion(otra, t.id, ctx)
    expect(datosParaMostrar(l.sesion)).toMatchObject({ disponible: true, desactualizada: false })
    expect(descripcionDeJugador(l.sesion, 'J1').texto).toBe('#0 Ana Prueba')
    expect(descripcionDeJugador(l.sesion, 'J2').texto).toBe('#7 Beto Muestra')
    expect(descripcionDeJugador(l.sesion, 'JN')).toMatchObject({ nombre: null, dorsalActual: null, dorsalAlEvento: null })
    const volcado = JSON.stringify(l.sesion)
    for (const prohibido of ['2015-03-12', '4321', 'persona-', 'fechaNacimiento', 'codigo"', 'personaId']) expect(volcado, prohibido).not.toContain(prohibido)
    expect(l.sesion.uso.bytes).toBeGreaterThan(0)
  })
})

describe('E4b — actualización con cambios reales del organizador', () => {
  it('un nombre cambiado se adopta; la atribución y la preparación NO cambian (mismas huellas); el inicio original sigue siendo aceptado; los recibos se repiten igual', async () => {
    const t = await entorno({ conHeredada: false }) // una ficha activa sin número impediría el inicio (regla existente)
    await t.crear()
    const p1 = await t.prep()
    const est1 = await t.estado()
    // el sobre de inicio se encola ANTES del cambio de nombre
    const l0 = await t.leer()
    expect(evaluarInicio({ enLinea: true, sesion: l0.sesion, entradas: [], preparacion: p1.cuerpo.preparacion })).toEqual({ puede: true })
    const orden = ordenDeInicio({ cmdId: `ini-viz-${n}`, preparacion: p1.cuerpo.preparacion, tiempo: tiempo(SERVIDOR - 1000), sesion: l0.sesion }).orden
    expect((t.nota(await encolar(t.almacen, { id: t.id, revision: t.revision, orden, ctx }))).ok).toBe(true)
    const antesEntradas = JSON.stringify((await t.leer()).entradas)
    // el organizador corrige el nombre de J2 (antes del partido: permitido)
    const r = await accion(t.e.cookie, t.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { nombrePila: 'Saúl', apellido1: 'Montero' } })
    expect([200, 201], JSON.stringify(r.cuerpo)).toContain(r.status)
    const p2 = await t.prep()
    const est2 = await t.estado()
    expect(est2.cuerpo.atribucion.version).toBe(est1.cuerpo.atribucion.version)
    expect(p2.cuerpo.preparacion.version).toBe(p1.cuerpo.preparacion.version)
    expect(est2.cuerpo.visualizacion.jugadores.find((j) => j.id === 'J2')).toMatchObject({ nombrePila: 'Saúl', apellido1: 'Montero', dorsal: 7 })
    const ad = t.nota(await actualizarVisualizacion(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: est2.cuerpo, ctx }))
    expect(ad).toMatchObject({ ok: true, adoptada: true })
    const l1 = await t.leer()
    expect(descripcionDeJugador(l1.sesion, 'J2').texto).toBe('#7 Saúl Montero')
    expect(JSON.stringify(l1.entradas)).toBe(antesEntradas) // sobres, bytes, reservas, intentos: idénticos
    expect(l1.sesion.divergencia).toBeNull()
    // el inicio en cola (con la preparación anterior) sigue siendo aceptable: la preparación no cambió
    const m = t.nota(await marcarEnviando(t.almacen, { id: t.id, revision: t.revision, cmdId: orden.cmdId, ctx }))
    const enviado = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: m.cuerpoJson }))
    expect(enviado.cuerpo.resultado).toBe('aceptado')
    expect(t.nota(await aplicarRecibo(t.almacen, { id: t.id, revision: t.revision, recibo: enviado.cuerpo.recibo, ctx })).ok).toBe(true)
    // repetición exacta del sobre: recibo-existente y no-op
    const otra = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: m.cuerpoJson }))
    expect(otra.cuerpo.resultado).toBe('recibo-existente')
    expect(otra.cuerpo.recibo).toEqual(enviado.cuerpo.recibo)
    expect(await aplicarRecibo(t.almacen, { id: t.id, revision: t.revision, recibo: otra.cuerpo.recibo, ctx })).toMatchObject({ ok: true, noop: true })
    expect((await t.leer()).sesion.inicio).toBe('confirmado')
  })

  it('juego o dispositivo equivocado y referencias inconsistentes sobre una respuesta REAL manipulada: nada se actualiza', async () => {
    const t = await entorno()
    await t.crear()
    const est = await t.estado()
    const antes = JSON.stringify(await t.leer())
    const mod = (f) => { const c = JSON.parse(JSON.stringify(est.cuerpo)); f(c); return c }
    const casos = [
      [mod((c) => { c.gameId = 'Q' }), 'instantanea-invalida'],
      [mod((c) => { c.deviceId = 'tel-otro' }), 'instantanea-invalida'],
      [mod((c) => { c.visualizacion.jugadores[0].equipoId = c.visualizacion.jugadores[0].equipoId === 'E1' ? 'E2' : 'E1' }), 'visualizacion-invalida'],
      [mod((c) => { c.visualizacion.jugadores.push({ id: 'J-inventado', equipoId: 'E1', nombrePila: 'X', apellido1: 'Y', dorsal: 3, activo: true }) }), 'visualizacion-invalida'],
      [mod((c) => { c.visualizacion.jugadores[0].dorsal = 100 }), 'visualizacion-invalida'],
      [mod((c) => { c.visualizacion.jugadores[0].fechaNacimiento = '2015-01-01' }), 'visualizacion-invalida'],
      [mod((c) => { delete c.visualizacion }), 'visualizacion-ausente'],
    ]
    for (const [c, motivo] of casos) expect(await actualizarVisualizacion(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: c, ctx })).toMatchObject({ ok: false, motivo })
    expect(JSON.stringify(await t.leer())).toBe(antes)
  })
})
