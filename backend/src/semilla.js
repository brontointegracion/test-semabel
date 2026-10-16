import { crearEstado } from '../../src/lib/motor/estado.js'
import { nombreCompleto } from '../../src/lib/identidad.js'
import { resolverClasificacion } from '../../src/lib/categorias.js'
import { sha256Hex } from './credenciales.js'
import { escribirResumen, resumirPartido } from './resumen-publico.js'

// ---------------------------------------------------------------------------
// Carga de datos SINTÉTICOS de una liga. Solo se alcanza desde la ruta de siembra, que está
// desactivada por defecto (ver worker.js). No es la carga de plantillas reales: esa es una
// etapa posterior con vista previa, validación y autorización propias.
//
// Se rechaza si la liga ya fue sembrada: nunca sobrescribe.
//
// Los campos opcionales de ficha (nombrePila, apellido1, apellido2, nombreCamiseta, fechaNacimiento, codigo) existen
// SOLO para que las pruebas sintéticas ejerciten la plantilla. No definen ni autorizan un procedimiento de carga de
// datos reales: esa carga (con vista previa, validación, autorización y el mapa revisado de personas compartidas)
// es una tarea posterior. Aquí no se aplican las reglas de plantilla a propósito: las pruebas necesitan fichas
// "anteriores" sin número o sin partes de nombre.
// ---------------------------------------------------------------------------

const esId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200
const esTextoCorto = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200

const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
export const esSede = (v) => typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= 80 && !CONTROL.test(v)

/** Instante programado explícito → ISO UTC normalizado, o null si no es válido. Solo ISO con zona o milisegundos enteros. */
export function normalizarProgramado(v) {
  const ms = typeof v === 'number' ? v : (typeof v === 'string' && RE_ISO.test(v) ? Date.parse(v) : NaN)
  return Number.isSafeInteger(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null
}

/**
 * Crea UN partido programado con la creación canónica de estado del motor y su resumen público (0-0, periodo 1) derivado
 * por la MISMA función que usa el commit. Sincrónico: se llama dentro de una transactionSync. `programadoPara` ya viene
 * normalizado (ISO UTC o null). Lo usan la siembra sintética y la carga de partidos del operador (carga.js).
 */
export function insertarPartidoProgramado(sql, { ligaId, deporte, minutosPorPeriodo, id, localId, visitaId, inicio = null, programadoPara = null, sede = null }) {
  const estado = crearEstado({
    gameId: id,
    config: { deporte, minutosPorPeriodo: minutosPorPeriodo ?? null },
    partido: { estado: 'programado', inicio },
  })
  sql.exec(
    'INSERT INTO partidos (id, liga_id, local_id, visita_id, estado_json, rev, programado_para, sede) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    id, ligaId, localId, visitaId,
    JSON.stringify({ auditSeq: estado.auditSeq, corridaSeq: estado.corridaSeq, cursorReloj: estado.cursorReloj, config: estado.config, partido: estado.partido }),
    programadoPara, sede,
  )
  // Partido sin eventos: su resumen (0-0, periodo 1) sale de la MISMA derivación, en la misma transacción.
  escribirResumen(sql, id, resumirPartido({ eventos: [], localId, visitaId, deporte }), 0)
}

function validar(p) {
  const e = []
  const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!objeto(p)) return ['payload']
  if (!objeto(p.liga) || !esId(p.liga.id) || !esTextoCorto(p.liga.nombre) || !esTextoCorto(p.liga.deporte)) e.push('liga')
  if (objeto(p.liga) && p.liga.minutosPorPeriodo !== undefined && p.liga.minutosPorPeriodo !== null
    && !(Number.isInteger(p.liga.minutosPorPeriodo) && p.liga.minutosPorPeriodo > 0)) e.push('liga.minutosPorPeriodo')
  if (objeto(p.liga) && (p.liga.categoria !== undefined || p.liga.subcategoria !== undefined)
    && !resolverClasificacion({ deporte: p.liga.deporte, categoria: p.liga.categoria, subcategoria: p.liga.subcategoria }).ok) e.push('liga.categoria')
  const lista = (k) => (Array.isArray(p[k]) && p[k].length <= 500 ? p[k] : (e.push(k), []))
  const equipos = lista('equipos')
  const jugadores = lista('jugadores')
  const partidos = lista('partidos')
  const credenciales = lista('credenciales')
  const ids = (xs, k) => {
    const vistos = new Set()
    for (const x of xs) {
      if (!objeto(x) || !esId(x.id) || vistos.has(x.id)) { e.push(`${k}.id`); break }
      vistos.add(x.id)
    }
    return vistos
  }
  const idsEquipos = ids(equipos, 'equipos')
  ids(jugadores, 'jugadores')
  const idsPartidos = ids(partidos, 'partidos')
  for (const x of equipos) if (objeto(x) && !esTextoCorto(x.nombre)) e.push('equipos.nombre')
  for (const j of jugadores) {
    if (!objeto(j)) continue
    if (!idsEquipos.has(j.equipoId)) e.push('jugadores.equipoId')
    if (!(j.dorsal === null || j.dorsal === undefined || (Number.isInteger(j.dorsal) && j.dorsal >= 0 && j.dorsal <= 99))) e.push('jugadores.dorsal')
    if (j.activo !== undefined && typeof j.activo !== 'boolean') e.push('jugadores.activo')
    if (j.personaId !== undefined && j.personaId !== null && !esId(j.personaId)) e.push('jugadores.personaId')
    for (const k of ['nombrePila', 'apellido1', 'apellido2', 'nombreCamiseta', 'fechaNacimiento', 'codigo']) {
      if (j[k] !== undefined && j[k] !== null && !(typeof j[k] === 'string' && j[k].length <= 200)) e.push(`jugadores.${k}`)
    }
  }
  for (const x of partidos) {
    if (!objeto(x)) continue
    if (!idsEquipos.has(x.localId) || !idsEquipos.has(x.visitaId)) e.push('partidos.equipos')
    if (x.programadoPara !== undefined && x.programadoPara !== null && normalizarProgramado(x.programadoPara) === null) e.push('partidos.programadoPara')
    if (x.sede !== undefined && x.sede !== null && !esSede(x.sede)) e.push('partidos.sede')
  }
  const tokens = new Set()
  const juegosConCredencial = new Set()
  for (const c of credenciales) {
    if (!objeto(c) || typeof c.token !== 'string' || c.token.length < 16 || c.token.length > 256 || tokens.has(c.token)) { e.push('credenciales.token'); continue }
    tokens.add(c.token)
    if (!idsPartidos.has(c.partidoId) || !esId(c.deviceId) || juegosConCredencial.has(c.partidoId)) e.push('credenciales.partido')
    juegosConCredencial.add(c.partidoId)
  }
  return [...new Set(e)]
}

