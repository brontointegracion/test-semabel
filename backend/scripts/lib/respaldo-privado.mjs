// Captura PRIVADA de los respaldos solo lectura (REPORT_246; SOLO Node). Destino exacto (local, o el origen remoto aprobado con --remoto), TLS normal, sin redirecciones, Bearer del
// operador leído de variable o archivo 0600, y NADA de los datos va a la salida: se imprimen nombres de archivo, tamaños y un prefijo de checksum. Los archivos se crean NUEVOS
// (flag `wx`, modo 0600) en una carpeta NUEVA 0700 fuera de cualquier repositorio; nunca se sobrescribe nada.
import { chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { bloqueoDeEntorno, crearTransporte, tiempoValido, validarDestino } from './transporte.js'
import { verificarSellos } from '../../src/respaldo.js'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_BYTES = 64 * 1024 * 1024
export const NOMBRE_MANIFIESTO = 'MANIFIESTO.json'

const sha256Archivo = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Carpeta nueva fuera de cualquier repositorio Git, con el padre ya existente. */
export function carpetaPrivadaNueva(ruta) {
  const r = resolve(ruta)
  for (let d = dirname(r); ; d = dirname(d)) {
    if (existsSync(`${d}/.git`)) throw new Error('dentro-de-un-repositorio')
    if (dirname(d) === d) break
  }
  if (!existsSync(dirname(r))) throw new Error('carpeta-padre-inexistente')
  if (existsSync(r)) throw new Error('carpeta-ya-existe')
  mkdirSync(r, { mode: 0o700 })
  chmodSync(r, 0o700)
  return r
}

function escribirNuevo(ruta, contenido) {
  const fd = openSync(ruta, 'wx', 0o600)
  try { writeSync(fd, contenido); if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error('permisos') } finally { closeSync(fd) }
}

/**
 * Plan sin red: qué se pediría y dónde se guardaría. → { ok, problemas, destino, objetivos:[{ tipo, objeto, archivo }] }
 */
export function planDeCaptura({ origen, remoto = false, entorno = {}, tiempoMs, ligas = [], salida }) {
  const problemas = []
  const destino = validarDestino(origen ?? '', { remoto: remoto === true })
  if (destino.error) problemas.push(destino.error)
  else { const b = bloqueoDeEntorno(entorno, destino); if (b) problemas.push(b) }
  if (tiempoValido(tiempoMs) === null) problemas.push('tiempo-invalido')
  if (!ligas.every((l) => ID.test(l)) || new Set(ligas).size !== ligas.length) problemas.push('ligas')
  if (ligas.length === 0) problemas.push('sin-objetivos')
  if (typeof salida !== 'string' || salida === '') problemas.push('falta-salida')
  const objetivos = ligas.map((l) => ({ tipo: 'liga', objeto: l, archivo: `liga-${l}.json`, marcador: `marcador-liga-${l}.json`, ruta: `/v1/admin/respaldo/ligas/${l}` }))
  return { ok: problemas.length === 0, problemas, destino: destino.origen ?? null, objetivos }
}

/**
 * Captura: un objeto tras otro (NO hay atomicidad entre objetos). Cada exportación se verifica (sellos) antes de guardarla. Se detiene en el primer fallo.
 * → { estado, archivos:[{ nombre, bytes, sha256 }] } sin ningún dato del respaldo.
 */
export async function capturar({ fetch: fCrudo, origen, remoto = false, entorno = {}, tiempoMs, token, ligas = [], salida, ahora = () => new Date().toISOString() }) {
  const plan = planDeCaptura({ origen, remoto, entorno, tiempoMs, ligas, salida })
  if (!plan.ok) return { estado: 'plan-invalido', problemas: plan.problemas }
  if (typeof token !== 'string' || token.length < 32) return { estado: 'sin-credencial' }
  const destino = validarDestino(origen, { remoto: remoto === true })
  const f = crearTransporte({ fetch: fCrudo, destino, tiempoMs: tiempoValido(tiempoMs) })
  let carpeta
  try { carpeta = carpetaPrivadaNueva(salida) } catch (e) { return { estado: `salida-${e.message}` } }
  const archivos = []
  const manifiesto = { formato: 'sebel-respaldo-manifiesto', version: 1, herramienta: 'respaldo-privado', origen: destino.origen, iniciadoEn: ahora(), objetos: [],
    aviso: 'Cada objeto se capturó por separado: NO hay atomicidad entre objetos ni entre una exportación y su marcador de recuperación (evidencias distintas).' }
  const pedir = async (ruta) => {
    let r
    try { r = await f(`${destino.origen}${ruta}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }) } catch { return { error: 'peticion-fallida' } }
    if (r.status !== 200) return { error: `http-${r.status}` }
    if (!/^application\/json/i.test(r.headers.get('content-type') ?? '')) return { error: 'tipo-inesperado' }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_BYTES) return { error: 'demasiado-grande' }
    return { buf }
  }
  for (const o of plan.objetivos) {
    const exp = await pedir(`${o.ruta}/exportar`)
    if (exp.error) return { estado: 'detenido', objeto: o.objeto, motivo: exp.error, archivos }
    let cuerpo
    try { cuerpo = JSON.parse(exp.buf.toString('utf8')) } catch { return { estado: 'detenido', objeto: o.objeto, motivo: 'json-ilegible', archivos } }
    const sellos = await verificarSellos(cuerpo)
    if (!sellos.ok) return { estado: 'detenido', objeto: o.objeto, motivo: 'sellos-invalidos', archivos }
    if (cuerpo.clase !== 'LigaDO' || cuerpo.objeto !== o.objeto) return { estado: 'detenido', objeto: o.objeto, motivo: 'objeto-inesperado', archivos }
    escribirNuevo(join(carpeta, o.archivo), exp.buf)
    archivos.push({ nombre: o.archivo, bytes: exp.buf.length, sha256: sha256Archivo(exp.buf) })
    const mar = await pedir(`${o.ruta}/marcador`)
    if (mar.error) return { estado: 'detenido', objeto: o.objeto, motivo: `marcador-${mar.error}`, archivos }
    escribirNuevo(join(carpeta, o.marcador), mar.buf)
    archivos.push({ nombre: o.marcador, bytes: mar.buf.length, sha256: sha256Archivo(mar.buf) })
    manifiesto.objetos.push({ tipo: o.tipo, objeto: o.objeto, clase: cuerpo.clase, versionEsquema: cuerpo.versionEsquema, archivo: o.archivo, marcador: o.marcador, sha256Respaldo: cuerpo.sha256, tablas: cuerpo.tablas.length, filas: cuerpo.tablas.reduce((n, t) => n + t.filas, 0) })
  }
  manifiesto.terminadoEn = ahora()
  manifiesto.archivos = archivos
  const texto = `${JSON.stringify(manifiesto, null, 2)}\n`
  escribirNuevo(join(carpeta, NOMBRE_MANIFIESTO), texto)
  archivos.push({ nombre: NOMBRE_MANIFIESTO, bytes: Buffer.byteLength(texto), sha256: sha256Archivo(Buffer.from(texto)) })
  return { estado: 'completo', archivos }
}

/** Verificación OFFLINE de una carpeta de captura: permisos, manifiesto, checksums de archivo y sellos internos. Solo imprime códigos. */
export async function verificarCarpeta(ruta) {
  const r = resolve(ruta)
  const problemas = []
  if (!existsSync(r)) return { ok: false, problemas: ['carpeta-inexistente'] }
  if ((statSync(r).mode & 0o077) !== 0) problemas.push('carpeta-con-permisos-abiertos')
  const mf = join(r, NOMBRE_MANIFIESTO)
  if (!existsSync(mf)) return { ok: false, problemas: [...problemas, 'sin-manifiesto-captura-incompleta'] }
  let m
  try { m = JSON.parse(readFileSync(mf, 'utf8')) } catch { return { ok: false, problemas: [...problemas, 'manifiesto-ilegible'] } }
  if (m?.formato !== 'sebel-respaldo-manifiesto' || !Array.isArray(m.archivos) || !Array.isArray(m.objetos)) return { ok: false, problemas: [...problemas, 'manifiesto-invalido'] }
  for (const a of m.archivos) {
    const p = join(r, a.nombre)
    if (!existsSync(p)) { problemas.push(`falta:${a.nombre}`); continue }
    if ((statSync(p).mode & 0o077) !== 0) problemas.push(`permisos:${a.nombre}`)
    const b = readFileSync(p)
    if (b.length !== a.bytes || sha256Archivo(b) !== a.sha256) problemas.push(`checksum:${a.nombre}`)
  }
  for (const o of m.objetos) {
    const p = join(r, o.archivo)
    if (!existsSync(p)) continue
    let cuerpo
    try { cuerpo = JSON.parse(readFileSync(p, 'utf8')) } catch { problemas.push(`ilegible:${o.archivo}`); continue }
    const s = await verificarSellos(cuerpo)
    if (!s.ok || cuerpo.sha256 !== o.sha256Respaldo) problemas.push(`sellos:${o.archivo}`)
  }
  const esperados = new Set([NOMBRE_MANIFIESTO, ...m.archivos.map((a) => a.nombre)])
  for (const n of readdirSync(r)) if (!esperados.has(n)) problemas.push(`archivo-ajeno:${n}`)
  return { ok: problemas.length === 0, problemas, objetos: m.objetos.map((o) => ({ tipo: o.tipo, objeto: o.objeto, filas: o.filas })) }
}
