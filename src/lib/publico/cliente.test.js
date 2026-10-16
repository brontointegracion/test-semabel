import { describe, expect, it, vi } from 'vitest'
import { LIMITE_BYTES, TIEMPO_ESPERA_MS, pedirJson, reintentoDe, rutaEquipo, rutaJuego, rutaLiga } from './cliente.js'

const json = (cuerpo, init = {}) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

describe('rutas', () => {
  it('solo se construyen las dos lecturas públicas, con IDs válidos', () => {
    expect(rutaLiga('LIGAPUB1')).toBe('/v1/ligas/LIGAPUB1/publico')
    expect(rutaJuego('LIGAPUB1', 'G1')).toBe('/v1/ligas/LIGAPUB1/partidos/G1')
    for (const malo of ['', 'a/b', '..', 'a b', 'x'.repeat(65), 'ñ']) {
      expect(() => rutaLiga(malo), malo).toThrow()
      expect(() => rutaJuego('LIGAPUB1', malo), malo).toThrow()
    }
    expect(rutaEquipo('LIGAPUB1', 'E1')).toBe('/v1/ligas/LIGAPUB1/equipos/E1/publico')
    for (const malo of ['', 'a/b', '..', 'x'.repeat(65)]) expect(() => rutaEquipo('LIGAPUB1', malo), malo).toThrow()
    expect(rutaJuego('LIGAPUB1', 'G1')).not.toMatch(/estado|preparacion|comandos/)
    expect(rutaEquipo('LIGAPUB1', 'E1')).not.toMatch(/estado|preparacion|comandos/)
  })
})

describe('pedirJson', () => {
  it('es un GET del mismo origen, sin credenciales ni cookies, sin caché y sin cabeceras de autorización', async () => {
    const obtener = vi.fn().mockResolvedValue(json({ a: 1 }))
    const r = await pedirJson('/v1/ligas/X/publico', { obtener, mono: () => 5 })
    expect(r).toMatchObject({ tipo: 'ok', cuerpo: { a: 1 } })
    const [ruta, init] = obtener.mock.calls[0]
    expect(ruta).toBe('/v1/ligas/X/publico')
    expect(ruta.startsWith('/')).toBe(true) // relativa: mismo origen
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).toEqual(['accept'])
    expect(init.body).toBeUndefined()
  })
  it('mide el viaje con el reloj monotónico inyectado', async () => {
    const tiempos = [100, 140]
    const r = await pedirJson('/v1/ligas/X/publico', { obtener: async () => json({}), mono: () => tiempos.shift() })
    expect(r).toMatchObject({ monoInicio: 100, monoFin: 140 })
  })
  it('traduce los estados HTTP: 404, 507, 503 resumen-no-disponible, otros', async () => {
    const con = (status, cuerpo, cabeceras = {}) => pedirJson('/x', { obtener: async () => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json', ...cabeceras } }) })
    expect(await con(404, { error: 'no-encontrado' })).toEqual({ tipo: 'no-encontrado' })
    expect(await con(507, { error: 'liga-demasiado-grande' })).toEqual({ tipo: 'demasiado-grande' })
    expect(await con(503, { error: 'resumen-no-disponible' }, { 'retry-after': '7' })).toEqual({ tipo: 'no-disponible', reintentoMs: 7000 })
    expect(await con(503, { error: 'otra' })).toMatchObject({ tipo: 'http', status: 503 })
    expect(await con(500, {})).toMatchObject({ tipo: 'http', status: 500, reintentoMs: 0 })
    expect(await con(429, {}, { 'retry-after': '30' })).toMatchObject({ tipo: 'http', status: 429, reintentoMs: 30000 })
  })
  it('respuestas que no son JSON, o con otro tipo de contenido, son «malformado»', async () => {
    expect(await pedirJson('/x', { obtener: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) })).toEqual({ tipo: 'malformado' })
    expect(await pedirJson('/x', { obtener: async () => new Response('{no json', { status: 200, headers: { 'content-type': 'application/json' } }) })).toEqual({ tipo: 'malformado' })
  })
  it('acota los bytes: por cabecera declarada y por lectura real', async () => {
    const grande = 'x'.repeat(LIMITE_BYTES + 10)
    expect(await pedirJson('/x', { obtener: async () => new Response(JSON.stringify({ g: grande }), { status: 200, headers: { 'content-type': 'application/json' } }) })).toEqual({ tipo: 'malformado' })
    const declarado = new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(LIMITE_BYTES + 1) } })
    expect(await pedirJson('/x', { obtener: async () => declarado })).toEqual({ tipo: 'malformado' })
  })
  it('un fallo de red, o agotar el tiempo, es «red»; cancelar es «cancelado»', async () => {
    expect(await pedirJson('/x', { obtener: async () => { throw new TypeError('fallo') } })).toEqual({ tipo: 'red' })
    vi.useFakeTimers()
    try {
      const colgada = (ruta, init) => new Promise((_, ko) => init.signal.addEventListener('abort', () => ko(new DOMException('abortado', 'AbortError'))))
      const p = pedirJson('/x', { obtener: colgada })
      await vi.advanceTimersByTimeAsync(TIEMPO_ESPERA_MS + 1)
      expect(await p).toEqual({ tipo: 'red' })
      const ctl = new AbortController()
      const q = pedirJson('/x', { obtener: colgada, senal: ctl.signal })
      ctl.abort()
      expect(await q).toEqual({ tipo: 'cancelado' })
      const yaCancelada = new AbortController()
      yaCancelada.abort()
      expect(await pedirJson('/x', { obtener: vi.fn(), senal: yaCancelada.signal })).toEqual({ tipo: 'cancelado' })
    } finally { vi.useRealTimers() }
  })
  it('Retry-After: segundos o fecha, acotado', () => {
    expect(reintentoDe('12')).toBe(12000)
    expect(reintentoDe('99999999')).toBeNull() // más de 7 dígitos no es un valor creíble
    expect(reintentoDe('9999999')).toBe(3_600_000)
    expect(reintentoDe(new Date(1_000_000 + 20_000).toUTCString(), 1_000_000)).toBe(20000)
    expect(reintentoDe('basura')).toBeNull()
    expect(reintentoDe(null)).toBeNull()
  })
})
