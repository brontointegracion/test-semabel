import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { MAX_LIGAS_ADMITIDAS, ligaAdmitida, ligasAdmitidas } from '../src/admision.js'
import { SEMILLA_TOKEN, nuevaLiga, payloadDeLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, Telefono, ligaSembrada, sembrar } from './ayuda.js'

// ADMISIÓN DE LIGAS. Se demuestra con un binding ESPÍA que registra cualquier acceso (leer una propiedad basta) y
// lanza: una respuesta 404 sola no prueba que no se haya buscado ni creado un Durable Object.

const URL_BASE = 'https://backend.local'
const NO_ENCONTRADO = { error: 'no-encontrado' }

function bindingEspia() {
  const accesos = []
  const LIGA = new Proxy({}, {
    get(_, propiedad) {
      accesos.push(String(propiedad))
      return () => { throw new Error('binding tocado') }
    },
  })
  return { LIGA, accesos }
}
const entornoEspia = (extra = {}) => {
  const { LIGA, accesos } = bindingEspia()
  return { entorno: { ENTORNO: 'prueba', PERMITIR_SEMILLA: '1', SEMILLA_TOKEN: SEMILLA_TOKEN, LIGAS_ADMITIDAS: 'LIGAADMITIDA,OTRAADMITIDA', ...extra, LIGA }, accesos }
}
const pedir = (entorno, ruta, { metodo = 'GET', cabeceras = {}, cuerpo } = {}) =>
  worker.fetch(new Request(`${URL_BASE}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo }), entorno)
const leer = async (r) => ({ status: r.status, texto: await r.text() })

const RUTAS = (liga) => [
  ['GET lectura', `/v1/ligas/${liga}/partidos/P`, {}],
  ['GET lectura pública de la liga', `/v1/ligas/${liga}/publico`, {}],
  ['GET lectura pública de un equipo', `/v1/ligas/${liga}/equipos/E1/publico`, {}],
  ['POST sobre la lectura pública de un equipo (método incorrecto)', `/v1/ligas/${liga}/equipos/E1/publico`, { metodo: 'POST', cuerpo: '{}' }],
  ['POST sobre la lectura pública de la liga (método incorrecto)', `/v1/ligas/${liga}/publico`, { metodo: 'POST', cuerpo: '{}' }],
  ['POST comando con credencial', `/v1/ligas/${liga}/partidos/P/comandos`, { metodo: 'POST', cabeceras: { authorization: 'Bearer token-cualquiera-0123456789' }, cuerpo: '{"gameId":"P"}' }],
  ['POST comando sin credencial', `/v1/ligas/${liga}/partidos/P/comandos`, { metodo: 'POST', cuerpo: '{}' }],
  ['POST comando con cuerpo inválido', `/v1/ligas/${liga}/partidos/P/comandos`, { metodo: 'POST', cabeceras: { authorization: 'Bearer token-cualquiera-0123456789' }, cuerpo: '{no json' }],
  ['GET sobre ruta de comandos (método incorrecto)', `/v1/ligas/${liga}/partidos/P/comandos`, {}],
  ['POST sobre ruta de lectura (método incorrecto)', `/v1/ligas/${liga}/partidos/P`, { metodo: 'POST', cuerpo: '{}' }],
  ['POST siembra con secreto correcto', `/v1/_semilla/ligas/${liga}`, { metodo: 'POST', cabeceras: { authorization: `Bearer ${SEMILLA_TOKEN}` }, cuerpo: JSON.stringify(payloadDeLiga(liga)) }],
  ['GET siembra', `/v1/_semilla/ligas/${liga}`, {}],
]

describe('1. una liga no admitida recibe el mismo 404 sin tocar el binding', () => {
  it('lecturas, comandos (con o sin credencial, bien o mal formados), métodos incorrectos y siembra: idéntico 404, binding intacto', async () => {
    const { entorno, accesos } = entornoEspia()
    const referencia = await leer(await pedir(entorno, '/otra/ruta/cualquiera')) // el 404 de una ruta desconocida
    expect(referencia.status).toBe(404)
    expect(JSON.parse(referencia.texto)).toEqual(NO_ENCONTRADO)

    for (const [nombre, ruta, opciones] of RUTAS('LIGANOADMITIDA')) {
      const r = await pedir(entorno, ruta, opciones)
      expect({ nombre, ...(await leer(r)) }).toEqual({ nombre, status: 404, texto: referencia.texto })
      expect(r.headers.get('allow'), nombre).toBeNull() // un 405 revelaría que la ruta "existe"
    }
    expect(accesos).toEqual([]) // ni idFromName, ni get, ni getByName, ni ninguna otra propiedad
  })

  it('el 404 no expone la lista ni ningún ID admitido', async () => {
    const { entorno } = entornoEspia()
    for (const [, ruta, opciones] of RUTAS('LIGANOADMITIDA')) {
      const r = await pedir(entorno, ruta, opciones)
      const todo = JSON.stringify([...r.headers]) + await r.text()
      expect(todo).not.toMatch(/ADMITIDA|LIGAS_ADMITIDAS|OTRAADMITIDA/)
    }
  })

  it('una liga admitida SÍ llega al binding (la admisión permite enrutar)', async () => {
    // lectura y comando con credencial: un comando SIN credencial se rechaza (401) antes de llegar al objeto, también en ligas admitidas
    for (const [nombre, ruta, opciones] of RUTAS('LIGAADMITIDA').slice(0, 2)) {
      const { entorno, accesos } = entornoEspia()
      await pedir(entorno, ruta, opciones)
      expect(accesos.length, nombre).toBeGreaterThan(0)
    }
  })
})

describe('2. configuración ausente, vacía o mal formada: falla cerrada', () => {
  const MALAS = [
    ['ausente', undefined], ['vacía', ''], ['solo espacios', '   '], ['solo coma', ','], ['coma final', 'LIGAADMITIDA,'],
    ['coma inicial', ',LIGAADMITIDA'], ['elemento vacío', 'LIGAADMITIDA,,OTRAADMITIDA'], ['espacio tras la coma', 'LIGAADMITIDA, OTRAADMITIDA'],
    ['espacio dentro', 'LIGA ADMITIDA'], ['punto y coma', 'LIGAADMITIDA;OTRAADMITIDA'], ['barra', 'LIGAADMITIDA,LIGA/X'],
    ['comodín', 'LIGAADMITIDA,LIGA*'], ['salto de línea', 'LIGAADMITIDA\nOTRAADMITIDA'], ['tabulación', 'LIGAADMITIDA\t'],
    ['ID de 65 caracteres', `LIGAADMITIDA,${'A'.repeat(65)}`], ['no es texto (número)', 12345], ['no es texto (lista)', ['LIGAADMITIDA']],
    ['no es texto (objeto)', { 0: 'LIGAADMITIDA' }], ['null', null],
    ['más IDs que el máximo', Array.from({ length: MAX_LIGAS_ADMITIDAS + 1 }, (_, i) => `L${i}`).join(',')],
  ]
  for (const [nombre, valor] of MALAS) {
    it(`${nombre}: no se admite ninguna liga, ni siquiera las que aparecen bien escritas`, async () => {
      const { entorno, accesos } = entornoEspia({ LIGAS_ADMITIDAS: valor })
      expect(ligasAdmitidas(entorno)).toBeNull()
      for (const [, ruta, opciones] of RUTAS('LIGAADMITIDA')) {
        const r = await leer(await pedir(entorno, ruta, opciones))
        expect(r.status).toBe(404)
        expect(JSON.parse(r.texto)).toEqual(NO_ENCONTRADO)
      }
      expect(accesos).toEqual([])
    })
  }

  it('con una lista válida, esa misma petición sí llega al binding (el control no es "todo cerrado")', async () => {
    const { entorno, accesos } = entornoEspia({ LIGAS_ADMITIDAS: 'LIGAADMITIDA' })
    await pedir(entorno, `/v1/ligas/LIGAADMITIDA/partidos/P`)
    expect(accesos.length).toBeGreaterThan(0)
  })
})

describe('3. coincidencia exacta', () => {
  const lista = 'LIGA1,LIGA22,Mixta_9-A'
  it('admite exactamente lo listado', () => {
    for (const id of ['LIGA1', 'LIGA22', 'Mixta_9-A']) expect(ligaAdmitida({ LIGAS_ADMITIDAS: lista }, id), id).toBe(true)
  })
  it('rechaza prefijos, subcadenas, sufijos, mayúsculas distintas, espacios y nombres para mostrar', () => {
    const sosias = ['LIGA', 'LIGA2', 'LIGA11', 'LIGA1X', 'XLIGA1', 'liga1', 'LIGA22 ', ' LIGA22', 'LIGA221', 'IGA1', 'mixta_9-a', 'Mixta_9', '',
      'Liga sintética LIGA1', 'LIGA1,LIGA22', 'LIGA1%2CLIGA22', 'LIGA1\u0000', 'LIGA１']
    for (const id of sosias) expect(ligaAdmitida({ LIGAS_ADMITIDAS: lista }, id), JSON.stringify(id)).toBe(false)
    expect(ligaAdmitida({ LIGAS_ADMITIDAS: lista }, undefined)).toBe(false)
    expect(ligaAdmitida({ LIGAS_ADMITIDAS: lista }, null)).toBe(false)
    expect(ligaAdmitida({ LIGAS_ADMITIDAS: lista }, ['LIGA1'])).toBe(false)
  })
  it('el nombre para mostrar de una liga admitida no la hace enrutable', async () => {
    const { entorno, accesos } = entornoEspia({ LIGAS_ADMITIDAS: 'LIGA1' })
    const r = await leer(await pedir(entorno, '/v1/ligas/Liga-sint%C3%A9tica-LIGA1/partidos/P'))
    expect(r.status).toBe(404)
    expect(accesos).toEqual([])
  })
})

describe('4. las ligas admitidas conservan lectura, comandos y autorización', () => {
  it('lectura 200, comando aceptado, 401 genérico con credencial ajena y 404 de un partido inexistente', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const { exports } = await import('cloudflare:workers')
    const lectura = await exports.default.fetch(new Request(`${URL_BASE}/v1/ligas/${ligaId}/partidos/P`))
    expect(lectura.status).toBe(200)
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    const ajeno = await P.enviar(await P.sobre('arrancar-reloj', {}, { t: T0 + 2000 }), tokenDe(ligaId, 'Q'))
    expect(ajeno.status).toBe(401)
    expect(await ajeno.json()).toEqual({ error: 'no-autorizado' })
    const noHay = await exports.default.fetch(new Request(`${URL_BASE}/v1/ligas/${ligaId}/partidos/NOEXISTE`))
    expect(noHay.status).toBe(404)
  })

  it('admitida pero sin datos: la admisión solo enruta; no prueba que exista (404 de lectura, 401 en comandos)', async () => {
    const ligaId = nuevaLiga() // admitida por la configuración de prueba, nunca sembrada
    const { exports } = await import('cloudflare:workers')
    expect((await exports.default.fetch(new Request(`${URL_BASE}/v1/ligas/${ligaId}/partidos/P`))).status).toBe(404)
    const tel = new Telefono(ligaId, 'P', { token: 'token-sin-sembrar-0123456789' })
    const r = await exports.default.fetch(new Request(`${URL_BASE}/v1/ligas/${ligaId}/partidos/P/comandos`, {
      method: 'POST', headers: { authorization: `Bearer ${tel.token}` }, body: JSON.stringify({ gameId: 'P' }),
    }))
    expect([401, 422]).toContain(r.status) // sin credencial válida, nunca un recibo ni un dato
    expect(JSON.stringify(await r.json())).not.toMatch(/"recibo"/) // ni recibo ni datos de la liga
  })
})

describe('5. la siembra no puede saltarse ni la admisión ni sus propias puertas', () => {
  const siembra = (liga, token = SEMILLA_TOKEN) => ['siembra', `/v1/_semilla/ligas/${liga}`, {
    metodo: 'POST', cabeceras: { authorization: `Bearer ${token}` }, cuerpo: JSON.stringify(payloadDeLiga(liga)),
  }]

  it('liga NO admitida con activación y secreto correctos: 404, binding intacto, y la lista no se modifica', async () => {
    const { entorno, accesos } = entornoEspia()
    const antes = entorno.LIGAS_ADMITIDAS
    const [, ruta, op] = siembra('LIGANOADMITIDA')
    const r = await leer(await pedir(entorno, ruta, op))
    expect(r.status).toBe(404)
    expect(JSON.parse(r.texto)).toEqual(NO_ENCONTRADO)
    expect(accesos).toEqual([])
    expect(entorno.LIGAS_ADMITIDAS).toBe(antes) // sembrar no registra nada
    expect((await leer(await pedir(entorno, '/v1/ligas/LIGANOADMITIDA/partidos/P'))).status).toBe(404)
    expect(accesos).toEqual([])
  })

  it('liga admitida pero la siembra desactivada, sin secreto o con secreto corto: 404, sin tocar el binding', async () => {
    for (const extra of [{ PERMITIR_SEMILLA: '0' }, { PERMITIR_SEMILLA: undefined }, { SEMILLA_TOKEN: undefined }, { SEMILLA_TOKEN: 'corto' }]) {
      const { entorno, accesos } = entornoEspia(extra)
      const [, ruta, op] = siembra('LIGAADMITIDA')
      const r = await leer(await pedir(entorno, ruta, op))
      expect(r.status, JSON.stringify(extra)).toBe(404)
      expect(accesos, JSON.stringify(extra)).toEqual([])
    }
  })

  it('liga admitida y siembra activa pero secreto incorrecto: 401, sin tocar el binding', async () => {
    const { entorno, accesos } = entornoEspia()
    const [, ruta, op] = siembra('LIGAADMITIDA', 'otro-secreto-cualquiera-0001')
    expect((await leer(await pedir(entorno, ruta, op))).status).toBe(401)
    expect(accesos).toEqual([])
  })

  it('en el runtime real: una liga admitida se siembra con todas sus puertas; una no admitida no deja ningún objeto', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId)).status).toBe(201)
    const { exports } = await import('cloudflare:workers')
    const noAdmitida = 'LIGAFUERADELALISTA'
    const r = await exports.default.fetch(new Request(`${URL_BASE}/v1/_semilla/ligas/${noAdmitida}`, {
      method: 'POST', headers: { authorization: `Bearer ${SEMILLA_TOKEN}` }, body: JSON.stringify(payloadDeLiga(noAdmitida)),
    }))
    expect(r.status).toBe(404)
    const { listDurableObjectIds } = await import('cloudflare:test')
    const ids = await listDurableObjectIds(env.LIGA)
    const nombres = new Set(await Promise.all(ids.map(async (id) => id.toString())))
    expect(nombres.has(env.LIGA.idFromName(noAdmitida).toString())).toBe(false) // nunca se creó
    expect(nombres.has(env.LIGA.idFromName(ligaId).toString())).toBe(true)
  })
})
