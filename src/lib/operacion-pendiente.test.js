/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { instalarCandados, json, conConexion, sinConexion, aplicado, rechazado } from '../prueba/compartido'
import {
  MAX_CUERPO_BYTES, MAX_LIGAS_PROPIAS, MAX_REGISTRO_BYTES, MAX_REGISTROS, MAX_TOTAL_BYTES, MENSAJES_BLOQUEO, PREFIJO, clave, enviarNueva, leerRegistros, reintentar, validarRegistro,
} from './operacion-pendiente'

const ORG = 'org-aaaaaaaaaaaaaaaa'
const base = { organizadorId: ORG, ligaId: 'LIGA1', tipo: 'alta', equipoId: 'E1', contenido: { campos: { nombrePila: 'Carla', apellido1: 'Nueva', dorsal: '12' } } }
const ultimoCuerpo = () => JSON.parse(f.mock.calls.at(-1)[1].body)

let f
let candados
beforeEach(() => {
  localStorage.clear()
  candados = instalarCandados()
  conConexion()
  f = vi.fn()
  vi.stubGlobal('fetch', f)
})
afterEach(() => { candados.quitar(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const registroGuardado = (liga = 'LIGA1') => JSON.parse(localStorage.getItem(clave(ORG, liga)))

describe('límites verificados', () => {
  it('el tope por organizador viene del límite real de ligas del backend (10) y los topes de almacenamiento se derivan de él', () => {
    expect(MAX_LIGAS_PROPIAS).toBe(10)
    expect(MAX_REGISTROS).toBe(MAX_LIGAS_PROPIAS)
    expect(MAX_TOTAL_BYTES).toBe(MAX_REGISTROS * MAX_REGISTRO_BYTES)
    expect(MAX_CUERPO_BYTES).toBe(8192)
  })
})

describe('envío nuevo: el registro se guarda y se verifica ANTES de enviar', () => {
  it('cuando se llama a fetch, el registro ya está guardado, es válido y contiene exactamente el cuerpo que se envía', async () => {
    let visto
    f.mockImplementationOnce(async (url, op) => {
      visto = { guardado: localStorage.getItem(clave(ORG, 'LIGA1')), cuerpo: op.body, url }
      return json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: JSON.parse(op.body).operacionId })
    })
    const r = await enviarNueva(base)
    expect(r.tipo).toBe('decidido')
    const reg = JSON.parse(visto.guardado)
    expect(reg).toMatchObject({ v: 1, tipo: 'alta', ligaId: 'LIGA1', equipoId: 'E1', fichaId: null, intentos: 1, ultimo: 'enviando', conIncierto: false })
    expect(reg.cuerpoJson).toBe(visto.cuerpo) // byte a byte
    expect(JSON.parse(visto.cuerpo).operacionId).toBe(reg.operacionId)
    expect(reg.operacionId).toMatch(/^op-[0-9a-f-]{36}$/)
    expect(visto.url).toBe('/v1/organizador/ligas/LIGA1/equipos/E1/jugadores')
    expect(Object.keys(reg).sort()).toEqual(['conIncierto', 'creadoEn', 'cuerpoJson', 'equipoId', 'fichaId', 'intentos', 'ligaId', 'operacionId', 'tipo', 'ultimo', 'v'])
    expect(localStorage.getItem(clave(ORG, 'LIGA1'))).toBeNull() // un resultado decidido válido lo borra
  })

  it('el registro no guarda plantillas, borradores, códigos ni credenciales: solo la solicitud enviada', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await enviarNueva(base)
    const texto = localStorage.getItem(clave(ORG, 'LIGA1'))
    expect(texto).not.toMatch(/codigo|cookie|token|sesion|Authorization/i)
    expect(Object.keys(localStorage)).toEqual([clave(ORG, 'LIGA1')])
  })

  it('cada envío usa un identificador nuevo y un cuerpo propio', async () => {
    f.mockResolvedValue(json(200, { resultado: 'rechazado', tipo: 'conflicto-numero', operacionId: 'x' }))
    f.mockImplementation(async (u, op) => json(200, { resultado: 'rechazado', tipo: 'conflicto-numero', operacionId: JSON.parse(op.body).operacionId }))
    await enviarNueva(base)
    const a = ultimoCuerpo().operacionId
    await enviarNueva(base)
    expect(ultimoCuerpo().operacionId).not.toBe(a)
  })
})

