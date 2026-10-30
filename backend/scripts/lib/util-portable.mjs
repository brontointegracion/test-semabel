// Utilidades compartidas del paquete portable: SHA-256 y CSV (RFC 4180).
import { createHash } from 'node:crypto'

export const sha256Hex = (datos) => createHash('sha256').update(datos).digest('hex')

/** null -> campo vacio SIN comillas; texto vacio -> "" ; texto que empieza por = + - @ TAB CR lleva un apostrofo delante (proteccion contra formulas de hoja de calculo). */
export function celdaCsv(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  let s = String(v)
  if (s === '') return '""'
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
const valorCsv = (campo, v) => (campo.tipo === 'json' && v !== null && v !== undefined ? JSON.stringify(v) : v)
/** `campos`: [{ nombre, tipo }]; UTF-8 sin BOM, CRLF, cabecera primero. */
export function csvDeCampos(campos, filas) {
  const lineas = [campos.map((c) => c.nombre).join(',')]
  for (const f of filas) lineas.push(campos.map((c) => celdaCsv(valorCsv(c, f[c.nombre]))).join(','))
  return `${lineas.join('\r\n')}\r\n`
}
export const aJson = (v) => `${JSON.stringify(v, null, 2)}\n`
