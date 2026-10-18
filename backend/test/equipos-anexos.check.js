import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { LIMITES_CARGA, clavePublicaDeEquipo, hayClavesAmbiguas, validarEquiposAnexos } from '../src/carga.js'
import { claveEquipo } from '../../src/lib/publico/claves.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR, admin, pedir } from './ayuda-acceso.js'
import { dentro, sqlDe } from './ayuda.js'
import { alta, campos, escenarioPlantilla, leerLiga } from './ayuda-plantilla.js'

// Operator "append teams" load: POST /v1/admin/ligas/{liga}/equipos. SYNTHETIC data only, isolated test storage.

const CARGA = (n) => `append-synthetic-${String(n).padStart(4, '0')}-aaaa`
const base = (ligaId, n = 1) => ({
  cargaId: CARGA(n), liga: { id: ligaId, nombre: 'Append test league', deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } },
  equipos: [{ id: `${ligaId}-ALFA`, nombre: 'Alfa' }, { id: `${ligaId}-BETA`, nombre: 'Beta' }],
})
const append = (ligaId, cuerpo) => admin(`/v1/admin/ligas/${ligaId}/equipos`, cuerpo)
const nuevos = (ligaId, n = 50, extra = []) => ({ cargaId: CARGA(n), equipos: [{ id: `${ligaId}-GAMMA`, nombre: 'Gamma' }, { id: `${ligaId}-DELTA`, nombre: 'Delta' }, ...extra] })
async function ligaCargada(n = 1) {
  const ligaId = nuevaLiga()
  expect((await admin(`/v1/admin/ligas/${ligaId}/estructura`, base(ligaId, n))).status).toBe(201)
  return ligaId
}
const TABLAS = ['ligas', 'equipos', 'jugadores', 'partidos', 'eventos', 'recibos', 'resumen_partido', 'cargas', 'operaciones_plantilla']
const volcado = (ligaId, sin = []) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify(TABLAS.filter((t) => !sin.includes(t)).map((t) => sql.exec(`SELECT * FROM ${t}`).toArray()))
})
const publico = (ligaId) => exports.default.fetch(new Request(`${ORIGEN}/v1/ligas/${ligaId}/publico`)).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))
const cab = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }

