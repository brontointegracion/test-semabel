import { afterEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { leerJsonConLimite } from '../src/cuerpo.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, cabecerasEscritura, control, reiniciarAcceso } from './ayuda-acceso.js'

// LECTURA ACOTADA POR FLUJO. Los flujos de estas pruebas no tienen cola previa (highWaterMark 0): cada trozo que el
// lector consume es un trozo que el origen tuvo que producir, así que `extraidos` mide exactamente lo leído.

const codificar = (t) => new TextEncoder().encode(t)
const trozosDe = (bytes, tamano) => { const r = []; for (let i = 0; i < bytes.length; i += tamano) r.push(bytes.slice(i, i + tamano)); return r }

function flujo(trozos, { falloEn = null } = {}) {
  const estado = { extraidos: 0, cancelado: false }
  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (falloEn !== null && i === falloEn) { controller.error(new Error('flujo roto')); return }
      if (i >= trozos.length) { controller.close(); return }
      estado.extraidos += 1
      controller.enqueue(trozos[i]); i += 1
    },
    cancel() { estado.cancelado = true },
  }, new CountQueuingStrategy({ highWaterMark: 0 }))
  return { stream, estado }
}
const falsa = (stream, cabeceras = {}) => ({ headers: new Headers(cabeceras), body: stream })
// JSON {"a":"…"} de exactamente `bytes` bytes, con el carácter dado repetido (que ocupa `anchura` bytes).
function jsonDe(bytes, caracter = 'x', anchura = 1) {
  const marco = codificar('{"a":""}').length
  const n = Math.floor((bytes - marco) / anchura)
  const sobrante = bytes - marco - n * anchura
  return `{"a":"${caracter.repeat(n)}${'x'.repeat(sobrante)}"}`
}

afterEach(() => { control.ahoraMs = null })

