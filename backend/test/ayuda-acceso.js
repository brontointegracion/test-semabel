import { env, exports } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { control } from './worker-prueba.js'
import { sha256Hex } from '../src/credenciales.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, sembrar } from './ayuda.js'

// Ayudas de las pruebas de acceso por códigos. Todo es sintético: el secreto de operador y el origen están solo en
// wrangler.test.jsonc; los códigos se generan en cada ejecución con el generador de producción.

export { control, T0 }
export const ORIGEN = 'https://backend.local'
export const TOKEN_OPERADOR = 'operador-sintetico-solo-pruebas-0000000000'
export const accesoStub = () => env.ACCESO.get(env.ACCESO.idFromName('acceso'))
export const ligaStub = (ligaId) => env.LIGA.get(env.LIGA.idFromName(ligaId))
export const enAcceso = (fn) => runInDurableObject(accesoStub(), fn)
export const enLiga = (ligaId, fn) => runInDurableObject(ligaStub(ligaId), fn)

// Registro de todo lo que se pide y se responde (para buscar secretos donde no deben estar). Solo en pruebas.
export const historial = []

const leerCuerpo = async (r, peticion) => {
  const texto = await r.clone().text()
  historial.push({
    metodo: peticion?.method, url: peticion?.url, status: r.status, cabeceras: Object.fromEntries(r.headers), cuerpo: texto,
  })
  let cuerpo = null
  try { cuerpo = JSON.parse(texto) } catch { /* sin cuerpo JSON */ }
  return { status: r.status, cuerpo, respuesta: r }
}

export const cabecerasEscritura = (extra = {}) => ({
  origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json', ...extra,
})
export const conCookie = (cookie, cabeceras = {}) => (cookie ? { ...cabeceras, cookie: `__Host-sesion=${cookie}` } : cabeceras)

export async function pedir(metodo, ruta, { cuerpo, cabeceras = {}, entorno } = {}) {
  const peticion = new Request(`${ORIGEN}${ruta}`, {
    method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
  })
  if (entorno) {
    const { default: worker } = await import('../src/worker.js')
    return leerCuerpo(await worker.fetch(peticion.clone(), entorno), peticion)
  }
  return leerCuerpo(await exports.default.fetch(peticion.clone()), peticion)
}

export const admin = (ruta, cuerpo, token = TOKEN_OPERADOR) =>
  pedir('POST', ruta, { cuerpo, cabeceras: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })

/** Deja el objeto de acceso sin organizador activo (cada prueba arranca de cero). */
export const reiniciarAcceso = async (ahora = T0) => { control.ahoraMs = ahora; await accesoStub().desactivarOrganizador(); control.desfasesAcceso = null }

/** Crea un organizador que posee `ligas`. → { codigo, organizadorId } */
export async function provisionar(ligas) {
  const r = await admin('/v1/admin/organizador', { nombre: 'Organizador sintético', ligas })
  if (r.status !== 201) throw new Error(`provisión falló: ${r.status} ${JSON.stringify(r.cuerpo)}`)
  return { codigo: r.cuerpo.codigo, organizadorId: r.cuerpo.organizadorId }
}

export const valorDeCookie = (respuesta) => {
  const sc = respuesta.headers.get('set-cookie')
  const m = sc ? /^__Host-sesion=([^;]*)/.exec(sc) : null
  return m && m[1] ? m[1] : null
}

export async function iniciarSesion(codigo, { ip } = {}) {
  const r = await pedir('POST', '/v1/acceso/organizador', { cuerpo: { codigo }, cabeceras: cabecerasEscritura(ip ? { 'cf-connecting-ip': ip } : {}) })
  return { ...r, cookie: valorDeCookie(r.respuesta) }
}

export const comoOrganizador = (cookie, metodo, ruta, cuerpo) =>
  pedir(metodo, ruta, { cuerpo: metodo === 'GET' ? undefined : (cuerpo ?? {}), cabeceras: metodo === 'GET' ? conCookie(cookie) : conCookie(cookie, cabecerasEscritura()) })

/** Una liga sembrada SIN credenciales de partido (se activan con códigos) y un organizador que la posee. */
export async function escenarioDeCodigos({ ligas = 1, ahora = T0 } = {}) {
  const ids = Array.from({ length: ligas }, () => nuevaLiga())
  for (const id of ids) {
    const payload = payloadDeLiga(id)
    payload.credenciales = []
    const r = await sembrar(id, payload)
    if (r.status !== 201) throw new Error(`siembra falló: ${r.status}`)
  }
  await reiniciarAcceso(ahora)
  const { codigo, organizadorId } = await provisionar(ids)
  const sesion = await iniciarSesion(codigo)
  return { ligaId: ids[0], ligas: ids, codigoOrganizador: codigo, organizadorId, cookie: sesion.cookie }
}

export async function emitirCodigoDePartido(cookie, ligaId, partidoId = 'P') {
  const r = await comoOrganizador(cookie, 'POST', `/v1/organizador/ligas/${ligaId}/partidos/${partidoId}/codigo`)
  return { ...r, codigo: r.cuerpo?.codigo }
}

/** Un token de teléfono nuevo (256 bits) y su hash: el servidor solo ve el hash. */
export async function tokenDeTelefono() {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { token, tokenHash: await sha256Hex(token) }
}

export const activar = (ligaId, partidoId, codigo, tokenHash, { ip, cuerpo } = {}) =>
  pedir('POST', `/v1/ligas/${ligaId}/partidos/${partidoId}/activar`, {
    cuerpo: cuerpo ?? { codigo, tokenHash }, cabeceras: { 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
  })

/** Todas las filas de todas las tablas de un objeto, como texto (para buscar secretos en claro). */
export const volcarObjeto = (stub) => runInDurableObject(stub, (inst) => {
  const sql = inst.almacen.sql
  const tablas = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray()
  return JSON.stringify(Object.fromEntries(tablas.map((t) => [t.name, sql.exec(`SELECT * FROM ${t.name}`).toArray()])))
})
