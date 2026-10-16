/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __reiniciar, entrar, invalidar, leerEstado, refrescar, salir } from './sesion-servidor'

const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
const YO = { organizadorId: 'org-1', ligas: ['LIGA-A', 'LIGA-B'], expiraIdle: 2_000_000, expiraAbs: 3_000_000 }
const CODIGO = 'ABCDE-23456-FGHJK-78MNP'

let f
// Responde en orden a cada llamada a fetch.
const secuencia = (...respuestas) => { respuestas.forEach((r) => (r instanceof Error ? f.mockRejectedValueOnce(r) : f.mockResolvedValueOnce(r))) }
const rutas = () => f.mock.calls.map(([u, o]) => `${o.method} ${u}`)

beforeEach(() => {
  __reiniciar()
  f = vi.fn()
  vi.stubGlobal('fetch', f)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('entrar', () => {
  it('el éxito se confirma con /yo, no con la respuesta del inicio de sesión; el código no queda en el estado', async () => {
    secuencia(json(200, { ok: true }), json(200, YO))
    await entrar(CODIGO)
    expect(rutas()).toEqual(['POST /v1/acceso/organizador', 'GET /v1/organizador/yo'])
    const e = leerEstado()
    expect(e).toMatchObject({ estado: 'activa', aviso: null, ocupado: false, datos: { organizadorId: 'org-1', ligas: ['LIGA-A', 'LIGA-B'] } })
    expect(JSON.stringify(e)).not.toContain('ABCDE')
  })
  it('si el inicio dice 200 pero /yo no reconoce la sesión (cookie bloqueada), NO se da por entrado', async () => {
    secuencia(json(200, { ok: true }), json(401, { error: 'no-autorizado' }))
    await entrar(CODIGO)
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', aviso: 'cookie' })
  })
  it('si /yo falla por la red tras un 200, tampoco se afirma nada', async () => {
    secuencia(json(200, { ok: true }), new TypeError('red'))
    await entrar(CODIGO)
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', aviso: 'incierto' })
  })
  const fallos = [
    ['código inválido', json(401, {}), 'codigo-invalido'],
    ['demasiados intentos', json(429, {}), 'demasiados'],
    ['acceso cerrado', json(404, {}), 'no-disponible'],
    ['prohibido', json(403, {}), 'no-disponible'],
    ['resultado desconocido', json(503, { tipo: 'resultado-desconocido' }), 'incierto'],
    ['fallo del servidor', json(500, { error: 'x' }), 'incierto'],
    ['sin respuesta', new TypeError('red'), 'incierto'],
  ]
  for (const [nombre, respuesta, aviso] of fallos) {
    it(`${nombre} → aviso "${aviso}" y sin sesión`, async () => {
      secuencia(respuesta)
      await entrar(CODIGO)
      expect(leerEstado()).toMatchObject({ estado: 'cargando', aviso, ocupado: false })
      expect(f).toHaveBeenCalledTimes(1) // no se pregunta /yo tras un fallo
    })
  }
  it('sin conexión no se envía nada y se avisa', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await entrar(CODIGO)
    expect(f).not.toHaveBeenCalled()
    expect(leerEstado().aviso).toBe('sin-conexion')
  })
  it('un segundo envío mientras hay uno en curso se ignora', async () => {
    let soltar
    f.mockImplementationOnce(() => new Promise((r) => { soltar = r }))
    const a = entrar(CODIGO)
    await entrar(CODIGO)
    expect(f).toHaveBeenCalledTimes(1)
    f.mockResolvedValueOnce(json(200, YO))
    soltar(json(200, {}))
    await a
    expect(leerEstado().estado).toBe('activa')
  })
})

describe('refrescar, caducidad y reentrada', () => {
  it('una sesión caducada pasa a "sin sesión" con el aviso de reentrada', async () => {
    secuencia(json(200, {}), json(200, YO))
    await entrar(CODIGO)
    secuencia(json(401, { error: 'no-autorizado' }))
    await refrescar()
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', datos: null, aviso: 'sesion-terminada' })
  })
  it('sin respuesta con una sesión ya confirmada se conserva lo último confirmado (no se inventa ni un cierre ni un éxito)', async () => {
    secuencia(json(200, {}), json(200, YO))
    await entrar(CODIGO)
    secuencia(new TypeError('red'))
    await refrescar()
    expect(leerEstado()).toMatchObject({ estado: 'activa', datos: { organizadorId: 'org-1' } })
  })
  it('al abrir sin sesión: se pide el código y no hay aviso', async () => {
    secuencia(json(401, {}))
    await refrescar({ conAviso: false })
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', aviso: null })
  })
  it('invalidar (un 401 de cualquier llamada protegida) lleva a la reentrada', async () => {
    secuencia(json(200, {}), json(200, YO))
    await entrar(CODIGO)
    invalidar()
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', aviso: 'sesion-terminada' })
  })
})

describe('cerrar sesión', () => {
  const dentro = async () => { secuencia(json(200, {}), json(200, YO)); await entrar(CODIGO) }
  it('confirmado por el servidor → sin sesión', async () => {
    await dentro()
    secuencia(json(200, { ok: true }))
    await salir()
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', datos: null, aviso: null })
  })
  it('un 401 al cerrar significa que ya estaba cerrada', async () => {
    await dentro()
    secuencia(json(401, {}))
    await salir()
    expect(leerEstado().estado).toBe('sin-sesion')
  })
  it('respuesta perdida: NO se afirma el cierre; se pregunta al servidor y, si la sesión sigue, se avisa', async () => {
    await dentro()
    secuencia(new TypeError('red'), json(200, YO))
    await salir()
    expect(leerEstado()).toMatchObject({ estado: 'activa', aviso: 'salida-incierta' })
  })
  it('respuesta perdida, pero el servidor confirma después que no hay sesión → sin sesión', async () => {
    await dentro()
    secuencia(new TypeError('red'), json(401, {}))
    await salir()
    expect(leerEstado()).toMatchObject({ estado: 'sin-sesion', aviso: null })
  })
  it('respuesta perdida y sin red para comprobar: sigue activa con aviso', async () => {
    await dentro()
    secuencia(new TypeError('red'), new TypeError('red'))
    await salir()
    expect(leerEstado()).toMatchObject({ estado: 'activa', aviso: 'salida-incierta' })
  })
  it('sin conexión no se envía y no se cierra', async () => {
    await dentro()
    f.mockClear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await salir()
    expect(f).not.toHaveBeenCalled()
    expect(leerEstado()).toMatchObject({ estado: 'activa', aviso: 'sin-conexion' })
  })
})
