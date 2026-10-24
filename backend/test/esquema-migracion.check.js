import { describe, expect, it } from 'vitest'
import { crearEsquema, VERSION_ESQUEMA } from '../src/esquema.js'
import { crearEsquemaAcceso } from '../src/acceso/esquema-acceso.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { enLiga, accesoStub, enAcceso } from './ayuda-acceso.js'
import { ligaSembrada, conteos } from './ayuda.js'

// Devuelve la base de la versión 5 a la forma de la versión 4 (sin la tabla del resumen público).
const aVersionCuatro = (sql) => {
  // (la columna `retirado_en` de la versión 8 tampoco existe en una base de la versión 4 o anterior)
  for (const s of ['DROP TABLE resumen_partido', 'ALTER TABLE partidos DROP COLUMN retirado_en', 'ALTER TABLE equipos DROP COLUMN rama', "UPDATE meta SET valor = '4' WHERE clave = 'esquema'"]) sql.exec(s).toArray()
}

// Devuelve la base de la versión 4 a la forma de la versión 3 (sin las columnas de categoría, hora programada y sede).
const aVersionTres = (sql) => {
  aVersionCuatro(sql)
  for (const s of [
    'ALTER TABLE ligas DROP COLUMN categoria', 'ALTER TABLE ligas DROP COLUMN subcategoria_json',
    'ALTER TABLE partidos DROP COLUMN programado_para', 'ALTER TABLE partidos DROP COLUMN sede',
    "UPDATE meta SET valor = '3' WHERE clave = 'esquema'",
  ]) sql.exec(s).toArray()
}

// Devuelve la tabla de jugadores y lo demás de la versión 3 a la forma de la versión 2 (sin columnas nuevas, sin recibos
// ni auditoría de plantilla). Los datos de las columnas antiguas se conservan.
const aVersionDos = (sql) => {
  aVersionTres(sql)
  for (const s of [
    'DROP TABLE operaciones_plantilla', 'DROP TABLE auditoria_plantilla',
    'DROP INDEX ix_jugadores_liga', 'DROP INDEX ix_jugadores_persona', 'DROP INDEX ux_jugadores_codigo',
    'DROP INDEX ix_partidos_local', 'DROP INDEX ix_partidos_visita',
    `CREATE TABLE jugadores_v2 (id TEXT PRIMARY KEY, equipo_id TEXT NOT NULL, persona_id TEXT, nombre TEXT, dorsal INTEGER, activo INTEGER NOT NULL DEFAULT 1)`,
    'INSERT INTO jugadores_v2 SELECT id, equipo_id, persona_id, nombre, dorsal, activo FROM jugadores',
    'DROP TABLE jugadores', 'ALTER TABLE jugadores_v2 RENAME TO jugadores',
    'CREATE INDEX ix_jugadores_equipo ON jugadores(equipo_id)',
    "UPDATE meta SET valor = '2' WHERE clave = 'esquema'",
  ]) sql.exec(s).toArray()
}

// Convierte la base de una liga en una de la VERSIÓN 1 (la que ya existe en bases locales): sin columnas de
// expiración en credenciales, sin tablas de códigos, auditoría de acceso ni límites, y con meta esquema = 1.
const aVersionUno = (sql) => {
  aVersionDos(sql)
  for (const s of [
    'DROP TABLE codigos_partido', 'DROP TABLE auditoria_acceso', 'DROP TABLE limite_fuente',
    `CREATE TABLE credenciales_v1 (token_hash TEXT PRIMARY KEY, partido_id TEXT NOT NULL, device_id TEXT NOT NULL, actor_id TEXT, revocada INTEGER NOT NULL DEFAULT 0)`,
    'INSERT INTO credenciales_v1 SELECT token_hash, partido_id, device_id, actor_id, revocada FROM credenciales',
    'DROP TABLE credenciales', 'ALTER TABLE credenciales_v1 RENAME TO credenciales',
    'CREATE UNIQUE INDEX ux_credencial_activa ON credenciales(partido_id) WHERE revocada = 0',
    "UPDATE meta SET valor = '1' WHERE clave = 'esquema'",
  ]) sql.exec(s).toArray()
}
const columnas = (sql, tabla) => sql.exec(`PRAGMA table_info(${tabla})`).toArray().map((c) => c.name)
const tablas = (sql) => sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((t) => t.name)

