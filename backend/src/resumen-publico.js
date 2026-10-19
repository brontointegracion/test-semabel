import { faltasEquipo, faltasEquipoPeriodo, marcadorEquipo, periodoVisible } from '../../src/lib/marcador-calculo.js'

// ---------------------------------------------------------------------------
// RESUMEN PÚBLICO POR PARTIDO (`resumen_partido`). Es un dato DERIVADO y RECONSTRUIBLE, solo para servir lecturas
// públicas sin recorrer la historia de eventos.
//
//   - La historia (`eventos`), los recibos y el estado del partido siguen siendo la autoridad. El resumen NUNCA es
//     entrada de la validación de una orden y no convierte la aplicación en un sistema de eventos.
//   - Solo guarda lo que se deriva de los eventos: puntos y faltas de PARTIDO COMPLETO por lado, y el periodo visible.
//     Estado, reloj, hora programada, sede, nombres y clasificación se leen de sus fuentes (no se duplican aquí).
//   - Una sola función de derivación (`resumirPartido`) sirve al commit y a la reconstrucción, y usa las mismas
//     cuentas puras del marcador que el resto del sistema.
//   - `rev_fuente` es la revisión del partido de la que salió; `version_proyeccion` cambia cuando cambia esta derivación;
//     `local_id`/`visita_id` son los equipos para los que se calculó. Si algo de eso no coincide con lo vigente, el
//     resumen NO se sirve (ver `resumenValido`): nunca se publica un marcador conocido como viejo.
// ---------------------------------------------------------------------------

// Versión 2 (REPORT_175): añade las faltas del PERIODO visible por lado (`local_faltas_periodo`/`visita_faltas_periodo`). Las faltas de
// partido completo siguen siendo las de siempre. Al cambiar la versión, los resúmenes anteriores se reconstruyen por la reparación.
export const VERSION_PROYECCION = 2

/**
 * Topes de la REPARACIÓN (arranque). Se aplican antes de leer o reservar memoria: más partidos pendientes que `partidos`,
 * o más eventos a leer que `eventos` en total, y no se repara nada más (las lecturas públicas afectadas quedan en 503).
 */
export const LIMITES_REPARACION = Object.freeze({ partidos: 300, eventos: 50_000 })

const entero = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('resumen-invalido')
  return n
}

/**
 * La derivación. `eventos`: lista con al menos { seq, tipo, equipoId, puntos, anulado } (el motor pasa los eventos completos
 * y la reconstrucción solo esas columnas; las cuentas no usan nada más).
 * → { localId, visitaId, localPuntos, visitaPuntos, localFaltas, visitaFaltas, localFaltasPeriodo, visitaFaltasPeriodo, periodo }
 */
export function resumirPartido({ eventos, localId, visitaId, deporte }) {
  return {
    localId: localId ?? null,
    visitaId: visitaId ?? null,
    localPuntos: entero(marcadorEquipo(eventos, localId)),
    visitaPuntos: entero(marcadorEquipo(eventos, visitaId)),
    localFaltas: entero(faltasEquipo(eventos, localId)),
    visitaFaltas: entero(faltasEquipo(eventos, visitaId)),
    localFaltasPeriodo: entero(faltasEquipoPeriodo(eventos, localId, deporte)),
    visitaFaltasPeriodo: entero(faltasEquipoPeriodo(eventos, visitaId, deporte)),
    periodo: entero(periodoVisible(eventos, deporte)),
  }
}

/** Escribe (inserta o reemplaza) el resumen de un partido. Sincrónico: se llama dentro de una transactionSync. */
export function escribirResumen(sql, partidoId, resumen, revFuente) {
  sql.exec(
    `INSERT INTO resumen_partido (partido_id, local_id, visita_id, local_puntos, visita_puntos, local_faltas, visita_faltas,
        periodo, rev_fuente, version_proyeccion, local_faltas_periodo, visita_faltas_periodo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(partido_id) DO UPDATE SET local_id = excluded.local_id, visita_id = excluded.visita_id,
        local_puntos = excluded.local_puntos, visita_puntos = excluded.visita_puntos,
        local_faltas = excluded.local_faltas, visita_faltas = excluded.visita_faltas,
        periodo = excluded.periodo, rev_fuente = excluded.rev_fuente, version_proyeccion = excluded.version_proyeccion,
        local_faltas_periodo = excluded.local_faltas_periodo, visita_faltas_periodo = excluded.visita_faltas_periodo`,
    partidoId, resumen.localId, resumen.visitaId, resumen.localPuntos, resumen.visitaPuntos, resumen.localFaltas,
    resumen.visitaFaltas, resumen.periodo, revFuente, VERSION_PROYECCION, resumen.localFaltasPeriodo, resumen.visitaFaltasPeriodo,
  )
}

