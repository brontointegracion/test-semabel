/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIN_CONEXION, enviarCuerpo, leerLiga, leerPlantilla, rutaDeOperacion } from './roster-api'
import { conConexion, json, sinConexion } from '../prueba/compartido'

let f
beforeEach(() => { f = vi.fn(); vi.stubGlobal('fetch', f); conConexion() })
afterEach(() => vi.unstubAllGlobals())

const OP = 'op-0123456789abcdef'
const enviar = () => enviarCuerpo({ ruta: '/x', cuerpoJson: JSON.stringify({ operacionId: OP }), operacionId: OP })

describe('rutas', () => {
  it('cada operación tiene su ruta', () => {
    expect(rutaDeOperacion({ tipo: 'alta', ligaId: 'L', equipoId: 'E' })).toBe('/v1/organizador/ligas/L/equipos/E/jugadores')
    expect(rutaDeOperacion({ tipo: 'reactivar', ligaId: 'L', equipoId: 'E', fichaId: 'J' })).toBe('/v1/organizador/ligas/L/equipos/E/jugadores/J/reactivar')
  })
})

describe('lecturas', () => {
  it('sin conexión no piden nada y dan la frase aprobada', async () => {
    sinConexion()
    expect(await leerLiga('L')).toEqual({ tipo: 'sin-conexion' })
    expect(f).not.toHaveBeenCalled()
    expect(SIN_CONEXION).toBe('Se requiere conexión a internet para esta acción.')
  })
  it('identificadores raros no llegan a la red', async () => {
    expect((await leerLiga('../x')).tipo).toBe('no-encontrado')
    expect((await leerPlantilla('L', 'a/b')).tipo).toBe('no-encontrado')
    expect(f).not.toHaveBeenCalled()
  })
  it('clasifica 401, 404, red, HTML y formas inesperadas; acepta solo la forma esperada', async () => {
    f.mockResolvedValueOnce(json(401, {})); expect((await leerLiga('L')).tipo).toBe('no-autorizado')
    f.mockResolvedValueOnce(json(404, {})); expect((await leerLiga('L')).tipo).toBe('no-encontrado')
    f.mockRejectedValueOnce(new TypeError('x')); expect((await leerLiga('L')).tipo).toBe('red')
    f.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })); expect((await leerLiga('L')).tipo).toBe('incierto')
    f.mockResolvedValueOnce(json(200, { raro: true })); expect((await leerLiga('L')).tipo).toBe('incierto')
    f.mockResolvedValueOnce(json(200, { liga: { id: 'L', nombre: 'N' }, equipos: [{ id: 'E', nombre: 'A' }] })); expect((await leerLiga('L')).tipo).toBe('ok')
    f.mockResolvedValueOnce(json(200, { equipo: { id: 'E' }, bloqueada: 'no', activos: [], inactivos: [] })); expect((await leerPlantilla('L', 'E')).tipo).toBe('incierto')
  })
  it('las lecturas usan cookie del mismo origen y nunca caché', async () => {
    f.mockResolvedValueOnce(json(401, {}))
    await leerLiga('L')
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  })
})

describe('un intento de operación', () => {
  it('envía el texto congelado tal cual, con la cabecera propia y sin reserializarlo', async () => {
    const texto = '{"operacionId":"op-0123456789abcdef","campos":{"b":1,"a":2}}'
    f.mockResolvedValueOnce(json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: OP }))
    await enviarCuerpo({ ruta: '/x', cuerpoJson: texto, operacionId: OP })
    expect(f.mock.calls[0][1].body).toBe(texto)
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    expect(f.mock.calls[0][1].headers['x-sebel-peticion']).toBe('1')
  })
  const tabla = [
    ['200 aplicado', () => json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: OP }), 'decidido'],
    ['200 rechazado', () => json(200, { resultado: 'rechazado', tipo: 'invalido', operacionId: OP }), 'decidido'],
    ['200 de otra operación', () => json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: 'otra' }), 'incierto'],
    ['200 sin resultado', () => json(200, { ok: 1 }), 'incierto'],
    ['200 HTML', () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'incierto'],
    ['401', () => json(401, {}), 'sesion'],
    ['409', () => json(409, { error: 'operacion-conflicto' }), 'conflicto'],
    ['503 fallo-sin-escritura', () => json(503, { tipo: 'fallo-sin-escritura', motivo: 'asercion-vencida' }), 'sin-escritura'],
    ['503 identidad-no-verificable', () => json(503, { error: 'identidad-no-verificable' }), 'sin-escritura'],
    ['503 resultado-desconocido', () => json(503, { tipo: 'resultado-desconocido' }), 'incierto'],
    ['503 sin cuerpo', () => new Response('', { status: 503 }), 'incierto'],
    ['500', () => json(500, {}), 'incierto'],
    ['429', () => json(429, {}), 'incierto'],
    ['400', () => json(400, {}), 'protocolo'], ['403', () => json(403, {}), 'protocolo'], ['404', () => json(404, {}), 'protocolo'],
    ['413', () => json(413, {}), 'protocolo'], ['422', () => json(422, {}), 'protocolo'],
  ]
  for (const [n, r, clase] of tabla) it(`${n} → ${clase}`, async () => { f.mockResolvedValueOnce(r()); expect((await enviar()).clase).toBe(clase) })
  it('fallo de red y tiempo agotado → incierto (la petición pudo llegar)', async () => {
    f.mockRejectedValueOnce(new TypeError('red')); expect((await enviar()).clase).toBe('incierto')
    f.mockRejectedValueOnce(new DOMException('abort', 'AbortError')); expect((await enviar()).clase).toBe('incierto')
  })
  it('nunca refleja texto del servidor', async () => {
    f.mockResolvedValueOnce(json(503, { error: 'SQLITE_ERROR secreto', stack: 'at x' }))
    expect(JSON.stringify(await enviar())).not.toMatch(/SQLITE|secreto|stack/)
  })
})
