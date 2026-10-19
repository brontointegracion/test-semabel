import { afterEach, describe, expect, it } from 'vitest'
import { T0, Telefono, conteos, sembrar, sqlDe } from './ayuda.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import {
  activar, cabecerasEscritura, comoOrganizador, conCookie, control, emitirCodigoDePartido, enLiga, escenarioDeCodigos, pedir, tokenDeTelefono,
} from './ayuda-acceso.js'

// REPORT_181 — contrato REAL del retiro del acceso del teléfono antes del inicio (POST …/control/revocar), con el servidor de verdad.
// Ningún código ni token se imprime: las pruebas solo comparan estados.

afterEach(() => { control.ahoraMs = null; control.pausaAut = null; control.pausa = null })
const GENERICO = { error: 'no-autorizado' }
const RUTA = (l) => `/v1/organizador/ligas/${l}/partidos/P/control/revocar`
const CONTROL = (l) => `/v1/organizador/ligas/${l}/partidos/P/control`

async function activado(e) {
  const emitido = await emitirCodigoDePartido(e.cookie, e.ligaId)
  const { token, tokenHash } = await tokenDeTelefono()
  const act = await activar(e.ligaId, 'P', emitido.codigo, tokenHash)
  expect(act.status).toBe(200)
  return { emitido, token, tokenHash, act, tel: new Telefono(e.ligaId, 'P', { token, deviceId: act.cuerpo.deviceId }) }
}
const filas = (ligaId) => enLiga(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return {
    credenciales: sql.exec('SELECT token_hash, revocada FROM credenciales ORDER BY token_hash').toArray(),
    codigos: sql.exec('SELECT id, consumido_en, revocado_en FROM codigos_partido ORDER BY id').toArray(),
    version: sql.exec("SELECT version_autorizacion AS v FROM partidos WHERE id = 'P'").one().v,
    auditoria: sql.exec('SELECT COUNT(*) AS n FROM auditoria_acceso').one().n,
    controlRevocado: sql.exec("SELECT COUNT(*) AS n FROM auditoria_acceso WHERE tipo = 'control-revocado'").one().n,
  }
})

