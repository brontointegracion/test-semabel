// ---------------------------------------------------------------------------
// RESPALDO SOLO LECTURA de un objeto Durable Object (precursor de respaldo; REPORT_246). Nada aquí escribe: lee `sqlite_master` y cada tabla en UNA sola pasada
// SINCRÓNICA (sin `await` entre lecturas, dentro de `transactionSync`), así que el contenido de UN objeto es una instantánea coherente. No hay atomicidad entre objetos
// distintos ni entre la exportación y un marcador de recuperación (PITR): son evidencias separadas.
//
// FORMATO `sebel-respaldo-sql` v1 (JSON): { formato, version, clase, objeto, versionEsquema, bytesBase, capturadoEnMs, esquema:[{tipo,nombre,tabla,sql}],
//   tablas:[{ nombre, columnas, conRowid, filas, sha256, datos:[[rowid?, v…]] }], sha256 }.
// Valores SIN pérdida: NULL → null; INTEGER → número entero seguro (otro entero se rechaza); REAL → {"r":"<texto>"} (distingue 1.0 de 1 y conserva -0, Infinity); TEXT → cadena;
// BLOB → {"b":"<base64>"}. El tipo sale de `typeof()` de SQLite, no de JavaScript. Los identificadores se citan con comillas dobles y se validan.
//
// ESTADO NO SOPORTADO = FALLO EXPLÍCITO (nunca se omite): tabla/vista/tabla virtual desconocida, entradas de la API KV, alarma programada, entero fuera de rango seguro,
// tipo desconocido, tabla sin rowid, base o respuesta por encima del tope (no se trunca nada).
// ---------------------------------------------------------------------------

export const FORMATO_RESPALDO = 'sebel-respaldo-sql'
export const VERSION_FORMATO = 1
export const LIMITE_BYTES_BASE = 16 * 1024 * 1024 // tamaño de la base (databaseSize)
export const LIMITE_BYTES_RESPALDO = 48 * 1024 * 1024 // tamaño del texto del respaldo

export const TABLAS_CONOCIDAS = Object.freeze({
  LigaDO: ['auditoria_acceso', 'auditoria_plantilla', 'auditoria_reloj', 'bandeja', 'cargas', 'codigos_partido', 'credenciales', 'cuarentena', 'equipos', 'eventos', 'jugadores', 'ligas', 'limite_fuente', 'meta', 'operaciones_plantilla', 'partidos', 'recibos', 'resumen_partido'],
  AccesoDO: ['asignaciones_liga', 'auditoria_acceso', 'codigos_organizador', 'limite_fuente', 'meta', 'organizadores', 'propiedad', 'sesiones'],
})

export class RespaldoNoSoportado extends Error {
  constructor(codigo, detalle) { super(codigo); this.name = 'RespaldoNoSoportado'; this.codigo = codigo; this.detalle = detalle ?? null }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const interno = (n) => /^_cf_/i.test(n) || /^__cf_kv$/i.test(n) || /^__miniflare_/i.test(n) // tablas de la PLATAFORMA (producción: `_cf_*`; desarrollo local: también `__miniflare_*`); no son datos de la aplicación
export const citar = (nombre) => {
  if (typeof nombre !== 'string' || !IDENT.test(nombre)) throw new RespaldoNoSoportado('identificador-no-valido', String(nombre).slice(0, 40))
  return `"${nombre.replaceAll('"', '""')}"`
}

const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (texto) => aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))

const aBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }
export const deBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0))

/** Valor de SQLite + su `typeof()` → valor JSON sin pérdida. */
export function codificar(tipo, valor) {
  switch (tipo) {
    case 'null': return null
    case 'integer':
      if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) throw new RespaldoNoSoportado('entero-fuera-de-rango')
      return valor
    case 'real':
      if (typeof valor !== 'number' || Number.isNaN(valor)) throw new RespaldoNoSoportado('real-no-valido')
      return { r: Object.is(valor, -0) ? '-0' : String(valor) }
    case 'text':
      if (typeof valor !== 'string') throw new RespaldoNoSoportado('texto-no-valido')
      return valor
    case 'blob': {
      const bytes = valor instanceof ArrayBuffer ? new Uint8Array(valor) : ArrayBuffer.isView(valor) ? new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength) : null
      if (!bytes) throw new RespaldoNoSoportado('blob-no-valido')
      return { b: aBase64(bytes) }
    }
    default: throw new RespaldoNoSoportado('tipo-desconocido', String(tipo).slice(0, 20))
  }
}