describe('sin conexión', () => {
  it('muestra la frase aprobada, no genera identificador, no guarda nada y no envía', async () => {
    sinConexion()
    const r = await enviarNueva(base)
    expect(r).toEqual({ tipo: 'bloqueado', motivo: 'sin-conexion' })
    expect(MENSAJES_BLOQUEO['sin-conexion']).toBe('Se requiere conexión a internet para esta acción.')
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
  it('un reintento sin conexión tampoco envía ni cambia el registro', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await enviarNueva(base)
    const antes = localStorage.getItem(clave(ORG, 'LIGA1'))
    f.mockClear()
    sinConexion()
    expect(await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })).toEqual({ tipo: 'bloqueado', motivo: 'sin-conexion' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.getItem(clave(ORG, 'LIGA1'))).toBe(antes)
  })
})

describe('si el registro no se puede guardar y verificar, NO se envía (nunca en memoria)', () => {
  it('cuota excedida', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
  })
  it('almacenamiento no disponible', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
  })
  it('la lectura de verificación no coincide con lo escrito: no se envía y se conserva lo dudoso', async () => {
    const original = Storage.prototype.getItem
    let escrito = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { escrito = true; return Object.getPrototypeOf(this).constructor === Storage ? undefined : undefined; void k; void v })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return escrito ? '{"corrupto":true}' : original.call(this, k) })
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
  })
  it('sin Web Locks no se envía nada (no se supone que localStorage sea atómico)', async () => {
    candados.quitar()
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'sin-candado' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
  it('un cuerpo mayor que el aceptado por el servidor no se guarda ni se envía', async () => {
    const r = await enviarNueva({ ...base, contenido: { campos: { nombrePila: 'x'.repeat(MAX_CUERPO_BYTES), apellido1: 'B', dorsal: '1' } } })
    expect(r).toEqual({ tipo: 'bloqueado', motivo: 'demasiado-grande' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
})

describe('un registro por organizador y liga; sin expulsar ni pisar', () => {
  it('con un registro sin confirmar en esa liga no se envía otra acción y el registro queda intacto', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await enviarNueva(base)
    const antes = localStorage.getItem(clave(ORG, 'LIGA1'))
    f.mockClear()
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'pendiente' })
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.getItem(clave(ORG, 'LIGA1'))).toBe(antes)
    // otra liga del mismo organizador sí puede enviar
    f.mockRejectedValueOnce(new TypeError('red'))
    expect((await enviarNueva({ ...base, ligaId: 'LIGA2' })).tipo).toBe('incierto')
    expect(Object.keys(localStorage).sort()).toEqual([clave(ORG, 'LIGA1'), clave(ORG, 'LIGA2')])
  })

  it('un registro ilegible se conserva sin tocar y bloquea esa liga; los de otros organizadores no se muestran', async () => {
    localStorage.setItem(clave(ORG, 'LIGA1'), '{"v":2,"raro":true}')
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'corrupto' })
    expect(await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })).toEqual({ tipo: 'bloqueado', motivo: 'corrupto' })
    expect(localStorage.getItem(clave(ORG, 'LIGA1'))).toBe('{"v":2,"raro":true}')
    expect(f).not.toHaveBeenCalled()
    localStorage.setItem(clave('org-otro', 'LIGA9'), 'lo-que-sea')
    const l = leerRegistros(ORG)
    expect(l.registros.map((r) => [r.ligaId, r.valido])).toEqual([['LIGA1', false]])
    expect(l.total.n).toBe(2) // el ajeno cuenta para la capacidad
  })

  it('al llegar al tope total se rechaza una acción nueva sin expulsar ni sobrescribir ningún registro', async () => {
    for (let i = 0; i < MAX_REGISTROS; i += 1) localStorage.setItem(clave(i % 2 ? 'org-otro' : ORG, `LIGAX${i}`), '{"opaco":true}')
    const antes = JSON.stringify({ ...localStorage })
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'capacidad' })
    expect(f).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).toBe(antes)
  })

  it('el tope de bytes también cuenta', async () => {
    localStorage.setItem(clave('org-otro', 'LIGAGRANDE'), 'x'.repeat(MAX_TOTAL_BYTES))
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'capacidad' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('forma del registro leído', () => {
  const bueno = () => ({ v: 1, operacionId: 'op-1234567890abcdef', tipo: 'alta', ligaId: 'LIGA1', equipoId: 'E1', fichaId: null, cuerpoJson: JSON.stringify({ operacionId: 'op-1234567890abcdef', campos: {} }), creadoEn: 1, intentos: 1, ultimo: 'incierto', conIncierto: true })
  it('acepta uno bien formado', () => expect(validarRegistro(JSON.stringify(bueno()), ORG, 'LIGA1')).not.toBeNull())
  it.each([
    ['clave de más', (r) => ({ ...r, extra: 1 })],
    ['versión', (r) => ({ ...r, v: 2 })],
    ['tipo', (r) => ({ ...r, tipo: 'borrar' })],
    ['liga distinta de la clave', (r) => ({ ...r, ligaId: 'OTRA' })],
    ['alta con ficha', (r) => ({ ...r, fichaId: 'J1' })],
    ['editar sin ficha', (r) => ({ ...r, tipo: 'editar' })],
    ['operacionId distinto del cuerpo', (r) => ({ ...r, operacionId: 'op-otro-1234567890' })],
    ['cuerpo que no es JSON', (r) => ({ ...r, cuerpoJson: 'no json' })],
    ['intentos', (r) => ({ ...r, intentos: 0 })],
    ['último', (r) => ({ ...r, ultimo: 'raro' })],
    ['cuerpo demasiado grande', (r) => ({ ...r, cuerpoJson: JSON.stringify({ operacionId: r.operacionId, x: 'y'.repeat(MAX_CUERPO_BYTES) }) })],
  ])('rechaza: %s', (_n, mutar) => expect(validarRegistro(JSON.stringify(mutar(bueno())), ORG, 'LIGA1')).toBeNull())
  it('rechaza lo que no es texto o supera el tamaño del registro', () => {
    expect(validarRegistro(null, ORG, 'LIGA1')).toBeNull()
    expect(validarRegistro('x'.repeat(MAX_REGISTRO_BYTES + 1), ORG, 'LIGA1')).toBeNull()
  })
})

describe('doble pulsación y pestañas que compiten', () => {
  it('dos envíos a la vez en la misma liga: solo uno llega al servidor', async () => {
    let soltar
    f.mockImplementationOnce((u, op) => new Promise((r) => { soltar = () => r(json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: JSON.parse(op.body).operacionId })) }))
    const a = enviarNueva(base)
    await Promise.resolve(); await Promise.resolve()
    const b = await enviarNueva(base)
    expect(b).toEqual({ tipo: 'bloqueado', motivo: 'ocupado' })
    soltar()
    expect((await a).tipo).toBe('decidido')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('mientras otra pestaña tiene el candado de la liga no se envía ni se reintenta', async () => {
    let fin
    const retenido = new Promise((r) => { fin = r })
    const dentro = navigator.locks.request(`sebel-op:${ORG}:LIGA1`, {}, () => retenido)
    await Promise.resolve()
    expect(await enviarNueva(base)).toEqual({ tipo: 'bloqueado', motivo: 'ocupado' })
    expect(await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })).toMatchObject({ tipo: 'bloqueado' })
    expect(f).not.toHaveBeenCalled()
    fin(); await dentro
  })
})

