import { afterEach, describe, expect, it } from 'vitest'
import { env, exports } from 'cloudflare:workers'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, Telefono, dentro, ligaSembrada, sembrar } from './ayuda.js'

// REPORT_209 — COSTE DEL LADO DEL SERVIDOR de cada lectura pública que hace la televisión /tv/cancha, medido en workerd con
// almacenamiento sintético y aislado. Mide, por lectura: sentencias SQL ejecutadas y filas leídas/escritas (cursor.rowsRead /
// rowsWritten) DENTRO del objeto de liga, y las invocaciones de métodos RPC del objeto. NO es capacidad ni facturación de Cloudflare:
// solo cuenta lo que ESTE código hace por petición. Las cifras medidas (REPORT_209: lista 3 sentencias/20 filas; programado 5/5; en juego 12/17; final 5/5; una invocación
// por petición; cero escrituras) se acotan aquí con topes holgados para que un cambio que multiplique el coste falle.

const BASE = 'https://backend.local'
const get = (ruta) => exports.default.fetch(new Request(`${BASE}${ruta}`))

/**
 * Mide UNA petición HTTP real (Worker → objeto de liga): instala contadores en el almacenamiento del objeto, hace la petición y los lee.
 * rpc = invocaciones de los métodos de lectura del objeto (se cuentan en el prototipo, que es por donde entra el RPC).
 */
async function medido(ligaId, ruta) {
  const proto = await dentro(ligaId, (inst) => {
    const sql = inst.almacen.sql
    const original = sql.exec.bind(sql)
    const m = { sentencias: 0, filasLeidas: 0, filasEscritas: 0 }
    sql.exec = (...a) => {
      const cursor = original(...a)
      m.sentencias += 1
      for (const nombre of ['toArray', 'one']) {
        const f = cursor[nombre].bind(cursor)
        cursor[nombre] = (...x) => { const r = f(...x); m.filasLeidas += cursor.rowsRead; m.filasEscritas += cursor.rowsWritten; return r }
      }
      return cursor
    }
    globalThis.__medidaTv = { m, original, sql }
    return Object.getPrototypeOf(inst)
  })
  let rpc = 0
  const originales = ['leerPublico', 'leerPublicoLiga'].map((k) => [k, proto[k]])
  for (const [k, f] of originales) proto[k] = function (...a) { rpc += 1; return f.apply(this, a) }
  let estado
  try { estado = (await get(ruta)).status } finally { for (const [k, f] of originales) proto[k] = f }
  const m = await dentro(ligaId, () => { const { m: medida, original, sql } = globalThis.__medidaTv; sql.exec = original; delete globalThis.__medidaTv; return medida })
  return { ...m, rpc, estado }
}

describe('coste por lectura pública de la televisión (sentencias SQL y filas, por petición)', () => {
  it('lista de la liga (5 partidos), partido programado, en juego (con 6 canastas reconocibles) y final: sentencias y filas acotadas, SOLO lecturas', async () => {
    const ligaId = nuevaLiga()
    const p = payloadDeLiga(ligaId)
    p.partidos = ['G1', 'G2', 'G3', 'G4', 'G5'].map((id, i) => ({ id, localId: i % 2 ? 'E3' : 'E1', visitaId: i % 2 ? 'E4' : 'E2', inicio: null }))
    p.credenciales = p.partidos.map((g) => ({ token: `tok-sintetico-${g.id}-${ligaId}-0001`, partidoId: g.id, deviceId: `tel-${g.id}`, actorId: `actor-${g.id}` }))
    expect((await sembrar(ligaId, p)).status).toBe(201)
    const vivo = new Telefono(ligaId, 'G2'); const fin = new Telefono(ligaId, 'G3')
    await vivo.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await vivo.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    for (let i = 0; i < 8; i += 1) await vivo.mandar('anotar', { equipoId: 'E3', jugadorId: 'K1', puntos: 2 }, { t: T0 + 3000 + i * 10 })
    await fin.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await fin.mandar('detener-reloj', {}, { t: T0 + 2000 }).catch(() => {})
    await fin.mandar('cerrar-partido', {}, { t: T0 + 3000 })
    const L = `/v1/ligas/${ligaId}`
    const casos = { lista: `${L}/publico`, programado: `${L}/partidos/G1`, enJuego: `${L}/partidos/G2`, final: `${L}/partidos/G3` }
    const r = {}
    for (const [k, ruta] of Object.entries(casos)) {
      r[k] = await medido(ligaId, ruta)
      expect(r[k].estado, ruta).toBe(200)
    }
    for (const v of Object.values(r)) { expect(v.rpc).toBe(1); expect(v.filasEscritas).toBe(0) } // una invocación del objeto por petición y NINGUNA escritura
    expect(r.lista.sentencias).toBeLessThanOrEqual(4)
    expect(r.programado.sentencias).toBeLessThanOrEqual(5)
    expect(r.final.sentencias).toBeLessThanOrEqual(5)
    // el partido en juego añade UNA consulta acotada a las canastas (LIMIT 6) y a lo sumo 6 lecturas de ficha
    expect(r.enJuego.sentencias).toBeLessThanOrEqual(r.programado.sentencias + 1 + 6)
    expect(r.enJuego.filasLeidas).toBeLessThan(200)
  })
})
