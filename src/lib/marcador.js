import { db, uid } from '../db'

// ---------------------------------------------------------------------------
// El marcador es una lista de eventos, nunca un número.
// El puntaje es lo que da la suma. Deshacer anula el último evento; rehacer
// lo revive. Nada se borra: un evento anulado queda marcado, con su hora.
// ---------------------------------------------------------------------------

export const PUNTOS_POR_DEPORTE = {
  baloncesto: [1, 2, 3],
  futsal: [1],
}

export function marcadorEquipo(eventos, equipoId) {
  return eventos
    .filter((e) => !e.anulado && e.tipo === 'punto' && e.equipoId === equipoId)
    .reduce((n, e) => n + e.puntos, 0)
}

export function periodoActual(eventos) {
  const p = eventos.filter((e) => !e.anulado && e.tipo === 'periodo').length
  return p + 1
}

export async function anotar({ partidoId, equipoId, jugadorId, puntos, periodo }) {
  const previos = await db.eventos.where('partidoId').equals(partidoId).toArray()
  const seq = previos.reduce((m, e) => Math.max(m, e.seq), 0) + 1

  // Un evento nuevo cierra la posibilidad de rehacer lo anulado antes.
  const rehacibles = previos.filter((e) => e.anulado && !e.rehacerBloqueado)
  await Promise.all(
    rehacibles.map((e) => db.eventos.update(e.id, { rehacerBloqueado: true })),
  )

  await db.eventos.add({
    id: uid(),
    partidoId,
    seq,
    tipo: 'punto',
    equipoId,
    jugadorId: jugadorId ?? null,
    puntos,
    periodo,
    anulado: false,
    creadoEn: Date.now(),
  })
}

export async function cerrarPeriodo(partidoId, periodo) {
  const previos = await db.eventos.where('partidoId').equals(partidoId).toArray()
  const seq = previos.reduce((m, e) => Math.max(m, e.seq), 0) + 1
  await db.eventos.add({
    id: uid(),
    partidoId,
    seq,
    tipo: 'periodo',
    periodo,
    anulado: false,
    creadoEn: Date.now(),
  })
}

/** Anula el último evento vivo. */
export async function deshacer(partidoId) {
  const eventos = await db.eventos.where('partidoId').equals(partidoId).toArray()
  const vivo = eventos
    .filter((e) => !e.anulado)
    .sort((a, b) => b.seq - a.seq)[0]
  if (!vivo) return null
  await db.eventos.update(vivo.id, { anulado: true, anuladoEn: Date.now() })
  return vivo
}

/** Revive el evento anulado más recientemente, si nada lo bloqueó. */
export async function rehacer(partidoId) {
  const eventos = await db.eventos.where('partidoId').equals(partidoId).toArray()
  const candidato = eventos
    .filter((e) => e.anulado && !e.rehacerBloqueado)
    .sort((a, b) => (b.anuladoEn || 0) - (a.anuladoEn || 0))[0]
  if (!candidato) return null
  await db.eventos.update(candidato.id, { anulado: false, anuladoEn: null })
  return candidato
}

export function hayQueRehacer(eventos) {
  return eventos.some((e) => e.anulado && !e.rehacerBloqueado)
}

/** Anular un evento puntual desde la lista de acciones recientes. */
export async function anularEvento(id) {
  await db.eventos.update(id, { anulado: true, anuladoEn: Date.now() })
}

// ---------------------------------------------------------------------------
// Tabla de posiciones y estadística de jugadores, derivadas de los eventos.
// ---------------------------------------------------------------------------

const REGLAS = {
  baloncesto: { ganado: 2, perdido: 1, empate: 1 },
  futsal: { ganado: 3, perdido: 0, empate: 1 },
}

export function tablaPosiciones({ equipos, partidos, eventosPorPartido, deporte }) {
  const regla = REGLAS[deporte] || REGLAS.futsal
  const fila = {}
  for (const eq of equipos) {
    fila[eq.id] = { equipo: eq, jj: 0, jg: 0, jp: 0, je: 0, pf: 0, pc: 0, pts: 0 }
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
  for (const j of jugadores) stat[j.id] = { jugador: j, puntos: 0, partidos: 0 }

  for (const p of partidos.filter((p) => p.estado === 'final')) {
    const evs = (eventosPorPartido[p.id] || []).filter((e) => !e.anulado && e.tipo === 'punto')
    const vistos = new Set()
    for (const e of evs) {
      if (!e.jugadorId || !stat[e.jugadorId]) continue
      stat[e.jugadorId].puntos += e.puntos
      vistos.add(e.jugadorId)
    }
    for (const id of vistos) stat[id].partidos++
  }

  return Object.values(stat)
    .map((s) => ({ ...s, promedio: s.partidos ? s.puntos / s.partidos : 0 }))
    .sort((a, b) => b.promedio - a.promedio)
}
