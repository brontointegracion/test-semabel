import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { sembrar } from './ayuda.js'
import {
  TOKEN_OPERADOR, accesoStub, admin, cabecerasEscritura, comoOrganizador, conCookie, control, enAcceso, iniciarSesion, pedir, provisionar,
  reiniciarAcceso, volcarObjeto,
} from './ayuda-acceso.js'

// ASIGNACIÓN DE LIGAS POR EL OPERADOR (REPORT_187): POST /v1/admin/organizador/ligas. Todo SINTÉTICO, almacenamiento aislado de workerd.
// Se comprueba lo que protege al organizador existente: su código, sus sesiones, su propiedad previa y los datos de las ligas no cambian.

const RUTA = '/v1/admin/organizador/ligas'
const OP = (n) => `asig-prueba-${String(n).padStart(4, '0')}-zzzz`
let n = 0
const op = () => OP(++n)
const asignar = (cuerpo, token = TOKEN_OPERADOR) => admin(RUTA, cuerpo, token)

async function sembrarLiga(ligaId) {
  const p = payloadDeLiga(ligaId); p.credenciales = []
  const r = await sembrar(ligaId, p)
  if (r.status !== 201) throw new Error(`siembra ${r.status}`)
  return ligaId
}
/** Un organizador (activo) que posee `propias`, con sesión abierta, y ligas sembradas `nuevas` que aún no posee nadie. */
async function escenario({ propias = 1, nuevas = 2 } = {}) {
  await reiniciarAcceso(); await limpiar()
  const mias = []; for (let i = 0; i < propias; i += 1) mias.push(await sembrarLiga(nuevaLiga()))
  const otras = []; for (let i = 0; i < nuevas; i += 1) otras.push(await sembrarLiga(nuevaLiga()))
  const { codigo, organizadorId } = await provisionar(mias)
  const sesion = await iniciarSesion(codigo)
  return { mias, otras, codigo, organizadorId, cookie: sesion.cookie }
}
const filas = (consulta, ...args) => enAcceso((inst) => inst.almacen.sql.exec(consulta, ...args).toArray())
const instantanea = async () => JSON.stringify({
  organizadores: await filas('SELECT * FROM organizadores ORDER BY id'),
  codigos: await filas('SELECT * FROM codigos_organizador ORDER BY id'),
  sesiones: await filas('SELECT * FROM sesiones ORDER BY id'),
  propiedad: await filas('SELECT * FROM propiedad ORDER BY organizador_id, liga_id'),
  recibos: await filas('SELECT * FROM asignaciones_liga ORDER BY operacion_id'),
  auditoria: (await filas('SELECT COUNT(*) AS n FROM auditoria_acceso'))[0].n,
})
const yo = (cookie) => pedir('GET', '/v1/organizador/yo', { cabeceras: conCookie(cookie) })

// Cada prueba parte de un objeto de acceso limpio (el de las demás pruebas deja filas de propiedad, recibos y auditoría).
const limpiar = () => enAcceso((inst) => { for (const t of ['asignaciones_liga', 'propiedad', 'auditoria_acceso']) inst.almacen.sql.exec(`DELETE FROM ${t}`) })
beforeEach(async () => { await reiniciarAcceso(); await limpiar() })
afterEach(() => { control.ahoraMs = null; control.desfasesAcceso = null; control.fallaAsignacion = false })

