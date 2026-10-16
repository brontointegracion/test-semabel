import { ligaAdmitida } from '../admision.js'
import { sha256Hex, textosIguales, tokenDeEncabezado } from '../credenciales.js'
import { RESULTADO_DESCONOCIDO, falloSinEscritura } from '../respuestas.js'
import { manejarPlantilla } from '../rutas-plantilla.js'
import { DURACIONES, administracionHabilitada, configuracionOrganizador } from './config.js'
import {
  cookieBorrada, cookieDeSesion, leerCookieDeSesion, leerJsonAcotado, metodoNoPermitido, noAutorizado, noEncontrado,
  rechazoCsrf, responder,
} from './http.js'

// ---------------------------------------------------------------------------
// Rutas de acceso por códigos. Las direcciones son solo navegación: la autorización viene siempre del código
// tecleado, de la cookie de sesión o de la credencial del teléfono, nunca de la URL.
//
//   POST /v1/acceso/organizador                                   código del organizador → cookie de sesión
//   GET  /v1/organizador/yo                                       quién soy y qué ligas poseo
//   POST /v1/organizador/salir                                    cierra la sesión
//   POST /v1/organizador/ligas/{liga}/partidos/{juego}/codigo     emite el código del partido (se muestra una vez)
//   GET  /v1/organizador/ligas/{liga}/partidos/{juego}/control    estado del control, sin secretos
//   POST /v1/organizador/ligas/{liga}/partidos/{juego}/control/revocar   SOLO antes del inicio
//   POST /v1/ligas/{liga}/partidos/{juego}/activar                código del partido + hash del token del teléfono
//   POST /v1/admin/organizador[/codigo/rotar|/sesiones/cerrar|/desactivar]   operador; DESACTIVADA por defecto
//
// No existe ninguna ruta para revocar el control después del inicio, ni para liberar un partido atascado.
// ---------------------------------------------------------------------------

const ID = '[A-Za-z0-9_-]{1,64}'
const RE_LOGIN = /^\/v1\/acceso\/organizador$/
const RE_YO = /^\/v1\/organizador\/yo$/
const RE_SALIR = /^\/v1\/organizador\/salir$/
const RE_CODIGO = new RegExp(`^/v1/organizador/ligas/(${ID})/partidos/(${ID})/codigo$`)
const RE_CONTROL = new RegExp(`^/v1/organizador/ligas/(${ID})/partidos/(${ID})/control$`)
const RE_REVOCAR = new RegExp(`^/v1/organizador/ligas/(${ID})/partidos/(${ID})/control/revocar$`)
const RE_ACTIVAR = new RegExp(`^/v1/ligas/(${ID})/partidos/(${ID})/activar$`)
const RE_ADMIN = /^\/v1\/admin\/organizador(\/codigo\/rotar|\/sesiones\/cerrar|\/desactivar)?$/

export const esRutaDeAcceso = (pathname) => RE_LOGIN.test(pathname) || pathname.startsWith('/v1/organizador/')
  || pathname.startsWith('/v1/admin/') || RE_ACTIVAR.test(pathname)

const accesoDO = (env) => env.ACCESO.get(env.ACCESO.idFromName('acceso'))
const ligaDO = (env, ligaId) => {
  if (!ligaAdmitida(env, ligaId)) throw new Error('liga-no-admitida') // red de seguridad: la admisión ya se hizo
  return env.LIGA.get(env.LIGA.idFromName(ligaId))
}
const desconocido = () => responder(RESULTADO_DESCONOCIDO.status, RESULTADO_DESCONOCIDO.cuerpo)

// La dirección del cliente SOLO sirve para el cubo de límite de intentos y se guarda como hash. Se usa únicamente
// la cabecera que pone Cloudflare; ninguna cabecera de reenvío del cliente. Si falta o se falsifica, solo cambia el cubo.
async function fuenteDe(request) {
  const ip = request.headers.get('cf-connecting-ip')
  return sha256Hex(`fuente:${typeof ip === 'string' && ip.length <= 64 ? ip : 'desconocida'}`)
}

