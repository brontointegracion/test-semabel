import { afterEach, describe, expect, it } from 'vitest'
import { DURACIONES } from '../src/acceso/config.js'
import { revocarCredencial } from '../src/control.js'
import { T0, Telefono, conteos } from './ayuda.js'
import {
  activar, control, emitirCodigoDePartido, enLiga, escenarioDeCodigos, tokenDeTelefono,
} from './ayuda-acceso.js'

const H = 60 * 60 * 1000
const DIA = 24 * H
const GENERICO = { error: 'no-autorizado' }
const FALTA = { equipoId: 'E1', jugadorId: 'J1' }
afterEach(() => { control.ahoraMs = null })

/** Partido activado en `tA`, iniciado a tA + 1 s, con una falta aceptada y una orden rechazada de forma definitiva. */
async function enJuego(tA = T0) {
  const e = await escenarioDeCodigos({ ahora: tA })
  control.ahoraMs = tA
  const emitido = await emitirCodigoDePartido(e.cookie, e.ligaId)
  const { token, tokenHash } = await tokenDeTelefono()
  const act = await activar(e.ligaId, 'P', emitido.codigo, tokenHash)
  const tel = new Telefono(e.ligaId, 'P', { token, deviceId: act.cuerpo.deviceId })
  control.ahoraMs = tA + 1000
  const inicio = await tel.mandar('iniciar-partido', {}, { t: tA + 1000 })
  control.ahoraMs = tA + 2000
  const aceptada = await tel.mandar('falta', FALTA, { t: tA + 2000 })
  const rechazada = await tel.mandar('falta', { equipoId: 'E1', jugadorId: 'JX' }, { t: tA + 3000 }) // ficha inactiva
  expect([inicio.cuerpo.resultado, aceptada.cuerpo.resultado, rechazada.cuerpo.resultado]).toEqual(['aceptado', 'aceptado', 'rechazado'])
  return { ...e, tel, token, tokenHash, tA, inicio, aceptada, rechazada }
}

const credencial = (ligaId) => enLiga(ligaId, (inst) => inst.almacen.sql.exec('SELECT * FROM credenciales').one())
const reintento = async (x, previa) => { const r = await x.tel.enviar(previa.sobre); return { status: r.status, cuerpo: await r.json() } }
const recientes = (x, t) => x.tel.mandar('falta', FALTA, { t })

