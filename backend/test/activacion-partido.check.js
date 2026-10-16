import { afterEach, describe, expect, it } from 'vitest'
import { DURACIONES } from '../src/acceso/config.js'
import { sha256Hex } from '../src/credenciales.js'
import { T0, Telefono, conteos, fijarEstadoDePartido, leerPartido } from './ayuda.js'
import { otorgarCredencial } from '../src/control.js'
import {
  activar, comoOrganizador, control, emitirCodigoDePartido, enLiga, escenarioDeCodigos, pedir, tokenDeTelefono, volcarObjeto, ligaStub,
} from './ayuda-acceso.js'

const H = 60 * 60 * 1000
const GENERICO = { error: 'no-autorizado' }
afterEach(() => { control.ahoraMs = null; control.pausaAut = null })

/** Organizador con sesión, un código emitido y un teléfono que lo activó. */
async function activado({ tras = 0 } = {}) {
  const e = await escenarioDeCodigos()
  const emitido = await emitirCodigoDePartido(e.cookie, e.ligaId)
  const { token, tokenHash } = await tokenDeTelefono()
  control.ahoraMs = T0 + tras
  const act = await activar(e.ligaId, 'P', emitido.codigo, tokenHash)
  const tel = new Telefono(e.ligaId, 'P', { token, deviceId: act.cuerpo?.deviceId })
  return { ...e, emitido, token, tokenHash, act, tel }
}

const estadoDeCredenciales = (ligaId) => enLiga(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify({
    credenciales: sql.exec('SELECT * FROM credenciales ORDER BY token_hash').toArray(),
    codigos: sql.exec('SELECT * FROM codigos_partido ORDER BY id').toArray(),
    version: sql.exec("SELECT version_autorizacion AS v FROM partidos WHERE id = 'P'").one().v,
    auditoria: sql.exec('SELECT COUNT(*) AS n FROM auditoria_acceso').one().n,
  })
})

