import { ligaAdmitida } from './admision.js'
import { textosIguales, tokenDeEncabezado } from './credenciales.js'
import { administracionHabilitada } from './acceso/config.js'
import { metodoNoPermitido, noAutorizado, noEncontrado, responder } from './acceso/http.js'

// ---------------------------------------------------------------------------
// Rutas del RESPALDO SOLO LECTURA (ver respaldo.js). Misma puerta que la carga del operador: ACCESO_ADMIN_HABILITADO=1 y Bearer del operador; una cookie de organizador no sirve.
//
//   POST /v1/admin/respaldo/ligas/{liga}/exportar    exportación completa del objeto de la liga (JSON `sebel-respaldo-sql`)
//   POST /v1/admin/respaldo/ligas/{liga}/marcador    marcador de recuperación (PITR) del objeto de la liga, si la plataforma lo ofrece
//   POST /v1/admin/respaldo/acceso/exportar          lo mismo para el objeto de acceso
//   POST /v1/admin/respaldo/acceso/marcador
//
// Orden: puerta → liga ADMITIDA (antes de cualquier objeto) → método → Bearer → cuerpo vacío o `{}` → objeto. NO escribe nada ni existe ninguna ruta de importación aquí:
// la importación solo existe en el punto de entrada de ensayo local (backend/ensayo/), que no forma parte del paquete de producción.
// ---------------------------------------------------------------------------

const ID = '[A-Za-z0-9_-]{1,64}'
const RE = new RegExp(`^/v1/admin/respaldo/(?:ligas/(${ID})|(acceso))/(exportar|marcador)$`)

export const esRutaDeRespaldo = (pathname) => RE.test(pathname)

/** Cuerpo vacío o exactamente `{}` (máx. 16 bytes): esta operación no recibe parámetros. */
async function cuerpoVacio(request) {
  const texto = await request.text()
  if (texto.length > 16) return false
  const t = texto.trim()
  return t === '' || t === '{}'
}

export async function manejarRespaldo(request, env, pathname) {
  const [, ligaId, acceso, accion] = RE.exec(pathname)
  if (!administracionHabilitada(env)) return noEncontrado()
  if (ligaId !== undefined && !ligaAdmitida(env, ligaId)) return noEncontrado()
  if (request.method !== 'POST') return metodoNoPermitido('POST')
  const token = tokenDeEncabezado(request.headers.get('authorization'))
  if (token === null || !(await textosIguales(token, env.ACCESO_ADMIN_TOKEN))) return noAutorizado()
  if (!(await cuerpoVacio(request))) return responder(422, { error: 'payload-invalido' })
  try {
    const stub = acceso ? env.ACCESO.get(env.ACCESO.idFromName('acceso')) : env.LIGA.get(env.LIGA.idFromName(ligaId))
    if (accion === 'marcador') {
      const m = acceso ? await stub.marcadorRecuperacionOperador() : await stub.marcadorRecuperacionOperador({ ligaId })
      return responder(200, m)
    }
    const r = acceso ? await stub.exportarRespaldoOperador() : await stub.exportarRespaldoOperador({ ligaId })
    if (r.estado !== 'ok') return responder(409, { error: 'respaldo-no-soportado', motivo: r.motivo })
    return new Response(r.texto, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  } catch {
    return responder(503, { error: 'respaldo-no-disponible' })
  }
}
