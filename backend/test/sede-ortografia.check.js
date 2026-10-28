import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { claveOrtografica, validarOrtografia, LIMITE_BYTES_ORTOGRAFIA } from '../src/sede-ortografia.js'
import { VERSION_ESQUEMA } from '../src/esquema.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR, admin, pedir } from './ayuda-acceso.js'
import { T0, Telefono, dentro, sembrar, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'
import { aplicarCarga, capturarBaseOrtografia, construirPlanOrtografia, verificarOrtografia } from '../scripts/lib/operador.js'

// Corregir la ORTOGRAFÍA de la sede de partidos programados y terminados (operador), sobre la línea base de esta versión (sin correcciones del acta ni «corregir sede»). Todo sintético, almacenamiento aislado de cada prueba.

afterEach(() => { control.pausa = null; control.ahoraMs = null })
const ID = (n) => `ortografia-sintetica-${String(n).padStart(4, '0')}-a`
const ANTES = 'Centro Educativo Bilingue Ricardo Miro'
const DESPUES = 'Centro Educativo Bilingüe Ricardo Miró'
const RUTA = (l) => `/v1/admin/ligas/${l}/partidos/sede-ortografia`
const corregir = (ligaId, partidos, n = 1, sobre = {}) => admin(RUTA(ligaId), { cargaId: ID(n), sedeAnterior: ANTES, sede: DESPUES, partidos, ...sobre })
const get = (ruta) => exports.default.fetch(new Request(`${ORIGEN}${ruta}`)).then(async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => null) }))
const sedes = async (ligaId) => Object.fromEntries((await sqlDe(ligaId, 'SELECT id, sede FROM partidos ORDER BY id')).map((f) => [f.id, f.sede]))
const cargas = (ligaId) => sqlDe(ligaId, 'SELECT carga_id, tipo, huella, resultado_json FROM cargas ORDER BY carga_id')
const auditoria = (ligaId) => sqlDe(ligaId, "SELECT tipo, partido_id, detalle FROM auditoria_acceso WHERE tipo = 'partido-sede-ortografia-corregida' ORDER BY id")
const TABLAS = ['ligas', 'equipos', 'jugadores', 'eventos', 'recibos', 'auditoria_reloj', 'bandeja', 'cuarentena', 'credenciales', 'codigos_partido', 'resumen_partido', 'operaciones_plantilla']
// Todo salvo `partidos.sede` (y las filas de auditoría de ESTA operación, que se comprueban aparte).
const volcado = (ligaId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify([
    sql.exec('SELECT id, liga_id, local_id, visita_id, estado_json, rev, ultimo_client_seq, programado_para, version_autorizacion, retirado_en, bloqueo_json FROM partidos ORDER BY id').toArray(),
    ...TABLAS.map((t) => sql.exec(`SELECT * FROM ${t}`).toArray()),
    sql.exec("SELECT * FROM auditoria_acceso WHERE tipo <> 'partido-sede-ortografia-corregida' ORDER BY id").toArray(),
  ])
})
const instantanea = async (ligaId) => ({ volcado: await volcado(ligaId), sedes: await sedes(ligaId), cargas: await cargas(ligaId), tablas: await dentro(ligaId, (inst) => inst.almacen.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").one().n) })
const nada = async (ligaId, antes) => {
  expect(await volcado(ligaId)).toBe(antes.volcado)
  expect(await sedes(ligaId)).toEqual(antes.sedes)
  expect(await cargas(ligaId)).toEqual(antes.cargas)
  expect(await auditoria(ligaId)).toEqual([])
}
const sinSede = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'sede' || k === 'servidorAhoraMs' ? undefined : v)))

/**
 * Liga con P y R (finales jugados de verdad), Q y S (programados), T (programado que luego se pone en juego); todos con la sede ANTERIOR.
 */
async function liga() {
  const ligaId = nuevaLiga()
  const p = payloadDeLiga(ligaId)
  p.partidos.push(
    { id: 'R', localId: 'E2', visitaId: 'E4', inicio: null },
    { id: 'S', localId: 'E3', visitaId: 'E4', inicio: null }, { id: 'T', localId: 'E1', visitaId: 'E4', inicio: null },
  )
  p.credenciales.push({ token: `tok-sintetico-R-${ligaId}-0001`, partidoId: 'R', deviceId: 'tel-R', actorId: 'actor-R' }, { token: `tok-sintetico-T-${ligaId}-0001`, partidoId: 'T', deviceId: 'tel-T', actorId: 'actor-T' })
  expect((await sembrar(ligaId, p)).status).toBe(201)
  let t = T0
  const jugar = async (juego, local, visita, puntosL, puntosV) => {
    const tel = new Telefono(ligaId, juego)
    const paso = async (tipo, datos = {}) => { t += 1000; control.ahoraMs = t; expect((await tel.mandar(tipo, datos, { t })).cuerpo.resultado, tipo).toBe('aceptado') }
    await paso('iniciar-partido'); await paso('arrancar-reloj')
    await paso('anotar', { equipoId: local, jugadorId: local === 'E1' ? 'J1' : 'J9', puntos: puntosL })
    await paso('anotar', { equipoId: visita, jugadorId: visita === 'E2' ? 'J9' : 'K2', puntos: puntosV })
    await paso('cerrar-partido')
  }
  await jugar('P', 'E1', 'E2', 3, 2)
  await jugar('R', 'E2', 'E4', 2, 3)
  control.ahoraMs = t + 60_000
  await sqlDe(ligaId, 'UPDATE partidos SET sede = ?', ANTES)
  return ligaId
}

