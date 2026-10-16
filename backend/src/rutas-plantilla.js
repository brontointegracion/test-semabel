import { ligaAdmitida } from './admision.js'
import { validarSolicitud } from './plantilla.js'
import { leerJsonAcotado, metodoNoPermitido, noAutorizado, noEncontrado, rechazoCsrf, responder } from './acceso/http.js'

// ---------------------------------------------------------------------------
// Rutas de plantilla del organizador (cookie de sesión + CSRF en las que escriben). Las direcciones son solo
// navegación: la autoridad viene de la sesión y de la posesión de la liga, nunca de la URL.
//
//   GET  /v1/organizador/ligas/{liga}                                       liga y equipos (con bloqueo y conteos)
//   GET  /v1/organizador/ligas/{liga}/equipos/{equipo}/jugadores            plantilla (activos e inactivos) con campos privados
//   POST /v1/organizador/ligas/{liga}/equipos/{equipo}/jugadores            alta
//   POST …/jugadores/{ficha}/editar | /desactivar | /reactivar
//
// No existe ninguna ruta para borrar una ficha ni para escribir sin conexión. El cuerpo es de 8 KiB como máximo y
// solo admite las claves listadas en plantilla.js (ninguna de cola, borrador u hora del cliente).
//
// ALTA ENTRE LIGAS. El alta puede necesitar leer OTRAS ligas del mismo organizador (candidatos con el mismo nombre, o
// la ficha de origen de un vínculo explícito). El orden es: (1) la liga de destino mira primero su recibo previo y
// sus propias puertas, y si necesita lectura externa lo dice SIN escribir; (2) este Worker lee las otras ligas con
// la misma afirmación (cada una la comprueba como primera sentencia de su transacción); (3) la liga de destino
// vuelve a ejecutar, repitiendo recibo, alcance y bloqueo, ahora con esa evidencia. Un reintento exacto se resuelve
// en (1): no depende de que las otras ligas estén disponibles ni de que hayan cambiado.
// LÍMITES: leer otra liga y escribir en esta no son atómicos (no hay transacción entre objetos): dos altas
// concurrentes de la misma persona, o un alta mientras otra liga añade a esa persona, pueden no verse y crear dos
// identidades. Los candidatos se encuentran por NOMBRE normalizado: otra escritura, un apellido distinto o una ficha
// sin partes de nombre no coinciden. Nada de esto prueba unicidad global; solo sugiere y, con un vínculo explícito,
// verifica que la ficha de origen existe (una ficha y su persona no se borran ni se cambian, así que esa
// comprobación no caduca). El enlace entre ligas nunca se deduce del nombre.
// ---------------------------------------------------------------------------

const ID = '[A-Za-z0-9_-]{1,64}'
const RE_LIGA = new RegExp(`^/v1/organizador/ligas/(${ID})$`)
const RE_JUGADORES = new RegExp(`^/v1/organizador/ligas/(${ID})/equipos/(${ID})/jugadores$`)
const RE_ACCION = new RegExp(`^/v1/organizador/ligas/(${ID})/equipos/(${ID})/jugadores/(${ID})/(editar|desactivar|reactivar)$`)
const MAX_CUERPO_BYTES = 8 * 1024

function respuestaDe(r, desconocido) {
  switch (r?.tipo) {
    case 'decidido': return responder(200, { ...r.cuerpo, reproducido: r.reproducido === true }, { vary: 'Cookie' })
    case 'operacion-conflicto': return responder(409, { error: 'operacion-conflicto' })
    case 'no-encontrado': return noEncontrado()
    case 'no-autorizado': return noAutorizado()
    case 'identidad-no-verificable': return responder(503, { error: 'identidad-no-verificable', reintento: 'misma-solicitud' })
    default: return desconocido()
  }
}

