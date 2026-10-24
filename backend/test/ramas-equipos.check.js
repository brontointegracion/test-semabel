import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { crearEsquema, VERSION_ESQUEMA } from '../src/esquema.js'
import { validarEquiposAnexos, validarEstructura } from '../src/carga.js'
import { RAMAS, validarRamas } from '../src/ramas-equipos.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR, admin, comoOrganizador, enLiga, escenarioDeCodigos, pedir } from './ayuda-acceso.js'
import { T0, ligaSembrada, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'

// REPORT_220 — Rama del EQUIPO (nullable, nunca inferida). Todo sintético, almacenamiento aislado de cada prueba.

afterEach(() => { control.ahoraMs = null })
const ID = (n) => `rama-sintetica-${String(n).padStart(4, '0')}-aaaa`
const RUTA = (l) => `/v1/admin/ligas/${l}/equipos/ramas`
const ramas = (ligaId, lista, n = 1) => admin(RUTA(ligaId), { cargaId: ID(n), ramas: lista })
const sinHora = (c) => JSON.stringify(c, (k, v) => (k === 'servidorAhoraMs' ? undefined : v))
const get = (ruta) => exports.default.fetch(new Request(`${ORIGEN}${ruta}`)).then(async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => null) }))
const estructura = (ligaId, equipos, n = 1) => ({ cargaId: `estructura-rama-${String(n).padStart(4, '0')}-aaaa`, liga: { id: ligaId, nombre: 'Liga Rama', deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }, equipos })
const E3 = () => [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }, { id: 'EQ3', nombre: 'Gama' }]
const ramaDe = async (ligaId) => Object.fromEntries((await sqlDe(ligaId, 'SELECT id, rama FROM equipos ORDER BY id')).map((e) => [e.id, e.rama]))
const TABLAS = ['ligas', 'jugadores', 'partidos', 'eventos', 'recibos', 'auditoria_reloj', 'bandeja', 'cuarentena', 'credenciales', 'codigos_partido', 'resumen_partido', 'operaciones_plantilla']
const volcado = (ligaId) => enLiga(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify([sql.exec('SELECT id, liga_id, nombre FROM equipos ORDER BY id').toArray(), ...TABLAS.map((t) => sql.exec(`SELECT * FROM ${t}`).toArray())])
})
const cargas = (ligaId) => sqlDe(ligaId, 'SELECT carga_id, tipo, huella, resultado_json FROM cargas ORDER BY carga_id')
const auditoria = (ligaId) => sqlDe(ligaId, "SELECT tipo, detalle FROM auditoria_acceso WHERE tipo = 'equipo-rama-asignada' ORDER BY id")
const ligaCargada = async (equipos = E3()) => { const l = nuevaLiga(); expect((await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, equipos))).status).toBe(201); return l }

describe('migración 9: columna nullable, repetible, sin tocar nada', () => {
  it('una base poblada de la versión 8 pasa a 9 con TODOS los equipos en NULL y sin cambiar ningún registro; repetir no falla; sigue puntuando', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const antes = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      sql.exec('ALTER TABLE equipos DROP COLUMN rama').toArray() // una base de la versión 8
      sql.exec("UPDATE meta SET valor = '8' WHERE clave = 'esquema'").toArray()
      expect(sql.exec("SELECT name FROM pragma_table_info('equipos')").toArray().map((c) => c.name)).toEqual(['id', 'liga_id', 'nombre'])
      return JSON.stringify(['equipos', 'jugadores', 'partidos', 'eventos', 'recibos', 'resumen_partido', 'credenciales'].map((t) => sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray()))
    })
    const despues = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      crearEsquema(inst.almacen); crearEsquema(inst.almacen)
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      expect(sql.exec('SELECT COUNT(*) AS n FROM equipos WHERE rama IS NOT NULL').one().n).toBe(0)
      expect(sql.exec("SELECT name FROM pragma_table_info('equipos')").toArray().map((c) => c.name)).toEqual(['id', 'liga_id', 'nombre', 'rama'])
      return JSON.stringify(['equipos', 'jugadores', 'partidos', 'eventos', 'recibos', 'resumen_partido', 'credenciales'].map((t) => sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray()))
    })
    const sinRama = (t) => JSON.parse(t).map((tabla, i) => (i === 0 ? tabla.map(({ rama: _r, ...resto }) => resto) : tabla))
    expect(sinRama(despues)).toEqual(sinRama(antes))
    expect((await P.mandar('detener-reloj', {}, { t: T0 + 3000 })).cuerpo.resultado).toBe('aceptado')
  })
})

