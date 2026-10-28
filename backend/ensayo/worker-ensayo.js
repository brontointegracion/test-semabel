import worker, { AccesoDO as AccesoBase, LigaDO as LigaBase } from '../src/worker.js'
import { administracionHabilitada } from '../src/acceso/config.js'
import { ligaAdmitida } from '../src/admision.js'
import { textosIguales, tokenDeEncabezado } from '../src/credenciales.js'
import { responder } from '../src/acceso/http.js'
import { importarObjeto } from './importar.js'

// ---------------------------------------------------------------------------
// PUNTO DE ENTRADA SOLO DE ENSAYO LOCAL (REPORT_246): el mismo Worker más UNA ruta de importación, protegida por la puerta del operador, su Bearer y ENTORNO=«ensayo-respaldo».
// NO es el `main` de ninguna configuración de producción y nada de `src/` lo importa.
//   POST /v1/ensayo/respaldo/ligas/{liga}/importar | /v1/ensayo/respaldo/acceso/importar     (cuerpo = el respaldo JSON)
// ---------------------------------------------------------------------------

const ENTORNO_ENSAYO = 'ensayo-respaldo'
const LIMITE_CUERPO_IMPORTACION = 64 * 1024 * 1024
const GUARDA = 'solo-ensayo-local'

const importar = async (inst, clase, { texto, confirmacion }) => {
  if (confirmacion !== GUARDA || inst.env.ENTORNO !== ENTORNO_ENSAYO) return { estado: 'rechazado', motivo: 'no-es-un-ensayo' }
  let respaldo
  try { respaldo = JSON.parse(texto) } catch { return { estado: 'rechazado', motivo: 'json-ilegible' } }
  return importarObjeto(inst.almacen, respaldo, { clase })
}

export class LigaDO extends LigaBase {
  importarRespaldoEnsayo(a) { return importar(this, 'LigaDO', a) }
}
export class AccesoDO extends AccesoBase {
  importarRespaldoEnsayo(a) { return importar(this, 'AccesoDO', a) }
}

const RE = /^\/v1\/ensayo\/respaldo\/(?:ligas\/([A-Za-z0-9_-]{1,64})|(acceso))\/importar$/

export default {
  async fetch(request, env) {
    const m = RE.exec(new URL(request.url).pathname)
    if (!m) return worker.fetch(request, env)
    if (env.ENTORNO !== ENTORNO_ENSAYO || !administracionHabilitada(env)) return responder(404, { error: 'no-encontrado' })
    if (m[1] !== undefined && !ligaAdmitida(env, m[1])) return responder(404, { error: 'no-encontrado' })
    if (request.method !== 'POST') return responder(405, { error: 'metodo-no-permitido' })
    const token = tokenDeEncabezado(request.headers.get('authorization'))
    if (token === null || !(await textosIguales(token, env.ACCESO_ADMIN_TOKEN))) return responder(401, { error: 'no-autorizado' })
    const texto = await request.text()
    if (texto.length > LIMITE_CUERPO_IMPORTACION) return responder(413, { error: 'demasiado-grande' })
    const stub = m[2] ? env.ACCESO.get(env.ACCESO.idFromName('acceso')) : env.LIGA.get(env.LIGA.idFromName(m[1]))
    const r = await stub.importarRespaldoEnsayo({ texto, confirmacion: GUARDA })
    return responder(r.estado === 'ok' ? 200 : 409, r)
  },
}
