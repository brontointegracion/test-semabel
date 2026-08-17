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

export function hayQueRehacer(eventos) {
  return eventos.some((e) => e.anulado && !e.rehacerBloqueado)
}

// ---------------------------------------------------------------------------
// Tabla de posiciones y estadística, derivadas de los eventos.
// ---------------------------------------------------------------------------

const REGLAS = {
  baloncesto: { ganado: 2, perdido: 1, empate: 1 },
  futsal: { ganado: 3, perdido: 0, empate: 1 },
}

export function tablaPosiciones({ equipos, partidos, eventosPorPartido, deporte }) {
  const regla = REGLAS[deporte] || REGLAS.futsal
  const fila = {}
  for (const eq of equipos) {
    fila[eq.id] = { equipo: eq, jj: 0, jg: 0, jp: 0, je: 0, pf: 0, pc: 0, faltas: 0, pts: 0 }
  }

  for (const p of partidos.filter((p) => p.estado === 'final')) {
    const evs = eventosPorPartido[p.id] || []
    const local = marcadorEquipo(evs, p.localId)
    const visita = marcadorEquipo(evs, p.visitaId)
    const a = fila[p.localId]
    const b = fila[p.visitaId]
    if (!a || !b) continue
    a.jj++; b.jj++
    a.pf += local; a.pc += visita
    b.pf += visita; b.pc += local
    a.faltas += faltasEquipo(evs, p.localId)
    b.faltas += faltasEquipo(evs, p.visitaId)
    if (local > visita) { a.jg++; b.jp++; a.pts += regla.ganado; b.pts += regla.perdido }
    else if (visita > local) { b.jg++; a.jp++; b.pts += regla.ganado; a.pts += regla.perdido }
    else { a.je++; b.je++; a.pts += regla.empate; b.pts += regla.empate }
  }

  return Object.values(fila).sort(
    (x, y) => y.pts - x.pts || (y.pf - y.pc) - (x.pf - x.pc) || y.pf - x.pf,
  )
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
