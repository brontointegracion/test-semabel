// ---------------------------------------------------------------------------
// Crónicas automáticas.
//
// Esto es la mitad determinista de lo que en REQUISITOS.md se llama "escribir
// solo": saca de los eventos guardados TODOS los hechos —quién ganó, por
// cuánto, quién anotó, cuántas seguidas lleva— y arma la frase.
//
// La regla que no se negocia: aquí solo entran datos que están en la base. Un
// modelo puede después reescribir estas frases para que suenen mejor, pero
// recibe los hechos ya hechos y no inventa ninguno. Son personas reales, y
// algunas menores de edad; un dato inventado sobre un chico con nombre y
// apellido no es un error de estilo, es un daño.
//
// Por eso el generador vive aquí, en código, y no en el prompt.
// ---------------------------------------------------------------------------

import { marcadorEquipo, puntosJugador } from './marcador-calculo.js'

const primerNombre = (n = '') => n.split(' ')[0]

/** Racha de victorias que trae un equipo hasta cierto partido (sin incluirlo). */
function rachaAntesDe({ equipoId, partidos, eventosPorPartido, hasta }) {
  const previos = partidos
    .filter((p) => p.estado === 'final' && p.inicio < hasta)
    .filter((p) => p.localId === equipoId || p.visitaId === equipoId)
    .sort((a, b) => b.inicio.localeCompare(a.inicio))

  let racha = 0
  for (const p of previos) {
    const evs = eventosPorPartido[p.id] || []
    const mios = marcadorEquipo(evs, equipoId)
    const otros = marcadorEquipo(evs, p.localId === equipoId ? p.visitaId : p.localId)
    if (mios > otros) racha++
    else break
  }
  return racha
}

/** El mejor partido de un jugador antes de este, para saber si acaba de superarse. */
function mejorMarcaPrevia({ jugadorId, partidos, eventosPorPartido, hasta }) {
  let mejor = 0
  for (const p of partidos) {
    if (p.estado !== 'final' || p.inicio >= hasta) continue
    const pts = puntosJugador(eventosPorPartido[p.id] || [], jugadorId)
    if (pts > mejor) mejor = pts
  }
  return mejor
}

/**
 * Crónica de un partido terminado. Devuelve titular, entrada y cuerpo, todo
 * derivado de los eventos: ni una cifra que no esté guardada.
 */
export function cronicaDePartido({ partido, liga, cancha, local, visita, jugadores, eventos, partidosLiga, eventosPorPartido }) {
  if (!partido || partido.estado !== 'final') return null

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const gano = gl >= gv ? local : visita
  const perdio = gl >= gv ? visita : local
  const dif = Math.abs(gl - gv)
  const empate = gl === gv

  const conPuntos = jugadores
    .map((j) => ({ jugador: j, puntos: puntosJugador(eventos, j.id) }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
  const figura = conPuntos[0]

  const racha = rachaAntesDe({
    equipoId: gano?.id,
    partidos: partidosLiga || [],
    eventosPorPartido: eventosPorPartido || {},
    hasta: partido.inicio,
  }) + 1

  const marcaPrevia = figura
    ? mejorMarcaPrevia({
        jugadorId: figura.jugador.id,
        partidos: partidosLiga || [],
        eventosPorPartido: eventosPorPartido || {},
        hasta: partido.inicio,
      })
    : 0

  const titular = empate
    ? `${local?.nombre} y ${visita?.nombre} empataron ${gl}-${gv}`
    : dif <= 3
      ? `${gano?.nombre} se lo llevó por ${dif} a ${perdio?.nombre}`
      : dif >= 15
        ? `${gano?.nombre} pasó por encima de ${perdio?.nombre}: ${Math.max(gl, gv)}-${Math.min(gl, gv)}`
        : `${gano?.nombre} ganó ${Math.max(gl, gv)}-${Math.min(gl, gv)} a ${perdio?.nombre}`

  const frases = []
  if (figura) {
    frases.push(
      `${figura.jugador.nombre} fue el que más anotó, con ${figura.puntos}.` +
      (figura.puntos > marcaPrevia && marcaPrevia > 0
        ? ` Es su mejor marca de la temporada: le pasa por ${figura.puntos - marcaPrevia} a los ${marcaPrevia} que llevaba.`
        : ''),
    )
  }
  if (!empate && racha >= 2) {
    frases.push(`Con este, ${gano?.nombre} lleva ${racha} seguidos.`)
  }
  if (dif <= 3 && !empate) {
    frases.push('Se decidió en los últimos minutos: nunca hubo más de una posesión de diferencia al final.')
  }
  if (conPuntos.length >= 2) {
    const segundo = conPuntos[1]
    frases.push(`${primerNombre(segundo.jugador.nombre)} acompañó con ${segundo.puntos}.`)
  }

  const faltas = eventos.filter((e) => !e.anulado && e.tipo === 'falta').length
  if (faltas >= 18) frases.push(`Partido trabado: ${faltas} faltas entre los dos.`)

  return {
    titular,
    entrada: `${liga?.nombre}${cancha ? `, en ${cancha.nombre}` : ''}. ${
      empate ? 'Repartieron.' : `Ganó ${gano?.nombre} por ${dif}.`
    }`,
    cuerpo: frases,
    etiqueta: 'Crónica',
    cuando: partido.inicio,
  }
}

/** Resumen de la jornada: los números que dejó una tanda de partidos. */
export function resumenDeJornada({ partidos, eventosPorPartido, liga }) {
  const jugados = partidos.filter((p) => p.estado === 'final')
  if (jugados.length < 2) return null

  let puntos = 0
  let faltas = 0
  let ajustados = 0

  for (const p of jugados) {
    const evs = eventosPorPartido[p.id] || []
    const a = marcadorEquipo(evs, p.localId)
    const b = marcadorEquipo(evs, p.visitaId)
    puntos += a + b
    faltas += evs.filter((e) => !e.anulado && e.tipo === 'falta').length
    if (Math.abs(a - b) <= 5) ajustados++
  }

  return {
    titular: `${jugados.length} partidos, ${puntos} puntos`,
    entrada: `Lo que dejó la jornada en ${liga?.nombre}.`,
    cuerpo: [
      `Se anotaron ${puntos} puntos en ${jugados.length} partidos, un promedio de ${(puntos / jugados.length).toFixed(1)} por juego.`,
      `Se pitaron ${faltas} faltas.`,
      ajustados
        ? `${ajustados} de los ${jugados.length} se decidieron por cinco puntos o menos.`
        : 'Ninguno terminó cerca: todos se resolvieron por más de cinco.',
    ],
    etiqueta: 'Jornada',
    cuando: jugados[jugados.length - 1].inicio,
  }
}
