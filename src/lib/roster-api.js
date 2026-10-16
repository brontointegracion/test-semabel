import { MENSAJES } from './acceso-api'

// ---------------------------------------------------------------------------
// Cliente de las lecturas y operaciones de plantilla del organizador (mismo origen). Reglas:
//   - la cookie de sesión es HttpOnly: este código nunca la ve;
//   - nada del servidor se muestra tal cual: cada respuesta se reduce a un tipo fijo;
//   - una respuesta que no sea JSON (por ejemplo la página de la aplicación) nunca es un éxito;
//   - SIN conexión no se envía nada (navigator.onLine es solo una pista; los fallos reales de red se tratan aparte).
//
// Clasificación de un INTENTO de operación (lo que describe ese intento; no resuelve un intento anterior incierto):
//   decidido        200 con un resultado válido de ESA operación (aplicado o rechazado)
//   sesion          401
//   conflicto       409 (el mismo identificador con otro contenido: no debería ocurrir)
//   sin-escritura   503 que el servidor declara sin escritura (fallo-sin-escritura, identidad-no-verificable)
//   protocolo       400, 403, 404, 413 o 422: la petición no llegó a decidirse
//   incierto        todo lo demás: fallo de red, tiempo agotado, 5xx, 503 resultado-desconocido, cuerpo ilegible
// ---------------------------------------------------------------------------

export const SIN_CONEXION = MENSAJES['sin-conexion']
export const TIEMPO_MAXIMO_MS = 30_000

const ID = /^[A-Za-z0-9_-]{1,64}$/
export const idValido = (v) => typeof v === 'string' && ID.test(v)

const hayConexion = () => !(typeof navigator !== 'undefined' && navigator.onLine === false)
const esJson = (r) => /^application\/json\b/i.test(r.headers.get('content-type') ?? '')
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export const rutaLiga = (ligaId) => `/v1/organizador/ligas/${ligaId}`
export const rutaJugadores = (ligaId, equipoId) => `${rutaLiga(ligaId)}/equipos/${equipoId}/jugadores`
export const rutaDeOperacion = ({ tipo, ligaId, equipoId, fichaId }) =>
  (tipo === 'alta' ? rutaJugadores(ligaId, equipoId) : `${rutaJugadores(ligaId, equipoId)}/${fichaId}/${tipo}`)

/** Lectura (GET). → { tipo: 'ok', datos } | 'sin-conexion' | 'no-autorizado' | 'no-encontrado' | 'incierto' | 'red' */
async function leer(ruta, valido) {
  if (!hayConexion()) return { tipo: 'sin-conexion' }
  let respuesta
  try {
    respuesta = await fetch(ruta, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  } catch {
    return { tipo: 'red' }
  }
  if (respuesta.status === 401) return { tipo: 'no-autorizado' }
  if (respuesta.status === 404) return { tipo: 'no-encontrado' }
  if (respuesta.status === 200 && esJson(respuesta)) {
    try {
      const datos = await respuesta.json()
      return valido(datos) ? { tipo: 'ok', datos } : { tipo: 'incierto' }
    } catch {
      return { tipo: 'incierto' }
    }
  }
  return { tipo: 'incierto' }
}

const ligaValida = (d) => esObjeto(d) && esObjeto(d.liga) && typeof d.liga.id === 'string' && typeof d.liga.nombre === 'string'
  && Array.isArray(d.equipos) && d.equipos.every((e) => esObjeto(e) && typeof e.id === 'string' && typeof e.nombre === 'string')
const plantillaValida = (d) => esObjeto(d) && esObjeto(d.equipo) && typeof d.bloqueada === 'boolean'
  && Array.isArray(d.activos) && Array.isArray(d.inactivos)
  && [...d.activos, ...d.inactivos].every((j) => esObjeto(j) && typeof j.id === 'string' && Number.isInteger(j.rev))

export const leerLiga = (ligaId) => (idValido(ligaId) ? leer(rutaLiga(ligaId), ligaValida) : Promise.resolve({ tipo: 'no-encontrado' }))
export const leerPlantilla = (ligaId, equipoId) => (idValido(ligaId) && idValido(equipoId)
  ? leer(rutaJugadores(ligaId, equipoId), plantillaValida) : Promise.resolve({ tipo: 'no-encontrado' }))

/**
 * Envía el cuerpo YA CONGELADO (texto) de una operación. Nunca lo reserializa. → { clase, ... } (ver arriba). No lanza.
 * `operacionId` es el que se espera ver en la respuesta decidida.
 */
export async function enviarCuerpo({ ruta, cuerpoJson, operacionId }) {
  const control = typeof AbortController !== 'undefined' ? new AbortController() : null
  const reloj = control ? setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS) : null
  let respuesta
  try {
    respuesta = await fetch(ruta, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sebel-peticion': '1' },
      body: cuerpoJson,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: control?.signal,
    })
  } catch {
    return { clase: 'incierto', motivo: 'red' } // sin respuesta: puede que la petición sí llegara
  } finally {
    if (reloj) clearTimeout(reloj)
  }
  const estado = respuesta.status
  if (estado === 401) return { clase: 'sesion' }
  let cuerpo = null
  if (esJson(respuesta)) {
    try { cuerpo = await respuesta.json() } catch { cuerpo = null }
  }
  if (estado === 200) {
    const ok = esObjeto(cuerpo) && (cuerpo.resultado === 'aplicado' || cuerpo.resultado === 'rechazado')
      && typeof cuerpo.tipo === 'string' && cuerpo.operacionId === operacionId
    return ok ? { clase: 'decidido', cuerpo } : { clase: 'incierto', motivo: 'respuesta-inesperada' }
  }
  if (estado === 409) return { clase: 'conflicto' }
  if (estado === 503) {
    if (esObjeto(cuerpo) && (cuerpo.tipo === 'fallo-sin-escritura' || cuerpo.error === 'identidad-no-verificable')) {
      return { clase: 'sin-escritura', motivo: cuerpo.error === 'identidad-no-verificable' ? 'identidad-no-verificable' : 'servidor' }
    }
    return { clase: 'incierto', motivo: 'servidor' }
  }
  if ([400, 403, 404, 413, 422].includes(estado)) return { clase: 'protocolo', estado }
  return { clase: 'incierto', motivo: 'servidor' }
}