describe('lector por flujo (unidad)', () => {
  const MAX = 64
  it('un JSON válido pequeño, en uno o varios trozos', async () => {
    for (const tamano of [1, 3, 100]) {
      const { stream } = flujo(trozosDe(codificar('{"a":1,"b":[true,null]}'), tamano))
      expect(await leerJsonConLimite(falsa(stream), MAX)).toEqual({ valor: { a: 1, b: [true, null] } })
    }
  })

  it('sin Content-Length: exactamente el límite pasa; un byte más da 413', async () => {
    const exacto = jsonDe(MAX)
    expect(codificar(exacto)).toHaveLength(MAX)
    const ok = flujo(trozosDe(codificar(exacto), 7))
    expect((await leerJsonConLimite(falsa(ok.stream), MAX)).valor).toEqual({ a: exacto.slice(6, -2) })
    const mas = flujo(trozosDe(codificar(jsonDe(MAX + 1)), 7))
    expect(await leerJsonConLimite(falsa(mas.stream), MAX)).toEqual({ estado: 413, error: 'cuerpo-demasiado-grande' })
    expect(mas.estado.cancelado).toBe(true)
  })

  it('se cuentan BYTES, no caracteres, aunque un carácter quede partido entre dos trozos', async () => {
    for (const [caracter, anchura] of [['é', 2], ['€', 3], ['😀', 4]]) {
      const exacto = codificar(jsonDe(MAX, caracter, anchura))
      expect(exacto).toHaveLength(MAX)
      const r = await leerJsonConLimite(falsa(flujo(trozosDe(exacto, 1)).stream), MAX) // trozos de 1 byte: parten los caracteres
      expect(r.valor.a.startsWith(caracter)).toBe(true)
      expect(r.valor.a).toContain(caracter.repeat(3))
      const pasado = codificar(jsonDe(MAX + 1, caracter, anchura))
      expect(await leerJsonConLimite(falsa(flujo(trozosDe(pasado, 1)).stream), MAX)).toMatchObject({ estado: 413 })
    }
    // 20 emojis son 20 "caracteres" pero 80 bytes
    const veinte = codificar(`{"a":"${'😀'.repeat(15)}"}`)
    expect(veinte.length).toBeGreaterThan(MAX)
    expect((await leerJsonConLimite(falsa(flujo(trozosDe(veinte, 5)).stream), MAX)).estado).toBe(413)
  })

  it('Content-Length falso (dice poco, llega mucho): se hace cumplir contando, y se cancela', async () => {
    const { stream, estado } = flujo(trozosDe(codificar(jsonDe(5000)), 16))
    expect(await leerJsonConLimite(falsa(stream, { 'content-length': '10' }), MAX)).toMatchObject({ estado: 413 })
    expect(estado.cancelado).toBe(true)
    expect(estado.extraidos).toBeLessThanOrEqual(5)
  })

  it('Content-Length que ya supera el límite es solo una pista temprana: se rechaza SIN leer y se cancela el flujo', async () => {
    const { stream, estado } = flujo(trozosDe(codificar(jsonDe(5000)), 16))
    expect(await leerJsonConLimite(falsa(stream, { 'content-length': '999999' }), MAX)).toMatchObject({ estado: 413, error: 'cuerpo-demasiado-grande' })
    expect(estado.extraidos).toBe(0)
    expect(estado.cancelado).toBe(true)
  })

  it('cancelación temprana: tras superar el límite no se consume el resto del flujo', async () => {
    const mil = Array.from({ length: 1000 }, () => codificar('0123456789abcdef')) // 16 bytes cada uno
    const { stream, estado } = flujo(mil)
    expect(await leerJsonConLimite(falsa(stream), MAX)).toMatchObject({ estado: 413 })
    expect(estado.extraidos).toBe(5) // 4 trozos = 64 bytes (cabe); el 5.º pasa de 64 y ahí se corta
    expect(estado.cancelado).toBe(true)
  })

  it('JSON mal formado, vacío, UTF-8 inválido o no-flujo dan 400 json-invalido, sin eco del contenido', async () => {
    for (const bytes of [codificar('{no es json'), codificar(''), new Uint8Array([0xff, 0xfe, 0xfd]), codificar('{"a":1} basura')]) {
      const r = await leerJsonConLimite(falsa(flujo(bytes.length ? [bytes] : []).stream), MAX)
      expect(r).toEqual({ estado: 400, error: 'json-invalido' })
    }
    expect(await leerJsonConLimite(falsa(null), MAX)).toEqual({ estado: 400, error: 'json-invalido' })
  })

  it('un byte UTF-8 inválido DENTRO de un JSON que sería válido también se rechaza (no se "repara" con U+FFFD)', async () => {
    const dentro = new Uint8Array([...codificar('{"a":"'), 0xff, ...codificar('"}')])
    expect(await leerJsonConLimite(falsa(flujo([dentro]).stream), MAX)).toEqual({ estado: 400, error: 'json-invalido' })
  })

  it('un error del flujo no se propaga: es un cuerpo inválido', async () => {
    const { stream } = flujo([codificar('{"a"'), codificar(':1}')], { falloEn: 1 })
    expect(await leerJsonConLimite(falsa(stream), MAX)).toEqual({ estado: 400, error: 'json-invalido' })
  })

  it('un límite que no es un entero positivo es un error de programación, no un cuerpo', async () => {
    for (const malo of [0, -1, 1.5, NaN, undefined, '64']) await expect(leerJsonConLimite(falsa(null), malo)).rejects.toThrow()
  })
})

