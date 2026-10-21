import { ID_PUBLICO } from './config.js'

// ---------------------------------------------------------------------------
// Cliente de las lecturas PÚBLICAS. Solo cuatro rutas de la API (más el archivo estático de medios del piloto, ver rutaMedios), siempre GET, siempre del mismo origen y sin credenciales:
//
//   GET /v1/ligas/{liga}/publico
//   GET /v1/ligas/{liga}/partidos/{juego}
//   GET /v1/ligas/{liga}/equipos/{equipo}/publico
//   GET /v1/ligas/{liga}/jugadores/publico
//
// Nunca envía cookies del organizador ni tokens de partido (`credentials: 'omit'`), no lee eventos crudos ni el estado
// protegido (/estado, /preparacion, /comandos no se construyen aquí), no guarda nada (ni caché, ni IndexedDB, ni
// localStorage) y no inventa datos si falla. Límites: 512 KiB de respuesta, 8 s de espera por petición. No reintenta por su
// cuenta: quien lo llama (recurso.js) decide cuándo, con recuperación acotada.
// ---------------------------------------------------------------------------

export const LIMITE_BYTES = 512 * 1024
export const TIEMPO_ESPERA_MS = 8000
export const MAX_REINTENTO_MS = 3_600_000

export function rutaLiga(ligaId) {
  if (!ID_PUBLICO.test(ligaId)) throw new Error('liga-invalida')
  return `/v1/ligas/${ligaId}/publico`
}

export function rutaEquipo(ligaId, equipoId) {
  if (!ID_PUBLICO.test(ligaId) || !ID_PUBLICO.test(equipoId)) throw new Error('id-invalido')
  return `/v1/ligas/${ligaId}/equipos/${equipoId}/publico`
}

export function rutaJugadores(ligaId) {
  if (!ID_PUBLICO.test(ligaId)) throw new Error('liga-invalida')
  return `/v1/ligas/${ligaId}/jugadores/publico`
}

/** Archivo estático que el piloto edita a mano (logos y patrocinadores): public/medios/manifest.json. Mismo origen, sin credenciales. */
export const rutaMedios = () => '/medios/manifest.json'

export function rutaJuego(ligaId, gameId) {
  if (!ID_PUBLICO.test(ligaId) || !ID_PUBLICO.test(gameId)) throw new Error('id-invalido')
  return `/v1/ligas/${ligaId}/partidos/${gameId}`
}

/** Retry-After: segundos enteros o fecha HTTP → ms (acotado), o null. */
export function reintentoDe(cabecera, ahoraMs = Date.now()) {
  if (typeof cabecera !== 'string' || cabecera.trim() === '') return null
  const t = cabecera.trim()
  if (/^\d{1,7}$/.test(t)) return Math.min(Number(t) * 1000, MAX_REINTENTO_MS)
  const fecha = Date.parse(t)
  return Number.isFinite(fecha) ? Math.min(Math.max(0, fecha - ahoraMs), MAX_REINTENTO_MS) : null
}

async function leerAcotado(respuesta) {
  const declarado = Number(respuesta.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) return null
  if (!respuesta.body?.getReader) {
    const t = await respuesta.text()
    return t.length > LIMITE_BYTES ? null : t
  }
  const lector = respuesta.body.getReader()
  const decodificador = new TextDecoder()
  let total = 0
  let t = ''
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > LIMITE_BYTES) { try { await lector.cancel() } catch { /* ya cerrado */ } return null }
    t += decodificador.decode(value, { stream: true })
  }
  return t + decodificador.decode()
}

/**
 * GET acotado. → uno de:
 *   { tipo: 'ok', cuerpo, monoInicio, monoFin }       200 con JSON
 *   { tipo: 'no-encontrado' }                        404
 *   { tipo: 'demasiado-grande' }                     507 (la liga rebasa los topes del servidor)
 *   { tipo: 'no-disponible', reintentoMs }           503 resumen-no-disponible
 *   { tipo: 'http', status, reintentoMs }            cualquier otro estado
 *   { tipo: 'malformado' }                           respuesta que no es JSON, demasiado grande o de otro tipo
 *   { tipo: 'red' }                                  sin red o tiempo agotado
 *   { tipo: 'cancelado' }                            la cancelaron quienes la pidieron
 */
export async function pedirJson(ruta, { senal, mono = () => performance.now(), obtener = (...a) => globalThis.fetch(...a) } = {}) {
  if (senal?.aborted) return { tipo: 'cancelado' }
  const control = new AbortController()
  const alCancelar = () => control.abort()
  senal?.addEventListener('abort', alCancelar, { once: true })
  const temporizador = setTimeout(() => control.abort(), TIEMPO_ESPERA_MS)
  const monoInicio = mono()
  try {
    const respuesta = await obtener(ruta, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' }, signal: control.signal,
    })
    const monoFin = mono()
    const reintentoMs = reintentoDe(respuesta.headers.get('retry-after'))
    if (respuesta.status === 404) return { tipo: 'no-encontrado' }
    if (respuesta.status === 507) return { tipo: 'demasiado-grande' }
    if (respuesta.status !== 200) {
      if (respuesta.status === 503) {
        const t = await leerAcotado(respuesta).catch(() => null)
        let c = null
        try { c = JSON.parse(t) } catch { /* no es JSON */ }
        if (c?.error === 'resumen-no-disponible') return { tipo: 'no-disponible', reintentoMs: reintentoMs ?? 0 }
      }
      return { tipo: 'http', status: respuesta.status, reintentoMs: reintentoMs ?? 0 }
    }
    if (!(respuesta.headers.get('content-type') ?? '').includes('application/json')) return { tipo: 'malformado' }
    const t = await leerAcotado(respuesta)
    if (t === null) return { tipo: 'malformado' }
    let cuerpo
    try { cuerpo = JSON.parse(t) } catch { return { tipo: 'malformado' } }
    return { tipo: 'ok', cuerpo, monoInicio, monoFin }
  } catch {
    if (senal?.aborted) return { tipo: 'cancelado' }
    return { tipo: 'red' }
  } finally {
    clearTimeout(temporizador)
    senal?.removeEventListener('abort', alCancelar)
  }
}
