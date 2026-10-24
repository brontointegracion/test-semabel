import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { crearEsquema, VERSION_ESQUEMA } from '../src/esquema.js'
import { LIMITE_PARTIDOS_RETIRO, validarRetiro } from '../src/retiro-partidos.js'
import { SQL_PARTIDOS_DEL_EQUIPO } from '../src/proyeccion-equipo.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import {
  ORIGEN, TOKEN_OPERADOR, activar, admin, comoOrganizador, emitirCodigoDePartido, enLiga, escenarioDeCodigos, pedir, tokenDeTelefono,
} from './ayuda-acceso.js'
import { T0, conteos, dentro, fijarEstadoDePartido, ligaSembrada, sembrar, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'

// REPORT_208 — retiro y restauración de partidos programados (operador). Todo sintético, almacenamiento aislado de cada prueba.

afterEach(() => { control.pausa = null; control.ahoraMs = null })
const ID = (n) => `retiro-sintetico-${String(n).padStart(4, '0')}-aaaa`
const retirar = (ligaId, partidos, n = 1) => admin(`/v1/admin/ligas/${ligaId}/partidos/retirar`, { cargaId: ID(n), partidos })
const restaurar = (ligaId, partidos, n = 2) => admin(`/v1/admin/ligas/${ligaId}/partidos/restaurar`, { cargaId: ID(n), partidos })
const get = (ruta) => exports.default.fetch(new Request(`${ORIGEN}${ruta}`)).then(async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => null) }))
const publico = (ligaId) => get(`/v1/ligas/${ligaId}/publico`)
const idsPublicos = async (ligaId) => (await publico(ligaId)).cuerpo.partidos.map((p) => p.gameId).sort()

/** Liga sintética con cuatro partidos programados SIN credenciales (se activan con códigos). */
async function ligaSinCredenciales() {
  const ligaId = nuevaLiga()
  const p = payloadDeLiga(ligaId)
  p.credenciales = []
  p.partidos.push({ id: 'R', localId: 'E1', visitaId: 'E3', inicio: null }, { id: 'S', localId: 'E2', visitaId: 'E4', inicio: null })
  expect((await sembrar(ligaId, p)).status).toBe(201)
  return ligaId
}
const fila = (ligaId, id) => dentro(ligaId, (inst) => inst.almacen.sql.exec('SELECT id, estado_json, rev, ultimo_client_seq, version_autorizacion, retirado_en FROM partidos WHERE id = ?', id).one())
const auditoria = (ligaId) => sqlDe(ligaId, "SELECT tipo, partido_id, detalle FROM auditoria_acceso WHERE tipo LIKE 'partido-%' ORDER BY id")
const volcado = (ligaId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify(['ligas', 'equipos', 'jugadores', 'partidos', 'eventos', 'recibos', 'resumen_partido', 'credenciales', 'codigos_partido', 'bandeja', 'cuarentena', 'auditoria_reloj']
    .map((t) => sql.exec(`SELECT * FROM ${t}`).toArray()))
})

