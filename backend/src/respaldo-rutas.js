import { ligaAdmitida } from './admision.js'
import { textosIguales, tokenDeEncabezado } from './credenciales.js'
import { administracionHabilitada } from './acceso/config.js'
import { metodoNoPermitido, noAutorizado, noEncontrado, responder } from './acceso/http.js'

// ---------------------------------------------------------------------------
// Rutas del RESPALDO SOLO LECTURA (ver respaldo.js). Misma puerta que la carga del operador: ACCESO_ADMIN_HABILITADO=1 y Bearer del operador; una cookie de organizador no sirve.
//
//   POST /v1/admin/respaldo/ligas/{liga}/exportar    exportación completa del objeto de la liga (JSON `sebel-respaldo-sql`)
//   POST /v1/admin/respaldo/ligas/{liga}/marcador    marcador de recuperación (PITR) del objeto de la liga, si la plataforma lo ofrece
//
// Orden: puerta → liga ADMITIDA (antes de cualquier objeto) → método → Bearer → cuerpo vacío o `{}` → objeto. NO escribe nada ni existe ninguna ruta de importación aquí:
// no existe ninguna ruta de importación, restauración ni de control de pruebas, ni exportación del objeto de acceso.
// ---------------------------------------------------------------------------

const ID = '[A-Za-z0-9_-]{1,64}'
const RE = new RegExp(`^/v1/admin/respaldo/ligas/(${ID})/(exportar|marcador)$`)

export const esRutaDeRespaldo = (pathname) => RE.test(pathname)

/** Cuerpo vacío o exactamente `{}` (máx. 16 bytes): esta operación no recibe parámetros. */
async function cuerpoVacio(request) {
  const texto = await request.text()
  if (texto.length > 16) return false
  const t = texto.trim()
  return t === '' || t === '{}'
}

export async function manejarRespaldo(request, env, pathname) {
  const [, ligaId, accion] = RE.exec(pathname)
  if (!administracionHabilitada(env)) return noEncontrado()
  if (!ligaAdmitida(env, ligaId)) return noEncontrado()
  if (request.method !== 'POST') return metodoNoPermitido('POST')
  const token = tokenDeEncabezado(request.headers.get('authorization'))
  if (token === null || !(await textosIguales(token, env.ACCESO_ADMIN_TOKEN))) return noAutorizado()
  if (!(await cuerpoVacio(request))) return responder(422, { error: 'payload-invalido' })
  try {
    const stub = env.LIGA.get(env.LIGA.idFromName(ligaId))
    if (accion === 'marcador') {
      const m = await stub.marcadorRecuperacionOperador()
      return responder(200, m)
    }
    const r = await stub.exportarRespaldoOperador({ ligaId })
    if (r.estado !== 'ok') return responder(409, { error: 'respaldo-no-soportado', motivo: r.motivo })
    return new Response(r.texto, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  } catch {
    return responder(503, { error: 'respaldo-no-disponible' })
  }
}
