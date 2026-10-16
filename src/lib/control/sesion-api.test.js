import { describe, expect, it } from 'vitest'
import { LIMITES_API, RETRY_AFTER_MAX_MS, crearClienteSesion, leerRetryAfter } from './sesion-api'
import { relojVirtual, respuesta, tick } from './prueba/auxiliares-emisor'

// REPORT_124: el adaptador de red. `fetch` es un doble: aquí no hay red. Se comprueba la forma de la petición, que el token no
// se filtre, el acotado de bytes y tiempo, y que SOLO las formas exactas conocidas se clasifican (nada se fabrica).

const TOKEN = 'TOKEN-SECRETO-DE-PRUEBA'
function nuevo({ fetchImpl, token = TOKEN, ids = ['LIGA1', 'P1'], limites } = {}) {
  const rv = relojVirtual()
  const llamadas = []
  const f = (url, init) => { llamadas.push({ url, init }); return fetchImpl(url, init) }
  const cliente = crearClienteSesion({
    ligaId: ids[0], partidoId: ids[1], token, fetchImpl: f, setTimeoutImpl: rv.setTimeoutImpl, clearTimeoutImpl: rv.clearTimeoutImpl, monoAhora: rv.monoAhora, paredAhora: () => Date.parse('2026-01-01T00:00:00Z'), ...(limites ? { limites } : {}),
  })
  return { cliente, llamadas, rv }
}
const ok = (cuerpo) => () => Promise.resolve(respuesta(200, cuerpo))
const flujo = (trozos, { cabeceras = {}, status = 200, tipo = 'application/json; charset=utf-8', espera = null } = {}) => {
  let i = 0
  const estado = { cancelado: false, leidos: 0 }
  const body = new ReadableStream({
    async pull(c) {
      if (espera) await espera
      if (i >= trozos.length) { c.close(); return }
      estado.leidos += 1
      c.enqueue(typeof trozos[i] === 'string' ? new TextEncoder().encode(trozos[i++]) : trozos[i++])
    },
    cancel() { estado.cancelado = true },
  })
  return { resp: new Response(body, { status, headers: { 'content-type': tipo, ...cabeceras } }), estado }
}
const RECIBO = { resultado: 'aceptado', revDespues: 1, cmdId: 'c', gameId: 'P1' }
const COMANDO = '{"cmdId":"c1","gameId":"P1"}'

