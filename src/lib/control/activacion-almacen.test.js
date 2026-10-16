/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ESTADOS, MAX_REGISTRO_BYTES, MAX_TOTAL_BYTES, PREFIJO, bytes, clave, guardar, idValido, leerRegistro, listarRegistros, validarRegistro,
} from './activacion-almacen'

const TOKEN = 'a'.repeat(64)
const HASH = 'b'.repeat(64)
const registro = (extra = {}) => ({
  v: 1, ligaId: 'LIGA1', partidoId: 'P1', token: TOKEN, tokenHash: HASH, estado: 'activando', conIncierto: false, intentos: 1,
  creadoEn: 1_700_000_000_000, actualizadoEn: 1_700_000_000_000, deviceId: null, servidor: null, ...extra,
})
const texto = (r) => JSON.stringify(r)

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('constantes y bytes', () => {
  it('2 KiB por registro y 512 KiB en total, contados en bytes UTF-8', () => {
    expect(MAX_REGISTRO_BYTES).toBe(2048)
    expect(MAX_TOTAL_BYTES).toBe(512 * 1024)
    expect(PREFIJO).toBe('sebel.ctl.act.v1:')
    expect(bytes('abc')).toBe(3)
    expect(bytes('é')).toBe(2)
    expect(bytes('€')).toBe(3)
    expect(bytes('🏀')).toBe(4)
    expect('🏀'.length).toBe(2) // los caracteres no son bytes
  })
  it('los identificadores y los estados', () => {
    expect(idValido('LIGA-1_x')).toBe(true)
    for (const mal of ['', 'a:b', 'a b', 'x'.repeat(65), null, 7]) expect(idValido(mal)).toBe(false)
    expect([...ESTADOS]).toEqual(['activando', 'incierta', 'activada', 'denegada'])
    expect(clave('L', 'P')).toBe('sebel.ctl.act.v1:L:P')
  })
})

describe('forma del registro', () => {
  it('acepta uno bien formado en cada estado', () => {
    for (const r of [
      registro(), registro({ conIncierto: true }), registro({ estado: 'incierta', conIncierto: true }),
      registro({ estado: 'denegada' }),
      registro({ estado: 'activada', deviceId: 'dev-abc', servidor: { ahoraMs: 1, expiraEn: 2, retornoHasta: 3, leidoEn: 4 } }),
      registro({ estado: 'activada', deviceId: null, servidor: { ahoraMs: 1, expiraEn: null, retornoHasta: null, leidoEn: 4 } }),
    ]) expect(validarRegistro(texto(r), 'LIGA1', 'P1')).not.toBeNull()
  })
  it.each([
    ['clave de más', (r) => ({ ...r, extra: 1 })],
    ['versión', (r) => ({ ...r, v: 2 })],
    ['liga distinta de la clave', (r) => ({ ...r, ligaId: 'OTRA' })],
    ['partido distinto de la clave', (r) => ({ ...r, partidoId: 'OTRO' })],
    ['token que no es hex de 64', (r) => ({ ...r, token: 'zz' })],
    ['token en mayúsculas', (r) => ({ ...r, token: 'A'.repeat(64) })],
    ['hash corto', (r) => ({ ...r, tokenHash: 'b'.repeat(63) })],
    ['estado desconocido', (r) => ({ ...r, estado: 'raro' })],
    ['conIncierto que no es booleano', (r) => ({ ...r, conIncierto: 'no' })],
    ['activada arrastrando incertidumbre', (r) => ({ ...r, estado: 'activada', conIncierto: true })],
    ['denegada arrastrando incertidumbre', (r) => ({ ...r, estado: 'denegada', conIncierto: true })],
    ['incierta sin incertidumbre', (r) => ({ ...r, estado: 'incierta', conIncierto: false })],
    ['intentos 0', (r) => ({ ...r, intentos: 0 })],
    ['hora negativa', (r) => ({ ...r, creadoEn: -1 })],
    ['dispositivo vacío', (r) => ({ ...r, deviceId: '' })],
    ['dispositivo demasiado largo', (r) => ({ ...r, deviceId: 'd'.repeat(201) })],
    ['servidor sin una clave', (r) => ({ ...r, servidor: { ahoraMs: 1, expiraEn: 2, retornoHasta: 3 } })],
    ['servidor con texto', (r) => ({ ...r, servidor: { ahoraMs: 1, expiraEn: '2', retornoHasta: 3, leidoEn: 4 } })],
    ['servidor con una clave de más', (r) => ({ ...r, servidor: { ahoraMs: 1, expiraEn: 2, retornoHasta: 3, leidoEn: 4, x: 1 } })],
  ])('rechaza: %s', (_n, mutar) => expect(validarRegistro(texto(mutar(registro())), 'LIGA1', 'P1')).toBeNull())
  it('rechaza lo que no es texto o JSON de objeto', () => {
    for (const x of [null, undefined, 7, '', 'no json', '[]', '"x"', 'null']) expect(validarRegistro(x, 'LIGA1', 'P1')).toBeNull()
  })
  it('el tope por registro es exacto, en bytes UTF-8: 2048 pasa y 2049 no', () => {
    const base = texto(registro())
    const relleno = (n) => base + ' '.repeat(n - bytes(base)) // el espacio en blanco final es JSON válido
    expect(bytes(relleno(2048))).toBe(2048)
    expect(validarRegistro(relleno(2048), 'LIGA1', 'P1')).not.toBeNull()
    expect(validarRegistro(relleno(2049), 'LIGA1', 'P1')).toBeNull()
  })
})

