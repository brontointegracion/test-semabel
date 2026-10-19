// ---------------------------------------------------------------------------
// Cliente del organizador para el acceso de puntuación de UN partido (mismo origen). Dos rutas, ambas con la cookie HttpOnly:
//   GET  /v1/organizador/ligas/{liga}/partidos/{juego}/control   estado del control, SIN secretos (lectura)
//   POST /v1/organizador/ligas/{liga}/partidos/{juego}/codigo    emite el código del partido (mutación; se muestra UNA vez)
//   POST /v1/organizador/ligas/{liga}/partidos/{juego}/control/revocar   retira el acceso del teléfono (mutación; SOLO antes del inicio)
// Reglas:
//   - la emisión es una mutación NO idempotente: emitir otro código anula el que siga sin usar. Aquí nunca se repite sola:
//     un fallo sin respuesta clara es «incierto» y quien llama decide, con una acción explícita de la persona;
//   - el código solo vive en el valor devuelto: no se registra, no va en ninguna URL y no se guarda en ningún almacenamiento;
//   - nada del servidor se muestra tal cual: cada resultado se reduce a un tipo fijo;
//   - sin conexión no se envía nada.
// ---------------------------------------------------------------------------

export const TIEMPO_MAXIMO_MS = 30_000
const ID = /^[A-Za-z0-9_-]{1,64}$/
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const esJson = (r) => /^application\/json\b/i.test(r.headers.get('content-type') ?? '')
const hayConexion = () => !(typeof navigator !== 'undefined' && navigator.onLine === false)

export const rutaControl = (ligaId, partidoId) => `/v1/organizador/ligas/${ligaId}/partidos/${partidoId}/control`
export const rutaRevocar = (ligaId, partidoId) => `/v1/organizador/ligas/${ligaId}/partidos/${partidoId}/control/revocar`
export const rutaCodigo = (ligaId, partidoId) => `/v1/organizador/ligas/${ligaId}/partidos/${partidoId}/codigo`

const ESTADOS_PARTIDO = ['programado', 'vivo', 'final']
const CREDENCIALES = ['ninguna', 'activa', 'solo-recibos', 'vencida']
const controlValido = (d) => esObjeto(d) && ESTADOS_PARTIDO.includes(d.partido) && typeof d.codigoPendiente === 'boolean'
  && (d.codigoExpiraEn === null || Number.isFinite(d.codigoExpiraEn)) && CREDENCIALES.includes(d.credencial)

/** Lectura. → { tipo: 'ok', datos } | 'sin-conexion' | 'no-autorizado' | 'no-encontrado' | 'incierto' | 'red' */
export async function leerControl(ligaId, partidoId) {
  if (!ID.test(ligaId) || !ID.test(partidoId)) return { tipo: 'no-encontrado' }
  if (!hayConexion()) return { tipo: 'sin-conexion' }
  let r
  try {
    r = await fetch(rutaControl(ligaId, partidoId), { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  } catch {
    return { tipo: 'red' }
  }
  if (r.status === 401) return { tipo: 'no-autorizado' }
  if (r.status === 404) return { tipo: 'no-encontrado' }
  if (r.status === 200 && esJson(r)) {
    try {
      const d = await r.json()
      return controlValido(d) ? { tipo: 'ok', datos: { partido: d.partido, codigoPendiente: d.codigoPendiente, codigoExpiraEn: d.codigoExpiraEn, credencial: d.credencial } } : { tipo: 'incierto' }
    } catch {
      return { tipo: 'incierto' }
    }
  }
  return { tipo: 'incierto' }
}

/**
 * Emisión (UNA petición, sin reintento). → uno de:
 *   { tipo: 'emitido', codigo, expiraEn }   200 con un código para ESTE partido
 *   { tipo: 'sin-conexion' }                no se envió nada
 *   { tipo: 'sesion' }                      401
 *   { tipo: 'partido-iniciado' }            409: el partido ya no está programado (nada se emitió)
 *   { tipo: 'no-encontrado' }               404
 *   { tipo: 'protocolo' }                   400, 403, 413 o 422: la petición no llegó a decidirse
 *   { tipo: 'incierto' }                    todo lo demás (red, tiempo agotado, 5xx, 503 resultado desconocido, cuerpo ilegible):
 *                                           puede que el servidor SÍ emitiera un código que nadie vio
 */
export async function emitirCodigo(ligaId, partidoId) {
  if (!ID.test(ligaId) || !ID.test(partidoId)) return { tipo: 'no-encontrado' }
  if (!hayConexion()) return { tipo: 'sin-conexion' }
  const control = typeof AbortController !== 'undefined' ? new AbortController() : null
  const reloj = control ? setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS) : null
  let r
  try {
    r = await fetch(rutaCodigo(ligaId, partidoId), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sebel-peticion': '1' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: control?.signal,
    })
  } catch {
    return { tipo: 'incierto' }
  } finally {
    if (reloj) clearTimeout(reloj)
  }
  if (r.status === 401) return { tipo: 'sesion' }
  if (r.status === 404) return { tipo: 'no-encontrado' }
  if (r.status === 409) return { tipo: 'partido-iniciado' }
  if ([400, 403, 413, 422].includes(r.status)) return { tipo: 'protocolo' }
  if (r.status === 200 && esJson(r)) {
    try {
      const d = await r.json()
      if (esObjeto(d) && d.partidoId === partidoId && typeof d.codigo === 'string' && d.codigo.length > 0 && d.codigo.length <= 64 && Number.isFinite(d.expiraEn)) {
        return { tipo: 'emitido', codigo: d.codigo, expiraEn: d.expiraEn }
      }
    } catch { /* cuerpo ilegible: abajo */ }
  }
  return { tipo: 'incierto' }
}