describe('forma de la petición', () => {
  it('URL relativa y mismo origen, banderas de privacidad, texto exacto y token SOLO en Authorization de las rutas protegidas', async () => {
    const { cliente, llamadas } = nuevo({ fetchImpl: ok({ resultado: 'aceptado', recibo: RECIBO, publicacion: {} }) })
    await cliente.enviarComando(COMANDO)
    const { url, init } = llamadas[0]
    expect(url).toBe('/v1/ligas/LIGA1/partidos/P1/comandos')
    expect(url).not.toContain(TOKEN)
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', body: COMANDO })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` })
    const g = nuevo({ fetchImpl: ok({ version: 1 }) })
    await g.cliente.leerEstado(); await g.cliente.leerPreparacion()
    await nuevo({ fetchImpl: ok({}) }).cliente.tomarMuestra()
    expect(g.llamadas.map((l) => l.url)).toEqual(['/v1/ligas/LIGA1/partidos/P1/estado', '/v1/ligas/LIGA1/partidos/P1/preparacion'])
    expect(g.llamadas.every((l) => l.init.method === 'GET' && l.init.body === undefined && l.init.headers.authorization === `Bearer ${TOKEN}`)).toBe(true)
    const m = nuevo({ fetchImpl: ok({ servidorAhoraMs: 5 }) })
    await m.cliente.tomarMuestra()
    expect(m.llamadas[0].url).toBe('/v1/ligas/LIGA1/partidos/P1')
    expect(m.llamadas[0].init.headers.authorization).toBeUndefined() // la lectura pública no lleva credencial
    expect(m.llamadas[0].init.credentials).toBe('omit')
  })

  it('identificadores inválidos: no se construye ninguna URL ni se llama a fetch', async () => {
    for (const ids of [['a/b', 'P'], ['L', '..'], ['L', 'P?x=1'], ['', 'P'], ['L', 'x'.repeat(65)], ['L', 'é'], [undefined, 'P']]) {
      const { cliente, llamadas } = nuevo({ fetchImpl: ok({}), ids })
      for (const r of [await cliente.enviarComando(COMANDO), await cliente.leerEstado(), await cliente.leerPreparacion(), await cliente.tomarMuestra()]) {
        expect(r).toEqual({ clase: 'configuracion', motivo: 'id-invalido' })
      }
      expect(llamadas).toHaveLength(0)
    }
  })

  it('sin token, o sin texto de sobre: configuración, sin red; el token puede ser una función leída en cada llamada', async () => {
    for (const token of [() => undefined, '', null, () => '', () => { throw new Error('x') }]) {
      const { cliente, llamadas } = nuevo({ fetchImpl: ok({}), token })
      expect(await cliente.enviarComando(COMANDO)).toEqual({ clase: 'configuracion', motivo: 'sin-token' })
      expect(await cliente.leerEstado()).toEqual({ clase: 'configuracion', motivo: 'sin-token' })
      expect(llamadas).toHaveLength(0)
    }
    const { cliente, llamadas } = nuevo({ fetchImpl: ok({}) })
    expect(await cliente.enviarComando('')).toEqual({ clase: 'configuracion', motivo: 'sobre-ausente' })
    expect(await cliente.enviarComando({ no: 'texto' })).toEqual({ clase: 'configuracion', motivo: 'sobre-ausente' })
    expect(llamadas).toHaveLength(0)
    let actual = 'uno'
    const g = nuevo({ fetchImpl: ok({ version: 1 }), token: () => actual })
    await g.cliente.leerEstado(); actual = 'dos'; await g.cliente.leerEstado()
    expect(g.llamadas.map((l) => l.init.headers.authorization)).toEqual(['Bearer uno', 'Bearer dos'])
  })

  it('el token no aparece en ningún resultado, ni siquiera cuando fetch falla con un mensaje que lo contiene', async () => {
    const respuestas = [
      () => Promise.reject(new Error(`fallo con Bearer ${TOKEN}`)),
      () => { throw new Error(`sync ${TOKEN}`) },
      ok({ resultado: 'aceptado', recibo: RECIBO, publicacion: {} }),
      () => Promise.resolve(respuesta(401, { error: 'no-autorizado' })),
      () => Promise.resolve(respuesta(500, null, { texto: `<html>${TOKEN}</html>`, tipo: 'text/html' })),
    ]
    for (const f of respuestas) {
      const { cliente } = nuevo({ fetchImpl: f })
      for (const r of [await cliente.enviarComando(COMANDO), await cliente.leerEstado(), await cliente.leerPreparacion()]) {
        expect(JSON.stringify(r)).not.toContain(TOKEN)
      }
    }
  })
})