describe('corregir ortografía de la sede: efecto exacto', () => {
  it('cambia SOLO partidos.sede (programados y finales); todo lo demás, byte a byte igual; auditoría y recibo propios', async () => {
    const ligaId = await liga()
    const antes = await volcado(ligaId)
    const cargasAntes = await cargas(ligaId)
    const publicoAntes = { lista: await get(`/v1/ligas/${ligaId}/publico`), P: await get(`/v1/ligas/${ligaId}/partidos/P`), R: await get(`/v1/ligas/${ligaId}/partidos/R`), Q: await get(`/v1/ligas/${ligaId}/partidos/Q`) }
    expect(publicoAntes.P.cuerpo).toMatchObject({ estado: 'final', local: { puntos: 3 }, visita: { puntos: 2 } })
    expect(publicoAntes.R.cuerpo).toMatchObject({ estado: 'final', local: { puntos: 2 }, visita: { puntos: 3 } })
    const r = await corregir(ligaId, ['P', 'Q', 'R'])
    expect(r).toMatchObject({ status: 201, cuerpo: { ok: true, tipo: 'sede-ortografia', ligaId, sedeAnterior: ANTES, sede: DESPUES, corregidos: ['P', 'Q', 'R'], yaCorregidos: [], reproducido: false } })
    expect(await sedes(ligaId)).toEqual({ P: DESPUES, Q: DESPUES, R: DESPUES, S: ANTES, T: ANTES })
    expect(await volcado(ligaId)).toBe(antes)
    const cargasDespues = await cargas(ligaId)
    expect(cargasDespues.filter((c) => cargasAntes.some((a) => a.carga_id === c.carga_id))).toEqual(cargasAntes) // los recibos originales, intactos
    expect(cargasDespues).toHaveLength(cargasAntes.length + 1)
    expect(cargasDespues.find((c) => c.carga_id === ID(1))).toMatchObject({ tipo: 'sede-ortografia' })
    expect(await auditoria(ligaId)).toEqual(['P', 'Q', 'R'].map((p) => ({ tipo: 'partido-sede-ortografia-corregida', partido_id: p, detalle: `carga:${ID(1)}` })))
    // lo público cambia SOLO en la sede: marcador, estado, fechas, rev
    const lista = await get(`/v1/ligas/${ligaId}/publico`)
    expect(lista.cuerpo.partidos.filter((p) => p.sede === DESPUES).map((p) => p.gameId).sort()).toEqual(['P', 'Q', 'R'])
    expect(sinSede(lista.cuerpo)).toEqual(sinSede(publicoAntes.lista.cuerpo))
    for (const g of ['P', 'Q', 'R']) {
      const d = await get(`/v1/ligas/${ligaId}/partidos/${g}`)
      expect(d.cuerpo.sede).toBe(DESPUES)
      expect(sinSede(d.cuerpo)).toEqual(sinSede(publicoAntes[g]?.cuerpo ?? d.cuerpo))
    }
  })

  it('un partido FINAL conserva marcador, eventos, resumen y rev: se compara fila a fila antes y después', async () => {
    const ligaId = await liga()
    const tomar = () => sqlDe(ligaId, "SELECT (SELECT COUNT(*) FROM eventos) AS eventos, (SELECT json_group_array(json_object('p', partido_id, 'l', local_puntos, 'v', visita_puntos, 'rev', rev_fuente)) FROM resumen_partido) AS resumen, (SELECT json_group_array(json_object('id', id, 'rev', rev, 'estado', json_extract(estado_json, '$.partido.estado'))) FROM partidos) AS partidos")
    const antes = await tomar()
    expect(JSON.parse(antes[0].partidos).filter((p) => p.estado === 'final').map((p) => p.id).sort()).toEqual(['P', 'R'])
    expect(Number(antes[0].eventos)).toBeGreaterThan(0)
    expect((await corregir(ligaId, ['P', 'R'])).status).toBe(201)
    expect(await tomar()).toEqual(antes)
    const lista = (await get(`/v1/ligas/${ligaId}/publico`)).cuerpo.partidos
    expect(lista.find((p) => p.gameId === 'P')).toMatchObject({ estado: 'final', sede: DESPUES, local: { puntos: 3 }, visita: { puntos: 2 } })
    expect(lista.find((p) => p.gameId === 'R')).toMatchObject({ estado: 'final', sede: DESPUES, local: { puntos: 2 }, visita: { puntos: 3 } })
  })

  it('mayúsculas y espacios también cuentan como ortografía: el texto guardado se compara EXACTO (no su forma normalizada)', async () => {
    const ligaId = await liga()
    const raro = 'centro  educativo bilingue ricardo miro'
    await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', raro, 'Q')
    expect(await corregir(ligaId, ['Q'], 1, { sedeAnterior: raro })).toMatchObject({ status: 201, cuerpo: { corregidos: ['Q'] } })
    expect((await sedes(ligaId)).Q).toBe(DESPUES)
    // la sede guardada es ANTES pero el cuerpo espera otra escritura del mismo lugar: conflicto, no coincidencia aproximada
    expect(await corregir(ligaId, ['R'], 2, { sedeAnterior: raro })).toMatchObject({ status: 409, cuerpo: { error: 'sede-en-conflicto', partidos: [{ id: 'R', actual: ANTES }] } })
  })

  it('la reversión es una operación NUEVA con los textos intercambiados', async () => {
    const ligaId = await liga()
    expect((await corregir(ligaId, ['P'], 1)).status).toBe(201)
    expect((await admin(RUTA(ligaId), { cargaId: ID(2), sedeAnterior: DESPUES, sede: ANTES, partidos: ['P'] })).status).toBe(201)
    expect((await sedes(ligaId)).P).toBe(ANTES)
    expect(await corregir(ligaId, ['P'], 1)).toMatchObject({ status: 200, cuerpo: { reproducido: true } })
    expect((await sedes(ligaId)).P).toBe(ANTES)
  })
})