describe('retirar: efecto, historial intacto y proyecciones', () => {
  it('marca el partido en UNA transacción, conserva su fila, su identificador y su resumen, sube la versión de autorización y deja auditoría; los demás no cambian', async () => {
    const ligaId = await ligaSinCredenciales()
    const antesP = await fila(ligaId, 'P')
    const antesQ = await fila(ligaId, 'Q')
    const resumenAntes = JSON.stringify(await sqlDe(ligaId, "SELECT * FROM resumen_partido WHERE partido_id = 'P'"))
    const r = await retirar(ligaId, ['P'])
    expect(r).toMatchObject({ status: 201, cuerpo: { ok: true, tipo: 'retiro', retirados: ['P'], yaRetirados: [], reproducido: false, ligaId } })
    const p = await fila(ligaId, 'P')
    expect(typeof p.retirado_en).toBe('number')
    expect(p).toMatchObject({ id: 'P', estado_json: antesP.estado_json, rev: 0, ultimo_client_seq: 0, version_autorizacion: antesP.version_autorizacion + 1 })
    expect(JSON.parse(p.estado_json).partido.estado).toBe('programado') // el estado del motor NO cambia: retirado no es un estado
    expect(JSON.stringify(await sqlDe(ligaId, "SELECT * FROM resumen_partido WHERE partido_id = 'P'"))).toBe(resumenAntes)
    expect(await fila(ligaId, 'Q')).toEqual(antesQ)
    expect(await auditoria(ligaId)).toEqual([{ tipo: 'partido-retirado', partido_id: 'P', detalle: `carga:${ID(1)}` }])
  })

  it('lista pública, lectura directa y equipo: el partido retirado desaparece (404 como uno desconocido) y los demás siguen igual', async () => {
    const ligaId = await ligaSinCredenciales()
    expect(await idsPublicos(ligaId)).toEqual(['P', 'Q', 'R', 'S'])
    await retirar(ligaId, ['P', 'R'])
    expect(await idsPublicos(ligaId)).toEqual(['Q', 'S'])
    expect((await get(`/v1/ligas/${ligaId}/partidos/P`)).status).toBe(404)
    expect((await get(`/v1/ligas/${ligaId}/partidos/P`)).cuerpo).toEqual((await get(`/v1/ligas/${ligaId}/partidos/NO-EXISTE`)).cuerpo) // indistinguible
    expect((await get(`/v1/ligas/${ligaId}/partidos/Q`)).status).toBe(200)
    // La consulta del equipo (lista de resultados) tampoco lo ve; E1 juega P (retirado) y R (retirado), E2 juega P y S.
    const filasE1 = await dentro(ligaId, (inst) => inst.almacen.sql.exec(SQL_PARTIDOS_DEL_EQUIPO, 'E1', 'E1', 50).toArray().map((f) => f.id))
    expect(filasE1).toEqual([])
    const filasE2 = await dentro(ligaId, (inst) => inst.almacen.sql.exec(SQL_PARTIDOS_DEL_EQUIPO, 'E2', 'E2', 50).toArray().map((f) => f.id))
    expect(filasE2).toEqual(['S'])
    expect((await get(`/v1/ligas/${ligaId}/equipos/E1/publico`)).status).toBe(200)
    expect((await get(`/v1/ligas/${ligaId}/jugadores/publico`)).status).toBe(200)
    // Nada de lo público revela el retiro.
    const texto = JSON.stringify([(await publico(ligaId)).cuerpo, (await get(`/v1/ligas/${ligaId}/equipos/E1/publico`)).cuerpo])
    expect(texto).not.toMatch(/retir/i)
  })

  it('una reparación de resúmenes al arrancar el objeto NO vuelve a publicar un partido retirado', async () => {
    const ligaId = await ligaSinCredenciales()
    await retirar(ligaId, ['P'])
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("DELETE FROM resumen_partido WHERE partido_id = 'P'"); inst.repararResumenesAlArrancar() })
    expect(await idsPublicos(ligaId)).toEqual(['Q', 'R', 'S'])
    expect((await get(`/v1/ligas/${ligaId}/partidos/P`)).status).toBe(404)
  })

  it('un identificador retirado NUNCA se puede volver a cargar con otro enfrentamiento (partido-existente)', async () => {
    const ligaId = await ligaSinCredenciales()
    await retirar(ligaId, ['P'])
    const r = await admin(`/v1/admin/ligas/${ligaId}/partidos`, { cargaId: ID(9), minutosPorPeriodo: 10, partidos: [{ id: 'P', localId: 'E3', visitaId: 'E4' }] })
    expect(r).toMatchObject({ status: 409, cuerpo: { error: 'partido-existente' } })
  })
})