describe('gate, authorization and league admission (same door as the other operator loads)', () => {
  it('gate closed or short secret: the route does not exist (404) even with a matching token', async () => {
    const ligaId = nuevaLiga()
    for (const entorno of [{ ...env, ACCESO_ADMIN_HABILITADO: '0' }, { ...env, ACCESO_ADMIN_HABILITADO: undefined }, { ...env, ACCESO_ADMIN_TOKEN: 'short' }]) {
      const r = await pedir('POST', `/v1/admin/ligas/${ligaId}/equipos`, { cuerpo: nuevos(ligaId), cabeceras: { authorization: `Bearer ${entorno.ACCESO_ADMIN_TOKEN}`, 'content-type': 'application/json' }, entorno })
      expect(r.status).toBe(404)
    }
  })
  it('a league that is NOT admitted gets 404 without touching the Durable Object binding, for any method, credential or body', async () => {
    const accesos = []
    const LIGA = { idFromName: (n) => { accesos.push(n); return env.LIGA.idFromName(n) }, get: (id) => { accesos.push('get'); return env.LIGA.get(id) } }
    for (const [metodo, cuerpo] of [['POST', nuevos('NOTADMITTED')], ['GET', undefined], ['POST', '{not json']]) {
      for (const c of [cab, {}, { authorization: 'Bearer wrong' }]) {
        expect((await pedir(metodo, '/v1/admin/ligas/NOTADMITTED/equipos', { cuerpo, cabeceras: c, entorno: { ...env, LIGA } })).status).toBe(404)
      }
    }
    expect(accesos).toEqual([])
  })
  it('no Bearer, a wrong Bearer or an organizer SESSION (cookie) is the same 401 and writes nothing', async () => {
    const e = await escenarioPlantilla()
    const antes = await volcado(e.ligaId)
    const sinNada = await pedir('POST', `/v1/admin/ligas/${e.ligaId}/equipos`, { cuerpo: nuevos(e.ligaId), cabeceras: { 'content-type': 'application/json' } })
    const otro = await admin(`/v1/admin/ligas/${e.ligaId}/equipos`, nuevos(e.ligaId), 'not-the-operator-token-0000000000000000')
    const cookie = await pedir('POST', `/v1/admin/ligas/${e.ligaId}/equipos`, { cuerpo: nuevos(e.ligaId), cabeceras: { cookie: `__Host-sesion=${e.cookie}`, origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' } })
    for (const r of [sinNada, otro, cookie]) { expect(r.status).toBe(401); expect(r.cuerpo).toEqual({ error: 'no-autorizado' }) }
    expect(await volcado(e.ligaId)).toBe(antes)
  })
  it('method must be POST (405) and the body is bounded (413); invalid JSON is 400', async () => {
    const ligaId = nuevaLiga()
    expect((await pedir('GET', `/v1/admin/ligas/${ligaId}/equipos`, { cabeceras: cab })).status).toBe(405)
    expect((await append(ligaId, { ...nuevos(ligaId), padding: 'x'.repeat(LIMITES_CARGA.bytesEstructura + 1) })).status).toBe(413)
    expect((await pedir('POST', `/v1/admin/ligas/${ligaId}/equipos`, { cuerpo: '{not json', cabeceras: cab })).status).toBe(400)
  })
})

describe('missing / uninitialized league', () => {
  it('an admitted league with no structure yet: 409 liga-sin-estructura and NOTHING is created (no league, no team, no receipt)', async () => {
    const ligaId = nuevaLiga()
    const r = await append(ligaId, nuevos(ligaId))
    expect(r.status).toBe(409); expect(r.cuerpo).toEqual({ error: 'liga-sin-estructura' })
    for (const t of ['ligas', 'equipos', 'cargas']) expect(await sqlDe(ligaId, `SELECT COUNT(*) AS n FROM ${t}`)).toEqual([{ n: 0 }])
  })
})

describe('valid append and exact replay', () => {
  it('appends to a loaded league: 201, response lists the new teams, the public read shows ALL teams, existing rows untouched', async () => {
    const ligaId = await ligaCargada()
    const antes = await volcado(ligaId, ['equipos', 'cargas'])
    const antesEquipos = await sqlDe(ligaId, 'SELECT id, nombre FROM equipos ORDER BY id')
    const r = await append(ligaId, nuevos(ligaId))
    expect(r.status).toBe(201)
    expect(r.cuerpo).toEqual({ ok: true, cargaId: CARGA(50), tipo: 'equipos', ligaId, agregados: 2, equipos: [{ id: `${ligaId}-DELTA`, nombre: 'Delta' }, { id: `${ligaId}-GAMMA`, nombre: 'Gamma' }], totalEquipos: 4, reproducido: false })
    expect(await volcado(ligaId, ['equipos', 'cargas'])).toBe(antes)
    const despues = await sqlDe(ligaId, 'SELECT id, nombre FROM equipos ORDER BY id')
    expect(despues.filter((q) => antesEquipos.some((a) => a.id === q.id))).toEqual(antesEquipos) // the original teams are intact
    expect(despues).toHaveLength(4)
    const pub = await publico(ligaId)
    expect(pub.status).toBe(200)
    expect(pub.cuerpo.equipos.map((q) => q.id).sort()).toEqual([`${ligaId}-ALFA`, `${ligaId}-BETA`, `${ligaId}-DELTA`, `${ligaId}-GAMMA`])
    expect(pub.cuerpo.liga.nombre).toBe('Append test league')
  })
  it('exact replay (also reordered) returns the original response with reproducido:true and writes nothing, even after the league grew', async () => {
    const ligaId = await ligaCargada()
    const primero = await append(ligaId, nuevos(ligaId))
    expect((await append(ligaId, { cargaId: CARGA(51), equipos: [{ id: `${ligaId}-OMEGA`, nombre: 'Omega' }] })).status).toBe(201) // league grows afterwards
    const antes = await volcado(ligaId)
    const igual = await append(ligaId, nuevos(ligaId))
    const reordenado = await append(ligaId, { ...nuevos(ligaId), equipos: nuevos(ligaId).equipos.reverse() })
    for (const r of [igual, reordenado]) { expect(r.status).toBe(200); expect(r.cuerpo).toEqual({ ...primero.cuerpo, reproducido: true }) }
    expect(await volcado(ligaId)).toBe(antes)
  })
  it('the appended teams accept roster operations through the existing organizer API; the new teams start empty', async () => {
    const e = await escenarioPlantilla()
    const r = await append(e.ligaId, { cargaId: CARGA(60), equipos: [{ id: `${e.ligaId}-NUEVO`, nombre: 'Nuevo Equipo' }] })
    expect(r.status).toBe(201)
    const liga = await leerLiga(e.cookie, e.ligaId)
    expect(liga.status).toBe(200)
    expect(liga.cuerpo.equipos.map((q) => q.id)).toContain(`${e.ligaId}-NUEVO`)
    const a = await alta(e.cookie, e.ligaId, `${e.ligaId}-NUEVO`, { campos: campos({ nombrePila: 'Syn', apellido1: 'Thetic', dorsal: 3 }), resolucionIdentidad: { tipo: 'otra-persona' } })
    expect(a.status).toBe(200)
    expect(await sqlDe(e.ligaId, 'SELECT COUNT(*) AS n FROM jugadores WHERE equipo_id = ?', `${e.ligaId}-NUEVO`)).toEqual([{ n: 1 }])
  })
  it('preserves a populated league: players, people, games, scoring state, receipts and metadata are byte-identical', async () => {
    const e = await escenarioPlantilla()
    const antes = await volcado(e.ligaId, ['equipos', 'cargas'])
    const meta = await sqlDe(e.ligaId, 'SELECT * FROM ligas')
    expect((await append(e.ligaId, { cargaId: CARGA(61), equipos: [{ id: `${e.ligaId}-OTRO`, nombre: 'Otro' }, { id: `${e.ligaId}-MAS`, nombre: 'Mas' }] })).status).toBe(201)
    expect(await volcado(e.ligaId, ['equipos', 'cargas'])).toBe(antes)
    expect(await sqlDe(e.ligaId, 'SELECT * FROM ligas')).toEqual(meta)
    expect(await sqlDe(e.ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 6 }])
  })
})

describe('conflicts: nothing is written', () => {
  it('the same cargaId with different content, or reused from another load type, is carga-conflicto', async () => {
    const ligaId = await ligaCargada(1)
    expect((await append(ligaId, nuevos(ligaId, 70))).status).toBe(201)
    const antes = await volcado(ligaId)
    for (const cambio of [
      { cargaId: CARGA(70), equipos: [{ id: `${ligaId}-GAMMA`, nombre: 'Gamma' }] },
      { cargaId: CARGA(70), equipos: [{ id: `${ligaId}-GAMMA`, nombre: 'Gamma 2' }, { id: `${ligaId}-DELTA`, nombre: 'Delta' }] },
      { cargaId: CARGA(1), equipos: [{ id: `${ligaId}-NEW`, nombre: 'New' }] }, // the id of the INITIAL structure load
    ]) {
      const r = await append(ligaId, cambio)
      expect(r.status).toBe(409); expect(r.cuerpo).toEqual({ error: 'carga-conflicto' })
    }
    expect(await volcado(ligaId)).toBe(antes)
  })
  it('existing id, existing name (case-insensitive; padded names are rejected earlier by validation) or ambiguous public key against what is already stored: 409 each, no writes', async () => {
    const ligaId = await ligaCargada()
    const antes = await volcado(ligaId)
    const casos = [
      [[{ id: `${ligaId}-ALFA`, nombre: 'Different' }], 'equipo-existente'],
      [[{ id: `${ligaId}-NEWTEAM`, nombre: 'aLfA' }], 'nombre-existente'],
      [[{ id: `${ligaId}-alfa`, nombre: 'Lower id' }], 'clave-publica-ambigua'],
      [[{ id: 'ALFA', nombre: 'Short id' }], 'clave-publica-ambigua'], // its key «alfa» equals the key of LIGAX-ALFA
    ]
    let n = 80
    for (const [equipos, error] of casos) {
      const r = await append(ligaId, { cargaId: CARGA(n++), equipos })
      expect(r.status, error).toBe(409); expect(r.cuerpo).toEqual({ error })
    }
    expect(await volcado(ligaId)).toBe(antes)
  })
  it('a mixed batch (valid teams + one colliding team) is rejected whole: no partial inserts and no receipt; the corrected batch then works', async () => {
    const ligaId = await ligaCargada()
    const antes = await volcado(ligaId)
    const r = await append(ligaId, { cargaId: CARGA(90), equipos: [{ id: `${ligaId}-OKONE`, nombre: 'Ok One' }, { id: `${ligaId}-OKTWO`, nombre: 'Ok Two' }, { id: `${ligaId}-BETA`, nombre: 'Collides' }] })
    expect(r.status).toBe(409)
    expect(await volcado(ligaId)).toBe(antes)
    expect((await append(ligaId, { cargaId: CARGA(90), equipos: [{ id: `${ligaId}-OKONE`, nombre: 'Ok One' }, { id: `${ligaId}-OKTWO`, nombre: 'Ok Two' }] })).status).toBe(201)
  })
  it('a failure in the middle of the transaction rolls back every team and the receipt; the same batch can be retried', async () => {
    const ligaId = await ligaCargada()
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec(`CREATE TRIGGER falla BEFORE INSERT ON equipos WHEN NEW.id = '${ligaId}-DELTA' BEGIN SELECT RAISE(ABORT, 'test failure'); END`).toArray() })
    const antes = await volcado(ligaId)
    const r = await append(ligaId, nuevos(ligaId))
    expect(r.status).toBe(503); expect(r.cuerpo).toEqual({ error: 'resultado-desconocido', reintento: 'misma-carga' })
    expect(await volcado(ligaId)).toBe(antes)
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec('DROP TRIGGER falla').toArray() })
    expect((await append(ligaId, nuevos(ligaId))).status).toBe(201)
  })
  it('the league size cap is enforced against existing + new teams', async () => {
    const ligaId = await ligaCargada()
    const muchos = Array.from({ length: LIMITES_CARGA.equipos - 1 }, (_, i) => ({ id: `${ligaId}-T${String(i).padStart(3, '0')}`, nombre: `Team ${i}` }))
    const antes = await volcado(ligaId)
    const r = await append(ligaId, { cargaId: CARGA(95), equipos: muchos })
    expect(r.status).toBe(409); expect(r.cuerpo).toEqual({ error: 'liga-demasiado-grande' })
    expect(await volcado(ligaId)).toBe(antes)
  })
})

