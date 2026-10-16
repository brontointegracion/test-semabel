/** @vitest-environment jsdom */
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { instalarCandados, json, conConexion, sinConexion } from '../../prueba/compartido'
import {
  MENSAJES, SIN_CONEXION, activarTelefono, comprobarActivacion, generarIdentidad, intentoEnVuelo, nombreCandado, sha256Hex, urlControl,
} from './activacion'
import { MAX_REGISTRO_BYTES, MAX_TOTAL_BYTES, PREFIJO, bytes, clave, leerRegistro, listarRegistros } from './activacion-almacen'

const L = 'LIGA1'
const P = 'P1'
const CODIGO = 'ABCDE-23456-FGHJK-78MNP'
const sha = (t) => createHash('sha256').update(t).digest('hex')
const guardado = (l = L, p = P) => JSON.parse(localStorage.getItem(clave(l, p)))
const activadaOk = (deviceId = 'dev-uno') => json(200, { deviceId, partidoId: P })
const estadoOk = (extra = {}) => json(200, {
  version: 1, gameId: P, deviceId: 'dev-uno', servidorAhoraMs: 1_700_000_000_000,
  credencial: { expiraEn: 1_700_000_100_000, retornoHasta: 1_700_000_900_000 }, estado: { partido: { estado: 'programado' } }, ...extra,
})

let f
let candados
let espiasConsola
let semillas
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  semillas = vi.spyOn(webcrypto, 'getRandomValues')
  candados = instalarCandados()
  conConexion()
  f = vi.fn()
  vi.stubGlobal('fetch', f)
  espiasConsola = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  candados.quitar(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  // Ningún flujo escribe en la consola (el código y el token no pueden aparecer en registros).
  for (const e of espiasConsola) expect(e).not.toHaveBeenCalled()
})

/** Las URL de TODAS las llamadas: la activación nunca habla con /comandos. */
const urls = () => f.mock.calls.map((c) => c[0])
afterEach(() => { for (const u of urls()) expect(u).toMatch(/\/(activar|estado)$|\/partidos\/[A-Za-z0-9_-]+$/) })

describe('identidad', () => {
  it('SHA-256 exacto y minúsculas', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('32 bytes criptográficos como 64 hex; el hash es el SHA-256 del texto exacto; no se repite', async () => {
    const a = await generarIdentidad()
    const b = await generarIdentidad()
    expect(a.token).toMatch(/^[0-9a-f]{64}$/)
    expect(a.tokenHash).toBe(sha(a.token))
    expect(a.token).not.toBe(b.token)
    expect(semillas).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(semillas.mock.calls[0][0].length).toBe(32)
  })
  it('los bytes aleatorios fijados dan el token y el hash esperados', async () => {
    semillas.mockImplementationOnce((a) => { a.fill(0xab); return a })
    const i = await generarIdentidad()
    expect(i.token).toBe('ab'.repeat(32))
    expect(i.tokenHash).toBe(sha('ab'.repeat(32)))
  })
  it('sin criptografía del navegador: null', async () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    expect(await generarIdentidad()).toBeNull()
    vi.stubGlobal('crypto', undefined)
    expect(await generarIdentidad()).toBeNull()
  })
  it('el enlace lleva solo identificadores', () => {
    expect(urlControl('LIGA1', 'P1')).toBe('/control/LIGA1/P1')
  })
})