describe('emisión del código de partido', () => {
  it('se muestra una vez, caduca a las 48 h y solo se guarda su hash', async () => {
    const e = await escenarioDeCodigos()
    const r = await emitirCodigoDePartido(e.cookie, e.ligaId)
    expect(r.status).toBe(200)
    expect(r.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
    expect(r.cuerpo.expiraEn - T0).toBe(DURACIONES.codigoPartidoSinUsar)
    expect(r.respuesta.headers.get('cache-control')).toBe('no-store')
    const estado = await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${e.ligaId}/partidos/P/control`)
    expect(estado.cuerpo).toMatchObject({ partido: 'programado', codigoPendiente: true, credencial: 'ninguna' })
    expect(JSON.stringify(estado.cuerpo)).not.toContain(r.codigo.replaceAll('-', '').slice(5)) // el estado no lleva secretos
    expect(await volcarObjeto(ligaStub(e.ligaId))).not.toContain(r.codigo.replaceAll('-', '').slice(5))
  })

  it('un código nuevo revoca el que seguía sin usar', async () => {
    const e = await escenarioDeCodigos()
    const a = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const b = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const { tokenHash } = await tokenDeTelefono()
    expect((await activar(e.ligaId, 'P', a.codigo, tokenHash)).status).toBe(401)
    expect((await activar(e.ligaId, 'P', b.codigo, tokenHash)).status).toBe(200)
  })
})

describe('activación: un solo controlador', () => {
  it('el teléfono manda solo el hash de su token; el servidor guarda ese hash, un dispositivo nuevo y las expiraciones aprobadas', async () => {
    const x = await activado({ tras: 5000 })
    expect(x.act.status).toBe(200)
    expect(x.act.cuerpo).toEqual({ deviceId: expect.stringMatching(/^dev-[0-9a-f]{24}$/), partidoId: 'P' })
    expect(x.act.respuesta.headers.get('cache-control')).toBe('no-store')
    const cred = await enLiga(x.ligaId, (inst) => inst.almacen.sql.exec('SELECT * FROM credenciales').one())
    expect(cred).toMatchObject({ token_hash: x.tokenHash, partido_id: 'P', revocada: 0, device_id: x.act.cuerpo.deviceId })
    expect(cred.expira_en).toBe(T0 + 5000 + DURACIONES.credencialActiva) // 72 h desde la activación
    expect(cred.retorno_hasta).toBe(cred.expira_en + DURACIONES.credencialSoloRecibos) // más 7 días
    const volcado = await volcarObjeto(ligaStub(x.ligaId))
    expect(volcado).not.toContain(x.token) // el token nunca llegó al servidor
    expect(volcado).not.toContain(x.emitido.codigo.replaceAll('-', '').slice(5))
  })

  it('el teléfono activado puede iniciar el partido con su token y su dispositivo', async () => {
    const x = await activado()
    const r = await x.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    expect(r.cuerpo.recibo.deviceId).toBe(x.act.cuerpo.deviceId)
  })

  it('dos teléfonos activan a la vez con el mismo código: exactamente uno gana', async () => {
    const e = await escenarioDeCodigos()
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const a = await tokenDeTelefono()
    const b = await tokenDeTelefono()
    const [ra, rb] = await Promise.all([activar(e.ligaId, 'P', codigo, a.tokenHash), activar(e.ligaId, 'P', codigo, b.tokenHash)])
    expect([ra.status, rb.status].sort()).toEqual([200, 401])
    const filas = await enLiga(e.ligaId, (inst) => inst.almacen.sql.exec('SELECT token_hash FROM credenciales WHERE revocada = 0').toArray())
    expect(filas).toHaveLength(1)
    const ganador = ra.status === 200 ? a : b
    expect(filas[0].token_hash).toBe(ganador.tokenHash)
    expect((await activar(e.ligaId, 'P', codigo, ganador.tokenHash)).status).toBe(200) // su reintento es idempotente
  })

  it('con otro código sin usar, mientras hay un controlador activo, no se puede activar un segundo', async () => {
    const x = await activado()
    const otro = await emitirCodigoDePartido(x.cookie, x.ligaId)
    const intruso = await tokenDeTelefono()
    expect(await activar(x.ligaId, 'P', otro.codigo, intruso.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
    const activas = await enLiga(x.ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM credenciales WHERE revocada = 0').one().n)
    expect(activas).toBe(1)
  })
})

describe('respuesta perdida: recuperación de la activación original', () => {
  it('antes del inicio: el mismo código y el mismo hash devuelven el mismo dispositivo y no cambian nada', async () => {
    const x = await activado()
    const antes = await estadoDeCredenciales(x.ligaId)
    const r = await activar(x.ligaId, 'P', x.emitido.codigo, x.tokenHash)
    expect(r.status).toBe(200)
    expect(r.cuerpo.deviceId).toBe(x.act.cuerpo.deviceId)
    expect(await estadoDeCredenciales(x.ligaId)).toBe(antes) // ni filas, ni versión de autorización, ni auditoría
  })

  it('después del inicio y después del final: igual de idempotente, sin ningún controlador nuevo ni subida de versión', async () => {
    const x = await activado()
    expect((await x.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    let antes = await estadoDeCredenciales(x.ligaId)
    const trasInicio = await activar(x.ligaId, 'P', x.emitido.codigo, x.tokenHash)
    expect(trasInicio).toMatchObject({ status: 200, cuerpo: { deviceId: x.act.cuerpo.deviceId } })
    expect(await estadoDeCredenciales(x.ligaId)).toBe(antes)

    expect((await x.tel.mandar('cerrar-partido', {}, { t: T0 + 2000 })).cuerpo.resultado).toBe('aceptado')
    expect((await (await leerPartido(x.ligaId, 'P')).json()).estado).toBe('final')
    antes = await estadoDeCredenciales(x.ligaId)
    const trasFinal = await activar(x.ligaId, 'P', x.emitido.codigo, x.tokenHash)
    expect(trasFinal).toMatchObject({ status: 200, cuerpo: { deviceId: x.act.cuerpo.deviceId } })
    expect(await estadoDeCredenciales(x.ligaId)).toBe(antes)
  })

  it('un código ya usado con OTRO hash nunca sirve (ni antes ni después del inicio)', async () => {
    const x = await activado()
    const otro = await tokenDeTelefono()
    expect(await activar(x.ligaId, 'P', x.emitido.codigo, otro.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
    await x.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(await activar(x.ligaId, 'P', x.emitido.codigo, otro.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
  })

  it('la caducidad del código SIN usar (48 h) es otro plazo: una activación ya hecha se recupera después; una nueva no', async () => {
    const e = await escenarioDeCodigos()
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const hecha = await tokenDeTelefono()
    control.ahoraMs = T0 + H
    expect((await activar(e.ligaId, 'P', codigo, hecha.tokenHash)).status).toBe(200)
    control.ahoraMs = T0 + 49 * H // el código sin usar ya habría caducado
    expect((await activar(e.ligaId, 'P', codigo, hecha.tokenHash)).status).toBe(200)

    // un código sin usar: el límite es exacto (< 48 h desde su emisión)
    const f = await escenarioDeCodigos()
    control.ahoraMs = T0
    const emitido = await emitirCodigoDePartido(f.cookie, f.ligaId)
    const nuevo = await tokenDeTelefono()
    control.ahoraMs = T0 + 48 * H
    expect(await activar(f.ligaId, 'P', emitido.codigo, nuevo.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
    control.ahoraMs = T0 + 48 * H - 1
    expect((await activar(f.ligaId, 'P', emitido.codigo, nuevo.tokenHash)).status).toBe(200)
  })

  it('la recuperación termina con el horizonte de la credencial (72 h + 7 días desde la activación)', async () => {
    const x = await activado({ tras: 1000 })
    const fin = T0 + 1000 + DURACIONES.credencialActiva + DURACIONES.credencialSoloRecibos
    control.ahoraMs = fin - 1
    expect((await activar(x.ligaId, 'P', x.emitido.codigo, x.tokenHash)).status).toBe(200)
    control.ahoraMs = fin
    expect(await activar(x.ligaId, 'P', x.emitido.codigo, x.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
  })
})

describe('cambio de teléfono antes del inicio; nada después', () => {
  it('el organizador revoca, emite otro código y otro teléfono lo activa; el anterior no puede puntuar ni recuperarse', async () => {
    const x = await activado()
    const antes = x.tel
    const rev = await comoOrganizador(x.cookie, 'POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/revocar`)
    expect(rev).toMatchObject({ status: 200, cuerpo: { ok: true, credencialesRevocadas: 1 } })
    // el teléfono revocado: ni comandos ni recuperación de la activación
    const sobre = await antes.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    expect((await antes.enviar(sobre)).status).toBe(401)
    expect(await activar(x.ligaId, 'P', x.emitido.codigo, x.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })

    const nuevoCodigo = await emitirCodigoDePartido(x.cookie, x.ligaId)
    const b = await tokenDeTelefono()
    const act = await activar(x.ligaId, 'P', nuevoCodigo.codigo, b.tokenHash)
    expect(act.status).toBe(200)
    expect(act.cuerpo.deviceId).not.toBe(x.act.cuerpo.deviceId)
    const telB = new Telefono(x.ligaId, 'P', { token: b.token, deviceId: act.cuerpo.deviceId })
    expect((await telB.mandar('iniciar-partido', {}, { t: T0 + 2000 })).cuerpo.resultado).toBe('aceptado')
  })

  it('una credencial revocada nunca resucita: el mismo hash no se puede volver a registrar y sigue revocada', async () => {
    const x = await activado()
    await comoOrganizador(x.cookie, 'POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/revocar`)
    const nuevoCodigo = await emitirCodigoDePartido(x.cookie, x.ligaId)
    expect(await activar(x.ligaId, 'P', nuevoCodigo.codigo, x.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO }) // hash reutilizado
    const viejo = await enLiga(x.ligaId, (inst) => inst.almacen.sql.exec('SELECT revocada FROM credenciales WHERE token_hash = ?', x.tokenHash).one())
    expect(viejo.revocada).toBe(1)
    const sinPuntuar = await x.tel.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    expect((await x.tel.enviar(sinPuntuar)).status).toBe(401)
  })

  it('una orden del teléfono anterior ya autorizada en el momento del cambio no se confirma', async () => {
    const x = await activado()
    const sobre = await x.tel.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    let avisar
    const pausada = new Promise((r) => { avisar = r })
    let liberar
    const espera = new Promise((r) => { liberar = r })
    let usada = false
    control.pausaAut = async () => { if (usada) return; usada = true; avisar(); await espera }
    const envio = x.tel.enviar(sobre).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))
    await pausada
    await comoOrganizador(x.cookie, 'POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/revocar`)
    liberar()
    expect(await envio).toEqual({ status: 401, cuerpo: GENERICO })
    expect(await conteos(x.ligaId, 'P')).toMatchObject({ recibos: 0, rev: 0, seq: 0 })
  })

  it('tras el inicio no hay sustitución ni revocación: emitir y revocar devuelven 409, y no existen rutas de liberación', async () => {
    const x = await activado()
    expect((await x.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    const antes = await estadoDeCredenciales(x.ligaId)
    expect(await comoOrganizador(x.cookie, 'POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/codigo`)).toMatchObject({ status: 409, cuerpo: { error: 'partido-iniciado' } })
    expect(await comoOrganizador(x.cookie, 'POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/revocar`)).toMatchObject({ status: 409, cuerpo: { error: 'partido-iniciado' } })
    for (const [metodo, ruta] of [
      ['POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/liberar`], ['POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/liberar`],
      ['DELETE', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control`], ['POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/reemplazar`],
      ['POST', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control`], ['GET', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control/revocar`],
    ]) {
      const r = await comoOrganizador(x.cookie, metodo, ruta)
      expect([404, 405], `${metodo} ${ruta}`).toContain(r.status)
    }
    expect(await estadoDeCredenciales(x.ligaId)).toBe(antes)
    const estado = await comoOrganizador(x.cookie, 'GET', `/v1/organizador/ligas/${x.ligaId}/partidos/P/control`)
    expect(estado.cuerpo).toMatchObject({ partido: 'vivo', credencial: 'activa' })
    // y el teléfono sigue controlando
    expect((await x.tel.mandar('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 3000 })).cuerpo.resultado).toBe('aceptado')
  })

  it('con un código sin usar emitido antes del inicio, activar después del inicio es imposible', async () => {
    const x = await activado()
    const pendiente = await emitirCodigoDePartido(x.cookie, x.ligaId) // sigue sin usar
    await x.tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const otro = await tokenDeTelefono()
    expect(await activar(x.ligaId, 'P', pendiente.codigo, otro.tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
    const activas = await enLiga(x.ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM credenciales WHERE revocada = 0').one().n)
    expect(activas).toBe(1)
  })
})

describe('el estado del partido, por sí solo, impide una activación nueva', () => {
  // Sin ningún controlador activo (así no puede ser "otra credencial" lo que lo impide): solo el estado cuenta.
  for (const estado of ['vivo', 'final']) {
    it(`partido ${estado} y sin credencial activa: un código sin usar no activa a nadie`, async () => {
      const e = await escenarioDeCodigos()
      const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
      await fijarEstadoDePartido(e.ligaId, 'P', { estado })
      const { tokenHash } = await tokenDeTelefono()
      expect(await activar(e.ligaId, 'P', codigo, tokenHash)).toMatchObject({ status: 401, cuerpo: GENERICO })
      const filas = await enLiga(e.ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM credenciales').one().n)
      expect(filas).toBe(0)
      await fijarEstadoDePartido(e.ligaId, 'P', { estado: 'programado' })
      expect((await activar(e.ligaId, 'P', codigo, tokenHash)).status).toBe(200) // con el estado correcto, el mismo código sí sirve
    })
  }

  it('otorgar una credencial por la vía interna también exige partido programado', async () => {
    const e = await escenarioDeCodigos()
    await fijarEstadoDePartido(e.ligaId, 'P', { estado: 'vivo' })
    await expect(enLiga(e.ligaId, (inst) => otorgarCredencial(inst.almacen, { tokenHash: 'a'.repeat(64), partidoId: 'P', deviceId: 'dev-x' }))).rejects.toThrow('partido-iniciado')
  })
})

describe('intentos fallidos y entradas', () => {
  it('cinco secretos erróneos bloquean el código 10 minutos (el mismo 401), y se levanta solo', async () => {
    const e = await escenarioDeCodigos()
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const { tokenHash } = await tokenDeTelefono()
    const malo = `${codigo.slice(0, 5)}-00000-00000-00000`
    for (let i = 0; i < 5; i += 1) expect((await activar(e.ligaId, 'P', malo, tokenHash, { ip: `198.51.100.${i}` })).status).toBe(401)
    expect((await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '198.51.100.50' })).status).toBe(401)
    control.ahoraMs = T0 + 10 * 60 * 1000
    expect((await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '198.51.100.50' })).status).toBe(200)
  })

  it('el límite por fuente corta (429) los intentos masivos contra ids desconocidos', async () => {
    const e = await escenarioDeCodigos()
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const { tokenHash } = await tokenDeTelefono()
    for (let i = 0; i < 20; i += 1) await activar(e.ligaId, 'P', `ZZ${String(i).padStart(3, '1')}-00000-00000-00000`, tokenHash, { ip: '192.0.2.77' })
    expect((await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '192.0.2.77' })).status).toBe(429)
    expect((await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '192.0.2.78' })).status).toBe(200)
  })

  it('todos los fallos son el mismo 401: otro partido, id desconocido, secreto erróneo, hash mal formado, caducado, tras el inicio, revocado', async () => {
    const e = await escenarioDeCodigos()
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const { tokenHash } = await tokenDeTelefono()
    const resultados = [
      await activar(e.ligaId, 'Q', codigo, tokenHash, { ip: '10.9.0.1' }), // el código es de P
      await activar(e.ligaId, 'P', 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', tokenHash, { ip: '10.9.0.2' }),
      await activar(e.ligaId, 'P', `${codigo.slice(0, 5)}-00000-00000-00000`, tokenHash, { ip: '10.9.0.3' }),
      await activar(e.ligaId, 'P', codigo, 'no-es-un-hash', { ip: '10.9.0.4' }),
      await activar(e.ligaId, 'P', codigo, tokenHash.toUpperCase(), { ip: '10.9.0.5' }),
      await activar(e.ligaId, 'P', codigo, 12345, { ip: '10.9.0.6' }),
      await activar(e.ligaId, 'P', 12345, tokenHash, { ip: '10.9.0.7' }),
      await activar(e.ligaId, 'P', null, null, { ip: '10.9.0.8', cuerpo: [] }),
    ]
    for (const r of resultados) expect(r).toMatchObject({ status: 401, cuerpo: GENERICO })
    control.ahoraMs = T0 + 48 * H
    expect(await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '10.9.0.9' })).toMatchObject({ status: 401, cuerpo: GENERICO })
  })

  it('cuerpo demasiado grande 413 y JSON inválido 400; las direcciones no llevan autoridad (una liga ajena no se activa)', async () => {
    const e = await escenarioDeCodigos()
    expect((await activar(e.ligaId, 'P', null, null, { cuerpo: JSON.stringify({ codigo: 'A'.repeat(5000) }) })).status).toBe(413)
    expect((await activar(e.ligaId, 'P', null, null, { cuerpo: '{roto' })).status).toBe(400)
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const { tokenHash } = await tokenDeTelefono()
    expect((await activar('LIGA-NO-ADMITIDA', 'P', codigo, tokenHash)).status).toBe(404)
    expect((await pedir('GET', `/v1/ligas/${e.ligaId}/partidos/P/activar`)).status).toBe(405)
  })

  it('la huella de un hash distinto del token real: el servidor no puede deducir ni devolver el token', async () => {
    const x = await activado()
    expect(await sha256Hex(x.token)).toBe(x.tokenHash)
    expect(JSON.stringify(x.act.cuerpo)).not.toContain(x.token)
  })
})
