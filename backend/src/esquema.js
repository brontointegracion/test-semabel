import { TABLAS_LIMITES } from './acceso/limites.js'

// ---------------------------------------------------------------------------
// Esquema SQLite de una liga (un Durable Object por liga).
//
// Todo lo que decide un inicio de partido o una anotación vive aquí, en la misma
// frontera de consistencia: plantillas, partidos, eventos, recibos, cursores,
// versiones de autorización y bloqueo, y la bandeja de publicación pendiente.
//
// `persona_id` es una referencia opaca a una persona GLOBAL: aquí nunca es única
// ni clave dentro de la liga. La liga guarda la ficha (jugadores), no a la persona.
// Las credenciales se guardan como hash SHA-256, nunca el token.
// ---------------------------------------------------------------------------

// Versión 1: el esquema original. Versión 2: acceso por códigos (códigos de partido, expiración de credenciales).
// Versión 3: fichas completas (nombre en partes, nombre en camiseta, fecha de nacimiento, código, revisión), recibos de
// operaciones de plantilla por organizador y auditoría de plantilla.
// Versión 4: metadatos públicos mínimos: categoría y subcategoría de la liga, hora PROGRAMADA del partido (separada de
// `partido.inicio`, que al iniciar el partido pasa a ser la hora real de inicio) y sede de cada partido.
// Versión 5: `resumen_partido` (ver resumen-publico.js). La migración SOLO crea la tabla (esquema obligatorio); llenarla es
// una reparación aparte, acotada y recuperable que se hace al arrancar (liga-do.js): su fallo no impide abrir el objeto.
// Los cambios se hacen con MIGRACIONES ADITIVAS: `CREATE TABLE IF NOT EXISTS` no añade columnas a una tabla que
// ya existe, así que una base creada con la versión 1 recibe los ALTER TABLE al abrirse.
// Versión 6: `cargas` (ver carga.js): identidad durable de las cargas de estructura y de partidos del operador, con la huella del
// contenido normalizado y el resultado devuelto, para que un reintento exacto sea un éxito sin escrituras y un contenido
// distinto con el mismo identificador sea un conflicto. La migración SOLO crea la tabla (aditiva): ninguna fila existente cambia.
// Versión 7 (REPORT_175): `resumen_partido` recibe las faltas del periodo visible por lado (columnas aditivas con 0 por omisión; los
// resúmenes existentes dejan de servirse por su versión de proyección y la reparación los reconstruye). Nada se borra.
export const VERSION_ESQUEMA = 7

const DDL = [
  `CREATE TABLE IF NOT EXISTS meta (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ligas (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    deporte TEXT NOT NULL,
    minutos_por_periodo INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS equipos (
    id TEXT PRIMARY KEY,
    liga_id TEXT NOT NULL,
    nombre TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jugadores (
    id TEXT PRIMARY KEY,
    equipo_id TEXT NOT NULL,
    persona_id TEXT,
    nombre TEXT,
    dorsal INTEGER,
    activo INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS ix_jugadores_equipo ON jugadores(equipo_id)`,
  `CREATE TABLE IF NOT EXISTS partidos (
    id TEXT PRIMARY KEY,
    liga_id TEXT NOT NULL,
    local_id TEXT,
    visita_id TEXT,
    estado_json TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0,
    ultimo_client_seq INTEGER NOT NULL DEFAULT 0,
    version_bloqueo INTEGER NOT NULL DEFAULT 0,
    version_autorizacion INTEGER NOT NULL DEFAULT 0,
    bloqueo_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS eventos (
    partido_id TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (partido_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS ix_eventos_seq ON eventos(partido_id, seq)`,
  `CREATE TABLE IF NOT EXISTS auditoria_reloj (
    partido_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (partido_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS recibos (
    partido_id TEXT NOT NULL,
    cmd_id TEXT NOT NULL,
    client_seq INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (partido_id, cmd_id),
    UNIQUE (partido_id, client_seq)
  )`,
  `CREATE TABLE IF NOT EXISTS credenciales (
    token_hash TEXT PRIMARY KEY,
    partido_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    actor_id TEXT,
    revocada INTEGER NOT NULL DEFAULT 0
  )`,
  // Un solo teléfono con el control activo por partido; no hay traspaso a mitad del partido.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_credencial_activa ON credenciales(partido_id) WHERE revocada = 0`,
  `CREATE TABLE IF NOT EXISTS bandeja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partido_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    cmd_id TEXT NOT NULL,
    mensaje_json TEXT NOT NULL,
    creado_en INTEGER NOT NULL,
    entregado_en INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS cuarentena (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partido_id TEXT NOT NULL,
    sobre_json TEXT NOT NULL,
    recibido_en INTEGER NOT NULL
  )`,
]

