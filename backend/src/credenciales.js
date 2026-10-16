// Credenciales con alcance de partido. Solo se guarda el hash; el token nunca se escribe.
// Esto NO es la autenticación de producción (correo verificado del organizador, enlace
// privado + PIN del operador): es el mínimo para que el contrato de autorización se pueda
// ejercer con datos sintéticos.

const aHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(texto) {
  return aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
}

/** Compara dos textos por su hash, en tiempo constante respecto al contenido. */
export async function textosIguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ])
  return crypto.subtle.timingSafeEqual(ha, hb)
}

/** Token de un encabezado `Authorization: Bearer …`, o null. */
export function tokenDeEncabezado(valor) {
  if (typeof valor !== 'string') return null
  const m = /^Bearer ([\x21-\x7e]{1,512})$/.exec(valor)
  return m ? m[1] : null
}