describe('validation happens before any write (fixed codes, no echo)', () => {
  it('rejects bad shapes, ids, names, duplicates and ambiguous keys INSIDE the batch with 422', async () => {
    const ligaId = await ligaCargada()
    const antes = await volcado(ligaId)
    const L = ligaId
    const malos = [
      [{ cargaId: 'short', equipos: [{ id: `${L}-A`, nombre: 'A' }] }, 'cargaId'],
      [{ cargaId: CARGA(100), equipos: [] }, 'equipos'],
      [{ cargaId: CARGA(100), equipos: [{ id: 'bad id!', nombre: 'A' }] }, 'equipos.id'],
      [{ cargaId: CARGA(100), equipos: [{ id: `${L}-A`, nombre: ' padded ' }] }, 'equipos.nombre'],
      [{ cargaId: CARGA(100), equipos: [{ id: `${L}-A`, nombre: 'A' }, { id: `${L}-A`, nombre: 'B' }] }, 'equipos.id-duplicado'],
      [{ cargaId: CARGA(100), equipos: [{ id: `${L}-A`, nombre: 'Same' }, { id: `${L}-B`, nombre: 'same' }] }, 'equipos.nombre-duplicado'],
      [{ cargaId: CARGA(100), equipos: [{ id: `${L}-A`, nombre: 'One' }, { id: `${L}-a`, nombre: 'Two' }] }, 'equipos.clave-ambigua'],
      [{ cargaId: CARGA(100), equipos: [{ id: `${L}-A`, nombre: 'One', extra: 1 }] }, 'equipos.forma'],
      [{ cargaId: CARGA(100), equipos: [{ id: `${L}-A`, nombre: 'One' }], liga: { id: L } }, 'payload.campos'],
    ]
    for (const [cuerpo, codigo] of malos) {
      const r = await append(ligaId, cuerpo)
      expect(r.status, codigo).toBe(422)
      expect(r.cuerpo.error).toBe('payload-invalido'); expect(r.cuerpo.errores).toContain(codigo)
      expect(JSON.stringify(r.cuerpo)).not.toContain('padded')
    }
    expect(await volcado(ligaId)).toBe(antes)
  })
  it('pure validator: normalised output is sorted and the public-key rule equals the application rule (claveEquipo)', () => {
    expect(validarEquiposAnexos({ cargaId: CARGA(1), equipos: [{ id: 'L-B', nombre: 'B' }, { id: 'L-A', nombre: 'A' }] }, 'L').normalizado.equipos.map((q) => q.id)).toEqual(['L-A', 'L-B'])
    for (const [liga, id] of [['PLATINIUM-U12', 'PLATINIUM-U12-GRILLOS-VIP'], ['PLATINIUM-U12', 'OTHER'], ['L', 'L-'], ['L', 'L-X-Y'], ['PLATINIUM-U10', 'PLATINIUM-U10-Deportivo']]) {
      expect(clavePublicaDeEquipo(liga, id)).toBe(claveEquipo(liga, id).toLowerCase())
    }
    expect(hayClavesAmbiguas('L', ['L-A', 'L-B', 'L-C'])).toBe(false)
    expect(hayClavesAmbiguas('L', ['L-A', 'a'])).toBe(true)
    expect(hayClavesAmbiguas('L', ['L-A', 'L-B', 'L-b'], 2)).toBe(true) // only pairs involving new ids
    expect(hayClavesAmbiguas('L', ['L-A', 'L-a', 'L-C'], 2)).toBe(false) // pre-existing ambiguity does not block
  })
})