describe('leer', () => {
  it('ninguno, válido, corrupto y no disponible', () => {
    expect(leerRegistro('LIGA1', 'P1')).toEqual({ tipo: 'ninguno' })
    localStorage.setItem(clave('LIGA1', 'P1'), texto(registro()))
    expect(leerRegistro('LIGA1', 'P1')).toMatchObject({ tipo: 'valido', registro: { estado: 'activando' } })
    localStorage.setItem(clave('LIGA1', 'P1'), '{"basura":true}')
    expect(leerRegistro('LIGA1', 'P1')).toEqual({ tipo: 'corrupto' })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(leerRegistro('LIGA1', 'P1')).toEqual({ tipo: 'no-disponible' })
    expect(listarRegistros()).toEqual({ disponible: false, n: 0, bytes: 0, registros: [] })
  })
  it('sin localStorage: no disponible', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(leerRegistro('LIGA1', 'P1')).toEqual({ tipo: 'no-disponible' })
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: false, motivo: 'almacenamiento' })
    vi.unstubAllGlobals()
  })
  it('listar cuenta bytes de claves y valores (también ilegibles) y solo de este prefijo', () => {
    localStorage.setItem(clave('LIGA1', 'P1'), texto(registro()))
    localStorage.setItem(`${PREFIJO}raro`, 'x€') // ilegible pero cuenta
    localStorage.setItem('sebel.op.v1:org:LIGA1', 'y'.repeat(5000)) // del organizador: no cuenta
    localStorage.setItem('otra', 'z'.repeat(5000))
    const l = listarRegistros()
    expect(l.disponible).toBe(true)
    expect(l.n).toBe(2)
    expect(l.bytes).toBe(bytes(clave('LIGA1', 'P1')) + bytes(texto(registro())) + bytes(`${PREFIJO}raro`) + bytes('x€'))
    expect(l.registros).toHaveLength(1)
    expect(l.registros[0]).toMatchObject({ ligaId: 'LIGA1', partidoId: 'P1', valido: true })
  })
})

