import { ligaAdmitida } from './admision.js'
import { textosIguales, tokenDeEncabezado } from './credenciales.js'
import { leerJsonConLimite } from './cuerpo.js'
import { AccesoDO } from './acceso/acceso-do.js'
import { esRutaDeAcceso, manejarAcceso } from './acceso/rutas.js'
import { LigaDO } from './liga-do.js'
import { esRutaDeCarga, manejarCarga } from './rutas-carga.js'

export { AccesoDO, LigaDO }

// ---------------------------------------------------------------------------
// Worker: enruta y traduce a HTTP. No decide nada del dominio.
//
//   POST /v1/ligas/{ligaId}/partidos/{gameId}/comandos   sobre inmutable + Bearer del partido
//   GET  /v1/ligas/{ligaId}/partidos/{gameId}            proyección pública
//   GET  /v1/ligas/{ligaId}/equipos/{equipoId}/publico   lectura pública de un equipo (plantilla activa, resultados y estadísticas básicas)
//   GET  /v1/ligas/{ligaId}/jugadores/publico            rankings públicos de jugadores de la liga (partidos finales), sin credenciales
//   GET  /v1/ligas/{ligaId}/publico                      lectura pública de la liga (equipos y partidos), sin credenciales
//   GET  /v1/ligas/{ligaId}/partidos/{gameId}/preparacion  { preparacion, etiquetas, rev, ultimoClientSeq } + Bearer del partido
//   GET  /v1/ligas/{ligaId}/partidos/{gameId}/estado       estado autoritativo para el teléfono que controla (ver lectura-estado-control.js) + Bearer del partido
//   POST /v1/admin/ligas/{ligaId}/estructura | /partidos   carga del operador (Bearer del operador); CERRADA por defecto (ver rutas-carga.js)
//   POST /v1/_semilla/ligas/{ligaId}                     datos sintéticos; DESACTIVADA por defecto
//
// La liga elige el Durable Object (idFromName). CORS, autenticación de producción y el directorio
// de ligas quedan fuera de esta etapa.
// ---------------------------------------------------------------------------

const MAX_CUERPO_BYTES = 64 * 1024
const ID = '[A-Za-z0-9_-]{1,64}'
const RE_COMANDO = new RegExp(`^/v1/ligas/(${ID})/partidos/(${ID})/comandos$`)
const RE_LECTURA = new RegExp(`^/v1/ligas/(${ID})/partidos/(${ID})$`)
const RE_PUBLICO = new RegExp(`^/v1/ligas/(${ID})/publico$`)
const RE_JUGADORES = new RegExp(`^/v1/ligas/(${ID})/jugadores/publico$`)
const RE_EQUIPO = new RegExp(`^/v1/ligas/(${ID})/equipos/(${ID})/publico$`)
const RE_PREPARACION = new RegExp(`^/v1/ligas/(${ID})/partidos/(${ID})/preparacion$`)
const RE_ESTADO = new RegExp(`^/v1/ligas/(${ID})/partidos/(${ID})/estado$`)
const RE_SEMILLA = new RegExp(`^/v1/_semilla/ligas/(${ID})$`)

const CABECERAS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const responder = (status, cuerpo, extra = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CABECERAS, ...extra } })

const noEncontrado = () => responder(404, { error: 'no-encontrado' })
const metodoNoPermitido = (permitido) => responder(405, { error: 'metodo-no-permitido' }, { allow: permitido })

async function leerJson(request) {
  const r = await leerJsonConLimite(request, MAX_CUERPO_BYTES)
  return 'valor' in r ? { valor: r.valor } : { error: responder(r.estado, { error: r.error }) }
}

// Red de seguridad: ningún camino llega a un Durable Object sin haber pasado la admisión (que ya se hizo en `fetch`).
const stubDeLiga = (env, ligaId) => {
  if (!ligaAdmitida(env, ligaId)) throw new Error('liga-no-admitida')
  return env.LIGA.get(env.LIGA.idFromName(ligaId))
}