/** ¿Es servible este resumen para esta fila de partido? (existe, versión actual, misma revisión, mismos equipos) */
export function resumenValido(r, p) {
  return r !== null && r !== undefined
    && r.version_proyeccion === VERSION_PROYECCION
    && r.rev_fuente === p.rev
    && r.local_id === p.local_id
    && r.visita_id === p.visita_id
}

const PENDIENTES = `
  SELECT p.id FROM partidos p LEFT JOIN resumen_partido r ON r.partido_id = p.id
   WHERE r.partido_id IS NULL OR r.version_proyeccion <> ? OR r.rev_fuente <> p.rev
      OR r.local_id IS NOT p.local_id OR r.visita_id IS NOT p.visita_id
   ORDER BY p.id LIMIT ?`
const TODOS = 'SELECT id FROM partidos ORDER BY id LIMIT ?'

class LimiteDeEventos extends Error {}

/**
 * REPARACIÓN acotada: reconstruye desde los eventos los resúmenes que faltan, tienen otra versión de proyección u otra
 * revisión o equipos. Determinista (orden por id) e idempotente. Cada partido se repara en SU transacción, con la
 * revisión leída en esa misma transacción; un fallo de un partido no deshace los demás ni lanza.
 *
 * Topes (antes de leer): `limites.partidos` partidos candidatos y `limites.eventos` eventos leídos EN TOTAL (cada
 * lectura lleva `LIMIT restante+1`, así que nunca se reserva más que el tope). Al rebasar un tope se detiene sin
 * reparar lo demás.
 *
 * `todos: true` reconstruye todos los partidos aunque parezcan vigentes (solo lo usan las pruebas, tras escribir
 * eventos directamente en SQL).
 *
 * → { estado: 'ok' | 'parcial' | 'limite-partidos' | 'limite-eventos', reparados, fallidos: [id] }
 */
export function repararResumenes(storage, { limites = LIMITES_REPARACION, todos = false } = {}) {
  const sql = storage.sql
  const candidatos = (todos ? sql.exec(TODOS, limites.partidos + 1) : sql.exec(PENDIENTES, VERSION_PROYECCION, limites.partidos + 1))
    .toArray().map((f) => f.id)
  if (candidatos.length > limites.partidos) return { estado: 'limite-partidos', reparados: 0, fallidos: [] }

  let restante = limites.eventos
  let reparados = 0
  const fallidos = []
  for (const id of candidatos) {
    try {
      const leidos = storage.transactionSync(() => {
        const p = sql.exec('SELECT id, local_id, visita_id, estado_json, rev FROM partidos WHERE id = ?', id).toArray()[0]
        if (!p) return 0
        const filas = sql.exec(
          `SELECT seq, json_extract(json, '$.tipo') AS tipo, json_extract(json, '$.equipoId') AS equipoId,
                  json_extract(json, '$.puntos') AS puntos, json_extract(json, '$.anulado') AS anulado
             FROM eventos WHERE partido_id = ? AND json_extract(json, '$.tipo') IN ('punto', 'falta', 'periodo')
            ORDER BY seq LIMIT ?`,
          id, restante + 1,
        ).toArray()
        if (filas.length > restante) throw new LimiteDeEventos()
        const eventos = filas.map((f) => ({ seq: f.seq, tipo: f.tipo, equipoId: f.equipoId, puntos: f.puntos, anulado: Boolean(f.anulado) }))
        const deporte = JSON.parse(p.estado_json).config?.deporte
        escribirResumen(sql, id, resumirPartido({ eventos, localId: p.local_id, visitaId: p.visita_id, deporte }), p.rev)
        return filas.length
      })
      restante -= leidos
      reparados += 1
    } catch (error) {
      if (error instanceof LimiteDeEventos) return { estado: 'limite-eventos', reparados, fallidos }
      fallidos.push(id)
    }
  }
  return { estado: fallidos.length ? 'parcial' : 'ok', reparados, fallidos }
}