describe('acceso: emisión de códigos, activación y órdenes de un partido retirado', () => {
  it('sin emisión, sin estado y sin revocación para el organizador (404); sin activación (401 genérico) aun con un código emitido ANTES; al restaurar, ese código vuelve a servir', async () => {
    const e = await escenarioDeCodigos()
    const antes = await emitirCodigoDePartido(e.cookie, e.ligaId, 'P') // código pendiente emitido antes del retiro
    expect(antes.status).toBe(200)
    expect((await retirar(e.ligaId, ['P'])).status).toBe(201) // los códigos sin usar NO impiden el retiro
    expect((await emitirCodigoDePartido(e.cookie, e.ligaId, 'P')).status).toBe(404)
    expect((await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${e.ligaId}/partidos/P/control`)).status).toBe(404)
    expect((await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/control/revocar`)).status).toBe(404)
    const t = await tokenDeTelefono()
    const a = await activar(e.ligaId, 'P', antes.codigo, t.tokenHash)
    expect(a).toMatchObject({ status: 401, cuerpo: { error: 'no-autorizado' } })
    expect(await sqlDe(e.ligaId, 'SELECT * FROM credenciales')).toEqual([]) // nada se creó
    expect((await sqlDe(e.ligaId, "SELECT consumido_en FROM codigos_partido WHERE partido_id = 'P'"))[0].consumido_en).toBeNull()
    // Otro partido de la misma liga: todo normal.
    const otro = await emitirCodigoDePartido(e.cookie, e.ligaId, 'Q')
    expect(otro.status).toBe(200)
    expect((await activar(e.ligaId, 'Q', otro.codigo, (await tokenDeTelefono()).tokenHash)).status).toBe(200)
    // Restaurar: el MISMO código (no caducado) sirve otra vez, y la emisión y el estado vuelven.
    expect((await restaurar(e.ligaId, ['P'])).status).toBe(201)
    expect((await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${e.ligaId}/partidos/P/control`)).status).toBe(200)
    expect((await activar(e.ligaId, 'P', antes.codigo, t.tokenHash)).status).toBe(200)
  })

  it('un código ya USADO tampoco recupera la activación de un partido retirado (partido con credencial revocada)', async () => {
    const e = await escenarioDeCodigos()
    const c = await emitirCodigoDePartido(e.cookie, e.ligaId, 'P')
    const t = await tokenDeTelefono()
    expect((await activar(e.ligaId, 'P', c.codigo, t.tokenHash)).status).toBe(200)
    // Con la credencial activa, el retiro se rehúsa…
    expect((await retirar(e.ligaId, ['P'])).cuerpo).toMatchObject({ error: 'retiro-no-seguro', partidos: [{ id: 'P', motivos: ['credencial-activa'] }] })
    // …el organizador la retira y entonces sí se puede.
    expect((await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${e.ligaId}/partidos/P/control/revocar`)).status).toBe(200)
    expect((await retirar(e.ligaId, ['P'])).status).toBe(201)
    expect((await activar(e.ligaId, 'P', c.codigo, t.tokenHash)).status).toBe(401)
  })

  it('órdenes: si la orden confirma PRIMERO, el retiro se rehúsa; si el retiro llega durante la orden, esta termina normal y el retiro se rehúsa (credencial activa)', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    let durante = null
    control.pausa = async () => { control.pausa = null; durante = await retirar(ligaId, ['P']) }
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    expect(durante).toMatchObject({ status: 409, cuerpo: { error: 'retiro-no-seguro' } })
    // Con el partido ya iniciado, el retiro se rehúsa por varios motivos.
    expect((await retirar(ligaId, ['P'])).cuerpo.partidos[0].motivos).toEqual(expect.arrayContaining(['no-programado', 'con-actividad', 'con-historial', 'credencial-activa']))
    expect((await fila(ligaId, 'P')).retirado_en).toBeNull()
  })

  it('defensa en profundidad: si el partido se retira (marca + versión) ENTRE la lectura y la confirmación de una orden, no se escribe nada y la respuesta es el 401 genérico', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const antes = await conteos(ligaId, 'P')
    control.pausa = async () => {
      control.pausa = null
      await dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET retirado_en = 1, version_autorizacion = version_autorizacion + 1 WHERE id = 'P'")) // lo que haría el retiro
    }
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.respuesta.status).toBe(401)
    expect(await conteos(ligaId, 'P')).toEqual(antes)
    // Y una orden nueva de un partido retirado también: 401, sin recibo.
    const r2 = await P.mandar('iniciar-partido', {}, { t: T0 + 2000 })
    expect(r2.respuesta.status).toBe(401)
    expect(await conteos(ligaId, 'P')).toEqual(antes)
  })
})

