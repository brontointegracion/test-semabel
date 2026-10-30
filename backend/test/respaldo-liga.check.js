// Respaldo SOLO LECTURA de una LIGA (src/respaldo.js, src/respaldo-rutas.js), portado selectivamente del precursor a5a823f sobre ca7a2eb, en workerd con datos SINTETICOS.
// Sin exportacion del objeto de acceso, sin importacion/restauracion y sin rutas de control de pruebas. NO es un respaldo de produccion ni una prueba de recuperacion en la nube.

import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TABLAS_CONOCIDAS, codificar, decodificar, exportarObjeto, marcadorDeRecuperacion, verificarSellos } from '../src/respaldo.js'
import { ErrorExportacion, convertir } from '../scripts/lib/exportar-portable.mjs'
import { verificarPaquete } from '../scripts/lib/lector-portable.mjs'
import { ORIGEN, T0, TOKEN_OPERADOR, accesoStub, admin, cabecerasEscritura, emitirCodigoDePartido, enAcceso, iniciarSesion, pedir, reiniciarAcceso } from './ayuda-acceso.js'
import { alta, campos, escenarioPlantilla } from './ayuda-plantilla.js'
import { dentro, sqlDe } from './ayuda.js'
import { control } from './worker-prueba.js'


beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.pausa = null; control.opcionesRespaldo = null })

const exportar = (ruta) => pedir('POST', ruta, { cuerpo: {}, cabeceras: { authorization: `Bearer ${TOKEN_OPERADOR}`, 'content-type': 'application/json' } })
const RL = (l) => `/v1/admin/respaldo/ligas/${l}/exportar`
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


describe('autorización: el respaldo solo existe para el operador y solo para ligas admitidas', () => {
  it('cerrada por defecto, liga no admitida sin tocar objetos, sin Bearer / otro Bearer / cookie de organizador → 401, otro método → 405, cuerpo con datos → 422; nunca devuelve datos', async () => {
    const e = await escenario()
    for (const ruta of [RL(e.ligaId), `/v1/admin/respaldo/ligas/${e.ligaId}/marcador`]) {
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

  it('NO existen: exportación del objeto de acceso, importación, restauración ni rutas de ensayo (404 incluso con el Bearer correcto)', async () => {
    const e = await escenario()
    for (const ruta of ['/v1/admin/respaldo/acceso/exportar', '/v1/admin/respaldo/acceso/marcador', `/v1/ensayo/respaldo/ligas/${e.ligaId}/importar`, '/v1/ensayo/respaldo/acceso/importar',
      `/v1/admin/respaldo/ligas/${e.ligaId}/importar`, `/v1/admin/respaldo/ligas/${e.ligaId}/restaurar`, '/v1/admin/respaldo/acceso/restaurar']) {
      const r = await admin(ruta, {})
      expect(r.status, ruta).toBe(404)
    }
  })
})

describe('compatibilidad con el convertidor portátil (exportación real de un objeto sintético)', () => {
  it('la exportación sellada del objeto se convierte sin cambios, con los conteos del objeto y sin datos privados en el paquete', async () => {
    const e = await escenario()
    const x = JSON.parse((await texto(RL(e.ligaId))).texto)
    const p = convertir(x, { ahora: () => '2026-10-30T12:00:00.000Z' })
    expect(p.manifiesto.counts.leagues).toBe(1)
    expect(p.manifiesto.counts.events).toBe((await sqlDe(e.ligaId, 'SELECT COUNT(*) AS n FROM eventos'))[0].n)
    expect(p.manifiesto.counts.games).toBe((await sqlDe(e.ligaId, 'SELECT COUNT(*) AS n FROM partidos'))[0].n)
    expect(p.manifiesto.counts.players).toBe((await sqlDe(e.ligaId, 'SELECT COUNT(*) AS n FROM jugadores'))[0].n)
    const todo = [...p.archivos.values()].join('\n')
    for (const secreto of [e.cookie, e.codigo, e.telefono(e.ligaId, 'P').token]) expect(todo).not.toContain(secreto)
    expect(todo).not.toContain('sebel-respaldo-sql')
    expect(p.informeTecnico.source.privateTablesRecognisedAndExcluded).toEqual(expect.arrayContaining(['credenciales', 'recibos']))
  })

  it('un respaldo de otra clase o con una tabla desconocida lo rechaza el convertidor (misma frontera que la exportación)', async () => {
    const e = await escenario()
    const x = JSON.parse((await texto(RL(e.ligaId))).texto)
    expect(() => convertir({ ...x, clase: 'AccesoDO' })).toThrow(ErrorExportacion)
    void verificarPaquete
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
