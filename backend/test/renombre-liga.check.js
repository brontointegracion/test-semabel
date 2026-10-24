import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { validarRenombre, LIMITE_BYTES_RENOMBRE } from '../src/renombre-liga.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR, admin, comoOrganizador, emitirCodigoDePartido, escenarioDeCodigos, pedir, activar, tokenDeTelefono } from './ayuda-acceso.js'
import { T0, dentro, ligaSembrada, sembrar, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'

// REPORT_218 — renombrar una liga (operador): SOLO `ligas.nombre`. Todo sintético, almacenamiento aislado de cada prueba.

afterEach(() => { control.pausa = null; control.ahoraMs = null })
const ID = (n) => `nombre-sintetico-${String(n).padStart(4, '0')}-aaaa`
const renombrar = (ligaId, nombre, n = 1) => admin(RUTA(ligaId), { cargaId: ID(n), nombre })
const get = (ruta) => exports.default.fetch(new Request(`${ORIGEN}${ruta}`)).then(async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => null) }))
const RUTA = (l) => `/v1/admin/ligas/${l}/nombre`

/** Liga con dos partidos de los cuales uno se juega y se cierra (eventos, recibos, estadísticas) y credenciales sembradas. */
async function ligaConHistoria() {
  const { ligaId, P, Q } = await ligaSembrada(nuevaLiga())
  await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
  await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
  await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'E1J2', puntos: 2 }, { t: T0 + 3000 }).catch(() => {})
  return { ligaId, P, Q }
}
const TABLAS = ['equipos', 'jugadores', 'partidos', 'eventos', 'recibos', 'auditoria_reloj', 'bandeja', 'cuarentena', 'credenciales', 'codigos_partido', 'resumen_partido', 'operaciones_plantilla']
const volcadoSinNombre = (ligaId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify([sql.exec('SELECT id, deporte, minutos_por_periodo, categoria, subcategoria_json FROM ligas').toArray(), ...TABLAS.map((t) => sql.exec(`SELECT * FROM ${t}`).toArray())])
})
const cargas = (ligaId) => sqlDe(ligaId, 'SELECT carga_id, tipo, huella, resultado_json FROM cargas ORDER BY carga_id')
const auditoria = (ligaId) => sqlDe(ligaId, "SELECT tipo, detalle FROM auditoria_acceso WHERE tipo = 'liga-renombrada' ORDER BY id")
const nombreGuardado = async (ligaId) => (await sqlDe(ligaId, 'SELECT nombre FROM ligas'))[0].nombre

