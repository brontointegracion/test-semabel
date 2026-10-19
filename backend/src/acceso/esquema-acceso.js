import { TABLAS_LIMITES } from './limites.js'

// Esquema del objeto de acceso (uno solo para el piloto). Solo hashes de secretos; nunca un código, una cookie
// ni un token en claro. Las versiones se aplican con migraciones aditivas (ver crearEsquemaAcceso).

export const VERSION_ESQUEMA_ACCESO = 1

const DDL = [
  `CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS organizadores (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS propiedad (
    organizador_id TEXT NOT NULL,
    liga_id TEXT NOT NULL,
    PRIMARY KEY (organizador_id, liga_id)
  )`,
  `CREATE TABLE IF NOT EXISTS codigos_organizador (
    id TEXT PRIMARY KEY,
    organizador_id TEXT NOT NULL,
    secreto_hash TEXT NOT NULL,
    creado_en INTEGER NOT NULL,
    expira_en INTEGER NOT NULL,
    revocado_en INTEGER,
    fallos INTEGER NOT NULL DEFAULT 0,
    bloqueos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta INTEGER,
    usos INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    secreto_hash TEXT NOT NULL,
    organizador_id TEXT NOT NULL,
    codigo_id TEXT NOT NULL,
    creada_en INTEGER NOT NULL,
    ultimo_uso INTEGER NOT NULL,
    expira_idle INTEGER NOT NULL,
    expira_abs INTEGER NOT NULL,
    revocada_en INTEGER,
    motivo TEXT
  )`,
  // Recibos de las asignaciones de ligas del operador (REPORT_187). ADITIVA: solo se crea si falta; un código anterior la ignora.
  `CREATE TABLE IF NOT EXISTS asignaciones_liga (
    operacion_id TEXT PRIMARY KEY,
    huella TEXT NOT NULL,
    resultado_json TEXT NOT NULL,
    creado_en INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auditoria_acceso (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    organizador_id TEXT,
    sesion_id TEXT,
    detalle TEXT
  )`,
  ...TABLAS_LIMITES,
]

/** Crea lo que falta. Idempotente: se puede llamar en cada arranque sin tocar los datos existentes. */
export function crearEsquemaAcceso(storage) {
  storage.transactionSync(() => {
    for (const s of DDL) storage.sql.exec(s)
    storage.sql.exec("INSERT OR IGNORE INTO meta (clave, valor) VALUES ('esquema', ?)", String(VERSION_ESQUEMA_ACCESO))
  })
}