describe('guardas: se rehúsa TODO el lote si alguno no es seguro, sin cambiar nada', () => {
  it('en juego, final, con recibo, con evento, con bloqueo o con credencial activa: 409 retiro-no-seguro con motivos; el lote no se aplica ni parcialmente', async () => {
    const { ligaId, P, Q } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 }) // P: en juego
    // Q: programado, pero con un recibo (orden rechazada antes del inicio)
    expect((await Q.mandar('arrancar-reloj', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('rechazado')
    expect((await conteos(ligaId, 'Q')).recibos).toBe(1)
    const r = await retirar(ligaId, ['Q'])
    expect(r).toMatchObject({ status: 409, cuerpo: { error: 'retiro-no-seguro' } })
    expect(r.cuerpo.partidos[0]).toMatchObject({ id: 'Q' })
    expect(r.cuerpo.partidos[0].motivos).toEqual(expect.arrayContaining(['con-actividad', 'con-historial', 'credencial-activa']))
    // lote mixto: uno seguro (sin tocar) y uno inseguro → nada cambia
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("INSERT INTO partidos (id, liga_id, local_id, visita_id, estado_json, rev, programado_para, sede) SELECT 'X', liga_id, 'E1', 'E3', estado_json, 0, NULL, NULL FROM partidos WHERE id = 'Q'"))
    const antes = await volcado(ligaId)
    const mixto = await retirar(ligaId, ['X', 'P'], 3)
    expect(mixto.status).toBe(409)
    expect(mixto.cuerpo.partidos.map((x) => x.id)).toEqual(['P']) // X era seguro y no figura entre los riesgos
    expect(await volcado(ligaId)).toBe(antes)
    expect((await sqlDe(ligaId, "SELECT COUNT(*) AS n FROM cargas WHERE carga_id = ?", ID(3)))[0].n).toBe(0) // un rechazo no deja recibo: se puede reintentar con el mismo cargaId
    // final
    await fijarEstadoDePartido(ligaId, 'X', { estado: 'final' })
    expect((await retirar(ligaId, ['X'], 4)).cuerpo.partidos[0].motivos).toContain('no-programado')
  })

  it('bloqueo guardado y filas de bandeja/cuarentena/auditoría de reloj impiden el retiro; un identificador desconocido (o de otra liga) es 422 y no cambia nada', async () => {
    const ligaId = await ligaSinCredenciales()
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET bloqueo_json = '{}' WHERE id = 'R'"))
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("INSERT INTO cuarentena (partido_id, sobre_json, recibido_en) VALUES ('S', '{}', 1)"))
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("INSERT INTO auditoria_reloj (partido_id, seq, json) VALUES ('Q', 1, '{}')"))
    const r = await retirar(ligaId, ['R', 'S', 'Q'])
    expect(r.status).toBe(409)
    const por = Object.fromEntries(r.cuerpo.partidos.map((x) => [x.id, x.motivos]))
    expect(por.R).toEqual(['con-bloqueo'])
    expect(por.S).toEqual(['con-historial'])
    expect(por.Q).toEqual(['con-historial'])
    const otra = await ligaSinCredenciales()
    const antes = await volcado(ligaId)
    const d = await retirar(ligaId, ['P', 'NO-EXISTE'], 5)
    expect(d).toMatchObject({ status: 422, cuerpo: { error: 'partidos-desconocidos', partidos: ['NO-EXISTE'] } })
    expect(await volcado(ligaId)).toBe(antes)
    void otra
  })
})