/** Inverso de `codificar` → { marcador, valor }: el fragmento SQL del parámetro (un REAL se fuerza con CAST para no volverse INTEGER) y el valor a enlazar. */
export function decodificar(v) {
  if (v === null) return { marcador: '?', valor: null }
  if (typeof v === 'string') return { marcador: '?', valor: v }
  // Un número JavaScript se enlaza como REAL: el entero se fuerza con CAST para que no quede como 7.0 en una columna sin afinidad.
  if (typeof v === 'number') { if (!Number.isSafeInteger(v)) throw new RespaldoNoSoportado('entero-fuera-de-rango'); return { marcador: 'CAST(? AS INTEGER)', valor: v } }
  if (v && typeof v === 'object' && Object.keys(v).length === 1) {
    if (typeof v.r === 'string') { const n = v.r === '-0' ? -0 : Number(v.r); if (Number.isNaN(n)) throw new RespaldoNoSoportado('real-no-valido'); return { marcador: 'CAST(? AS REAL)', valor: n } }
    if (typeof v.b === 'string') return { marcador: '?', valor: deBase64(v.b).buffer }
  }
  throw new RespaldoNoSoportado('valor-no-valido')
}

/**
 * ¿La API KV tiene entradas? (el código no la usa: cualquiera es estado no soportado). Devuelve false si la plataforma no la ofrece.
 */
function hayEntradasKv(storage) {
  const kv = storage.kv
  if (!kv || typeof kv.list !== 'function') return false
  for (const _ of kv.list({ limit: 1 })) return true // eslint-disable-line no-unused-vars
  return false
}

/**
 * Lectura SINCRÓNICA de todo el objeto → objeto de respaldo SIN sha256 (se calculan después, con `sellar`).
 * `opciones`: { clase, objeto, ahora, tablasPermitidas?, limiteBytesBase?, limiteBytesRespaldo? }
 */
export function leerBase(storage, { clase, objeto, ahora, tablasPermitidas, limiteBytesBase = LIMITE_BYTES_BASE, limiteBytesRespaldo = LIMITE_BYTES_RESPALDO }) {
  const permitidas = new Set(tablasPermitidas ?? TABLAS_CONOCIDAS[clase] ?? [])
  if (!permitidas.size) throw new RespaldoNoSoportado('clase-desconocida')
  return storage.transactionSync(() => {
    const sql = storage.sql
    const bytesBase = sql.databaseSize
    if (typeof bytesBase !== 'number' || bytesBase > limiteBytesBase) throw new RespaldoNoSoportado('respaldo-demasiado-grande', 'base')
    if (hayEntradasKv(storage)) throw new RespaldoNoSoportado('kv-no-soportado')
    const maestro = sql.exec('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').toArray()
    const esquema = []
    const tablas = []
    const internas = [] // tablas de la plataforma que NO se exportan (se nombran, no se omiten en silencio)
    for (const f of maestro) {
      if (typeof f.name !== 'string') throw new RespaldoNoSoportado('maestro-no-valido')
      if (f.type === 'table') {
        if (interno(f.name)) { internas.push(f.name); continue }
        if (f.name === 'sqlite_sequence') continue // se exporta aparte, con sus filas
        if (!permitidas.has(f.name)) throw new RespaldoNoSoportado('tabla-no-reconocida', f.name.slice(0, 40))
        if (/^\s*CREATE\s+VIRTUAL/i.test(f.sql ?? '')) throw new RespaldoNoSoportado('tabla-virtual-no-soportada', f.name.slice(0, 40))
        if (/WITHOUT\s+ROWID/i.test(f.sql ?? '')) throw new RespaldoNoSoportado('tabla-sin-rowid-no-soportada', f.name.slice(0, 40))
        esquema.push({ tipo: 'table', nombre: f.name, tabla: f.tbl_name, sql: f.sql })
        tablas.push(f.name)
      } else if (f.type === 'index' || f.type === 'trigger') {
        if (interno(f.name) || interno(f.tbl_name)) continue
        esquema.push({ tipo: f.type, nombre: f.name, tabla: f.tbl_name, sql: f.sql ?? null })
      } else if (f.type === 'view') throw new RespaldoNoSoportado('vista-no-soportada', f.name.slice(0, 40))
      else throw new RespaldoNoSoportado('objeto-desconocido', String(f.type).slice(0, 20))
    }
    const hayAutoincremento = maestro.some((f) => f.type === 'table' && f.name === 'sqlite_sequence')
    const salida = []
    let bytes = 0
    const leerTabla = (nombre, { rowid }) => {
      const q = citar(nombre)
      const cabeza = sql.exec(`SELECT * FROM ${q} LIMIT 0`)
      const columnas = [...cabeza.columnNames]
      cabeza.toArray()
      for (const c of columnas) citar(c)
      const lista = columnas.map((c) => `typeof(${citar(c)}), ${citar(c)}`).join(', ')
      const cursor = sql.exec(`SELECT ${rowid ? 'rowid, ' : ''}${lista} FROM ${q} ${rowid ? 'ORDER BY rowid' : 'ORDER BY name'}`)
      const datos = []
      for (const fila of cursor.raw()) {
        let i = 0
        const salidaFila = []
        if (rowid) { if (!Number.isSafeInteger(fila[0])) throw new RespaldoNoSoportado('rowid-fuera-de-rango'); salidaFila.push(fila[0]); i = 1 }
        for (let c = 0; c < columnas.length; c += 1, i += 2) salidaFila.push(codificar(fila[i], fila[i + 1]))
        bytes += JSON.stringify(salidaFila).length + 1
        if (bytes > limiteBytesRespaldo) throw new RespaldoNoSoportado('respaldo-demasiado-grande', 'texto')
        datos.push(salidaFila)
      }
      return { nombre, columnas, conRowid: rowid, filas: datos.length, datos }
    }
    for (const nombre of tablas) salida.push(leerTabla(nombre, { rowid: true }))
    if (hayAutoincremento) {
      const t = leerTabla('sqlite_sequence', { rowid: true })
      salida.push({ ...t, nombre: 'sqlite_sequence' })
    }
    const meta = sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").toArray()[0]
    const versionEsquema = meta ? Number(meta.valor) : null
    if (!Number.isSafeInteger(versionEsquema)) throw new RespaldoNoSoportado('version-de-esquema-ilegible')
    return { formato: FORMATO_RESPALDO, version: VERSION_FORMATO, clase, objeto, versionEsquema, bytesBase, capturadoEnMs: ahora, internasDeLaPlataforma: internas.sort(), esquema, tablas: salida }
  })
}

