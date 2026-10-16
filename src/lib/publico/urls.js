// ---------------------------------------------------------------------------
// Direcciones PÚBLICAS amigables (REPORT_158). Funciones puras; los ids internos (liga, equipo, partido) NO cambian.
//
//   /liga/platinium-u10
//   /liga/platinium-u10/equipo/deportivo
//   /liga/platinium-u10/partido/cross-level-vs-deportivo-k3x9ab
//
//   - Liga y equipo: el mismo id/clave de siempre, en minúsculas. Si dos distintos solo se diferencian por mayúsculas, ese caso usa el
//     id exacto (nunca se elige uno). Resolver acepta minúsculas, mayúsculas originales y el id completo (compatibilidad).
//   - Partido: «<local>-vs-<visita>-<sufijo>». SIN fecha. El sufijo sale SOLO del id interno del partido (inmutable): no cambia al
//     mover la hora, ni con el orden de la lista, ni al azar. El sufijo es la identidad; el nombre solo es para quien lee (si un equipo
//     se renombra, el enlace viejo sigue encontrando el partido y la app corrige la dirección). Si dos partidos de la misma liga
//     tuvieran el mismo sufijo, ambos usan su id completo; un sufijo repetido se resuelve como «ambiguo», nunca «el primero».
// ---------------------------------------------------------------------------

import { slug } from '../enlaces.js'
import { claveEquipo } from './claves.js'

const LONGITUD_SUFIJO = 6
const MAX_PARAMETRO = 64 // ID_PUBLICO: el parámetro de la ruta nunca pasa de 64 caracteres

// ---- Liga -----------------------------------------------------------------

/** Clave pública de una liga: su id en minúsculas, o el id exacto si otro id de la lista solo difiere por mayúsculas. */
export function claveLiga(ligaId, todosLosIds = null) {
  const minus = ligaId.toLowerCase()
  if (!Array.isArray(todosLosIds)) return minus
  return todosLosIds.some((o) => o !== ligaId && o.toLowerCase() === minus) ? ligaId : minus
}

/** → { ok: true, ligaId } | { ok: false, motivo: 'desconocido' | 'ambiguo' }. Exacto primero; luego sin distinguir mayúsculas. */
export function resolverLiga(ids, parametro) {
  if (typeof parametro !== 'string' || parametro === '' || !Array.isArray(ids)) return { ok: false, motivo: 'desconocido' }
  if (ids.includes(parametro)) return { ok: true, ligaId: parametro }
  const coinciden = ids.filter((id) => id.toLowerCase() === parametro.toLowerCase())
  if (coinciden.length === 1) return { ok: true, ligaId: coinciden[0] }
  return { ok: false, motivo: coinciden.length > 1 ? 'ambiguo' : 'desconocido' }
}

// ---- Equipo ---------------------------------------------------------------

/** Clave pública del equipo: su clave de siempre en minúsculas; si choca con otro equipo (también por mayúsculas), su id completo exacto. */
export function claveEquipoPublica(ligaId, equipoId, todosLosIds = null) {
  const corta = claveEquipo(ligaId, equipoId)
  const minus = corta.toLowerCase()
  const choca = Array.isArray(todosLosIds)
    && todosLosIds.some((o) => o !== equipoId && (o.toLowerCase() === minus || claveEquipo(ligaId, o).toLowerCase() === minus))
  return choca ? equipoId : minus
}

// ---- Partido --------------------------------------------------------------

/** Hash de 53 bits (cyrb53): determinista, sin dependencias ni `crypto` asíncrono. */
function cyrb53(texto) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Sufijo estable de un partido: 6 caracteres [0-9a-z] derivados SOLO de su id interno. */
export function sufijoPartido(gameId) {
  return (cyrb53(`partido:${gameId}`) % 36 ** LONGITUD_SUFIJO).toString(36).padStart(LONGITUD_SUFIJO, '0')
}

/** El texto legible de la dirección: «local-vs-visita» (acotado para que la dirección completa quepa en 64 caracteres). */
function nombreDe(local, visita) {
  const base = slug(`${local ?? ''} vs ${visita ?? ''}`).slice(0, MAX_PARAMETRO - LONGITUD_SUFIJO - 1).replace(/-+$/, '')
  return base === '' || base === 'vs' ? 'partido' : base
}

/**
 * Parámetro público de un partido. `partidos`: la lista de la liga ([{ gameId }]); con ella se comprueba que el sufijo no choque
 * (si choca, el id completo). `nombres`: { local, visita } (nombres de los equipos).
 */
export function claveJuego(gameId, nombres, partidos = null) {
  const sufijo = sufijoPartido(gameId)
  if (Array.isArray(partidos) && partidos.some((p) => p.gameId !== gameId && sufijoPartido(p.gameId) === sufijo)) return gameId
  return `${nombreDe(nombres?.local, nombres?.visita)}-${sufijo}`
}

/**
 * → { ok: true, gameId } | { ok: false, motivo: 'desconocido' | 'ambiguo' }.
 * Orden: (1) el id completo exacto; (2) el id completo sin distinguir mayúsculas; (3) el sufijo estable al final de «nombre-sufijo».
 * Si en un paso coinciden varios partidos distintos → ambiguo (no se pasa al siguiente paso).
 */
export function resolverJuego(partidos, parametro) {
  if (typeof parametro !== 'string' || parametro === '' || !Array.isArray(partidos)) return { ok: false, motivo: 'desconocido' }
  const ids = partidos.map((p) => p.gameId)
  const t = parametro.toLowerCase()
  const m = /^.+-([0-9a-z]{6})$/.exec(t)
  const pasos = [
    ids.filter((id) => id === parametro),
    ids.filter((id) => id.toLowerCase() === t),
    m ? ids.filter((id) => sufijoPartido(id) === m[1]) : [],
  ]
  for (const coinciden of pasos) {
    if (coinciden.length === 1) return { ok: true, gameId: coinciden[0] }
    if (coinciden.length > 1) return { ok: false, motivo: 'ambiguo' }
  }
  return { ok: false, motivo: 'desconocido' }
}

/** Mapa gameId → ruta pública del partido para toda la liga leída (`datos`: la lectura validada de la liga). */
export function enlacesDePartidos(datos) {
  const nombres = new Map(datos.equipos.map((e) => [e.id, e.nombre]))
  const ligaKey = claveLiga(datos.liga.id)
  const mapa = new Map()
  for (const p of datos.partidos) {
    mapa.set(p.gameId, `/liga/${ligaKey}/partido/${claveJuego(p.gameId, { local: nombres.get(p.local.id), visita: nombres.get(p.visita.id) }, datos.partidos)}`)
  }
  return mapa
}