describe('corregir ortografía de la sede: guardas (todo el lote o nada, sin recibo)', () => {
  it('un partido EN JUEGO rechaza el lote entero (aunque haya finales y programados válidos) y no deja recibo', async () => {
    const ligaId = await liga()
    await sqlDe(ligaId, "UPDATE partidos SET rev = 2, estado_json = json_set(estado_json, '$.partido.estado', 'vivo') WHERE id = 'T'")
    const a = await instantanea(ligaId)
    expect(await corregir(ligaId, ['P', 'Q', 'R', 'T'])).toMatchObject({ status: 409, cuerpo: { error: 'sede-no-segura', partidos: [{ id: 'T', motivos: ['no-corregible'] }] } })
    await nada(ligaId, a)
  })

  it('un partido RETIRADO rechaza el lote, y también si ya tiene la sede nueva', async () => {
    const ligaId = await liga()
    expect((await admin(`/v1/admin/ligas/${ligaId}/partidos/retirar`, { cargaId: 'retiro-sintetico-0001-aaaa', partidos: ['S'] })).status).toBe(201)
    const a = await instantanea(ligaId)
    expect(await corregir(ligaId, ['Q', 'S'])).toMatchObject({ status: 409, cuerpo: { error: 'sede-no-segura', partidos: [{ id: 'S', motivos: ['retirado'] }] } })
    await nada(ligaId, a)
    await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', DESPUES, 'S')
    expect((await corregir(ligaId, ['S'], 2)).status).toBe(409)
  })

  it('un estado desconocido o ilegible no se corrige', async () => {
    const ligaId = await liga()
    await sqlDe(ligaId, "UPDATE partidos SET estado_json = json_set(estado_json, '$.partido.estado', 'descanso') WHERE id = 'S'")
    await sqlDe(ligaId, "UPDATE partidos SET estado_json = 'no es json' WHERE id = 'T'")
    const a = await instantanea(ligaId)
    expect(await corregir(ligaId, ['S', 'T', 'Q'])).toMatchObject({ status: 409, cuerpo: { error: 'sede-no-segura', partidos: [{ id: 'S', motivos: ['no-corregible'] }, { id: 'T', motivos: ['no-corregible'] }] } })
    await nada(ligaId, a)
  })

  it('un id desconocido → 422 partidos-desconocidos; liga sin estructura → 409', async () => {
    const ligaId = await liga()
    const a = await instantanea(ligaId)
    expect(await corregir(ligaId, ['Q', 'NO-EXISTE'])).toMatchObject({ status: 422, cuerpo: { error: 'partidos-desconocidos', partidos: ['NO-EXISTE'] } })
    await nada(ligaId, a)
    expect(await corregir(nuevaLiga(), ['Q'])).toMatchObject({ status: 409, cuerpo: { error: 'liga-sin-estructura' } })
  })

  it('una sede guardada distinta de la anterior y de la nueva (otro lugar, NULL, otra escritura) → 409 sede-en-conflicto con la actual; nada cambia', async () => {
    const ligaId = await liga()
    await sqlDe(ligaId, "UPDATE partidos SET sede = 'Otra cancha' WHERE id = 'Q'")
    await sqlDe(ligaId, 'UPDATE partidos SET sede = NULL WHERE id = ?', 'R')
    const a = await instantanea(ligaId)
    expect(await corregir(ligaId, ['P', 'Q', 'R'])).toMatchObject({ status: 409, cuerpo: { error: 'sede-en-conflicto', partidos: [{ id: 'Q', actual: 'Otra cancha' }, { id: 'R', actual: null }] } })
    await nada(ligaId, a)
  })

  it('un partido que ya tiene la sede corregida es un éxito sin escritura ni auditoría (yaCorregidos); el inseguro que ya la tiene sigue rechazando', async () => {
    const ligaId = await liga()
    await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', DESPUES, 'P')
    const r = await corregir(ligaId, ['P', 'Q'])
    expect(r).toMatchObject({ status: 201, cuerpo: { corregidos: ['Q'], yaCorregidos: ['P'] } })
    expect(await auditoria(ligaId)).toEqual([{ tipo: 'partido-sede-ortografia-corregida', partido_id: 'Q', detalle: `carga:${ID(1)}` }])
    await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', DESPUES, 'T')
    await sqlDe(ligaId, "UPDATE partidos SET rev = 2, estado_json = json_set(estado_json, '$.partido.estado', 'vivo') WHERE id = 'T'")
    expect((await corregir(ligaId, ['R', 'T'], 2)).status).toBe(409)
    expect((await sedes(ligaId)).R).toBe(ANTES)
  })

  it('un fallo inyectado a mitad del lote revierte TODO (sede, auditoría y recibo); reintentar la MISMA operación después sí aplica', async () => {
    const ligaId = await liga()
    const a = await instantanea(ligaId)
    await sqlDe(ligaId, "CREATE TRIGGER falla_prueba BEFORE INSERT ON auditoria_acceso WHEN NEW.partido_id = 'R' AND NEW.tipo = 'partido-sede-ortografia-corregida' BEGIN SELECT RAISE(ABORT, 'falla-inyectada'); END")
    expect(await corregir(ligaId, ['P', 'Q', 'R'])).toMatchObject({ status: 503, cuerpo: { error: 'resultado-desconocido', reintento: 'misma-carga' } })
    await nada(ligaId, a)
    await sqlDe(ligaId, 'DROP TRIGGER falla_prueba')
    expect(await corregir(ligaId, ['P', 'Q', 'R'])).toMatchObject({ status: 201, cuerpo: { corregidos: ['P', 'Q', 'R'] } })
    expect(await auditoria(ligaId)).toHaveLength(3)
  })
})

