// ---------------------------------------------------------------------------
// Votos: quién gana (antes del partido) y jugador del partido (al terminar).
//
// Un toque, sin cuenta. Sirven para dos cosas: dan algo que hacer a quien mira,
// y sobre todo dan algo que pegar en el grupo de WhatsApp del equipo — que no
// es nuestro, es de ellos, y es donde ya está la gente.
//
// OJO: aquí no hay servidor, así que los votos de "los demás" son simulados.
// Se generan a partir del código del partido, de forma que siempre den el mismo
// número: si cambiaran en cada recarga, la demostración se vería falsa.
// Con backend, esto se reemplaza por un contador de verdad y nada más cambia.
// ---------------------------------------------------------------------------

const semilla = (texto) => {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const entre = (texto, min, max) => min + Math.floor(semilla(texto) * (max - min + 1))

/** Reparto simulado del "¿quién gana?", más el voto de quien mira. */
export function votosGanador({ partido, local, visita, miVoto }) {
  const total = entre(`t${partido.codigo}`, 24, 180)
  const sesgo = 0.32 + semilla(`s${partido.codigo}`) * 0.36 // entre 32% y 68%
  let porLocal = Math.round(total * sesgo)
  let porVisita = total - porLocal

  if (miVoto === local?.id) porLocal++
  if (miVoto === visita?.id) porVisita++

  const suma = porLocal + porVisita
  return {
    total: suma,
    local: porLocal,
    visita: porVisita,
    pctLocal: Math.round((porLocal / suma) * 100),
    pctVisita: 100 - Math.round((porLocal / suma) * 100),
  }
}

/**
 * Jugador del partido. Los votos simulados siguen a los puntos: la gente vota
 * al que anotó, así que el reparto se parece a la realidad en vez de ser ruido.
 */
export function votosJugadorDelPartido({ partido, jugadores, puntosDe, miVoto }) {
  const candidatos = jugadores
    .map((j) => ({ jugador: j, puntos: puntosDe(j.id) }))
    .filter((c) => c.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, 6)

  if (!candidatos.length) return { total: 0, filas: [] }

  const base = entre(`j${partido.codigo}`, 18, 90)
  const filas = candidatos.map((c, i) => {
    const peso = c.puntos * (1 + semilla(`${partido.codigo}${c.jugador.id}`) * 0.6)
    return { ...c, peso, orden: i }
  })

  const pesoTotal = filas.reduce((n, f) => n + f.peso, 0)
  let total = 0
  const conVotos = filas.map((f) => {
    const votos = Math.max(1, Math.round((f.peso / pesoTotal) * base)) + (miVoto === f.jugador.id ? 1 : 0)
    total += votos
    return { jugador: f.jugador, puntos: f.puntos, votos }
  })

  return {
    total,
    filas: conVotos
      .map((f) => ({ ...f, pct: Math.round((f.votos / total) * 100) }))
      .sort((a, b) => b.votos - a.votos),
  }
}

/** Texto para pegar en el grupo. Lo que se comparte es la frase, no la app. */
export function textoParaCompartir({ titulo, detalle, url }) {
  return `${titulo}\n${detalle}\n${url}`
}

export async function compartir(texto, url) {
  try {
    if (navigator.share) {
      await navigator.share({ text: texto, url })
      return 'compartido'
    }
    await navigator.clipboard.writeText(`${texto}\n${url}`)
    return 'copiado'
  } catch {
    return null
  }
}
