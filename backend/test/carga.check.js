import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { crearEsquema } from '../src/esquema.js'
import { LIMITES_CARGA, validarEstructura, validarPartidos } from '../src/carga.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR, admin, enLiga, iniciarSesion, pedir, provisionar, reiniciarAcceso, T0 } from './ayuda-acceso.js'
import { dentro, sembrar, sqlDe } from './ayuda.js'
import { escenarioPlantilla } from './ayuda-plantilla.js'

// Pruebas de la carga del OPERADOR (estructura + partidos). Todo sintético; almacenamiento aislado de la prueba.

const CARGA = (n) => `carga-sintetica-${String(n).padStart(4, '0')}-aaaa`
const equipos = () => [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }, { id: 'EQ3', nombre: 'Gama' }]
const estructura = (ligaId, extra = {}, n = 1) => ({
  cargaId: CARGA(n),
  liga: { id: ligaId, nombre: 'Liga de prueba', deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, ...extra.liga },
  equipos: extra.equipos ?? equipos(),
})
const lote = (extra = {}, n = 2) => ({
  cargaId: CARGA(n), minutosPorPeriodo: 8,
  partidos: [
    { id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T09:00:00-05:00', sede: 'Cancha 1' },
    { id: 'G2', localId: 'EQ2', visitaId: 'EQ3' },
  ],
  ...extra,
})
const cargarEstructura = (ligaId, cuerpo) => admin(`/v1/admin/ligas/${ligaId}/estructura`, cuerpo)
const cargarPartidos = (ligaId, cuerpo) => admin(`/v1/admin/ligas/${ligaId}/partidos`, cuerpo)
const volcado = (ligaId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify(['ligas', 'equipos', 'jugadores', 'partidos', 'eventos', 'recibos', 'resumen_partido', 'cargas', 'operaciones_plantilla']
    .map((t) => sql.exec(`SELECT * FROM ${t}`).toArray()))
})
const nCargas = async (ligaId) => (await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM cargas'))[0].n
const publico = (ligaId) => exports.default.fetch(new Request(`${ORIGEN}/v1/ligas/${ligaId}/publico`)).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))

