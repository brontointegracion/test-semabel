import { ID_PUBLICO, ligasConfiguradas } from './config.js'

// ---------------------------------------------------------------------------
// Transmisión de televisión del PILOTO (REPORT_199): UNA dirección estable que sigue una secuencia EXPLÍCITA de partidos.
//
//   Dirección:      /tv/cancha     (la entrada /tv con la lista y las direcciones fijas de cada partido siguen igual)
//   Configuración:  VITE_TV_SECUENCIA="LIGA/PARTIDO,LIGA/PARTIDO,…"   en la compilación, en el orden en que se juegan.
//                   `LIGA` es el id de una liga de VITE_LIGAS_PUBLICAS y `PARTIDO` el id COMPLETO del partido (el de la lectura pública de la liga).
//                   Ausente o vacía → no configurada (el valor por defecto: el repositorio no lleva ningún partido). Mal formada (un par inválido,
//                   un duplicado, una liga que la compilación no lista, demasiados pares) → se descarta ENTERA; nunca «lo que sea válido».
//
// Nunca se deduce una cancha por el texto de la sede ni por la hora. Nada de aquí inicia, termina, activa ni puntúa un partido: solo elige
// QUÉ lectura pública mostrar. Funciones puras (los componentes solo las aplican).
// ---------------------------------------------------------------------------

export const RUTA_TV_CANCHA = '/tv/cancha'
export const MAX_PARTIDOS_SECUENCIA = 8

/** → { ok: true, pares: [{ ligaId, gameId }] } | { ok: false, error: 'sin-configurar' | 'configuracion-invalida' } */
export function interpretarSecuencia(crudo, idsLigas) {
  if (crudo === undefined || crudo === null || crudo === '') return { ok: false, error: 'sin-configurar' }
  const invalida = { ok: false, error: 'configuracion-invalida' }
  if (typeof crudo !== 'string' || crudo.length > MAX_PARTIDOS_SECUENCIA * 131) return invalida
  const trozos = crudo.split(',')
  if (trozos.length > MAX_PARTIDOS_SECUENCIA) return invalida
  const pares = []
  const vistos = new Set()
  for (const t of trozos) {
    const partes = t.split('/')
    if (partes.length !== 2 || !partes.every((p) => ID_PUBLICO.test(p))) return invalida
    const [ligaId, gameId] = partes
    if (!idsLigas.includes(ligaId) || vistos.has(t)) return invalida
    vistos.add(t)
    pares.push({ ligaId, gameId })
  }
  return { ok: true, pares }
}

/** La secuencia de esta compilación. Se lee en cada llamada para que las pruebas puedan fijar el entorno. */
export function secuenciaTv() {
  const ligas = ligasConfiguradas()
  return interpretarSecuencia(import.meta.env.VITE_TV_SECUENCIA, ligas.ok ? ligas.ids : [])
}

/**
 * El ÚNICO partido de la secuencia que se lee a ritmo rápido (REPORT_201): el primero que aún está `programado`, o sea el que la pantalla espera (el
 * primero antes de empezar; el siguiente mientras se juega o se acaba de terminar el anterior). Ningún otro partido futuro, y ninguno si no hay
 * `programado` (p. ej. con la secuencia completa). `estados[i].datos`: lo último confirmado de cada partido.
 */
export const indiceVigilado = (estados) => {
  const i = estados.findIndex((e) => e.datos?.estado === 'programado')
  return i === -1 ? null : i
}

/**
 * Qué muestra el televisor, a partir de la lectura de cada partido de la secuencia (`estados[i]`: { fase, datos } del recurso, en el orden
 * de `pares`). Solo cuenta lo que el servidor confirmó; una lectura que falla CONSERVA el último dato bueno (lo hace el recurso) y nunca
 * hace avanzar la pantalla.
 *
 *   { tipo: 'cargando' }                      aún no hay ninguna lectura
 *   { tipo: 'sin-conexion' }                  ninguna lectura sirve para decidir (falló todo, o falta justo la que decide)
 *   { tipo: 'falta', indices }                el servidor dice que un partido de la secuencia no existe: configuración equivocada
 *   { tipo: 'conflicto', indices }            más de un partido en vivo: no se elige ninguno
 *   { tipo: 'partido', indice, proximo, completa, incompleto }
 *        indice     qué partido de la secuencia se muestra
 *        proximo    índice del partido siguiente (solo con el actual en `final`), o null
 *        completa   el último partido de la secuencia ya está en `final`: no hay más
 *        incompleto alguna lectura de la secuencia aún no tiene datos (el siguiente puede ser desconocido)
 *
 * Reglas: (1) un partido de la secuencia que el servidor no encuentra → 'falta'. (2) Con varios en vivo → 'conflicto'; con exactamente uno,
 * ese. (3) Sin ninguno en vivo, el PENDIENTE es el primer partido que no está confirmado como final: si es el primero, se muestra (por jugar);
 * si hay uno antes, se muestra ese final con el pendiente como próximo; si todos son final, el último y la sesión completa.
 */
export function elegirVistaTv(pares, estados) {
  const faltan = estados.flatMap((e, i) => (e.fase === 'no-encontrado' ? [i] : []))
  if (faltan.length > 0) return { tipo: 'falta', indices: faltan }
  const conDatos = (i) => estados[i].datos !== null
  const todos = pares.map((_, i) => i)
  if (!todos.some(conDatos)) return { tipo: estados.some((e) => e.fase !== 'cargando') ? 'sin-conexion' : 'cargando' }
  const incompleto = !todos.every(conDatos)
  const envivo = todos.filter((i) => conDatos(i) && estados[i].datos.estado === 'vivo')
  if (envivo.length > 1) return { tipo: 'conflicto', indices: envivo }
  if (envivo.length === 1) return { tipo: 'partido', indice: envivo[0], proximo: null, completa: false, incompleto }
  const confirmadoFinal = (i) => conDatos(i) && estados[i].datos.estado === 'final'
  const pendiente = todos.find((i) => !confirmadoFinal(i))
  if (pendiente === undefined) return { tipo: 'partido', indice: pares.length - 1, proximo: null, completa: true, incompleto }
  if (pendiente === 0) return conDatos(0) ? { tipo: 'partido', indice: 0, proximo: null, completa: false, incompleto } : { tipo: 'sin-conexion' }
  return { tipo: 'partido', indice: pendiente - 1, proximo: pendiente, completa: false, incompleto }
}