describe('en las rutas reales: mismo límite, mismas respuestas, sin leer de más', () => {
  const URL_BASE = 'https://backend.local'
  const pedir = (ruta, cabeceras, trozos) => {
    const { stream, estado } = flujo(trozos)
    const peticion = new Request(`${URL_BASE}${ruta}`, { method: 'POST', headers: cabeceras, body: stream, duplex: 'half' })
    return worker.fetch(peticion, env).then(async (r) => ({ status: r.status, texto: await r.text(), estado, cabeceras: r.headers }))
  }
  const consola = () => {
    const lineas = []; const originales = {}
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) { originales[m] = console[m]; console[m] = (...a) => lineas.push(a.map(String).join(' ')) }
    return { lineas, restaurar: () => Object.assign(console, originales) }
  }

  it('inicio de sesión (4 KiB): un flujo sin Content-Length que se pasa recibe 413, se cancela, y el contenido no se registra ni se devuelve', async () => {
    await reiniciarAcceso()
    const marcador = 'MARCADOR-DEL-CUERPO-NO-DEBE-APARECER'
    const trozos = Array.from({ length: 500 }, () => codificar(marcador.padEnd(64, '-')))
    const c = consola()
    let r
    try { r = await pedir('/v1/acceso/organizador', cabecerasEscritura(), trozos) } finally { c.restaurar() }
    expect(r.status).toBe(413)
    expect(JSON.parse(r.texto)).toEqual({ error: 'cuerpo-demasiado-grande' })
    expect(r.estado.cancelado).toBe(true)
    expect(r.estado.extraidos).toBeLessThanOrEqual(Math.ceil(4096 / 64) + 1) // 64 trozos caben; el 65.º pasa
    expect(r.texto).not.toContain(marcador)
    expect(c.lineas.join('\n')).not.toContain(marcador)
  })

  it('inicio de sesión: justo en el límite de 4 KiB se lee entero (el código erróneo da el 401 genérico, no 413)', async () => {
    await reiniciarAcceso()
    const cuerpo = codificar(jsonDe(4096))
    expect(cuerpo).toHaveLength(4096)
    const r = await pedir('/v1/acceso/organizador', cabecerasEscritura(), trozosDe(cuerpo, 500))
    expect(r.status).toBe(401)
    expect(JSON.parse(r.texto)).toEqual({ error: 'no-autorizado' })
    const mas = await pedir('/v1/acceso/organizador', cabecerasEscritura(), trozosDe(codificar(jsonDe(4097)), 500))
    expect(mas.status).toBe(413)
  })

  it('activación (4 KiB): igual, con cancelación', async () => {
    const liga = nuevaLiga()
    const trozos = Array.from({ length: 300 }, () => codificar('x'.repeat(100)))
    const r = await pedir(`/v1/ligas/${liga}/partidos/P/activar`, { 'content-type': 'application/json' }, trozos)
    expect(r.status).toBe(413)
    expect(r.estado.cancelado).toBe(true)
    expect(r.estado.extraidos).toBeLessThanOrEqual(Math.ceil(4096 / 100) + 1)
  })

  it('comandos (el lector antiguo, 64 KiB): el límite sigue siendo 64 KiB, ahora por flujo', async () => {
    const liga = nuevaLiga()
    const cab = { authorization: `Bearer ${'a'.repeat(40)}`, 'content-type': 'application/json' }
    const exacto = await pedir(`/v1/ligas/${liga}/partidos/P/comandos`, cab, trozosDe(codificar(jsonDe(64 * 1024)), 4000))
    expect(exacto.status).toBe(400) // se leyó entero: el sobre no es el del partido
    expect(JSON.parse(exacto.texto)).toEqual({ error: 'juego-distinto' })
    const mas = await pedir(`/v1/ligas/${liga}/partidos/P/comandos`, cab, trozosDe(codificar(jsonDe(64 * 1024 + 1)), 4000))
    expect(mas.status).toBe(413)
    expect(mas.estado.cancelado).toBe(true)
    const mil = Array.from({ length: 400 }, () => codificar('y'.repeat(1000)))
    const largo = await pedir(`/v1/ligas/${liga}/partidos/P/comandos`, cab, mil)
    expect(largo.status).toBe(413)
    expect(largo.estado.extraidos).toBeLessThanOrEqual(Math.ceil(64 * 1024 / 1000) + 1)
  })

  it('JSON inválido y flujo roto dan 400 con el mismo código fijo en las rutas', async () => {
    const liga = nuevaLiga()
    const cab = { authorization: `Bearer ${'a'.repeat(40)}`, 'content-type': 'application/json' }
    const malo = await pedir(`/v1/ligas/${liga}/partidos/P/comandos`, cab, [codificar('{roto')])
    expect(malo.status).toBe(400)
    expect(JSON.parse(malo.texto)).toEqual({ error: 'json-invalido' })
    const roto = flujo([codificar('{"a"')], { falloEn: 1 })
    const r = await worker.fetch(new Request(`https://backend.local/v1/ligas/${liga}/partidos/P/activar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: roto.stream, duplex: 'half' }), env)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'json-invalido' })
    expect(ORIGEN).toBe('https://backend.local')
  })
})