describe('cargas con rama opcional (estructura y equipos añadidos)', () => {
  it('los payloads de siempre (sin rama) se normalizan EXACTAMENTE como antes (misma huella): equipos sin la clave rama; el reintento sigue siendo idempotente y los equipos quedan en NULL', async () => {
    const p = estructura('LIGAX', E3())
    expect(validarEstructura(p, 'LIGAX').normalizado.equipos).toEqual([{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }, { id: 'EQ3', nombre: 'Gama' }])
    expect(validarEquiposAnexos({ cargaId: ID(1), equipos: [{ id: 'EQ9', nombre: 'Nueve' }] }, 'LIGAX').normalizado.equipos).toEqual([{ id: 'EQ9', nombre: 'Nueve' }])
    const l = nuevaLiga()
    const a = await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, E3()))
    expect(a.status).toBe(201)
    expect(await ramaDe(l)).toEqual({ EQ1: null, EQ2: null, EQ3: null })
    expect(await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, E3()))).toMatchObject({ status: 200, cuerpo: { reproducido: true } })
    const anexo = await admin(`/v1/admin/ligas/${l}/equipos`, { cargaId: ID(2), equipos: [{ id: 'EQ4', nombre: 'Cuatro' }] })
    expect(anexo.status).toBe(201)
    expect((await ramaDe(l)).EQ4).toBeNull()
  })

  it('rama opcional por equipo en ambas cargas: se guarda tal cual; un valor no válido (null, mayúsculas, otro texto, número, vacío) se rechaza (422) y no carga nada; el reintento con rama es idempotente', async () => {
    const l = nuevaLiga()
    for (const mala of [null, 'Mixta', 'MIXTA', 'mixto', 'otra', '', 7, {}, ['mixta']]) {
      expect((await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, [{ id: 'EQ1', nombre: 'Alfa', rama: mala }]))).status, JSON.stringify(mala)).toBe(422)
    }
    expect(await sqlDe(l, 'SELECT * FROM equipos')).toEqual([])
    const buenas = [{ id: 'EQ1', nombre: 'Alfa', rama: 'mixta' }, { id: 'EQ2', nombre: 'Beta', rama: 'masculino' }, { id: 'EQ3', nombre: 'Gama', rama: 'femenino' }, { id: 'EQ4', nombre: 'Delta' }]
    const r = await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, buenas))
    expect(r.status).toBe(201)
    expect(await ramaDe(l)).toEqual({ EQ1: 'mixta', EQ2: 'masculino', EQ3: 'femenino', EQ4: null })
    expect((await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, buenas))).cuerpo.reproducido).toBe(true)
    expect((await admin(`/v1/admin/ligas/${l}/estructura`, estructura(l, buenas.map((e) => (e.id === 'EQ1' ? { ...e, rama: 'femenino' } : e))))).status).toBe(409) // otro contenido, mismo cargaId
    const an = await admin(`/v1/admin/ligas/${l}/equipos`, { cargaId: ID(7), equipos: [{ id: 'EQ5', nombre: 'Cinco', rama: 'femenino' }] })
    expect(an.status).toBe(201)
    expect((await ramaDe(l)).EQ5).toBe('femenino')
    expect((await admin(`/v1/admin/ligas/${l}/equipos`, { cargaId: ID(8), equipos: [{ id: 'EQ6', nombre: 'Seis', rama: null }] })).status).toBe(422)
    expect(new Set(RAMAS)).toEqual(new Set(['masculino', 'femenino', 'mixta']))
  })
})