describe('puerta de la carga: cerrada por defecto, admisión antes del enrutamiento, solo el operador', () => {
  it('sin la bandera del operador, o sin secreto largo, la ruta no existe (404) aunque el token coincida', async () => {
    const ligaId = nuevaLiga()
    for (const entorno of [{ ...env, ACCESO_ADMIN_HABILITADO: '0' }, { ...env, ACCESO_ADMIN_HABILITADO: undefined }, { ...env, ACCESO_ADMIN_TOKEN: 'corto' }]) {
      const r = await pedir('POST', `/v1/admin/ligas/${ligaId}/estructura`, {
        cuerpo: estructura(ligaId), cabeceras: { authorization: `Bearer ${entorno.ACCESO_ADMIN_TOKEN}`, 'content-type': 'application/json' }, entorno,
      })
      expect(r.status).toBe(404)
    }
    expect(await nCargas(ligaId)).toBe(0)
  })

  it('una liga NO admitida recibe 404 sin tocar el binding de Durable Objects, con cualquier credencial, método o cuerpo', async () => {
    const accesos = []
    const LIGA = { idFromName: (n) => { accesos.push(n); return env.LIGA.idFromName(n) }, get: (id) => { accesos.push('get'); return env.LIGA.get(id) } }
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    for (const [metodo, ruta, cuerpo] of [
      ['POST', '/v1/admin/ligas/NOADMITIDA/estructura', estructura('NOADMITIDA')],
      ['POST', '/v1/admin/ligas/NOADMITIDA/partidos', lote()],
      ['GET', '/v1/admin/ligas/NOADMITIDA/partidos', undefined],
      ['POST', '/v1/admin/ligas/NOADMITIDA/estructura', '{no es json'],
    ]) {
      for (const c of [cabeceras, {}, { authorization: 'Bearer incorrecto' }]) {
        const r = await pedir(metodo, ruta, { cuerpo, cabeceras: c, entorno: { ...env, LIGA } })
        expect(r.status).toBe(404)
      }
    }
    // Con la lista de ligas vacía (cerrada) tampoco se admite nada.
    const vacia = await pedir('POST', `/v1/admin/ligas/${nuevaLiga()}/estructura`, { cuerpo: {}, cabeceras, entorno: { ...env, LIGAS_ADMITIDAS: '', LIGA } })
    expect(vacia.status).toBe(404)
    expect(accesos).toEqual([])
  })

  it('sin Bearer, con otro Bearer o con una SESIÓN de organizador (cookie) no se autoriza: 401 idéntico y sin escrituras', async () => {
    const e = await escenarioPlantilla()
    const ligaId = nuevaLiga()
    const sinNada = await pedir('POST', `/v1/admin/ligas/${ligaId}/estructura`, { cuerpo: estructura(ligaId), cabeceras: { 'content-type': 'application/json' } })
    const otro = await admin(`/v1/admin/ligas/${ligaId}/estructura`, estructura(ligaId), 'operador-que-no-es-0000000000000000000')
    const conCookie = await pedir('POST', `/v1/admin/ligas/${ligaId}/estructura`, {
      cuerpo: estructura(ligaId), cabeceras: { cookie: `__Host-sesion=${e.cookie}`, origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' },
    })
    // El código del organizador tampoco sirve como Bearer.
    const codigoComoBearer = await admin(`/v1/admin/ligas/${ligaId}/estructura`, estructura(ligaId), e.codigo.replaceAll('-', ''))
    for (const r of [sinNada, otro, conCookie, codigoComoBearer]) {
      expect(r.status).toBe(401)
      expect(r.cuerpo).toEqual({ error: 'no-autorizado' })
    }
    // Tampoco se puede cargar dentro de una liga de ese organizador con su sesión.
    const propia = await pedir('POST', `/v1/admin/ligas/${e.ligaId}/partidos`, {
      cuerpo: lote(), cabeceras: { cookie: `__Host-sesion=${e.cookie}`, origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' },
    })
    expect(propia.status).toBe(401)
    expect(await nCargas(ligaId)).toBe(0)
  })

  it('el método debe ser POST (405) y el cuerpo está acotado por bytes (413)', async () => {
    const ligaId = nuevaLiga()
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    expect((await pedir('GET', `/v1/admin/ligas/${ligaId}/estructura`, { cabeceras })).status).toBe(405)
    const grande = { ...estructura(ligaId), relleno: 'x'.repeat(LIMITES_CARGA.bytesEstructura + 1) }
    expect((await cargarEstructura(ligaId, grande)).status).toBe(413)
    expect((await cargarPartidos(ligaId, { ...lote(), relleno: 'x'.repeat(LIMITES_CARGA.bytesPartidos + 1) })).status).toBe(413)
    expect((await pedir('POST', `/v1/admin/ligas/${ligaId}/estructura`, { cuerpo: '{no es json', cabeceras })).status).toBe(400)
    expect(await nCargas(ligaId)).toBe(0)
  })
})

describe('validación: todo antes de cualquier escritura, con códigos fijos', () => {
  const malos = [
    ['campo desconocido en la raíz', (l) => ({ ...estructura(l), extra: 1 })],
    ['campo desconocido en la liga', (l) => estructura(l, { liga: { precio: 5 } })],
    ['campo desconocido en un equipo', (l) => estructura(l, { equipos: [{ id: 'EQ1', nombre: 'A', dorsal: 1 }, { id: 'EQ2', nombre: 'B' }] })],
    ['jugadores en la estructura', (l) => ({ ...estructura(l), jugadores: [] })],
    ['credenciales en la estructura', (l) => ({ ...estructura(l), credenciales: [] })],
    ['cargaId ausente o corto', (l) => ({ ...estructura(l), cargaId: 'corto' })],
    ['id de liga distinto del de la dirección', (l) => estructura(l, { liga: { id: 'OTRA' } })],
    ['id de equipo duplicado', (l) => estructura(l, { equipos: [{ id: 'EQ1', nombre: 'A' }, { id: 'EQ1', nombre: 'B' }] })],
    ['nombre de equipo duplicado (sin distinguir mayúsculas)', (l) => estructura(l, { equipos: [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'aLFA' }] })],
    ['id de equipo con caracteres no permitidos', (l) => estructura(l, { equipos: [{ id: 'EQ 1', nombre: 'A' }] })],
    ['nombre con caracteres de control', (l) => estructura(l, { equipos: [{ id: 'EQ1', nombre: 'A\u0000' }] })],
    ['nombre con espacios en los extremos', (l) => estructura(l, { equipos: [{ id: 'EQ1', nombre: ' A' }] })],
    ['sin equipos', (l) => estructura(l, { equipos: [] })],
    ['demasiados equipos', (l) => estructura(l, { equipos: Array.from({ length: LIMITES_CARGA.equipos + 1 }, (_, i) => ({ id: `T${i}`, nombre: `N${i}` })) })],
    ['deporte desconocido', (l) => estructura(l, { liga: { deporte: 'curling' } })],
    ['clasificación que no existe', (l) => estructura(l, { liga: { categoria: 'inventada' } })],
    ['subcategoría que no corresponde a la categoría', (l) => estructura(l, { liga: { subcategoria: { clave: 'u12' } } })],
    ['duración del periodo no válida', (l) => estructura(l, { liga: { minutosPorPeriodo: 0 } })],
    ['duración del periodo en texto', (l) => estructura(l, { liga: { minutosPorPeriodo: '8' } })],
  ]
  for (const [nombre, armar] of malos) {
    it(`rechaza (422) y no escribe nada: ${nombre}`, async () => {
      const ligaId = nuevaLiga()
      const r = await cargarEstructura(ligaId, armar(ligaId))
      expect(r.status).toBe(422)
      expect(r.cuerpo.error).toBe('payload-invalido')
      expect(Array.isArray(r.cuerpo.errores)).toBe(true)
      expect(JSON.stringify(r.cuerpo)).not.toContain('curling') // sin eco del contenido
      expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM ligas')).toEqual([{ n: 0 }])
      expect(await nCargas(ligaId)).toBe(0)
    })
  }

  const partidosMalos = [
    ['sin duración del periodo (no hay valor por omisión)', () => { const l = lote(); delete l.minutosPorPeriodo; return l }],
    ['duración nula', () => lote({ minutosPorPeriodo: null })],
    ['duración 0, negativa, decimal o enorme', () => lote({ minutosPorPeriodo: 8.5 })],
    ['campo desconocido en el partido', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', arbitro: 'x' }] })],
    ['mismo equipo contra sí mismo', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ1' }] })],
    ['id de partido duplicado en el lote', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2' }, { id: 'G1', localId: 'EQ2', visitaId: 'EQ3' }] })],
    ['instante sin zona horaria', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T09:00:00' }] })],
    ['instante en milisegundos (número)', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: 1_792_000_000_000 }] })],
    ['día inexistente (30 de febrero)', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-02-30T10:00:00Z' }] })],
    ['hora 25', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T25:00:00Z' }] })],
    ['sede vacía o con control', () => lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', sede: '' }] })],
    ['lote vacío', () => lote({ partidos: [] })],
    ['lote demasiado grande', () => lote({ partidos: Array.from({ length: LIMITES_CARGA.partidosPorLote + 1 }, (_, i) => ({ id: `G${i}`, localId: 'EQ1', visitaId: 'EQ2' })) })],
  ]
  for (const [nombre, armar] of partidosMalos) {
    it(`partidos: rechaza (422) y no escribe nada: ${nombre}`, async () => {
      const ligaId = nuevaLiga()
      expect((await cargarEstructura(ligaId, estructura(ligaId))).status).toBe(201)
      const antes = await volcado(ligaId)
      const r = await cargarPartidos(ligaId, armar())
      expect(r.status).toBe(422)
      expect(await volcado(ligaId)).toBe(antes)
    })
  }

  it('las funciones de validación son puras y no devuelven eco del contenido', () => {
    const r = validarEstructura({ cargaId: 'x', liga: { id: 'SECRETO', nombre: 5 } }, 'L')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('SECRETO')
    expect(validarPartidos({ cargaId: CARGA(1), minutosPorPeriodo: 8, partidos: [{ id: 'G', localId: 'A', visitaId: 'B', programadoPara: '2026-10-18T09:00Z' }] }).ok).toBe(true)
  })
})

describe('estructura: liga y equipos, atómica, sin partidos ni duración', () => {
  it('carga la estructura SIN partidos ni duración de periodo y la liga se lee en público', async () => {
    const ligaId = nuevaLiga()
    const r = await cargarEstructura(ligaId, estructura(ligaId))
    expect(r.status).toBe(201)
    expect(r.cuerpo).toEqual({ ok: true, cargaId: CARGA(1), tipo: 'estructura', ligaId, equipos: 3, reproducido: false })
    const fila = (await sqlDe(ligaId, 'SELECT minutos_por_periodo, categoria, subcategoria_json FROM ligas'))[0]
    expect(fila).toEqual({ minutos_por_periodo: null, categoria: 'mini-basketball', subcategoria_json: '{"clave":"u10"}' })
    const p = await publico(ligaId)
    expect(p.status).toBe(200)
    expect(p.cuerpo.liga).toMatchObject({ id: ligaId, nombre: 'Liga de prueba', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } })
    expect(p.cuerpo.equipos.map((q) => q.id)).toEqual(['EQ1', 'EQ2', 'EQ3'])
    expect(p.cuerpo.partidos).toEqual([])
    // No crea jugadores, credenciales, organizadores ni recibos de plantilla.
    for (const t of ['jugadores', 'credenciales', 'operaciones_plantilla', 'partidos']) expect(await sqlDe(ligaId, `SELECT COUNT(*) AS n FROM ${t}`)).toEqual([{ n: 0 }])
  })

  it('una duración declarada en la liga se conserva', async () => {
    const ligaId = nuevaLiga()
    expect((await cargarEstructura(ligaId, estructura(ligaId, { liga: { minutosPorPeriodo: 8 } }))).status).toBe(201)
    expect((await sqlDe(ligaId, 'SELECT minutos_por_periodo AS m FROM ligas'))[0].m).toBe(8)
  })

  it('un fallo a mitad de la transacción lo deshace TODO (liga, equipos y recibo)', async () => {
    const ligaId = nuevaLiga()
    // Obliga al segundo equipo a fallar al insertarse, dentro de la misma transacción.
    await dentro(ligaId, (inst) => {
      inst.almacen.sql.exec("CREATE TRIGGER falla_equipo BEFORE INSERT ON equipos WHEN NEW.id = 'EQ2' BEGIN SELECT RAISE(ABORT, 'falla de prueba'); END").toArray()
    })
    const r = await cargarEstructura(ligaId, estructura(ligaId))
    expect(r.status).toBe(503)
    expect(r.cuerpo).toEqual({ error: 'resultado-desconocido', reintento: 'misma-carga' })
    for (const t of ['ligas', 'equipos', 'cargas']) expect(await sqlDe(ligaId, `SELECT COUNT(*) AS n FROM ${t}`)).toEqual([{ n: 0 }])
    // Reparada la causa, la MISMA carga se completa.
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec('DROP TRIGGER falla_equipo').toArray() })
    expect((await cargarEstructura(ligaId, estructura(ligaId))).status).toBe(201)
  })

  it('reintento exacto: éxito sin escrituras (también con otro orden y con el mismo contenido normalizado)', async () => {
    const ligaId = nuevaLiga()
    const primero = await cargarEstructura(ligaId, estructura(ligaId))
    const antes = await volcado(ligaId)
    const igual = await cargarEstructura(ligaId, estructura(ligaId))
    const reordenado = await cargarEstructura(ligaId, estructura(ligaId, { equipos: equipos().reverse() }))
    for (const r of [igual, reordenado]) {
      expect(r.status).toBe(200)
      expect(r.cuerpo).toEqual({ ...primero.cuerpo, reproducido: true })
    }
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('mismo cargaId con contenido distinto: conflicto y ninguna escritura', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    const antes = await volcado(ligaId)
    for (const cambio of [
      estructura(ligaId, { equipos: [...equipos(), { id: 'EQ4', nombre: 'Delta' }] }),
      estructura(ligaId, { liga: { nombre: 'Otro nombre' } }),
      estructura(ligaId, { equipos: [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }, { id: 'EQ3', nombre: 'Gamma' }] }),
    ]) {
      const r = await cargarEstructura(ligaId, cambio)
      expect(r.status).toBe(409)
      expect(r.cuerpo).toEqual({ error: 'carga-conflicto' })
    }
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('otro cargaId sobre una liga ya cargada (o sembrada): conflicto, nunca sobrescribe ni amplía', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    const antes = await volcado(ligaId)
    const r = await cargarEstructura(ligaId, estructura(ligaId, {}, 9))
    expect(r.status).toBe(409)
    expect(r.cuerpo).toEqual({ error: 'liga-ya-cargada' })
    expect(await volcado(ligaId)).toBe(antes)

    const sembrada = nuevaLiga()
    expect((await sembrar(sembrada)).status).toBe(201)
    const antesSembrada = await volcado(sembrada)
    expect((await cargarEstructura(sembrada, estructura(sembrada))).status).toBe(409)
    expect(await volcado(sembrada)).toBe(antesSembrada)
  })

  it('el mismo cargaId no sirve para otro tipo de carga', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    const r = await cargarPartidos(ligaId, lote({ cargaId: CARGA(1) }))
    expect(r.status).toBe(409)
    expect(r.cuerpo).toEqual({ error: 'carga-conflicto' })
  })
})

describe('partidos: lotes que solo añaden', () => {
  it('sin estructura previa no se crea nada (409)', async () => {
    const ligaId = nuevaLiga()
    const r = await cargarPartidos(ligaId, lote())
    expect(r.status).toBe(409)
    expect(r.cuerpo).toEqual({ error: 'liga-sin-estructura' })
    expect(await nCargas(ligaId)).toBe(0)
  })

  it('crea partidos con el estado canónico, duración explícita copiada, instante en UTC y sede por partido; el resumen es 0-0', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    const r = await cargarPartidos(ligaId, lote())
    expect(r.status).toBe(201)
    expect(r.cuerpo.partidos).toEqual([
      { id: 'G1', estado: 'programado', programadoPara: '2026-10-18T14:00:00.000Z', sede: 'Cancha 1' },
      { id: 'G2', estado: 'programado', programadoPara: null, sede: null },
    ])
    const estado = JSON.parse((await sqlDe(ligaId, "SELECT estado_json FROM partidos WHERE id = 'G1'"))[0].estado_json)
    expect(estado.config).toEqual({ deporte: 'baloncesto', minutosPorPeriodo: 8 })
    expect(estado.partido.estado).toBe('programado')
    expect(estado.partido.inicio).toBeNull() // la hora programada NO se guarda como inicio real
    expect(await sqlDe(ligaId, 'SELECT partido_id, local_puntos, visita_puntos, local_faltas, visita_faltas, periodo, rev_fuente FROM resumen_partido ORDER BY partido_id')).toEqual([
      { partido_id: 'G1', local_puntos: 0, visita_puntos: 0, local_faltas: 0, visita_faltas: 0, periodo: 1, rev_fuente: 0 },
      { partido_id: 'G2', local_puntos: 0, visita_puntos: 0, local_faltas: 0, visita_faltas: 0, periodo: 1, rev_fuente: 0 },
    ])
    // Lectura pública: partidos válidos (sin 503), programados, con su hora y sede, y sin credenciales ni eventos.
    const p = await publico(ligaId)
    expect(p.status).toBe(200)
    expect(p.cuerpo.partidos.map((g) => [g.gameId, g.estado, g.programadoPara, g.sede, g.periodo, g.local.puntos, g.visita.puntos])).toEqual([
      ['G1', 'programado', '2026-10-18T14:00:00.000Z', 'Cancha 1', 1, 0, 0],
      ['G2', 'programado', null, null, 1, 0, 0],
    ])
    for (const t of ['eventos', 'recibos', 'credenciales', 'jugadores', 'bandeja']) expect(await sqlDe(ligaId, `SELECT COUNT(*) AS n FROM ${t}`)).toEqual([{ n: 0 }])
    const uno = await exports.default.fetch(new Request(`${ORIGEN}/v1/ligas/${ligaId}/partidos/G1`))
    expect(uno.status).toBe(200)
  })

  it('equivalentes en otra zona horaria producen el mismo instante UTC y la misma huella (reintento sin escrituras)', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    const a = await cargarPartidos(ligaId, lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T09:00:00-05:00' }] }))
    const antes = await volcado(ligaId)
    const b = await cargarPartidos(ligaId, lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T14:00Z' }] }))
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.cuerpo.reproducido).toBe(true)
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('un lote posterior NO altera los partidos anteriores y un reintento del primero sigue siendo un no-op', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await cargarPartidos(ligaId, lote())
    const filaAntes = JSON.stringify(await sqlDe(ligaId, 'SELECT * FROM partidos ORDER BY id'))
    const resumenAntes = JSON.stringify(await sqlDe(ligaId, 'SELECT * FROM resumen_partido ORDER BY partido_id'))
    const segundo = await cargarPartidos(ligaId, { cargaId: CARGA(3), minutosPorPeriodo: 8, partidos: [{ id: 'G3', localId: 'EQ3', visitaId: 'EQ1', programadoPara: '2026-10-25T09:00:00-05:00', sede: 'Cancha 2' }] })
    expect(segundo.status).toBe(201)
    const filas = await sqlDe(ligaId, 'SELECT * FROM partidos ORDER BY id')
    expect(JSON.stringify(filas.filter((f) => f.id !== 'G3'))).toBe(filaAntes)
    expect(JSON.stringify((await sqlDe(ligaId, 'SELECT * FROM resumen_partido ORDER BY partido_id')).filter((f) => f.partido_id !== 'G3'))).toBe(resumenAntes)
    const antes = await volcado(ligaId)
    const reintento = await cargarPartidos(ligaId, lote())
    expect(reintento.status).toBe(200)
    expect(reintento.cuerpo.reproducido).toBe(true)
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('un partido ya existente (otro lote) es un conflicto y NO se escribe ninguno de los demás del lote', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await cargarPartidos(ligaId, lote())
    const antes = await volcado(ligaId)
    const r = await cargarPartidos(ligaId, { cargaId: CARGA(4), minutosPorPeriodo: 8, partidos: [{ id: 'G9', localId: 'EQ1', visitaId: 'EQ3' }, { id: 'G1', localId: 'EQ1', visitaId: 'EQ3' }] })
    expect(r.status).toBe(409)
    expect(r.cuerpo).toEqual({ error: 'partido-existente' })
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('mismo cargaId con otro contenido: conflicto; equipos que no existen: 422; todo sin escrituras', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await cargarPartidos(ligaId, lote())
    const antes = await volcado(ligaId)
    const cambiado = await cargarPartidos(ligaId, lote({ partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', sede: 'Otra' }] }))
    expect(cambiado.status).toBe(409)
    expect(cambiado.cuerpo).toEqual({ error: 'carga-conflicto' })
    const desconocido = await cargarPartidos(ligaId, { cargaId: CARGA(5), minutosPorPeriodo: 8, partidos: [{ id: 'G7', localId: 'EQ1', visitaId: 'EQX' }] })
    expect(desconocido.status).toBe(422)
    expect(desconocido.cuerpo).toEqual({ error: 'equipos-desconocidos' })
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('la duración explícita no puede contradecir la de la liga ni la de partidos ya creados', async () => {
    const conLiga = nuevaLiga()
    await cargarEstructura(conLiga, estructura(conLiga, { liga: { minutosPorPeriodo: 10 } }))
    const r = await cargarPartidos(conLiga, lote()) // 8 ≠ 10
    expect(r.status).toBe(409)
    expect(r.cuerpo).toEqual({ error: 'duracion-distinta' })
    expect((await cargarPartidos(conLiga, lote({ minutosPorPeriodo: 10 }))).status).toBe(201)

    const sinLiga = nuevaLiga()
    await cargarEstructura(sinLiga, estructura(sinLiga))
    await cargarPartidos(sinLiga, lote())
    const otra = await cargarPartidos(sinLiga, { cargaId: CARGA(6), minutosPorPeriodo: 10, partidos: [{ id: 'G5', localId: 'EQ1', visitaId: 'EQ3' }] })
    expect(otra.status).toBe(409)
    expect(otra.cuerpo).toEqual({ error: 'duracion-distinta' })
    expect(await sqlDe(sinLiga, 'SELECT COUNT(*) AS n FROM partidos')).toEqual([{ n: 2 }])
  })

  it('el tope de partidos por liga evita superar lo que la lectura pública puede servir', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    const grupo = (desde, n, carga) => ({ cargaId: CARGA(carga), minutosPorPeriodo: 8, partidos: Array.from({ length: n }, (_, i) => ({ id: `H${desde + i}`, localId: 'EQ1', visitaId: 'EQ2' })) })
    for (let k = 0; k < 3; k += 1) expect((await cargarPartidos(ligaId, grupo(k * 100, 100, 10 + k))).status).toBe(201)
    const antes = await volcado(ligaId)
    const r = await cargarPartidos(ligaId, grupo(300, 1, 20))
    expect(r.status).toBe(409)
    expect(r.cuerpo).toEqual({ error: 'liga-demasiado-grande' })
    expect(await volcado(ligaId)).toBe(antes)
    expect((await publico(ligaId)).status).toBe(200)
  })

  it('un fallo a mitad del lote lo deshace entero (partidos, resúmenes y recibo) y el mismo lote se puede repetir', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await dentro(ligaId, (inst) => {
      inst.almacen.sql.exec("CREATE TRIGGER falla_resumen BEFORE INSERT ON resumen_partido WHEN NEW.partido_id = 'G2' BEGIN SELECT RAISE(ABORT, 'falla de prueba'); END").toArray()
    })
    const antes = await volcado(ligaId)
    const r = await cargarPartidos(ligaId, lote())
    expect(r.status).toBe(503)
    expect(r.cuerpo).toEqual({ error: 'resultado-desconocido', reintento: 'misma-carga' })
    expect(await volcado(ligaId)).toBe(antes)
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec('DROP TRIGGER falla_resumen').toArray() })
    expect((await cargarPartidos(ligaId, lote())).status).toBe(201)
  })

  it('no toca plantillas, eventos ni recibos existentes de una liga con datos', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await cargarPartidos(ligaId, lote())
    await dentro(ligaId, (inst) => {
      inst.almacen.sql.exec("INSERT INTO jugadores (id, equipo_id, liga_id, nombre, dorsal, activo, rev) VALUES ('JX', 'EQ1', ?, 'Persona Sintetica', 5, 1, 1)", ligaId).toArray()
    })
    const jugadores = JSON.stringify(await sqlDe(ligaId, 'SELECT * FROM jugadores'))
    expect((await cargarPartidos(ligaId, { cargaId: CARGA(7), minutosPorPeriodo: 8, partidos: [{ id: 'G8', localId: 'EQ1', visitaId: 'EQ3' }] })).status).toBe(201)
    expect(JSON.stringify(await sqlDe(ligaId, 'SELECT * FROM jugadores'))).toBe(jugadores)
  })
})

describe('esquema versión 6: migración aditiva', () => {
  const quitarCargas = (sql) => {
    for (const s of ['DROP TABLE cargas', "UPDATE meta SET valor = '5' WHERE clave = 'esquema'"]) sql.exec(s).toArray()
  }

  it('una base de la versión 5 con datos recibe `cargas` sin cambiar ninguna fila existente; es idempotente', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId)).status).toBe(201)
    const antes = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      quitarCargas(sql)
      expect(sql.exec("SELECT name FROM sqlite_master WHERE name = 'cargas'").toArray()).toEqual([])
      return JSON.stringify(['ligas', 'equipos', 'jugadores', 'partidos', 'resumen_partido', 'credenciales'].map((t) => sql.exec(`SELECT * FROM ${t}`).toArray()))
    })
    const despues = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      crearEsquema(inst.almacen)
      crearEsquema(inst.almacen)
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('9')
      expect(sql.exec('SELECT COUNT(*) AS n FROM cargas').one().n).toBe(0)
      return JSON.stringify(['ligas', 'equipos', 'jugadores', 'partidos', 'resumen_partido', 'credenciales'].map((t) => sql.exec(`SELECT * FROM ${t}`).toArray()))
    })
    expect(despues).toBe(antes)
    // La liga antigua sigue sirviendo su lectura pública.
    expect((await publico(ligaId)).status).toBe(200)
  })

  it('si una migración anterior falla, se deshace todo: ni cambia la versión ni queda `cargas`', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId)).status).toBe(201)
    await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      // Base de la versión 3 (sin columnas de la 4) en la que la columna de la 4 ya existe: su ALTER chocará.
      for (const s of ['DROP TABLE resumen_partido', 'DROP TABLE cargas', 'ALTER TABLE ligas DROP COLUMN subcategoria_json', 'ALTER TABLE partidos DROP COLUMN programado_para', 'ALTER TABLE partidos DROP COLUMN sede',
        "UPDATE meta SET valor = '3' WHERE clave = 'esquema'"]) sql.exec(s).toArray()
      // ligas.categoria sigue existiendo: el primer ALTER de la versión 4 falla.
      expect(() => crearEsquema(inst.almacen)).toThrow()
      expect(sql.exec("SELECT name FROM sqlite_master WHERE name IN ('cargas', 'resumen_partido')").toArray()).toEqual([])
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('3')
    })
  })

  it('"rollback" de despliegue: el código de la versión 5 ignora la tabla extra (es aditiva) y la liga sigue operando', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await cargarPartidos(ligaId, lote())
    const r = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      // Con `cargas` presente y la versión en 5, las lecturas existentes no la usan.
      sql.exec("UPDATE meta SET valor = '5' WHERE clave = 'esquema'").toArray()
      return sql.exec('SELECT COUNT(*) AS n FROM partidos').one().n
    })
    expect(r).toBe(2)
    expect((await publico(ligaId)).status).toBe(200)
  })
})

describe('una liga cargada sirve a la plantilla del organizador (sin acoplarse a ella)', () => {
  it('el organizador provisionado por el operador ve la estructura cargada; el operador no creó ningún organizador', async () => {
    const ligaId = nuevaLiga()
    await cargarEstructura(ligaId, estructura(ligaId))
    await reiniciarAcceso(T0)
    const { codigo } = await provisionar([ligaId])
    const sesion = await iniciarSesion(codigo)
    const { comoOrganizador } = await import('./ayuda-acceso.js')
    const r = await comoOrganizador(sesion.cookie, 'GET', `/v1/organizador/ligas/${ligaId}`)
    expect(r.status).toBe(200)
    expect(r.cuerpo.equipos.map((q) => q.id)).toEqual(['EQ1', 'EQ2', 'EQ3'])
  })
})
