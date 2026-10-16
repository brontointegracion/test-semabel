// ---------------------------------------------------------------------------
// Tabla de posiciones a partir de RESULTADOS de partidos finales. Pura y sin importaciones: la usan el prototipo (marcador-calculo.js,
// que cuenta los resultados desde los eventos) y las pantallas compartidas (que los toman de los resultados finales guardados en el
// servidor). Las reglas de puntos viven aquí, una sola vez.
// ---------------------------------------------------------------------------

const REGLAS = {
  baloncesto: { ganado: 2, perdido: 1, empate: 1 },
  futsal: { ganado: 3, perdido: 0, empate: 1 },
}

/**
 * resultados: [{ localId, visitaId, local, visita, faltasLocal, faltasVisita }] de partidos FINALES (puntos y faltas del partido).
 * → filas { equipo, jj, jg, jp, je, pf, pc, faltas, pts } ordenadas por puntos, diferencia y puntos a favor.
 */
export function tablaDeResultados({ equipos, resultados, deporte }) {
  const regla = REGLAS[deporte] || REGLAS.futsal
  const fila = {}
  for (const eq of equipos) {
    fila[eq.id] = { equipo: eq, jj: 0, jg: 0, jp: 0, je: 0, pf: 0, pc: 0, faltas: 0, pts: 0 }
  }

  for (const r of resultados) {
    const a = fila[r.localId]
    const b = fila[r.visitaId]
    if (!a || !b) continue
    const { local, visita } = r
    a.jj++; b.jj++
    a.pf += local; a.pc += visita
    b.pf += visita; b.pc += local
    a.faltas += r.faltasLocal
    b.faltas += r.faltasVisita
    if (local > visita) { a.jg++; b.jp++; a.pts += regla.ganado; b.pts += regla.perdido }
    else if (visita > local) { b.jg++; a.jp++; b.pts += regla.ganado; a.pts += regla.perdido }
    else { a.je++; b.je++; a.pts += regla.empate; b.pts += regla.empate }
  }

  return Object.values(fila).sort(
    (x, y) => y.pts - x.pts || (y.pf - y.pc) - (x.pf - x.pc) || y.pf - x.pf,
  )
}