describe('idempotencia y respuesta incierta', () => {
  it('repetir lo mismo: 200 reproducido sin escrituras; mismo cargaId con otro contenido o de otro tipo: 409 carga-conflicto; otro cargaId sobre algo ya retirado: yaRetirados', async () => {
    const ligaId = await ligaSinCredenciales()
    const primera = await retirar(ligaId, ['P', 'Q'])
    expect(primera.status).toBe(201)
    const tras = await volcado(ligaId)
    const mismoOrden = await admin(`/v1/admin/ligas/${ligaId}/partidos/retirar`, { partidos: ['Q', 'P'], cargaId: ID(1) }) // orden distinto = mismo contenido
    expect(mismoOrden).toMatchObject({ status: 200, cuerpo: { ok: true, reproducido: true, retirados: ['P', 'Q'] } })
    expect(await volcado(ligaId)).toBe(tras)
    expect(await retirar(ligaId, ['P'], 1)).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } }) // otro contenido
    expect(await restaurar(ligaId, ['P', 'Q'], 1)).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } }) // otro tipo, mismo id
    const v0 = (await fila(ligaId, 'P')).version_autorizacion
    const otraVez = await retirar(ligaId, ['P', 'R'], 6)
    expect(otraVez).toMatchObject({ status: 201, cuerpo: { retirados: ['R'], yaRetirados: ['P'], reproducido: false } })
    expect((await fila(ligaId, 'P')).version_autorizacion).toBe(v0) // lo ya retirado no se toca
    expect((await auditoria(ligaId)).length).toBe(3) // P, Q (primera) y R
    expect(await retirar(ligaId, ['P'], 7)).toMatchObject({ status: 201, cuerpo: { retirados: [], yaRetirados: ['P'] } })
  })

  it('respuesta perdida DESPUÉS de aplicar: el Worker responde 503 resultado-desconocido (misma-carga) y repetir la MISMA operación devuelve el resultado original sin cambiar nada', async () => {
    const ligaId = await ligaSinCredenciales()
    const LIGA = {
      idFromName: (n) => env.LIGA.idFromName(n),
      get: (id) => {
        const stub = env.LIGA.get(id)
        return { retirarPartidosOperador: async (a) => { await stub.retirarPartidosOperador(a); throw new Error('conexion-perdida') } }
      },
    }
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    const perdida = await pedir('POST', `/v1/admin/ligas/${ligaId}/partidos/retirar`, { cuerpo: { cargaId: ID(1), partidos: ['P'] }, cabeceras, entorno: { ...env, LIGA } })
    expect(perdida).toMatchObject({ status: 503, cuerpo: { error: 'resultado-desconocido', reintento: 'misma-carga' } })
    expect((await fila(ligaId, 'P')).retirado_en).not.toBeNull() // sí se aplicó
    const tras = await volcado(ligaId)
    const reintento = await retirar(ligaId, ['P'])
    expect(reintento).toMatchObject({ status: 200, cuerpo: { reproducido: true, retirados: ['P'] } })
    expect(await volcado(ligaId)).toBe(tras)
  })

  it('respuesta perdida ANTES de aplicar: repetir aplica una sola vez', async () => {
    const ligaId = await ligaSinCredenciales()
    const LIGA = { idFromName: (n) => env.LIGA.idFromName(n), get: () => ({ retirarPartidosOperador: async () => { throw new Error('conexion-perdida') } }) }
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    expect((await pedir('POST', `/v1/admin/ligas/${ligaId}/partidos/retirar`, { cuerpo: { cargaId: ID(1), partidos: ['P'] }, cabeceras, entorno: { ...env, LIGA } })).status).toBe(503)
    expect((await fila(ligaId, 'P')).retirado_en).toBeNull()
    expect(await retirar(ligaId, ['P'])).toMatchObject({ status: 201, cuerpo: { reproducido: false } })
    expect((await auditoria(ligaId)).length).toBe(1)
  })
})

describe('restaurar: operación aparte, explícita y reversible', () => {
  it('vuelve a publicar el partido intacto, sube la versión, no es un interruptor y no deshace nada que no sea la marca', async () => {
    const ligaId = await ligaSinCredenciales()
    const antes = await volcado(ligaId)
    await retirar(ligaId, ['P'])
    const v1 = (await fila(ligaId, 'P')).version_autorizacion
    const r = await restaurar(ligaId, ['P'])
    expect(r).toMatchObject({ status: 201, cuerpo: { ok: true, tipo: 'restauracion', restaurados: ['P'], yaActivos: [], reproducido: false } })
    const p = await fila(ligaId, 'P')
    expect(p.retirado_en).toBeNull()
    expect(p.version_autorizacion).toBe(v1 + 1)
    expect(await idsPublicos(ligaId)).toEqual(['P', 'Q', 'R', 'S'])
    expect((await get(`/v1/ligas/${ligaId}/partidos/P`)).status).toBe(200)
    // El estado del motor, la revisión y el resto del contenido de los partidos son los de antes (solo cambió la versión de autorización).
    expect(JSON.stringify(await sqlDe(ligaId, "SELECT id, estado_json, rev FROM partidos ORDER BY id"))).toBe(JSON.stringify(JSON.parse(antes)[3].map((x) => ({ id: x.id, estado_json: x.estado_json, rev: x.rev }))))
    // Restaurar algo ya activo no cambia nada (yaActivos); repetir devuelve el resultado original.
    const otra = await restaurar(ligaId, ['P', 'Q'], 3)
    expect(otra).toMatchObject({ status: 201, cuerpo: { restaurados: [], yaActivos: ['P', 'Q'] } })
    expect(await restaurar(ligaId, ['P'])).toMatchObject({ status: 200, cuerpo: { reproducido: true } })
    expect((await fila(ligaId, 'P')).version_autorizacion).toBe(v1 + 1)
    // Y se puede retirar de nuevo con un cargaId nuevo.
    expect((await retirar(ligaId, ['P'], 8)).status).toBe(201)
    expect(await idsPublicos(ligaId)).toEqual(['Q', 'R', 'S'])
  })

  it('un partido retirado desconocido, o uno que dejó de ser seguro, no se restaura (409) y nada cambia', async () => {
    const ligaId = await ligaSinCredenciales()
    await retirar(ligaId, ['P'])
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("INSERT INTO recibos (partido_id, cmd_id, client_seq, json) VALUES ('P', 'c', 1, '{}')")) // alteración fuera del contrato, solo para la prueba
    const antes = await volcado(ligaId)
    const r = await restaurar(ligaId, ['P'])
    expect(r).toMatchObject({ status: 409, cuerpo: { error: 'restauracion-no-segura', partidos: [{ id: 'P', motivos: expect.arrayContaining(['con-historial']) }] } })
    expect(await volcado(ligaId)).toBe(antes)
    expect((await restaurar(ligaId, ['NO-EXISTE'], 9)).status).toBe(422)
  })
})

