import { dorsalDe } from '../dorsal'
import { evaluarProntitud } from '../prontitud-plantilla'
import { activoDe } from '../identidad'
import { huella } from './atribucion'
import { canonico } from './sobre'

// ---------------------------------------------------------------------------
// Contexto de preparación (S5a): los hechos que hacen falta para decidir si un
// partido puede comenzar, ya normalizados y versionados. Es PURO: no lee ninguna
// base de datos y no está conectado al motor ni a la aplicación. Quien lo arma
// (un adaptador de confianza) le entrega las filas que leyó en su transacción.
//
//   preparacion = {
//     version,          huella del contenido de abajo
//     gameId,           el partido al que pertenece
//     partido:   { ligaId, localId, visitaId },   tal como están guardados (inválido → null)
//     liga:      { id } | null,                   null si no existe la liga
//     equipos:   [{ id, ligaId }],                filas encontradas de los dos equipos, por id
//     consultaEquipos: [id, …],                   equipos cuya plantilla se DICE haber consultado
//     jugadores: [{ id, equipoId, dorsal }],      solo ACTIVOS; dorsal = entero 0–99 o null
//   }
//
// La regla de si está listo NO se repite aquí: se usa evaluarProntitud (la misma
// del arranque conectado).
//
// Identidades: se siguen las del resto del código —texto no vacío (uid() o texto
// fijo), sin recortar, sin cambiar mayúsculas, sin límite de largo— y se comparan
// por igualdad exacta: "7" y "07" son identidades distintas. El orden es por
// unidades de código, así que dos identidades distintas nunca se confunden.
//
// El número guardado se lee con dorsalDe (semántica de lo ya guardado): un texto
// como "07" guardado NO se repara aquí (la normalización de lo que se teclea en un
// formulario es otra cosa, de leerDorsal). Número ausente o mal formado → null.
//
// LÍMITES (no son pruebas de recuperación completa, ni de seguridad):
//   - `consultaEquipos` es cobertura de consulta DECLARADA por quien armó el
//     contexto; no prueba que se hayan traído todas las filas. Un jugador omitido
//     no se puede detectar en un contexto por lo demás válido.
//   - Comparar el gameId detecta un contexto de otro partido; reconstruir uno
//     equivocado con el mismo id y su huella no autentica su origen.
//   - La huella detecta cambios; no es una frontera de seguridad ni autentica a nadie.
//   Que el adaptador recupere de forma completa y confiable, en su propia
//   transacción, el partido, los equipos y las plantillas sigue siendo su deber.
// ---------------------------------------------------------------------------

const esId = (v) => typeof v === 'string' && v !== ''
const idONulo = (v) => (esId(v) ? v : null)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0) // por unidades de código: no depende de la configuración regional
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const falla = (msg) => { throw new Error(`preparacion: ${msg}`) }

/**
 * Arma el contexto desde filas ya leídas. Lanza (como crearAtribucion) si la entrada es estructuralmente
 * dudosa: gameId inválido, filas mal formadas, identidades repetidas, filas de equipos inesperados o una
 * cobertura de consulta que no coincide con los equipos del partido. Un partido sin liga o con equipos
 * inexistentes NO lanza: es un resultado de dominio que evalúa evaluarPreparacion.
 */
