import { MENSAJES } from '../acceso-api'

// ---------------------------------------------------------------------------
// Cliente de la activación del teléfono (mismo origen). Reglas:
//   - ninguna llamada envía cookies (`credentials: 'omit'`): el teléfono no es el organizador;
//   - sin caché, sin redirecciones, con tiempo máximo; nada del servidor se muestra tal cual;
//   - una respuesta que no sea JSON (por ejemplo la página de la aplicación) nunca es un éxito;
//   - el código solo viaja en el cuerpo de UNA petición POST; el token solo en la cabecera Authorization de la lectura;
//     ninguno va en una URL, y nunca se registra nada;
//   - sin conexión no se envía nada.
//
// Clasificación de un INTENTO de activación:
//   activada       200 con { deviceId, partidoId } del partido pedido
//   denegada       401 (siempre el mismo: no dice la causa)
//   limitada       429
//   no-encontrada  404
//   protocolo      400, 403, 405, 413, 422: la petición no llegó a decidirse
//   incierta       todo lo demás: fallo de red, tiempo agotado, 5xx, 503 resultado-desconocido, cuerpo ilegible o inesperado
// Clasificación de la LECTURA (sondeo) protegida del estado:
//   vigente                    200 íntegro de ESTE partido
//   confirmada-sin-estado      507 con EXACTAMENTE { error: 'estado-demasiado-grande' } (solo ocurre tras autorizar)
//   sin-credencial             401 (revocada, vencida, solo recibos, de otro partido o desconocida: no se distingue)
//   no-encontrada              404
//   incierta                   todo lo demás
// ---------------------------------------------------------------------------

export const SIN_CONEXION = MENSAJES['sin-conexion']
export const TIEMPO_MAXIMO_MS = 30_000
const ESTADOS_PARTIDO = ['programado', 'vivo', 'final']

const esJson = (r) => /^application\/json\b/i.test(r.headers.get('content-type') ?? '')
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hayConexion = () => !(typeof navigator !== 'undefined' && navigator.onLine === false)
const enteroONulo = (v) => v === null || Number.isSafeInteger(v)

/** → { sinConexion: true } | { red: true } | { respuesta } . No lanza. */
async function pedir(metodo, ruta, { cuerpo, token } = {}) {
  if (!hayConexion()) return { sinConexion: true }
  const control = typeof AbortController !== 'undefined' ? new AbortController() : null
  const reloj = control ? setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS) : null
  try {
    const respuesta = await fetch(ruta, {
      method: metodo,
      headers: {
        accept: 'application/json',
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: cuerpo,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: control?.signal,
    })
    return { respuesta }
  } catch {
    return { red: true } // sin respuesta: puede que la petición sí llegara
  } finally {
    if (reloj) clearTimeout(reloj)
  }
}

async function jsonDe(respuesta) {
  if (!esJson(respuesta)) return null
  try { return await respuesta.json() } catch { return null }
}

const rutaPartido = (ligaId, partidoId) => `/v1/ligas/${ligaId}/partidos/${partidoId}`

/** Un intento de activación. → { clase, ... }. No lanza. */
export async function activar({ ligaId, partidoId, codigo, tokenHash }) {
  const r = await pedir('POST', `${rutaPartido(ligaId, partidoId)}/activar`, { cuerpo: JSON.stringify({ codigo, tokenHash }) })
  if (r.sinConexion) return { clase: 'sin-conexion' }
  if (r.red) return { clase: 'incierta', motivo: 'red' }
  const { respuesta } = r
  const estado = respuesta.status
  if (estado === 401) return { clase: 'denegada' }
  if (estado === 429) return { clase: 'limitada' }
  if (estado === 404) return { clase: 'no-encontrada' }
  if ([400, 403, 405, 413, 422].includes(estado)) return { clase: 'protocolo', estado }
  if (estado === 200) {
    const c = await jsonDe(respuesta)
    const ok = esObjeto(c) && typeof c.deviceId === 'string' && c.deviceId.length >= 1 && c.deviceId.length <= 200 && c.partidoId === partidoId
    return ok ? { clase: 'activada', deviceId: c.deviceId } : { clase: 'incierta', motivo: 'respuesta-inesperada' }
  }
  return { clase: 'incierta', motivo: 'servidor' }
}

/** Lectura protegida del estado, solo para saber si la credencial vale AHORA. → { clase, datos? }. No lanza. */
export async function sondear({ ligaId, partidoId, token }) {
  const r = await pedir('GET', `${rutaPartido(ligaId, partidoId)}/estado`, { token })
  if (r.sinConexion) return { clase: 'sin-conexion' }
  if (r.red) return { clase: 'incierta', motivo: 'red' }
  const { respuesta } = r
  const estado = respuesta.status
  if (estado === 401) return { clase: 'sin-credencial' }
  if (estado === 404) return { clase: 'no-encontrada' }
  if (estado === 507) {
    const c = await jsonDe(respuesta)
    const exacto = esObjeto(c) && Object.keys(c).length === 1 && c.error === 'estado-demasiado-grande'
    return exacto ? { clase: 'confirmada-sin-estado' } : { clase: 'incierta', motivo: 'respuesta-inesperada' }
  }
  if (estado === 200) {
    const c = await jsonDe(respuesta)
    const ok = esObjeto(c) && c.version === 1 && c.gameId === partidoId
      && typeof c.deviceId === 'string' && c.deviceId.length >= 1 && c.deviceId.length <= 200
      && Number.isSafeInteger(c.servidorAhoraMs)
      && esObjeto(c.credencial) && enteroONulo(c.credencial.expiraEn) && enteroONulo(c.credencial.retornoHasta)
      && esObjeto(c.estado) && esObjeto(c.estado.partido) && ESTADOS_PARTIDO.includes(c.estado.partido.estado)
    if (!ok) return { clase: 'incierta', motivo: 'respuesta-inesperada' }
    return {
      clase: 'vigente',
      datos: {
        deviceId: c.deviceId,
        servidorAhoraMs: c.servidorAhoraMs,
        expiraEn: c.credencial.expiraEn,
        retornoHasta: c.credencial.retornoHasta,
        estadoPartido: c.estado.partido.estado,
      },
    }
  }
  return { clase: 'incierta', motivo: 'servidor' }
}

/** Vista previa PÚBLICA para confirmar que es el partido correcto. → { clase: 'ok', datos } | 'no-encontrada' | 'incierta' | 'sin-conexion' */
export async function leerPartidoPublico({ ligaId, partidoId }) {
  const r = await pedir('GET', rutaPartido(ligaId, partidoId))
  if (r.sinConexion) return { clase: 'sin-conexion' }
  if (r.red) return { clase: 'incierta', motivo: 'red' }
  const { respuesta } = r
  if (respuesta.status === 404) return { clase: 'no-encontrada' }
  if (respuesta.status !== 200) return { clase: 'incierta', motivo: 'servidor' }
  const c = await jsonDe(respuesta)
  const texto = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200
  const ok = esObjeto(c) && c.gameId === partidoId && esObjeto(c.liga) && texto(c.liga.nombre)
    && esObjeto(c.local) && texto(c.local.nombre) && esObjeto(c.visita) && texto(c.visita.nombre)
    && (c.estado === null || ESTADOS_PARTIDO.includes(c.estado))
  if (!ok) return { clase: 'incierta', motivo: 'respuesta-inesperada' }
  return { clase: 'ok', datos: { liga: c.liga.nombre, local: c.local.nombre, visita: c.visita.nombre, estado: c.estado } }
}
