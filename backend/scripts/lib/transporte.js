// ---------------------------------------------------------------------------
// Transporte de las herramientas de carga del operador (ejecutor de plantillas y herramienta de operador).
// Sin dependencias de Node (solo URL, AbortSignal y el `fetch` que se le entrega): corre igual en Node y en las pruebas del backend.
//
//   DESTINO   por omisión, SOLO loopback (127.0.0.1, ::1, localhost). Un destino remoto exige un opt-in explícito (`remoto: true`) Y
//             que el texto sea EXACTAMENTE el origen aprobado de producción. No hay lista configurable ni comodines: otro esquema,
//             puerto, usuario/clave en la dirección, ruta, consulta, fragmento, mayúsculas o cualquier otro nombre se rechazan.
//   ENTORNO   en un destino remoto no se ejecuta si la verificación TLS está desactivada (NODE_TLS_REJECT_UNAUTHORIZED=0) ni si hay
//             autoridades certificadoras adicionales (NODE_EXTRA_CA_CERTS): hay que usar la verificación normal del sistema.
//   PETICIÓN  cada petición va a ese origen y a ningún otro, con `redirect: 'manual'` y un tiempo máximo. Una redirección (3xx) se
//             trata como fallo: nunca se sigue, así que ni la cookie ni el Bearer se reenvían a otro lugar. Un fallo (red, tiempo,
//             redirección) en una mutación es «incierto» para quien llama: se repite lo IDÉNTICO, nunca con otro identificador.
// ---------------------------------------------------------------------------

export const ORIGEN_REMOTO_APROBADO = 'https://semabel.com'
export const TIEMPO_PREDETERMINADO_MS = 15_000
export const TIEMPO_MINIMO_MS = 1_000
export const TIEMPO_MAXIMO_MS = 60_000

/** → { origen, remoto:false } | { error }. Sin usuario, ruta, consulta ni fragmento; solo http(s) hacia 127.0.0.1, ::1 o localhost. */
export function validarOrigenLocal(texto) {
  let u
  try { u = new URL(texto) } catch { return { error: 'origen-invalido' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'origen-invalido' }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return { error: 'origen-invalido' }
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)) return { error: 'origen-no-local' }
  return { origen: u.origin, remoto: false }
}

/** → { origen, remoto } | { error }. Con `remoto` falso es exactamente el comportamiento local de siempre. */
export function validarDestino(texto, { remoto = false } = {}) {
  if (!remoto) return validarOrigenLocal(texto)
  if (typeof texto !== 'string') return { error: 'origen-invalido' }
  // Comparación del TEXTO recibido, no del resultado de URL(): así «HTTPS://SEMABEL.COM», «:443», una barra final u otra variante no pasan.
  if (texto !== ORIGEN_REMOTO_APROBADO) return { error: 'origen-remoto-no-aprobado' }
  return { origen: ORIGEN_REMOTO_APROBADO, remoto: true }
}

/** Código de bloqueo o null. `entorno` es el objeto de variables (process.env en la línea de comandos). */
export function bloqueoDeEntorno(entorno, destino) {
  if (!destino?.remoto) return null
  const e = entorno ?? {}
  if (String(e.NODE_TLS_REJECT_UNAUTHORIZED ?? '').trim() === '0') return 'tls-verificacion-desactivada'
  if (e.NODE_EXTRA_CA_CERTS) return 'ca-adicional-no-permitida'
  return null
}

/** Tiempo por petición: entero entre 1 s y 60 s. → número | null si no es válido. */
export function tiempoValido(valor) {
  if (valor === undefined || valor === null || valor === '') return TIEMPO_PREDETERMINADO_MS
  const n = typeof valor === 'number' ? valor : /^[0-9]{1,6}$/.test(String(valor)) ? Number(valor) : NaN
  return Number.isSafeInteger(n) && n >= TIEMPO_MINIMO_MS && n <= TIEMPO_MAXIMO_MS ? n : null
}

/**
 * Envuelve `fetch` para un destino ya validado. Lanza si la dirección sale del origen, si hay redirección o si se agota el tiempo
 * (quien llama lo trata como resultado desconocido). No añade ni quita cabeceras: las credenciales las pone quien llama.
 */
export function crearTransporte({ fetch: f, destino, tiempoMs = TIEMPO_PREDETERMINADO_MS }) {
  return async (url, init = {}) => {
    let u
    try { u = new URL(String(url)) } catch { throw new Error('direccion-invalida') }
    if (u.origin !== destino.origen) throw new Error('origen-distinto')
    const r = await f(String(url), { ...init, redirect: 'manual', signal: AbortSignal.timeout(tiempoMs) })
    if (r.status >= 300 && r.status < 400) throw new Error('redireccion-rechazada')
    if (r.type === 'opaqueredirect') throw new Error('redireccion-rechazada')
    return r
  }
}