describe('puerta y autenticación del operador', () => {
  it('puerta cerrada (sin bandera, sin secreto o secreto corto): 404 uniforme y ni siquiera se toca el objeto de acceso', async () => {
    const espia = new Proxy({}, { get() { throw new Error('binding tocado') } })
    for (const extra of [{ ACCESO_ADMIN_HABILITADO: '0' }, { ACCESO_ADMIN_HABILITADO: undefined }, { ACCESO_ADMIN_TOKEN: undefined }, { ACCESO_ADMIN_TOKEN: 'corto' }]) {
      const r = await pedir('POST', RUTA, {
        cuerpo: { operacionId: op(), organizadorId: 'org-x', ligas: [nuevaLiga()] },
        cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }, entorno: { ...env, ...extra, ACCESO: espia, LIGA: espia },
      })
      expect(r.status, JSON.stringify(extra)).toBe(404)
    }
  })
  it('sin Bearer, con Bearer incorrecto o con otro esquema: 401 sin escribir nada', async () => {
    const e = await escenario(); const antes = await instantanea()
    const cuerpo = { operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] }
    expect((await asignar(cuerpo, 'otro-secreto-cualquiera-de-operador-00')).status).toBe(401)
    expect((await pedir('POST', RUTA, { cuerpo, cabeceras: { 'content-type': 'application/json' } })).status).toBe(401)
    expect((await pedir('POST', RUTA, { cuerpo, cabeceras: { authorization: `Basic ${TOKEN_OPERADOR}`, 'content-type': 'application/json' } })).status).toBe(401)
    expect(await instantanea()).toBe(antes)
  })
  it('una sesión de organizador (cookie, con CSRF correcto) NO sirve para asignarse ligas: 401 y nada cambia', async () => {
    const e = await escenario(); const antes = await instantanea()
    const cuerpo = { operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] }
    const r = await comoOrganizador(e.cookie, 'POST', RUTA, cuerpo)
    expect(r.status).toBe(401)
    const r2 = await pedir('POST', RUTA, { cuerpo, cabeceras: { ...cabecerasEscritura(), cookie: `__Host-sesion=${e.cookie}` } })
    expect(r2.status).toBe(401)
    expect(await instantanea()).toBe(antes)
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([...e.mias].sort()) // sigue sin ver la liga nueva
  })
  it('solo POST (405 con GET), y la respuesta nunca se guarda en caché', async () => {
    const g = await pedir('GET', RUTA, { cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}` } })
    expect(g.status).toBe(405)
    const e = await escenario()
    const ok = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    expect(ok.respuesta.headers.get('cache-control')).toBe('no-store')
  })
})

describe('validación: nada se escribe', () => {
  it('cuerpos mal formados → 422', async () => {
    const e = await escenario(); const antes = await instantanea(); const l = e.otras[0]
    const malos = [
      {}, [], null, 'x', { operacionId: op(), organizadorId: e.organizadorId },
      { operacionId: op(), organizadorId: e.organizadorId, ligas: [l], extra: 1 },
      { operacionId: 'corto', organizadorId: e.organizadorId, ligas: [l] },
      { operacionId: op(), organizadorId: 'org con espacios', ligas: [l] },
      { operacionId: op(), organizadorId: '', ligas: [l] },
      { operacionId: op(), organizadorId: e.organizadorId, ligas: [] },
      { operacionId: op(), organizadorId: e.organizadorId, ligas: [l, l] },
      { operacionId: op(), organizadorId: e.organizadorId, ligas: [5] },
      { operacionId: op(), organizadorId: e.organizadorId, ligas: Array.from({ length: 11 }, (_, i) => `LIGA${i + 1}`) },
      { operacionId: op(), organizadorId: e.organizadorId, ligas: 'LIGA1' },
    ]
    for (const c of malos) expect((await asignar(c)).status, JSON.stringify(c)).toBe(typeof c === 'string' ? 400 : 422) // un texto JSON suelto lo rechaza el lector de cuerpos común (400)
    expect(await instantanea()).toBe(antes)
  })
  it('liga NO admitida → 422 (también mezclada con ligas válidas: no hay lote parcial)', async () => {
    const e = await escenario(); const antes = await instantanea()
    for (const ligas of [['NO-ADMITIDA'], [e.otras[0], 'NO-ADMITIDA'], ['liga1'], ['LIGA1 ']]) {
      const r = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas })
      expect(r.status, JSON.stringify(ligas)).toBe(422); expect(r.cuerpo.error).toBe('ligas-invalidas')
    }
    expect(await instantanea()).toBe(antes)
  })
  it('organizador inexistente, distinto del activo o desactivado → 409 `organizador-no-activo`; nunca se elige otro organizador', async () => {
    const e = await escenario(); const antes = await instantanea()
    for (const id of ['org-inexistente', 'org-00000000', `${e.organizadorId}x`]) {
      const r = await asignar({ operacionId: op(), organizadorId: id, ligas: [e.otras[0]] })
      expect([r.status, r.cuerpo.error], id).toEqual([409, 'organizador-no-activo'])
    }
    expect(await instantanea()).toBe(antes)
    await accesoStub().desactivarOrganizador()
    const d = await instantanea()
    const r = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    expect([r.status, r.cuerpo.error]).toEqual([409, 'organizador-no-activo'])
    expect(await instantanea()).toBe(d)
  })
  it('sin ningún organizador → 409 `organizador-no-activo`', async () => {
    await reiniciarAcceso()
    const r = await asignar({ operacionId: op(), organizadorId: 'org-12345678', ligas: [nuevaLiga()] })
    expect([r.status, r.cuerpo.error]).toEqual([409, 'organizador-no-activo'])
  })
})

describe('asignación correcta, repetición exacta y conflictos', () => {
  it('añade la propiedad (201), la repetición exacta repite el resultado ORIGINAL (200, reproducido) y no escribe nada', async () => {
    const e = await escenario()
    const cuerpo = { operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[1], e.otras[0]] }
    const a = await asignar(cuerpo)
    expect(a.status).toBe(201)
    expect(a.cuerpo).toEqual({ ok: true, organizadorId: e.organizadorId, agregadas: [...e.otras].sort(), yaExistian: [], ligas: [...e.mias, ...e.otras].sort(), reproducido: false })
    const tras = await instantanea()
    const b = await asignar(cuerpo)
    expect(b.status).toBe(200)
    expect(b.cuerpo).toEqual({ ...a.cuerpo, reproducido: true })
    expect(await instantanea()).toBe(tras) // ni filas nuevas ni auditoría nueva
    expect((await filas('SELECT COUNT(*) AS n FROM asignaciones_liga'))[0].n).toBe(1)
  })
  it('el orden de las ligas no cambia el contenido (misma huella → reproducción)', async () => {
    const e = await escenario()
    const id = op()
    const a = await asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[0], e.otras[1]] })
    const b = await asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[1], e.otras[0]] })
    expect([a.status, b.status, b.cuerpo.reproducido]).toEqual([201, 200, true])
  })
  it('la repetición exacta devuelve el resultado ORIGINAL aunque el organizador haya recibido más ligas después', async () => {
    const e = await escenario({ nuevas: 3 })
    const id = op()
    const a = await asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[1]] })
    const b = await asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    expect(b.cuerpo).toEqual({ ...a.cuerpo, reproducido: true })
    expect(b.cuerpo.ligas).not.toContain(e.otras[1])
  })
  it('mismo identificador con OTRO contenido (otras ligas u otro organizador) → 409 `operacion-conflicto`, sin escribir', async () => {
    const e = await escenario({ nuevas: 2 })
    const id = op()
    expect((await asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[0]] })).status).toBe(201)
    const tras = await instantanea()
    for (const c of [{ organizadorId: e.organizadorId, ligas: [e.otras[1]] }, { organizadorId: e.organizadorId, ligas: [e.otras[0], e.otras[1]] }, { organizadorId: 'org-otro-0000', ligas: [e.otras[0]] }]) {
      const r = await asignar({ operacionId: id, ...c })
      expect([r.status, r.cuerpo.error], JSON.stringify(c)).toEqual([409, 'operacion-conflicto'])
    }
    expect(await instantanea()).toBe(tras)
  })
  it('una liga que ya es del organizador no es error: se informa en `yaExistian` y solo se añade lo nuevo; otro identificador con el mismo contenido tampoco duplica', async () => {
    const e = await escenario()
    const r = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.mias[0], e.otras[0]] })
    expect([r.status, r.cuerpo.agregadas, r.cuerpo.yaExistian]).toEqual([201, [e.otras[0]], [e.mias[0]]])
    const r2 = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    expect([r2.status, r2.cuerpo.agregadas, r2.cuerpo.yaExistian, r2.cuerpo.reproducido]).toEqual([201, [], [e.otras[0]], false])
    expect((await filas('SELECT COUNT(*) AS n FROM propiedad WHERE liga_id = ?', e.otras[0]))[0].n).toBe(1)
  })
  it('conflicto de propiedad: una liga que ya es de OTRO organizador rechaza TODO el lote (la liga libre del mismo lote tampoco se asigna) y no cambia a su dueño', async () => {
    const e = await escenario({ nuevas: 2 })
    await enAcceso((inst) => inst.almacen.sql.exec("INSERT INTO propiedad (organizador_id, liga_id) VALUES ('org-ajeno-heredado', ?)", e.otras[1])) // dueño previo de otro organizador
    const antes = await instantanea()
    const r = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0], e.otras[1]] })
    expect([r.status, r.cuerpo.error, r.cuerpo.ligas]).toEqual([409, 'liga-con-otro-propietario', [e.otras[1]]])
    expect(await instantanea()).toBe(antes) // la libre NO quedó asignada; el dueño ajeno sigue igual; sin recibo ni auditoría
    expect((await filas('SELECT organizador_id FROM propiedad WHERE liga_id = ?', e.otras[1])).map((f) => f.organizador_id)).toEqual(['org-ajeno-heredado'])
    // el rechazo no deja recibo: tras resolver el conflicto, el MISMO identificador puede usarse con la liga libre sola
    expect((await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] })).status).toBe(201)
  })
})

describe('atomicidad', () => {
  it('un fallo entre la escritura de la propiedad y la del recibo lo deshace TODO (propiedad, auditoría y recibo); el reintento exacto después sí funciona', async () => {
    const e = await escenario(); const antes = await instantanea()
    control.fallaAsignacion = true
    const cuerpo = { operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0], e.otras[1]] }
    const r = await asignar(cuerpo)
    expect(r.status).toBe(503)
    expect(r.cuerpo.tipo).toBe('resultado-desconocido')
    expect(await instantanea()).toBe(antes)
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([...e.mias].sort())
    control.fallaAsignacion = false
    const b = await asignar(cuerpo)
    expect([b.status, b.cuerpo.reproducido, b.cuerpo.agregadas.length]).toEqual([201, false, 2])
  })
  it('peticiones simultáneas con el MISMO contenido: un solo resultado coherente (una escritura, las demás repiten el original)', async () => {
    const e = await escenario({ nuevas: 2 })
    const cuerpo = { operacionId: op(), organizadorId: e.organizadorId, ligas: [...e.otras] }
    const rs = await Promise.all(Array.from({ length: 6 }, () => asignar(cuerpo)))
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1)
    expect(rs.filter((r) => r.status === 200 && r.cuerpo.reproducido === true)).toHaveLength(5)
    const unico = rs.find((r) => r.status === 201).cuerpo
    for (const r of rs) expect({ ...r.cuerpo, reproducido: false }).toEqual(unico)
    expect((await filas('SELECT COUNT(*) AS n FROM asignaciones_liga'))[0].n).toBe(1)
    expect((await filas('SELECT COUNT(*) AS n FROM propiedad'))[0].n).toBe(e.mias.length + e.otras.length)
  })
  it('simultáneas con el mismo identificador y contenido DISTINTO: una gana y la otra es conflicto; simultáneas con identificadores distintos y las mismas ligas: sin filas duplicadas', async () => {
    const e = await escenario({ nuevas: 2 })
    const id = op()
    const rs = await Promise.all([asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[0]] }), asignar({ operacionId: id, organizadorId: e.organizadorId, ligas: [e.otras[1]] })])
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409])
    const e2 = await escenario({ nuevas: 1 })
    const dos = await Promise.all([asignar({ operacionId: op(), organizadorId: e2.organizadorId, ligas: [e2.otras[0]] }), asignar({ operacionId: op(), organizadorId: e2.organizadorId, ligas: [e2.otras[0]] })])
    expect(dos.map((r) => r.status)).toEqual([201, 201])
    expect(dos.flatMap((r) => r.cuerpo.agregadas)).toEqual([e2.otras[0]]) // solo UNA la agregó; la otra la encontró
    expect((await filas('SELECT COUNT(*) AS n FROM propiedad WHERE liga_id = ?', e2.otras[0]))[0].n).toBe(1)
  })
})

describe('preservación del organizador existente y de los datos', () => {
  it('el código, sus hashes y caducidad, las sesiones, la identidad y la propiedad previa quedan IDÉNTICOS; solo se añaden filas de propiedad, un recibo y una auditoría', async () => {
    const e = await escenario(); const lectura = async () => JSON.stringify({
      organizadores: await filas('SELECT * FROM organizadores ORDER BY id'), codigos: await filas('SELECT * FROM codigos_organizador ORDER BY id'),
      sesiones: await filas('SELECT * FROM sesiones ORDER BY id'), previa: await filas('SELECT * FROM propiedad WHERE liga_id IN (' + e.mias.map(() => '?').join(',') + ')', ...e.mias),
    })
    const antes = await lectura(); const propiedadAntes = (await filas('SELECT COUNT(*) AS n FROM propiedad'))[0].n; const audAntes = (await filas('SELECT COUNT(*) AS n FROM auditoria_acceso'))[0].n
    const r = await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [...e.otras] })
    expect(r.status).toBe(201)
    expect(await lectura()).toBe(antes)
    expect((await filas('SELECT COUNT(*) AS n FROM propiedad'))[0].n).toBe(propiedadAntes + e.otras.length)
    expect((await filas('SELECT COUNT(*) AS n FROM auditoria_acceso'))[0].n).toBe(audAntes + 1)
    const aud = (await filas("SELECT tipo, detalle FROM auditoria_acceso WHERE tipo = 'ligas-asignadas'"))[0]
    expect(aud.detalle).toBe([...e.otras].sort().join(','))
    const volcado = await volcarObjeto(accesoStub())
    expect(volcado).not.toContain(e.codigo.replaceAll('-', '').slice(5)) // el secreto del código no está en claro en ningún lado
  })
  it('el código vigente SIGUE valiendo (nueva sesión) y la MISMA sesión ya abierta ve la liga nueva y usa sus rutas normales de organizador, sin volver a entrar', async () => {
    const e = await escenario(); const nueva = e.otras[0]
    // antes: la sesión no ve la liga nueva y sus rutas dan 401
    expect((await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${nueva}`)).status).toBe(401)
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([...e.mias].sort())
    const sesionesAntes = JSON.stringify(await filas('SELECT id, secreto_hash, revocada_en, expira_abs FROM sesiones ORDER BY id'))
    expect((await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [nueva] })).status).toBe(201)
    // la MISMA cookie
    const despues = await yo(e.cookie)
    expect(despues.status).toBe(200)
    expect(despues.cuerpo.ligas).toEqual([...e.mias, nueva].sort())
    expect(despues.cuerpo.organizadorId).toBe(e.organizadorId)
    const liga = await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${nueva}`)
    expect(liga.status).toBe(200)
    expect(liga.cuerpo.equipos?.length ?? liga.cuerpo.liga?.equipos?.length).toBeGreaterThan(0)
    const equipoId = (liga.cuerpo.equipos ?? liga.cuerpo.liga.equipos)[0].id
    expect((await comoOrganizador(e.cookie, 'GET', `/v1/organizador/ligas/${nueva}/equipos/${equipoId}/jugadores`)).status).toBe(200)
    const codigoPartido = await comoOrganizador(e.cookie, 'POST', `/v1/organizador/ligas/${nueva}/partidos/P/codigo`)
    expect(codigoPartido.status).toBe(200) // emitir el código de un partido de la liga nueva: ruta normal con la sesión de siempre
    expect(JSON.stringify(await filas('SELECT id, secreto_hash, revocada_en, expira_abs FROM sesiones ORDER BY id'))).toBe(sesionesAntes) // ninguna sesión se cerró ni se rehízo
    // el código del organizador sigue funcionando para iniciar otra sesión
    const otra = await iniciarSesion(e.codigo)
    expect(otra.status).toBe(200)
    expect((await yo(otra.cookie)).cuerpo.ligas).toEqual([...e.mias, nueva].sort())
    // y la sesión original sigue viva
    expect((await yo(e.cookie)).status).toBe(200)
  })
  it('las ligas (propias y asignadas), sus plantillas, partidos y eventos NO se tocan: lecturas públicas y volcado de cada objeto de liga idénticos antes y después', async () => {
    const e = await escenario(); const todas = [...e.mias, ...e.otras]
    const leer = async () => JSON.stringify(await Promise.all(todas.map(async (l) => [
      (await pedir('GET', `/v1/ligas/${l}/publico`)).cuerpo, (await pedir('GET', `/v1/ligas/${l}/partidos/P`)).cuerpo,
      await volcarObjeto(env.LIGA.get(env.LIGA.idFromName(l))),
    ])))
    const antes = await leer()
    expect((await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [...e.otras] })).status).toBe(201)
    // los relojes del servidor (`servidorAhoraMs`) cambian con cada lectura: se comparan sin ellos
    const sinReloj = (t) => t.replace(/"servidorAhoraMs":\d+/g, '"servidorAhoraMs":0')
    expect(sinReloj(await leer())).toBe(sinReloj(antes))
  })
})

describe('compatibilidad del esquema (aditivo)', () => {
  it('la tabla de recibos se crea solo si falta y repetir el arranque no toca nada; un objeto sin ella (código anterior) conserva todos sus datos al actualizarse', async () => {
    const e = await escenario()
    const { crearEsquemaAcceso } = await import('../src/acceso/esquema-acceso.js')
    const datos = async () => JSON.stringify([await filas('SELECT * FROM organizadores'), await filas('SELECT * FROM propiedad ORDER BY liga_id'), await filas('SELECT * FROM codigos_organizador'), await filas('SELECT * FROM sesiones')])
    const antes = await datos()
    await enAcceso((inst) => { inst.almacen.sql.exec('DROP TABLE asignaciones_liga') }) // como un objeto creado por el código anterior
    expect(await datos()).toBe(antes) // lo que el código anterior conoce no depende de la tabla nueva
    await enAcceso((inst) => crearEsquemaAcceso(inst.almacen)) // arranque del código nuevo
    await enAcceso((inst) => crearEsquemaAcceso(inst.almacen)) // y otra vez
    expect(await datos()).toBe(antes)
    expect(await filas("SELECT name FROM sqlite_master WHERE name = 'asignaciones_liga'")).toHaveLength(1)
    expect((await asignar({ operacionId: op(), organizadorId: e.organizadorId, ligas: [e.otras[0]] })).status).toBe(201)
  })
})
