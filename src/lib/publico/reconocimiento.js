// ---------------------------------------------------------------------------
// Reconocimiento sutil de una canasta confirmada (REPORT_191). Lógica PURA; el reloj de 4 s y la animación viven en el componente.
//
// Entrada: la lista `anotaciones` de la lectura pública del partido (canastas confirmadas, no anuladas, con jugador asignado; cada una con un
// `seq` estable). Estado: { gameId, vistos: Set<seq>, aviso: { seq, ... } | null }.
//
//   - La PRIMERA lectura de un partido (o la primera tras una reconexión, un fallo de red o volver a ver la pestaña) solo fija la línea base:
//     todo lo que ya existe se marca como visto y NO se anuncia. Nunca se reproduce el pasado.
//   - Después, un `seq` que no estaba en `vistos` es una canasta nueva; si llegan varias de golpe se anuncia la MÁS NUEVA (la nueva reemplaza
//     a la vieja). Un `seq` ya visto no se vuelve a anunciar (sondeos repetidos, reintentos, rehacer una canasta ya anunciada).
//   - Deshacer o anular la canasta que se está mostrando: su `seq` desaparece de la lista y el aviso se retira.
//   - Una canasta sin jugador asignado ni nombre público nunca llega en la lista (el servidor no la publica): no hay aviso.
//   - Si `anotaciones` es null (servidor anterior o dato malo) no se hace nada y el marcador sigue igual.
// ---------------------------------------------------------------------------

export const DURACION_AVISO_MS = 4000
export const estadoInicialReconocimiento = () => ({ gameId: null, vistos: new Set(), aviso: null })

export function siguienteReconocimiento(previo, { gameId, anotaciones, rebase = false }) {
  if (!Array.isArray(anotaciones)) return previo
  const seqs = anotaciones.map((a) => a.seq)
  if (previo.gameId !== gameId || rebase) {
    const aviso = previo.gameId === gameId && previo.aviso && seqs.includes(previo.aviso.seq) ? previo.aviso : null
    return { gameId, vistos: new Set(seqs), aviso }
  }
  const nuevos = anotaciones.filter((a) => !previo.vistos.has(a.seq))
  const vistos = new Set([...previo.vistos, ...seqs])
  if (nuevos.length > 0) {
    const masNueva = nuevos.reduce((m, a) => (a.seq > m.seq ? a : m))
    return { gameId, vistos, aviso: masNueva }
  }
  const aviso = previo.aviso && !seqs.includes(previo.aviso.seq) ? null : previo.aviso
  return aviso === previo.aviso && vistos.size === previo.vistos.size ? previo : { gameId, vistos, aviso }
}

/**
 * «#7 Ana Prueba · +2 puntos · Alfa». El número es el `dorsalActual` público (0 es un número válido: «#0»); sin número (null o ausente) solo el nombre.
 * No cambia qué canastas se anuncian: solo cómo se escribe el aviso.
 */
export const textoDeAviso = (a, nombreEquipo) => {
  const dorsal = a.jugador.dorsalActual
  const numero = Number.isInteger(dorsal) && dorsal >= 0 ? `#${dorsal} ` : ''
  return `${numero}${a.jugador.nombre} · +${a.puntos} ${a.puntos === 1 ? 'punto' : 'puntos'} · ${nombreEquipo}`
}