describe('guardar: verificado, sin pisar ni inventar', () => {
  it('crea, lee de vuelta y deja el texto exacto', () => {
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: true })
    expect(localStorage.getItem(clave('LIGA1', 'P1'))).toBe(texto(registro()))
  })
  it('crear sobre algo que ya existe no lo toca: «existente» o «corrupto»', () => {
    localStorage.setItem(clave('LIGA1', 'P1'), texto(registro()))
    const antes = localStorage.getItem(clave('LIGA1', 'P1'))
    expect(guardar('LIGA1', 'P1', registro({ intentos: 9 }), { crear: true })).toEqual({ ok: false, motivo: 'existente' })
    localStorage.setItem(clave('LIGA1', 'P2'), 'basura')
    expect(guardar('LIGA1', 'P2', registro({ partidoId: 'P2' }), { crear: true })).toEqual({ ok: false, motivo: 'corrupto' })
    expect(localStorage.getItem(clave('LIGA1', 'P1'))).toBe(antes)
    expect(localStorage.getItem(clave('LIGA1', 'P2'))).toBe('basura')
  })
  it('actualizar algo que no existe no lo crea', () => {
    expect(guardar('LIGA1', 'P1', registro())).toEqual({ ok: false, motivo: 'ausente' })
    expect(localStorage.length).toBe(0)
  })
  it('un registro que no cumple la forma no se escribe', () => {
    expect(guardar('LIGA1', 'P1', registro({ token: 'corto' }), { crear: true })).toEqual({ ok: false, motivo: 'invalido' })
    expect(guardar('LIGA1', 'P1', registro({ estado: 'activada', conIncierto: true }), { crear: true })).toEqual({ ok: false, motivo: 'invalido' })
    expect(localStorage.length).toBe(0)
  })
  it('cuota excedida al crear o al actualizar: no se escribe y lo anterior queda intacto', () => {
    localStorage.setItem(clave('LIGA1', 'P1'), texto(registro()))
    const antes = localStorage.getItem(clave('LIGA1', 'P1'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    expect(guardar('LIGA1', 'P1', registro({ intentos: 2 }))).toEqual({ ok: false, motivo: 'almacenamiento' })
    expect(guardar('LIGA1', 'P2', registro({ partidoId: 'P2' }), { crear: true })).toEqual({ ok: false, motivo: 'almacenamiento' })
    expect(localStorage.getItem(clave('LIGA1', 'P1'))).toBe(antes)
    expect(localStorage.getItem(clave('LIGA1', 'P2'))).toBeNull()
  })
  it('lectura de verificación que no coincide: una creación retira solo su propia escritura; una actualización restaura lo anterior', () => {
    const leer = Storage.prototype.getItem
    const escribir = Storage.prototype.setItem
    let escrito = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { escrito = true; return escribir.call(this, k, v) })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return escrito && k === clave('LIGA1', 'P9') ? '{"corrupto":true}' : leer.call(this, k) })
    expect(guardar('LIGA1', 'P9', registro({ partidoId: 'P9' }), { crear: true })).toEqual({ ok: false, motivo: 'verificacion' })
    vi.restoreAllMocks()
    expect(localStorage.getItem(clave('LIGA1', 'P9'))).toBeNull()

    localStorage.setItem(clave('LIGA1', 'P1'), texto(registro()))
    const antes = localStorage.getItem(clave('LIGA1', 'P1'))
    const l2 = Storage.prototype.getItem
    const e2 = Storage.prototype.setItem
    let escrito2 = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { if (k === clave('LIGA1', 'P1') && v !== antes) escrito2 = true; return e2.call(this, k, v) })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return escrito2 && k === clave('LIGA1', 'P1') ? '{"corrupto":true}' : l2.call(this, k) })
    expect(guardar('LIGA1', 'P1', registro({ intentos: 5 }))).toEqual({ ok: false, motivo: 'verificacion' })
    vi.restoreAllMocks()
    expect(localStorage.getItem(clave('LIGA1', 'P1'))).toBe(antes)
  })
})

