/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, conConexion, sinConexion } from '../../prueba/compartido'
import { TIEMPO_MAXIMO_MS, activar, leerPartidoPublico, sondear } from './activacion-api'

const TOKEN = 'c'.repeat(64)
const HASH = 'd'.repeat(64)
const P = { ligaId: 'LIGA1', partidoId: 'P1' }
let f
beforeEach(() => { f = vi.fn(); vi.stubGlobal('fetch', f); conConexion() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const estadoOk = (extra = {}) => ({
  version: 1, gameId: 'P1', deviceId: 'dev-abc', servidorAhoraMs: 1_700_000_000_000,
  credencial: { expiraEn: 1_700_000_100_000, retornoHasta: 1_700_000_900_000 },
  estado: { partido: { estado: 'programado' } }, ...extra,
})

describe('activar', () => {
  it('la petición: POST, solo { codigo, tokenHash }, sin cookies, sin caché, sin redirecciones, sin Authorization, nada en la URL', async () => {
    f.mockResolvedValueOnce(json(200, { deviceId: 'dev-1', partidoId: 'P1' }))
    await activar({ ...P, codigo: 'ABCDE-12345-ABCDE-12345', tokenHash: HASH })
    const [url, op] = f.mock.calls[0]
    expect(url).toBe('/v1/ligas/LIGA1/partidos/P1/activar')
    expect(url).not.toMatch(/ABCDE|\?|#/)
    expect(op.method).toBe('POST')
    expect(op.credentials).toBe('omit')
    expect(op.cache).toBe('no-store')
    expect(op.redirect).toBe('error')
    expect(op.signal).toBeInstanceOf(AbortSignal)
    expect(Object.keys(op.headers).sort()).toEqual(['accept', 'content-type'])
    expect(Object.keys(JSON.parse(op.body)).sort()).toEqual(['codigo', 'tokenHash'])
    expect(JSON.parse(op.body)).toEqual({ codigo: 'ABCDE-12345-ABCDE-12345', tokenHash: HASH })
  })

  it.each([
    ['200 íntegro', () => json(200, { deviceId: 'dev-1', partidoId: 'P1' }), { clase: 'activada', deviceId: 'dev-1' }],
    ['200 de otro partido', () => json(200, { deviceId: 'dev-1', partidoId: 'OTRO' }), { clase: 'incierta', motivo: 'respuesta-inesperada' }],
    ['200 sin dispositivo', () => json(200, { partidoId: 'P1' }), { clase: 'incierta', motivo: 'respuesta-inesperada' }],
    ['200 con dispositivo vacío', () => json(200, { deviceId: '', partidoId: 'P1' }), { clase: 'incierta', motivo: 'respuesta-inesperada' }],
    ['200 con dispositivo que no es texto', () => json(200, { deviceId: 5, partidoId: 'P1' }), { clase: 'incierta', motivo: 'respuesta-inesperada' }],
    ['200 HTML', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), { clase: 'incierta', motivo: 'respuesta-inesperada' }],
    ['200 JSON ilegible', () => new Response('{no', { status: 200, headers: { 'content-type': 'application/json' } }), { clase: 'incierta', motivo: 'respuesta-inesperada' }],
    ['401', () => json(401, { error: 'no-autorizado' }), { clase: 'denegada' }],
    ['429', () => json(429, { error: 'demasiados-intentos' }), { clase: 'limitada' }],
    ['404', () => json(404, { error: 'no-encontrado' }), { clase: 'no-encontrada' }],
    ['400', () => json(400, {}), { clase: 'protocolo', estado: 400 }],
    ['403', () => json(403, {}), { clase: 'protocolo', estado: 403 }],
    ['405', () => json(405, {}), { clase: 'protocolo', estado: 405 }],
    ['413', () => json(413, {}), { clase: 'protocolo', estado: 413 }],
    ['422', () => json(422, {}), { clase: 'protocolo', estado: 422 }],
    ['500', () => json(500, {}), { clase: 'incierta', motivo: 'servidor' }],
    ['502', () => new Response('x', { status: 502 }), { clase: 'incierta', motivo: 'servidor' }],
    ['503 resultado desconocido', () => json(503, { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }), { clase: 'incierta', motivo: 'servidor' }],
  ])('%s', async (_n, respuesta, esperado) => {
    f.mockResolvedValueOnce(respuesta())
    expect(await activar({ ...P, codigo: 'X', tokenHash: HASH })).toEqual(esperado)
  })

  it('fallo de red: incierta; sin conexión: no sale nada', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    expect(await activar({ ...P, codigo: 'X', tokenHash: HASH })).toEqual({ clase: 'incierta', motivo: 'red' })
    sinConexion()
    f.mockClear()
    expect(await activar({ ...P, codigo: 'X', tokenHash: HASH })).toEqual({ clase: 'sin-conexion' })
    expect(f).not.toHaveBeenCalled()
  })

  it('tiempo agotado: se aborta y queda incierta (la petición pudo llegar)', async () => {
    vi.useFakeTimers()
    f.mockImplementationOnce((_u, op) => new Promise((_r, rechazo) => { op.signal.addEventListener('abort', () => rechazo(new DOMException('abort', 'AbortError'))) }))
    const p = activar({ ...P, codigo: 'X', tokenHash: HASH })
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_MS)
    expect(await p).toEqual({ clase: 'incierta', motivo: 'red' })
  })
})