// Índices de la plantilla: la consulta de bloqueo busca los partidos de un equipo por local o visita.
const INDICES_PLANTILLA = [
  'CREATE INDEX IF NOT EXISTS ix_jugadores_liga ON jugadores(liga_id)',
  'CREATE INDEX IF NOT EXISTS ix_jugadores_persona ON jugadores(persona_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_jugadores_codigo ON jugadores(codigo) WHERE codigo IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS ix_partidos_local ON partidos(local_id)',
  'CREATE INDEX IF NOT EXISTS ix_partidos_visita ON partidos(visita_id)',
]

// Recibos de operaciones de plantilla: la clave incluye al organizador, de modo que conocer un identificador de
// operación no da acceso a su resultado. `huella` liga el recibo al contenido exacto que se envió.
const TABLAS_PLANTILLA = [
  `CREATE TABLE IF NOT EXISTS operaciones_plantilla (
    organizador_id TEXT NOT NULL,
    operacion_id TEXT NOT NULL,
    liga_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    equipo_id TEXT NOT NULL,
    ficha_id TEXT,
    huella TEXT NOT NULL,
    resultado TEXT NOT NULL,
    resultado_json TEXT NOT NULL,
    sesion_id TEXT,
    creado_en INTEGER NOT NULL,
    PRIMARY KEY (organizador_id, operacion_id)
  )`,
  `CREATE TABLE IF NOT EXISTS auditoria_plantilla (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    ficha_id TEXT NOT NULL,
    equipo_id TEXT NOT NULL,
    liga_id TEXT NOT NULL,
    organizador_id TEXT NOT NULL,
    sesion_id TEXT,
    operacion_id TEXT NOT NULL,
    rev_antes INTEGER,
    rev_despues INTEGER NOT NULL,
    detalle_json TEXT
  )`,
]

