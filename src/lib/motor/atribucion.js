import { activoDe } from '../identidad'
import { canonico } from './sobre'

// ---------------------------------------------------------------------------
// Contexto de atribución: qué equipos juegan este partido y qué jugadores
// pueden recibir puntos y faltas NUEVOS. Lo arma y lo versiona el adaptador
// (con datos de confianza del partido y de la plantilla); el motor solo lo
// valida y lo usa.
//
//   atribucion = {
//     version,                 huella del contenido de abajo
//     equipos:   [id, id],     los equipos del partido (ordenados)
//     jugadores: { [id]: { equipoId, elegible } }
//   }
//
// `elegible` sale de activoDe (la misma semántica que ya usa la consola y
// roster.js: una ficha sin la marca `activo` cuenta como activa).
//
// La huella cubre SOLO lo que importa para atribuir: equipos, a qué equipo
// pertenece cada jugador y si es elegible. Nombres, acentos, nombre en camiseta
// o dorsal no entran: cambiarlos no cambia la versión y no invalida órdenes
// guardadas sin conexión.
//
// Obligación del adaptador (no se implementa en este paquete): cuando cambie la
// elegibilidad o los equipos, debe publicar una atribución NUEVA con otra
// versión. Una orden que se validó con la versión anterior será rechazada con
// 'atribucion-desactualizada': nunca se reinterpreta en silencio contra una
// plantilla distinta. Las correcciones históricas (Deshacer, Rehacer, Anular)
// no dependen de la plantilla actual.
// ---------------------------------------------------------------------------

const esTexto = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200

/** FNV-1a de 32 bits con dos semillas → 16 caracteres hex. Detecta cambios; no es criptográfica. */
export function huella(texto) {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/**
 * Arma el contexto desde filas de jugadores ({ id, equipoId, activo?, …lo demás se ignora }).
 * Lanza si el partido no tiene equipos o si hay datos inconsistentes: un contexto
 * dudoso no debe producirse en silencio.
 */
export function crearAtribucion({ equipos, jugadores = [] }) {
  const eq = [...new Set(equipos ?? [])]
  if (!eq.length || !eq.every(esTexto)) throw new Error('atribucion: el partido necesita equipos válidos')
  eq.sort()
  const mapa = {}
  for (const j of jugadores) {
    if (!eq.includes(j.equipoId)) continue
    if (!esTexto(j.id)) throw new Error('atribucion: jugador sin id válido')
    if (Object.prototype.hasOwnProperty.call(mapa, j.id)) throw new Error(`atribucion: jugador repetido ${j.id}`)
    mapa[j.id] = { equipoId: j.equipoId, elegible: activoDe(j) }
  }
  const contenido = { equipos: eq, jugadores: mapa }
  return { version: huella(canonico(contenido)), ...contenido }
}

/** ¿Es un contexto completo y coherente? Si no, las órdenes de puntos y faltas se rechazan. */
export function atribucionIntegra(at) {
  if (!at || typeof at !== 'object') return false
  if (!esTexto(at.version) || !Array.isArray(at.equipos) || !at.equipos.length) return false
  if (!at.jugadores || typeof at.jugadores !== 'object' || Array.isArray(at.jugadores)) return false
  return at.version === huella(canonico({ equipos: at.equipos, jugadores: at.jugadores }))
}
