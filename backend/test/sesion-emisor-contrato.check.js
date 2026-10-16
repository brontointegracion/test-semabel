import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import worker from '../src/worker.js'
import { LIMITES_ESTADO_CONTROL } from '../src/lectura-estado-control.js'
import { crearClienteSesion, LIMITES_API } from '../../src/lib/control/sesion-api.js'
import { crearEmisor } from '../../src/lib/control/sesion-emisor.js'
import { evaluarInicio, ordenDeInicio, construirSesion } from '../../src/lib/control/sesion-motor.js'
import { abrirAlmacen, aplicarRecibo, crearSesion, encolar, leerSesion } from '../../src/lib/control/sesion-almacen.js'
import { tokenDe } from './fixtures/sintetico.js'
import { postComando, leerEstado, dentro } from './ayuda.js'
import { control } from './ayuda-acceso.js'
import { escenarioPlantilla } from './ayuda-plantilla.js'

// REPORT_124: el adaptador de red y el emisor serie (los REALES) frente al Worker REAL en workerd, con la base S1a sobre
// fake-indexeddb de la raíz (el backend no instala nada propio: es una limitación documentada de este experimento local).
// Datos sintéticos y desechables. Cada espera del emisor se ejecuta al instante pero se REGISTRA con su duración pedida.
// Nada se debilita para que pase: si el Worker difiere de lo previsto, la prueba falla y ese es el hallazgo.

const BASE = 'https://backend.local'
const SERVIDOR = 1_700_000_000_000 + 10_000_000
const H = 3_600_000
afterEach(() => { control.ahoraMs = null; control.limitesEstado = null })

let n = 0
let c = 0
const cmd = (p = 'c') => `${p}-emisor-${++c}`
const ver = async (r) => { const texto = await r.text(); let cuerpo = null; try { cuerpo = JSON.parse(texto) } catch { /* sin JSON */ } return { status: r.status, texto, cuerpo } }
const tiempo = (accionTs) => ({ accionTs, accionTsCrudo: accionTs, ajusteTsMs: 0, discontinuidad: null })

/** `fetch` real del Worker (solo las opciones que workerd admite; las demás banderas las comprueba la prueba del adaptador). */
const fetchReal = (url, init) => exports.default.fetch(new Request(`${BASE}${url}`, { method: init.method, headers: init.headers, body: init.body }))

