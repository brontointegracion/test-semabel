import { leerDorsal } from '../../src/lib/dorsal.js'
import { resumenValido } from './resumen-publico.js'

// ---------------------------------------------------------------------------
// Lectura PÚBLICA de un equipo:  GET /v1/ligas/{liga}/equipos/{equipo}/publico   (sin credenciales; la admisión de la liga
// se hace en el Worker ANTES de llegar al objeto).
//
// Lista blanca armada campo por campo (nunca una fila): ver CAMPOS_PUBLICOS_EQUIPO. NO incluye fecha de nacimiento, contactos,
// documentos, personaId, código de ficha, nombre en camiseta, credenciales, recibos ni eventos.
//
// SEMÁNTICA
//   plantilla      Fichas ACTIVAS del equipo ahora: { id, nombre, dorsalActual }. `id` es el identificador estable de la ficha
//                  (nunca el nombre ni el número). `nombre`: nombre y apellidos guardados (nombre de pila + primer + segundo
//                  apellido tal cual, sin partirlos ni unir fichas por nombre); si la ficha solo tiene el nombre completo
//                  antiguo, ese; si no hay ninguno, null (no se inventa). `dorsalActual`: el número de HOY (0 es un número
//                  real; null = sin número). No es el que tenía en un evento antiguo.
//   historicos     Fichas que aparecen en las estadísticas de partidos finales de este equipo pero NO están en la plantilla
//                  activa: { id, nombre, dorsalActual, motivo: 'inactivo' | 'otro-equipo' | 'no-encontrado' }.
//   resultados     Partidos FINALES del equipo (estado autoritativo), con el marcador del resumen almacenado
//                  (misma forma que la lectura del partido: nombres, puntos y faltas de PARTIDO COMPLETO por lado).
//   estadisticas   alcance 'partidos-finales-del-equipo': sumas de eventos NO anulados de los partidos finales de este equipo,
//                  por ficha: { id, puntos, faltas }. Solo fichas con eventos. `sinJugador`: lo anotado sin ficha asignada.
//                  Sin partidos jugados, asistencias, rebotes ni porcentajes: el marcador no registra la participación.
//                  Los eventos de un partido en juego o programado NO cuentan. Deshacer, rehacer o anular tras el final
//                  cambian la siguiente lectura.
//   servidorAhoraMs  Hora del servidor al responder.
//
// COSTE: el equipo y la liga se leen por clave; los resultados salen del resumen almacenado de cada partido (sin eventos); las
// estadísticas hacen UNA lectura acotada de solo los eventos de punto/falta no anulados de este equipo en sus partidos finales
// (columnas mínimas, por el índice de eventos). Topes explícitos (LIMITES_EQUIPO_PUBLICO): al rebasarlos, 507
// `equipo-demasiado-grande`, nunca totales parciales.
// ---------------------------------------------------------------------------

export const LIMITES_EQUIPO_PUBLICO = Object.freeze({ partidos: 100, jugadores: 300, eventos: 20_000, equipos: 100 })

export const CAMPOS_PUBLICOS_EQUIPO = Object.freeze({
  raiz: ['liga', 'equipo', 'plantilla', 'historicos', 'resultados', 'estadisticas', 'servidorAhoraMs'],
  liga: ['id', 'nombre'],
  equipo: ['id', 'nombre', 'rama'],
  jugador: ['id', 'nombre', 'dorsalActual'],
  historico: ['id', 'nombre', 'dorsalActual', 'motivo'],
  resultado: ['gameId', 'programadoPara', 'inicioReal', 'sede', 'local', 'visita'],
  lado: ['id', 'nombre', 'puntos', 'faltas'],
  estadisticas: ['alcance', 'partidosFinales', 'jugadores', 'sinJugador'],
  estadistica: ['id', 'puntos', 'faltas'],
  sinJugador: ['puntos', 'faltas'],
})

