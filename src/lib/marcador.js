import { db, uid } from '../db'
import { marcaDePeriodo, periodoEnPosicion, periodoVisible } from './marcador-calculo'

// Acciones sobre el marcador: lo que escribe eventos en la base.
// La cuenta vive en marcador-calculo.js, sin base de datos, para poder probarla.
export * from './marcador-calculo'

// Cada acción es una transacción: se comprueba el estado y se escribe en el
// mismo paso, así una pestaña con la pantalla vieja no puede colar un evento
// en el periodo equivocado. Los rechazos no escriben nada y no se reintentan.

async function eventosDe(partidoId) {
  return db.eventos.where('partidoId').equals(partidoId).toArray()
}

async function bloquearRehacer(previos) {
  const rehacibles = previos.filter((e) => e.anulado && !e.rehacerBloqueado)
  await Promise.all(rehacibles.map((e) => db.eventos.update(e.id, { rehacerBloqueado: true })))
}

/**
 * Punto o falta. `periodo` y `marcaPeriodo` son lo que la pantalla estaba
 * mostrando: si ya no coinciden con la base, no se anota nada.
 *
 * Devuelve { ok: true, evento } o { ok: false, motivo, estado? }.
 */
function escribirAccion({ tipo, partidoId, equipoId, jugadorId, puntos, periodo, marcaPeriodo }) {
  return db.transaction('rw', db.eventos, db.partidos, db.ligas, async () => {
    const partido = await db.partidos.get(partidoId)
    if (!partido || partido.estado !== 'vivo') {
      return { ok: false, motivo: 'partido-no-disponible', estado: partido?.estado ?? null }
    }
    const liga = await db.ligas.get(partido.ligaId)
    const previos = await eventosDe(partidoId)

    if (periodoVisible(previos, liga?.deporte) !== periodo || marcaDePeriodo(previos) !== marcaPeriodo) {
      return { ok: false, motivo: 'periodo-desactualizado' }
    }

    const seq = previos.reduce((m, e) => Math.max(m, e.seq), 0) + 1
    await bloquearRehacer(previos)
    const evento = {
      id: uid(), partidoId, seq, tipo,
      equipoId, jugadorId: jugadorId ?? null, puntos, periodo,
      anulado: false, creadoEn: Date.now(),
    }
    await db.eventos.add(evento)
    return { ok: true, evento }
  })
}

export const anotar = ({ partidoId, equipoId, jugadorId, puntos, periodo, marcaPeriodo }) =>
  escribirAccion({ tipo: 'punto', partidoId, equipoId, jugadorId, puntos, periodo, marcaPeriodo })

export const marcarFalta = ({ partidoId, equipoId, jugadorId, periodo, marcaPeriodo }) =>
  escribirAccion({ tipo: 'falta', partidoId, equipoId, jugadorId, puntos: 0, periodo, marcaPeriodo })

/**
 * Anula el último evento vivo. Si ese evento es un cambio de periodo se detiene:
 * no lo anula y tampoco salta hacia atrás a un punto o falta anterior.
 *
 * Devuelve { resultado: 'anulado' | 'nada' | 'limite-periodo', evento? }.
 */
export function deshacer(partidoId) {
  return db.transaction('rw', db.eventos, async () => {
    const eventos = await eventosDe(partidoId)
    const vivo = eventos.filter((e) => !e.anulado).sort((a, b) => b.seq - a.seq)[0]
    if (!vivo) return { resultado: 'nada' }
    if (vivo.tipo === 'periodo') return { resultado: 'limite-periodo', evento: vivo }
    await db.eventos.update(vivo.id, { anulado: true, anuladoEn: Date.now() })
    return { resultado: 'anulado', evento: vivo }
  })
}

/**
 * Revive el evento anulado más recientemente, si nada lo bloqueó. Las
 * transiciones de periodo anuladas no cuentan. Si el periodo con el que se
 * anotó el evento ya no coincide con su lugar en el historial, se detiene:
 * no salta a otro candidato.
 *
 * Devuelve { resultado: 'rehecho' | 'nada' | 'periodo-invalido', evento? }.
 */
export function rehacer(partidoId) {
  return db.transaction('rw', db.eventos, db.partidos, db.ligas, async () => {
    const eventos = await eventosDe(partidoId)
    const candidato = eventos
      .filter((e) => e.anulado && !e.rehacerBloqueado && e.tipo !== 'periodo')
      .sort((a, b) => (b.anuladoEn || 0) - (a.anuladoEn || 0))[0]
    if (!candidato) return { resultado: 'nada' }

    const partido = await db.partidos.get(partidoId)
    const liga = partido ? await db.ligas.get(partido.ligaId) : null
    if (periodoEnPosicion(eventos, candidato.seq, liga?.deporte) !== candidato.periodo) {
      return { resultado: 'periodo-invalido', evento: candidato }
    }

    await db.eventos.update(candidato.id, { anulado: false, anuladoEn: null })
    return { resultado: 'rehecho', evento: candidato }
  })
}

/**
 * Anula un punto o una falta puntual (también de periodos anteriores). Una
 * transición de periodo se rechaza; un evento ya anulado o un id desconocido
 * no hacen nada: ni se cambia la hora de anulación ni la marca de rehacer.
 *
 * Devuelve { resultado: 'anulado' | 'nada' | 'limite-periodo', evento? }.
 */
export function anularEvento(id) {
  return db.transaction('rw', db.eventos, async () => {
    const evento = await db.eventos.get(id)
    if (!evento) return { resultado: 'nada' }
    if (evento.tipo === 'periodo') return { resultado: 'limite-periodo', evento }
    if (evento.anulado) return { resultado: 'nada', evento }
    await db.eventos.update(id, { anulado: true, anuladoEn: Date.now() })
    return { resultado: 'anulado', evento }
  })
}