describe('resultado incierto y repetición exacta', () => {
  it('tras un fallo de red el registro queda como incierto; repetir envía EXACTAMENTE el mismo cuerpo y el mismo identificador', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    const r1 = await enviarNueva(base)
    expect(r1).toEqual({ tipo: 'incierto' })
    const cuerpo1 = f.mock.calls[0][1].body
    expect(registroGuardado()).toMatchObject({ ultimo: 'incierto', conIncierto: true, intentos: 1 })
    f.mockImplementationOnce(async (u, op) => json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: JSON.parse(op.body).operacionId, reproducido: true }))
    const r2 = await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })
    expect(f.mock.calls[1][1].body).toBe(cuerpo1)
    expect(r2).toMatchObject({ tipo: 'decidido', reproducido: true, limpiezaFallida: false })
    expect(localStorage.getItem(clave(ORG, 'LIGA1'))).toBeNull()
  })

  it('NO hay caducidad: un registro de hace semanas se puede repetir igual', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await enviarNueva(base)
    const reg = registroGuardado()
    localStorage.setItem(clave(ORG, 'LIGA1'), JSON.stringify({ ...reg, creadoEn: Date.now() - 90 * 24 * 3600 * 1000 }))
    vi.useFakeTimers({ now: Date.now() + 90 * 24 * 3600 * 1000 })
    expect(leerRegistros(ORG).registros[0].valido).toBe(true)
    f.mockImplementationOnce(async (u, op) => aplicado('creado', JSON.parse(op.body).operacionId, {}))
    expect((await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })).tipo).toBe('decidido')
    vi.useRealTimers()
  })

  it('un registro que quedó «enviando» (recarga a mitad del envío) cuenta como incierto al repetir', async () => {
    f.mockImplementationOnce(() => new Promise(() => {})) // nunca responde: simula la página cerrada
    enviarNueva(base)
    await Promise.resolve(); await Promise.resolve()
    expect(registroGuardado().ultimo).toBe('enviando')
    candados.tomados.clear() // la pestaña murió: su candado se libera
    f.mockResolvedValueOnce(json(404, {}))
    const r = await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })
    expect(r).toMatchObject({ tipo: 'protocolo', resuelta: false }) // el 404 describe este intento, no el anterior
    expect(registroGuardado()).toMatchObject({ conIncierto: true, intentos: 2, ultimo: 'protocolo' })
  })

  const luegoFalla = [
    ['401', () => json(401, { error: 'no-autorizado' }), 'sesion'],
    ['403', () => json(403, {}), 'protocolo'],
    ['404', () => json(404, {}), 'protocolo'],
    ['413', () => json(413, {}), 'protocolo'],
    ['422', () => json(422, { error: 'solicitud-invalida' }), 'protocolo'],
    ['fallo-sin-escritura', () => json(503, { tipo: 'fallo-sin-escritura' }), 'sin-escritura'],
    ['identidad-no-verificable', () => json(503, { error: 'identidad-no-verificable' }), 'sin-escritura'],
  ]
  for (const [nombre, resp, tipo] of luegoFalla) {
    it(`un incierto seguido de un ${nombre} posterior NO queda resuelto: el registro original se conserva`, async () => {
      f.mockRejectedValueOnce(new TypeError('red'))
      await enviarNueva(base)
      const original = registroGuardado()
      f.mockResolvedValueOnce(resp())
      const r = await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })
      expect(r.tipo).toBe(tipo)
      const ahora = registroGuardado()
      expect(ahora.cuerpoJson).toBe(original.cuerpoJson)
      expect(ahora.operacionId).toBe(original.operacionId)
      expect(ahora.conIncierto).toBe(true)
    })
  }

  it('un 409 (conflicto) nunca descarta la solicitud original', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await enviarNueva(base)
    const original = registroGuardado()
    f.mockResolvedValueOnce(json(409, { error: 'operacion-conflicto' }))
    expect((await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })).tipo).toBe('conflicto')
    expect(registroGuardado()).toMatchObject({ operacionId: original.operacionId, cuerpoJson: original.cuerpoJson, ultimo: 'conflicto', conIncierto: true })
  })

  it('un primer intento con respuesta DEFINITIVA de que no se escribió (sin nada incierto antes) sí queda resuelto', async () => {
    f.mockResolvedValueOnce(json(422, { error: 'solicitud-invalida' }))
    const r = await enviarNueva(base)
    expect(r).toMatchObject({ tipo: 'protocolo', resuelta: true })
    expect(localStorage.length).toBe(0)
  })

  it('un 200 con otro identificador, un cuerpo raro o HTML NO es un resultado: sigue incierto', async () => {
    for (const resp of [json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: 'otro' }), json(200, { hola: 1 }), new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), json(500, {}), json(503, { tipo: 'resultado-desconocido' })]) {
      localStorage.clear()
      f.mockResolvedValueOnce(resp)
      expect((await enviarNueva(base)).tipo).toBe('incierto')
      expect(registroGuardado().ultimo).toBe('incierto')
    }
  })

  it('un resultado DECIDIDO (también un rechazo) borra el registro y verifica el borrado; si no puede borrarlo, lo dice', async () => {
    f.mockImplementationOnce(async (u, op) => rechazado('equipo-bloqueado', JSON.parse(op.body).operacionId))
    expect((await enviarNueva(base)).tipo).toBe('decidido')
    expect(localStorage.length).toBe(0)
    f.mockImplementationOnce(async (u, op) => rechazado('equipo-bloqueado', JSON.parse(op.body).operacionId))
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('no se puede borrar') })
    expect(await enviarNueva(base)).toMatchObject({ tipo: 'decidido', limpiezaFallida: true })
    expect(localStorage.length).toBe(1) // se conserva: repetirlo solo devolvería el mismo resultado
  })

  it('persistir el intento antes de repetir también se verifica: si falla, no se repite', async () => {
    f.mockRejectedValueOnce(new TypeError('red'))
    await enviarNueva(base)
    f.mockClear()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    expect(await reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
    expect(f).not.toHaveBeenCalled()
  })

  it('el prefijo de claves está versionado', () => expect(PREFIJO).toBe('sebel.op.v1:'))
})