const contenidoDeTabla = (t) => JSON.stringify({ nombre: t.nombre, columnas: t.columnas, conRowid: t.conRowid, datos: t.datos })

/** Añade los SHA-256 (por tabla y del conjunto). El conjunto cubre clase, versión, esquema y los hashes de tabla; NO la hora de captura (dos lecturas iguales dan el mismo hash). */
export async function sellar(respaldo) {
  const tablas = []
  for (const t of respaldo.tablas) tablas.push({ ...t, sha256: await sha256Hex(contenidoDeTabla(t)) })
  const cuerpo = { ...respaldo, tablas }
  return { ...cuerpo, sha256: await sha256Hex(resumenParaSello(cuerpo)) }
}
const resumenParaSello = (r) => JSON.stringify({ formato: r.formato, version: r.version, clase: r.clase, objeto: r.objeto, versionEsquema: r.versionEsquema, esquema: r.esquema, tablas: r.tablas.map((t) => [t.nombre, t.filas, t.sha256]) })

/** Recalcula y compara todos los sellos de un respaldo (para verificar un archivo). → { ok, errores:[…] } */
export async function verificarSellos(r) {
  const errores = []
  if (!r || r.formato !== FORMATO_RESPALDO || r.version !== VERSION_FORMATO) return { ok: false, errores: ['formato'] }
  if (!Array.isArray(r.tablas) || !Array.isArray(r.esquema)) return { ok: false, errores: ['estructura'] }
  for (const t of r.tablas) {
    if (!Array.isArray(t.datos) || t.filas !== t.datos.length) errores.push(`filas:${t.nombre}`)
    else if (await sha256Hex(contenidoDeTabla(t)) !== t.sha256) errores.push(`sha256:${t.nombre}`)
  }
  if (!errores.length && await sha256Hex(resumenParaSello(r)) !== r.sha256) errores.push('sha256:conjunto')
  return { ok: errores.length === 0, errores }
}

/**
 * Exportación completa de un objeto: alarma (única lectura asíncrona, ANTES de la pasada sincrónica) + lectura sincrónica + sellos. Lanza RespaldoNoSoportado.
 */
export async function exportarObjeto(storage, opciones) {
  if (typeof storage.getAlarm === 'function' && (await storage.getAlarm()) !== null) throw new RespaldoNoSoportado('alarma-programada')
  return sellar(leerBase(storage, opciones))
}

/**
 * Marcador de recuperación (PITR) del objeto, SI la plataforma lo ofrece. Nunca se inventa: sin la API (p. ej. en desarrollo local) → { disponible: false }.
 * Es evidencia APARTE de la exportación: se pide en otra llamada y no se afirma que corresponda con ella.
 */
export async function marcadorDeRecuperacion(storage, { ahora }) {
  if (typeof storage.getCurrentBookmark !== 'function') return { disponible: false, motivo: 'api-no-ofrecida', correspondeConExportacion: false }
  try {
    const marcador = await storage.getCurrentBookmark()
    if (typeof marcador !== 'string' || marcador === '') return { disponible: false, motivo: 'respuesta-no-valida', correspondeConExportacion: false }
    // El desarrollo local devuelve un marcador de RELLENO (solo ceros): no es un punto de recuperación real y nunca se presenta como tal.
    if (/^[0-]+$/.test(marcador)) return { disponible: false, motivo: 'marcador-local-de-relleno', correspondeConExportacion: false }
    return { disponible: true, marcador, obtenidoEnMs: ahora, correspondeConExportacion: false }
  } catch {
    return { disponible: false, motivo: 'no-soportado-aqui', correspondeConExportacion: false }
  }
}
