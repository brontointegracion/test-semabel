import { describe, expect, it } from 'vitest'
import { exports } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { env } from 'cloudflare:workers'
import { SEMILLA_TOKEN, nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { json, leerPartido, ligaSembrada, sembrar } from './ayuda.js'

describe('siembra sintética', () => {
  it('está desactivada por defecto o sin secreto: la ruta no existe', async () => {
    const ligaId = nuevaLiga()
    const req = () => new Request(`https://x/v1/_semilla/ligas/${ligaId}`, {
      method: 'POST', headers: { authorization: `Bearer ${SEMILLA_TOKEN}` }, body: JSON.stringify(payloadDeLiga(ligaId)),
    })
    expect((await worker.fetch(req(), { ...env, PERMITIR_SEMILLA: '0' })).status).toBe(404)
    expect((await worker.fetch(req(), { ...env, PERMITIR_SEMILLA: undefined })).status).toBe(404)
    expect((await worker.fetch(req(), { ...env, SEMILLA_TOKEN: undefined })).status).toBe(404)
    expect((await worker.fetch(req(), { ...env, SEMILLA_TOKEN: 'corto' })).status).toBe(404)
    expect((await leerPartido(ligaId, 'P')).status).toBe(404) // nada se sembró
  })

  it('exige el secreto de administración y rechaza payloads inválidos', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId, payloadDeLiga(ligaId), 'otro-secreto-cualquiera')).status).toBe(401)
    const malo = payloadDeLiga(ligaId)
    malo.jugadores[0].dorsal = 100
    const r = await sembrar(ligaId, malo)
    expect(r.status).toBe(422)
    expect((await json(r)).errores).toContain('jugadores.dorsal')
    const dosActivas = payloadDeLiga(ligaId)
    dosActivas.credenciales.push({ token: 'otro-token-sintetico-0001', partidoId: 'P', deviceId: 'tel-X' })
    expect((await sembrar(ligaId, dosActivas)).status).toBe(422)
    expect((await leerPartido(ligaId, 'P')).status).toBe(404) // un intento fallido no deja nada
  })

  it('no sobrescribe: sembrar dos veces la misma liga se rechaza', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId)).status).toBe(201)
    const otra = payloadDeLiga(ligaId)
    otra.liga.nombre = 'Intento de sobrescribir'
    expect((await sembrar(ligaId, otra)).status).toBe(409)
    expect((await json(await leerPartido(ligaId, 'P'))).liga.nombre).toBe(`Liga sintética ${ligaId}`)
  })

  it('el id de la dirección debe coincidir con el de la liga del payload', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId, payloadDeLiga('OTRA'))).status).toBe(422)
  })
})

describe('lectura pública', () => {
  it('antes de empezar: programado, 0 a 0, sin reloj', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    const r = await leerPartido(ligaId, 'P')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const c = await json(r)
    expect(c).toMatchObject({
      gameId: 'P', rev: 0, estado: 'programado', periodo: 1,
      local: { id: 'E1', nombre: 'Alfa', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta', puntos: 0, faltas: 0 },
      reloj: { estado: null, restanteMs: null, desdeMs: null },
    })
    expect(typeof c.servidorAhoraMs).toBe('number')
  })

  it('partido o liga desconocidos → 404 sin detalle; método no permitido → 405', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    expect((await leerPartido(ligaId, 'NOEXISTE')).status).toBe(404)
    expect((await leerPartido('LIGA-QUE-NO-EXISTE', 'P')).status).toBe(404)
    const r = await exports.default.fetch(new Request(`https://x/v1/ligas/${ligaId}/partidos/P`, { method: 'POST', body: '{}' }))
    expect(r.status).toBe(405)
    expect((await exports.default.fetch(new Request('https://x/otra/ruta'))).status).toBe(404)
  })
})
