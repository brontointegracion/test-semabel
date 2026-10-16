import { nombreVisible } from '../../src/lib/identidad.js'
import { dorsalDe } from '../../src/lib/dorsal.js'
import { estadoDeCredencial } from './adaptador-liga.js'
import { sha256Hex } from './credenciales.js'

// ---------------------------------------------------------------------------
// Lectura AUTORITATIVA del estado de un partido para el teléfono que lo controla:
//
//   GET /v1/ligas/{liga}/partidos/{juego}/estado     Bearer del partido (credencial ACTIVA)
//
// Devuelve una lista blanca armada campo por campo (nunca filas ni el estado del motor tal cual):
//
//   version, gameId, deviceId (el del llamador autenticado), servidorAhoraMs,
//   credencial { expiraEn, retornoHasta },        cuándo deja de procesar comandos y cuándo deja de repetir recibos
//   cursor { rev, ultimoClientSeq },               el par con el que se reanuda la cola (`crearCola`, `reanudar`)
//   partido { ligaId, localId, visitaId },
//   estado { config, partido, auditSeq, corridaSeq, cursorReloj, eventos },   la forma de `crearEstado` sin `rev`
//   atribucion { version, equipos, jugadores },    el contexto ÍNTEGRO del motor (`atribucionIntegra`) o null
//   etiquetas [{ id, etiqueta }],                  SOLO para mostrar; fuera de la atribución
//   visualizacion { equipos, jugadores },          nombres y números para mostrar (ver visualizacionDe); fuera de la atribución
//
// QUÉ NO ES. Una instantánea NO resuelve una orden de resultado incierto: no hay recibos aquí y `rev`, `ultimoClientSeq` o
// los totales nunca prueban que una orden concreta se aceptó (un rechazo definitivo también consume su secuencia). Una
// orden incierta se resuelve repitiendo su sobre ORIGINAL con su cmdId. Tampoco recupera órdenes que el teléfono perdió.
//
// AUTORIZACIÓN. El token se resume ANTES (único await real). Después, en UN tramo sincrónico sin await, se relee la fila
// de la credencial y se exige que esté vigente (`activa`: una credencial en recuperación solo repite recibos), asignada
// a ESTE partido; solo entonces se lee algo más. Todos los campos salen de ese mismo tramo, que no puede intercalarse
// con la confirmación de una orden (también sincrónica). Cualquier fallo de autorización es el mismo `no-autorizado`.
//
// LÍMITES (provisionales, solo de disponibilidad; NO son evidencia de que todas las partidas reales quepan):
//   - más de `maxEventos` eventos: se rechaza ANTES de armar la instantánea;
//   - más de `maxBytes` bytes UTF-8 de respuesta serializada: se rechaza.
//   En ambos casos `demasiado-grande` (507 estado-demasiado-grande): nunca una instantánea truncada que parezca completa.
//   Se aplican DESPUÉS de autorizar: quien no está autorizado no averigua el tamaño. Superarlos bloquea solo esta
//   hidratación; el manejo de órdenes no cambia.
//
// No escribe nada.
// ---------------------------------------------------------------------------

export const VERSION_ESTADO_CONTROL = 1
export const LIMITES_ESTADO_CONTROL = Object.freeze({ maxEventos: 4000, maxBytes: 1024 * 1024 })

const CAMPOS_EVENTO = ['id', 'partidoId', 'seq', 'tipo', 'equipoId', 'jugadorId', 'puntos', 'periodo', 'anulado', 'creadoEn', 'anuladoEn', 'anuladoRev', 'rehacerBloqueado']

/** Solo las claves aprobadas de cada evento, con el valor guardado. */
function eventoPublico(e) {
  const salida = {}
  for (const k of CAMPOS_EVENTO) if (Object.prototype.hasOwnProperty.call(e, k)) salida[k] = e[k]
  return salida
}

function atribucionPublica(a) {
  if (!a) return null
  return {
    version: a.version,
    equipos: [...a.equipos],
    jugadores: Object.fromEntries(Object.entries(a.jugadores).map(([id, j]) => [id, { equipoId: j.equipoId, elegible: j.elegible }])),
  }
}

/**
 * Etiquetas de los jugadores ACTIVOS de los dos equipos y de los referenciados por los eventos de ESTE partido (aunque
 * después se hayan desactivado: las fichas no se borran). Nombre en camiseta si lo hay; si no, el nombre guardado;
 * `null` si la ficha anterior no tiene ninguno. Nunca partes del nombre, fechas, personas ni códigos.
 */
function etiquetasDe(sql, partido, eventos) {
  const equipos = [...new Set([partido.local_id, partido.visita_id].filter((id) => typeof id === 'string' && id !== ''))]
  if (equipos.length === 0) return []
  const referenciados = new Set(eventos.map((e) => e.jugadorId).filter((id) => typeof id === 'string'))
  const filas = sql.exec(
    `SELECT id, nombre, nombre_camiseta, activo FROM jugadores WHERE equipo_id IN (${equipos.map(() => '?').join(', ')}) ORDER BY id`,
    ...equipos,
  ).toArray()
  return filas
    .filter((f) => f.activo === 1 || referenciados.has(f.id))
    .map((f) => ({ id: f.id, etiqueta: nombreVisible({ nombre: f.nombre ?? undefined, nombreCamiseta: f.nombre_camiseta ?? undefined }) || null }))
}