describe('the approved production additions do not collide with the existing production teams (pure check with the public IDs)', () => {
  const U10 = ['CORRECAMINOS', 'CROSS-LEVEL', 'DEPORTIVO', 'VIP', 'GRIZZLIES', 'HARDWORK-BASKETBALL', 'UNITY-BASKETBALL', 'WEST-HORNETS'].map((s) => `PLATINIUM-U10-${s}`)
  const U12 = ['CORRECAMINOS', 'HARDWORK-BASKETBALL', 'HARDWORK-WEST', 'UNITY-BASKETBALL', 'WEST-BOYS', 'WEST-HORNETS'].map((s) => `PLATINIUM-U12-${s}`)
  it('U10 + Grillos VIP and U12 + Deportivo VIP, Grillos VIP, Grizzlies are unambiguous (existing ids first, new ids after)', () => {
    expect(hayClavesAmbiguas('PLATINIUM-U10', [...U10, 'PLATINIUM-U10-GRILLOS-VIP'], U10.length)).toBe(false)
    expect(hayClavesAmbiguas('PLATINIUM-U12', [...U12, 'PLATINIUM-U12-DEPORTIVO-VIP', 'PLATINIUM-U12-GRILLOS-VIP', 'PLATINIUM-U12-GRIZZLIES'], U12.length)).toBe(false)
    expect(clavePublicaDeEquipo('PLATINIUM-U12', 'PLATINIUM-U12-DEPORTIVO-VIP')).toBe('deportivo-vip')
  })
})

