import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { crearControlador } from '../../src/lib/control/sesion-controlador.js'
import { abrirAlmacen, leerSesion } from '../../src/lib/control/sesion-almacen.js'
import { navegadorFalso } from '../../src/lib/control/prueba/auxiliares-controlador.js'
import { relojVirtual } from '../../src/lib/control/prueba/auxiliares-emisor.js'
import { revocarCredencial } from '../src/control.js'
import { sha256Hex } from '../src/credenciales.js'
import { tokenDe } from './fixtures/sintetico.js'
import { dentro } from './ayuda.js'
import { control } from './ayuda-acceso.js'
import { escenarioPlantilla } from './ayuda-plantilla.js'

// REPORT_130: el CONTROLADOR real (recuperación explícita de la parada 401) frente al Worker REAL en workerd, con la credencial
// sintética real. Un 401 se fabrica en el cliente (la orden SÍ llega al Worker: se pierde la respuesta). Se comprueba lo que el
// Worker real hace con la misma credencial: vigente → reanuda; revocada, vencida o «solo recibos» → /estado responde 401 y la parada queda.

const BASE = 'https://backend.local'
const SERVIDOR = 1_700_000_000_000 + 10_000_000
const H = 3_600_000
afterEach(() => { control.ahoraMs = null; control.limitesEstado = null })

let n = 0
let c = 0
const cmd = (p) => `${p}-rec-${++c}`
const tick = () => new Promise((r) => setTimeout(r, 0))
const asentar = async () => { for (let i = 0; i < 25; i += 1) await tick() }
const fetchReal = (url, init) => exports.default.fetch(new Request(`${BASE}${url}`, { method: init.method, headers: init.headers, body: init.body }))
const PUNTO = (cmdId) => ({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId })

async function escenario() {
  const e = await escenarioPlantilla()
  const ligaId = e.ligaId
  const token = tokenDe(ligaId, 'P')
  control.ahoraMs = SERVIDOR
  const nav = navegadorFalso()
  const rv = relojVirtual()
  const almacen = await abrirAlmacen({ nombre: `rec401-${++n}-${Math.random().toString(36).slice(2)}` })
  const red = { enLinea: true, oyentes: new Set() }
  const llamadas = []
  let perderPrimerComando = false
  const fetchImpl = async (url, init) => {
    const esComando = url.endsWith('/comandos')
    llamadas.push({ url, cuerpo: init?.body ?? null, metodo: init?.method ?? 'GET' })
    if (!red.enLinea) throw new TypeError('sin conexión')
    const r = await fetchReal(url, init)
    if (esComando && perderPrimerComando) {
      perderPrimerComando = false
      return new Response(JSON.stringify({ error: 'no-autorizado' }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } }) // la orden llegó; la respuesta se «pierde»
    }
    return r
  }
  const ctl = crearControlador({
    ligaId, partidoId: 'P', almacen, locks: nav.locks, canal: null,
    obtenerIdentidad: () => ({ token, deviceId: 'tel-P' }),
    conexion: { enLinea: () => red.enLinea, alCambiar: (cb) => { red.oyentes.add(cb); return () => red.oyentes.delete(cb) } },
    visibilidad: null,
    lectura: () => ({ paredMs: SERVIDOR + Math.round(rv.mono), monoMs: Math.round(rv.mono), sesionId: 'pagina-rec' }),
    fetchImpl, setTimeoutImpl: rv.setTimeoutImpl, clearTimeoutImpl: rv.clearTimeoutImpl, azar: () => 0.5, ahora: () => SERVIDOR, monoAhora: rv.monoAhora,
  })
  const t = {
    e, ligaId, token, almacen, ctl, llamadas, rv, red,
    leer: () => leerSesion(almacen, `${ligaId}:P`, { ahoraEstimado: SERVIDOR, actorId: 'x', enLinea: true, ahora: SERVIDOR }),
    perderElPrimerComando() { perderPrimerComando = true },
    conectar() { red.enLinea = true; for (const cb of [...red.oyentes]) cb(true) },
    desconectar() { red.enLinea = false; for (const cb of [...red.oyentes]) cb(false) },
    async reposo() { for (let i = 0; i < 80; i += 1) { await tick(); await ctl.reposo(); if (rv.timers.length) rv.dispararSiguiente() } await asentar() },
    traza: () => llamadas.map((l) => (l.url.endsWith('/comandos') ? `P:${JSON.parse(l.cuerpo).cmdId}` : l.url.endsWith('/estado') ? 'E' : l.url.endsWith('/preparacion') ? 'R' : 'M')).filter((x) => x !== 'M'),
  }
  await ctl.abrir()
  const ini = await ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
  expect(ini.ok, JSON.stringify(ini)).toBe(true)
  await t.reposo()
  expect((await t.leer()).sesion.inicio).toBe('confirmado')
  // tres puntos guardados sin red; al volver, el primero llega al Worker y se pierde la respuesta (401 fabricado)
  t.desconectar()
  t.ids = []
  for (let i = 0; i < 3; i += 1) { const id = cmd(`p${i}`); t.ids.push(id); expect((await ctl.registrar(PUNTO(id))).ok).toBe(true) }
  t.perderElPrimerComando()
  t.conectar()
  await t.reposo()
  const l = await t.leer()
  expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', clase: 'no-autorizado', http: 401, cmdId: t.ids[0] })
  expect(l.entradas.slice(1).map((x) => x.estado)).toEqual(['enviando', 'pendiente', 'pendiente'])
  return t
}
const CONFIRMA = { confirmadoPorOperador: true }