export function crearPreparacion({ gameId, partido, liga, equipos = [], jugadores = [], consultaEquipos = [] } = {}) {
  if (!esId(gameId)) falla('gameId inválido')
  if (!esObjeto(partido)) falla('partido inválido')
  if (liga !== undefined && liga !== null && !esObjeto(liga)) falla('liga inválida')
  if (!Array.isArray(equipos) || !Array.isArray(jugadores) || !Array.isArray(consultaEquipos)) falla('listas inválidas')

  const ref = {
    ligaId: idONulo(partido.ligaId),
    localId: idONulo(partido.localId),
    visitaId: idONulo(partido.visitaId),
  }
  // Los equipos del partido que se pueden consultar: los que tienen identidad válida.
  const participantes = [...new Set([ref.localId, ref.visitaId].filter((id) => id !== null))].sort(cmp)

  const consulta = []
  for (const id of consultaEquipos) {
    if (!esId(id)) falla('consultaEquipos con identidad inválida')
    if (consulta.includes(id)) falla('consultaEquipos con identidad repetida')
    consulta.push(id)
  }
  consulta.sort(cmp)
  if (consulta.length !== participantes.length || consulta.some((id, i) => id !== participantes[i])) {
    falla('consultaEquipos no cubre exactamente los equipos del partido')
  }

  const equiposVistos = new Set()
  const filasEquipos = []
  for (const e of equipos) {
    if (!esObjeto(e) || !esId(e.id)) falla('equipo mal formado')
    if (equiposVistos.has(e.id)) falla(`equipo repetido ${e.id}`)
    if (!participantes.includes(e.id)) falla(`equipo inesperado ${e.id}`)
    equiposVistos.add(e.id)
    filasEquipos.push({ id: e.id, ligaId: idONulo(e.ligaId) })
  }
  filasEquipos.sort((a, b) => cmp(a.id, b.id))

  const jugadoresVistos = new Set()
  const activos = []
  for (const j of jugadores) {
    if (!esObjeto(j) || !esId(j.id) || !esId(j.equipoId)) falla('jugador mal formado')
    if (jugadoresVistos.has(j.id)) falla(`jugador repetido ${j.id}`)
    if (!participantes.includes(j.equipoId)) falla(`jugador de un equipo inesperado (${j.equipoId})`)
    jugadoresVistos.add(j.id)
    // Los inactivos se validan pero no entran: no cuentan para estar listo.
    if (activoDe(j)) activos.push({ id: j.id, equipoId: j.equipoId, dorsal: dorsalDe(j) })
  }
  activos.sort((a, b) => cmp(a.id, b.id))

  const contenido = {
    gameId,
    partido: ref,
    liga: liga ? { id: idONulo(liga.id) } : null,
    equipos: filasEquipos,
    consultaEquipos: consulta,
    jugadores: activos,
  }
  return { version: huella(canonico(contenido)), ...contenido }
}

const CLAVES = ['version', 'gameId', 'partido', 'liga', 'equipos', 'consultaEquipos', 'jugadores']

/**
 * ¿Es un contexto completo, en forma normalizada y con su huella correcta? Nunca lanza: ante cualquier cosa
 * rara devuelve false. Con `gameId` además exige que sea el del partido esperado.
 * Una huella correcta y un id coincidente NO prueban de dónde salió el contexto.
 */
export function preparacionIntegra(prep, opciones) {
  try {
    const gameId = opciones?.gameId
    if (!esObjeto(prep)) return false
    const claves = Object.keys(prep)
    if (claves.length !== CLAVES.length || !CLAVES.every((k) => claves.includes(k))) return false
    if (typeof prep.version !== 'string' || prep.version === '') return false
    if (gameId !== undefined && prep.gameId !== gameId) return false
    // Se reconstruye desde sus propias filas: si no da exactamente lo mismo (orden, campos de más,
    // valores fuera de forma, huella), no es un contexto normalizado.
    const de = crearPreparacion({
      gameId: prep.gameId,
      partido: prep.partido,
      liga: prep.liga,
      equipos: prep.equipos,
      jugadores: prep.jugadores,
      consultaEquipos: prep.consultaEquipos,
    })
    return canonico(de) === canonico(prep)
  } catch {
    return false
  }
}

/**
 * Evalúa si el partido `gameId` puede comenzar con este contexto.
 *   { lista: true }
 *   { lista: false, motivo, detalle? }
 * motivo: 'preparacion-no-disponible' (ausente o no íntegro), 'juego-distinto', y los de evaluarProntitud
 * ('equipos-invalidos', 'plantilla-incompleta'). No lanza.
 */
export function evaluarPreparacion(prep, opciones) {
  try {
    const gameId = opciones?.gameId
    if (!preparacionIntegra(prep)) return { lista: false, motivo: 'preparacion-no-disponible' }
    if (prep.gameId !== gameId) return { lista: false, motivo: 'juego-distinto' }
    const r = evaluarProntitud({
      partido: prep.partido,
      liga: prep.liga,
      equipos: prep.equipos,
      jugadores: prep.jugadores,
    })
    return r.lista ? { lista: true } : { lista: false, motivo: r.motivo, detalle: r.detalle }
  } catch {
    return { lista: false, motivo: 'preparacion-no-disponible' }
  }
}