describe('sondear (lectura protegida)', () => {
  it('la petición: GET con el token SOLO en Authorization, sin cookies, sin caché, sin redirecciones; nada en la URL', async () => {
    f.mockResolvedValueOnce(json(200, estadoOk()))
    await sondear({ ...P, token: TOKEN })
    const [url, op] = f.mock.calls[0]
    expect(url).toBe('/v1/ligas/LIGA1/partidos/P1/estado')
    expect(url).not.toContain(TOKEN)
    expect(op.method).toBe('GET')
    expect(op.body).toBeUndefined()
    expect(op.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(op.credentials).toBe('omit')
    expect(op.cache).toBe('no-store')
    expect(op.redirect).toBe('error')
  })

  it('200 íntegro: vigente, con SOLO los campos necesarios', async () => {
    f.mockResolvedValueOnce(json(200, { ...estadoOk(), estado: { partido: { estado: 'vivo' }, eventos: [{ id: 'e1' }] }, atribucion: {}, etiquetas: [{ id: 'J1', etiqueta: 'Ana' }] }))
    expect(await sondear({ ...P, token: TOKEN })).toEqual({
      clase: 'vigente',
      datos: { deviceId: 'dev-abc', servidorAhoraMs: 1_700_000_000_000, expiraEn: 1_700_000_100_000, retornoHasta: 1_700_000_900_000, estadoPartido: 'vivo' },
    })
    f.mockResolvedValueOnce(json(200, estadoOk({ credencial: { expiraEn: null, retornoHasta: null } })))
    expect((await sondear({ ...P, token: TOKEN })).datos).toMatchObject({ expiraEn: null, retornoHasta: null })
  })

  it.each([
    ['otro partido', { gameId: 'OTRO' }],
    ['versión desconocida', { version: 2 }],
    ['sin dispositivo', { deviceId: undefined }],
    ['dispositivo vacío', { deviceId: '' }],
    ['sin hora del servidor', { servidorAhoraMs: 'ayer' }],
    ['credencial con texto', { credencial: { expiraEn: 'x', retornoHasta: null } }],
    ['sin credencial', { credencial: undefined }],
    ['estado de partido desconocido', { estado: { partido: { estado: 'raro' } } }],
    ['sin estado', { estado: undefined }],
  ])('200 con %s: incierta, no vigente', async (_n, cambio) => {
    f.mockResolvedValueOnce(json(200, estadoOk(cambio)))
    expect(await sondear({ ...P, token: TOKEN })).toEqual({ clase: 'incierta', motivo: 'respuesta-inesperada' })
  })

  it('401: sin credencial (no distingue la causa); 404: no encontrada', async () => {
    f.mockResolvedValueOnce(json(401, { error: 'no-autorizado' }))
    expect(await sondear({ ...P, token: TOKEN })).toEqual({ clase: 'sin-credencial' })
    f.mockResolvedValueOnce(json(404, { error: 'no-encontrado' }))
    expect(await sondear({ ...P, token: TOKEN })).toEqual({ clase: 'no-encontrada' })
  })

  it('507: SOLO el JSON exacto { error: "estado-demasiado-grande" } confirma el acceso', async () => {
    f.mockResolvedValueOnce(json(507, { error: 'estado-demasiado-grande' }))
    expect(await sondear({ ...P, token: TOKEN })).toEqual({ clase: 'confirmada-sin-estado' })
    for (const resp of [
      json(507, { error: 'otra-cosa' }),
      json(507, { error: 'estado-demasiado-grande', extra: 1 }),
      json(507, {}),
      json(507, ['estado-demasiado-grande']),
      json(507, 'estado-demasiado-grande'),
      new Response('{"error":"estado-demasiado-grande"}', { status: 507, headers: { 'content-type': 'text/html' } }),
      new Response('<html>estado-demasiado-grande</html>', { status: 507, headers: { 'content-type': 'text/html' } }),
      new Response('{no', { status: 507, headers: { 'content-type': 'application/json' } }),
      new Response('', { status: 507 }),
    ]) {
      f.mockResolvedValueOnce(resp)
      expect(await sondear({ ...P, token: TOKEN })).toEqual({ clase: 'incierta', motivo: 'respuesta-inesperada' })
    }
  })

  it('500, 503 y fallo de red: incierta; sin conexión: no sale nada', async () => {
    f.mockResolvedValueOnce(json(500, {}))
    expect((await sondear({ ...P, token: TOKEN })).clase).toBe('incierta')
    f.mockResolvedValueOnce(json(503, { error: 'error-temporal' }))
    expect((await sondear({ ...P, token: TOKEN })).clase).toBe('incierta')
    f.mockRejectedValueOnce(new TypeError('red'))
    expect((await sondear({ ...P, token: TOKEN })).clase).toBe('incierta')
    sinConexion(); f.mockClear()
    expect(await sondear({ ...P, token: TOKEN })).toEqual({ clase: 'sin-conexion' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('vista previa pública', () => {
  const publico = (extra = {}) => ({ gameId: 'P1', rev: 0, liga: { id: 'LIGA1', nombre: 'Liga Uno' }, estado: 'programado', local: { id: 'E1', nombre: 'Alfa', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta', puntos: 0, faltas: 0 }, ...extra })
  it('GET sin credenciales ni Authorization; devuelve solo lo necesario', async () => {
    f.mockResolvedValueOnce(json(200, publico()))
    expect(await leerPartidoPublico(P)).toEqual({ clase: 'ok', datos: { liga: 'Liga Uno', local: 'Alfa', visita: 'Beta', estado: 'programado' } })
    const [url, op] = f.mock.calls[0]
    expect(url).toBe('/v1/ligas/LIGA1/partidos/P1')
    expect(op.headers.authorization).toBeUndefined()
    expect(op.credentials).toBe('omit')
    expect(op.cache).toBe('no-store')
  })
  it('404, formas raras, red y sin conexión', async () => {
    f.mockResolvedValueOnce(json(404, {}))
    expect(await leerPartidoPublico(P)).toEqual({ clase: 'no-encontrada' })
    for (const mal of [publico({ gameId: 'X' }), publico({ liga: {} }), publico({ local: { nombre: '' } }), publico({ estado: 'raro' }), 'texto']) {
      f.mockResolvedValueOnce(json(200, mal))
      expect((await leerPartidoPublico(P)).clase).toBe('incierta')
    }
    f.mockResolvedValueOnce(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect((await leerPartidoPublico(P)).clase).toBe('incierta')
    f.mockRejectedValueOnce(new TypeError('red'))
    expect((await leerPartidoPublico(P)).clase).toBe('incierta')
    sinConexion(); f.mockClear()
    expect(await leerPartidoPublico(P)).toEqual({ clase: 'sin-conexion' })
    expect(f).not.toHaveBeenCalled()
  })
})
