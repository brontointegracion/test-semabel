import { beforeEach, describe, expect, it, afterEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { sembrar } from './ayuda.js'
import { DURACIONES } from '../src/acceso/config.js'
import {
  ORIGEN, T0, TOKEN_OPERADOR, accesoStub, admin, cabecerasEscritura, comoOrganizador, conCookie, control, enAcceso, iniciarSesion,
  pedir, provisionar, reiniciarAcceso, volcarObjeto,
} from './ayuda-acceso.js'

const H = 60 * 60 * 1000
const MIN = 60 * 1000
const GENERICO = { error: 'no-autorizado' }

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.desfasesAcceso = null })

const yo = (cookie) => pedir('GET', '/v1/organizador/yo', { cabeceras: conCookie(cookie) })
const ligasPropias = () => [nuevaLiga(), nuevaLiga()]

describe('provisión del operador: cerrada por defecto', () => {
  const ligas = () => [nuevaLiga()]
  it('sin bandera, sin secreto o con secreto corto la ruta no existe (404 uniforme), sin tocar el objeto de acceso', async () => {
    const espia = new Proxy({}, { get() { throw new Error('binding tocado') } })
    for (const extra of [{ ACCESO_ADMIN_HABILITADO: '0' }, { ACCESO_ADMIN_HABILITADO: undefined }, { ACCESO_ADMIN_TOKEN: undefined }, { ACCESO_ADMIN_TOKEN: 'corto' }]) {
      const r = await pedir('POST', '/v1/admin/organizador', {
        cuerpo: { nombre: 'x', ligas: ligas() }, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' },
        entorno: { ...env, ...extra, ACCESO: espia, LIGA: espia },
      })
      expect(r.status, JSON.stringify(extra)).toBe(404)
    }
  })
  it('exige el secreto del operador (401), ligas admitidas (422) y un solo organizador (409)', async () => {
    expect((await admin('/v1/admin/organizador', { nombre: 'x', ligas: ligas() }, 'otro-secreto-cualquiera-de-operador-00')).status).toBe(401)
    expect((await admin('/v1/admin/organizador', { nombre: 'x', ligas: ['LIGA-NO-ADMITIDA'] })).status).toBe(422)
    expect((await admin('/v1/admin/organizador', { nombre: 'x', ligas: [] })).status).toBe(422)
    expect((await admin('/v1/admin/organizador', { nombre: '', ligas: ligas() })).status).toBe(422)
    expect((await admin('/v1/admin/organizador', { nombre: 'x', ligas: ligas() })).status).toBe(201)
    expect((await admin('/v1/admin/organizador', { nombre: 'y', ligas: ligas() })).status).toBe(409)
  })
  it('devuelve el código una sola vez, con su caducidad de 7 días, y guarda solo hashes', async () => {
    const r = await admin('/v1/admin/organizador', { nombre: 'Org', ligas: ligas() })
    expect(r.cuerpo.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
    expect(r.cuerpo.expiraEn - T0).toBe(DURACIONES.codigoOrganizador)
    expect(r.respuesta.headers.get('cache-control')).toBe('no-store')
    const plano = r.cuerpo.codigo.replaceAll('-', '')
    const volcado = await volcarObjeto(accesoStub())
    expect(volcado).not.toContain(plano.slice(5)) // el secreto
    expect(volcado).toMatch(/"secreto_hash":"[0-9a-f]{64}"/)
  })
})

describe('configuración de las rutas del organizador: cerrada si falta o está mal formada', () => {
  it('sin origen válido ninguna ruta del organizador existe (404), ni siquiera el inicio de sesión', async () => {
    const ligas = ligasPropias()
    const { codigo } = await provisionar(ligas)
    for (const origen of [undefined, '', 'http://backend.local', 'https://backend.local/', 'https://', 'HTTPS://BACKEND.LOCAL', 'backend.local', 'https://back end.local', 12345, null, 'https://backend.local/ruta']) {
      const r = await pedir('POST', '/v1/acceso/organizador', { cuerpo: { codigo }, cabeceras: cabecerasEscritura(), entorno: { ...env, ACCESO_ORIGEN: origen } })
      expect(r.status, String(origen)).toBe(404)
      const y = await pedir('GET', '/v1/organizador/yo', { entorno: { ...env, ACCESO_ORIGEN: origen } })
      expect(y.status, String(origen)).toBe(404)
    }
  })
})

describe('inicio de sesión con el código', () => {
  it('acepta el código tal como lo teclea una persona y entrega una cookie con los atributos de seguridad', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const tecleado = ` ${codigo.toLowerCase().replaceAll('-', ' ')} `
    const r = await iniciarSesion(tecleado)
    expect(r.status).toBe(200)
    const sc = r.respuesta.headers.get('set-cookie')
    expect(sc).toMatch(/^__Host-sesion=[0-9a-f]{32}\.[0-9a-f]{64};/)
    for (const atributo of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', `Max-Age=${DURACIONES.sesionAbsoluta / 1000}`]) expect(sc).toContain(atributo)
    expect(sc).not.toContain('Domain=')
    expect(JSON.stringify(r.cuerpo)).not.toContain(r.cookie) // el valor no va en el cuerpo
    expect(r.respuesta.headers.get('cache-control')).toBe('no-store')
    expect(r.respuesta.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('todos los fallos son el mismo 401 genérico: id desconocido, secreto erróneo, formato inválido, no texto', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const idReal = codigo.slice(0, 5)
    const malos = ['ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', `${idReal}-00000-00000-00000`, 'no es un código', '', 12345, null, { a: 1 }]
    for (const m of malos) {
      const r = await iniciarSesion(m)
      expect(r.status, JSON.stringify(m)).toBe(401)
      expect(r.cuerpo).toEqual(GENERICO)
      expect(r.cookie).toBeNull()
    }
  })

  it('tras 5 secretos erróneos el código se bloquea 10 minutos (aunque se teclee bien) y el bloqueo se duplica', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const id = codigo.slice(0, 5)
    const erroneo = `${id}-00000-00000-00000`
    for (let i = 0; i < 5; i += 1) expect((await iniciarSesion(erroneo, { ip: `10.0.0.${i}` })).status).toBe(401)
    expect((await iniciarSesion(codigo, { ip: '10.0.1.1' })).status).toBe(401) // bloqueado, mismo 401 genérico
    control.ahoraMs = T0 + 10 * MIN - 1
    expect((await iniciarSesion(codigo, { ip: '10.0.1.1' })).status).toBe(401)
    control.ahoraMs = T0 + 10 * MIN
    expect((await iniciarSesion(codigo, { ip: '10.0.1.1' })).status).toBe(200) // se levanta solo: no es un bloqueo permanente
    // segundo bloqueo: tras un acierto el contador vuelve a cero
    for (let i = 0; i < 5; i += 1) await iniciarSesion(erroneo, { ip: `10.0.2.${i}` })
    for (let i = 0; i < 5; i += 1) await iniciarSesion(erroneo, { ip: `10.0.3.${i}` })
    expect((await iniciarSesion(codigo, { ip: '10.0.4.1' })).status).toBe(401)
  })

  it('el cubo por fuente corta los intentos masivos (429) sin afectar a otras fuentes; la ventana se reinicia', async () => {
    const { codigo } = await provisionar(ligasPropias())
    for (let i = 0; i < 20; i += 1) {
      const aleatorio = `${String.fromCharCode(65 + (i % 8))}${i.toString(32).padStart(4, '1').toUpperCase().replace(/[ILOU]/g, '2')}-00000-00000-00000`
      await iniciarSesion(aleatorio, { ip: '203.0.113.9' })
    }
    expect((await iniciarSesion(codigo, { ip: '203.0.113.9' })).status).toBe(429)
    expect((await iniciarSesion(codigo, { ip: '203.0.113.10' })).status).toBe(200) // otra fuente
    control.ahoraMs = T0 + 10 * MIN
    expect((await iniciarSesion(codigo, { ip: '203.0.113.9' })).status).toBe(200) // ventana nueva
  })

  it('no se confía en cabeceras de reenvío del cliente para decidir nada', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const r = await pedir('POST', '/v1/acceso/organizador', {
      cuerpo: { codigo: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ' },
      cabeceras: cabecerasEscritura({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8', 'x-organizador-id': 'org-falso' }),
    })
    expect(r.status).toBe(401)
    expect((await iniciarSesion(codigo)).status).toBe(200)
  })
})

describe('sesión: caducidad, cierre, máximo de dos y rotación', () => {
  it('caduca a las 12 h sin uso y a las 24 h absolutas, con el reloj determinista', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const inactiva = (await iniciarSesion(codigo)).cookie
    control.ahoraMs = T0 + 12 * H - 1
    expect((await yo(inactiva)).status).toBe(200)
    // otra sesión nunca usada: cae justo a las 12 h
    control.ahoraMs = T0
    await reiniciarAcceso()
    const { codigo: c2 } = await provisionar(ligasPropias())
    const s2 = (await iniciarSesion(c2)).cookie
    control.ahoraMs = T0 + 12 * H
    expect((await yo(s2)).status).toBe(401)

    // con uso: el límite por inactividad se renueva, pero el absoluto no
    control.ahoraMs = T0
    await reiniciarAcceso()
    const { codigo: c3 } = await provisionar(ligasPropias())
    const s3 = (await iniciarSesion(c3)).cookie
    for (const h of [11, 22]) { control.ahoraMs = T0 + h * H; expect((await yo(s3)).status, `a las ${h} h`).toBe(200) }
    control.ahoraMs = T0 + 24 * H - 1
    expect((await yo(s3)).status).toBe(200)
    control.ahoraMs = T0 + 24 * H
    expect((await yo(s3)).status).toBe(401)
  })

  it('el último uso se escribe como mucho una vez por minuto', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const cookie = (await iniciarSesion(codigo)).cookie
    const idSesion = cookie.split('.')[0]
    const usoGuardado = () => enAcceso((inst) => inst.almacen.sql.exec('SELECT ultimo_uso AS u FROM sesiones WHERE id = ?', idSesion).one().u)
    control.ahoraMs = T0 + 30_000
    await yo(cookie)
    expect(await usoGuardado()).toBe(T0)
    control.ahoraMs = T0 + 60_000
    await yo(cookie)
    expect(await usoGuardado()).toBe(T0 + 60_000)
  })

  it('salir cierra la sesión de verdad y borra la cookie', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const cookie = (await iniciarSesion(codigo)).cookie
    const r = await comoOrganizador(cookie, 'POST', '/v1/organizador/salir')
    expect(r.status).toBe(200)
    expect(r.respuesta.headers.get('set-cookie')).toMatch(/Max-Age=0/)
    expect((await yo(cookie)).status).toBe(401)
  })

  it('como máximo dos sesiones: una tercera cierra la menos usada recientemente', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const a = (await iniciarSesion(codigo)).cookie
    control.ahoraMs = T0 + MIN
    const b = (await iniciarSesion(codigo)).cookie
    control.ahoraMs = T0 + 2 * MIN
    await yo(a) // a se usa después de b: b pasa a ser la menos reciente
    control.ahoraMs = T0 + 3 * MIN
    const c = (await iniciarSesion(codigo)).cookie
    expect((await yo(b)).status).toBe(401)
    expect((await yo(a)).status).toBe(200)
    expect((await yo(c)).status).toBe(200)
    const vivas = await enAcceso((inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM sesiones WHERE revocada_en IS NULL').one().n)
    expect(vivas).toBe(2)
  })

  it('el código caduca a los 7 días desde su emisión (no antes) y es reutilizable mientras tanto', async () => {
    const { codigo } = await provisionar(ligasPropias())
    expect((await iniciarSesion(codigo)).status).toBe(200)
    expect((await iniciarSesion(codigo)).status).toBe(200)
    control.ahoraMs = T0 + 7 * 24 * H - 1
    expect((await iniciarSesion(codigo)).status).toBe(200)
    control.ahoraMs = T0 + 7 * 24 * H
    expect((await iniciarSesion(codigo)).status).toBe(401)
  })

  it('rotar el código: el viejo deja de servir, el nuevo sirve, y por defecto se cierran las sesiones (opcionalmente no)', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const vieja = (await iniciarSesion(codigo)).cookie
    const r = await admin('/v1/admin/organizador/codigo/rotar', {})
    expect(r.status).toBe(200)
    expect((await iniciarSesion(codigo)).status).toBe(401)
    expect((await yo(vieja)).status).toBe(401)
    const nueva = await iniciarSesion(r.cuerpo.codigo)
    expect(nueva.status).toBe(200)
    const r2 = await admin('/v1/admin/organizador/codigo/rotar', { cerrarSesiones: false })
    expect((await yo(nueva.cookie)).status).toBe(200) // sin cierre de sesiones
    expect((await iniciarSesion(r.cuerpo.codigo)).status).toBe(401)
    expect((await iniciarSesion(r2.cuerpo.codigo)).status).toBe(200)
  })

  it('cerrar todas las sesiones y desactivar al organizador', async () => {
    const { codigo } = await provisionar(ligasPropias())
    const cookie = (await iniciarSesion(codigo)).cookie
    expect((await admin('/v1/admin/organizador/sesiones/cerrar', {})).status).toBe(200)
    expect((await yo(cookie)).status).toBe(401)
    expect((await iniciarSesion(codigo)).status).toBe(200) // el código sigue valiendo
    expect((await admin('/v1/admin/organizador/desactivar', {})).status).toBe(200)
    expect((await iniciarSesion(codigo)).status).toBe(401)
  })
})

describe('propiedad de las ligas (U10 y U12 con un solo organizador)', () => {
  it('lista las dos ligas; otra liga admitida pero ajena recibe el 401 genérico; una no admitida, el 404 uniforme', async () => {
    const [u10, u12] = ligasPropias()
    const ajena = nuevaLiga()
    const { codigo } = await provisionar([u10, u12])
    const cookie = (await iniciarSesion(codigo)).cookie
    const r = await yo(cookie)
    expect(r.cuerpo.ligas.sort()).toEqual([u10, u12].sort())
    for (const liga of [u10, u12]) expect((await comoOrganizador(cookie, 'GET', `/v1/organizador/ligas/${liga}/partidos/P/control`)).status).not.toBe(401)
    const denegada = await comoOrganizador(cookie, 'GET', `/v1/organizador/ligas/${ajena}/partidos/P/control`)
    expect(denegada).toMatchObject({ status: 401, cuerpo: GENERICO })
    const noAdmitida = await comoOrganizador(cookie, 'GET', '/v1/organizador/ligas/LIGA-NO-ADMITIDA/partidos/P/control')
    expect(noAdmitida).toMatchObject({ status: 404, cuerpo: { error: 'no-encontrado' } })
  })

  it('un organizador desactivado o sin cookie no obtiene nada, y la cookie de otro no sirve', async () => {
    const { codigo } = await provisionar(ligasPropias())
    expect((await yo(null)).status).toBe(401)
    expect((await yo('00000000000000000000000000000000.' + '0'.repeat(64))).status).toBe(401)
    expect((await yo('basura')).status).toBe(401)
    expect((await yo(`${'a'.repeat(200)}`)).status).toBe(401)
    expect((await iniciarSesion(codigo)).status).toBe(200)
  })
})

describe('protección CSRF de las escrituras con cookie', () => {
  const rutasQueEscriben = (liga) => [
    ['inicio de sesión', '/v1/acceso/organizador', { codigo: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ' }],
    ['salir', '/v1/organizador/salir', {}],
    ['emitir código de partido', `/v1/organizador/ligas/${liga}/partidos/P/codigo`, {}],
    ['revocar control', `/v1/organizador/ligas/${liga}/partidos/P/control/revocar`, {}],
  ]
  it('sin Origin exacto, sin la cabecera propia, con otro tipo de contenido o desde otro sitio: 403, y no ocurre nada', async () => {
    const [liga] = ligasPropias()
    const payload = payloadDeLiga(liga)
    payload.credenciales = []
    expect((await sembrar(liga, payload)).status).toBe(201)
    const { codigo } = await provisionar([liga])
    const cookie = (await iniciarSesion(codigo)).cookie
    const ataques = [
      ['sin Origin', { 'x-sebel-peticion': '1', 'content-type': 'application/json' }],
      ['Origin de otro sitio', { origin: 'https://atacante.example', 'x-sebel-peticion': '1', 'content-type': 'application/json' }],
      ['Origin casi igual', { origin: `${ORIGEN}.atacante.example`, 'x-sebel-peticion': '1', 'content-type': 'application/json' }],
      ['sin cabecera propia', { origin: ORIGEN, 'content-type': 'application/json' }],
      ['formulario', { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/x-www-form-urlencoded' }],
      ['texto plano', { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'text/plain' }],
      ['entre sitios', { ...cabecerasEscritura(), 'sec-fetch-site': 'cross-site' }],
      ['mismo sitio, otro origen', { ...cabecerasEscritura(), 'sec-fetch-site': 'same-site' }],
    ]
    for (const [nombreRuta, ruta, cuerpo] of rutasQueEscriben(liga)) {
      for (const [nombre, cabeceras] of ataques) {
        const r = await pedir('POST', ruta, { cuerpo, cabeceras: conCookie(cookie, cabeceras) })
        expect(r.status, `${nombreRuta}: ${nombre}`).toBe(403)
        expect(r.cuerpo).toEqual({ error: 'prohibido' })
      }
    }
    expect((await yo(cookie)).status).toBe(200) // "salir" no llegó a ejecutarse
    expect((await comoOrganizador(cookie, 'GET', `/v1/organizador/ligas/${liga}/partidos/P/control`)).cuerpo).toMatchObject({ codigoPendiente: false })
  })

  it('con las condiciones correctas la misma petición pasa; Sec-Fetch-Site: same-origin es válido', async () => {
    const [liga] = ligasPropias()
    const { codigo } = await provisionar([liga])
    const cookie = (await iniciarSesion(codigo)).cookie
    const r = await pedir('POST', '/v1/organizador/salir', { cuerpo: {}, cabeceras: conCookie(cookie, { ...cabecerasEscritura(), 'sec-fetch-site': 'same-origin' }) })
    expect(r.status).toBe(200)
  })

  it('no hay CORS: ninguna respuesta permite otro origen y OPTIONS no habilita nada', async () => {
    const [liga] = ligasPropias()
    const { codigo } = await provisionar([liga])
    const login = await iniciarSesion(codigo)
    const opciones = await pedir('OPTIONS', '/v1/organizador/salir', { cabeceras: { origin: 'https://atacante.example', 'access-control-request-method': 'POST' } })
    for (const r of [login, opciones, await yo(login.cookie)]) {
      expect(r.respuesta.headers.get('access-control-allow-origin')).toBeNull()
      expect(r.respuesta.headers.get('access-control-allow-credentials')).toBeNull()
    }
    expect([404, 405]).toContain(opciones.status)
  })

  it('las respuestas con datos del organizador no se guardan en caché y varían con la cookie', async () => {
    const [liga] = ligasPropias()
    const { codigo } = await provisionar([liga])
    const cookie = (await iniciarSesion(codigo)).cookie
    const r = await yo(cookie)
    expect(r.respuesta.headers.get('cache-control')).toBe('no-store')
    expect(r.respuesta.headers.get('vary')).toMatch(/cookie/i)
  })
})

describe('entradas acotadas y separación de credenciales', () => {
  it('cuerpo demasiado grande 413, JSON inválido 400, código que no es texto 401, cabecera de cookie enorme 401', async () => {
    const [liga] = ligasPropias()
    const { codigo } = await provisionar([liga])
    expect((await pedir('POST', '/v1/acceso/organizador', { cuerpo: JSON.stringify({ codigo: 'A'.repeat(5000) }), cabeceras: cabecerasEscritura() })).status).toBe(413)
    expect((await pedir('POST', '/v1/acceso/organizador', { cuerpo: '{no es json', cabeceras: cabecerasEscritura() })).status).toBe(400)
    expect((await iniciarSesion(['a'])).status).toBe(401)
    expect((await pedir('GET', '/v1/organizador/yo', { cabeceras: { cookie: `__Host-sesion=${'a'.repeat(6000)}` } })).status).toBe(401)
    expect((await iniciarSesion(codigo)).status).toBe(200)
  })

  it('el token de un teléfono no abre rutas del organizador, y la cookie del organizador no abre las de scoring', async () => {
    const [liga] = ligasPropias()
    const { codigo } = await provisionar([liga])
    const cookie = (await iniciarSesion(codigo)).cookie
    const conToken = await pedir('GET', '/v1/organizador/yo', { cabeceras: { authorization: 'Bearer ' + 'a'.repeat(64) } })
    expect(conToken.status).toBe(401)
    const scoring = await pedir('POST', `/v1/ligas/${liga}/partidos/P/comandos`, { cuerpo: { gameId: 'P' }, cabeceras: conCookie(cookie, { 'content-type': 'application/json' }) })
    expect(scoring.status).toBe(401) // sin Authorization de partido no hay scoring, aunque haya una cookie de organizador
  })

  it('las rutas no llevan autoridad: una dirección "predecible" sin credencial no abre nada', async () => {
    const [liga] = ligasPropias()
    await provisionar([liga])
    for (const ruta of ['/organizador', '/v1/organizador', `/v1/ligas/${liga}/partidos/P/control`]) {
      expect([404, 405], ruta).toContain((await pedir('GET', ruta)).status)
    }
    // La lectura de la liga del organizador existe desde la plantilla compartida, pero sin sesión solo da el 401 genérico.
    const sinSesion = await pedir('GET', `/v1/organizador/ligas/${liga}`)
    expect(sinSesion.status).toBe(401)
    expect(sinSesion.cuerpo).toEqual({ error: 'no-autorizado' })
    expect((await comoOrganizador(null, 'GET', `/v1/organizador/ligas/${liga}/partidos/P/control`)).status).toBe(401)
  })
})
