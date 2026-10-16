import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOLERANCIA_RELOJ_MS, VENTANA_ASERCION_MS } from '../src/acceso/config.js'
import { T0 } from './ayuda.js'
import {
  accesoStub, comoOrganizador, control, emitirCodigoDePartido, enLiga, escenarioDeCodigos, ligaStub, pedir, conCookie, cabecerasEscritura,
} from './ayuda-acceso.js'

// ORDEN ENTRE DOS OBJETOS. El objeto de acceso (sesiones) y el de liga (datos) no comparten transacción: aquí se
// comprueba lo que SÍ se garantiza y se deja escrito lo que NO. Punto de decisión = la lectura de validación en el
// objeto de acceso; la hora de esa lectura se comprueba como primera sentencia de la mutación en el objeto de liga.

const GENERICO = { error: 'no-autorizado' }
let e
beforeEach(async () => { e = await escenarioDeCodigos() })
afterEach(() => { control.ahoraMs = null; control.desfasesAcceso = null })

const validar = () => accesoStub().validarSesion({ cookie: e.cookie })
const crearCodigo = (asercion) => ligaStub(e.ligaId).crearCodigoPartido({ asercion, ligaId: e.ligaId, partidoId: 'P' })
const filasDeCodigos = () => enLiga(e.ligaId, (inst) => inst.almacen.sql.exec(
  "SELECT (SELECT COUNT(*) FROM codigos_partido) AS c, (SELECT COUNT(*) FROM auditoria_acceso WHERE tipo = 'codigo-partido-emitido') AS a",
).one())