describe('Activa → solo recibos → vencida, con el reloj determinista', () => {
  it('antes de las 72 h procesa comandos nuevos; en el instante exacto de las 72 h ya no', async () => {
    const x = await enJuego()
    const limite = x.tA + DURACIONES.credencialActiva
    control.ahoraMs = limite - 1
    expect((await recientes(x, limite - 1)).cuerpo.resultado).toBe('aceptado')
    const antes = await conteos(x.ligaId, 'P')
    control.ahoraMs = limite
    const nueva = await recientes(x, limite)
    expect(nueva).toMatchObject({ respuesta: { status: 401 }, cuerpo: GENERICO })
    expect(await conteos(x.ligaId, 'P')).toEqual(antes) // nada se escribe ni se consume
  })

  it('en la ventana de solo recibos: el reintento EXACTO de lo aceptado y de lo rechazado de forma definitiva devuelve el recibo original', async () => {
    const x = await enJuego()
    control.ahoraMs = x.tA + DURACIONES.credencialActiva + 3 * DIA
    for (const previa of [x.inicio, x.aceptada, x.rechazada]) {
      const r = await reintento(x, previa)
      expect(r.status).toBe(200)
      expect(r.cuerpo.resultado).toBe('recibo-existente')
      expect(r.cuerpo.recibo).toEqual(previa.cuerpo.recibo)
    }
  })

  it('en esa ventana un sobre desconocido, o uno distinto con el mismo cmdId, recibe el 401 genérico (ni conflicto ni recibo)', async () => {
    const x = await enJuego()
    control.ahoraMs = x.tA + DURACIONES.credencialActiva + DIA
    const antes = await conteos(x.ligaId, 'P')
    const distinto = { ...x.aceptada.sobre, datos: { ...x.aceptada.sobre.datos, jugadorId: 'J2' } }
    const r1 = await x.tel.enviar(distinto)
    expect(r1.status).toBe(401)
    expect(await r1.json()).toEqual(GENERICO)
    const desconocido = await x.tel.sobre('falta', FALTA, { t: control.ahoraMs })
    const r2 = await x.tel.enviar(desconocido)
    expect(r2.status).toBe(401)
    expect(await r2.json()).toEqual(GENERICO)
    expect(await conteos(x.ligaId, 'P')).toEqual(antes)
  })

  it('el horizonte de recuperación termina a los 7 días extra: 1 ms antes sirve, en el instante exacto no', async () => {
    const x = await enJuego()
    const fin = x.tA + DURACIONES.credencialActiva + DURACIONES.credencialSoloRecibos
    control.ahoraMs = fin - 1
    expect((await reintento(x, x.aceptada)).cuerpo.resultado).toBe('recibo-existente')
    control.ahoraMs = fin
    expect(await reintento(x, x.aceptada)).toEqual({ status: 401, cuerpo: GENERICO })
    expect(await reintento(x, x.inicio)).toEqual({ status: 401, cuerpo: GENERICO })
  })

  it('una credencial revocada no sirve ni siquiera para recuperar recibos, dentro de cualquiera de las dos ventanas', async () => {
    for (const desplazamiento of [DURACIONES.credencialActiva - 1, DURACIONES.credencialActiva + 2 * DIA]) {
      const x = await enJuego()
      await enLiga(x.ligaId, (inst) => revocarCredencial(inst.almacen, x.tokenHash)) // revocación del operador sobre la base
      control.ahoraMs = x.tA + desplazamiento
      expect(await reintento(x, x.aceptada)).toEqual({ status: 401, cuerpo: GENERICO })
      expect(await activar(x.ligaId, 'P', 'AAAAA-AAAAA-AAAAA-AAAAA', x.tokenHash)).toMatchObject({ status: 401 })
    }
  })

  it('las expiraciones se cuentan desde la activación y no dependen de la hora, del día ni de la medianoche', async () => {
    const instantes = [T0, T0 + 23 * H + 59 * 60_000 + 59_999, Date.UTC(2026, 9, 18, 0, 0, 0, 0), Date.UTC(2026, 9, 17, 23, 59, 59, 999), Date.UTC(2026, 9, 24, 12, 34, 56, 789)]
    for (const tA of instantes) {
      const x = await enJuego(tA)
      const c = await credencial(x.ligaId)
      expect(c.expira_en - tA).toBe(72 * H)
      expect(c.retorno_hasta - c.expira_en).toBe(7 * DIA)
    }
  })

  it('el uso, el inicio, el final y los comandos no prolongan ni acortan la credencial', async () => {
    const x = await enJuego()
    const inicial = await credencial(x.ligaId)
    control.ahoraMs = x.tA + 10 * H
    await recientes(x, x.tA + 10 * H)
    await x.tel.mandar('cerrar-partido', {}, { t: x.tA + 11 * H })
    const final = await credencial(x.ligaId)
    expect(final).toEqual(inicial)
    expect(final.revocada).toBe(0)
  })
})

describe('el estado por tiempo se decide en la lectura protegida (no solo en la primera autorización)', () => {
  /** Detiene UNA vez la primera petición ya autorizada, antes de la lectura protegida. */
  function detenerTrasAutorizar() {
    let avisar
    const detenida = new Promise((r) => { avisar = r })
    let liberar
    const espera = new Promise((r) => { liberar = r })
    let usada = false
    control.pausaAut = async () => { if (usada) return; usada = true; avisar(); await espera }
    return { detenida, liberar }
  }
  const leerEnvio = (p) => p.then(async (r) => ({ status: r.status, cuerpo: await r.json() }))

  it('autorizada como ACTIVA justo antes del límite, pero el reloj cruza las 72 h antes de la lectura: una orden nueva no se procesa', async () => {
    const x = await enJuego()
    const limite = x.tA + DURACIONES.credencialActiva
    control.ahoraMs = limite - 1
    const sobre = await x.tel.sobre('falta', FALTA, { t: limite - 1 })
    const { detenida, liberar } = detenerTrasAutorizar()
    const envio = leerEnvio(x.tel.enviar(sobre))
    await detenida
    control.ahoraMs = limite
    liberar()
    expect(await envio).toEqual({ status: 401, cuerpo: GENERICO })
    expect((await conteos(x.ligaId, 'P')).recibos).toBe(3) // inicio + aceptada + rechazada: nada nuevo
  })

  it('en esa misma transición, el reintento EXACTO de un recibo guardado sí se contesta (pasa a solo recibos)', async () => {
    const x = await enJuego()
    const limite = x.tA + DURACIONES.credencialActiva
    control.ahoraMs = limite - 1
    const { detenida, liberar } = detenerTrasAutorizar()
    const envio = leerEnvio(x.tel.enviar(x.aceptada.sobre))
    await detenida
    control.ahoraMs = limite
    liberar()
    const r = await envio
    expect(r.status).toBe(200)
    expect(r.cuerpo.resultado).toBe('recibo-existente')
    expect(r.cuerpo.recibo).toEqual(x.aceptada.cuerpo.recibo)
  })

  it('autorizada como solo-recibos y vencida del todo antes de la lectura: ni el recibo exacto se devuelve', async () => {
    const x = await enJuego()
    const fin = x.tA + DURACIONES.credencialActiva + DURACIONES.credencialSoloRecibos
    control.ahoraMs = fin - 1
    const { detenida, liberar } = detenerTrasAutorizar()
    const envio = leerEnvio(x.tel.enviar(x.aceptada.sobre))
    await detenida
    control.ahoraMs = fin
    liberar()
    expect(await envio).toEqual({ status: 401, cuerpo: GENERICO })
  })
})