describe('actualización aditiva del esquema de una liga', () => {
  it('una base de la versión 1 con datos recibe las columnas y tablas nuevas SIN perder ni cambiar nada', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: 1_700_000_001_000 })
    const antes = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionUno(sql)
      expect(columnas(sql, 'credenciales')).not.toContain('expira_en') // de verdad es una base antigua
      expect(tablas(sql)).not.toContain('codigos_partido')
      const dump = (t) => JSON.stringify(sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray())
      return { credenciales: dump('credenciales'), partidos: dump('partidos'), recibos: dump('recibos'), eventos: dump('eventos'), jugadores: dump('jugadores'), bandeja: dump('bandeja') }
    })

    const despues = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      crearEsquema(inst.almacen) // lo que ocurre al abrir el objeto
      crearEsquema(inst.almacen) // y es idempotente
      expect(columnas(sql, 'credenciales')).toEqual(expect.arrayContaining(['expira_en', 'retorno_hasta', 'codigo_id']))
      expect(tablas(sql)).toEqual(expect.arrayContaining(['codigos_partido', 'auditoria_acceso', 'limite_fuente']))
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      const c = sql.exec("SELECT * FROM credenciales WHERE partido_id = 'P'").one()
      expect(c).toMatchObject({ expira_en: null, retorno_hasta: null, codigo_id: null }) // lo existente queda sin expiración
      const dump = (t, cols) => JSON.stringify(sql.exec(`SELECT ${cols} FROM ${t} ORDER BY 1, 2`).toArray())
      return {
        credenciales: dump('credenciales', 'token_hash, partido_id, device_id, actor_id, revocada'),
        partidos: dump('partidos', 'id, liga_id, local_id, visita_id, estado_json, rev, ultimo_client_seq, version_bloqueo, version_autorizacion, bloqueo_json'), recibos: dump('recibos', '*'), eventos: dump('eventos', '*'), jugadores: dump('jugadores', 'id, equipo_id, persona_id, nombre, dorsal, activo'), bandeja: dump('bandeja', '*'),
      }
    })
    expect(despues.partidos).toBe(antes.partidos)
    expect(despues.recibos).toBe(antes.recibos)
    expect(despues.eventos).toBe(antes.eventos)
    expect(despues.jugadores).toBe(antes.jugadores)
    expect(despues.bandeja).toBe(antes.bandeja)
    expect(JSON.parse(despues.credenciales)).toEqual(JSON.parse(antes.credenciales).map((c) => ({ token_hash: c.token_hash, partido_id: c.partido_id, device_id: c.device_id, actor_id: c.actor_id, revocada: c.revocada })))

    // y lo ya guardado sigue funcionando con el código nuevo: la credencial sembrada procesa comandos
    const r = await P.mandar('arrancar-reloj', {}, { t: 1_700_000_002_000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    expect((await conteos(ligaId, 'P')).recibos).toBe(2)
  })

  it('si una migración falla a mitad, se deshace entera y la versión no cambia', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionUno(sql)
      sql.exec('ALTER TABLE credenciales ADD COLUMN retorno_hasta INTEGER').toArray() // la segunda sentencia de la migración chocará
      expect(() => crearEsquema(inst.almacen)).toThrow()
      expect(columnas(sql, 'credenciales')).not.toContain('expira_en') // la primera sentencia también se deshizo
      expect(tablas(sql)).not.toContain('codigos_partido')
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('1')
    })
  })

  it('una base nueva nace ya en la versión actual', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    const v = await enLiga(ligaId, (inst) => inst.almacen.sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor)
    expect(v).toBe(String(VERSION_ESQUEMA))
    expect(VERSION_ESQUEMA).toBe(9)
  })
})

describe('versión 3: fichas completas y recibos de plantilla', () => {
  const dumpJugadores = (sql) => JSON.stringify(sql.exec('SELECT id, equipo_id, persona_id, nombre, dorsal, activo FROM jugadores ORDER BY id').toArray())

  it('una base de la versión 2 con jugadores recibe las columnas nuevas SIN cambiar ningún valor, ni persona_id', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    const antes = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionDos(sql)
      expect(columnas(sql, 'jugadores')).not.toContain('rev') // de verdad es una base de la versión 2
      expect(tablas(sql)).not.toContain('operaciones_plantilla')
      return dumpJugadores(sql)
    })
    const despues = await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      crearEsquema(inst.almacen)
      crearEsquema(inst.almacen) // idempotente
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      expect(columnas(sql, 'jugadores')).toEqual(expect.arrayContaining(['liga_id', 'nombre_pila', 'apellido1', 'apellido2', 'nombre_camiseta', 'fecha_nacimiento', 'codigo', 'desactivado_en', 'reclamado', 'rev', 'creado_en', 'actualizado_en']))
      expect(tablas(sql)).toEqual(expect.arrayContaining(['operaciones_plantilla', 'auditoria_plantilla']))
      const nuevas = sql.exec('SELECT liga_id, nombre_pila, apellido1, nombre_camiseta, fecha_nacimiento, codigo, reclamado, rev FROM jugadores').toArray()
      expect(nuevas.length).toBeGreaterThan(0)
      for (const f of nuevas) expect(f).toEqual({ liga_id: ligaId, nombre_pila: null, apellido1: null, nombre_camiseta: null, fecha_nacimiento: null, codigo: null, reclamado: 0, rev: 1 })
      return dumpJugadores(sql)
    })
    expect(despues).toBe(antes)
    expect(JSON.parse(despues).every((f) => typeof f.persona_id === 'string' && f.persona_id.startsWith('persona-'))).toBe(true)
  })

  it('si la migración 3 falla a mitad, se deshace entera y la versión sigue en 2', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    await enLiga(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionDos(sql)
      sql.exec('ALTER TABLE jugadores ADD COLUMN apellido1 TEXT').toArray() // la tercera sentencia chocará
      expect(() => crearEsquema(inst.almacen)).toThrow()
      expect(columnas(sql, 'jugadores')).not.toContain('liga_id')
      expect(tablas(sql)).not.toContain('operaciones_plantilla')
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('2')
    })
  })
})

describe('esquema del objeto de acceso', () => {
  it('es idempotente y conserva las filas existentes', async () => {
    await accesoStub().desactivarOrganizador()
    const antes = await enAcceso((inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM auditoria_acceso').one().n)
    await enAcceso((inst) => { crearEsquemaAcceso(inst.almacen); crearEsquemaAcceso(inst.almacen) })
    const despues = await enAcceso((inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM auditoria_acceso').one().n)
    expect(despues).toBe(antes)
  })
})
