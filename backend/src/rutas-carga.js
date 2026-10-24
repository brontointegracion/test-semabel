import { ligaAdmitida } from './admision.js'
import { textosIguales, tokenDeEncabezado } from './credenciales.js'
import { LIMITES_CARGA, validarEquiposAnexos, validarEstructura, validarPartidos } from './carga.js'
import { LIMITE_BYTES_RAMAS, validarRamas } from './ramas-equipos.js'
import { LIMITE_BYTES_RENOMBRE, validarRenombre } from './renombre-liga.js'
import { LIMITE_BYTES_RETIRO, validarRetiro } from './retiro-partidos.js'
import { administracionHabilitada } from './acceso/config.js'
import { leerJsonAcotado, metodoNoPermitido, noAutorizado, noEncontrado, responder } from './acceso/http.js'

// ---------------------------------------------------------------------------
// Carga del OPERADOR (ver carga.js). Solo existe con la misma puerta que la provisión del operador
// (ACCESO_ADMIN_HABILITADO=1 y ACCESO_ADMIN_TOKEN de 32+ caracteres): cerrada por defecto, sin un segundo sistema de
// autenticación. Una sesión de organizador (cookie) NO sirve: aquí solo se mira el Bearer del operador.
//
//   POST /v1/admin/ligas/{liga}/estructura   liga + equipos, atómico por petición
//   POST /v1/admin/ligas/{liga}/partidos     lote de partidos nuevos, atómico por lote
//   POST /v1/admin/ligas/{liga}/equipos      añade equipos a una liga YA cargada (cargaId nuevo), atómico por lote
//   POST /v1/admin/ligas/{liga}/partidos/retirar     RETIRA partidos programados sin actividad (reversible; ver retiro-partidos.js)
//   POST /v1/admin/ligas/{liga}/equipos/ramas        FIJA la rama de equipos existentes (solo NULL → valor; ver ramas-equipos.js)
//   POST /v1/admin/ligas/{liga}/nombre               RENOMBRA la liga (SOLO el nombre que se muestra; ver renombre-liga.js)
//   POST /v1/admin/ligas/{liga}/partidos/restaurar   RESTAURA partidos retirados (operación aparte, nunca un interruptor)
//
// Orden: puerta del operador → liga ADMITIDA (antes de cualquier objeto) → método → Bearer → cuerpo acotado → validación
// completa → liga. Una liga no admitida recibe el 404 de siempre, con cualquier cuerpo o credencial.
// ---------------------------------------------------------------------------

const ID = '[A-Za-z0-9_-]{1,64}'
const RE_CARGA = new RegExp(`^/v1/admin/ligas/(${ID})/(estructura|partidos|equipos|partidos/retirar|partidos/restaurar|nombre|equipos/ramas)$`)

export const esRutaDeCarga = (pathname) => RE_CARGA.test(pathname)

export async function manejarCarga(request, env, pathname) {
  const [, ligaId, tipo] = RE_CARGA.exec(pathname)
  if (!administracionHabilitada(env)) return noEncontrado()
  if (!ligaAdmitida(env, ligaId)) return noEncontrado()
  if (request.method !== 'POST') return metodoNoPermitido('POST')
  const token = tokenDeEncabezado(request.headers.get('authorization'))
  if (token === null || !(await textosIguales(token, env.ACCESO_ADMIN_TOKEN))) return noAutorizado()
  const esEstructura = tipo === 'estructura'
  const esRetiro = tipo === 'partidos/retirar' || tipo === 'partidos/restaurar'
  const esNombre = tipo === 'nombre'
  const esRamas = tipo === 'equipos/ramas'
  const { valor, error } = await leerJsonAcotado(request, esRamas ? LIMITE_BYTES_RAMAS : esNombre ? LIMITE_BYTES_RENOMBRE : esRetiro ? LIMITE_BYTES_RETIRO : tipo === 'partidos' ? LIMITES_CARGA.bytesPartidos : LIMITES_CARGA.bytesEstructura)
  if (error) return error
  if (esRamas) {
    const r = validarRamas(valor)
    if (!r.ok) return responder(422, { error: 'payload-invalido', errores: r.errores })
    try {
      const res = await env.LIGA.get(env.LIGA.idFromName(ligaId)).fijarRamasOperador({ ligaId, normalizado: r.normalizado })
      return responder(res.status, res.cuerpo)
    } catch {
      return responder(503, { error: 'resultado-desconocido', reintento: 'misma-carga' })
    }
  }
  if (esNombre) {
    const r = validarRenombre(valor)
    if (!r.ok) return responder(422, { error: 'payload-invalido', errores: r.errores })
    try {
      const res = await env.LIGA.get(env.LIGA.idFromName(ligaId)).renombrarLigaOperador({ ligaId, normalizado: r.normalizado })
      return responder(res.status, res.cuerpo)
    } catch {
      return responder(503, { error: 'resultado-desconocido', reintento: 'misma-carga' }) // repetir la MISMA operación (mismo cargaId y contenido) es seguro
    }
  }
  if (esRetiro) {
    const r = validarRetiro(valor)
    if (!r.ok) return responder(422, { error: 'payload-invalido', errores: r.errores })
    try {
      const stub = env.LIGA.get(env.LIGA.idFromName(ligaId))
      const res = tipo === 'partidos/retirar'
        ? await stub.retirarPartidosOperador({ ligaId, normalizado: r.normalizado })
        : await stub.restaurarPartidosOperador({ ligaId, normalizado: r.normalizado })
      return responder(res.status, res.cuerpo)
    } catch {
      return responder(503, { error: 'resultado-desconocido', reintento: 'misma-carga' }) // repetir la MISMA operación (mismo cargaId y contenido) es seguro
    }
  }
  const v = esEstructura ? validarEstructura(valor, ligaId) : tipo === 'equipos' ? validarEquiposAnexos(valor, ligaId) : validarPartidos(valor)
  if (!v.ok) return responder(422, { error: 'payload-invalido', errores: v.errores })
  try {
    const stub = env.LIGA.get(env.LIGA.idFromName(ligaId))
    const r = esEstructura
      ? await stub.cargarEstructuraOperador({ ligaId, normalizado: v.normalizado })
      : tipo === 'equipos'
        ? await stub.cargarEquiposOperador({ ligaId, normalizado: v.normalizado })
        : await stub.cargarPartidosOperador({ ligaId, normalizado: v.normalizado })
    return responder(r.status, r.cuerpo)
  } catch {
    // Resultado incierto: repetir la MISMA carga (mismo cargaId y contenido) es seguro.
    return responder(503, { error: 'resultado-desconocido', reintento: 'misma-carga' })
  }
}