/**
 * Datos MÍNIMOS para mostrar en la pantalla de puntuación (REPORT_127), en una lista blanca campo por campo:
 *   equipos   [{ id, nombre }]                                  los dos equipos del partido (local, visita)
 *   jugadores [{ id, equipoId, nombrePila, apellido1, dorsal, activo }]   los mismos jugadores que `etiquetas`
 * Los ids son los de siempre (los comandos siguen apuntando a ellos: esto NO redefine ninguna identidad). `nombrePila` y
 * `apellido1` son los campos existentes de la ficha, o `null` si la ficha no los tiene (no se inventan a partir del nombre
 * completo). `dorsal` es un entero 0–99 (el 0 es un número real) o `null` (nunca se convierte un hueco en 0). Nunca fechas de
 * nacimiento, contacto, documentos, personaId, códigos, apellido2, nombre en camiseta ni datos del organizador.
 */
function visualizacionDe(sql, partido, eventos) {
  const ids = [partido.local_id, partido.visita_id].filter((id) => typeof id === 'string' && id !== '')
  const equiposIds = [...new Set(ids)]
  if (equiposIds.length === 0) return { equipos: [], jugadores: [] }
  const marcas = equiposIds.map(() => '?').join(', ')
  const nombres = new Map(sql.exec(`SELECT id, nombre FROM equipos WHERE id IN (${marcas})`, ...equiposIds).toArray().map((f) => [f.id, f.nombre]))
  const equipos = equiposIds.filter((id) => nombres.has(id)).map((id) => ({ id, nombre: nombres.get(id) }))
  const referenciados = new Set(eventos.map((e) => e.jugadorId).filter((id) => typeof id === 'string'))
  const filas = sql.exec(
    `SELECT id, equipo_id, nombre_pila, apellido1, dorsal, activo FROM jugadores WHERE equipo_id IN (${marcas}) ORDER BY id`,
    ...equiposIds,
  ).toArray()
  const jugadores = filas
    .filter((f) => f.activo === 1 || referenciados.has(f.id))
    .map((f) => ({
      id: f.id,
      equipoId: f.equipo_id,
      nombrePila: typeof f.nombre_pila === 'string' && f.nombre_pila.trim() !== '' ? f.nombre_pila : null,
      apellido1: typeof f.apellido1 === 'string' && f.apellido1.trim() !== '' ? f.apellido1 : null,
      dorsal: dorsalDe({ dorsal: f.dorsal }),
      activo: f.activo === 1,
    }))
  return { equipos, jugadores }
}

/**
 * → { tipo: 'ok', cuerpo } | { tipo: 'no-autorizado' } | { tipo: 'demasiado-grande' }
 * `pausaTrasResumir` es un punto de extensión SOLO para pruebas: corre entre el resumen del token y el tramo sincrónico.
 */
export async function leerEstadoControl({
  storage, adaptador, credencial, gameId, ahoraFn, limites = LIMITES_ESTADO_CONTROL, pausaTrasResumir = null,
}) {
  const hash = await sha256Hex(typeof credencial === 'string' ? credencial : '')
  if (pausaTrasResumir) await pausaTrasResumir()
  return storage.transactionSync(() => {
    const sql = storage.sql
    const ahora = ahoraFn()
    const c = sql.exec(
      'SELECT partido_id, device_id, revocada, expira_en, retorno_hasta FROM credenciales WHERE token_hash = ?', hash,
    ).toArray()[0]
    if (!c || c.revocada === 1 || c.partido_id !== gameId) return { tipo: 'no-autorizado' }
    if (estadoDeCredencial(c, ahora) !== 'activa') return { tipo: 'no-autorizado' }
    const p = sql.exec('SELECT id, liga_id, local_id, visita_id, rev, ultimo_client_seq FROM partidos WHERE id = ?', gameId).toArray()[0]
    if (!p) return { tipo: 'no-autorizado' }

    // El recuento va ANTES de armar nada: un partido enorme no se carga para luego descartarlo.
    const eventosGuardados = sql.exec('SELECT COUNT(*) AS n FROM eventos WHERE partido_id = ?', gameId).one().n
    if (eventosGuardados > limites.maxEventos) return { tipo: 'demasiado-grande' }

    const e = adaptador.estadoVigente(gameId)
    if (!e) return { tipo: 'no-autorizado' }
    const eventos = e.eventos.map(eventoPublico)
    const cuerpo = {
      version: VERSION_ESTADO_CONTROL,
      gameId: p.id,
      deviceId: c.device_id,
      servidorAhoraMs: ahora,
      credencial: { expiraEn: c.expira_en ?? null, retornoHasta: c.retorno_hasta ?? null },
      cursor: { rev: p.rev, ultimoClientSeq: p.ultimo_client_seq },
      partido: { ligaId: p.liga_id, localId: p.local_id, visitaId: p.visita_id },
      estado: {
        config: { deporte: e.config.deporte, minutosPorPeriodo: e.config.minutosPorPeriodo ?? null },
        partido: {
          estado: e.partido.estado ?? null,
          inicio: e.partido.inicio ?? null,
          relojEstado: e.partido.relojEstado ?? null,
          relojRestante: e.partido.relojRestante ?? null,
          relojDesde: e.partido.relojDesde ?? null,
        },
        auditSeq: e.auditSeq,
        corridaSeq: e.corridaSeq,
        cursorReloj: e.cursorReloj,
        eventos,
      },
      atribucion: atribucionPublica(e.atribucion),
      etiquetas: etiquetasDe(sql, p, eventos),
      visualizacion: visualizacionDe(sql, p, eventos),
    }
    // Bytes UTF-8 de lo que realmente se envía, no caracteres.
    if (new TextEncoder().encode(JSON.stringify(cuerpo)).length > limites.maxBytes) return { tipo: 'demasiado-grande' }
    return { tipo: 'ok', cuerpo }
  })
}