describe('puerta del operador y validación estricta', () => {
  const RUTAS = (l) => [`/v1/admin/ligas/${l}/partidos/retirar`, `/v1/admin/ligas/${l}/partidos/restaurar`]

  it('cerrada por defecto; liga no admitida 404 sin tocar objetos; sin Bearer / otro Bearer / sesión de organizador: 401; otro método: 405; nada cambia', async () => {
    const e = await escenarioDeCodigos()
    const antes = await volcado(e.ligaId)
    const cuerpo = { cargaId: ID(1), partidos: ['P'] }
    for (const ruta of RUTAS(e.ligaId)) {
      for (const entorno of [{ ...env, ACCESO_ADMIN_HABILITADO: '0' }, { ...env, ACCESO_ADMIN_TOKEN: 'corto' }]) {
        expect((await pedir('POST', ruta, { cuerpo, cabeceras: { authorization: `Bearer ${entorno.ACCESO_ADMIN_TOKEN}`, 'content-type': 'application/json' }, entorno })).status).toBe(404)
      }
      expect((await pedir('POST', ruta, { cuerpo, cabeceras: { 'content-type': 'application/json' } })).status).toBe(401)
      expect((await admin(ruta, cuerpo, 'operador-que-no-es-0000000000000000000')).status).toBe(401)
      expect((await pedir('POST', ruta, { cuerpo, cabeceras: { cookie: `__Host-sesion=${e.cookie}`, origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' } })).status).toBe(401)
      expect((await pedir('GET', ruta)).status).toBe(405)
    }
    const accesos = []
    const LIGA = { idFromName: (n) => { accesos.push(n); return env.LIGA.idFromName(n) }, get: (id) => { accesos.push('get'); return env.LIGA.get(id) } }
    for (const ruta of RUTAS('NOADMITIDA')) {
      expect((await pedir('POST', ruta, { cuerpo, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }, entorno: { ...env, LIGA } })).status).toBe(404)
    }
    expect(accesos).toEqual([])
    expect(await volcado(e.ligaId)).toBe(antes)
  })

  it('el cuerpo es EXACTO: campos extra, ids repetidos o mal formados, lista vacía o demasiado larga, cargaId corto, JSON ilegible o demasiado grande → 4xx y nada cambia', async () => {
    const ligaId = await ligaSinCredenciales()
    const antes = await volcado(ligaId)
    const malos = [
      { cargaId: ID(1), partidos: ['P'], extra: 1 }, { cargaId: ID(1), partidos: ['P', 'P'] }, { cargaId: ID(1), partidos: ['P Q'] }, { cargaId: ID(1), partidos: [] },
      { cargaId: ID(1), partidos: [1] }, { cargaId: ID(1), partidos: Array.from({ length: LIMITE_PARTIDOS_RETIRO + 1 }, (_, i) => `G${i}`) }, { cargaId: 'corto', partidos: ['P'] },
      { partidos: ['P'] }, { cargaId: ID(1) }, [], null, 'texto',
    ]
    for (const ruta of RUTAS(ligaId)) {
      for (const cuerpo of malos) expect((await admin(ruta, cuerpo)).status, JSON.stringify(cuerpo).slice(0, 60)).toBe(typeof cuerpo === 'string' ? 400 : 422) // un texto suelto ni siquiera es JSON
      expect((await admin(ruta, '{no es json')).status).toBe(400)
      expect([400, 413]).toContain((await admin(ruta, JSON.stringify({ cargaId: ID(1), partidos: ['P'], x: 'a'.repeat(9000) }))).status)
    }
    expect(validarRetiro({ cargaId: ID(1), partidos: ['b', 'a'] })).toEqual({ ok: true, normalizado: { cargaId: ID(1), partidos: ['a', 'b'] } })
    expect(await volcado(ligaId)).toBe(antes)
  })
})

describe('migración 8 y datos existentes', () => {
  it('una base de la versión 7 con partidos, eventos y recibos pasa a 8 sin cambiar ninguna fila: todos quedan ACTIVOS; es idempotente y la puntuación sigue igual', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect((await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })).cuerpo.resultado).toBe('aceptado')
    const publicoAntes = JSON.stringify((await publico(ligaId)).cuerpo.partidos.map((p) => [p.gameId, p.estado, p.rev]))
    const antes = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      sql.exec('ALTER TABLE partidos DROP COLUMN retirado_en').toArray() // una base de la versión 7
      sql.exec("UPDATE meta SET valor = '7' WHERE clave = 'esquema'").toArray()
      expect(sql.exec("SELECT name FROM pragma_table_info('partidos')").toArray().map((c) => c.name)).not.toContain('retirado_en')
      return JSON.stringify(['partidos', 'eventos', 'recibos', 'resumen_partido', 'credenciales'].map((t) => sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray()))
    })
    const despues = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      crearEsquema(inst.almacen)
      crearEsquema(inst.almacen)
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      expect(sql.exec('SELECT COUNT(*) AS n FROM partidos WHERE retirado_en IS NOT NULL').one().n).toBe(0)
      return JSON.stringify(['partidos', 'eventos', 'recibos', 'resumen_partido', 'credenciales'].map((t) => sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray()))
    })
    // La única diferencia en `partidos` es la columna nueva, nula en todas las filas.
    const quitar = (t) => JSON.parse(t).map((tabla, i) => (i === 0 ? tabla.map(({ retirado_en: _r, ...resto }) => resto) : tabla))
    expect(quitar(despues)).toEqual(quitar(antes))
    expect(JSON.stringify((await publico(ligaId)).cuerpo.partidos.map((p) => [p.gameId, p.estado, p.rev]))).toBe(publicoAntes)
    expect((await P.mandar('detener-reloj', {}, { t: T0 + 3000 })).cuerpo.resultado).toBe('aceptado')
  })
})

