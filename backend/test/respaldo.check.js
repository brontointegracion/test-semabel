import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TABLAS_CONOCIDAS, codificar, decodificar, exportarObjeto, marcadorDeRecuperacion, sellar, verificarSellos } from '../src/respaldo.js'
import { importarObjeto } from '../ensayo/importar.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, T0, TOKEN_OPERADOR, accesoStub, admin, cabecerasEscritura, emitirCodigoDePartido, enAcceso, iniciarSesion, pedir, reiniciarAcceso } from './ayuda-acceso.js'
import { alta, campos, escenarioPlantilla } from './ayuda-plantilla.js'
import { dentro, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'

// REPORT_246 — respaldo SOLO LECTURA de LigaDO y AccesoDO (src/respaldo.js, src/respaldo-rutas.js) e importación SOLO de ensayo (ensayo/importar.js) en workerd, con datos
// SINTÉTICOS. Esto NO es un respaldo de producción ni una prueba de recuperación PITR en la nube.

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.pausa = null; control.opcionesRespaldo = null })

const exportar = (ruta) => pedir('POST', ruta, { cuerpo: {}, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' } })
const RL = (l) => `/v1/admin/respaldo/ligas/${l}/exportar`
const RA = '/v1/admin/respaldo/acceso/exportar'
const texto = async (ruta) => { const r = await exports.default.fetch(new Request(`${ORIGEN}${ruta}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }, body: '{}' })); return { status: r.status, texto: await r.text() } }

/** Liga con partido jugado hasta el final, recibos, credenciales, plantilla, código de partido, carga con recibo y sesión de organizador; el objeto de acceso con sesión y límites de fuente. */
async function escenario({ cerrar = true } = {}) {
  const e = await escenarioPlantilla()
  const P = e.telefono(e.ligaId, 'P')
  let t = T0
  const paso = async (tipo, datos = {}) => { t += 1000; control.ahoraMs = t; expect((await P.mandar(tipo, datos, { t })).cuerpo.resultado, tipo).toBe('aceptado') }
  await paso('iniciar-partido'); await paso('arrancar-reloj')
  await paso('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 3 }); await paso('anotar', { equipoId: 'E2', jugadorId: 'J9', puntos: 2 })
  await paso('falta', { equipoId: 'E1', jugadorId: 'J1' }); if (cerrar) { await paso('detener-reloj'); await paso('cerrar-partido') }
  expect([200, 201]).toContain((await alta(e.cookie, e.ligaId, 'E3', { campos: campos({ dorsal: 31 }) })).status)
  expect([200, 201]).toContain((await emitirCodigoDePartido(e.cookie, e.ligaId, 'Q')).status)
  expect((await admin(`/v1/admin/ligas/${e.ligaId}/nombre`, { cargaId: 'respaldo-sintetico-0001-aaaa', nombre: 'Nombre sintético nuevo' })).status).toBe(201)
  await iniciarSesion('AAAAA-BBBBB-CCCCC-DDDDD', { ip: '203.0.113.9' }) // código incorrecto: deja una fila de límite por fuente
  return { ...e, ms: t }
}

const filasDe = (r, nombre) => r.tablas.find((t) => t.nombre === nombre)
const conteos = (ligaId, tablas) => Promise.all(tablas.map(async (n) => [n, (await sqlDe(ligaId, `SELECT COUNT(*) AS n FROM "${n}"`))[0].n]))

describe('exportación completa de LigaDO', () => {
  it('trae TODAS las tablas, índices y su esquema exacto, los mismos conteos y sellos válidos; el partido jugado, los recibos y las credenciales están dentro', async () => {
    const e = await escenario()
    const r = await texto(RL(e.ligaId))
    expect(r.status).toBe(200)
    const x = JSON.parse(r.texto)
    expect(x).toMatchObject({ formato: 'sebel-respaldo-sql', version: 1, clase: 'LigaDO', objeto: e.ligaId, versionEsquema: 9 })
    expect(x.tablas.map((t) => t.nombre).filter((n) => n !== 'sqlite_sequence').sort()).toEqual([...TABLAS_CONOCIDAS.LigaDO].sort())
    for (const [n, c] of await conteos(e.ligaId, TABLAS_CONOCIDAS.LigaDO)) expect(filasDe(x, n).filas, n).toBe(c)
    expect((await verificarSellos(x)).ok).toBe(true)
    expect(Array.isArray(x.internasDeLaPlataforma)).toBe(true) // las tablas de la plataforma se NOMBRAN, no se omiten en silencio
    // el esquema es el de la base: cada tabla/índice de sqlite_master (salvo las internas) con su texto exacto
    const maestro = await sqlDe(e.ligaId, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_sequence' ORDER BY type, name")
    expect(x.esquema.map((f) => [f.tipo, f.nombre, f.tabla, f.sql])).toEqual(maestro.map((f) => [f.type, f.name, f.tbl_name, f.sql]))
    // contenido exacto: los eventos y los recibos coinciden fila a fila (texto JSON sin tocar)
    const ev = await sqlDe(e.ligaId, 'SELECT rowid AS rid, * FROM eventos ORDER BY rowid')
    expect(filasDe(x, 'eventos').datos).toHaveLength(ev.length)
    expect(ev.length).toBeGreaterThanOrEqual(2)
    const idxJson = filasDe(x, 'eventos').columnas.indexOf('json')
    expect(filasDe(x, 'eventos').datos.map((f) => f[1 + idxJson])).toEqual(ev.map((f) => f.json))
    expect(filasDe(x, 'recibos').filas).toBeGreaterThanOrEqual(5)
    expect(filasDe(x, 'credenciales').filas).toBe(3)
    expect(filasDe(x, 'cargas').filas).toBe(1) // la carga con su recibo
    expect(filasDe(x, 'operaciones_plantilla').filas).toBeGreaterThan(0)
    expect(filasDe(x, 'codigos_partido').filas).toBeGreaterThan(0)
    expect(filasDe(x, 'sqlite_sequence')).toBeTruthy() // los contadores de AUTOINCREMENT
    // ningún secreto en claro: solo hashes (el token del teléfono, el código de partido y la cookie no aparecen)
    for (const secreto of [e.cookie, e.codigo, e.telefono(e.ligaId, 'P').token]) expect(r.texto).not.toContain(secreto)
  })

  it('dos exportaciones seguidas dan el MISMO sello (la hora de captura no cuenta) y el cuerpo es idéntico salvo `capturadoEnMs`', async () => {
    const e = await escenario()
    const a = JSON.parse((await texto(RL(e.ligaId))).texto)
    control.ahoraMs = e.ms + 5000
    const b = JSON.parse((await texto(RL(e.ligaId))).texto)
    expect(b.sha256).toBe(a.sha256)
    expect(b.capturadoEnMs).not.toBe(a.capturadoEnMs)
    expect({ ...b, capturadoEnMs: 0 }).toEqual({ ...a, capturadoEnMs: 0 })
  })

  it('es SOLO lectura: durante la exportación no se ejecuta ninguna sentencia que escriba y el objeto queda idéntico', async () => {
    const e = await escenario()
    const antes = await dentro(e.ligaId, (inst) => JSON.stringify(inst.almacen.sql.exec("SELECT name FROM sqlite_master ORDER BY name").toArray()) + JSON.stringify(['eventos', 'recibos', 'partidos', 'credenciales'].map((t) => inst.almacen.sql.exec(`SELECT * FROM ${t}`).toArray())))
    const sentencias = []
    await dentro(e.ligaId, (inst) => {
      const sql = inst.almacen.sql
      const original = sql.exec.bind(sql)
      sql.exec = (...a) => { sentencias.push(String(a[0]).trim().split(/\s+/)[0].toUpperCase()); return original(...a) }
      globalThis.__restaurarSql = () => { sql.exec = original }
    })
    const r = await texto(RL(e.ligaId))
    await dentro(e.ligaId, () => { globalThis.__restaurarSql() })
    expect(r.status).toBe(200)
    expect(sentencias.length).toBeGreaterThan(20)
    expect(new Set(sentencias)).toEqual(new Set(['SELECT']))
    const despues = await dentro(e.ligaId, (inst) => JSON.stringify(inst.almacen.sql.exec("SELECT name FROM sqlite_master ORDER BY name").toArray()) + JSON.stringify(['eventos', 'recibos', 'partidos', 'credenciales'].map((t) => inst.almacen.sql.exec(`SELECT * FROM ${t}`).toArray())))
    expect(despues).toBe(antes)
  })

  it('una escritura concurrente NO entra a medias: la lectura es una sola pasada sincrónica (cada recibo coincide con su secuencia de cliente)', async () => {
    const e = await escenario({ cerrar: false }) // P sigue EN JUEGO: se le mandan órdenes mientras se exporta
    const Q = e.telefono(e.ligaId, 'P')
    control.ahoraMs = e.ms + 10
    const rondas = []
    for (let i = 0; i < 8; i += 1) rondas.push((async () => { await Q.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: e.ms + 5 + i }) })().catch(() => {}))
    const exportaciones = await Promise.all([texto(RL(e.ligaId)), texto(RL(e.ligaId)), texto(RL(e.ligaId)), ...rondas].slice(0, 3))
    await Promise.all(rondas)
    for (const r of exportaciones) {
      const x = JSON.parse(r.texto)
      const cols = filasDe(x, 'partidos').columnas
      const iId = cols.indexOf('id'); const iSeq = cols.indexOf('ultimo_client_seq')
      const q = filasDe(x, 'partidos').datos.find((f) => f[1 + iId] === 'P')
      const recibosP = filasDe(x, 'recibos').datos.filter((f) => f[1 + filasDe(x, 'recibos').columnas.indexOf('partido_id')] === 'P').length
      expect(recibosP).toBe(q[1 + iSeq]) // la instantánea es coherente: ni un recibo sin su secuencia ni al revés
      expect((await verificarSellos(x)).ok).toBe(true)
    }
  })
})

describe('exportación completa de AccesoDO', () => {
  it('trae organizadores, propiedad, códigos, sesiones, límites y su esquema; sin ningún secreto en claro', async () => {
    const e = await escenario()
    const r = await texto(RA)
    expect(r.status).toBe(200)
    const x = JSON.parse(r.texto)
    expect(x).toMatchObject({ formato: 'sebel-respaldo-sql', clase: 'AccesoDO', objeto: 'acceso', versionEsquema: 1 })
    expect(x.tablas.map((t) => t.nombre).filter((n) => n !== 'sqlite_sequence').sort()).toEqual([...TABLAS_CONOCIDAS.AccesoDO].sort())
    const cuentas = await enAcceso((inst) => Object.fromEntries(TABLAS_CONOCIDAS.AccesoDO.map((n) => [n, inst.almacen.sql.exec(`SELECT COUNT(*) AS n FROM "${n}"`).one().n])))
    for (const n of TABLAS_CONOCIDAS.AccesoDO) expect(filasDe(x, n).filas, n).toBe(cuentas[n])
    expect(filasDe(x, 'organizadores').filas).toBeGreaterThanOrEqual(1)
    expect(filasDe(x, 'propiedad').filas).toBeGreaterThanOrEqual(1)
    expect(filasDe(x, 'sesiones').filas).toBeGreaterThan(0)
    expect(filasDe(x, 'limite_fuente').filas).toBeGreaterThan(0)
    expect((await verificarSellos(x)).ok).toBe(true)
    for (const secreto of [e.cookie, e.codigo]) expect(r.texto).not.toContain(secreto)
  })
})

describe('autorización: el respaldo solo existe para el operador', () => {
  it('cerrada por defecto, liga no admitida sin tocar objetos, sin Bearer / otro Bearer / cookie de organizador → 401, otro método → 405, cuerpo con datos → 422; nunca devuelve datos', async () => {
    const e = await escenario()
    for (const ruta of [RL(e.ligaId), RA, `/v1/admin/respaldo/ligas/${e.ligaId}/marcador`, '/v1/admin/respaldo/acceso/marcador']) {
      for (const entorno of [{ ...env, ACCESO_ADMIN_HABILITADO: '0' }, { ...env, ACCESO_ADMIN_TOKEN: 'corto' }]) {
        const r = await pedir('POST', ruta, { cuerpo: {}, cabeceras: { authorization: `Bearer ${entorno.ACCESO_ADMIN_TOKEN}`, 'content-type': 'application/json' }, entorno })
        expect(r.status, ruta).toBe(404)
      }
      expect((await pedir('POST', ruta, { cuerpo: {}, cabeceras: { 'content-type': 'application/json' } })).status).toBe(401)
      expect((await admin(ruta, {}, 'operador-que-no-es-0000000000000000000')).status).toBe(401)
      expect((await pedir('POST', ruta, { cuerpo: {}, cabeceras: { cookie: `__Host-sesion=${e.cookie}`, ...cabecerasEscritura() } })).status).toBe(401)
      expect((await pedir('GET', ruta)).status).toBe(405)
      expect((await admin(ruta, { cualquier: 'cosa' })).status).toBe(422)
    }
    const accesos = []
    const LIGA = { idFromName: (n) => { accesos.push(n); return env.LIGA.idFromName(n) }, get: (id) => { accesos.push('get'); return env.LIGA.get(id) } }
    expect((await pedir('POST', '/v1/admin/respaldo/ligas/NOADMITIDA/exportar', { cuerpo: {}, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' }, entorno: { ...env, LIGA } })).status).toBe(404)
    expect(accesos).toEqual([])
    const sin = await pedir('POST', RL(e.ligaId), { cuerpo: {}, cabeceras: { 'content-type': 'application/json' } })
    expect(JSON.stringify(sin.cuerpo)).not.toContain('formato')
  })

  it('la importación NO existe en el Worker de producción: ni la ruta de ensayo ni ninguna otra', async () => {
    const e = await escenario()
    for (const ruta of [`/v1/ensayo/respaldo/ligas/${e.ligaId}/importar`, '/v1/ensayo/respaldo/acceso/importar', `/v1/admin/respaldo/ligas/${e.ligaId}/importar`, '/v1/admin/respaldo/acceso/restaurar']) {
      const r = await admin(ruta, {})
      expect(r.status, ruta).toBe(404)
    }
  })
})

describe('estado no soportado: se informa, nunca se omite ni se trunca', () => {
  it('tabla desconocida, vista, entrada KV, tope de tamaño de la base y del texto → 409 con el motivo y SIN cuerpo parcial; nada se escribe', async () => {
    const e = await escenario()
    const falla = async (preparar, motivo, limpiar) => {
      await preparar()
      const r = await texto(RL(e.ligaId))
      expect(r.status, motivo).toBe(409)
      expect(JSON.parse(r.texto)).toEqual({ error: 'respaldo-no-soportado', motivo })
      expect(r.texto).not.toContain('formato')
      await limpiar?.()
    }
    await falla(() => sqlDe(e.ligaId, 'CREATE TABLE extra_desconocida (a)'), 'tabla-no-reconocida', () => sqlDe(e.ligaId, 'DROP TABLE extra_desconocida'))
    await falla(() => sqlDe(e.ligaId, 'CREATE VIEW vista_extra AS SELECT 1 AS x'), 'vista-no-soportada', () => sqlDe(e.ligaId, 'DROP VIEW vista_extra'))
    await falla(() => dentro(e.ligaId, (inst) => { inst.almacen.kv.put('clave-kv', 'valor') }), 'kv-no-soportado', () => dentro(e.ligaId, (inst) => { inst.almacen.kv.delete('clave-kv') }))
    await falla(() => { control.opcionesRespaldo = { limiteBytesBase: 1 } }, 'respaldo-demasiado-grande', () => { control.opcionesRespaldo = null })
    await falla(() => { control.opcionesRespaldo = { limiteBytesRespaldo: 200 } }, 'respaldo-demasiado-grande', () => { control.opcionesRespaldo = null })
    expect((await texto(RL(e.ligaId))).status).toBe(200) // y sin esos estados vuelve a funcionar
  })

  it('un entero fuera del rango seguro, un tipo desconocido y un identificador no válido se rechazan; una alarma programada también (almacenamiento simulado)', async () => {
    expect(() => codificar('integer', 2 ** 53)).toThrow('entero-fuera-de-rango')
    expect(() => codificar('integer', 2 ** 53 - 1)).not.toThrow()
    expect(() => codificar('raro', 1)).toThrow('tipo-desconocido')
    expect(() => codificar('real', Number.NaN)).toThrow('real-no-valido')
    const simulado = (extra) => ({ getAlarm: async () => 12345, transactionSync: (f) => f(), sql: { databaseSize: 10 }, ...extra })
    await expect(exportarObjeto(simulado(), { clase: 'LigaDO', objeto: 'X', ahora: 1 })).rejects.toMatchObject({ codigo: 'alarma-programada' })
    await expect(exportarObjeto(simulado({ getAlarm: async () => null }), { clase: 'Otra', objeto: 'X', ahora: 1 })).rejects.toMatchObject({ codigo: 'clase-desconocida' })
  })
})

describe('valores sin pérdida', () => {
  const VALORES = [
    ['null', null], ['integer', 0], ['integer', -1], ['integer', 2 ** 53 - 1], ['integer', -(2 ** 53 - 1)], ['real', 1.0], ['real', 0.1], ['real', -0.5], ['real', -0], ['real', 1e300], ['real', 5e-324], ['real', 123456789.123456789],
    ['text', ''], ['text', 'ünï «código»   "comillas" \'simples\' \\ barra'], ['text', '日本語 🏀'], ['blob', new Uint8Array([0, 255, 1, 128]).buffer], ['blob', new Uint8Array([]).buffer],
  ]
  it('codificar/decodificar son inversos para cada tipo (REAL distinto de INTEGER, BLOB en base64)', () => {
    for (const [tipo, v] of VALORES) {
      const c = codificar(tipo, v)
      const d = decodificar(JSON.parse(JSON.stringify(c)))
      if (tipo === 'blob') expect([...new Uint8Array(d.valor)]).toEqual([...new Uint8Array(v)])
      else expect(Object.is(d.valor, v), `${tipo} ${String(v)}`).toBe(true)
      expect(d.marcador).toBe(tipo === 'real' ? 'CAST(? AS REAL)' : tipo === 'integer' ? 'CAST(? AS INTEGER)' : '?')
    }
    expect(codificar('real', 1)).toEqual({ r: '1' })
    expect(codificar('integer', 1)).toBe(1)
  })

  it('en una tabla con TODOS los tipos (también -0.0, 1.0 REAL y BLOB), la exportación y la importación en un objeto nuevo conservan tipo y valor exactos', async () => {
    const A = nuevaLiga(); const B = nuevaLiga()
    const permitidas = [...TABLAS_CONOCIDAS.LigaDO, 'tipos_prueba']
    const ddl = 'CREATE TABLE tipos_prueba (id INTEGER PRIMARY KEY AUTOINCREMENT, a, b, c, d)'
    for (const L of [A, B]) { await sqlDe(L, 'SELECT 1'); await sqlDe(L, ddl) }
    await sqlDe(A, "INSERT INTO tipos_prueba (a, b, c, d) VALUES (1, 1.0, 'tëxt', NULL)")
    await dentro(A, (inst) => {
      const sql = inst.almacen.sql
      sql.exec('INSERT INTO tipos_prueba (a, b, c, d) VALUES (CAST(? AS REAL), ?, ?, ?)', 1, 0.1, '日本', new Uint8Array([0, 255, 7]).buffer)
      sql.exec('INSERT INTO tipos_prueba (a, b, c, d) VALUES (CAST(? AS REAL), 0, 0, 0)', -0)
      sql.exec('INSERT INTO tipos_prueba (a, b, c, d) VALUES (9007199254740991, -9007199254740991, CAST(? AS REAL), CAST(? AS REAL))', 1e300, 5e-324)
    })
    control.opcionesRespaldo = { tablasPermitidas: permitidas }
    const rA = await texto(RL(A))
    expect(rA.status, rA.texto.slice(0, 200)).toBe(200)
    const x = JSON.parse(rA.texto)
    const t = filasDe(x, 'tipos_prueba')
    expect(JSON.stringify(t.datos.map((f) => f.slice(2)))).toBe(JSON.stringify([[1, { r: '1' }, 'tëxt', null], [{ r: '1' }, { r: '0.1' }, '日本', { b: 'AP8H' }], [{ r: '-0' }, 0, 0, 0], [9007199254740991, -9007199254740991, { r: '1e+300' }, { r: '5e-324' }]]))
    // importa en B (objeto nuevo de la MISMA versión de código y el mismo esquema, con la tabla extra creada igual)
    await dentro(B, async (inst) => {
      const r = await importarObjeto(inst.almacen, x, { clase: 'LigaDO', tablasPermitidas: permitidas })
      expect(r).toMatchObject({ estado: 'ok' })
    })
    const y = await dentro(B, (inst) => exportarObjeto(inst.almacen, { clase: 'LigaDO', objeto: A, ahora: 1, tablasPermitidas: permitidas }))
    expect(filasDe(y, 'tipos_prueba').sha256).toBe(t.sha256)
    // tipos reales dentro de la base restaurada (typeof)
    const tipos = await sqlDe(B, 'SELECT typeof(a) ta, typeof(b) tb, typeof(c) tc, typeof(d) td FROM tipos_prueba ORDER BY id')
    expect(tipos).toEqual([{ ta: 'integer', tb: 'real', tc: 'text', td: 'null' }, { ta: 'real', tb: 'real', tc: 'text', td: 'blob' }, { ta: 'real', tb: 'integer', tc: 'integer', td: 'integer' }, { ta: 'integer', tb: 'integer', tc: 'real', td: 'real' }])
    // el contador de AUTOINCREMENT se conserva
    expect(await sqlDe(B, "SELECT seq FROM sqlite_sequence WHERE name = 'tipos_prueba'")).toEqual(await sqlDe(A, "SELECT seq FROM sqlite_sequence WHERE name = 'tipos_prueba'"))
  })
})

describe('marcador de recuperación (PITR): evidencia aparte, nunca inventada', () => {
  it('sin la API (desarrollo local) o con un fallo → disponible:false; con la API → el valor tal cual y SIN afirmar correspondencia con la exportación', async () => {
    const e = await escenario()
    const local = (await admin(`/v1/admin/respaldo/ligas/${e.ligaId}/marcador`, {})).cuerpo
    expect(local).toMatchObject({ disponible: false, correspondeConExportacion: false })
    expect(local.marcador).toBeUndefined()
    expect(await marcadorDeRecuperacion({}, { ahora: 5 })).toMatchObject({ disponible: false, motivo: 'api-no-ofrecida' })
    expect(await marcadorDeRecuperacion({ getCurrentBookmark: async () => { throw new Error('x') } }, { ahora: 5 })).toMatchObject({ disponible: false })
    expect(await marcadorDeRecuperacion({ getCurrentBookmark: async () => '' }, { ahora: 5 })).toMatchObject({ disponible: false })
    expect(await marcadorDeRecuperacion({ getCurrentBookmark: async () => '00000000-00000000-00000000-0000000000000' }, { ahora: 5 })).toMatchObject({ disponible: false, motivo: 'marcador-local-de-relleno' })
    expect(await marcadorDeRecuperacion({ getCurrentBookmark: async () => 'marcador-simulado' }, { ahora: 5 })).toEqual({ disponible: true, marcador: 'marcador-simulado', obtenidoEnMs: 5, correspondeConExportacion: false })
  })
})

describe('importación de ensayo: restaura en un objeto NUEVO y compara', () => {
  const nuevoDestino = async () => { const L = nuevaLiga(); await sqlDe(L, 'SELECT 1'); return L }

  it('LigaDO: tras importar, esquema, conteos y sellos por tabla son idénticos (incluidas las credenciales, los recibos y los contadores)', async () => {
    const e = await escenario()
    const x = JSON.parse((await texto(RL(e.ligaId))).texto)
    const B = await nuevoDestino()
    const r = await dentro(B, (inst) => importarObjeto(inst.almacen, x, { clase: 'LigaDO' }))
    expect(r.estado).toBe('ok')
    const y = await dentro(B, (inst) => exportarObjeto(inst.almacen, { clase: 'LigaDO', objeto: e.ligaId, ahora: 1 }))
    expect(y.esquema).toEqual(x.esquema)
    for (const t of x.tablas) { expect(filasDe(y, t.nombre).filas, t.nombre).toBe(t.filas); expect(t.nombre === 'sqlite_sequence' ? JSON.stringify(filasDe(y, t.nombre).datos) : filasDe(y, t.nombre).sha256, t.nombre).toBe(t.nombre === 'sqlite_sequence' ? JSON.stringify(t.datos) : t.sha256) }
    expect(y.sha256).toBe(x.sha256)
  })

  it('AccesoDO: ídem; las sesiones y los códigos vuelven EXACTAMENTE como estaban', async () => {
    await escenario()
    const x = JSON.parse((await texto(RA)).texto)
    // destino: un segundo objeto de acceso recién creado (nombre distinto; vacío salvo `meta`)
    const destino = env.ACCESO.get(env.ACCESO.idFromName('acceso-destino-ensayo'))
    const { runInDurableObject } = await import('cloudflare:test')
    const r = await runInDurableObject(destino, (inst) => importarObjeto(inst.almacen, x, { clase: 'AccesoDO' }))
    expect(r.estado).toBe('ok')
    const y = await runInDurableObject(destino, (inst) => exportarObjeto(inst.almacen, { clase: 'AccesoDO', objeto: 'acceso', ahora: 1 }))
    expect(y.sha256).toBe(x.sha256)
    expect(filasDe(y, 'sesiones').sha256).toBe(filasDe(x, 'sesiones').sha256)
    expect(filasDe(y, 'codigos_organizador').sha256).toBe(filasDe(x, 'codigos_organizador').sha256)
  })

  it('rechaza, sin escribir: sellos alterados, clase distinta, destino con datos, esquema distinto, columnas distintas y formato no reconocido', async () => {
    const e = await escenario()
    const x = JSON.parse((await texto(RL(e.ligaId))).texto)
    const destinoPara = async () => dentro(await nuevoDestino(), () => 0).then(() => null)
    const intenta = async (cuerpo, { antes, clase = 'LigaDO' } = {}) => {
      const B = await nuevoDestino()
      if (antes) await antes(B)
      const resultado = await dentro(B, (inst) => importarObjeto(inst.almacen, cuerpo, { clase }))
      const filas = await sqlDe(B, 'SELECT COUNT(*) AS n FROM eventos')
      expect(filas[0].n).toBe(0)
      return resultado
    }
    void destinoPara
    const alterado = structuredClone(x); alterado.tablas.find((t) => t.nombre === 'eventos').datos[0][1] = 999
    expect(await intenta(alterado)).toMatchObject({ estado: 'rechazado', motivo: 'sellos-invalidos' })
    const otroSello = structuredClone(x); otroSello.sha256 = '0'.repeat(64)
    expect(await intenta(otroSello)).toMatchObject({ estado: 'rechazado', motivo: 'sellos-invalidos' })
    expect(await intenta(x, { clase: 'AccesoDO' })).toMatchObject({ estado: 'rechazado' })
    expect(await intenta({ ...x, formato: 'otro' })).toMatchObject({ estado: 'rechazado', motivo: 'sellos-invalidos' })
    expect(await intenta(x, { antes: (B) => sqlDe(B, "INSERT INTO ligas (id, nombre, deporte, minutos_por_periodo) VALUES ('X', 'x', 'baloncesto', 10)") })).toMatchObject({ estado: 'rechazado', motivo: 'destino-no-vacio' })
    expect(await intenta(x, { antes: (B) => sqlDe(B, 'DROP INDEX ix_eventos_seq') })).toMatchObject({ estado: 'rechazado' })
    expect(await intenta(x, { antes: (B) => sqlDe(B, 'CREATE INDEX ix_extra_ensayo ON jugadores(nombre)') })).toMatchObject({ estado: 'rechazado', motivo: 'esquema-distinto' })
  })
})