export const SQL_PARTIDOS_DEL_EQUIPO = `
  SELECT p.id, p.local_id, p.visita_id, p.estado_json, p.rev, p.programado_para, p.sede,
         r.partido_id AS r_partido_id, r.local_id AS r_local_id, r.visita_id AS r_visita_id, r.local_puntos, r.visita_puntos,
         r.local_faltas, r.visita_faltas, r.periodo, r.rev_fuente, r.version_proyeccion
    FROM partidos p LEFT JOIN resumen_partido r ON r.partido_id = p.id
   WHERE (p.local_id = ? OR p.visita_id = ?) AND p.retirado_en IS NULL
   ORDER BY p.programado_para IS NULL, p.programado_para, p.id LIMIT ?`

export const SQL_EVENTOS_DEL_EQUIPO = `
  SELECT json_extract(e.json, '$.jugadorId') AS jugador_id, json_extract(e.json, '$.tipo') AS tipo, json_extract(e.json, '$.puntos') AS puntos
    FROM partidos p JOIN eventos e ON e.partido_id = p.id
   WHERE (p.local_id = ? OR p.visita_id = ?) AND p.retirado_en IS NULL
     AND json_extract(p.estado_json, '$.partido.estado') = 'final'
     AND json_extract(e.json, '$.equipoId') = ?
     AND json_extract(e.json, '$.tipo') IN ('punto', 'falta')
     AND COALESCE(json_extract(e.json, '$.anulado'), 0) = 0
   LIMIT ?`

const SQL_FICHAS = `SELECT id, equipo_id, activo, nombre, nombre_pila, apellido1, apellido2, dorsal FROM jugadores WHERE equipo_id = ?
   ORDER BY dorsal IS NULL, dorsal, id LIMIT ?`

const NO_ENCONTRADO = { status: 404, cuerpo: { error: 'no-encontrado' } }
const demasiado = () => ({ status: 507, cuerpo: { error: 'equipo-demasiado-grande' } })
const NO_DISPONIBLE = { status: 503, cuerpo: { error: 'resumen-no-disponible' } }

const limpio = (t) => (typeof t === 'string' && t.trim() !== '' ? t.trim() : null)

/** Nombre público de una ficha: las partes guardadas, o el nombre completo antiguo, o null. Nunca se inventa. */
export function nombrePublico(f) {
  const partes = [limpio(f.nombre_pila), limpio(f.apellido1), limpio(f.apellido2)].filter(Boolean)
  if (partes.length > 0) return partes.join(' ')
  return limpio(f.nombre)
}

const dorsalPublico = (f) => {
  const d = leerDorsal(f.dorsal)
  return d.tipo === 'real' ? d.valor : null
}

const estadoDe = (estadoJson) => {
  try { return JSON.parse(estadoJson).partido?.estado ?? null } catch { return null }
}

