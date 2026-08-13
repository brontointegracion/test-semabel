// ---------------------------------------------------------------------------
// Generador de calendario. El organizador no escribe 30 partidos a mano:
// describe sus condiciones y el sistema propone la temporada.
//
// Regla dura: una franja de una cancha se vende una sola vez. Un partido
// ocupa un espacio y ese espacio deja de existir para todos los demás.
// ---------------------------------------------------------------------------

export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/** Método del círculo: todos contra todos, una vuelta. */
export function rondasRoundRobin(ids) {
  const eq = [...ids]
  if (eq.length % 2) eq.push(null) // fecha libre
  const n = eq.length
  const rondas = []

  for (let r = 0; r < n - 1; r++) {
    const ronda = []
    for (let i = 0; i < n / 2; i++) {
      const a = eq[i]
      const b = eq[n - 1 - i]
      if (a && b) ronda.push(i % 2 ? [b, a] : [a, b])
    }
    rondas.push(ronda)
    eq.splice(1, 0, eq.pop()) // el primero queda fijo, el resto rota
  }
  return rondas
}

/** Todos los espacios que existen entre dos fechas, en orden cronológico. */
export function espaciosDisponibles({ desde, hasta, diasSemana, canchaIds, franjas, ocupadas = [] }) {
  const tomadas = new Set(ocupadas.map((o) => `${o.canchaId}|${o.inicio}`))
  const espacios = []
  const cursor = new Date(desde)
  cursor.setHours(0, 0, 0, 0)
  const fin = new Date(hasta)

  while (cursor <= fin) {
    if (diasSemana.includes(cursor.getDay())) {
      for (const franja of franjas) {
        const [h, m] = franja.split(':').map(Number)
        for (const canchaId of canchaIds) {
          const inicio = new Date(cursor)
          inicio.setHours(h, m, 0, 0)
          const clave = `${canchaId}|${inicio.toISOString()}`
          if (!tomadas.has(clave)) {
            espacios.push({ canchaId, inicio: inicio.toISOString(), franja })
          }
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return espacios
}

/**
 * Reparte los enfrentamientos en los espacios libres.
 * Ningún equipo juega dos veces el mismo día.
 */
export function generarCalendario({ equipoIds, desde, hasta, diasSemana, canchaIds, franjas, ocupadas = [] }) {
  const rondas = rondasRoundRobin(equipoIds)
  const espacios = espaciosDisponibles({ desde, hasta, diasSemana, canchaIds, franjas, ocupadas })

  const partidos = []
  const usados = new Set()
  const jugadoEseDia = new Map() // 'YYYY-MM-DD' -> Set(equipoId)

  for (const ronda of rondas) {
    for (const [localId, visitaId] of ronda) {
      const espacio = espacios.find((e, i) => {
        if (usados.has(i)) return false
        const dia = e.inicio.slice(0, 10)
        const yaJugaron = jugadoEseDia.get(dia)
        return !yaJugaron || (!yaJugaron.has(localId) && !yaJugaron.has(visitaId))
      })
      if (!espacio) return { partidos, sinEspacio: true }

      const i = espacios.indexOf(espacio)
      usados.add(i)
      const dia = espacio.inicio.slice(0, 10)
      if (!jugadoEseDia.has(dia)) jugadoEseDia.set(dia, new Set())
      jugadoEseDia.get(dia).add(localId)
      jugadoEseDia.get(dia).add(visitaId)

      partidos.push({ localId, visitaId, canchaId: espacio.canchaId, inicio: espacio.inicio })
    }
  }

  partidos.sort((a, b) => a.inicio.localeCompare(b.inicio))
  return { partidos, sinEspacio: false }
}