function respuestaDeLiga(r) {
  switch (r?.tipo) {
    case 'partido-iniciado': return responder(409, { error: 'partido-iniciado' })
    case 'partido-desconocido': return noEncontrado()
    case 'no-autorizado': return noAutorizado()
    default: return null
  }
}

/** Valida la cookie y la posesión de la liga; ejecuta `fn(asercion)`; si la afirmación caduca, revalida UNA vez. */
async function conSesionDeOrganizador(request, env, ligaId, fn) {
  const cookie = leerCookieDeSesion(request)
  if (cookie === null) return noAutorizado()
  const acceso = accesoDO(env)
  let asercion = await acceso.validarSesion({ cookie })
  if (!asercion || !asercion.ligas.includes(ligaId)) return noAutorizado()
  let r = await fn(asercion)
  if (r?.tipo === 'asercion-vencida') {
    asercion = await acceso.validarSesion({ cookie }) // como mucho una revalidación
    if (!asercion || !asercion.ligas.includes(ligaId)) return noAutorizado()
    r = await fn(asercion)
    if (r?.tipo === 'asercion-vencida') { const f = falloSinEscritura('asercion-vencida'); return responder(f.status, f.cuerpo) }
  }
  return r
}

export async function manejarAcceso(request, env, pathname) {
  let m

  // --- Teléfono: activación con el código del partido (sin cookie, sin CSRF: no hay sesión que falsificar) ---
  if ((m = RE_ACTIVAR.exec(pathname))) {
    if (!ligaAdmitida(env, m[1])) return noEncontrado()
    if (request.method !== 'POST') return metodoNoPermitido('POST')
    const { valor, error } = await leerJsonAcotado(request)
    if (error) return error
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return noAutorizado()
    try {
      const r = await ligaDO(env, m[1]).activarPartido({
        partidoId: m[2], codigo: valor.codigo, tokenHash: valor.tokenHash, fuente: await fuenteDe(request),
      })
      if (r.tipo === 'ok') return responder(200, { deviceId: r.deviceId, partidoId: m[2] })
      if (r.tipo === 'limitado') return responder(429, { error: 'demasiados-intentos' })
      return noAutorizado()
    } catch {
      return desconocido()
    }
  }

  // --- Operador ---
  if ((m = RE_ADMIN.exec(pathname))) {
    if (!administracionHabilitada(env)) return noEncontrado()
    if (request.method !== 'POST') return metodoNoPermitido('POST')
    const token = tokenDeEncabezado(request.headers.get('authorization'))
    if (token === null || !(await textosIguales(token, env.ACCESO_ADMIN_TOKEN))) return noAutorizado()
    const { valor, error } = await leerJsonAcotado(request)
    if (error) return error
    const acceso = accesoDO(env)
    try {
      if (!m[1]) {
        if (!Array.isArray(valor?.ligas) || !valor.ligas.every((l) => ligaAdmitida(env, l))) return responder(422, { error: 'ligas-invalidas' })
        const r = await acceso.provisionar({ nombre: valor.nombre, ligas: valor.ligas })
        return r.ok ? responder(201, r) : responder(r.error === 'organizador-existente' ? 409 : 422, { error: r.error })
      }
      if (m[1] === '/codigo/rotar') {
        const r = await acceso.rotarCodigo({ cerrarSesiones: valor?.cerrarSesiones !== false })
        return r.ok ? responder(200, r) : responder(404, { error: r.error })
      }
      if (m[1] === '/sesiones/cerrar') return responder(200, await acceso.cerrarTodasLasSesiones())
      return responder(200, await acceso.desactivarOrganizador())
    } catch {
      return desconocido()
    }
  }

  // --- Organizador: todo cerrado si no hay un origen configurado y válido ---
  const config = configuracionOrganizador(env)
  if (!config) return noEncontrado()

  if (RE_LOGIN.test(pathname)) {
    if (request.method !== 'POST') return metodoNoPermitido('POST')
    const csrf = rechazoCsrf(request, config)
    if (csrf) return csrf
    const { valor, error } = await leerJsonAcotado(request)
    if (error) return error
    try {
      const r = await accesoDO(env).iniciarSesion({ codigo: valor?.codigo, fuente: await fuenteDe(request) })
      if (r.tipo === 'ok') {
        return responder(200, { ok: true, expiraIdle: r.expiraIdle, expiraAbs: r.expiraAbs },
          { 'set-cookie': cookieDeSesion(r.cookie, Math.floor(DURACIONES.sesionAbsoluta / 1000)) })
      }
      if (r.tipo === 'limitado') return responder(429, { error: 'demasiados-intentos' })
      return noAutorizado()
    } catch {
      return desconocido()
    }
  }

  if (RE_YO.test(pathname)) {
    if (request.method !== 'GET') return metodoNoPermitido('GET')
    const cookie = leerCookieDeSesion(request)
    if (cookie === null) return noAutorizado()
    try {
      const a = await accesoDO(env).validarSesion({ cookie })
      if (!a) return noAutorizado()
      return responder(200, { organizadorId: a.organizadorId, ligas: a.ligas, expiraIdle: a.expiraIdle, expiraAbs: a.expiraAbs }, { vary: 'Cookie' })
    } catch {
      return desconocido()
    }
  }

  if (RE_SALIR.test(pathname)) {
    if (request.method !== 'POST') return metodoNoPermitido('POST')
    const csrf = rechazoCsrf(request, config)
    if (csrf) return csrf
    const cookie = leerCookieDeSesion(request)
    if (cookie === null) return noAutorizado()
    try {
      const acceso = accesoDO(env)
      const a = await acceso.validarSesion({ cookie })
      if (!a) return noAutorizado()
      await acceso.cerrarSesion({ sesionId: a.sesionId })
      return responder(200, { ok: true }, { 'set-cookie': cookieBorrada() })
    } catch {
      return desconocido()
    }
  }

  const rutaDePartido = (re) => re.exec(pathname)
  if ((m = rutaDePartido(RE_CODIGO)) || (m = rutaDePartido(RE_REVOCAR)) || (m = rutaDePartido(RE_CONTROL))) {
    const [, ligaId, partidoId] = m
    if (!ligaAdmitida(env, ligaId)) return noEncontrado()
    const esCodigo = RE_CODIGO.test(pathname)
    const esRevocar = RE_REVOCAR.test(pathname)
    const metodo = esCodigo || esRevocar ? 'POST' : 'GET'
    if (request.method !== metodo) return metodoNoPermitido(metodo)
    if (metodo === 'POST') {
      const csrf = rechazoCsrf(request, config)
      if (csrf) return csrf
    }
    try {
      const r = await conSesionDeOrganizador(request, env, ligaId, (asercion) => {
        const liga = ligaDO(env, ligaId)
        if (esCodigo) return liga.crearCodigoPartido({ asercion, ligaId, partidoId })
        if (esRevocar) return liga.revocarControlDePartido({ asercion, ligaId, partidoId })
        return liga.estadoControlDePartido({ asercion, ligaId, partidoId })
      })
      if (r instanceof Response) return r
      const mapeada = respuestaDeLiga(r)
      if (mapeada) return mapeada
      if (esCodigo) return responder(200, { partidoId, codigo: r.codigo, expiraEn: r.expiraEn })
      if (esRevocar) return responder(200, { ok: true, credencialesRevocadas: r.credencialesRevocadas })
      return responder(200, { partidoId, partido: r.partido, codigoPendiente: r.codigoPendiente, codigoExpiraEn: r.codigoExpiraEn, credencial: r.credencial }, { vary: 'Cookie' })
    } catch {
      return desconocido()
    }
  }

  // Plantilla compartida (lecturas y operaciones del organizador): ver rutas-plantilla.js.
  const deLaPlantilla = await manejarPlantilla(request, env, pathname, config, { conSesionDeOrganizador, ligaDO, desconocido })
  if (deLaPlantilla) return deLaPlantilla

  return noEncontrado()
}
