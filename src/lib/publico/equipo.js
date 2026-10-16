// ---------------------------------------------------------------------------
// Presentación de la lectura pública de un equipo. Funciones puras.
//
//   - Las fichas se identifican SIEMPRE por su id estable: nunca por nombre ni por número (dos fichas pueden llamarse igual o
//     compartir número, y el número cambia).
//   - Jugador 0 es un número real: «#0». Sin número: «Sin número». Sin nombre: «Nombre pendiente». No se inventa nada.
//   - El número que se muestra es el ACTUAL de la ficha, no el que tenía en un partido antiguo.
//   - Solo puntos y faltas de jugador: no hay «partidos jugados» porque el marcador no registra la participación.
// ---------------------------------------------------------------------------

import { ligasConfiguradas } from './config.js'
import { claveEquipoPublica, claveLiga } from './urls.js'

export const etiquetaNumero = (dorsal) => (dorsal === null ? 'Sin número' : `#${dorsal}`)
export const etiquetaNombre = (nombre) => nombre ?? 'Nombre pendiente'
/** «#2 Saúl Montero» (o el texto explícito de lo que falta). */
export const etiquetaJugador = (j) => (j.dorsalActual === null ? `${etiquetaNombre(j.nombre)} · Sin número` : `#${j.dorsalActual} ${etiquetaNombre(j.nombre)}`)

export const MOTIVOS = Object.freeze({ inactivo: 'Inactivo', 'otro-equipo': 'Ahora en otro equipo', 'no-encontrado': 'Ficha no disponible' })

/**
 * Une plantilla e históricos con sus estadísticas por id. Con partidos finales, una ficha sin eventos muestra 0 (no hay puntos ni
 * faltas registrados); sin partidos finales no hay nada que mostrar (null).
 */
export function armarEquipo(datos) {
  const hay = datos.estadisticas.partidosFinales > 0
  const est = new Map(datos.estadisticas.jugadores.map((s) => [s.id, s]))
  const conStats = (j) => ({ ...j, puntos: hay ? (est.get(j.id)?.puntos ?? 0) : null, faltas: hay ? (est.get(j.id)?.faltas ?? 0) : null })
  const sj = datos.estadisticas.sinJugador
  return {
    hayFinales: hay,
    plantilla: datos.plantilla.map(conStats),
    historicos: datos.historicos.map(conStats),
    sinJugador: sj.puntos > 0 || sj.faltas > 0 ? sj : null,
    resultados: [...datos.resultados].sort((a, b) => {
      const t = (r) => Date.parse(r.inicioReal ?? r.programadoPara ?? '') || 0
      return t(b) - t(a) || (a.gameId < b.gameId ? -1 : 1)
    }),
  }
}

/** Dirección pública (minúsculas) de un equipo con su clave dentro de la liga (ver claves.js y urls.js). `todosLosIds` (opcional) evita choques de claves. */
export const urlEquipoPublico = (ligaId, equipoId, todosLosIds = null) => `/liga/${claveLiga(ligaId, ligasConfiguradas().ids)}/equipo/${claveEquipoPublica(ligaId, equipoId, todosLosIds)}`