async function entorno({ juego = 'P', reloj = undefined, envolver = (f) => f } = {}) {
  const e = await escenarioPlantilla()
  const ligaId = e.ligaId
  const token = tokenDe(ligaId, juego)
  control.ahoraMs = SERVIDOR
  const almacen = await abrirAlmacen({ nombre: `emisor-http-${++n}-${Math.random().toString(36).slice(2)}` })
  const id = `${ligaId}:${juego}`
  const esperas = []
  const llamadas = []
  const tamanos = []
  const base = envolver(async (url, init) => {
    llamadas.push({ url, init, cuerpo: init.body ?? null })
    const r = await fetchReal(url, init)
    tamanos.push({ url, status: r.status, bytes: new TextEncoder().encode(await r.clone().text()).length })
    return r
  })
  const cliente = crearClienteSesion({ ligaId, partidoId: juego, token, fetchImpl: (...a) => base(...a) })
  const t = {
    e, ligaId, juego, token, almacen, id, revision: 0, llamadas, esperas, cliente, ahora: SERVIDOR, tamanos,
    ctx: (x = {}) => ({ ahoraEstimado: t.ahora, actorId: 'emisor', enLinea: true, ahora: t.ahora, ...x }),
    nota(r) { if (r?.vista) t.revision = r.vista.revision; return r },
    leer: async () => { const r = await leerSesion(almacen, id, t.ctx()); if (r.ok) t.revision = r.sesion.revision; return r },
    estado: async () => ver(await leerEstado(ligaId, juego, token)),
    async prep() { return ver(await exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/partidos/${juego}/preparacion`, { headers: { authorization: `Bearer ${token}` } }))) },
    async hidratar() {
      const est = await t.estado()
      const s = construirSesion({ ligaId, partidoId: juego, cuerpoEstado: est.cuerpo })
      expect(s.ok, JSON.stringify(s)).toBe(true)
      return t.nota(await crearSesion(almacen, s.sesion))
    },
    async encolar(orden, ahora = t.ahora) { await t.leer(); t.ahora = ahora; return t.nota(await encolar(almacen, { id, revision: t.revision, orden, ctx: t.ctx() })) },
    async inicio() {
      const p = await t.prep()
      const l = await t.leer()
      expect(evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: l.entradas, preparacion: p.cuerpo.preparacion })).toEqual({ puede: true })
      const o = ordenDeInicio({ cmdId: cmd('ini'), preparacion: p.cuerpo.preparacion, tiempo: tiempo(SERVIDOR - 1000), sesion: l.sesion }).orden
      expect((await t.encolar(o)).ok).toBe(true)
      return o
    },
    punto: (extra = {}) => ({ cmdId: cmd('pto'), tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, tiempo: tiempo(SERVIDOR - 500), ...extra }),
    red: { enLinea: true },
    prop: { propietario: true },
    nuevoEmisor(extra = {}) {
      return crearEmisor({
        almacen, id, cliente: extra.cliente ?? cliente,
        propiedad: { esPropietario: () => t.prop.propietario }, conexion: { enLinea: () => t.red.enLinea },
        reloj: reloj === undefined ? { estimar: () => ({ nivel: 'confiable', estimadoMs: SERVIDOR }) } : reloj,
        ctx: () => ({ ahoraEstimado: SERVIDOR, actorId: 'emisor', enLinea: true, ahora: SERVIDOR }),
        setTimeoutImpl: (fn, ms) => { esperas.push(ms); return setTimeout(fn, 0) }, clearTimeoutImpl: (x) => clearTimeout(x),
        azar: () => 0.5, ...extra,
      })
    },
  }
  return t
}
const correr = async (emisor) => { emisor.despertar(); await emisor.reposo() }
/** Vigencia de una credencial ACTIVADA (72 h activa + 7 d de solo reintento) sobre la credencial sintética ya sembrada. */
async function vigencia(t, desde = SERVIDOR) {
  const expira = desde + 72 * H
  const retorno = expira + 7 * 24 * H
  await dentro(t.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", expira, retorno).toArray())
  return { expira, retorno }
}

describe('E3a — el emisor real contra el Worker real: aceptado, repetido y rechazado', () => {
  it('inicio y puntos: se envían en orden con los bytes exactos, cada recibo se persiste antes del siguiente y SOLO el recibo de inicio habilita la puntuación', async () => {
    const t = await entorno()
    await t.hidratar()
    const o = await t.inicio()
    expect((await t.leer()).vista.puntuacion.habilitada).toBe(false)
    const emisor = t.nuevoEmisor()
    await correr(emisor) // solo el inicio
    expect(t.llamadas).toHaveLength(1)
    expect((await t.leer()).vista.puntuacion.habilitada).toBe(true)
    for (let i = 0; i < 3; i += 1) expect((await t.encolar(t.punto())).ok).toBe(true)
    const guardados = (await t.leer()).entradas.map((f) => f.cuerpoJson)
    await correr(emisor)
    expect(emisor.estado().fase).toBe('inactivo')
    expect(t.llamadas.map((x) => x.cuerpo)).toEqual(guardados)
    expect(t.llamadas.every((x) => x.url === `/v1/ligas/${t.ligaId}/partidos/P/comandos`)).toBe(true)
    const l = await t.leer()
    expect(l.entradas.map((f) => f.estado)).toEqual(['confirmada', 'confirmada', 'confirmada', 'confirmada'])
    expect(l.sesion.inicio).toBe('confirmado')
    expect(l.entradas[0].cmdId).toBe(o.cmdId)
    expect(await emisor.verificarAhora()).toMatchObject({ ok: true, sincronizada: true })
    expect((await t.leer()).sesion.verificacion.nivel).toBe('verificada')
    await emisor.cerrar()
  }, 60_000) // varias decenas de llamadas reales seguidas: con la suite entera en paralelo supera los 5 s por omisión

  it('respuesta PERDIDA después de confirmar: el emisor reintenta el MISMO texto y el Worker devuelve recibo-existente; hasta entonces no hay puntuación', async () => {
    let primera = true
    const t = await entorno({ envolver: (f) => async (url, init) => { const r = await f(url, init); if (primera) { primera = false; throw new TypeError('respuesta perdida') } return r } })
    await t.hidratar(); await t.inicio()
    const emisor = t.nuevoEmisor()
    await correr(emisor)
    expect(t.llamadas).toHaveLength(2)
    expect(t.llamadas[1].cuerpo).toBe(t.llamadas[0].cuerpo)
    expect(t.esperas).toEqual([1000]) // espera pedida (sin jitter con azar 0,5)
    expect(t.tamanos[1].status).toBe(200)
    const l = await t.leer()
    expect(l.entradas[0]).toMatchObject({ estado: 'confirmada', intentos: 2 })
    expect(l.sesion.inicio).toBe('confirmado')
    const otra = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: l.entradas[0].cuerpoJson }))
    expect(otra.cuerpo.resultado).toBe('recibo-existente')
    expect(await aplicarRecibo(t.almacen, { id: t.id, revision: l.sesion.revision, recibo: otra.cuerpo.recibo, ctx: t.ctx() })).toMatchObject({ ok: true, noop: true })
    await emisor.cerrar()
  })

  it('rechazo definitivo real (tiempo-invalido): el emisor se detiene y las dependientes NO se envían', async () => {
    const t = await entorno()
    await t.hidratar(); await t.inicio()
    const emisor = t.nuevoEmisor()
    await correr(emisor)
    const futura = SERVIDOR + 10_000
    expect((await t.encolar({ cmdId: cmd('arr'), tipo: 'arrancar-reloj', datos: {}, tiempo: tiempo(futura) }, futura)).ok).toBe(true)
    for (let i = 0; i < 2; i += 1) expect((await t.encolar(t.punto({ tiempo: tiempo(futura) }), futura)).ok).toBe(true)
    const e2 = t.nuevoEmisor({ reloj: { estimar: () => ({ nivel: 'confiable', estimadoMs: futura }) } })
    await correr(e2)
    expect(t.llamadas).toHaveLength(2) // inicio + la orden rechazada
    const l = await t.leer()
    expect(l.entradas.map((f) => f.estado)).toEqual(['confirmada', 'rechazada', 'no-aplicada', 'no-aplicada'])
    expect(l.entradas[1].recibo).toMatchObject({ resultado: 'rechazado', motivo: 'tiempo-invalido' })
    expect(e2.estado()).toMatchObject({ fase: 'detenida', causa: 'rechazo-definitivo' })
    await correr(e2)
    expect(t.llamadas).toHaveLength(2)
    await emisor.cerrar(); await e2.cerrar()
  })

  it('límites de hora ya existentes: +2000 ms sobre la hora del servidor se acepta, +2001 se rechaza', async () => {
    for (const [mas, resultado] of [[2000, 'confirmada'], [2001, 'rechazada']]) {
      const t = await entorno()
      await t.hidratar(); await t.inicio()
      const emisor = t.nuevoEmisor()
      await correr(emisor)
      const ts = SERVIDOR + mas
      expect((await t.encolar({ cmdId: cmd('arr'), tipo: 'arrancar-reloj', datos: {}, tiempo: tiempo(ts) }, ts)).ok).toBe(true)
      const e2 = t.nuevoEmisor({ reloj: { estimar: () => ({ nivel: 'confiable', estimadoMs: ts }) } })
      await correr(e2)
      expect((await t.leer()).entradas[1].estado, `+${mas}`).toBe(resultado)
      await emisor.cerrar(); await e2.cerrar()
    }
  })

  it('retención por reloj: una orden de reloj con hora adelantada espera lo justo (sin reescribir el sobre) y luego es aceptada', async () => {
    const ts = SERVIDOR + 1500
    let ahora = SERVIDOR // el reloj estimado avanza cuando se cumple la espera
    const t = await entorno({ reloj: { estimar: () => ({ nivel: 'confiable', estimadoMs: ahora }) } })
    await t.hidratar(); await t.inicio()
    const inicio = t.nuevoEmisor()
    await correr(inicio)
    expect((await t.encolar({ cmdId: cmd('arr'), tipo: 'arrancar-reloj', datos: {}, tiempo: tiempo(ts) }, ts)).ok).toBe(true)
    const antes = (await t.leer()).entradas[1].cuerpoJson
    const emisor = t.nuevoEmisor({ setTimeoutImpl: (fn, ms) => { t.esperas.push(ms); ahora += ms; return setTimeout(fn, 0) } })
    await correr(emisor)
    expect(t.esperas).toEqual([500]) // 1500 − 1000 de margen
    expect(t.llamadas[1].cuerpo).toBe(antes)
    expect((await t.leer()).entradas[1].estado).toBe('confirmada')
    await inicio.cerrar(); await emisor.cerrar()
  })
})

describe('E3b — credenciales de solo reintento', () => {
  it('en modo recuperación un reintento EXACTO de una orden ya aceptada devuelve su recibo; una orden nueva es 401 y se persiste como parada', async () => {
    let primera = true
    const t = await entorno({ envolver: (f) => async (url, init) => { const r = await f(url, init); if (primera) { primera = false; throw new TypeError('respuesta perdida') } return r } })
    await t.hidratar(); await t.inicio()
    const { expira, retorno } = await vigencia(t)
    expect(SERVIDOR + 73 * H).toBeGreaterThan(expira)
    expect(SERVIDOR + 73 * H).toBeLessThan(retorno)
    const emisor = t.nuevoEmisor({ setTimeoutImpl: (fn, ms) => { t.esperas.push(ms); control.ahoraMs = SERVIDOR + 73 * H; return setTimeout(fn, 0) } })
    await correr(emisor) // el primer intento confirma en el servidor y se pierde; el reintento ya ocurre en modo recuperación
    expect(t.tamanos.map((x) => x.status)).toEqual([200, 200])
    expect((await t.leer()).entradas[0]).toMatchObject({ estado: 'confirmada', intentos: 2 })
    expect((await t.leer()).sesion.inicio).toBe('confirmado')
    // una orden NUEVA: la credencial ya no sirve para nada nuevo → 401 genérico → parada persistida
    expect((await t.encolar(t.punto())).ok).toBe(true)
    await correr(emisor)
    expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', clase: 'no-autorizado', persistida: true })
    const l = await t.leer()
    expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', clase: 'no-autorizado', http: 401 })
    expect(l.entradas[1]).toMatchObject({ estado: 'enviando', recibo: null })
    expect(await t.cliente.leerEstado()).toEqual({ clase: 'sin-credencial', http: 401 })
    expect(await t.cliente.leerPreparacion()).toEqual({ clase: 'sin-credencial', http: 401 })
    await emisor.cerrar()
  })

  it('con la credencial ya muerta (pasada la ventana) incluso el reintento exacto es 401: parada persistida, ningún recibo fabricado', async () => {
    let primera = true
    const t = await entorno({ envolver: (f) => async (url, init) => { const r = await f(url, init); if (primera) { primera = false; throw new TypeError('respuesta perdida') } return r } })
    await t.hidratar(); await t.inicio()
    const { retorno } = await vigencia(t)
    const emisor = t.nuevoEmisor({ setTimeoutImpl: (fn, ms) => { t.esperas.push(ms); control.ahoraMs = retorno + 1; return setTimeout(fn, 0) } })
    await correr(emisor)
    expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', clase: 'no-autorizado' })
    const l = await t.leer()
    expect(l.entradas[0]).toMatchObject({ estado: 'enviando', recibo: null })
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(l.vista.puntuacion.habilitada).toBe(false)
    await emisor.cerrar()
  })
})

describe('E3c — 503 reales y las demás clases de parada reales', () => {
  it('«fallo-sin-escritura» REAL (un fallo de almacenamiento en el servidor): el emisor reintenta el mismo sobre y luego se acepta', async () => {
    const t = await entorno()
    await t.hidratar(); await t.inicio()
    await dentro(t.ligaId, (inst) => inst.almacen.sql.exec("CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END").toArray())
    let visto = null
    const emisor = t.nuevoEmisor({
      cliente: crearClienteSesion({
        ligaId: t.ligaId, partidoId: 'P', token: t.token,
        fetchImpl: async (url, init) => {
          const r = await fetchReal(url, init)
          if (visto === null) { visto = { status: r.status, texto: await r.clone().text() }; await dentro(t.ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER fallo_bandeja').toArray()) }
          return r
        },
      }),
    })
    await correr(emisor)
    expect([500, 503]).toContain(visto.status)
    expect(JSON.parse(visto.texto)).toMatchObject({ tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura' })
    expect(visto.texto).not.toMatch(/SQL|trigger|detalle|RAISE/i)
    expect((await t.leer()).entradas[0]).toMatchObject({ estado: 'confirmada', intentos: 2 })
    await emisor.cerrar()
  })

  it('«resultado-desconocido» REAL (503 del propio Worker ante una excepción): conserva la incertidumbre y el reintento se resuelve', async () => {
    const t = await entorno()
    await t.hidratar(); await t.inicio()
    let primera = true
    const emisor = t.nuevoEmisor({
      cliente: crearClienteSesion({
        ligaId: t.ligaId, partidoId: 'P', token: t.token,
        fetchImpl: async (url, init) => {
          if (primera) {
            primera = false
            const falso = { ...env, LIGA: { idFromName: (x) => env.LIGA.idFromName(x), get: () => ({ ejecutarComando: async () => { throw new Error('SQLITE_ERROR stack at detalle') } }) } }
            return worker.fetch(new Request(`${BASE}${url}`, { method: init.method, headers: init.headers, body: init.body }), falso)
          }
          return fetchReal(url, init)
        },
      }),
    })
    await correr(emisor)
    expect((await t.leer()).entradas[0]).toMatchObject({ estado: 'confirmada', intentos: 2 })
    await emisor.cerrar()
  })

  /** Cada parada REAL: se provoca la respuesta auténtica del Worker modificando la petición, y el emisor la persiste. */
  const PROVOCACIONES = {
    '401 (token inválido)': { esperado: { clase: 'no-autorizado', http: 401 }, mutar: (url, init) => [url, { ...init, headers: { ...init.headers, authorization: 'Bearer token-que-no-existe-0000' } }] },
    '400 juego-distinto': { esperado: { clase: 'protocolo', subtipo: 'juego-distinto', http: 400 }, mutar: (url, init) => [url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), gameId: 'Q' }) }] },
    '400 json-invalido': { esperado: { clase: 'protocolo', subtipo: 'json-invalido', http: 400 }, mutar: (url, init) => [url, { ...init, body: '{no es json' }] },
    '413 cuerpo-demasiado-grande': { esperado: { clase: 'protocolo', subtipo: 'cuerpo-demasiado-grande', http: 413 }, mutar: (url, init) => [url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), relleno: 'x'.repeat(70 * 1024) }) }] },
    '404 liga no admitida': { esperado: { clase: 'protocolo', subtipo: 'no-encontrado', http: 404 }, mutar: (url, init) => [url.replace(/ligas\/[^/]+/, 'ligas/LIGA9999'), init] },
    '422 sobre-invalido': { esperado: { clase: 'sobre-invalido', http: 422 }, mutar: (url, init) => [url, { ...init, body: JSON.stringify({ gameId: 'P' }) }] },
  }
  for (const [nombre, { esperado, mutar }] of Object.entries(PROVOCACIONES)) {
    it(`${nombre}: respuesta real del Worker → parada persistida; la orden sigue incierta; ningún envío posterior (tampoco tras recargar)`, async () => {
      const t = await entorno({ envolver: (f) => (url, init) => f(...mutar(url, init)) })
      await t.hidratar(); await t.inicio()
      const emisor = t.nuevoEmisor()
      await correr(emisor)
      expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', persistida: true, ...esperado })
      const l = await t.leer()
      expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', ...esperado })
      expect(l.entradas[0]).toMatchObject({ estado: 'enviando', recibo: null })
      expect(l.sesion.inicio).toBe('sin-iniciar')
      expect(t.llamadas).toHaveLength(1)
      const otro = t.nuevoEmisor()
      await correr(otro)
      expect(t.llamadas).toHaveLength(1)
      await emisor.cerrar(); await otro.cerrar()
    })
  }

  it('405 real (método distinto en la ruta de comandos de una liga admitida)', async () => {
    let tok = null
    const t = await entorno({ envolver: () => async (url) => exports.default.fetch(new Request(`${BASE}${url}`, { method: 'GET', headers: { authorization: `Bearer ${tok}` } })) })
    tok = t.token
    await t.hidratar(); await t.inicio()
    const emisor = t.nuevoEmisor()
    await correr(emisor)
    expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', clase: 'protocolo', subtipo: 'metodo-no-permitido', http: 405 })
    await emisor.cerrar()
  })

  it('409 reales: secuencia-ocupada (otro dispositivo usó el número) y bloqueado (el servidor bloqueó el partido)', async () => {
    const t = await entorno()
    await t.hidratar(); const o = await t.inicio()
    const sobre = JSON.parse((await t.leer()).entradas[0].cuerpoJson)
    expect((await ver(await postComando(t.ligaId, 'P', t.token, { ...sobre, cmdId: cmd('otro') }))).cuerpo.resultado).toBe('aceptado')
    const emisor = t.nuevoEmisor()
    await correr(emisor)
    expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', clase: 'conflicto', subtipo: 'secuencia-ocupada', http: 409 })
    expect((await t.leer()).entradas[0]).toMatchObject({ cmdId: o.cmdId, estado: 'enviando', recibo: null })
    await emisor.cerrar()
    const u = await entorno()
    await u.hidratar(); await u.inicio()
    await dentro(u.ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET bloqueo_json = '{\"por\":\"organizador\"}', version_bloqueo = version_bloqueo + 1 WHERE id = 'P'"))
    const em2 = u.nuevoEmisor()
    await correr(em2)
    expect(em2.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', clase: 'conflicto', subtipo: 'bloqueado' })
    await em2.cerrar()
  })
})

describe('E3d — límites del adaptador frente a los endpoints reales', () => {
  it('ningún cuerpo real se acerca a su límite; el tope de /estado del servidor (1 MiB) cabe en el del adaptador; el 507 real se clasifica', async () => {
    const t = await entorno()
    await t.hidratar(); await t.inicio()
    const futura = SERVIDOR + 10_000
    const emisor = t.nuevoEmisor()
    await correr(emisor)
    await t.encolar({ cmdId: cmd('arr'), tipo: 'arrancar-reloj', datos: {}, tiempo: tiempo(futura) }, futura) // será RECHAZADO (200 con motivo y detalle)
    const e2 = t.nuevoEmisor({ reloj: { estimar: () => ({ nivel: 'confiable', estimadoMs: futura }) } })
    await correr(e2)
    const bytes = (texto) => new TextEncoder().encode(texto).length
    const medidas = { comando200: Math.max(...t.tamanos.filter((x) => x.url.endsWith('/comandos')).map((x) => x.bytes)) }
    const sobre = JSON.parse((await t.leer()).entradas[0].cuerpoJson)
    const repetido = await ver(await postComando(t.ligaId, 'P', t.token, sobre))
    medidas.comandoRepetido = bytes(repetido.texto)
    const conflicto = await ver(await postComando(t.ligaId, 'P', t.token, { ...sobre, accionTs: sobre.accionTs + 1, accionTsCrudo: sobre.accionTsCrudo + 1 }))
    expect(conflicto.status).toBe(409)
    medidas.conflictoContenido = bytes(conflicto.texto)
    medidas.estado = bytes((await t.estado()).texto)
    medidas.preparacion = bytes((await t.prep()).texto)
    medidas.muestra = bytes((await ver(await exports.default.fetch(new Request(`${BASE}/v1/ligas/${t.ligaId}/partidos/P`)))).texto)
    expect(medidas.comando200).toBeLessThan(LIMITES_API.comando.bytes / 4)
    expect(medidas.conflictoContenido).toBeLessThan(LIMITES_API.comando.bytes / 4)
    expect(medidas.preparacion).toBeLessThan(LIMITES_API.preparacion.bytes / 4)
    expect(medidas.muestra).toBeLessThan(LIMITES_API.muestra.bytes / 8)
    expect(medidas.estado).toBeLessThan(LIMITES_API.estado.bytes / 4)
    // el servidor no responde con más de 1 MiB en /estado (507 si pasa); el adaptador acepta hasta 1,1 MiB
    expect(LIMITES_API.estado.bytes).toBeGreaterThan(LIMITES_ESTADO_CONTROL.maxBytes)
    // 507 real (tope bajado solo en la prueba) → «demasiado-grande», nunca un estado
    control.limitesEstado = { maxEventos: 0, maxBytes: 10 }
    expect(await t.cliente.leerEstado()).toEqual({ clase: 'demasiado-grande', http: 507 })
    control.limitesEstado = null
    // la muestra pública real se clasifica con el tiempo del servidor
    const m = await t.cliente.tomarMuestra()
    expect(m).toMatchObject({ clase: 'ok', http: 200 })
    expect(Number.isSafeInteger(m.servidorAhoraMs)).toBe(true)
    // eslint-disable-next-line no-console
    console.log('MEDIDAS_REALES_BYTES', JSON.stringify(medidas))
    await emisor.cerrar(); await e2.cerrar()
  })
})