describe('autorización y CSRF de la ruta de retiro', () => {
  it('sin sesión, con una liga que no es del organizador, sin cabecera de petición, con otro origen o con otro método: nada cambia', async () => {
    const e = await escenarioDeCodigos()
    const x = await activado(e)
    const ajena = nuevaLiga()
    expect((await sembrar(ajena, { ...payloadDeLiga(ajena), credenciales: [] })).status).toBe(201)
    const antes = await filas(e.ligaId)
    expect(await comoOrganizador(null, 'POST', RUTA(e.ligaId))).toMatchObject({ status: 401, cuerpo: GENERICO }) // sin cookie
    expect(await comoOrganizador(e.cookie, 'POST', RUTA(ajena))).toMatchObject({ status: 401, cuerpo: GENERICO }) // liga que el organizador no posee
    expect((await pedir('POST', RUTA(e.ligaId), { cuerpo: {}, cabeceras: conCookie(e.cookie, cabecerasEscritura({ 'x-sebel-peticion': '0' })) })).status).toBe(403)
    expect((await pedir('POST', RUTA(e.ligaId), { cuerpo: {}, cabeceras: conCookie(e.cookie, cabecerasEscritura({ origin: 'https://otro.ejemplo' })) })).status).toBe(403)
    expect((await pedir('POST', RUTA(e.ligaId), { cuerpo: {}, cabeceras: conCookie(e.cookie, cabecerasEscritura({ 'sec-fetch-site': 'cross-site' })) })).status).toBe(403)
    expect([404, 405]).toContain((await comoOrganizador(e.cookie, 'GET', RUTA(e.ligaId))).status)
    expect((await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${e.ligaId}/partidos/NO-EXISTE/control/revocar`)).status).toBe(404)
    expect(await filas(e.ligaId)).toEqual(antes) // ni credenciales, ni códigos, ni versión, ni auditoría
    expect((await x.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado') // y el teléfono sigue controlando
  })
})

describe('efectos del retiro antes del inicio', () => {
  it('revoca la activación y los códigos sin usar en UNA transacción, sube la versión de autorización, y el estado lo muestra sin secretos', async () => {
    const e = await escenarioDeCodigos()
    const x = await activado(e)
    const otro = await emitirCodigoDePartido(e.cookie, e.ligaId) // un código sin usar emitido mientras había un teléfono activo
    expect(otro.status).toBe(200)
    const antes = await filas(e.ligaId)
    const r = await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, credencialesRevocadas: 1 } })
    const despues = await filas(e.ligaId)
    expect(despues.credenciales.every((c) => c.revocada === 1)).toBe(true)
    expect(despues.codigos.every((c) => c.revocado_en !== null || c.consumido_en !== null)).toBe(true) // ningún código sin usar queda vivo
    expect(despues.version).toBe(antes.version + 1)
    expect(despues.controlRevocado).toBe(antes.controlRevocado + 1)
    const estado = await comoOrganizador(e.cookie, 'GET', CONTROL(e.ligaId))
    expect(estado.cuerpo).toMatchObject({ partido: 'programado', credencial: 'ninguna', codigoPendiente: false })
    expect(JSON.stringify(estado.cuerpo)).not.toMatch(/token|hash|secreto/i)
    // el código que ya usó el teléfono no sirve para recuperar la activación
    expect(await activar(e.ligaId, 'P', x.emitido.codigo, x.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
  })

  it('REPETIR el retiro es inofensivo pero NO es una no-operación pura: responde 200 con 0 revocadas, no cambia credenciales, códigos ni versión, y deja otra fila de auditoría', async () => {
    const e = await escenarioDeCodigos()
    await activado(e)
    expect((await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))).cuerpo.credencialesRevocadas).toBe(1)
    const tras1 = await filas(e.ligaId)
    const r2 = await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))
    expect(r2).toMatchObject({ status: 200, cuerpo: { ok: true, credencialesRevocadas: 0 } })
    const tras2 = await filas(e.ligaId)
    expect(tras2.credenciales).toEqual(tras1.credenciales)
    expect(tras2.codigos).toEqual(tras1.codigos)
    expect(tras2.version).toBe(tras1.version)
    expect(tras2.auditoria).toBe(tras1.auditoria + 1) // la única diferencia observable
  })

  it('sin ningún teléfono activado también responde 200 con 0 (no hay nada que retirar); anula un código sin usar', async () => {
    const e = await escenarioDeCodigos()
    expect((await emitirCodigoDePartido(e.cookie, e.ligaId)).status).toBe(200)
    expect(await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))).toMatchObject({ status: 200, cuerpo: { credencialesRevocadas: 0 } })
    expect((await comoOrganizador(e.cookie, 'GET', CONTROL(e.ligaId))).cuerpo).toMatchObject({ codigoPendiente: false, credencial: 'ninguna' })
  })
})

describe('sustitución del teléfono: un solo controlador', () => {
  it('A revocado no puede iniciar ni recuperar; código nuevo explícito; B activa, inicia y puntúa; A sigue sin poder; solo hay UNA credencial activa', async () => {
    const e = await escenarioDeCodigos()
    const a = await activado(e)
    expect((await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))).cuerpo.credencialesRevocadas).toBe(1)
    // A: ni Start nuevo ni recuperación
    const sobreA = await a.tel.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    expect((await a.tel.enviar(sobreA)).status).toBe(401)
    expect(await conteos(e.ligaId, 'P')).toMatchObject({ recibos: 0, eventos: 0, rev: 0 })
    // nadie genera un código solo: sin emitir no se puede activar a B
    const b = await tokenDeTelefono()
    expect((await comoOrganizador(e.cookie, 'GET', CONTROL(e.ligaId))).cuerpo).toMatchObject({ credencial: 'ninguna', codigoPendiente: false })
    const nuevo = await emitirCodigoDePartido(e.cookie, e.ligaId) // acción explícita del organizador
    const actB = await activar(e.ligaId, 'P', nuevo.codigo, b.tokenHash)
    expect(actB.status).toBe(200)
    expect(actB.cuerpo.deviceId).not.toBe(a.act.cuerpo.deviceId)
    const telB = new Telefono(e.ligaId, 'P', { token: b.token, deviceId: actB.cuerpo.deviceId })
    expect((await telB.mandar('iniciar-partido', {}, { t: T0 + 2000 })).cuerpo.resultado).toBe('aceptado')
    expect((await telB.mandar('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 3000 })).cuerpo.resultado).toBe('aceptado')
    expect((await a.tel.enviar(await a.tel.sobre('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 4000 }))).status).toBe(401)
    const f = await filas(e.ligaId)
    expect(f.credenciales.filter((c) => c.revocada === 0)).toHaveLength(1)
  })

  it('un recibo guardado ANTES del retiro se conserva, pero el teléfono retirado ya no puede repetirlo (credencial revocada: ni siquiera recibos)', async () => {
    const e = await escenarioDeCodigos()
    const a = await activado(e)
    const sobre = await a.tel.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: 'version-que-no-es' }) // rechazo definitivo: guarda su recibo
    const resp = await a.tel.enviar(sobre)
    expect((await resp.json()).resultado).toBe('rechazado')
    const antes = await conteos(e.ligaId, 'P')
    expect(antes.recibos).toBe(1)
    await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))
    expect((await conteos(e.ligaId, 'P')).recibos).toBe(1) // el historial no se toca
    expect((await a.tel.enviar(sobre)).status).toBe(401) // el reintento exacto de A ya no se contesta
  })
})

describe('carrera entre el inicio y el retiro (contrato atómico real)', () => {
  it('el retiro llega DESPUÉS de leer la orden y ANTES de confirmarla: el inicio no se confirma (401), nada se escribe; el teléfono retirado no inicia', async () => {
    const e = await escenarioDeCodigos()
    const a = await activado(e)
    const sobre = await a.tel.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    let avisar; const leida = new Promise((r) => { avisar = r })
    let soltar; const espera = new Promise((r) => { soltar = r })
    let una = false
    control.pausa = async () => { if (una) return; una = true; avisar(); await espera }
    const envio = a.tel.enviar(sobre).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))
    await leida
    expect((await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))).cuerpo.credencialesRevocadas).toBe(1)
    soltar()
    expect(await envio).toEqual({ status: 401, cuerpo: GENERICO })
    expect(await conteos(e.ligaId, 'P')).toMatchObject({ recibos: 0, eventos: 0, rev: 0, seq: 0 })
    expect((await sqlDe(e.ligaId, "SELECT json_extract(estado_json,'$.partido.estado') AS s FROM partidos WHERE id = 'P'"))[0].s).toBe('programado')
  })

  it('el inicio se confirma PRIMERO: el retiro recibe 409, no cambia nada y el teléfono sigue controlando (no hay relevo a mitad del partido)', async () => {
    const e = await escenarioDeCodigos()
    const a = await activado(e)
    expect((await a.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    const antes = await filas(e.ligaId)
    expect(await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId))).toMatchObject({ status: 409, cuerpo: { error: 'partido-iniciado' } })
    expect(await filas(e.ligaId)).toEqual(antes)
    expect((await a.tel.mandar('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 2000 })).cuerpo.resultado).toBe('aceptado')
    expect((await comoOrganizador(e.cookie, 'GET', CONTROL(e.ligaId))).cuerpo).toMatchObject({ partido: 'vivo', credencial: 'activa' })
  })

  it('un reintento exacto de un inicio ya ACEPTADO sigue devolviendo su recibo; el retiro posterior es 409', async () => {
    const e = await escenarioDeCodigos()
    const a = await activado(e)
    const inicio = await a.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(inicio.cuerpo.resultado).toBe('aceptado')
    await comoOrganizador(e.cookie, 'POST', RUTA(e.ligaId)) // 409
    const otra = await (await a.tel.enviar(inicio.sobre)).json()
    expect(otra).toMatchObject({ resultado: 'recibo-existente', recibo: { cmdId: inicio.sobre.cmdId, resultado: 'aceptado' } })
  })
})
