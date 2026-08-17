import { db, uid } from '../db'

// Acciones sobre el marcador: lo que escribe eventos en la base.
// La cuenta vive en marcador-calculo.js, sin base de datos, para poder probarla.
export * from './marcador-calculo'

async function siguienteSeq(partidoId) {
  const previos = await db.eventos.where('partidoId').equals(partidoId).toArray()
  return { previos, seq: previos.reduce((m, e) => Math.max(m, e.seq), 0) + 1 }
}

async function bloquearRehacer(previos) {
  const rehacibles = previos.filter((e) => e.anulado && !e.rehacerBloqueado)
  await Promise.all(rehacibles.map((e) => db.eventos.update(e.id, { rehacerBloqueado: true })))
}

export async function anotar({ partidoId, equipoId, jugadorId, puntos, periodo }) {
  const { previos, seq } = await siguienteSeq(partidoId)
  await bloquearRehacer(previos)
  await db.eventos.add({
    id: uid(), partidoId, seq, tipo: 'punto',
    equipoId, jugadorId: jugadorId ?? null, puntos, periodo,
    anulado: false, creadoEn: Date.now(),
  })
}

export async function marcarFalta({ partidoId, equipoId, jugadorId, periodo }) {
  const { previos, seq } = await siguienteSeq(partidoId)
  await bloquearRehacer(previos)
  await db.eventos.add({
    id: uid(), partidoId, seq, tipo: 'falta',
    equipoId, jugadorId: jugadorId ?? null, puntos: 0, periodo,
    anulado: false, creadoEn: Date.now(),
  })
}

export async function cerrarPeriodo(partidoId, periodo) {
  const { seq } = await siguienteSeq(partidoId)
  await db.eventos.add({
    id: uid(), partidoId, seq, tipo: 'periodo', periodo,
    anulado: false, creadoEn: Date.now(),
  })
}

/** Anula el último evento vivo. */
export async function deshacer(partidoId) {
  const eventos = await db.eventos.where('partidoId').equals(partidoId).toArray()
  const vivo = eventos.filter((e) => !e.anulado).sort((a, b) => b.seq - a.seq)[0]
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

export async function anularEvento(id) {
  await db.eventos.update(id, { anulado: true, anuladoEn: Date.now() })
}
