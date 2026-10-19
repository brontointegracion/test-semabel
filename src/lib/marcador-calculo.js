// ---------------------------------------------------------------------------
// La cuenta del marcador, sin base de datos, para poder probarla.
//
// El marcador es una lista de eventos, nunca un número: el puntaje es lo que
// da la suma. Las faltas son eventos de la misma lista, así que se cuentan,
// se corrigen y se deshacen exactamente igual que los puntos.
//
// De aquí sale todo lo derivado —tabla, estadística, figuras, crónicas— y por
// eso conviene que no dependa de nada.
// ---------------------------------------------------------------------------

import { PERIODOS } from './reloj-calculo'
import { tablaDeResultados } from './tabla-posiciones'

export const PUNTOS_POR_DEPORTE = {
  baloncesto: [1, 2, 3],
  futsal: [1],
}

/** Faltas que sacan a un jugador del partido. */
export const LIMITE_FALTAS = { baloncesto: 5, futsal: 5 }

const vivos = (eventos, tipo) => eventos.filter((e) => !e.anulado && e.tipo === tipo)

export function marcadorEquipo(eventos, equipoId) {
  return vivos(eventos, 'punto')
    .filter((e) => e.equipoId === equipoId)
    .reduce((n, e) => n + e.puntos, 0)
}

export function faltasEquipo(eventos, equipoId) {
  return vivos(eventos, 'falta').filter((e) => e.equipoId === equipoId).length
}

/**
 * Faltas vivas de un equipo en el periodo VISIBLE actual (para el alcance 'periodo'). El periodo de cada falta sale de su
 * lugar en el historial (`periodoEnPosicion`), no de un campo guardado: deshacer o anular una transición de periodo mueve
 * las faltas con ella, y una falta anulada o rehecha de un periodo anterior no toca la cuenta del actual. Los eventos no
 * se modifican ni se descartan.
 */
export function faltasEquipoPeriodo(eventos, equipoId, deporte) {
  const actual = periodoVisible(eventos, deporte)
  return vivos(eventos, 'falta').filter((e) => e.equipoId === equipoId && periodoEnPosicion(eventos, e.seq, deporte) === actual).length
}

export function puntosJugador(eventos, jugadorId) {
  return vivos(eventos, 'punto')
    .filter((e) => e.jugadorId === jugadorId)
    .reduce((n, e) => n + e.puntos, 0)
}

export function faltasJugador(eventos, jugadorId) {
  return vivos(eventos, 'falta').filter((e) => e.jugadorId === jugadorId).length
}

export function periodoActual(eventos) {
  return vivos(eventos, 'periodo').length + 1
}

/**
 * El periodo que muestra la consola: el contado, sin pasar del máximo del deporte.
 * Un doble toque antiguo pudo dejar más transiciones que periodos; la pantalla
 * siempre mostró el tope, y las acciones se anotan con ese mismo número.
 */
export function periodoVisible(eventos, deporte) {
  return Math.min(periodoActual(eventos), PERIODOS[deporte] || 2)
}

/**
 * Marca de frontera: el mayor seq entre TODAS las transiciones de periodo,
 * también las anuladas (0 si no hay ninguna). Cambia con cada transición y
 * no vuelve atrás aunque el periodo vuelva a tener el mismo número, así una
 * pantalla vieja no puede confundirse con la actual.
 */
export function marcaDePeriodo(eventos) {
  return eventos.reduce((m, e) => (e.tipo === 'periodo' ? Math.max(m, e.seq) : m), 0)
}

/** El periodo que le corresponde a un evento según su lugar en el historial. */
export function periodoEnPosicion(eventos, seq, deporte) {
  const antes = eventos.filter((e) => !e.anulado && e.tipo === 'periodo' && e.seq < seq).length
  return deporte ? Math.min(antes + 1, PERIODOS[deporte] || 2) : antes + 1
}

/** Mejor anotador y jugador con más faltas de un equipo, dentro de un partido. */
export function destacadosDeEquipo({ eventos, jugadores, equipoId }) {
  const plantel = jugadores.filter((j) => j.equipoId === equipoId)
  let mejor = null
  let masFaltas = null

  for (const j of plantel) {
    const puntos = puntosJugador(eventos, j.id)
    const faltas = faltasJugador(eventos, j.id)
    if (puntos > 0 && (!mejor || puntos > mejor.puntos)) mejor = { jugador: j, puntos }
    if (faltas > 0 && (!masFaltas || faltas > masFaltas.faltas)) masFaltas = { jugador: j, faltas }
  }

  return { mejor, masFaltas, faltasEquipo: faltasEquipo(eventos, equipoId) }
}

/** Una transición de periodo anulada no se rehace: no es un punto ni una falta. */
export function hayQueRehacer(eventos) {
  return eventos.some((e) => e.anulado && !e.rehacerBloqueado && e.tipo !== 'periodo')
}

// ---------------------------------------------------------------------------
// Tabla de posiciones y estadística, derivadas de los eventos.
// ---------------------------------------------------------------------------

export function tablaPosiciones({ equipos, partidos, eventosPorPartido, deporte }) {
  // Los resultados salen de los eventos de cada partido final; la tabla (y sus reglas de puntos) es la de tabla-posiciones.js.
  const resultados = partidos.filter((p) => p.estado === 'final').map((p) => {
    const evs = eventosPorPartido[p.id] || []
    return {
      localId: p.localId,
      visitaId: p.visitaId,
      local: marcadorEquipo(evs, p.localId),
      visita: marcadorEquipo(evs, p.visitaId),
      faltasLocal: faltasEquipo(evs, p.localId),
      faltasVisita: faltasEquipo(evs, p.visitaId),
    }
  })
  return tablaDeResultados({ equipos, resultados, deporte })
}

export function estadisticaJugadores({ jugadores, partidos, eventosPorPartido }) {
  const stat = {}
  for (const j of jugadores) stat[j.id] = { jugador: j, puntos: 0, faltas: 0, partidos: 0 }

  for (const p of partidos.filter((p) => p.estado === 'final')) {
    const evs = (eventosPorPartido[p.id] || []).filter((e) => !e.anulado)
    const vistos = new Set()
    for (const e of evs) {
      const s = stat[e.jugadorId]
      if (!s) continue
      if (e.tipo === 'punto') s.puntos += e.puntos
      if (e.tipo === 'falta') s.faltas++
      vistos.add(e.jugadorId)
    }
    for (const id of vistos) stat[id].partidos++
  }

  return Object.values(stat)
    .map((s) => ({
      ...s,
      promedio: s.partidos ? s.puntos / s.partidos : 0,
      faltasPorJuego: s.partidos ? s.faltas / s.partidos : 0,
    }))
    .sort((a, b) => b.promedio - a.promedio)
}