describe('fijar la rama de equipos existentes', () => {
  it('fija solo los NULL, en UNA transacción: solo cambia equipos.rama; ids, plantillas, eventos, recibos, acceso y estadísticas intactos; deja recibo y auditoría', async () => {
    const e = await escenarioDeCodigos()
    const antes = await volcado(e.ligaId)
    const cargasAntes = await cargas(e.ligaId)
    const rankingAntes = sinHora((await get(`/v1/ligas/${e.ligaId}/jugadores/publico`)).cuerpo)
    const r = await ramas(e.ligaId, [{ equipoId: 'E1', rama: 'mixta' }, { equipoId: 'E2', rama: 'mixta' }])
    expect(r).toMatchObject({ status: 201, cuerpo: { ok: true, tipo: 'ramas', ligaId: e.ligaId, asignados: ['E1', 'E2'], yaTenian: [], reproducido: false } })
    expect(await ramaDe(e.ligaId)).toEqual({ E1: 'mixta', E2: 'mixta', E3: null, E4: null }) // el resto sigue en NULL: nada se infiere
    expect(await volcado(e.ligaId)).toBe(antes)
    expect((await cargas(e.ligaId)).filter((c) => cargasAntes.some((a) => a.carga_id === c.carga_id))).toEqual(cargasAntes)
    expect((await cargas(e.ligaId)).find((c) => c.carga_id === ID(1)).tipo).toBe('ramas')
    expect(await auditoria(e.ligaId)).toEqual([{ tipo: 'equipo-rama-asignada', detalle: `carga:${ID(1)} equipo:E1 rama:mixta` }, { tipo: 'equipo-rama-asignada', detalle: `carga:${ID(1)} equipo:E2 rama:mixta` }])
    expect(sinHora((await get(`/v1/ligas/${e.ligaId}/jugadores/publico`)).cuerpo)).toBe(rankingAntes)
    expect((await comoOrganizador(e.cookie, 'GET', '/v1/organizador/yo')).cuerpo.ligas).toContain(e.ligaId)
  })

  it('un valor igual se acepta sin cambiarlo (yaTenian, sin auditoría nueva); un valor DISTINTO ya guardado se rechaza (409 rama-en-conflicto) y NADA del lote cambia; corregir un valor no vacío queda fuera de la operación', async () => {
    const l = await ligaCargada()
    expect((await ramas(l, [{ equipoId: 'EQ1', rama: 'mixta' }], 1)).status).toBe(201)
    const antes = await volcado(l); const cargasAntes = await cargas(l); const audAntes = await auditoria(l)
    const igual = await ramas(l, [{ equipoId: 'EQ1', rama: 'mixta' }, { equipoId: 'EQ2', rama: 'mixta' }], 2)
    expect(igual).toMatchObject({ status: 201, cuerpo: { asignados: ['EQ2'], yaTenian: ['EQ1'] } })
    expect((await auditoria(l)).length).toBe(audAntes.length + 1)
    const conflicto = await ramas(l, [{ equipoId: 'EQ3', rama: 'femenino' }, { equipoId: 'EQ1', rama: 'masculino' }], 3)
    expect(conflicto).toMatchObject({ status: 409, cuerpo: { error: 'rama-en-conflicto', equipos: [{ equipoId: 'EQ1', actual: 'mixta' }] } })
    expect(await ramaDe(l)).toEqual({ EQ1: 'mixta', EQ2: 'mixta', EQ3: null }) // EQ3 (nulo y válido) NO se fijó: todo o nada
    expect((await cargas(l)).length).toBe(cargasAntes.length + 1) // solo el recibo de la 2.ª; el rechazo no guarda recibo
    expect((await sqlDe(l, 'SELECT COUNT(*) AS n FROM cargas WHERE carga_id = ?', ID(3)))[0].n).toBe(0)
    void antes
  })

  it('un equipo desconocido (o de otra liga) rechaza TODO el lote con 422 y la lista; nada cambia', async () => {
    const l = await ligaCargada(); const otra = await ligaCargada([{ id: 'ZZ1', nombre: 'Zeta' }])
    const antes = await volcado(l)
    expect(await ramas(l, [{ equipoId: 'EQ1', rama: 'mixta' }, { equipoId: 'NO-EXISTE', rama: 'mixta' }, { equipoId: 'ZZ1', rama: 'mixta' }])).toMatchObject({ status: 422, cuerpo: { error: 'equipos-desconocidos', equipos: ['NO-EXISTE', 'ZZ1'] } })
    expect(await ramaDe(l)).toEqual({ EQ1: null, EQ2: null, EQ3: null })
    expect(await volcado(l)).toBe(antes)
    expect(await ramaDe(otra)).toEqual({ ZZ1: null })
  })

  it('idempotencia: repetir lo mismo devuelve el resultado ORIGINAL sin escrituras; mismo cargaId con otro contenido u otra operación: 409 carga-conflicto', async () => {
    const l = await ligaCargada()
    const primera = await ramas(l, [{ equipoId: 'EQ2', rama: 'masculino' }, { equipoId: 'EQ1', rama: 'masculino' }])
    const tras = { v: await volcado(l), c: await cargas(l), a: await auditoria(l) }
    expect(await ramas(l, [{ equipoId: 'EQ1', rama: 'masculino' }, { equipoId: 'EQ2', rama: 'masculino' }])).toMatchObject({ status: 200, cuerpo: { ...primera.cuerpo, reproducido: true } }) // otro orden = mismo contenido
    expect({ v: await volcado(l), c: await cargas(l), a: await auditoria(l) }).toEqual(tras)
    expect(await ramas(l, [{ equipoId: 'EQ1', rama: 'masculino' }])).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    expect(await admin(`/v1/ligas/${l}/nombre`.replace('/v1/ligas/', '/v1/admin/ligas/'), { cargaId: ID(1), nombre: 'X' })).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    // repetir tras que la rama ya la tengan: no vuelve a "asignar"
    expect(await ramas(l, [{ equipoId: 'EQ1', rama: 'masculino' }, { equipoId: 'EQ2', rama: 'masculino' }], 2)).toMatchObject({ status: 201, cuerpo: { asignados: [], yaTenian: ['EQ1', 'EQ2'] } })
  })

  it('respuesta perdida DESPUÉS de aplicar: 503 resultado-desconocido y repetir el MISMO comando devuelve el original sin cambiar nada; ANTES: aplica una sola vez', async () => {
    const l = await ligaCargada(); const l2 = await ligaCargada()
    const perder = (despues) => ({ idFromName: (n) => env.LIGA.idFromName(n), get: (id) => { const stub = env.LIGA.get(id); return { fijarRamasOperador: async (a) => { if (despues) await stub.fijarRamasOperador(a); throw new Error('conexion-perdida') } } } })
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    const cuerpo = { cargaId: ID(1), ramas: [{ equipoId: 'EQ1', rama: 'mixta' }] }
    expect(await pedir('POST', RUTA(l), { cuerpo, cabeceras, entorno: { ...env, LIGA: perder(true) } })).toMatchObject({ status: 503, cuerpo: { error: 'resultado-desconocido', reintento: 'misma-carga' } })
    expect((await ramaDe(l)).EQ1).toBe('mixta')
    const tras = { c: await cargas(l), a: await auditoria(l) }
    expect(await admin(RUTA(l), cuerpo)).toMatchObject({ status: 200, cuerpo: { reproducido: true, asignados: ['EQ1'] } })
    expect({ c: await cargas(l), a: await auditoria(l) }).toEqual(tras)
    expect((await pedir('POST', RUTA(l2), { cuerpo, cabeceras, entorno: { ...env, LIGA: perder(false) } })).status).toBe(503)
    expect((await ramaDe(l2)).EQ1).toBeNull()
    expect(await admin(RUTA(l2), cuerpo)).toMatchObject({ status: 201, cuerpo: { reproducido: false } })
    expect(await auditoria(l2)).toHaveLength(1)
  })

  it('puerta del operador: cerrada por defecto, liga no admitida 404 sin tocar objetos, sin Bearer / otro Bearer / sesión de organizador 401, otro método 405, liga sin estructura 422 (equipos desconocidos); nada cambia', async () => {
    const e = await escenarioDeCodigos()
    const cuerpo = { cargaId: ID(1), ramas: [{ equipoId: 'E1', rama: 'mixta' }] }
    for (const entorno of [{ ...env, ACCESO_ADMIN_HABILITADO: '0' }, { ...env, ACCESO_ADMIN_TOKEN: 'corto' }]) {
      expect((await pedir('POST', RUTA(e.ligaId), { cuerpo, cabeceras: { authorization: `Bearer ${entorno.ACCESO_ADMIN_TOKEN}`, 'content-type': 'application/json' }, entorno })).status).toBe(404)
    }
    expect((await pedir('POST', RUTA(e.ligaId), { cuerpo, cabeceras: { 'content-type': 'application/json' } })).status).toBe(401)
    expect((await admin(RUTA(e.ligaId), cuerpo, 'operador-que-no-es-0000000000000000000')).status).toBe(401)
    expect((await pedir('POST', RUTA(e.ligaId), { cuerpo, cabeceras: { cookie: `__Host-sesion=${e.cookie}`, origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' } })).status).toBe(401)
    expect((await pedir('GET', RUTA(e.ligaId))).status).toBe(405)
    const accesos = []
    const LIGA = { idFromName: (n) => { accesos.push(n); return env.LIGA.idFromName(n) }, get: (id) => { accesos.push('get'); return env.LIGA.get(id) } }
    expect((await pedir('POST', RUTA('NOADMITIDA'), { cuerpo, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }, entorno: { ...env, LIGA } })).status).toBe(404)
    expect(accesos).toEqual([])
    expect(await ramaDe(e.ligaId)).toEqual({ E1: null, E2: null, E3: null, E4: null })
    expect((await ramas(nuevaLiga(), [{ equipoId: 'E1', rama: 'mixta' }])).status).toBe(422)
  })

  it('el cuerpo es EXACTO: campos extra, ids repetidos, rama no válida (mayúsculas, null, otro texto), lista vacía o de más de 100, cargaId corto, JSON ilegible o demasiado grande → 4xx y nada cambia', async () => {
    const l = await ligaCargada()
    const c = ID(1)
    const malos = [{ cargaId: c, ramas: [{ equipoId: 'EQ1', rama: 'mixta' }], extra: 1 }, { cargaId: c, ramas: [{ equipoId: 'EQ1', rama: 'mixta' }, { equipoId: 'EQ1', rama: 'mixta' }] }, { cargaId: c, ramas: [{ equipoId: 'EQ1', rama: 'Mixta' }] },
      { cargaId: c, ramas: [{ equipoId: 'EQ1', rama: null }] }, { cargaId: c, ramas: [{ equipoId: 'EQ1', rama: 'otra' }] }, { cargaId: c, ramas: [{ equipoId: 'EQ1' }] }, { cargaId: c, ramas: [{ equipoId: 'EQ 1', rama: 'mixta' }] },
      { cargaId: c, ramas: [{ equipoId: 'EQ1', rama: 'mixta', x: 1 }] }, { cargaId: c, ramas: [] }, { cargaId: c, ramas: Array.from({ length: 101 }, (_, i) => ({ equipoId: `T${i}`, rama: 'mixta' })) },
      { cargaId: 'corto', ramas: [{ equipoId: 'EQ1', rama: 'mixta' }] }, { ramas: [{ equipoId: 'EQ1', rama: 'mixta' }] }, { cargaId: c }, [], null]
    for (const cuerpo of malos) expect((await admin(RUTA(l), cuerpo)).status, JSON.stringify(cuerpo).slice(0, 70)).toBe(422)
    expect((await admin(RUTA(l), '{no es json')).status).toBe(400)
    expect([400, 413]).toContain((await admin(RUTA(l), JSON.stringify({ cargaId: c, ramas: [{ equipoId: 'EQ1', rama: 'mixta' }], x: 'a'.repeat(17_000) }))).status)
    expect(await ramaDe(l)).toEqual({ EQ1: null, EQ2: null, EQ3: null })
    expect(validarRamas({ cargaId: c, ramas: [{ equipoId: 'b', rama: 'femenino' }, { equipoId: 'a', rama: 'mixta' }] })).toEqual({ ok: true, normalizado: { cargaId: c, ramas: [{ equipoId: 'a', rama: 'mixta' }, { equipoId: 'b', rama: 'femenino' }] } })
  })
})

describe('lecturas: rama nullable en las proyecciones de equipo; sin cambio de clasificación ni de estadísticas', () => {
  it('lectura pública de la liga y página pública del equipo: rama o null; el organizador la ve en su lectura de plantilla; la categoría de la liga no cambia; sin fijar → null (nada inventado)', async () => {
    const e = await escenarioDeCodigos()
    const ligaAntes = (await get(`/v1/ligas/${e.ligaId}/publico`)).cuerpo.liga
    expect((await get(`/v1/ligas/${e.ligaId}/publico`)).cuerpo.equipos.every((q) => q.rama === null)).toBe(true)
    expect((await get(`/v1/ligas/${e.ligaId}/equipos/E1/publico`)).cuerpo.equipo).toEqual({ id: 'E1', nombre: 'Alfa', rama: null })
    await ramas(e.ligaId, [{ equipoId: 'E1', rama: 'masculino' }, { equipoId: 'E2', rama: 'femenino' }, { equipoId: 'E3', rama: 'mixta' }])
    const liga = (await get(`/v1/ligas/${e.ligaId}/publico`)).cuerpo
    expect(Object.fromEntries(liga.equipos.map((q) => [q.id, q.rama]))).toEqual({ E1: 'masculino', E2: 'femenino', E3: 'mixta', E4: null })
    expect(liga.liga).toEqual(ligaAntes) // la clasificación de la liga (categoría/subcategoría) no cambia
    expect((await get(`/v1/ligas/${e.ligaId}/equipos/E2/publico`)).cuerpo.equipo).toEqual({ id: 'E2', nombre: 'Beta', rama: 'femenino' })
    expect((await get(`/v1/ligas/${e.ligaId}/equipos/E4/publico`)).cuerpo.equipo.rama).toBeNull()
    const org = await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${e.ligaId}/equipos/E1/jugadores`)
    expect(org.status).toBe(200)
    expect(org.cuerpo.equipo).toEqual({ id: 'E1', nombre: 'Alfa', rama: 'masculino' })
    expect((await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${e.ligaId}/equipos/E4/jugadores`)).cuerpo.equipo.rama).toBeNull()
  })

  it('la puntuación y las estadísticas no cambian al fijar ramas: ranking, marcador, eventos y recibos idénticos y el partido sigue puntuando', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const antes = { r: sinHora((await get(`/v1/ligas/${ligaId}/jugadores/publico`)).cuerpo), p: JSON.stringify((await get(`/v1/ligas/${ligaId}/partidos/P`)).cuerpo.local), v: await volcado(ligaId) }
    expect((await ramas(ligaId, [{ equipoId: 'E1', rama: 'mixta' }, { equipoId: 'E2', rama: 'mixta' }])).status).toBe(201)
    expect({ r: sinHora((await get(`/v1/ligas/${ligaId}/jugadores/publico`)).cuerpo), p: JSON.stringify((await get(`/v1/ligas/${ligaId}/partidos/P`)).cuerpo.local), v: await volcado(ligaId) }).toEqual(antes)
    expect((await P.mandar('detener-reloj', {}, { t: T0 + 3000 })).cuerpo.resultado).toBe('aceptado')
  })
})