/**
 * Retiro del acceso del teléfono (UNA petición, sin reintento), SOLO antes del inicio. Contrato del servidor (acceso/rutas.js + codigos-partido.js):
 * una transacción atómica que revoca TODAS las credenciales no revocadas del partido y los códigos sin usar, y sube la versión de autorización
 * si había alguna; 409 si el partido ya no está programado. Repetirla es inofensiva pero no se hace sola. → uno de:
 *   { tipo: 'revocado', credencialesRevocadas }   200 {ok:true, credencialesRevocadas: n}; con n = 0 no había nada que retirar
 *   { tipo: 'sin-conexion' }                      no se envió nada
 *   { tipo: 'sesion' }                            401 (sesión caducada, o la liga no es de este organizador)
 *   { tipo: 'partido-iniciado' }                  409: el partido ya no está programado (nada se cambió)
 *   { tipo: 'no-encontrado' }                     404
 *   { tipo: 'protocolo' }                         400, 403, 413 o 422: rechazada antes de decidirse (nada se cambió)
 *   { tipo: 'incierto' }                          todo lo demás (red, tiempo agotado, 5xx, 503 resultado desconocido, cuerpo ilegible):
 *                                                 puede que el servidor SÍ retirara el acceso; solo una lectura lo aclara
 */
export async function revocarControl(ligaId, partidoId) {
  if (!ID.test(ligaId) || !ID.test(partidoId)) return { tipo: 'no-encontrado' }
  if (!hayConexion()) return { tipo: 'sin-conexion' }
  const control = typeof AbortController !== 'undefined' ? new AbortController() : null
  const reloj = control ? setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS) : null
  let r
  try {
    r = await fetch(rutaRevocar(ligaId, partidoId), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sebel-peticion': '1' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: control?.signal,
    })
  } catch {
    return { tipo: 'incierto' }
  } finally {
    if (reloj) clearTimeout(reloj)
  }
  if (r.status === 401) return { tipo: 'sesion' }
  if (r.status === 404) return { tipo: 'no-encontrado' }
  if (r.status === 409) return { tipo: 'partido-iniciado' }
  if ([400, 403, 413, 422].includes(r.status)) return { tipo: 'protocolo' }
  if (r.status === 200 && esJson(r)) {
    try {
      const d = await r.json()
      if (esObjeto(d) && d.ok === true && Number.isSafeInteger(d.credencialesRevocadas) && d.credencialesRevocadas >= 0 && d.credencialesRevocadas <= 100) {
        return { tipo: 'revocado', credencialesRevocadas: d.credencialesRevocadas }
      }
    } catch { /* cuerpo ilegible: abajo */ }
  }
  return { tipo: 'incierto' }
}