/** → { ok: true } | { ok: false, errores } | { ok: false, yaSembrada: true } */
export async function sembrarLiga(storage, payload) {
  const errores = validar(payload)
  if (errores.length) return { ok: false, errores }
  // El hash es asíncrono: se calcula ANTES de abrir la transacción sincrónica.
  const hashes = await Promise.all((payload.credenciales ?? []).map((c) => sha256Hex(c.token)))

  return storage.transactionSync(() => {
    const sql = storage.sql
    if (sql.exec("SELECT 1 AS x FROM meta WHERE clave = 'sembrada'").toArray().length) return { ok: false, yaSembrada: true }
    const { liga } = payload
    const clasificacion = liga.categoria === undefined && liga.subcategoria === undefined
      ? null
      : resolverClasificacion({ deporte: liga.deporte, categoria: liga.categoria, subcategoria: liga.subcategoria })
    sql.exec(
      'INSERT INTO ligas (id, nombre, deporte, minutos_por_periodo, categoria, subcategoria_json) VALUES (?, ?, ?, ?, ?, ?)',
      liga.id, liga.nombre, liga.deporte, liga.minutosPorPeriodo ?? null,
      clasificacion?.categoria ?? null, clasificacion?.subcategoria === undefined ? null : JSON.stringify(clasificacion.subcategoria),
    )
    for (const e of payload.equipos) sql.exec('INSERT INTO equipos (id, liga_id, nombre) VALUES (?, ?, ?)', e.id, liga.id, e.nombre)
    for (const j of payload.jugadores) {
      const nombre = j.nombre ?? (j.nombrePila ? nombreCompleto(j.nombrePila, j.apellido1, j.apellido2) : null)
      sql.exec(
        `INSERT INTO jugadores (id, equipo_id, persona_id, nombre, dorsal, activo, liga_id, nombre_pila, apellido1, apellido2,
           nombre_camiseta, fecha_nacimiento, codigo, desactivado_en, reclamado, rev)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
        j.id, j.equipoId, j.personaId ?? null, nombre, j.dorsal ?? null, j.activo === false ? 0 : 1, liga.id,
        j.nombrePila ?? null, j.apellido1 ?? null, j.apellido2 ?? null, j.nombreCamiseta ?? null, j.fechaNacimiento ?? null,
        j.codigo ?? null, null,
      )
    }
    for (const p of payload.partidos) {
      insertarPartidoProgramado(sql, {
        ligaId: liga.id, deporte: liga.deporte, minutosPorPeriodo: liga.minutosPorPeriodo ?? null,
        id: p.id, localId: p.localId, visitaId: p.visitaId, inicio: p.inicio ?? null,
        programadoPara: normalizarProgramado(p.programadoPara), sede: p.sede ?? null,
      })
    }
    payload.credenciales.forEach((c, i) => {
      sql.exec('INSERT INTO credenciales (token_hash, partido_id, device_id, actor_id, revocada) VALUES (?, ?, ?, ?, 0)', hashes[i], c.partidoId, c.deviceId, c.actorId ?? null)
      sql.exec('UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = ?', c.partidoId)
    })
    sql.exec("INSERT INTO meta (clave, valor) VALUES ('sembrada', '1')")
    return { ok: true }
  })
}