describe('acotado de bytes, decodificación y tiempo', () => {
  const grande = (n) => 'x'.repeat(n)
  it('flujo sin content-length que pasa del límite: se cancela el flujo y NO es un recibo', async () => {
    const { resp, estado } = flujo([`{"relleno":"${grande(40 * 1024)}`, grande(40 * 1024), grande(40 * 1024), '"}'])
    const { cliente } = nuevo({ fetchImpl: () => Promise.resolve(resp) })
    const r = await cliente.enviarComando(COMANDO)
    expect(r).toMatchObject({ clase: 'incierta', motivo: 'demasiado-grande', malformada: true })
    expect(estado.cancelado).toBe(true)
    expect(estado.leidos).toBeLessThan(4)
  })
  it('content-length declarado por encima del límite: se rechaza sin leer el cuerpo', async () => {
    const { resp, estado } = flujo(['{}'], { cabeceras: { 'content-length': String(LIMITES_API.comando.bytes + 1) } })
    const { cliente } = nuevo({ fetchImpl: () => Promise.resolve(resp) })
    expect(await cliente.enviarComando(COMANDO)).toMatchObject({ clase: 'incierta', motivo: 'demasiado-grande', malformada: true })
    expect(estado.cancelado).toBe(true)
  })
  it('el límite es exacto: justo el tope pasa a la validación; un byte más no', async () => {
    const relleno = (total) => { const base = '{"error":"juego-distinto","pad":""}'; return base.replace('""', `"${'a'.repeat(total - base.length)}"`) }
    const justo = relleno(LIMITES_API.comando.bytes)
    expect(new TextEncoder().encode(justo).length).toBe(LIMITES_API.comando.bytes)
    const a = nuevo({ fetchImpl: () => Promise.resolve(respuesta(400, null, { texto: justo })) })
    expect(await a.cliente.enviarComando(COMANDO)).toMatchObject({ clase: 'incierta', motivo: 'respuesta-inesperada', malformada: true }) // leído completo; forma desconocida
    const b = nuevo({ fetchImpl: () => Promise.resolve(respuesta(400, null, { texto: justo + ' ' })) })
    expect(await b.cliente.enviarComando(COMANDO)).toMatchObject({ motivo: 'demasiado-grande' })
  })
  it('límites por tipo de lectura (REPORT_119)', () => {
    expect(LIMITES_API).toEqual({
      comando: { tiempoMs: 20_000, bytes: 64 * 1024 },
      muestra: { tiempoMs: 5_000, bytes: 16 * 1024 },
      preparacion: { tiempoMs: 15_000, bytes: 256 * 1024 },
      estado: { tiempoMs: 30_000, bytes: Math.round(1.1 * 1024 * 1024) },
    })
  })
  it('un cuerpo con la forma EXACTA de un recibo (o de un 401) pero con content-type que no es JSON no vale', async () => {
    const recibo = JSON.stringify({ resultado: 'aceptado', recibo: { resultado: 'aceptado' }, publicacion: {} })
    for (const tipo of ['text/html', 'text/plain', 'application/xml', 'application/json-patch+json', '']) {
      const r = await nuevo({ fetchImpl: () => Promise.resolve(respuesta(200, null, { texto: recibo, tipo })) }).cliente.enviarComando(COMANDO)
      expect(r, tipo).toMatchObject({ clase: 'incierta', motivo: 'no-json', malformada: true })
      const u = await nuevo({ fetchImpl: () => Promise.resolve(respuesta(401, null, { texto: '{"error":"no-autorizado"}', tipo })) }).cliente.enviarComando(COMANDO)
      expect(u.clase, tipo).toBe('incierta')
    }
  })
  it('UTF-8 inválido, content-type distinto, charset distinto y JSON ilegible: ninguno es un recibo', async () => {
    const malos = [
      respuesta(200, null, { texto: '{"a":1}', tipo: 'text/html' }),
      respuesta(200, null, { texto: '{"a":1}', tipo: 'application/json; charset=latin1' }),
      respuesta(200, null, { texto: '{"a":1}', tipo: '' }),
      new Response(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), { status: 200, headers: { 'content-type': 'application/json' } }),
      respuesta(200, null, { texto: '{"resultado":' }),
      respuesta(200, null, { texto: '' }),
    ]
    for (const m of malos) {
      const { cliente } = nuevo({ fetchImpl: () => Promise.resolve(m.clone()) })
      expect(await cliente.enviarComando(COMANDO)).toMatchObject({ clase: 'incierta', malformada: true })
    }
    const bien = nuevo({ fetchImpl: ok({ error: 'no-autorizado' }) })
    expect(bien.cliente).toBeTruthy()
  })
  it('tiempo agotado antes de las cabeceras y a mitad del cuerpo: «timeout» (incierta, no malformada), con la señal abortada', async () => {
    const colgado = nuevo({ fetchImpl: () => new Promise(() => {}) })
    const p = colgado.cliente.enviarComando(COMANDO)
    await tick()
    expect(colgado.rv.timers).toHaveLength(1)
    expect(colgado.rv.timers[0].en - colgado.rv.mono).toBe(20_000)
    colgado.rv.dispararSiguiente()
    expect(await p).toMatchObject({ clase: 'incierta', motivo: 'timeout', malformada: false })
    expect(colgado.llamadas[0].init.signal.aborted).toBe(true)
    // a mitad del cuerpo
    let suelta
    const espera = new Promise((r) => { suelta = r })
    const { resp } = flujo(['{"resu'], { espera: null })
    const lento = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"resu')) }, pull() { return espera } }), { status: 200, headers: { 'content-type': 'application/json' } })
    const b = nuevo({ fetchImpl: () => Promise.resolve(lento) })
    const q = b.cliente.enviarComando(COMANDO)
    await tick(); await tick()
    b.rv.dispararSiguiente()
    expect(await q).toMatchObject({ clase: 'incierta', motivo: 'timeout' })
    suelta(); void resp
    expect(b.rv.timers).toHaveLength(0)
  })
  it('un fetch que IGNORA la señal tampoco retiene al llamador: la cancelación y el tiempo mandan', async () => {
    const { cliente } = nuevo({ fetchImpl: () => new Promise(() => {}) })
    const ac = new AbortController()
    const p = cliente.enviarComando(COMANDO, { signal: ac.signal })
    await tick()
    ac.abort()
    expect(await p).toEqual({ clase: 'cancelada' })
    const previa = new AbortController(); previa.abort()
    expect(await cliente.enviarComando(COMANDO, { signal: previa.signal })).toEqual({ clase: 'cancelada' })
  })
  it('nunca lanza: fetch devuelve basura, undefined o lanza', async () => {
    for (const f of [() => undefined, () => ({}), () => null, () => { throw new TypeError('x') }, () => Promise.reject(null), () => Promise.resolve({ status: 'abc' })]) {
      const { cliente } = nuevo({ fetchImpl: f })
      for (const m of ['enviarComando', 'leerEstado', 'leerPreparacion', 'tomarMuestra']) {
        const r = await cliente[m](COMANDO)
        expect(['incierta', 'cancelada']).toContain(r.clase)
      }
    }
  })
})