/** Lee las otras ligas del organizador y arma la evidencia que pide la liga de destino. */
async function armarVerificacion(env, ligaDO, asercion, pedido) {
  const noVerificable = { tipo: 'identidad-no-verificable' }
  try {
    if (pedido.accion === 'candidatos') {
      const candidatos = []
      for (const otra of pedido.ligasOtras) {
        if (!ligaAdmitida(env, otra)) return noVerificable
        const r = await ligaDO(env, otra).candidatosParaOtraLiga({ asercion, ligaId: otra, clave: pedido.clave })
        if (r?.tipo === 'asercion-vencida' || r?.tipo === 'no-autorizado') return r
        if (r?.tipo !== 'ok' || !Array.isArray(r.candidatos)) return noVerificable
        candidatos.push(...r.candidatos)
      }
      return { tipo: 'ok', verificacion: { ligasConsultadas: pedido.ligasOtras, candidatos } }
    }
    if (pedido.accion === 'vinculo') {
      if (!ligaAdmitida(env, pedido.ligaOrigenId)) return noVerificable
      const r = await ligaDO(env, pedido.ligaOrigenId).resolverFichaParaOtraLiga({ asercion, ligaId: pedido.ligaOrigenId, fichaId: pedido.fichaOrigenId })
      if (r?.tipo === 'asercion-vencida' || r?.tipo === 'no-autorizado') return r
      if (r?.tipo !== 'ok') return noVerificable
      return { tipo: 'ok', verificacion: { vinculo: r.vinculo } }
    }
  } catch {
    return noVerificable // no se pudo leer la otra liga: no se escribe nada y el mismo intento se puede repetir
  }
  return noVerificable
}

/** → Response si la ruta es de plantilla; null si no lo es. */
export async function manejarPlantilla(request, env, pathname, config, { conSesionDeOrganizador, ligaDO, desconocido }) {
  let m
  if ((m = RE_LIGA.exec(pathname)) || (m = RE_JUGADORES.exec(pathname)) || (m = RE_ACCION.exec(pathname))) {
    const [, ligaId, equipoId, fichaId, accion] = m
    const esLiga = RE_LIGA.test(pathname)
    const esLista = RE_JUGADORES.test(pathname)
    if (!ligaAdmitida(env, ligaId)) return noEncontrado()

    // --- Lecturas ---
    const lee = esLiga || (esLista && request.method === 'GET')
    if (lee) {
      if (request.method !== 'GET') return metodoNoPermitido(esLiga ? 'GET' : 'GET, POST')
      try {
        const r = await conSesionDeOrganizador(request, env, ligaId, (asercion) => (esLiga
          ? ligaDO(env, ligaId).leerLigaOrganizador({ asercion, ligaId })
          : ligaDO(env, ligaId).leerPlantillaOrganizador({ asercion, ligaId, equipoId })))
        if (r instanceof Response) return r
        if (r?.tipo === 'no-autorizado') return noAutorizado()
        if (r?.tipo === 'no-encontrado') return noEncontrado()
        if (r?.tipo !== 'ok') return desconocido()
        const { tipo: _tipo, ...cuerpo } = r
        return responder(200, cuerpo, { vary: 'Cookie' })
      } catch {
        return desconocido()
      }
    }

    // --- Escrituras ---
    if (request.method !== 'POST') return metodoNoPermitido(esLista ? 'GET, POST' : 'POST')
    const csrf = rechazoCsrf(request, config)
    if (csrf) return csrf
    const { valor, error } = await leerJsonAcotado(request, MAX_CUERPO_BYTES)
    if (error) return error
    const tipo = esLista ? 'alta' : accion
    const solicitud = validarSolicitud(tipo, valor)
    if (!solicitud.ok) return responder(422, { error: 'solicitud-invalida' })
    try {
      const r = await conSesionDeOrganizador(request, env, ligaId, async (asercion) => {
        const base = { asercion, ligaId, tipo, equipoId, fichaId: esLista ? null : fichaId, operacionId: solicitud.operacionId, contenido: solicitud.contenido }
        let resultado = await ligaDO(env, ligaId).ejecutarOperacionPlantilla(base)
        if (resultado?.tipo !== 'requiere-verificacion') return resultado
        const evidencia = await armarVerificacion(env, ligaDO, asercion, resultado)
        if (evidencia.tipo !== 'ok') return evidencia
        resultado = await ligaDO(env, ligaId).ejecutarOperacionPlantilla({ ...base, verificacion: evidencia.verificacion })
        return resultado?.tipo === 'requiere-verificacion' ? { tipo: 'identidad-no-verificable' } : resultado
      })
      if (r instanceof Response) return r
      return respuestaDe(r, desconocido)
    } catch {
      return desconocido()
    }
  }
  return null
}
