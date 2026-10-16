/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MENSAJES, cerrarSesionEnServidor, consultarSesion, iniciarSesionConCodigo } from './acceso-api'

const json = (status, cuerpo, tipo = 'application/json; charset=utf-8') =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'content-type': tipo } })

let fetchSimulado
beforeEach(() => {
  fetchSimulado = vi.fn()
  vi.stubGlobal('fetch', fetchSimulado)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('forma de las peticiones', () => {
  it('el inicio de sesión es un POST de mismo origen, sin caché, con el encabezado propio y el código SOLO en el cuerpo', async () => {
    fetchSimulado.mockResolvedValue(json(200, { ok: true }))
    await iniciarSesionConCodigo('ABCDE-23456-FGHJK-78MNP')
    const [url, opciones] = fetchSimulado.mock.calls[0]
    expect(url).toBe('/v1/acceso/organizador')
    expect(url).not.toContain('ABCDE')
    expect(opciones).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
    expect(opciones.headers).toMatchObject({ 'content-type': 'application/json', 'x-sebel-peticion': '1' })
    expect(JSON.parse(opciones.body)).toEqual({ codigo: 'ABCDE-23456-FGHJK-78MNP' })
  })
  it('consultar la sesión es un GET sin cuerpo ni código', async () => {
    fetchSimulado.mockResolvedValue(json(200, {}))
    await consultarSesion()
    const [url, opciones] = fetchSimulado.mock.calls[0]
    expect(url).toBe('/v1/organizador/yo')
    expect(opciones.method).toBe('GET')
    expect(opciones.body).toBeUndefined()
    expect(opciones).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
  })
  it('cerrar la sesión es un POST con el encabezado propio', async () => {
    fetchSimulado.mockResolvedValue(json(200, { ok: true }))
    await cerrarSesionEnServidor()
    const [url, opciones] = fetchSimulado.mock.calls[0]
    expect(url).toBe('/v1/organizador/salir')
    expect(opciones.headers['x-sebel-peticion']).toBe('1')
  })
})

describe('cada respuesta se reduce a un tipo fijo', () => {
  const casos = [
    [json(200, { organizadorId: 'o' }), 'ok'],
    [json(401, { error: 'no-autorizado' }), 'no-autorizado'],
    [json(429, { error: 'x' }), 'limitado'],
    [json(404, { error: 'no-encontrado' }), 'cerrado'],
    [json(403, { error: 'prohibido' }), 'cerrado'],
    [json(503, { tipo: 'resultado-desconocido' }), 'incierto'],
    [json(500, { error: 'detalle interno' }), 'incierto'],
    [json(200, '<!doctype html><html></html>', 'text/html'), 'incierto'], // la página de la aplicación NUNCA es un éxito
    [json(200, 'no es json', 'application/json'), 'incierto'],
  ]
  for (const [respuesta, esperado] of casos) {
    it(`${respuesta.status} ${respuesta.headers.get('content-type')} → ${esperado}`, async () => {
      fetchSimulado.mockResolvedValue(respuesta)
      expect((await consultarSesion()).tipo).toBe(esperado)
    })
  }
  it('sin respuesta (el fetch falla) → red, sin lanzar', async () => {
    fetchSimulado.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await consultarSesion()).toEqual({ tipo: 'red' })
  })
  it('sin conexión no se envía nada', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    expect(await iniciarSesionConCodigo('X')).toEqual({ tipo: 'sin-conexion' })
    expect(fetchSimulado).not.toHaveBeenCalled()
  })
  it('nunca escribe en la consola', async () => {
    const espias = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    fetchSimulado.mockRejectedValue(new Error('boom'))
    await iniciarSesionConCodigo('SECRETO-DE-PRUEBA')
    fetchSimulado.mockResolvedValue(json(500, { error: 'SECRETO-DE-PRUEBA' }))
    await iniciarSesionConCodigo('SECRETO-DE-PRUEBA')
    for (const e of espias) expect(e).not.toHaveBeenCalled()
    espias.forEach((e) => e.mockRestore())
  })
})

describe('mensajes fijos', () => {
  it('incluye la frase aprobada sin conexión, tal cual', () => {
    expect(MENSAJES['sin-conexion']).toBe('Se requiere conexión a internet para esta acción.')
  })
  it('ningún mensaje deja pasar texto del servidor ni afirma un éxito', () => {
    for (const m of Object.values(MENSAJES)) { expect(m).not.toMatch(/\{|\}|<|error:|stack|SQL/i); expect(m).not.toMatch(/correctamente|éxito|listo/i) }
  })
})
