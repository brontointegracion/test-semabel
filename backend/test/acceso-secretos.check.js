import { afterEach, describe, expect, it } from 'vitest'
import { T0, Telefono } from './ayuda.js'
import {
  accesoStub, activar, comoOrganizador, control, emitirCodigoDePartido, escenarioDeCodigos, historial, iniciarSesion, ligaStub, pedir,
  tokenDeTelefono, volcarObjeto,
} from './ayuda-acceso.js'

afterEach(() => { control.ahoraMs = null })

function capturarConsola() {
  const lineas = []
  const originales = {}
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    originales[m] = console[m]
    console[m] = (...a) => { lineas.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  }
  return { lineas, restaurar: () => { for (const m of Object.keys(originales)) console[m] = originales[m] } }
}

const sinGuiones = (c) => c.replaceAll('-', '')
// Un código puede aparecer agrupado con guiones: se busca sobre el texto normalizado.
const contiene = (texto, secreto) => sinGuiones(String(texto)).includes(secreto)

describe('ningún secreto en URLs, registros, respuestas públicas, cachés ni almacenamiento', () => {
  it('un recorrido completo (alta, sesión, código de partido, activación, partido, fallos y revocación)', async () => {
    const consola = capturarConsola()
    const desde = historial.length
    let e; let emitido; let token; let tokenHash; let act; let sesionCookie
    try {
      e = await escenarioDeCodigos()
      sesionCookie = e.cookie
      emitido = await emitirCodigoDePartido(e.cookie, e.ligaId)
      ;({ token, tokenHash } = await tokenDeTelefono())
      act = await activar(e.ligaId, 'P', emitido.codigo, tokenHash)
      const tel = new Telefono(e.ligaId, 'P', { token, deviceId: act.cuerpo.deviceId })
      await tel.mandar('iniciar-partido', {}, { t: T0 + 1000 })
      await tel.mandar('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 2000 })
      // fallos de todo tipo
      await iniciarSesion('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
      await iniciarSesion(`${e.codigoOrganizador.slice(0, 5)}-00000-00000-00000`)
      await activar(e.ligaId, 'P', emitido.codigo, (await tokenDeTelefono()).tokenHash)
      await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/control/revocar`) // 409: ya empezó
      await pedir('GET', `/v1/ligas/${e.ligaId}/partidos/P`) // lectura pública
      await comoOrganizador(e.cookie, 'POST', '/v1/organizador/salir')
    } finally {
      consola.restaurar()
    }

    const secretos = {
      codigoOrganizador: sinGuiones(e.codigoOrganizador).slice(5),
      codigoPartido: sinGuiones(emitido.codigo).slice(5),
      secretoSesion: sesionCookie.split('.')[1],
      tokenTelefono: token,
    }
    const flujo = historial.slice(desde)
    expect(flujo.length).toBeGreaterThanOrEqual(10)

    // 1. Nada en la consola.
    const log = consola.lineas.join('\n')
    for (const [nombre, s] of Object.entries(secretos)) expect(contiene(log, s), `consola: ${nombre}`).toBe(false)

    // 2. Ningún secreto en ninguna URL de ninguna petición.
    for (const p of flujo) for (const [nombre, s] of Object.entries(secretos)) expect(contiene(p.url, s), `url: ${nombre}`).toBe(false)

    // 3. Cada secreto aparece solo donde debe, una vez emitido:
    const enRespuestas = (s) => flujo.filter((p) => contiene(p.cuerpo, s) || Object.values(p.cabeceras).some((v) => contiene(v, s)))
    expect(enRespuestas(secretos.codigoOrganizador).map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual(['POST /v1/admin/organizador'])
    expect(enRespuestas(secretos.codigoPartido).map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual([`POST /v1/organizador/ligas/${e.ligaId}/partidos/P/codigo`])
    expect(enRespuestas(secretos.secretoSesion).map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual(['POST /v1/acceso/organizador']) // solo en Set-Cookie
    const setCookie = flujo.find((p) => p.cabeceras['set-cookie']?.includes(secretos.secretoSesion))
    expect(setCookie.cuerpo).not.toContain(secretos.secretoSesion)
    expect(enRespuestas(secretos.tokenTelefono)).toEqual([]) // el token del teléfono no viaja nunca en una respuesta

    // 4. Toda respuesta del recorrido: sin caché, sin referrer, y la lectura pública no lleva nada privado.
    for (const p of flujo) {
      expect(p.cabeceras['cache-control'], `${p.metodo} ${p.url}`).toBe('no-store')
      expect(p.cabeceras['referrer-policy'], `${p.metodo} ${p.url}`).toBe('no-referrer')
      expect(p.cabeceras['x-content-type-options']).toBe('nosniff')
    }
    const publica = flujo.find((p) => p.metodo === 'GET' && p.url.endsWith('/partidos/P'))
    for (const s of Object.values(secretos)) expect(contiene(publica.cuerpo, s)).toBe(false)
    expect(publica.cuerpo).not.toMatch(/dev-[0-9a-f]{24}|control:|token_hash|secreto/)

    // 5. Nada en claro en el almacenamiento de ninguno de los dos objetos.
    const bases = [await volcarObjeto(accesoStub()), await volcarObjeto(ligaStub(e.ligaId))]
    for (const base of bases) {
      for (const [nombre, s] of Object.entries(secretos)) expect(contiene(base, s), `almacenamiento: ${nombre}`).toBe(false)
      expect(base).not.toContain(sesionCookie) // ni la cookie entera
      expect(base).not.toContain(e.codigoOrganizador)
      expect(base).not.toContain(emitido.codigo)
    }
    expect(bases[1]).toContain(tokenHash) // solo el hash del token
  })
})
