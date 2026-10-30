// ZIP minimo y determinista (sin dependencias): escritor y lector. El lector valida nombres (sin rutas absolutas ni `..`), CRC, tamanos y limites antes de extraer.
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { closeSync, existsSync, fstatSync, openSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const TABLA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLA[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export const LIMITES_ZIP = Object.freeze({ entradas: 64, bytesDescomprimidos: 64 * 1024 * 1024, bytesZip: 64 * 1024 * 1024 })
export class ErrorZip extends Error { constructor(codigo) { super(codigo); this.name = 'ErrorZip'; this.codigo = codigo } }
const falla = (c) => { throw new ErrorZip(c) }

function fechaDos(iso) {
  const d = new Date(Number.isFinite(Date.parse(iso)) ? iso : '1980-01-01T00:00:00Z')
  const y = Math.max(1980, d.getUTCFullYear())
  return { hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), fecha: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() }
}

/** entradas: [{ nombre, datos: Buffer }] -> Buffer del ZIP. Orden dado; fecha fija; UTF-8; permisos 0600 en los atributos. */
export function crearZip(entradas, { fechaIso }) {
  if (entradas.length > LIMITES_ZIP.entradas) falla('demasiadas-entradas')
  const { hora, fecha } = fechaDos(fechaIso)
  const locales = []
  const centrales = []
  let desplazamiento = 0
  for (const { nombre, datos } of entradas) {
    const n = Buffer.from(nombre, 'utf8')
    const comp = deflateRawSync(datos, { level: 9 })
    const crc = crc32(datos)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(hora, 10); lh.writeUInt16LE(fecha, 12)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(0, 28)
    locales.push(lh, n, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(hora, 12); ch.writeUInt16LE(fecha, 14)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(n.length, 28)
    ch.writeUInt32LE(((0o100600 << 16) >>> 0), 38); ch.writeUInt32LE(desplazamiento, 42)
    centrales.push(ch, n)
    desplazamiento += lh.length + n.length + comp.length
  }
  const cd = Buffer.concat(centrales)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(desplazamiento, 16)
  return Buffer.concat([...locales, cd, fin])
}

const NOMBRE_SEGURO = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/
/** Buffer del ZIP -> [{ nombre, datos }] validado. No extrae nada a disco. */
export function leerZip(buf) {
  if (buf.length > LIMITES_ZIP.bytesZip || buf.length < 22) falla('zip-invalido')
  let fin = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break }
  if (fin < 0) falla('zip-sin-directorio-central')
  const n = buf.readUInt16LE(fin + 10); const tam = buf.readUInt32LE(fin + 12); const ini = buf.readUInt32LE(fin + 16)
  if (n > LIMITES_ZIP.entradas || buf.readUInt16LE(fin + 8) !== n || ini + tam > fin) falla('zip-invalido')
  const salida = []
  const vistos = new Set()
  let total = 0
  let p = ini
  for (let i = 0; i < n; i += 1) {
    if (p + 46 > fin || buf.readUInt32LE(p) !== 0x02014b50) falla('zip-invalido')
    const flags = buf.readUInt16LE(p + 8); const metodo = buf.readUInt16LE(p + 10); const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24); const ln = buf.readUInt16LE(p + 28); const le = buf.readUInt16LE(p + 30); const lc = buf.readUInt16LE(p + 32); const off = buf.readUInt32LE(p + 42)
    if ((flags & 1) !== 0 || (metodo !== 0 && metodo !== 8)) falla('zip-no-soportado')
    const nombre = buf.subarray(p + 46, p + 46 + ln).toString('utf8')
    if (!NOMBRE_SEGURO.test(nombre) || nombre.split('/').includes('..') || nombre.startsWith('/') || vistos.has(nombre)) falla('zip-nombre-no-seguro')
    vistos.add(nombre)
    total += usize
    if (total > LIMITES_ZIP.bytesDescomprimidos) falla('zip-demasiado-grande')
    if (off + 30 > fin || buf.readUInt32LE(off) !== 0x04034b50) falla('zip-invalido')
    const lnl = buf.readUInt16LE(off + 26); const lel = buf.readUInt16LE(off + 28)
    const ini2 = off + 30 + lnl + lel
    if (ini2 + csize > fin) falla('zip-invalido')
    const crudo = buf.subarray(ini2, ini2 + csize)
    let datos
    try { datos = metodo === 8 ? inflateRawSync(crudo, { maxOutputLength: LIMITES_ZIP.bytesDescomprimidos }) : Buffer.from(crudo) } catch { falla('zip-corrupto') }
    if (datos.length !== usize || crc32(datos) !== crc) falla('zip-corrupto')
    salida.push({ nombre, datos })
    p += 46 + ln + le + lc
  }
  return salida
}

/** Crea el archivo ZIP NUEVO (wx, 0600). El llamador ya comprobo que la ruta esta fuera de Git. */
export function escribirArchivoNuevo(ruta, contenido) {
  const r = resolve(ruta)
  if (!existsSync(dirname(r))) falla('zip-sin-carpeta-padre')
  const fd = openSync(r, 'wx', 0o600)
  try { writeSync(fd, contenido); if ((fstatSync(fd).mode & 0o077) !== 0) falla('permisos-abiertos') } finally { closeSync(fd) }
}