describe('capacidad: 512 KiB en bytes, sin expulsar nada', () => {
  /** Rellena con UNA clave del prefijo hasta que el total sea exactamente `objetivo` bytes (valor de 2 bytes por carácter + 1 si hace falta). */
  function llenarHasta(objetivo) {
    const k = `${PREFIJO}relleno:1`
    const resto = objetivo - bytes(k)
    const dobles = Math.floor(resto / 2)
    localStorage.setItem(k, 'é'.repeat(dobles) + (resto % 2 ? 'x' : ''))
    expect(listarRegistros().bytes).toBe(objetivo)
  }
  // Un registro NUEVO exige hueco para su clave y para el tamaño máximo de un registro (así su activación puede terminar de guardarse).
  const reserva = () => bytes(clave('LIGA1', 'P1')) + MAX_REGISTRO_BYTES

  it('el registro nuevo con el hueco EXACTO (clave + 2 KiB) entra; con un byte menos se rechaza y no se escribe nada', () => {
    llenarHasta(MAX_TOTAL_BYTES - reserva())
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: true })
    expect(listarRegistros().bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
    localStorage.clear()
    llenarHasta(MAX_TOTAL_BYTES - reserva() + 1)
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: false, motivo: 'capacidad' })
    expect(localStorage.getItem(clave('LIGA1', 'P1'))).toBeNull()
  })
  it('lo reservado alcanza para terminar la activación: tras entrar en el límite, la actualización a «activada» cabe', () => {
    llenarHasta(MAX_TOTAL_BYTES - reserva())
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: true })
    const completa = registro({ estado: 'activada', deviceId: 'd'.repeat(200), servidor: { ahoraMs: 9_999_999_999_999, expiraEn: 9_999_999_999_999, retornoHasta: 9_999_999_999_999, leidoEn: 9_999_999_999_999 } })
    expect(bytes(texto(completa))).toBeLessThanOrEqual(MAX_REGISTRO_BYTES)
    expect(guardar('LIGA1', 'P1', completa)).toEqual({ ok: true })
    expect(listarRegistros().bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })
  it('se cuentan bytes, no caracteres: un relleno de caracteres de 2 bytes agota el tope antes', () => {
    const k = `${PREFIJO}relleno:1`
    const objetivo = MAX_TOTAL_BYTES - reserva() + 1
    const valor = 'é'.repeat(Math.floor((objetivo - bytes(k)) / 2)) + ((objetivo - bytes(k)) % 2 ? 'x' : '')
    localStorage.setItem(k, valor)
    expect(k.length + valor.length).toBeLessThan(MAX_TOTAL_BYTES - reserva()) // en caracteres habría sitio de sobra
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: false, motivo: 'capacidad' })
  })
  it('lo que no es de este prefijo no cuenta', () => {
    localStorage.setItem('sebel.op.v1:org:L', 'y'.repeat(600_000))
    expect(guardar('LIGA1', 'P1', registro(), { crear: true })).toEqual({ ok: true })
  })
  it('una actualización que haría pasar el tope se rechaza y deja lo anterior; sin crecer, cabe; nada se expulsa', () => {
    const r = registro()
    localStorage.setItem(clave('LIGA1', 'P1'), texto(r))
    localStorage.setItem(clave('LIGA1', 'P2'), texto(registro({ partidoId: 'P2' })))
    const k = `${PREFIJO}relleno:1`
    const hueco = MAX_TOTAL_BYTES - listarRegistros().bytes - bytes(k)
    localStorage.setItem(k, 'x'.repeat(hueco))
    expect(listarRegistros().bytes).toBe(MAX_TOTAL_BYTES)
    const otros = { p2: localStorage.getItem(clave('LIGA1', 'P2')), relleno: localStorage.getItem(k) }
    const crece = registro({ estado: 'activada', deviceId: 'dev-0123456789abcdef', servidor: { ahoraMs: 1, expiraEn: 2, retornoHasta: 3, leidoEn: 4 } })
    expect(bytes(texto(crece))).toBeGreaterThan(bytes(texto(r)))
    expect(guardar('LIGA1', 'P1', crece)).toEqual({ ok: false, motivo: 'capacidad' })
    expect(localStorage.getItem(clave('LIGA1', 'P1'))).toBe(texto(r))
    expect(guardar('LIGA1', 'P1', registro({ intentos: 2 }))).toEqual({ ok: true }) // mismo tamaño
    expect({ p2: localStorage.getItem(clave('LIGA1', 'P2')), relleno: localStorage.getItem(k) }).toEqual(otros)
  })
  it('muchas partidas consecutivas caben: cientos de registros típicos, y al agotar el tope solo se rechaza el nuevo', () => {
    const id = (n) => `PARTIDO-${String(n).padStart(4, '0')}`
    for (let n = 0; n < 700; n += 1) localStorage.setItem(clave('LIGA1', id(n)), texto(registro({ partidoId: id(n) }))) // cargados directamente
    expect(listarRegistros().bytes).toBeLessThan(MAX_TOTAL_BYTES)
    let n = 700
    for (; n < 2000; n += 1) {
      const g = guardar('LIGA1', id(n), registro({ partidoId: id(n) }), { crear: true })
      if (!g.ok) { expect(g.motivo).toBe('capacidad'); break }
    }
    expect(n).toBeGreaterThan(700) // sin un tope fijo de partidos: solo el de bytes
    expect(n).toBeLessThan(2000)
    const l = listarRegistros()
    expect(l.bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
    expect(l.n).toBe(n) // ninguno expulsado
    expect(l.registros.every((r) => r.valido)).toBe(true)
  }, 60_000)
})