describe('la afirmación y su ventana', () => {
  it('cada validación entrega la hora del objeto de acceso, las ligas propias y la sesión', async () => {
    const a = await validar()
    expect(a).toMatchObject({ organizadorId: e.organizadorId, ligas: [e.ligaId], validadoEn: T0 })
    expect(a.sesionId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('una revocación confirmada ANTES de la lectura de validación la niega', async () => {
    const a = await validar()
    await accesoStub().cerrarSesion({ sesionId: a.sesionId })
    expect(await validar()).toBeNull()
  })

  it('VARIAS peticiones validadas antes de la revocación pueden terminar dentro de la ventana (no solo una), y queda su rastro', async () => {
    const validadas = [await validar(), await validar(), await validar()]
    control.ahoraMs = T0 + 1000
    await accesoStub().cerrarSesion({ sesionId: validadas[0].sesionId })
    expect(await validar()).toBeNull() // lo nuevo ya no pasa
    control.ahoraMs = T0 + VENTANA_ASERCION_MS - 1 // 4999 ms después de validarse
    for (const a of validadas) expect((await crearCodigo(a)).tipo).toBe('ok') // las ya validadas terminan: no hay atomicidad entre objetos
    const rastro = await enLiga(e.ligaId, (inst) => inst.almacen.sql.exec("SELECT sesion_id FROM auditoria_acceso WHERE tipo = 'codigo-partido-emitido'").toArray())
    expect(rastro).toHaveLength(3)
    expect(new Set(rastro.map((r) => r.sesion_id))).toEqual(new Set([validadas[0].sesionId])) // identificables en la auditoría
  })

  it('la ventana es de 5 s: en el instante exacto aún vale; 1 ms después, no, y no se escribe NADA', async () => {
    const a = await validar()
    control.ahoraMs = T0 + VENTANA_ASERCION_MS
    expect((await crearCodigo(a)).tipo).toBe('ok')
    const antes = await filasDeCodigos()
    control.ahoraMs = T0 + VENTANA_ASERCION_MS + 1
    expect(await crearCodigo(a)).toEqual({ tipo: 'asercion-vencida' })
    expect(await filasDeCodigos()).toEqual(antes) // ni código, ni auditoría, ni revocación de los anteriores
  })

  it('una validación "del futuro" se tolera hasta 1 s de diferencia entre relojes; más, no', async () => {
    const a = await validar()
    control.ahoraMs = T0 - TOLERANCIA_RELOJ_MS
    expect((await crearCodigo(a)).tipo).toBe('ok')
    control.ahoraMs = T0 - TOLERANCIA_RELOJ_MS - 1
    expect(await crearCodigo(a)).toEqual({ tipo: 'asercion-vencida' })
  })

  it('la hora de la afirmación se comprueba antes de leer o escribir: con partido iniciado o inexistente, una vencida da vencida', async () => {
    const a = await validar()
    control.ahoraMs = T0 + 60_000
    expect(await ligaStub(e.ligaId).crearCodigoPartido({ asercion: a, ligaId: e.ligaId, partidoId: 'NO-EXISTE' })).toEqual({ tipo: 'asercion-vencida' })
    expect(await ligaStub(e.ligaId).revocarControlDePartido({ asercion: a, ligaId: e.ligaId, partidoId: 'P' })).toEqual({ tipo: 'asercion-vencida' })
    expect(await ligaStub(e.ligaId).estadoControlDePartido({ asercion: a, ligaId: e.ligaId, partidoId: 'P' })).toEqual({ tipo: 'asercion-vencida' })
  })

  it('afirmaciones mal formadas, de otra liga o inventadas no valen (no-autorizado), sin escribir', async () => {
    const a = await validar()
    const antes = await filasDeCodigos()
    const malas = [
      undefined, null, 'x', {}, { ...a, organizadorId: 7 }, { ...a, sesionId: null }, { ...a, ligas: 'no-lista' },
      { ...a, ligas: ['otra-liga'] }, { ...a, validadoEn: 'ahora' }, { ...a, validadoEn: NaN }, { ...a, validadoEn: undefined },
    ]
    for (const m of malas) expect(await crearCodigo(m), JSON.stringify(m)).toEqual({ tipo: 'no-autorizado' })
    expect(await filasDeCodigos()).toEqual(antes)
  })
})

describe('por HTTP: una revalidación como máximo', () => {
  it('si la primera afirmación llega vencida por desfase de relojes, se revalida una vez y la operación sigue', async () => {
    control.desfasesAcceso = [-(VENTANA_ASERCION_MS + 1000)] // solo la primera lectura del objeto de acceso va atrasada
    const r = await emitirCodigoDePartido(e.cookie, e.ligaId)
    expect(r.status).toBe(200)
    expect(r.codigo).toBeTruthy()
    expect(control.desfasesAcceso).toHaveLength(0) // se consumieron exactamente las lecturas previstas
  })

  it('si vuelve a llegar vencida no hay un tercer intento: 503 conocido sin escritura, y no se escribió nada', async () => {
    const antes = await filasDeCodigos()
    control.desfasesAcceso = [-(VENTANA_ASERCION_MS + 1000), -(VENTANA_ASERCION_MS + 1000), -(VENTANA_ASERCION_MS + 1000)]
    const r = await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/codigo`)
    expect(r.status).toBe(503)
    expect(r.cuerpo).toMatchObject({ tipo: 'fallo-sin-escritura', motivo: 'asercion-vencida', reintento: 'mismo-sobre' })
    expect(control.desfasesAcceso).toHaveLength(1) // solo dos lecturas: la original y UNA revalidación
    expect(await filasDeCodigos()).toEqual(antes)
  })

  it('si la sesión se revocó entre la primera validación y la revalidación, esa revalidación la niega (401)', async () => {
    // El desfase hace caducar la primera afirmación; antes de revalidar, la sesión ya está cerrada.
    const a = await validar()
    await accesoStub().cerrarSesion({ sesionId: a.sesionId })
    control.desfasesAcceso = [-(VENTANA_ASERCION_MS + 1000)]
    expect(await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/codigo`)).toMatchObject({ status: 401, cuerpo: GENERICO })
  })

  it('el cliente no puede aportar su propia afirmación, hora ni identidad', async () => {
    const forjada = { organizadorId: 'org-falso', sesionId: 'x', ligas: [e.ligaId], validadoEn: T0 }
    const r = await pedir('POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/codigo`, {
      cuerpo: { asercion: forjada, validadoEn: T0, organizadorId: 'org-falso', ahora: T0 }, cabeceras: cabecerasEscritura(),
    })
    expect(r).toMatchObject({ status: 401, cuerpo: GENERICO })
    // y con una sesión real, los campos inventados del cuerpo se ignoran
    const real = await pedir('POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/codigo`, {
      cuerpo: { asercion: forjada, organizadorId: 'org-falso' }, cabeceras: conCookie(e.cookie, cabecerasEscritura()),
    })
    expect(real.status).toBe(200)
    const quien = await enLiga(e.ligaId, (inst) => inst.almacen.sql.exec("SELECT organizador_id FROM auditoria_acceso WHERE tipo = 'codigo-partido-emitido'").one())
    expect(quien.organizador_id).toBe(e.organizadorId)
  })
})