// Hora programada heredada: solo de un partido TODAVÍA programado cuyo `inicio` guardado sea un instante ISO válido.
// En un partido vivo o final `inicio` ya pudo ser sobrescrito por la hora real de inicio: no se deduce nada de ahí.
const RE_INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export function programadoHeredado(estadoJson) {
  let e
  try { e = JSON.parse(estadoJson) } catch { return null }
  const p = e?.partido
  if (p?.estado !== 'programado' || typeof p.inicio !== 'string' || !RE_INSTANTE_ISO.test(p.inicio)) return null
  const ms = Date.parse(p.inicio)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function conservarProgramadoHeredado(sql) {
  for (const f of sql.exec('SELECT id, estado_json FROM partidos').toArray()) {
    const programado = programadoHeredado(f.estado_json)
    if (programado !== null) sql.exec('UPDATE partidos SET programado_para = ? WHERE id = ?', programado, f.id)
  }
}

const MIGRACIONES = [
  {
    hasta: 2,
    sentencias: [
      'ALTER TABLE credenciales ADD COLUMN expira_en INTEGER',
      'ALTER TABLE credenciales ADD COLUMN retorno_hasta INTEGER',
      'ALTER TABLE credenciales ADD COLUMN codigo_id TEXT',
      `CREATE TABLE IF NOT EXISTS codigos_partido (
        id TEXT NOT NULL,
        partido_id TEXT NOT NULL,
        secreto_hash TEXT NOT NULL,
        creado_en INTEGER NOT NULL,
        expira_en INTEGER NOT NULL,
        creado_por TEXT,
        revocado_en INTEGER,
        fallos INTEGER NOT NULL DEFAULT 0,
        bloqueos INTEGER NOT NULL DEFAULT 0,
        bloqueado_hasta INTEGER,
        consumido_en INTEGER,
        token_hash TEXT,
        device_id TEXT,
        PRIMARY KEY (partido_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS auditoria_acceso (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        partido_id TEXT,
        organizador_id TEXT,
        sesion_id TEXT,
        detalle TEXT
      )`,
      ...TABLAS_LIMITES,
    ],
  },
  {
    hasta: 3,
    sentencias: [
      // Solo columnas nuevas: las filas existentes conservan todos sus valores (y su persona_id, que nunca cambia).
      'ALTER TABLE jugadores ADD COLUMN liga_id TEXT',
      'ALTER TABLE jugadores ADD COLUMN nombre_pila TEXT',
      'ALTER TABLE jugadores ADD COLUMN apellido1 TEXT',
      'ALTER TABLE jugadores ADD COLUMN apellido2 TEXT',
      'ALTER TABLE jugadores ADD COLUMN nombre_camiseta TEXT',
      'ALTER TABLE jugadores ADD COLUMN fecha_nacimiento TEXT',
      'ALTER TABLE jugadores ADD COLUMN codigo TEXT',
      'ALTER TABLE jugadores ADD COLUMN desactivado_en INTEGER',
      'ALTER TABLE jugadores ADD COLUMN reclamado INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE jugadores ADD COLUMN rev INTEGER NOT NULL DEFAULT 1',
      'ALTER TABLE jugadores ADD COLUMN creado_en INTEGER',
      'ALTER TABLE jugadores ADD COLUMN actualizado_en INTEGER',
      // La liga de una ficha se deduce de su equipo (las filas anteriores no la guardaban).
      'UPDATE jugadores SET liga_id = (SELECT e.liga_id FROM equipos e WHERE e.id = jugadores.equipo_id) WHERE liga_id IS NULL',
      ...INDICES_PLANTILLA,
      ...TABLAS_PLANTILLA,
    ],
  },
  {
    hasta: 4,
    // Solo columnas nulas nuevas: ninguna fila existente cambia, y lo desconocido queda NULL (nunca se inventa).
    sentencias: [
      'ALTER TABLE ligas ADD COLUMN categoria TEXT',
      'ALTER TABLE ligas ADD COLUMN subcategoria_json TEXT',
      'ALTER TABLE partidos ADD COLUMN programado_para TEXT',
      'ALTER TABLE partidos ADD COLUMN sede TEXT',
    ],
    datos: conservarProgramadoHeredado,
  },
  {
    hasta: 5,
    sentencias: [
      `CREATE TABLE IF NOT EXISTS resumen_partido (
        partido_id TEXT PRIMARY KEY,
        local_id TEXT,
        visita_id TEXT,
        local_puntos INTEGER NOT NULL,
        visita_puntos INTEGER NOT NULL,
        local_faltas INTEGER NOT NULL,
        visita_faltas INTEGER NOT NULL,
        periodo INTEGER NOT NULL,
        rev_fuente INTEGER NOT NULL,
        version_proyeccion INTEGER NOT NULL
      )`,
    ],
  },
  {
    hasta: 6,
    sentencias: [
      `CREATE TABLE IF NOT EXISTS cargas (
        carga_id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        huella TEXT NOT NULL,
        resultado_json TEXT NOT NULL,
        creado_en INTEGER NOT NULL
      )`,
    ],
  },
  {
    hasta: 7,
    sentencias: [],
    // ADD COLUMN no tiene «IF NOT EXISTS»: se añade solo la columna que falta, así repetir la migración no falla.
    datos: (sql) => {
      const columnas = new Set(sql.exec("SELECT name FROM pragma_table_info('resumen_partido')").toArray().map((c) => c.name))
      for (const c of ['local_faltas_periodo', 'visita_faltas_periodo']) {
        if (!columnas.has(c)) sql.exec(`ALTER TABLE resumen_partido ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`)
      }
    },
  },
]

/**
 * Crea lo que falta y aplica las migraciones pendientes en UNA transacción sincrónica: o queda todo en la versión
 * nueva o no cambia nada. Idempotente. No toca filas existentes (las credenciales sembradas quedan sin expiración).
 */
export function crearEsquema(storage) {
  storage.transactionSync(() => {
    const sql = storage.sql
    for (const sentencia of DDL) sql.exec(sentencia)
    sql.exec("INSERT OR IGNORE INTO meta (clave, valor) VALUES ('esquema', '1')")
    let version = Number(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor)
    for (const m of MIGRACIONES) {
      if (version >= m.hasta) continue
      for (const sentencia of m.sentencias) sql.exec(sentencia)
      if (m.datos) m.datos(sql)
      version = m.hasta
      sql.exec("UPDATE meta SET valor = ? WHERE clave = 'esquema'", String(version))
    }
    // Aditivo e idempotente en cada arranque: también para bases que ya estaban en la versión 2 sin este índice.
    for (const sentencia of TABLAS_LIMITES) sql.exec(sentencia)
  })
}