describe('Final del partido: no revoca y no amplía permisos', () => {
  it('tras el cierre sigue el comportamiento de siempre: puntos y reloj rechazados, correcciones permitidas, recibos recuperables', async () => {
    const x = await enJuego()
    control.ahoraMs = x.tA + 4000
    const cierre = await x.tel.mandar('cerrar-partido', {}, { t: x.tA + 4000 })
    expect(cierre.cuerpo.resultado).toBe('aceptado')
    const c = await credencial(x.ligaId)
    expect(c.revocada).toBe(0) // el final no revoca nada

    control.ahoraMs = x.tA + 5000
    const punto = await x.tel.mandar('anotar', { ...FALTA, puntos: 2 }, { t: x.tA + 5000 })
    expect(punto.cuerpo).toMatchObject({ resultado: 'rechazado' })
    expect(punto.cuerpo.recibo.motivo).toBe('partido-no-disponible')
    const reloj = await x.tel.mandar('arrancar-reloj', {}, { t: x.tA + 5500 })
    expect(reloj.cuerpo.recibo.motivo).toBe('partido-no-disponible')
    const deshacer = await x.tel.mandar('deshacer', {}, { t: x.tA + 6000 })
    expect(deshacer.cuerpo.resultado).toBe('aceptado') // las correcciones siguen, como hoy
    // los comandos aceptados antes del cierre se recuperan tras el final
    expect((await reintento(x, x.aceptada)).cuerpo.resultado).toBe('recibo-existente')
    expect((await reintento(x, cierre)).cuerpo.resultado).toBe('recibo-existente')
  })

  it('después del final, pasadas las 72 h, el puntaje nuevo ya no llega ni a ser rechazado: es el 401 genérico', async () => {
    const x = await enJuego()
    await x.tel.mandar('cerrar-partido', {}, { t: x.tA + 4000 })
    control.ahoraMs = x.tA + DURACIONES.credencialActiva
    const antes = await conteos(x.ligaId, 'P')
    const r = await x.tel.mandar('anotar', { ...FALTA, puntos: 2 }, { t: control.ahoraMs })
    expect(r.respuesta.status).toBe(401)
    expect(await conteos(x.ligaId, 'P')).toEqual(antes)
  })

  it('no existe forma de renovar: una activación nueva tras el final o el inicio no crea ningún controlador', async () => {
    const x = await enJuego()
    const emitir = await emitirCodigoDePartido(x.cookie, x.ligaId) // el partido ya empezó: no se puede emitir
    expect(emitir.status).toBe(409)
    const nuevo = await tokenDeTelefono()
    expect(await activar(x.ligaId, 'P', 'AAAAA-AAAAA-AAAAA-AAAAA', nuevo.tokenHash)).toMatchObject({ status: 401 })
    const activas = await enLiga(x.ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM credenciales WHERE revocada = 0').one().n)
    expect(activas).toBe(1)
  })
})

describe('credenciales sembradas o heredadas (sin expiración)', () => {
  it('siguen como antes: activas sin límite de tiempo (la suite anterior depende de ello)', async () => {
    const { ligaSembrada } = await import('./ayuda.js')
    const { ligaId, P } = await ligaSembrada((await import('./fixtures/sintetico.js')).nuevaLiga())
    control.ahoraMs = T0 + 1000 * DIA
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 * DIA })
    expect(r.cuerpo.resultado).toBe('aceptado')
    const c = await enLiga(ligaId, (inst) => inst.almacen.sql.exec("SELECT expira_en, retorno_hasta FROM credenciales WHERE partido_id = 'P'").one())
    expect(c).toEqual({ expira_en: null, retorno_hasta: null })
  })
})