describe('corregir ortografía de la sede: recibo, repetición exacta y conflicto', () => {
  it('repetir lo mismo devuelve el resultado ORIGINAL (200, reproducido) sin escrituras, aunque luego el partido cambie de estado o de sede', async () => {
    const ligaId = await liga()
    const a = await corregir(ligaId, ['P', 'T'])
    expect(a.status).toBe(201)
    await sqlDe(ligaId, "UPDATE partidos SET sede = 'Otra', rev = 5, estado_json = json_set(estado_json, '$.partido.estado', 'vivo') WHERE id = 'T'")
    const medio = { c: await cargas(ligaId), a: await auditoria(ligaId), v: await volcado(ligaId), s: await sedes(ligaId) }
    expect(await corregir(ligaId, ['P', 'T'])).toMatchObject({ status: 200, cuerpo: { ...a.cuerpo, reproducido: true } })
    expect({ c: await cargas(ligaId), a: await auditoria(ligaId), v: await volcado(ligaId), s: await sedes(ligaId) }).toEqual(medio)
  })

  it('el mismo cargaId con otro contenido, o usado por otro tipo de operación → 409 carga-conflicto, sin cambios', async () => {
    const ligaId = await liga()
    expect((await corregir(ligaId, ['P'])).status).toBe(201)
    const s = await sedes(ligaId)
    expect(await corregir(ligaId, ['P', 'Q'])).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    expect(await corregir(ligaId, ['P'], 1, { sede: 'Centro Educativo Bilingüe Ricardo Miro' })).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    expect(await admin(`/v1/admin/ligas/${ligaId}/partidos/retirar`, { cargaId: ID(1), partidos: ['S'] })).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    expect(await sedes(ligaId)).toEqual(s)
    // al revés: un cargaId de otra operación del operador no se puede reutilizar aquí
    expect((await admin(`/v1/admin/ligas/${ligaId}/partidos/retirar`, { cargaId: ID(7), partidos: ['S'] })).status).toBe(201)
    expect(await corregir(ligaId, ['Q'], 7)).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    expect((await sedes(ligaId)).Q).toBe(ANTES)
  })

  it('un rechazo no deja recibo: se puede reintentar el MISMO cargaId una vez arreglado el motivo', async () => {
    const ligaId = await liga()
    await sqlDe(ligaId, "UPDATE partidos SET sede = 'Otra' WHERE id = 'Q'")
    expect((await corregir(ligaId, ['Q'])).status).toBe(409)
    expect((await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM cargas WHERE carga_id = ?', ID(1)))[0].n).toBe(0)
    await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', ANTES, 'Q')
    expect((await corregir(ligaId, ['Q'])).status).toBe(201)
  })

  it('respuesta perdida DESPUÉS de aplicar: 503 y repetir la MISMA operación devuelve el original; ANTES de aplicar: repetir aplica una sola vez', async () => {
    const ligaId = await liga()
    const perder = (despues) => ({
      idFromName: (n) => env.LIGA.idFromName(n),
      get: (id) => { const stub = env.LIGA.get(id); return { corregirOrtografiaSedeOperador: async (x) => { if (despues) await stub.corregirOrtografiaSedeOperador(x); throw new Error('conexion-perdida') } } },
    })
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    const cuerpo = { cargaId: ID(1), sedeAnterior: ANTES, sede: DESPUES, partidos: ['P', 'Q'] }
    expect(await pedir('POST', RUTA(ligaId), { cuerpo, cabeceras, entorno: { ...env, LIGA: perder(true) } })).toMatchObject({ status: 503, cuerpo: { error: 'resultado-desconocido', reintento: 'misma-carga' } })
    expect((await sedes(ligaId)).P).toBe(DESPUES)
    const tras = { c: await cargas(ligaId), a: await auditoria(ligaId) }
    expect(await corregir(ligaId, ['P', 'Q'])).toMatchObject({ status: 200, cuerpo: { reproducido: true, corregidos: ['P', 'Q'] } })
    expect({ c: await cargas(ligaId), a: await auditoria(ligaId) }).toEqual(tras)
    const otra = await liga()
    expect((await pedir('POST', RUTA(otra), { cuerpo, cabeceras, entorno: { ...env, LIGA: perder(false) } })).status).toBe(503)
    expect((await sedes(otra)).P).toBe(ANTES)
    expect(await corregir(otra, ['P', 'Q'])).toMatchObject({ status: 201, cuerpo: { reproducido: false } })
    expect(await auditoria(otra)).toHaveLength(2)
  })
})

describe('corregir ortografía de la sede: puerta del operador y validación estricta', () => {
  it('cerrada por defecto; liga no admitida 404 sin tocar objetos; sin Bearer / otro Bearer: 401; otro método: 405', async () => {
    const ligaId = await liga()
    const cuerpo = { cargaId: ID(1), sedeAnterior: ANTES, sede: DESPUES, partidos: ['Q'] }
    for (const entorno of [{ ...env, ACCESO_ADMIN_HABILITADO: '0' }, { ...env, ACCESO_ADMIN_TOKEN: 'corto' }]) {
      expect((await pedir('POST', RUTA(ligaId), { cuerpo, cabeceras: { authorization: `Bearer ${entorno.ACCESO_ADMIN_TOKEN}`, 'content-type': 'application/json' }, entorno })).status).toBe(404)
    }
    expect((await pedir('POST', RUTA(ligaId), { cuerpo, cabeceras: { 'content-type': 'application/json' } })).status).toBe(401)
    expect((await admin(RUTA(ligaId), cuerpo, 'operador-que-no-es-0000000000000000000')).status).toBe(401)
    expect((await pedir('GET', RUTA(ligaId))).status).toBe(405)
    const accesos = []
    const LIGA = { idFromName: (n) => { accesos.push(n); return env.LIGA.idFromName(n) }, get: (id) => { accesos.push('get'); return env.LIGA.get(id) } }
    expect((await pedir('POST', RUTA('NOADMITIDA'), { cuerpo, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }, entorno: { ...env, LIGA } })).status).toBe(404)
    expect(accesos).toEqual([])
    expect((await sedes(ligaId)).Q).toBe(ANTES)
  })

  it('el cuerpo es EXACTO: campos extra, textos mal formados, iguales, no NFC, ids repetidos o fuera de rango → 422 y nada cambia', async () => {
    const ligaId = await liga()
    const ok = { cargaId: ID(1), sedeAnterior: ANTES, sede: DESPUES, partidos: ['Q'] }
    const malos = [
      { ...ok, extra: 1 }, { ...ok, cargaId: 'corto' }, { ...ok, sede: ANTES }, { ...ok, sede: ` ${DESPUES}` }, { ...ok, sede: '' }, { ...ok, sede: 'x'.repeat(81) }, { ...ok, sede: 'a\u0000b' },
      { ...ok, sede: 'Centro Educativo Bilingu\u0308e Ricardo Miro\u0301' }, // NFD (letra + marca combinada): no se acepta
      { ...ok, sedeAnterior: undefined }, { ...ok, sede: 7 }, { ...ok, partidos: [] }, { ...ok, partidos: ['Q', 'Q'] }, { ...ok, partidos: ['Q', 'con espacio'] },
      { ...ok, partidos: Array.from({ length: 51 }, (_, i) => `G${i}`) }, [], null,
    ]
    for (const cuerpo of malos) expect((await admin(RUTA(ligaId), cuerpo)).status, JSON.stringify(cuerpo)).toBe(422)
    expect((await admin(RUTA(ligaId), '{no es json')).status).toBe(400)
    expect([400, 413]).toContain((await admin(RUTA(ligaId), JSON.stringify({ ...ok, x: 'a'.repeat(LIMITE_BYTES_ORTOGRAFIA + 100) }))).status)
    expect((await sedes(ligaId)).Q).toBe(ANTES)
    expect(validarOrtografia(ok)).toEqual({ ok: true, normalizado: ok })
  })

  it('una sede realmente distinta se rechaza (422 sede-no-es-ortografia) aunque se parezca; solo tildes, mayúsculas y espacios son ortografía', async () => {
    const ligaId = await liga()
    const a = await instantanea(ligaId)
    for (const otra of ['Centro Educativo Bilingüe Ricardo Mira', 'Centro Educativo Bilingüe Ricardo Miró Norte', 'Colegio Ricardo Miró', 'Centro Educativo Bilingüe Ricardo Miro 2',
      'Escuela Bilingüe Ricardo Miró', 'Escuela Bilingue Ricardo Miro', 'Escuela Educativo Bilingüe Ricardo Miró']) {
      const r = await admin(RUTA(ligaId), { cargaId: ID(1), sedeAnterior: ANTES, sede: otra, partidos: ['Q'] })
      expect(r, otra).toMatchObject({ status: 422, cuerpo: { error: 'payload-invalido', errores: ['sede-no-es-ortografia'] } })
    }
    await nada(ligaId, a)
    for (const [x, y] of [['Cancha 1', 'cancha 1'], ['Cancha  1', 'Cancha 1'], ['Peña', 'Pena'], ['Peña', 'pena'], ['Ricardo Miró', 'ricardo  miro']]) expect(claveOrtografica(x)).toBe(claveOrtografica(y))
    for (const [x, y] of [['Cancha 1', 'Cancha 2'], ['Miro', 'Miró 2'], ['Ñandú', 'Nandu Sur']]) expect(claveOrtografica(x)).not.toBe(claveOrtografica(y))
  })

  it('no hay cambio de esquema ni otra ruta de sede: la versión se conserva y `/partidos/sede` no existe en esta versión', async () => {
    const ligaId = await liga()
    const a = await instantanea(ligaId)
    expect(VERSION_ESQUEMA).toBe(9) // la versión de la línea base: esta operación no migra
    const version = async () => (await sqlDe(ligaId, "SELECT valor FROM meta WHERE clave = 'esquema'"))[0].valor
    expect(await version()).toBe('9')
    expect((await admin(`/v1/admin/ligas/${ligaId}/partidos/sede`, { cargaId: ID(5), sedeAnterior: ANTES, sede: DESPUES, partidos: ['Q'] })).status).toBe(404)
    expect(await sedes(ligaId)).toEqual(a.sedes)
    expect((await corregir(ligaId, ['P', 'R'])).status).toBe(201)
    expect(await version()).toBe('9')
    expect(await dentro(ligaId, (inst) => inst.almacen.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").one().n)).toBe(a.tablas)
    expect(a.volcado).toBe(await volcado(ligaId))
  })
})

describe('la herramienta del operador (capturar base → aplicar → verificar) contra el Worker REAL', () => {
  const LOCAL = 'http://127.0.0.1:8899'
  const peticiones = []
  // El transporte de la herramienta, reenviado al Worker real de la prueba (mismo contrato HTTP).
  const f = async (url, init = {}) => {
    const u = new URL(url)
    peticiones.push({ metodo: init.method ?? 'GET', ruta: u.pathname })
    return exports.default.fetch(new Request(`${ORIGEN}${u.pathname}`, { method: init.method, headers: init.headers, body: init.body }))
  }
  const base = { fetch: f, origen: LOCAL, remoto: false, entorno: {}, tiempoMs: 5000 }
  const diarioEnMemoria = () => { let t = null; return { leer: async () => t, escribir: async (x) => { t = x } } }
  const archivo = (ligaId, partidos, n = 1) => ({ ligaId, texto: JSON.stringify({ cargaId: ID(n), sedeAnterior: ANTES, sede: DESPUES, partidos }) })

  it('la base se captura con GET; se aplica con UNA POST con Bearer; la verificación contra la base pasa y solo cambió la sede; marcador y estado de los finales se conservan', async () => {
    const ligaId = await liga()
    peticiones.length = 0
    const orto = [archivo(ligaId, ['R', 'P', 'Q'])]
    const cap = await capturarBaseOrtografia({ ortografias: orto, ...base })
    expect(cap, JSON.stringify(cap.comprobaciones)).toMatchObject({ ok: true })
    expect(peticiones.every((p) => p.metodo === 'GET')).toBe(true) // la captura es solo lectura
    const b = cap.bases[ligaId]
    expect(b.lista.partidos.map((p) => p.gameId).sort()).toEqual(['P', 'Q', 'R', 'S', 'T'])
    expect(b.lista.partidos.find((p) => p.gameId === 'P')).toMatchObject({ estado: 'final', local: { puntos: 3 }, visita: { puntos: 2 } })
    expect(JSON.stringify(b)).not.toContain('servidorAhoraMs') // lo único volátil no se guarda
    expect(Object.keys(b.directos).sort()).toEqual(['P', 'Q', 'R'])
    const baseTexto = JSON.stringify(b)
    const antesVolcado = await volcado(ligaId)

    // sin aplicar todavía, la verificación contra la base FALLA (las sedes siguen siendo las anteriores)
    const previa = await verificarOrtografia({ ortografias: orto, bases: [{ ligaId, texto: baseTexto }], ...base })
    expect(previa.ok).toBe(false)

    const plan = await construirPlanOrtografia({ ortografias: orto })
    expect(plan.ok).toBe(true)
    peticiones.length = 0
    const r = await aplicarCarga({ plan, almacen: diarioEnMemoria(), token: TOKEN_OPERADOR, ...base })
    expect(r).toMatchObject({ estado: 'completo', aplicadas: 1, reproducidas: 0 })
    expect(peticiones).toEqual([{ metodo: 'POST', ruta: `/v1/admin/ligas/${ligaId}/partidos/sede-ortografia` }])
    expect(await volcado(ligaId)).toBe(antesVolcado)

    peticiones.length = 0
    const v = await verificarOrtografia({ ortografias: orto, bases: [{ ligaId, texto: baseTexto }], ...base })
    expect(v, JSON.stringify(v.comprobaciones)).toMatchObject({ ok: true })
    expect(peticiones.every((p) => p.metodo === 'GET')).toBe(true)
    const lista = (await get(`/v1/ligas/${ligaId}/publico`)).cuerpo.partidos
    expect(lista.filter((p) => p.sede === DESPUES).map((p) => p.gameId).sort()).toEqual(['P', 'Q', 'R'])
    expect(lista.find((p) => p.gameId === 'P')).toMatchObject({ estado: 'final', visita: { puntos: 2 } })
    expect(lista.find((p) => p.gameId === 'R')).toMatchObject({ estado: 'final', local: { puntos: 2 }, visita: { puntos: 3 } })
  })

  it('la verificación detecta un cambio que NO es solo de sede (marcador, estado, ausente, sede de un partido no nombrado) y una base de otra liga', async () => {
    const ligaId = await liga()
    const orto = [archivo(ligaId, ['P', 'Q'])]
    const cap = await capturarBaseOrtografia({ ortografias: orto, ...base })
    const baseTexto = JSON.stringify(cap.bases[ligaId])
    const plan = await construirPlanOrtografia({ ortografias: orto })
    expect((await aplicarCarga({ plan, almacen: diarioEnMemoria(), token: TOKEN_OPERADOR, ...base })).estado).toBe('completo')
    const ver = () => verificarOrtografia({ ortografias: orto, bases: [{ ligaId, texto: baseTexto }], ...base })
    expect((await ver()).ok).toBe(true)
    // el estado y la sede de un partido no nombrado cambian: la verificación lo ve
    await sqlDe(ligaId, "UPDATE partidos SET sede = 'Otra sede' WHERE id = 'S'")
    expect(await ver()).toMatchObject({ ok: false })
    await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', ANTES, 'S')
    expect((await ver()).ok).toBe(true)
    // el marcador de P cambia (otra operación distinta de esta): ya no es «solo la sede»
    await sqlDe(ligaId, "UPDATE resumen_partido SET local_puntos = local_puntos + 1 WHERE partido_id = 'P'")
    const mal = await ver()
    expect(mal.ok).toBe(false)
    expect(JSON.stringify(mal.comprobaciones)).toContain('P:local')
    // la base de otra liga o ilegible
    expect((await verificarOrtografia({ ortografias: orto, bases: [{ ligaId, texto: baseTexto.replace(ligaId, 'OTRA') }], ...base })).ok).toBe(false)
    expect((await verificarOrtografia({ ortografias: orto, bases: [{ ligaId, texto: 'no es json' }], ...base })).ok).toBe(false)
    expect((await verificarOrtografia({ ortografias: orto, bases: [], ...base })).ok).toBe(false)
  })

  it('la captura se niega con un partido en juego, con la sede distinta de la anterior o con un partido ausente, y no escribe nada', async () => {
    const ligaId = await liga()
    control.ahoraMs = T0 + 900_000
    expect((await new Telefono(ligaId, 'T').mandar('iniciar-partido', {}, { t: T0 + 900_000 })).cuerpo.resultado).toBe('aceptado') // T queda EN JUEGO de verdad
    await sqlDe(ligaId, "UPDATE partidos SET sede = 'Otra sede' WHERE id = 'S'")
    peticiones.length = 0
    const cap = await capturarBaseOrtografia({ ortografias: [archivo(ligaId, ['P', 'S', 'T', 'NO-EXISTE'])], ...base })
    expect(cap.ok).toBe(false)
    expect(JSON.stringify(cap.comprobaciones)).toMatch(/S:sede-no-es-la-anterior/)
    expect(JSON.stringify(cap.comprobaciones)).toMatch(/T:estado-vivo/)
    expect(JSON.stringify(cap.comprobaciones)).toMatch(/NO-EXISTE:ausente-de-la-lista/)
    expect(peticiones.every((p) => p.metodo === 'GET')).toBe(true)
  })

  it('ruta de preparación: todo-antiguo, mezcla y todo-corregido se capturan, se aplican (los ya corregidos son yaCorregidos) y verifican contra la base; el resultado es el mismo', async () => {
    for (const previas of [[], ['P'], ['P', 'Q', 'R']]) {
      const ligaId = await liga()
      for (const id of previas) await sqlDe(ligaId, 'UPDATE partidos SET sede = ? WHERE id = ?', DESPUES, id)
      const orto = [archivo(ligaId, ['P', 'Q', 'R'])]
      const cap = await capturarBaseOrtografia({ ortografias: orto, ...base })
      expect(cap.ok, JSON.stringify(cap.comprobaciones)).toBe(true)
      const baseTexto = JSON.stringify(cap.bases[ligaId])
      const plan = await construirPlanOrtografia({ ortografias: orto })
      expect((await aplicarCarga({ plan, almacen: diarioEnMemoria(), token: TOKEN_OPERADOR, ...base })).estado).toBe('completo')
      const rec = JSON.parse((await cargas(ligaId)).find((c) => c.carga_id === ID(1)).resultado_json)
      expect(rec.yaCorregidos).toEqual(previas)
      expect(rec.corregidos).toEqual(['P', 'Q', 'R'].filter((id) => !previas.includes(id)))
      expect((await verificarOrtografia({ ortografias: orto, bases: [{ ligaId, texto: baseTexto }], ...base })).ok).toBe(true)
      expect(await auditoria(ligaId)).toHaveLength(3 - previas.length)
    }
  })

  it('reintento tras respuesta incierta: el mismo diario reenvía lo IDÉNTICO y el servidor devuelve su recibo; una segunda ejecución completa no vuelve a enviar', async () => {
    const ligaId = await liga()
    const orto = [archivo(ligaId, ['P', 'Q'])]
    const plan = await construirPlanOrtografia({ ortografias: orto })
    const almacen = diarioEnMemoria()
    let primera = true
    const fPerdiendo = async (url, init = {}) => {
      const r = await f(url, init) // el servidor SÍ aplica
      if (init.method === 'POST' && primera) { primera = false; throw new Error('conexion-perdida') } // pero la respuesta se pierde
      return r
    }
    const r1 = await aplicarCarga({ plan, almacen, token: TOKEN_OPERADOR, ...base, fetch: fPerdiendo })
    expect(r1.estado).toBe('detenido-sin-resolver')
    expect((await sedes(ligaId)).P).toBe(DESPUES)
    peticiones.length = 0
    const r2 = await aplicarCarga({ plan, almacen, token: TOKEN_OPERADOR, ...base })
    expect(r2).toMatchObject({ estado: 'completo', reproducidas: 1, aplicadas: 0 })
    expect(await auditoria(ligaId)).toHaveLength(2) // una sola aplicación
    peticiones.length = 0
    expect((await aplicarCarga({ plan, almacen, token: TOKEN_OPERADOR, ...base })).estado).toBe('completo')
    expect(peticiones).toEqual([]) // el diario ya lo da por aplicado
  })
})