async function comando(request, env, ligaId, gameId) {
  if (request.method !== 'POST') return metodoNoPermitido('POST')
  const credencial = tokenDeEncabezado(request.headers.get('authorization'))
  if (credencial === null) return responder(401, { error: 'no-autorizado' })
  const { valor, error } = await leerJson(request)
  if (error) return error
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return responder(422, { error: 'sobre-invalido', errores: ['sobre'] })
  // El partido de la dirección y el del sobre deben ser el mismo; la autoridad es la credencial.
  if (valor.gameId !== gameId) return responder(400, { error: 'juego-distinto' })
  try {
    const r = await stubDeLiga(env, ligaId).ejecutarComando({ credencial, sobre: valor })
    return responder(r.status, r.cuerpo)
  } catch {
    return responder(503, { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' })
  }
}

async function lectura(request, env, ligaId, gameId) {
  if (request.method !== 'GET') return metodoNoPermitido('GET')
  try {
    const r = await stubDeLiga(env, ligaId).leerPublico(gameId)
    return responder(r.status, r.cuerpo)
  } catch {
    return responder(500, { error: 'error-interno' })
  }
}

async function lecturaLiga(request, env, ligaId) {
  if (request.method !== 'GET') return metodoNoPermitido('GET')
  try {
    const r = await stubDeLiga(env, ligaId).leerPublicoLiga()
    return responder(r.status, r.cuerpo)
  } catch {
    return responder(500, { error: 'error-interno' })
  }
}

async function lecturaEquipo(request, env, ligaId, equipoId) {
  if (request.method !== 'GET') return metodoNoPermitido('GET')
  try {
    const r = await stubDeLiga(env, ligaId).leerEquipoPublico(equipoId)
    return responder(r.status, r.cuerpo)
  } catch {
    return responder(500, { error: 'error-interno' })
  }
}

async function lecturaJugadores(request, env, ligaId) {
  if (request.method !== 'GET') return metodoNoPermitido('GET')
  try {
    const r = await stubDeLiga(env, ligaId).leerJugadoresPublico()
    return responder(r.status, r.cuerpo)
  } catch {
    return responder(500, { error: 'error-interno' })
  }
}

async function preparacion(request, env, ligaId, gameId) {
  if (request.method !== 'GET') return metodoNoPermitido('GET')
  const credencial = tokenDeEncabezado(request.headers.get('authorization'))
  if (credencial === null) return responder(401, { error: 'no-autorizado' })
  try {
    const r = await stubDeLiga(env, ligaId).leerPreparacion({ credencial, gameId })
    if (r.tipo === 'ok') return responder(200, { preparacion: r.preparacion, etiquetas: r.etiquetas, rev: r.rev, ultimoClientSeq: r.ultimoClientSeq })
    if (r.tipo === 'no-disponible') return responder(503, { error: 'preparacion-no-disponible' })
    return responder(401, { error: 'no-autorizado' })
  } catch {
    return responder(503, { error: 'error-temporal' })
  }
}

async function estadoControl(request, env, ligaId, gameId) {
  if (request.method !== 'GET') return metodoNoPermitido('GET')
  const credencial = tokenDeEncabezado(request.headers.get('authorization'))
  if (credencial === null) return responder(401, { error: 'no-autorizado' })
  try {
    const r = await stubDeLiga(env, ligaId).leerEstadoControl({ credencial, gameId })
    if (r.tipo === 'ok') return responder(200, r.cuerpo)
    // Nunca una instantánea truncada que parezca completa. Solo lo ve quien ya está autorizado.
    if (r.tipo === 'demasiado-grande') return responder(507, { error: 'estado-demasiado-grande' })
    return responder(401, { error: 'no-autorizado' })
  } catch {
    return responder(503, { error: 'error-temporal' })
  }
}

async function semilla(request, env, ligaId) {
  // Desactivada salvo que el entorno la active Y tenga un secreto de administración.
  if (env.PERMITIR_SEMILLA !== '1' || typeof env.SEMILLA_TOKEN !== 'string' || env.SEMILLA_TOKEN.length < 16) return noEncontrado()
  if (request.method !== 'POST') return metodoNoPermitido('POST')
  const token = tokenDeEncabezado(request.headers.get('authorization'))
  if (token === null || !(await textosIguales(token, env.SEMILLA_TOKEN))) return responder(401, { error: 'no-autorizado' })
  const { valor, error } = await leerJson(request)
  if (error) return error
  if (valor?.liga?.id !== ligaId) return responder(422, { error: 'payload-invalido', errores: ['liga.id'] })
  try {
    const r = await stubDeLiga(env, ligaId).sembrar(valor)
    return responder(r.status, r.cuerpo)
  } catch {
    return responder(500, { error: 'error-interno' })
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    let m
    // Rutas de acceso por códigos (activación del teléfono, organizador, operador). Cada una aplica su propia
    // admisión de liga y sus propias puertas antes de tocar ningún objeto; ver acceso/rutas.js.
    // Carga del operador: aplica su propia puerta, la admisión de la liga y su Bearer antes de tocar ningún objeto.
    if (esRutaDeCarga(pathname)) return manejarCarga(request, env, pathname)
    if (esRutaDeAcceso(pathname)) return manejarAcceso(request, env, pathname)
    // ADMISIÓN: antes de cualquier handler, de cualquier otra comprobación y de cualquier acceso al binding de
    // Durable Objects. Una liga no admitida recibe el mismo 404 que cualquier ruta desconocida, sea cual sea el método,
    // las cabeceras o el cuerpo. Admitir solo permite enrutar; no autoriza ni prueba que la liga exista.
    if ((m = RE_COMANDO.exec(pathname))) return ligaAdmitida(env, m[1]) ? comando(request, env, m[1], m[2]) : noEncontrado()
    if ((m = RE_LECTURA.exec(pathname))) return ligaAdmitida(env, m[1]) ? lectura(request, env, m[1], m[2]) : noEncontrado()
    if ((m = RE_PUBLICO.exec(pathname))) return ligaAdmitida(env, m[1]) ? lecturaLiga(request, env, m[1]) : noEncontrado()
    if ((m = RE_EQUIPO.exec(pathname))) return ligaAdmitida(env, m[1]) ? lecturaEquipo(request, env, m[1], m[2]) : noEncontrado()
    if ((m = RE_JUGADORES.exec(pathname))) return ligaAdmitida(env, m[1]) ? lecturaJugadores(request, env, m[1]) : noEncontrado()
    // La siembra conserva su orden propio (activación y secreto) y además exige que la liga esté admitida.
    if ((m = RE_PREPARACION.exec(pathname))) return ligaAdmitida(env, m[1]) ? preparacion(request, env, m[1], m[2]) : noEncontrado()
    if ((m = RE_ESTADO.exec(pathname))) return ligaAdmitida(env, m[1]) ? estadoControl(request, env, m[1], m[2]) : noEncontrado()
    if ((m = RE_SEMILLA.exec(pathname))) return ligaAdmitida(env, m[1]) ? semilla(request, env, m[1]) : noEncontrado()
    return noEncontrado()
  },
}
