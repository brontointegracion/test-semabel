// ---------------------------------------------------------------------------
// Direcciones del organizador (REPORT_179). Funciones puras, sin sesión: la dirección es SOLO navegación; quién puede ver qué lo decide
// siempre el servidor. Las direcciones canónicas son las de /organizador; las de /anthony y /ligas siguen funcionando como redirecciones de
// compatibilidad (`rutaCanonicaDeLegado`); /ligas y los alias de piloto (ALIAS_PILOTO) son entradas amigables a /organizador. Los identificadores internos y las rutas de la API no cambian.
//
//   /organizador/acceso                            entrada (código de acceso)
//   /organizador                                   Mis ligas
//   /organizador/ligas/:ligaId                     liga (equipos y partidos)
//   /organizador/ligas/:ligaId/equipos/:equipoId   plantilla del equipo
//   /organizador/ligas/:ligaId/partidos/:gameId    acceso de puntuación del partido
// ---------------------------------------------------------------------------

export const RUTA_ACCESO = '/organizador/acceso'
export const RUTA_PANEL = '/organizador'
export const rutaLiga = (ligaId) => `/organizador/ligas/${ligaId}`
export const rutaEquipo = (ligaId, equipoId) => `/organizador/ligas/${ligaId}/equipos/${equipoId}`
export const rutaPartido = (ligaId, gameId) => `/organizador/ligas/${ligaId}/partidos/${gameId}`
/** La pantalla de activación del teléfono de puntuación (no es la consola: la consola exige un teléfono ya activado). */
export const rutaActivacion = (ligaId, gameId) => `/control/${ligaId}/${gameId}`

/**
 * ALIAS DE ENTRADA DEL PILOTO (REPORT_180). Direcciones amigables fijas que llevan a la MISMA entrada autenticada (/ligas → /organizador).
 * NO son enrutamiento por organizador: la sesión del servidor no trae ningún nombre o «slug» de organizador (solo `organizadorId` y sus
 * `ligas`), así que no hay forma fiable de asociar un slug con una persona. El alias no decide permisos, no crea ni aprovisiona
 * organizadores y no redirige a ninguna liga concreta: quien entra ve SOLO las ligas que su sesión posee, entre por donde entre. Cada
 * alias se declara aquí a mano (nunca una ruta «:slug» abierta) y no lleva identificadores de ligas.
 */
export const ALIAS_PILOTO = Object.freeze(['/deportivo-vip/ligas'])

/** ¿Es una dirección canónica del organizador? */
export const esRutaOrganizador = (pathname) => typeof pathname === 'string' && /^\/organizador(\/|$)/.test(pathname)

/**
 * Dirección canónica equivalente a una dirección ANTIGUA (/anthony…, /ligas), o null si no es una dirección antigua. Conserva los
 * segmentos tal cual (los ids no se tocan). Nunca devuelve una dirección antigua: no hay bucles.
 */
export function rutaCanonicaDeLegado(pathname) {
  if (typeof pathname !== 'string') return null
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/ligas' || ALIAS_PILOTO.includes(p)) return RUTA_PANEL
  if (p === '/anthony' || p === '/anthony/access') return RUTA_ACCESO
  if (p === '/anthony/ligas') return RUTA_PANEL
  const m = /^\/anthony\/ligas\/(.+)$/.exec(p)
  if (m) return `/organizador/ligas/${m[1]}`
  if (/^\/anthony\//.test(p)) return RUTA_PANEL // cualquier otra dirección antigua: al panel (que pide sesión)
  return null
}

/**
 * Destino de retorno (`state.desde`) guardado por una pantalla protegida: solo se acepta una dirección del organizador, canónica o
 * antigua (que se traduce). Cualquier otra cosa → null. La entrada nunca es el propio destino de retorno.
 */
export function destinoDeRetorno(desde) {
  if (typeof desde !== 'string' || !desde.startsWith('/') || desde.startsWith('//') || desde.includes('\\') || /[\u0000-\u001f]/.test(desde)) return null
  const corte = desde.search(/[?#]/)
  const ruta = corte < 0 ? desde : desde.slice(0, corte)
  const resto = corte < 0 ? '' : desde.slice(corte) // la búsqueda y el fragmento se conservan tal cual
  const canonica = esRutaOrganizador(ruta) ? ruta : rutaCanonicaDeLegado(ruta)
  if (!canonica || !esRutaOrganizador(canonica) || canonica === RUTA_ACCESO || canonica.startsWith(`${RUTA_ACCESO}/`)) return null
  return `${canonica}${resto}`
}