describe('clasificación de /comandos (solo las formas exactas)', () => {
  const clasificar = async (resp) => (await nuevo({ fetchImpl: () => Promise.resolve(resp) }).cliente.enviarComando(COMANDO))
  it('200: aceptado, rechazado y recibo-existente (de cualquiera de los dos) → «recibo»', async () => {
    expect(await clasificar(respuesta(200, { resultado: 'aceptado', recibo: { resultado: 'aceptado' }, publicacion: { rev: 1 } }))).toMatchObject({ clase: 'recibo', resultado: 'aceptado', repetido: false })
    expect(await clasificar(respuesta(200, { resultado: 'rechazado', recibo: { resultado: 'rechazado' }, publicacion: 'no-aplica' }))).toMatchObject({ clase: 'recibo', resultado: 'rechazado' })
    for (const d of ['aceptado', 'rechazado']) {
      expect(await clasificar(respuesta(200, { resultado: 'recibo-existente', recibo: { resultado: d }, publicacion: 'no-aplica' }))).toMatchObject({ clase: 'recibo', repetido: true })
    }
  })
  it('200 inconsistente o con otra forma → incierta malformada', async () => {
    for (const c of [
      { resultado: 'aceptado', recibo: { resultado: 'rechazado' }, publicacion: 1 }, { resultado: 'rechazado', recibo: { resultado: 'aceptado' }, publicacion: 1 },
      { resultado: 'recibo-existente', recibo: { resultado: 'otro' }, publicacion: 1 }, { resultado: 'x', recibo: {}, publicacion: 1 },
      { resultado: 'aceptado', recibo: [], publicacion: 1 }, { resultado: 'aceptado', recibo: { resultado: 'aceptado' } }, [], null, 7,
    ]) {
      expect(await clasificar(respuesta(200, c)), JSON.stringify(c)).toMatchObject({ clase: 'incierta', malformada: true })
    }
  })
  it('errores de la API: 401, 400, 404, 405, 413, 422 y los cuatro 409', async () => {
    expect(await clasificar(respuesta(401, { error: 'no-autorizado' }))).toEqual({ clase: 'no-autorizado', http: 401 })
    expect(await clasificar(respuesta(400, { error: 'juego-distinto' }))).toEqual({ clase: 'protocolo', http: 400, subtipo: 'juego-distinto' })
    expect(await clasificar(respuesta(400, { error: 'json-invalido' }))).toEqual({ clase: 'protocolo', http: 400, subtipo: 'json-invalido' })
    expect(await clasificar(respuesta(404, { error: 'no-encontrado' }))).toMatchObject({ clase: 'protocolo', http: 404 })
    expect(await clasificar(respuesta(405, { error: 'metodo-no-permitido' }))).toMatchObject({ clase: 'protocolo', http: 405 })
    expect(await clasificar(respuesta(413, { error: 'cuerpo-demasiado-grande' }))).toMatchObject({ clase: 'protocolo', http: 413 })
    expect(await clasificar(respuesta(422, { error: 'sobre-invalido', errores: ['a'] }))).toEqual({ clase: 'sobre-invalido', http: 422 })
    expect(await clasificar(respuesta(409, { tipo: 'bloqueado' }))).toEqual({ clase: 'conflicto', http: 409, subtipo: 'bloqueado' })
    expect(await clasificar(respuesta(409, { tipo: 'hueco', esperado: 3 }))).toMatchObject({ subtipo: 'hueco' })
    expect(await clasificar(respuesta(409, { tipo: 'secuencia-ocupada', ocupadaPor: null }))).toMatchObject({ subtipo: 'secuencia-ocupada' })
    expect(await clasificar(respuesta(409, { tipo: 'conflicto-contenido', reciboOriginal: { cmdId: 'x' } }))).toMatchObject({ subtipo: 'conflicto-contenido' })
  })
  it('errores con claves de más o valores raros, estados desconocidos y redirecciones NO se clasifican como parada ni rechazo', async () => {
    const malos = [
      respuesta(401, { error: 'no-autorizado', x: 1 }), respuesta(401, {}), respuesta(400, { error: 'otro' }), respuesta(404, { error: 'juego-distinto' }),
      respuesta(422, { error: 'sobre-invalido' }), respuesta(422, { error: 'sobre-invalido', errores: 'x' }), respuesta(409, { tipo: 'hueco' }),
      respuesta(409, { tipo: 'hueco', esperado: 'x' }), respuesta(409, { tipo: 'bloqueado', extra: 1 }), respuesta(409, { tipo: 'conflicto-contenido', reciboOriginal: 5 }),
      respuesta(403, { error: 'no-autorizado' }), respuesta(418, {}), respuesta(301, {}), new Response(null, { status: 204 }),
    ]
    for (const m of malos) expect(await clasificar(m), `${m.status}`).toMatchObject({ clase: 'incierta', malformada: true })
  })
  it('503/500/429/5xx: incierta, no malformada; los fallos-sin-escritura exactos se distinguen y los inexactos no', async () => {
    expect(await clasificar(respuesta(503, { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }))).toMatchObject({ clase: 'incierta', motivo: 'resultado-desconocido', malformada: false })
    const sin = { tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo: 'contencion', reintento: 'mismo-sobre' }
    expect(await clasificar(respuesta(503, sin))).toMatchObject({ clase: 'sin-escritura', motivo: 'contencion' })
    expect(await clasificar(respuesta(500, { ...sin, motivo: 'interno' }))).toMatchObject({ clase: 'sin-escritura' })
    expect(await clasificar(respuesta(503, { ...sin, motivo: 'inventado' }))).toMatchObject({ clase: 'incierta', motivo: '5xx', malformada: false })
    expect(await clasificar(respuesta(503, { ...sin, extra: 1 }))).toMatchObject({ clase: 'incierta' })
    expect(await clasificar(respuesta(502, null, { texto: '<html>', tipo: 'text/html' }))).toMatchObject({ clase: 'incierta', motivo: '5xx', malformada: false })
    expect(await clasificar(respuesta(429, { error: 'x' }))).toMatchObject({ clase: 'incierta', motivo: '429' })
  })
})

