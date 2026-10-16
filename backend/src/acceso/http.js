import { leerJsonConLimite } from '../cuerpo.js'
import { MAX_CUERPO_ACCESO_BYTES } from './config.js'

// Utilidades HTTP de las rutas de acceso: respuestas sin caché, cookie de sesión, protección CSRF y lectura de
// cuerpos acotados. Nada aquí registra cuerpos, cabeceras ni cookies.

export const NOMBRE_COOKIE = '__Host-sesion'
const MAX_COOKIE_HEADER = 4096

const CABECERAS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

export const responder = (status, cuerpo, extra = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CABECERAS, ...extra } })

export const noEncontrado = () => responder(404, { error: 'no-encontrado' })
export const noAutorizado = () => responder(401, { error: 'no-autorizado' })
export const metodoNoPermitido = (permitido) => responder(405, { error: 'metodo-no-permitido' }, { allow: permitido })

/** Cuerpo JSON de tamaño acotado (por defecto 4 KiB), leído por flujo. → { valor } | { error: Response } */
export async function leerJsonAcotado(request, max = MAX_CUERPO_ACCESO_BYTES) {
  const r = await leerJsonConLimite(request, max)
  return 'valor' in r ? { valor: r.valor } : { error: responder(r.estado, { error: r.error }) }
}

export function leerCookieDeSesion(request) {
  const cabecera = request.headers.get('cookie')
  if (typeof cabecera !== 'string' || cabecera.length === 0 || cabecera.length > MAX_COOKIE_HEADER) return null
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=')
    if (i > 0 && trozo.slice(0, i).trim() === NOMBRE_COOKIE) return trozo.slice(i + 1).trim()
  }
  return null
}

/** Host-only (`__Host-`), solo HTTPS, no legible por scripts y nunca en peticiones entre sitios. */
export const cookieDeSesion = (valor, maxAgeSegundos) =>
  `${NOMBRE_COOKIE}=${valor}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSegundos}`
export const cookieBorrada = () => `${NOMBRE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`

/**
 * Protección CSRF para peticiones que escriben con cookie. Defensa en capas además de SameSite=Strict:
 *   - Origin EXACTAMENTE el configurado (el navegador lo pone; una página de otro sitio no puede falsearlo);
 *   - cabecera propia X-Sebel-Peticion: 1 (obliga a una petición "con preflight" desde otro origen);
 *   - tipo de contenido JSON;
 *   - si el navegador envía Sec-Fetch-Site, debe ser same-origin.
 * Devuelve null si pasa, o la respuesta 403 genérica.
 */
export function rechazoCsrf(request, config) {
  const prohibido = () => responder(403, { error: 'prohibido' })
  if (request.headers.get('origin') !== config.origen) return prohibido()
  if (request.headers.get('x-sebel-peticion') !== '1') return prohibido()
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return prohibido()
  const sitio = request.headers.get('sec-fetch-site')
  if (sitio !== null && sitio !== 'same-origin') return prohibido()
  return null
}
