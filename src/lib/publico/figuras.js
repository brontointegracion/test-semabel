// ---------------------------------------------------------------------------
// «Figuras del barrio» de la portada compartida (REPORT_215): qué se destaca de cada liga a partir del ranking público YA publicado por el servidor
// (GET /v1/ligas/{liga}/jugadores/publico, ver validarJugadores). No suma, no reordena y no fusiona nada: solo elige un prefijo del ranking.
//
//   Métrica        puntos TOTALES en partidos terminados (el servidor no registra partidos jugados: no hay promedio «por juego»).
//   Alcance        UNA liga a la vez. Las ligas tienen distinta categoría, calendario y número de partidos terminados, así que NO se mezclan en una tabla
//                  global: cada liga tiene su propio podio, en el orden en que la portada las configura.
//   Selección      las entradas con `rango` ≤ PODIO_RANGO (los empates comparten puesto: «1, 2, 2» son tres filas; nunca se corta a un empatado por el nombre),
//                  con un tope de PODIO_FILAS_MAX filas por liga; `masEmpatados` cuenta las que quedaron fuera por ese tope.
//   Identidad      cada entrada es una FICHA en UN equipo (ids que da el servidor); nunca se une por nombre, número ni persona.
// ---------------------------------------------------------------------------

export const PODIO_RANGO = 3
export const PODIO_FILAS_MAX = 5

/** → { estado: 'sin-partidos' | 'sin-puntos' | 'ok', entradas, masEmpatados } a partir de los datos VALIDADOS de una liga. */
export function figurasDeLiga(datos) {
  if (datos.partidosFinales === 0) return { estado: 'sin-partidos', entradas: [], masEmpatados: 0 }
  const elegibles = datos.maximosAnotadores.filter((e) => e.rango <= PODIO_RANGO)
  if (elegibles.length === 0) return { estado: 'sin-puntos', entradas: [], masEmpatados: 0 }
  return { estado: 'ok', entradas: elegibles.slice(0, PODIO_FILAS_MAX), masEmpatados: Math.max(0, elegibles.length - PODIO_FILAS_MAX) }
}
