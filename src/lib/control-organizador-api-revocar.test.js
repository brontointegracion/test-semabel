/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIEMPO_MAXIMO_MS, revocarControl, rutaRevocar } from './control-organizador-api'

// REPORT_181: cliente del retiro del acceso (una petición, sin reintento, resultados cerrados). Datos sintéticos.
const json = (status, cuerpo, tipo = 'application/json') => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'content-type': tipo } })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }) })
const fetchCon = (...respuestas) => { const f = vi.fn(async () => { const r = respuestas.shift(); if (r instanceof Error) throw r; return r }); vi.stubGlobal('fetch', f); return f }

describe('revocarControl', () => {
  it('una sola petición POST con la cabecera de petición del sitio, cuerpo vacío, mismo origen, sin caché ni redirecciones', async () => {
    const f = fetchCon(json(200, { ok: true, credencialesRevocadas: 1 }))
    expect(await revocarControl('LIGA-U10', 'g-1')).toEqual({ tipo: 'revocado', credencialesRevocadas: 1 })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(rutaRevocar('LIGA-U10', 'g-1'))
    expect(url).toBe('/v1/organizador/ligas/LIGA-U10/partidos/g-1/control/revocar')
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
    expect(init.headers['x-sebel-peticion']).toBe('1')
    expect(init.headers['content-type']).toBe('application/json')
  })
  it('n = 0 es un resultado válido distinto (nada que retirar)', async () => {
    fetchCon(json(200, { ok: true, credencialesRevocadas: 0 }))
    expect(await revocarControl('L', 'g')).toEqual({ tipo: 'revocado', credencialesRevocadas: 0 })
  })
  it.each([
    [401, 'sesion'], [404, 'no-encontrado'], [409, 'partido-iniciado'], [400, 'protocolo'], [403, 'protocolo'], [413, 'protocolo'], [422, 'protocolo'],
    [500, 'incierto'], [502, 'incierto'], [503, 'incierto'], [429, 'incierto'],
  ])('HTTP %i → %s (y nunca se reintenta)', async (status, tipo) => {
    const f = fetchCon(json(status, { error: 'x' }), json(200, { ok: true, credencialesRevocadas: 1 }))
    expect((await revocarControl('L', 'g')).tipo).toBe(tipo)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['cuerpo que no es JSON', json(200, 'hola', 'text/plain')],
    ['JSON ilegible', json(200, '{no', 'application/json')],
    ['sin ok', json(200, { credencialesRevocadas: 1 })],
    ['ok falso', json(200, { ok: false, credencialesRevocadas: 1 })],
    ['conteo negativo', json(200, { ok: true, credencialesRevocadas: -1 })],
    ['conteo fraccionario', json(200, { ok: true, credencialesRevocadas: 1.5 })],
    ['conteo enorme', json(200, { ok: true, credencialesRevocadas: 1e9 })],
    ['conteo como texto', json(200, { ok: true, credencialesRevocadas: '1' })],
    ['arreglo', json(200, [])],
  ])('200 dudoso (%s) → incierto', async (_n, r) => {
    fetchCon(r)
    expect((await revocarControl('L', 'g')).tipo).toBe('incierto')
  })
  it('fallo de red → incierto, sin reintento', async () => {
    const f = fetchCon(new TypeError('red'))
    expect(await revocarControl('L', 'g')).toEqual({ tipo: 'incierto' })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('si no responde, la petición se aborta al agotarse el tiempo y queda incierta', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u, init) => new Promise((_ok, ko) => init.signal.addEventListener('abort', () => ko(new DOMException('abortada', 'AbortError'))))))
    const p = revocarControl('L', 'g')
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_MS + 10)
    expect(await p).toEqual({ tipo: 'incierto' })
  })
  it('sin conexión no se envía nada; identificadores inválidos no llegan a la red', async () => {
    const f = fetchCon()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    expect(await revocarControl('L', 'g')).toEqual({ tipo: 'sin-conexion' })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    for (const [l, g] of [['', 'g'], ['L', ''], ['../x', 'g'], ['L', 'g/otro'], ['L', 'g?x=1']]) expect(await revocarControl(l, g)).toEqual({ tipo: 'no-encontrado' })
    expect(f).not.toHaveBeenCalled()
  })
})