describe('primera activación: lo guardado va ANTES de enviar', () => {
  it('cuando se llama a fetch el registro ya existe, es válido, «activando», y contiene el hash que viaja; el código no se guarda', async () => {
    let visto
    f.mockImplementationOnce(async (url, op) => {
      visto = { guardado: localStorage.getItem(clave(L, P)), cuerpo: JSON.parse(op.body), url }
      return activadaOk()
    })
    const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r).toMatchObject({ tipo: 'activada', persistido: true })
    const antes = JSON.parse(visto.guardado)
    expect(antes).toMatchObject({ v: 1, ligaId: L, partidoId: P, estado: 'activando', conIncierto: false, intentos: 1, deviceId: null, servidor: null })
    expect(antes.token).toMatch(/^[0-9a-f]{64}$/)
    expect(antes.tokenHash).toBe(sha(antes.token))
    expect(visto.cuerpo).toEqual({ codigo: CODIGO, tokenHash: antes.tokenHash })
    expect(visto.url).toBe(`/v1/ligas/${L}/partidos/${P}/activar`)
    expect(guardado()).toMatchObject({ estado: 'activada', conIncierto: false, deviceId: 'dev-uno', token: antes.token, tokenHash: antes.tokenHash, intentos: 1 })
    // el código no está en ningún valor ni clave guardados, ni en las URL, ni en la consola
    const todo = JSON.stringify({ ...localStorage })
    expect(todo).not.toContain(CODIGO)
    expect(todo).not.toContain(CODIGO.replaceAll('-', ''))
    for (const u of urls()) expect(u).not.toContain(CODIGO)
    expect(semillas).toHaveBeenCalledTimes(1)
  })

  it('el token no sale en ninguna petición de activación (solo su hash)', async () => {
    f.mockResolvedValueOnce(activadaOk())
    await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    const { token } = guardado()
    for (const [url, op] of f.mock.calls) {
      expect(url).not.toContain(token)
      expect(String(op.body)).not.toContain(token)
      expect(JSON.stringify(op.headers)).not.toContain(token)
    }
  })

  it('si el registro no se puede guardar (cuota) o verificar, NO se envía nada y no queda un registro a medias', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(localStorage.length).toBe(0)

    const leer = Storage.prototype.getItem
    const escribir = Storage.prototype.setItem
    let escrito = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { escrito = true; return escribir.call(this, k, v) })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return escrito && k === clave(L, P) ? '{"corrupto":true}' : leer.call(this, k) })
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(localStorage.getItem(clave(L, P))).toBeNull()
  })

  it('almacenamiento no disponible: no se envía y no hay respaldo en memoria', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
  })

  it('sin conexión: ni se genera identidad ni se guarda ni se envía', async () => {
    sinConexion()
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'sin-conexion' })
    expect(MENSAJES['sin-conexion']).toBe('Se requiere conexión a internet para esta acción.')
    expect(SIN_CONEXION).toBe(MENSAJES['sin-conexion'])
    expect(f).not.toHaveBeenCalled()
    expect(semillas).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('sin Web Locks no se envía nada; con el candado ocupado, tampoco', async () => {
    candados.quitar()
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'sin-candado' })
    expect(localStorage.length).toBe(0)
    candados = instalarCandados()
    let fin
    const retenido = new Promise((r) => { fin = r })
    const dentro = navigator.locks.request(nombreCandado(L, P), {}, () => retenido)
    await Promise.resolve()
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'ocupado' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    fin(); await dentro
  })

  it('sin criptografía: no se envía ni se guarda', async () => {
    vi.stubGlobal('crypto', undefined)
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'sin-criptografia' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('enlace o código no válidos: nada sale', async () => {
    for (const [l, p] of [['', P], [L, 'a:b'], ['x'.repeat(65), P]]) expect(await activarTelefono({ ligaId: l, partidoId: p, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'enlace-invalido' })
    for (const c of ['', '   ', 'x'.repeat(65), null, 5]) expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: c })).toEqual({ tipo: 'bloqueado', motivo: 'codigo-invalido' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('dos intentos a la vez para el mismo partido: solo uno llega al servidor', async () => {
    let soltar
    f.mockImplementationOnce(() => new Promise((r) => { soltar = () => r(activadaOk()) }))
    const a = activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'ocupado' })
    soltar()
    expect((await a).tipo).toBe('activada')
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('registros que no se tocan', () => {
  it('un registro ilegible se conserva intacto y bloquea ese partido (no se envía); otro partido sí puede', async () => {
    localStorage.setItem(clave(L, P), '{"basura":true}')
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'corrupto' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.getItem(clave(L, P))).toBe('{"basura":true}')
    f.mockResolvedValueOnce(json(200, { deviceId: 'dev-p2', partidoId: 'P2' }))
    expect((await activarTelefono({ ligaId: L, partidoId: 'P2', codigo: CODIGO })).tipo).toBe('activada')
  })

  it('un registro cuyo token no produce su hash no es de fiar: no se envía y se conserva', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    const r = guardado()
    localStorage.setItem(clave(L, P), JSON.stringify({ ...r, tokenHash: 'e'.repeat(64) }))
    const antes = localStorage.getItem(clave(L, P))
    f.mockClear()
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'corrupto' })
    expect(await comprobarActivacion({ ligaId: L, partidoId: P })).toEqual({ tipo: 'bloqueado', motivo: 'corrupto' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
  })

  /** Deja el almacenamiento con UNA clave de relleno hasta que el total de claves y valores del prefijo sea `objetivo` bytes. */
  const llenarHasta = (objetivo) => {
    const k = `${PREFIJO}relleno:1`
    const resto = objetivo - bytes(k)
    localStorage.setItem(k, 'é'.repeat(Math.floor(resto / 2)) + (resto % 2 ? 'x' : ''))
    expect(listarRegistros().bytes).toBe(objetivo)
    return k
  }

  it('en el tope de bytes se rechaza la activación nueva SIN enviar y sin borrar nada; con el hueco exacto entra y TERMINA de guardarse', async () => {
    const reserva = bytes(clave(L, P)) + MAX_REGISTRO_BYTES // un registro nuevo reserva su tamaño máximo
    const k = llenarHasta(MAX_TOTAL_BYTES - reserva + 1) // un byte menos de hueco del necesario
    const relleno = localStorage.getItem(k)
    expect(await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).toEqual({ tipo: 'bloqueado', motivo: 'capacidad' })
    expect(f).not.toHaveBeenCalled()
    expect(listarRegistros().n).toBe(1)
    expect(localStorage.getItem(k)).toBe(relleno) // nada expulsado
    expect(localStorage.getItem(clave(L, P))).toBeNull()

    localStorage.clear()
    llenarHasta(MAX_TOTAL_BYTES - reserva) // hueco exacto
    f.mockResolvedValueOnce(activadaOk())
    const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r).toMatchObject({ tipo: 'activada', persistido: true })
    expect(guardado().estado).toBe('activada')
    expect(listarRegistros().bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })
})

describe('respuesta perdida: la MISMA identidad, nunca otra', () => {
  it('fallo de red tras guardar: «incierta» con incertidumbre; reintentar usa el mismo token y hash y guarda la incertidumbre ANTES de enviar', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    const r1 = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r1).toMatchObject({ tipo: 'incierta', persistido: true })
    const inicial = guardado()
    expect(inicial).toMatchObject({ estado: 'incierta', conIncierto: true, intentos: 1 })

    let visto
    f.mockImplementationOnce(async (_u, op) => { visto = { guardado: JSON.parse(localStorage.getItem(clave(L, P))), cuerpo: JSON.parse(op.body) }; return activadaOk() })
    const r2 = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r2.tipo).toBe('activada')
    expect(visto.guardado).toMatchObject({ estado: 'activando', conIncierto: true, intentos: 2, token: inicial.token, tokenHash: inicial.tokenHash })
    expect(visto.cuerpo.tokenHash).toBe(inicial.tokenHash)
    expect(guardado()).toMatchObject({ estado: 'activada', conIncierto: false, deviceId: 'dev-uno', token: inicial.token, intentos: 2 })
    expect(semillas).toHaveBeenCalledTimes(1) // nunca se generó otra identidad
  })

  it('cada forma de respuesta perdida deja la activación incierta y conserva la identidad', async () => {
    const formas = [
      () => json(503, { tipo: 'resultado-desconocido' }),
      () => json(500, {}),
      () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => json(200, { deviceId: 'dev-1', partidoId: 'OTRO' }),
      () => { throw new TypeError('red') },
    ]
    for (const forma of formas) {
      localStorage.clear()
      f.mockReset()
      f.mockImplementationOnce(async () => forma())
      const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
      expect(r.tipo).toBe('incierta')
      expect(guardado()).toMatchObject({ estado: 'incierta', conIncierto: true })
    }
  })

  it('un registro «activando» (la pestaña murió con la petición en vuelo) cuenta como incierto: el reintento lo anota ANTES de enviar y un 401 posterior no lo borra', async () => {
    let soltar
    f.mockImplementationOnce(() => new Promise((r) => { soltar = r })) // nunca responde a esta página
    const colgada = activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    const muerto = guardado()
    expect(muerto).toMatchObject({ estado: 'activando', conIncierto: false, intentos: 1 })
    expect(await intentoEnVuelo(L, P)).toBe(true)
    candados.tomados.clear() // la pestaña murió: su candado se libera
    expect(await intentoEnVuelo(L, P)).toBe(false)

    let visto
    f.mockImplementationOnce(async (_u, op) => { visto = { guardado: JSON.parse(localStorage.getItem(clave(L, P))), hash: JSON.parse(op.body).tokenHash }; return json(401, { error: 'no-autorizado' }) })
    const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(visto.guardado).toMatchObject({ estado: 'activando', conIncierto: true, intentos: 2, token: muerto.token })
    expect(visto.hash).toBe(muerto.tokenHash)
    expect(r.tipo).toBe('denegada')
    expect(guardado()).toMatchObject({ estado: 'incierta', conIncierto: true, token: muerto.token, tokenHash: muerto.tokenHash }) // el rechazo no borra la incertidumbre
    void colgada; void soltar
  })

  it('«incierta» y luego 401, 429, 404 o protocolo: sigue incierta; y una activación confirmada la resuelve', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    const { tokenHash } = guardado()
    for (const resp of [json(401, {}), json(429, {}), json(404, {}), json(422, {})]) {
      f.mockResolvedValueOnce(resp)
      const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
      expect(r.persistido).toBe(true)
      expect(guardado()).toMatchObject({ estado: 'incierta', conIncierto: true, tokenHash })
    }
    f.mockResolvedValueOnce(activadaOk())
    expect((await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).tipo).toBe('activada')
    expect(guardado()).toMatchObject({ estado: 'activada', conIncierto: false, tokenHash })
    expect(semillas).toHaveBeenCalledTimes(1)
  })
})