/** → { status, cuerpo }. `sql`: el SQL del objeto de la liga. Sincrónica: lee todo en un mismo tramo. */
export function leerEquipoPublico(sql, equipoId, limites, servidorAhoraMs) {
  const una = (q, ...a) => sql.exec(q, ...a).toArray()[0] ?? null
  const liga = una('SELECT id, nombre FROM ligas')
  if (!liga) return NO_ENCONTRADO
  const equipo = una('SELECT id, nombre, rama, liga_id FROM equipos WHERE id = ?', equipoId)
  if (!equipo || equipo.liga_id !== liga.id) return NO_ENCONTRADO

  const equipos = sql.exec('SELECT id, nombre FROM equipos ORDER BY id LIMIT ?', limites.equipos + 1).toArray()
  if (equipos.length > limites.equipos) return demasiado()
  const nombres = new Map(equipos.map((e) => [e.id, e.nombre]))

  const filas = sql.exec(SQL_PARTIDOS_DEL_EQUIPO, equipoId, equipoId, limites.partidos + 1).toArray()
  if (filas.length > limites.partidos) return demasiado()
  const finales = filas.filter((f) => estadoDe(f.estado_json) === 'final')
  const resultados = []
  for (const f of finales) {
    const r = f.r_partido_id === null ? null : { ...f, local_id: f.r_local_id, visita_id: f.r_visita_id }
    if (!resumenValido(r, { rev: f.rev, local_id: f.local_id, visita_id: f.visita_id })) return NO_DISPONIBLE
    const p = JSON.parse(f.estado_json).partido ?? {}
    resultados.push({
      gameId: f.id,
      programadoPara: limpio(f.programado_para),
      inicioReal: limpio(p.inicio),
      sede: limpio(f.sede),
      local: { id: f.local_id, nombre: nombres.get(f.local_id) ?? f.local_id, puntos: f.local_puntos, faltas: f.local_faltas },
      visita: { id: f.visita_id, nombre: nombres.get(f.visita_id) ?? f.visita_id, puntos: f.visita_puntos, faltas: f.visita_faltas },
    })
  }

  // Estadísticas: una lectura acotada (LIMIT tope+1: si llega la fila de más, no se responde nada parcial).
  const porFicha = new Map()
  let sinJugador = { puntos: 0, faltas: 0 }
  if (finales.length > 0) {
    const eventos = sql.exec(SQL_EVENTOS_DEL_EQUIPO, equipoId, equipoId, equipoId, limites.eventos + 1).toArray()
    if (eventos.length > limites.eventos) return demasiado()
    for (const e of eventos) {
      const puntos = e.tipo === 'punto' ? e.puntos : 0
      if (!Number.isSafeInteger(puntos) || puntos < 0) throw new Error('evento-invalido')
      const faltas = e.tipo === 'falta' ? 1 : 0
      if (e.jugador_id === null || typeof e.jugador_id !== 'string') {
        sinJugador = { puntos: sinJugador.puntos + puntos, faltas: sinJugador.faltas + faltas }
        continue
      }
      const a = porFicha.get(e.jugador_id) ?? { puntos: 0, faltas: 0 }
      porFicha.set(e.jugador_id, { puntos: a.puntos + puntos, faltas: a.faltas + faltas })
    }
    if (porFicha.size > limites.jugadores) return demasiado()
  }

  // Fichas del equipo (activas e inactivas) y, solo si hace falta, las de fichas que ya no son de este equipo.
  const fichas = sql.exec(SQL_FICHAS, equipoId, limites.jugadores + 1).toArray()
  if (fichas.length > limites.jugadores) return demasiado()
  const deEste = new Map(fichas.map((f) => [f.id, f]))
  const plantilla = fichas.filter((f) => f.activo === 1).map((f) => ({ id: f.id, nombre: nombrePublico(f), dorsalActual: dorsalPublico(f) }))
  const historicos = []
  for (const id of [...porFicha.keys()].sort()) {
    const f = deEste.get(id) ?? una('SELECT id, equipo_id, activo, nombre, nombre_pila, apellido1, apellido2, dorsal FROM jugadores WHERE id = ?', id)
    if (f && f.equipo_id === equipoId && f.activo === 1) continue // sigue en la plantilla activa
    historicos.push({
      id,
      nombre: f ? nombrePublico(f) : null,
      dorsalActual: f ? dorsalPublico(f) : null,
      motivo: !f ? 'no-encontrado' : f.equipo_id !== equipoId ? 'otro-equipo' : 'inactivo',
    })
  }

  return {
    status: 200,
    cuerpo: {
      liga: { id: liga.id, nombre: liga.nombre },
      equipo: { id: equipo.id, nombre: equipo.nombre, rama: equipo.rama ?? null },
      plantilla,
      historicos,
      resultados,
      estadisticas: {
        alcance: 'partidos-finales-del-equipo',
        partidosFinales: finales.length,
        jugadores: [...porFicha.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, v]) => ({ id, puntos: v.puntos, faltas: v.faltas })),
        sinJugador,
      },
      servidorAhoraMs,
    },
  }
}
