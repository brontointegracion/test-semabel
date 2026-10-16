// ---------------------------------------------------------------------------
// Códigos de acceso que una persona TECLEA (no van en ninguna URL).
//
//   20 caracteres de un alfabeto de 32 sin letras ambiguas, mostrados en 4 grupos de 5: XXXXX-XXXXX-XXXXX-XXXXX
//   Los 5 primeros son un identificador público de búsqueda (25 bits); los 15 restantes son el secreto (75 bits).
//
//   - Aleatoriedad criptográfica (crypto.getRandomValues). Cada byte aporta 5 bits (b & 31): el sesgo es nulo
//     porque 256 es múltiplo de 32.
//   - El servidor guarda solo el hash SHA-256 del secreto, con separación por tipo de uso. El secreto tiene
//     mucha entropía, así que no hace falta un hash lento.
//   - La comparación de hashes es en tiempo constante (crypto.subtle.timingSafeEqual, sincrónica).
//   - Entrada acotada: más de 64 caracteres, o no texto, se descarta antes de hacer nada más.
// ---------------------------------------------------------------------------

export const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const LONGITUD = 20
const LONGITUD_ID = 5
const MAX_ENTRADA = 64
const VALIDO = /^[0-9A-HJKMNP-TV-Z]{20}$/
const HEX64 = /^[0-9a-f]{64}$/

export const TIPOS_CODIGO = Object.freeze(['organizador', 'partido', 'sesion'])

/** → { texto: 'XXXXX-XXXXX-XXXXX-XXXXX', id: 'XXXXX', secreto: '15 caracteres' } */
export function generarCodigo() {
  const bytes = crypto.getRandomValues(new Uint8Array(LONGITUD))
  const plano = Array.from(bytes, (b) => ALFABETO[b & 31]).join('')
  return {
    texto: plano.match(/.{5}/g).join('-'),
    id: plano.slice(0, LONGITUD_ID),
    secreto: plano.slice(LONGITUD_ID),
  }
}

/** Lo que teclea la persona → los 20 caracteres canónicos, o null. Tolera minúsculas, espacios, guiones y O/I/L. */
export function normalizarCodigo(entrada) {
  if (typeof entrada !== 'string' || entrada.length === 0 || entrada.length > MAX_ENTRADA) return null
  const limpio = entrada.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return VALIDO.test(limpio) ? limpio : null
}

/** → { id, secreto } o null */
export function partirCodigo(entrada) {
  const norm = normalizarCodigo(entrada)
  return norm === null ? null : { id: norm.slice(0, LONGITUD_ID), secreto: norm.slice(LONGITUD_ID) }
}

const aHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Hash hex del secreto, separado por tipo de uso (un secreto de un tipo no sirve como otro). */
export async function hashSecreto(tipo, secreto) {
  if (!TIPOS_CODIGO.includes(tipo) || typeof secreto !== 'string') throw new Error('hash-secreto-invalido')
  return aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sebel-acceso-v1:${tipo}:${secreto}`)))
}

export const esHashHex = (v) => typeof v === 'string' && HEX64.test(v)

/** Igualdad de dos hashes hex en tiempo constante. Sincrónica: se puede usar dentro de transactionSync. */
export function hashesIguales(a, b) {
  if (!esHashHex(a) || !esHashHex(b)) return false
  const enc = new TextEncoder()
  return crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b))
}

/** Token o identificador aleatorio en hexadecimal (2 caracteres por byte). */
export function aleatorioHex(bytes) {
  return aHex(crypto.getRandomValues(new Uint8Array(bytes)))
}