describe('denegación del primer intento: no regenera la identidad', () => {
  it('401 → «denegada» sin incertidumbre; un código nuevo reutiliza el MISMO token y hash', async () => {
    f.mockResolvedValueOnce(json(401, { error: 'no-autorizado' }))
    const r1 = await activarTelefono({ ligaId: L, partidoId: P, codigo: 'MAL' })
    expect(r1).toMatchObject({ tipo: 'denegada', persistido: true })
    const d = guardado()
    expect(d).toMatchObject({ estado: 'denegada', conIncierto: false, intentos: 1 })

    let visto
    f.mockImplementationOnce(async (_u, op) => { visto = JSON.parse(op.body); return activadaOk() })
    expect((await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })).tipo).toBe('activada')
    expect(visto).toEqual({ codigo: CODIGO, tokenHash: d.tokenHash })
    expect(guardado()).toMatchObject({ estado: 'activada', token: d.token, intentos: 2 })
    expect(semillas).toHaveBeenCalledTimes(1)
  })

  it.each([[429, 'limitada'], [404, 'no-encontrada'], [400, 'protocolo'], [403, 'protocolo'], [405, 'protocolo'], [413, 'protocolo'], [422, 'protocolo']])('%s: no activa, queda «denegada» y se conserva el token', async (estado, tipo) => {
    f.mockResolvedValueOnce(json(estado, {}))
    const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r.tipo).toBe(tipo)
    expect(guardado()).toMatchObject({ estado: 'denegada', conIncierto: false })
  })

  it('nada reemplaza ni borra un registro: no hay API para ello y un 401 deja el texto guardado idéntico', async () => {
    f.mockResolvedValueOnce(json(401, {}))
    await activarTelefono({ ligaId: L, partidoId: P, codigo: 'MAL' })
    const antes = guardado()
    f.mockResolvedValueOnce(json(401, {}))
    await activarTelefono({ ligaId: L, partidoId: P, codigo: 'MAL' })
    expect(guardado()).toEqual({ ...antes, intentos: 2, actualizadoEn: expect.any(Number) })
    expect(guardado().token).toBe(antes.token)
    expect(guardado().creadoEn).toBe(antes.creadoEn)
  })
})