describe('Retry-After', () => {
  it('segundos enteros y fecha HTTP válidos → milisegundos exactos; lo inválido → null', () => {
    const ahora = Date.parse('2026-01-01T00:00:00Z')
    expect(leerRetryAfter('7', ahora)).toBe(7000)
    expect(leerRetryAfter(' 0 ', ahora)).toBe(0)
    expect(leerRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', ahora)).toBe(30_000)
    expect(leerRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', ahora)).toBe(0)
    for (const malo of ['abc', '-5', '1.5', '', null, undefined, '1e3', String(RETRY_AFTER_MAX_MS / 1000 + 1), 'Thu, 99 Foo 2026']) expect(leerRetryAfter(malo, ahora), String(malo)).toBeNull()
  })
  it('se devuelve en 429, 503 y fallo-sin-escritura; nunca se acorta', async () => {
    const r = await nuevo({ fetchImpl: () => Promise.resolve(respuesta(429, { error: 'x' }, { cabeceras: { 'retry-after': '90' } })) }).cliente.enviarComando(COMANDO)
    expect(r.retryAfterMs).toBe(90_000)
  })
})

describe('lecturas', () => {
  it('acepta un cuerpo de /estado de EXACTAMENTE 1 MiB (el tope del servidor) y rechaza uno que pase de 1,1 MiB', async () => {
    const hasta = (total) => { const base = '{"version":1,"pad":""}'; return base.replace('""', `"${'a'.repeat(total - base.length)}"`) }
    const justo = hasta(1024 * 1024)
    expect(new TextEncoder().encode(justo).length).toBe(1024 * 1024)
    const a = await nuevo({ fetchImpl: () => Promise.resolve(respuesta(200, null, { texto: justo })) }).cliente.leerEstado()
    expect(a).toMatchObject({ clase: 'ok' })
    const b = await nuevo({ fetchImpl: () => Promise.resolve(respuesta(200, null, { texto: hasta(LIMITES_API.estado.bytes + 1) })) }).cliente.leerEstado()
    expect(b).toMatchObject({ motivo: 'demasiado-grande' })
  })
  it('estado: 200 válido, 401, 507, 503/5xx, oversize', async () => {
    const e = (resp) => nuevo({ fetchImpl: () => Promise.resolve(resp) }).cliente.leerEstado()
    expect(await e(respuesta(200, { version: 1, gameId: 'P1' }))).toMatchObject({ clase: 'ok', cuerpo: { gameId: 'P1' } })
    expect(await e(respuesta(200, { version: 2 }))).toMatchObject({ clase: 'incierta', malformada: true })
    expect(await e(respuesta(401, { error: 'no-autorizado' }))).toEqual({ clase: 'sin-credencial', http: 401 })
    expect(await e(respuesta(507, { error: 'estado-demasiado-grande' }))).toEqual({ clase: 'demasiado-grande', http: 507 })
    expect(await e(respuesta(503, { error: 'error-temporal' }))).toMatchObject({ clase: 'incierta', malformada: false })
    expect(await e(respuesta(200, null, { texto: '<html>', tipo: 'text/html' }))).toMatchObject({ clase: 'incierta', malformada: true })
    const grande = JSON.stringify({ version: 1, relleno: 'x'.repeat(LIMITES_API.estado.bytes) })
    expect(await e(respuesta(200, null, { texto: grande }))).toMatchObject({ motivo: 'demasiado-grande' })
  })
  it('preparación: forma exacta, 503 preparacion-no-disponible', async () => {
    const p = (resp) => nuevo({ fetchImpl: () => Promise.resolve(resp) }).cliente.leerPreparacion()
    expect(await p(respuesta(200, { preparacion: {}, etiquetas: [], rev: 1, ultimoClientSeq: 0 }))).toMatchObject({ clase: 'ok' })
    expect(await p(respuesta(200, { preparacion: {}, etiquetas: [], rev: 1 }))).toMatchObject({ clase: 'incierta', malformada: true })
    expect(await p(respuesta(503, { error: 'preparacion-no-disponible' }))).toEqual({ clase: 'no-disponible', http: 503 })
    expect(await p(respuesta(401, { error: 'no-autorizado' }))).toMatchObject({ clase: 'sin-credencial' })
  })
  it('muestra pública: hora del servidor y viaje de ida y vuelta con el reloj monótono inyectado; no estima nada', async () => {
    const { cliente, rv } = nuevo({ fetchImpl: () => { rv2.mono += 120; return Promise.resolve(respuesta(200, { servidorAhoraMs: 1_700_000_000_000 })) } })
    const rv2 = rv
    const r = await cliente.tomarMuestra()
    expect(r).toEqual({ clase: 'ok', http: 200, servidorAhoraMs: 1_700_000_000_000, rttMs: 120 })
    expect(Object.keys(r)).not.toContain('estimadoMs')
    const malo = await nuevo({ fetchImpl: ok({ servidorAhoraMs: 'x' }) }).cliente.tomarMuestra()
    expect(malo).toMatchObject({ clase: 'incierta', malformada: true })
  })
})