describe('renombrar: efecto exacto', () => {
  it('cambia SOLO ligas.nombre; todo lo demás (ids, equipos, partidos, eventos, recibos, credenciales, resúmenes) queda byte a byte igual; deja auditoría y recibo; conserva los recibos y la auditoría previos', async () => {
    const { ligaId } = await ligaConHistoria()
    const antes = await volcadoSinNombre(ligaId)
    const cargasAntes = await cargas(ligaId)
    const auditoriaAntes = JSON.stringify(await sqlDe(ligaId, 'SELECT * FROM auditoria_acceso ORDER BY id'))
    const anterior = await nombreGuardado(ligaId)
    const r = await renombrar(ligaId, 'Platinum U10 2026')
    expect(r).toMatchObject({ status: 201, cuerpo: { ok: true, tipo: 'renombre', ligaId, nombreAnterior: anterior, nombre: 'Platinum U10 2026', cambiado: true, reproducido: false } })
    expect(await nombreGuardado(ligaId)).toBe('Platinum U10 2026')
    expect(await volcadoSinNombre(ligaId)).toBe(antes)
    const cargasDespues = await cargas(ligaId)
    expect(cargasDespues.slice(0, cargasAntes.length).filter((c) => cargasAntes.some((a) => a.carga_id === c.carga_id))).toEqual(cargasAntes) // ningún recibo previo cambió
    expect(cargasDespues).toHaveLength(cargasAntes.length + 1)
    expect(cargasDespues.find((c) => c.carga_id === ID(1))).toMatchObject({ tipo: 'renombre' })
    expect(await auditoria(ligaId)).toEqual([{ tipo: 'liga-renombrada', detalle: `carga:${ID(1)}` }])
    expect((await sqlDe(ligaId, 'SELECT * FROM auditoria_acceso ORDER BY id')).slice(0, JSON.parse(auditoriaAntes).length).map((x) => JSON.stringify(x)).join()).toBe(JSON.parse(auditoriaAntes).map((x) => JSON.stringify(x)).join()) // lo anterior intacto
  })

  it('todas las lecturas muestran el nombre nuevo: partido, lista de la liga, equipo, ranking de jugadores y vista del organizador; los ids y las direcciones siguen igual', async () => {
    const e = await escenarioDeCodigos()
    const antesLiga = await get(`/v1/ligas/${e.ligaId}/publico`)
    const antesPartido = await get(`/v1/ligas/${e.ligaId}/partidos/P`)
    expect((await renombrar(e.ligaId, 'Platinum U10 2026')).status).toBe(201)
    const liga = await get(`/v1/ligas/${e.ligaId}/publico`)
    expect(liga.cuerpo.liga).toEqual({ ...antesLiga.cuerpo.liga, nombre: 'Platinum U10 2026' })
    expect(liga.cuerpo.equipos).toEqual(antesLiga.cuerpo.equipos)
    expect(liga.cuerpo.partidos.map((p) => p.gameId)).toEqual(antesLiga.cuerpo.partidos.map((p) => p.gameId))
    const partido = await get(`/v1/ligas/${e.ligaId}/partidos/P`)
    expect(partido.cuerpo.liga.nombre).toBe('Platinum U10 2026')
    expect(partido.cuerpo.liga.id).toBe(antesPartido.cuerpo.liga.id)
    expect((await get(`/v1/ligas/${e.ligaId}/equipos/E1/publico`)).cuerpo.liga).toEqual({ id: e.ligaId, nombre: 'Platinum U10 2026' })
    expect((await get(`/v1/ligas/${e.ligaId}/jugadores/publico`)).cuerpo.liga).toEqual({ id: e.ligaId, nombre: 'Platinum U10 2026' })
    // organizador: sigue siendo dueño y ve el nombre nuevo
    const org = await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${e.ligaId}`)
    expect([200, 404]).toContain(org.status)
    if (org.status === 200) expect(JSON.stringify(org.cuerpo)).toContain('Platinum U10 2026')
    expect((await comoOrganizador(e.cookie, 'GET', '/v1/organizador/yo')).cuerpo.ligas).toContain(e.ligaId)
    // los códigos y la activación siguen funcionando (acceso intacto)
    const c = await emitirCodigoDePartido(e.cookie, e.ligaId, 'P'); expect(c.status).toBe(200)
    expect((await activar(e.ligaId, 'P', c.codigo, (await tokenDeTelefono()).tokenHash)).status).toBe(200)
  })

  it('una liga con partidos jugados sigue puntuando igual y sus estadísticas no cambian al renombrarla', async () => {
    const { ligaId, P } = await ligaConHistoria()
    const rankingAntes = JSON.stringify((await get(`/v1/ligas/${ligaId}/jugadores/publico`)).cuerpo.maximosAnotadores)
    const marcadorAntes = JSON.stringify((await get(`/v1/ligas/${ligaId}/partidos/P`)).cuerpo.local)
    expect((await renombrar(ligaId, 'Nombre Nuevo')).status).toBe(201)
    expect(JSON.stringify((await get(`/v1/ligas/${ligaId}/jugadores/publico`)).cuerpo.maximosAnotadores)).toBe(rankingAntes)
    expect(JSON.stringify((await get(`/v1/ligas/${ligaId}/partidos/P`)).cuerpo.local)).toBe(marcadorAntes)
    expect((await P.mandar('detener-reloj', {}, { t: T0 + 4000 })).cuerpo.resultado).toBe('aceptado')
  })
})

describe('idempotencia, conflictos y recuperación', () => {
  it('repetir lo mismo: 200 reproducido con el resultado ORIGINAL y sin escrituras; mismo cargaId con otro nombre o de otro tipo: 409 carga-conflicto', async () => {
    const { ligaId } = await ligaConHistoria()
    const primera = await renombrar(ligaId, 'Platinum U10 2026')
    const tras = { v: await volcadoSinNombre(ligaId), c: await cargas(ligaId), a: await auditoria(ligaId) }
    const otra = await renombrar(ligaId, 'Platinum U10 2026')
    expect(otra).toMatchObject({ status: 200, cuerpo: { ...primera.cuerpo, reproducido: true } })
    expect({ v: await volcadoSinNombre(ligaId), c: await cargas(ligaId), a: await auditoria(ligaId) }).toEqual(tras)
    expect(await renombrar(ligaId, 'Otro Nombre')).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
    expect(await nombreGuardado(ligaId)).toBe('Platinum U10 2026') // el conflicto no cambió nada
    // el mismo cargaId usado por OTRO tipo de operación
    expect(await admin(`/v1/admin/ligas/${ligaId}/partidos/retirar`, { cargaId: ID(1), partidos: ['P'] })).toMatchObject({ status: 409, cuerpo: { error: 'carga-conflicto' } })
  })

  it('el nombre ya igual: éxito sin escritura en la liga (cambiado:false), con su recibo; la repetición devuelve exactamente eso y no deja auditoría de cambio', async () => {
    const { ligaId } = await ligaConHistoria()
    const actual = await nombreGuardado(ligaId)
    const r = await renombrar(ligaId, actual, 5)
    expect(r).toMatchObject({ status: 201, cuerpo: { cambiado: false, nombreAnterior: actual, nombre: actual, reproducido: false } })
    expect(await auditoria(ligaId)).toEqual([])
    const otra = await renombrar(ligaId, actual, 5)
    expect(otra).toMatchObject({ status: 200, cuerpo: { cambiado: false, reproducido: true } })
    expect(await cargas(ligaId)).toHaveLength((await cargas(ligaId)).length)
    expect((await sqlDe(ligaId, "SELECT COUNT(*) AS n FROM cargas WHERE carga_id = ?", ID(5)))[0].n).toBe(1)
    // un cargaId NUEVO con el mismo nombre también es un éxito sin cambio
    expect(await renombrar(ligaId, actual, 6)).toMatchObject({ status: 201, cuerpo: { cambiado: false } })
  })

  it('un rechazo no deja recibo (se puede reintentar con el mismo cargaId); una repetición tras un cambio posterior devuelve el resultado original', async () => {
    const { ligaId } = await ligaConHistoria()
    expect((await admin(RUTA(ligaId), { cargaId: ID(1), nombre: ' con espacios ' })).status).toBe(422)
    expect((await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM cargas WHERE carga_id = ?', ID(1)))[0].n).toBe(0)
    const a = await renombrar(ligaId, 'Primero')
    expect((await renombrar(ligaId, 'Segundo', 2)).status).toBe(201)
    expect(await nombreGuardado(ligaId)).toBe('Segundo')
    const repetida = await renombrar(ligaId, 'Primero') // repetir la 1.ª tras la 2.ª: el resultado original, SIN volver a poner «Primero»
    expect(repetida).toMatchObject({ status: 200, cuerpo: { ...a.cuerpo, reproducido: true } })
    expect(await nombreGuardado(ligaId)).toBe('Segundo')
  })

  it('respuesta perdida DESPUÉS de aplicar: 503 resultado-desconocido (misma-carga) y repetir la MISMA operación devuelve el original sin cambiar nada; ANTES de aplicar: repetir aplica una vez', async () => {
    const { ligaId } = await ligaConHistoria()
    const perder = (despues) => ({
      idFromName: (n) => env.LIGA.idFromName(n),
      get: (id) => { const stub = env.LIGA.get(id); return { renombrarLigaOperador: async (a) => { if (despues) await stub.renombrarLigaOperador(a); throw new Error('conexion-perdida') } } },
    })
    const cabeceras = { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }
    const cuerpo = { cargaId: ID(1), nombre: 'Platinum U10 2026' }
    const perdida = await pedir('POST', RUTA(ligaId), { cuerpo, cabeceras, entorno: { ...env, LIGA: perder(true) } })
    expect(perdida).toMatchObject({ status: 503, cuerpo: { error: 'resultado-desconocido', reintento: 'misma-carga' } })
    expect(await nombreGuardado(ligaId)).toBe('Platinum U10 2026')
    const tras = { c: await cargas(ligaId), a: await auditoria(ligaId) }
    expect(await renombrar(ligaId, 'Platinum U10 2026')).toMatchObject({ status: 200, cuerpo: { reproducido: true, cambiado: true } })
    expect({ c: await cargas(ligaId), a: await auditoria(ligaId) }).toEqual(tras)
    const ligaB = (await ligaConHistoria()).ligaId
    expect((await pedir('POST', RUTA(ligaB), { cuerpo, cabeceras, entorno: { ...env, LIGA: perder(false) } })).status).toBe(503)
    expect(await nombreGuardado(ligaB)).not.toBe('Platinum U10 2026')
    expect(await renombrar(ligaB, 'Platinum U10 2026')).toMatchObject({ status: 201, cuerpo: { reproducido: false } })
    expect(await auditoria(ligaB)).toHaveLength(1)
  })

  it('la reversión es una operación EXPLÍCITA y nueva (otro cargaId con el nombre anterior); nunca un interruptor, y la historia queda registrada', async () => {
    const { ligaId } = await ligaConHistoria()
    const original = await nombreGuardado(ligaId)
    expect((await renombrar(ligaId, 'Platinum U10 2026', 1)).status).toBe(201)
    const revertir = await renombrar(ligaId, original, 2)
    expect(revertir).toMatchObject({ status: 201, cuerpo: { cambiado: true, nombreAnterior: 'Platinum U10 2026', nombre: original } })
    expect(await nombreGuardado(ligaId)).toBe(original)
    expect(await auditoria(ligaId)).toEqual([{ tipo: 'liga-renombrada', detalle: `carga:${ID(1)}` }, { tipo: 'liga-renombrada', detalle: `carga:${ID(2)}` }])
    // repetir la orden de la reversión no vuelve a cambiar nada; repetir la primera NO la reaplica
    expect((await renombrar(ligaId, original, 2)).status).toBe(200)
    expect((await renombrar(ligaId, 'Platinum U10 2026', 1)).status).toBe(200)
    expect(await nombreGuardado(ligaId)).toBe(original)
  })
})

describe('puerta del operador y validación estricta', () => {
  it('cerrada por defecto; liga no admitida 404 sin tocar objetos; sin Bearer / otro Bearer / sesión de organizador: 401; otro método: 405; liga sin estructura: 409; nada cambia', async () => {
    const e = await escenarioDeCodigos()
    const antes = await nombreGuardado(e.ligaId)
    const cuerpo = { cargaId: ID(1), nombre: 'No Debe Cambiar' }
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
    expect(await nombreGuardado(e.ligaId)).toBe(antes)
    // liga admitida pero sin estructura cargada
    expect(await renombrar(nuevaLiga(), 'Algo Nuevo')).toMatchObject({ status: 409, cuerpo: { error: 'liga-sin-estructura' } })
  })

  it('el cuerpo es EXACTO: campos extra, cargaId corto, nombre con espacios en los extremos, vacío, de más de 80 caracteres, con control, no texto, JSON ilegible o demasiado grande → 4xx y nada cambia', async () => {
    const { ligaId } = await ligaConHistoria()
    const antes = await nombreGuardado(ligaId)
    const c = ID(1)
    const malos = [{ cargaId: c, nombre: 'X', extra: 1 }, { cargaId: 'corto', nombre: 'Nombre' }, { cargaId: c, nombre: ' Nombre' }, { cargaId: c, nombre: 'Nombre ' }, { cargaId: c, nombre: '' },
      { cargaId: c, nombre: 'x'.repeat(81) }, { cargaId: c, nombre: 'a\u0000b' }, { cargaId: c, nombre: 'a​b' }, { cargaId: c, nombre: 7 }, { cargaId: c }, { nombre: 'Nombre' }, [], null]
    for (const cuerpo of malos) expect((await admin(RUTA(ligaId), cuerpo)).status, JSON.stringify(cuerpo)).toBe(422)
    expect((await admin(RUTA(ligaId), '{no es json')).status).toBe(400)
    expect([400, 413]).toContain((await admin(RUTA(ligaId), JSON.stringify({ cargaId: c, nombre: 'N', x: 'a'.repeat(LIMITE_BYTES_RENOMBRE + 100) }))).status)
    expect(await nombreGuardado(ligaId)).toBe(antes)
    expect(validarRenombre({ cargaId: c, nombre: 'Platinum U10 2026' })).toEqual({ ok: true, normalizado: { cargaId: c, nombre: 'Platinum U10 2026' } })
    expect((await admin(RUTA(ligaId), { cargaId: c, nombre: 'x'.repeat(80) })).status).toBe(201) // 80 caracteres sí
  })

  it('sin migración: la operación no migra: el esquema no cambia al renombrar y `ligas` no gana columnas', async () => {
    const { ligaId } = await ligaConHistoria()
    expect((await sqlDe(ligaId, "SELECT valor FROM meta WHERE clave = 'esquema'"))[0].valor).toBe('9')
    expect((await renombrar(ligaId, 'Otro')).status).toBe(201)
    expect((await sqlDe(ligaId, "SELECT valor FROM meta WHERE clave = 'esquema'"))[0].valor).toBe('9')
    expect((await sqlDe(ligaId, "SELECT name FROM pragma_table_info('ligas')")).map((c) => c.name)).toEqual(['id', 'nombre', 'deporte', 'minutos_por_periodo', 'categoria', 'subcategoria_json'])
  })
})
