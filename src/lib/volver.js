// Retorno dentro de la app. El destino de "Salir" lo escribe la propia app en
// el `state` de la navegación (nunca viene de la URL) y se vuelve a validar
// cada vez que se usa. No toca el historial nativo del navegador.

// Pantallas de Sebel a las que se puede volver. Los partidos (/p/) y el código
// corto (/b/) quedan fuera a propósito: así un "Salir" no puede llevar a otro
// partido ni a la consola, y no hay bucles.
const PERMITIDAS = [
  /^\/$/,
  /^\/l\/[^/]+$/,
  /^\/e\/[^/]+$/,
  /^\/j\/[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/r\/[^/]+$/,
  /^\/n\/[^/]+$/,
  /^\/cat\/[^/]+\/[^/]+$/,
  /^\/(siguiendo|figuras|noticias)$/,
  // Modo compartido: la liga (con su pestaña en la búsqueda) y la página de un equipo. El partido queda fuera, como arriba.
  /^\/liga\/[^/]+$/,
  /^\/liga\/[^/]+\/equipo\/[^/]+$/,
  // Entrada corta del piloto (REPORT_186): «Salir» de un partido abierto desde /tv vuelve a la lista.
  /^\/tv$/,
  // Transmisión de una cancha (REPORT_199): desde el aviso de conflicto se abre un marcador fijo y «Salir» vuelve a ella.
  /^\/tv\/cancha$/,
]

const BASE = 'http://sebel.invalid'

/** true solo para una ruta interna de Sebel (ruta + búsqueda) de las permitidas. */
export function esDestinoInterno(ruta) {
  if (typeof ruta !== 'string' || !ruta.startsWith('/') || ruta.startsWith('//')) return false
  if (ruta.includes('\\') || /[\u0000-\u001f]/.test(ruta)) return false
  let u
  try { u = new URL(ruta, BASE) } catch { return false }
  if (u.origin !== BASE) return false
  return PERMITIDAS.some((r) => r.test(u.pathname))
}

/** Lo que un enlace guarda como origen: la pantalla actual, con su pestaña. */
export const origenActual = (location) => `${location.pathname}${location.search || ''}`

/** El `state` que lleva un enlace de entrada a un partido. Sin origen válido, no lleva nada. */
export function estadoDeEntrada(location) {
  const origen = origenActual(location)
  return esDestinoInterno(origen) ? { volverA: origen } : undefined
}

/** El origen guardado en `location.state`, o null si falta o no es válido. */
export function origenDe(location) {
  const v = location?.state?.volverA
  return esDestinoInterno(v) ? v : null
}

/** Para reenviar el origen en la siguiente navegación (consola, cierre). */
export function reenviar(location) {
  const volverA = origenDe(location)
  return volverA ? { volverA } : undefined
}

export const PESTANAS_LIGA = ['tabla', 'calendario', 'jugadores']

/** Pestaña pedida en la URL; cualquier cosa desconocida cae a Posiciones. */
export const pestanaDe = (valor) => (PESTANAS_LIGA.includes(valor) ? valor : 'tabla')