describe('compatibility with the initial structure load', () => {
  it('the structure loader keeps its contract: a loaded league still rejects another structure (liga-ya-cargada) and replays the original load exactly, before and after an append', async () => {
    const ligaId = await ligaCargada(1)
    const original = await admin(`/v1/admin/ligas/${ligaId}/estructura`, base(ligaId, 1))
    expect(original.status).toBe(200)
    expect((await append(ligaId, nuevos(ligaId))).status).toBe(201)
    const replay = await admin(`/v1/admin/ligas/${ligaId}/estructura`, base(ligaId, 1))
    expect(replay.status).toBe(200); expect(replay.cuerpo).toEqual(original.cuerpo) // still describes the ORIGINAL team set
    const otra = await admin(`/v1/admin/ligas/${ligaId}/estructura`, base(ligaId, 2))
    expect(otra.status).toBe(409); expect(otra.cuerpo).toEqual({ error: 'liga-ya-cargada' })
  })
  it('games can be loaded for appended teams with the existing games loader', async () => {
    const ligaId = await ligaCargada()
    expect((await append(ligaId, nuevos(ligaId))).status).toBe(201)
    const r = await admin(`/v1/admin/ligas/${ligaId}/partidos`, { cargaId: CARGA(200), minutosPorPeriodo: 8, partidos: [{ id: 'GX', localId: `${ligaId}-GAMMA`, visitaId: `${ligaId}-ALFA` }] })
    expect(r.status).toBe(201)
  })
})