describe('recuperación del 401 contra el Worker real', () => {
  it('credencial vigente: la repetición idéntica obtiene el recibo-existente del Worker, /estado prueba la autorización y se reanuda en orden', async () => {
    const t = await escenario()
    const n0 = t.traza().length
    const r = await t.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, reanudada: true })
    await t.reposo()
    // (tras vaciarse la cola, la verificación automática de REPORT_129 añade una lectura final; no forma parte de la recuperación)
    expect(t.traza().slice(n0, n0 + 4)).toEqual([`P:${t.ids[0]}`, 'E', `P:${t.ids[1]}`, `P:${t.ids[2]}`])
    const l = await t.leer()
    expect(l.sesion.detenida).toBeNull()
    expect(l.entradas.map((x) => x.estado)).toEqual(['confirmada', 'confirmada', 'confirmada', 'confirmada'])
    expect(l.entradas[1].intentos).toBe(2) // el mismo sobre, un intento más
    await t.ctl.cerrar()
  }, 60_000)

  it('credencial REVOCADA: ni la repetición ni /estado la reanudan; la parada y las órdenes quedan', async () => {
    const t = await escenario()
    const antes = (await t.leer()).entradas.map((x) => [x.cmdId, x.cuerpoJson, x.estado])
    const hash = await sha256Hex(t.token)
    await dentro(t.ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    const n0 = t.traza().length
    const r = await t.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r).toMatchObject({ ok: false, motivo: 'resultado-desconocido' })
    await asentar()
    const l = await t.leer()
    expect(l.sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    expect(l.entradas.map((x) => [x.cmdId, x.cuerpoJson])).toEqual(antes.map(([a, b]) => [a, b]))
    expect(l.entradas.slice(2).map((x) => x.estado)).toEqual(['pendiente', 'pendiente'])
    expect(t.traza().slice(n0).filter((x) => x === 'E')).toHaveLength(0)
    await t.ctl.cerrar()
  }, 60_000)

  it('credencial VENCIDA o «solo recibos»: el Worker repite el recibo de la orden ya aceptada pero /estado responde 401; NO se reanuda y las dependientes no salen', async () => {
    for (const [expira, retorno] of [[SERVIDOR - 10_000, SERVIDOR + 7 * 24 * H], [SERVIDOR - 10_000, null], [SERVIDOR - 10_000, SERVIDOR - 5_000]]) {
      const t = await escenario()
      await dentro(t.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", expira, retorno).toArray())
      const n0 = t.traza().length
      const r = await t.ctl.recuperarDeNoAutorizado(CONFIRMA)
      expect(r.ok, JSON.stringify([expira, retorno, r])).toBe(false)
      await asentar()
      const l = await t.leer()
      expect(l.sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
      expect(l.entradas.slice(2).map((x) => x.estado)).toEqual(['pendiente', 'pendiente'])
      expect(t.traza().slice(n0).filter((x) => x === `P:${t.ids[1]}` || x === `P:${t.ids[2]}`)).toHaveLength(0)
      if (retorno !== null && retorno > SERVIDOR) {
        // solo recibos: la orden incierta SÍ se resolvió por repetición (recibo-existente) y aun así no se reanuda
        expect(l.entradas[1].estado).toBe('confirmada')
        expect(r.motivo).toBe('no-autorizado')
      }
      await t.ctl.cerrar()
    }
  }, 60_000)

  it('credencial de OTRO dispositivo en la activación: no se hace ninguna petición', async () => {
    const t = await escenario()
    await t.ctl.cerrar()
    const nav = navegadorFalso()
    const rv = relojVirtual()
    const llamadas = []
    const ctl = crearControlador({
      ligaId: t.ligaId, partidoId: 'P', almacen: t.almacen, locks: nav.locks, canal: null,
      obtenerIdentidad: () => ({ token: t.token, deviceId: 'tel-OTRO' }),
      conexion: { enLinea: () => true, alCambiar: () => () => {} }, visibilidad: null,
      lectura: () => ({ paredMs: SERVIDOR, monoMs: Math.round(rv.mono), sesionId: 'pagina-rec-2' }),
      fetchImpl: async (url, init) => { llamadas.push(url); return fetchReal(url, init) }, setTimeoutImpl: rv.setTimeoutImpl, clearTimeoutImpl: rv.clearTimeoutImpl, ahora: () => SERVIDOR, monoAhora: rv.monoAhora,
    })
    await ctl.abrir()
    expect(await ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false })
    expect(llamadas.filter((u) => u.endsWith('/comandos') || u.endsWith('/estado'))).toHaveLength(0)
    expect((await t.leer()).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    await ctl.cerrar()
  }, 60_000)
})