describe('puntuación normal con partidos retirados en la misma liga', () => {
  it('un partido activo se inicia, puntúa y se publica igual mientras otro está retirado', async () => {
    const ligaId = nuevaLiga()
    const p = payloadDeLiga(ligaId)
    expect((await sembrar(ligaId, p)).status).toBe(201) // P y Q con credenciales sembradas
    const Q = (await ligaSembradaYa(ligaId)).Q
    // Q retirado antes de empezar (no tiene actividad ni se le activó nada nuevo): se revoca su credencial sembrada por el contrato existente.
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET revocada = 1 WHERE partido_id = 'Q'"))
    expect((await retirar(ligaId, ['Q'])).status).toBe(201)
    const P = (await ligaSembradaYa(ligaId)).P
    expect((await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    expect((await get(`/v1/ligas/${ligaId}/partidos/P`)).cuerpo.estado).toBe('vivo')
    expect(await idsPublicos(ligaId)).toEqual(['P'])
    expect((await Q.mandar('iniciar-partido', {}, { t: T0 + 2000 })).respuesta.status).toBe(401) // el partido retirado no puede empezar
    expect((await fila(ligaId, 'Q')).rev).toBe(0)
  })
})
const ligaSembradaYa = async (ligaId) => {
  const { Telefono } = await import('./ayuda.js')
  return { P: new Telefono(ligaId, 'P'), Q: new Telefono(ligaId, 'Q') }
}