describe('el servidor respondió pero el resultado no se pudo guardar', () => {
  it('no cuenta como activado aquí: queda «activando» y el resultado dice persistido: false', async () => {
    const escribir = Storage.prototype.setItem
    let n = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { n += 1; if (n >= 2) throw new DOMException('cuota', 'QuotaExceededError'); return escribir.call(this, k, v) })
    f.mockResolvedValueOnce(activadaOk())
    const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r).toMatchObject({ tipo: 'activada', persistido: false })
    expect(r.registro.estado).toBe('activando')
    vi.restoreAllMocks()
    expect(guardado()).toMatchObject({ estado: 'activando', deviceId: null })
  })
  it('ya activada: no se envía nada ni se genera otra identidad', async () => {
    f.mockResolvedValueOnce(activadaOk())
    await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    f.mockClear()
    const r = await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    expect(r.tipo).toBe('ya-activada')
    expect(f).not.toHaveBeenCalled()
    expect(semillas).toHaveBeenCalledTimes(1)
  })
})

describe('comprobar (lectura protegida)', () => {
  const sembrarRegistro = async (cuerpoPrimero) => {
    f.mockImplementationOnce(async () => cuerpoPrimero())
    await activarTelefono({ ligaId: L, partidoId: P, codigo: CODIGO })
    f.mockClear()
  }

  it('sin registro: no hay nada que comprobar y no sale nada', async () => {
    expect(await comprobarActivacion({ ligaId: L, partidoId: P })).toEqual({ tipo: 'sin-registro' })
    expect(f).not.toHaveBeenCalled()
  })

  it('200: «vigente»; resuelve una activación incierta con el MISMO token, guarda dispositivo y fechas del servidor', async () => {
    await sembrarRegistro(() => { throw new TypeError('red') })
    const antes = guardado()
    f.mockResolvedValueOnce(estadoOk())
    const r = await comprobarActivacion({ ligaId: L, partidoId: P })
    expect(r).toMatchObject({ tipo: 'vigente', persistido: true, datos: { deviceId: 'dev-uno', estadoPartido: 'programado' } })
    expect(f.mock.calls[0][1].headers.authorization).toBe(`Bearer ${antes.token}`)
    expect(guardado()).toMatchObject({
      estado: 'activada', conIncierto: false, deviceId: 'dev-uno', token: antes.token, tokenHash: antes.tokenHash,
      servidor: { ahoraMs: 1_700_000_000_000, expiraEn: 1_700_000_100_000, retornoHasta: 1_700_000_900_000, leidoEn: expect.any(Number) },
    })
  })

  it('401 no modifica, reemplaza ni borra NADA, en ningún estado: el texto guardado queda idéntico', async () => {
    for (const preparar of [
      () => sembrarRegistro(() => { throw new TypeError('red') }), // incierta
      () => sembrarRegistro(() => json(401, {})), // denegada
      () => sembrarRegistro(() => activadaOk()), // activada
    ]) {
      localStorage.clear()
      await preparar()
      const antes = localStorage.getItem(clave(L, P))
      f.mockResolvedValueOnce(json(401, { error: 'no-autorizado' }))
      expect(await comprobarActivacion({ ligaId: L, partidoId: P })).toEqual({ tipo: 'no-activa' })
      expect(localStorage.getItem(clave(L, P))).toBe(antes)
      expect(MENSAJES['no-activa']).toMatch(/revocada, vencida o solo admitir reintentos de recibos; no sabemos cuál/)
      expect(MENSAJES['no-activa']).toMatch(/organizador puede revisar/)
    }
  })

  it('507 exacto: acceso confirmado SIN inventar dispositivo, fechas ni estado; la identidad se conserva', async () => {
    await sembrarRegistro(() => { throw new TypeError('red') })
    const antes = guardado()
    f.mockResolvedValueOnce(json(507, { error: 'estado-demasiado-grande' }))
    const r = await comprobarActivacion({ ligaId: L, partidoId: P })
    expect(r).toMatchObject({ tipo: 'acceso-confirmado-sin-estado', persistido: true })
    expect(MENSAJES['acceso-confirmado-sin-estado']).toBe('Acceso confirmado; no se pudo cargar el estado.')
    expect(guardado()).toMatchObject({ estado: 'activada', conIncierto: false, deviceId: null, servidor: null, token: antes.token, tokenHash: antes.tokenHash })
  })

  it('507 sobre una activación ya confirmada con datos: no se tocan', async () => {
    await sembrarRegistro(() => activadaOk())
    const antes = localStorage.getItem(clave(L, P))
    f.mockResolvedValueOnce(json(507, { error: 'estado-demasiado-grande' }))
    expect((await comprobarActivacion({ ligaId: L, partidoId: P })).tipo).toBe('acceso-confirmado-sin-estado')
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
  })

  it.each([
    ['507 malformado', () => json(507, { error: 'otra' })],
    ['507 HTML', () => new Response('<html></html>', { status: 507, headers: { 'content-type': 'text/html' } })],
    ['200 inesperado', () => json(200, { hola: 1 })],
    ['503', () => json(503, {})],
    ['404', () => json(404, {})],
  ])('%s: sin resultado, y el registro queda idéntico (sigue sin resolver)', async (_n, resp) => {
    await sembrarRegistro(() => { throw new TypeError('red') })
    const antes = localStorage.getItem(clave(L, P))
    f.mockResolvedValueOnce(resp())
    expect((await comprobarActivacion({ ligaId: L, partidoId: P })).tipo).toBe('sin-resultado')
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
    expect(guardado().conIncierto).toBe(true)
  })

  it('un dispositivo distinto del guardado no se acepta ni se sobrescribe', async () => {
    await sembrarRegistro(() => activadaOk('dev-uno'))
    const antes = localStorage.getItem(clave(L, P))
    f.mockResolvedValueOnce(estadoOk({ deviceId: 'dev-otro' }))
    expect((await comprobarActivacion({ ligaId: L, partidoId: P })).tipo).toBe('sin-resultado')
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
  })

  it('sin conexión no sale nada; si el resultado no se puede guardar se dice y el registro anterior queda', async () => {
    await sembrarRegistro(() => { throw new TypeError('red') })
    sinConexion()
    expect(await comprobarActivacion({ ligaId: L, partidoId: P })).toEqual({ tipo: 'bloqueado', motivo: 'sin-conexion' })
    expect(f).not.toHaveBeenCalled()
    conConexion()
    const antes = localStorage.getItem(clave(L, P))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    f.mockResolvedValueOnce(estadoOk())
    const r = await comprobarActivacion({ ligaId: L, partidoId: P })
    expect(r).toMatchObject({ tipo: 'vigente', persistido: false })
    vi.restoreAllMocks()
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
  })

  it('no reenvía ninguna activación: nunca hay un POST', async () => {
    await sembrarRegistro(() => { throw new TypeError('red') })
    f.mockResolvedValue(json(401, {}))
    await comprobarActivacion({ ligaId: L, partidoId: P })
    await comprobarActivacion({ ligaId: L, partidoId: P })
    for (const [, op] of f.mock.calls) expect(op.method).toBe('GET')
  })
})

describe('aislamiento', () => {
  it('las claves de otros módulos no se tocan; cada partido tiene su registro', async () => {
    localStorage.setItem('sebel.op.v1:org-1:LIGA1', '{"x":1}')
    localStorage.setItem('otra', 'y')
    f.mockResolvedValueOnce(activadaOk('dev-a')).mockResolvedValueOnce(activadaOk('dev-b'))
    await activarTelefono({ ligaId: L, partidoId: 'PA', codigo: CODIGO })
    await activarTelefono({ ligaId: L, partidoId: 'PB', codigo: CODIGO })
    expect(localStorage.getItem('sebel.op.v1:org-1:LIGA1')).toBe('{"x":1}')
    expect(localStorage.getItem('otra')).toBe('y')
    expect(leerRegistro(L, 'PA').registro.token).not.toBe(leerRegistro(L, 'PB').registro.token)
    expect(Object.keys(localStorage).filter((k) => k.startsWith(PREFIJO)).sort()).toEqual([clave(L, 'PA'), clave(L, 'PB')])
  })
})