// ---------------------------------------------------------------------------------------------------------------------
// REPORT_107: registro DURABLE interrumpido. La pestaña murió con la petición en vuelo, así que lo único que queda en el
// almacenamiento es lo escrito ANTES de enviar: { intentos: 1, ultimo: 'enviando', conIncierto: false }. Cualquier
// repetición posterior debe tratarlo como incierto y dejarlo escrito ANTES de enviar.
// ---------------------------------------------------------------------------------------------------------------------
describe('registro interrumpido «enviando» (la pestaña murió antes de la respuesta)', () => {
  const RUTA = '/v1/organizador/ligas/LIGA1/equipos/E1/jugadores'
  const K = clave(ORG, 'LIGA1')
  const repetir = () => reintentar({ organizadorId: ORG, ligaId: 'LIGA1' })

  /** Deja en el almacenamiento el estado exacto que queda tras un cierre en pleno envío. → { texto, original } */
  async function dejarInterrumpido() {
    f.mockClear()
    f.mockImplementationOnce(() => new Promise(() => {})) // la petición se envía y la respuesta nunca llega a esta página
    enviarNueva(base) // no se espera: la «pestaña» murió
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    candados.tomados.clear() // al morir la pestaña se liberan sus candados
    const texto = localStorage.getItem(K)
    const original = JSON.parse(texto)
    expect(original).toMatchObject({ v: 1, tipo: 'alta', ligaId: 'LIGA1', equipoId: 'E1', fichaId: null, intentos: 1, ultimo: 'enviando', conIncierto: false })
    expect(JSON.parse(original.cuerpoJson).operacionId).toBe(original.operacionId)
    expect(f.mock.calls[0][1].body).toBe(original.cuerpoJson)
    f.mockClear()
    return { texto, original }
  }

  const casos = [
    // [nombre, respuesta, tipo devuelto, `ultimo` que describe ese intento]
    ['401', () => json(401, { error: 'no-autorizado' }), 'sesion', 'sesion'],
    ['403', () => json(403, {}), 'protocolo', 'protocolo'],
    ['404', () => json(404, {}), 'protocolo', 'protocolo'],
    ['413', () => json(413, {}), 'protocolo', 'protocolo'],
    ['422', () => json(422, { error: 'solicitud-invalida' }), 'protocolo', 'protocolo'],
    ['503 fallo-sin-escritura (el servidor declara que no escribió)', () => json(503, { tipo: 'fallo-sin-escritura' }), 'sin-escritura', 'sin-escritura'],
    ['503 identidad-no-verificable (el servidor declara que no escribió)', () => json(503, { error: 'identidad-no-verificable' }), 'sin-escritura', 'sin-escritura'],
    ['409 conflicto de identificador', () => json(409, { error: 'operacion-conflicto' }), 'conflicto', 'conflicto'],
    ['500 sin decisión', () => json(500, {}), 'incierto', 'incierto'],
    ['fallo de red', () => { throw new TypeError('red') }, 'incierto', 'incierto'],
  ]
  for (const [nombre, resp, tipo, ultimo] of casos) {
    it(`repetir tras ${nombre}: mismo identificador y cuerpo, incertidumbre y nº de intento ya guardados ANTES de enviar, y el registro sigue sin resolver`, async () => {
      const { original } = await dejarInterrumpido()
      let visto = null
      f.mockImplementationOnce(async (url, op) => {
        visto = { guardado: localStorage.getItem(K), cuerpo: op.body, url, metodo: op.method }
        return resp()
      })
      const r = await repetir()

      // --- lo que había en el almacenamiento en el instante de enviar ---
      expect(f).toHaveBeenCalledTimes(1)
      expect(visto).not.toBeNull()
      expect(JSON.parse(visto.guardado)).toEqual({ ...original, intentos: 2, ultimo: 'enviando', conIncierto: true })
      expect(visto.metodo).toBe('POST')
      expect(visto.url).toBe(RUTA)
      expect(visto.cuerpo).toBe(original.cuerpoJson) // byte a byte
      expect(JSON.parse(visto.cuerpo).operacionId).toBe(original.operacionId)

      // --- lo que queda después: sin resolver, incertidumbre conservada ---
      expect(r.tipo).toBe(tipo)
      expect(r.tipo).not.toBe('decidido')
      expect(r.resuelta).not.toBe(true)
      if (tipo === 'protocolo' || tipo === 'sin-escritura') expect(r.resuelta).toBe(false)
      expect(registroGuardado()).toEqual({ ...original, intentos: 2, ultimo, conIncierto: true })
      expect(registroGuardado().operacionId).toBe(original.operacionId)
      expect(registroGuardado().cuerpoJson).toBe(original.cuerpoJson)
      const l = leerRegistros(ORG)
      expect(l.registros).toHaveLength(1)
      expect(l.registros[0]).toMatchObject({ ligaId: 'LIGA1', valido: true })
    })
  }

  it('varias repeticiones sin decisión (401 → 403 → red → 500) nunca limpian la incertidumbre; solo un resultado decidido borra el registro', async () => {
    const { original } = await dejarInterrumpido()
    const cuerpos = []
    const intentar = async (resp, esperado) => {
      f.mockImplementationOnce(async (url, op) => {
        cuerpos.push(op.body)
        expect(JSON.parse(localStorage.getItem(K))).toMatchObject({ conIncierto: true, ultimo: 'enviando' }) // ya guardado antes de CADA envío
        return resp()
      })
      expect((await repetir()).tipo).toBe(esperado)
      expect(registroGuardado()).toMatchObject({ operacionId: original.operacionId, cuerpoJson: original.cuerpoJson, conIncierto: true })
    }
    await intentar(() => json(401, { error: 'no-autorizado' }), 'sesion')
    await intentar(() => json(403, {}), 'protocolo')
    await intentar(() => { throw new TypeError('red') }, 'incierto')
    await intentar(() => json(500, {}), 'incierto')
    expect(registroGuardado().intentos).toBe(5)
    expect(localStorage.getItem(K)).not.toBeNull()

    // finalmente el servidor reproduce el recibo ORIGINAL de la operación que sí había confirmado
    f.mockImplementationOnce(async (url, op) => {
      cuerpos.push(op.body)
      return json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: JSON.parse(op.body).operacionId, reproducido: true })
    })
    const r = await repetir()
    expect(r).toMatchObject({ tipo: 'decidido', reproducido: true, limpiezaFallida: false })
    expect(r.cuerpo.operacionId).toBe(original.operacionId)
    expect(localStorage.getItem(K)).toBeNull()
    expect(cuerpos).toHaveLength(5)
    expect(new Set(cuerpos)).toEqual(new Set([original.cuerpoJson])) // las cinco repeticiones fueron la MISMA solicitud
  })

  it('el recibo reproducido tras la interrupción limpia el registro; un rechazo decidido también', async () => {
    for (const [resultado, tipoRes] of [['aplicado', 'creado'], ['rechazado', 'equipo-bloqueado']]) {
      localStorage.clear(); candados.tomados.clear()
      const { original } = await dejarInterrumpido()
      f.mockImplementationOnce(async (u, op) => json(200, { resultado, tipo: tipoRes, operacionId: JSON.parse(op.body).operacionId, reproducido: true }))
      const r = await repetir()
      expect(r).toMatchObject({ tipo: 'decidido', reproducido: true, limpiezaFallida: false })
      expect(r.cuerpo.operacionId).toBe(original.operacionId)
      expect(localStorage.getItem(K)).toBeNull()
    }
  })

  describe('si NO se puede guardar el estado de la repetición, no se envía nada y el registro original se conserva', () => {
    it('la escritura lanza (cuota excedida): sin petición, registro idéntico byte a byte', async () => {
      const { texto } = await dejarInterrumpido()
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
      expect(await repetir()).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
      expect(f).not.toHaveBeenCalled()
      expect(localStorage.getItem(K)).toBe(texto)
      expect(registroGuardado()).toMatchObject({ intentos: 1, ultimo: 'enviando', conIncierto: false }) // sigue siendo el original (y se tratará como incierto)
      expect(leerRegistros(ORG).registros[0]).toMatchObject({ valido: true })
    })

    it('la escritura no tiene efecto y la lectura de verificación no coincide: sin petición y registro idéntico', async () => {
      const { texto } = await dejarInterrumpido()
      const leer = Storage.prototype.getItem
      let intentoEscribir = false
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { intentoEscribir = true })
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return intentoEscribir && k === K ? '{"corrupto":true}' : leer.call(this, k) })
      expect(await repetir()).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
      expect(f).not.toHaveBeenCalled()
      vi.restoreAllMocks()
      expect(localStorage.getItem(K)).toBe(texto)
    })

    it('la escritura se hizo pero no se puede leer de vuelta: sin petición; lo escrito conserva identificador, cuerpo e incertidumbre', async () => {
      const { original } = await dejarInterrumpido()
      const leer = Storage.prototype.getItem
      const escribir = Storage.prototype.setItem
      let escrito = false
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { escrito = true; return escribir.call(this, k, v) })
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return escrito && k === K ? '{"corrupto":true}' : leer.call(this, k) })
      expect(await repetir()).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
      expect(f).not.toHaveBeenCalled()
      vi.restoreAllMocks()
      expect(registroGuardado()).toMatchObject({ operacionId: original.operacionId, cuerpoJson: original.cuerpoJson, conIncierto: true })
    })

    it('el fallo es transitorio: al volver el almacenamiento, la misma solicitud se repite y se resuelve con el recibo original', async () => {
      const { original } = await dejarInterrumpido()
      const espia = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
      expect(await repetir()).toEqual({ tipo: 'bloqueado', motivo: 'almacenamiento' })
      expect(f).not.toHaveBeenCalled()
      espia.mockRestore()
      f.mockImplementationOnce(async (u, op) => json(200, { resultado: 'aplicado', tipo: 'creado', operacionId: JSON.parse(op.body).operacionId, reproducido: true }))
      const r = await repetir()
      expect(r).toMatchObject({ tipo: 'decidido', reproducido: true })
      expect(f.mock.calls[0][1].body).toBe(original.cuerpoJson)
      expect(localStorage.getItem(K)).toBeNull()
    })
  })
})
