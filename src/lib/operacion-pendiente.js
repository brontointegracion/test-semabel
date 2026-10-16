import { SIN_CONEXION, enviarCuerpo, idValido, rutaDeOperacion } from './roster-api'

// ---------------------------------------------------------------------------
// Recuperación EXACTA de una operación de plantilla enviada cuyo resultado no se conoce.
//
// Esto NO es una cola ni un borrador: no guarda plantillas, formularios sin enviar, códigos ni credenciales. Guarda,
// por organizador y liga, UNA operación ya enviada o por enviar: su identificador, el cuerpo exacto que se mandó (texto
// congelado) y unos metadatos mínimos, para poder REPETIR LA MISMA SOLICITUD si se perdió la respuesta. Nunca se
// reenvía sola: solo el botón explícito del organizador.
//
// ORDEN de un envío nuevo (todo bajo un candado de Web Locks por organizador+liga, que se mantiene hasta clasificar la
// respuesta, y uno global y breve solo para la comprobación de capacidad + escritura):
//   1. sin conexión → la frase aprobada; no se genera identificador ni se guarda nada;
//   2. ya hay un registro de esa liga (válido o no) → no se envía otro; ni se pisa ni se expulsa nada;
//   3. capacidad (registros y bytes) → si no cabe, no se envía;
//   4. se guarda el registro y se LEE DE VUELTA para verificarlo; si algo falla, NO se envía (nunca en memoria);
//   5. se envía el cuerpo congelado;
//   6. solo un resultado DECIDIDO y válido de esa operación borra el registro (y se verifica el borrado).
// Cualquier otra cosa lo conserva. Un intento posterior que falle de forma definitiva (401, 404, 413, 422, sin
// escritura…) describe ESE intento: no resuelve un intento anterior incierto. No hay caducidad por tiempo.
//
// LÍMITES (no se pueden eliminar desde aquí):
//   - localStorage NO es un almacén protegido: quien inspeccione el dispositivo puede leer el registro (nombres y, si se
//     escribió, la fecha de nacimiento de un jugador). Tampoco es atómico: por eso se usa Web Locks; sin Web Locks no
//     se envía nada.
//   - Si se borra el almacenamiento del navegador, el modo privado se cierra, el navegador lo desaloja o se pierde el
//     dispositivo, el registro puede desaparecer y la repetición exacta ya NO es posible. La recuperación del lado del
//     servidor cuando se pierde la identidad de la operación no existe todavía.
// ---------------------------------------------------------------------------

// Tope de ligas por organizador: backend/src/acceso/acceso-do.js (provisionar) rechaza más de 10.
export const MAX_LIGAS_PROPIAS = 10
export const MAX_CUERPO_BYTES = 8 * 1024 // el mismo que acepta el servidor
export const MAX_REGISTRO_BYTES = 10 * 1024 // cuerpo + metadatos
export const MAX_REGISTROS = MAX_LIGAS_PROPIAS // uno por liga; también tope total en este navegador
export const MAX_TOTAL_BYTES = MAX_REGISTROS * MAX_REGISTRO_BYTES
export const PREFIJO = 'sebel.op.v1:'

export const MENSAJES_BLOQUEO = Object.freeze({
  'sin-conexion': SIN_CONEXION,
  ocupado: 'Ya hay un envío en curso para esta liga, en esta u otra pestaña. Espera a que termine.',
  pendiente: 'Hay una acción sin confirmar en esta liga. Confírmala antes de enviar otra. No se envió nada.',
  corrupto: 'Hay un registro de recuperación ilegible o inesperado para esta liga. Se conserva sin tocar. No se envió nada.',
  capacidad: 'Hay demasiadas acciones sin confirmar en este navegador. Confírmalas antes de enviar otra. No se envió nada.',
  almacenamiento: 'No pudimos guardar en este navegador el registro necesario para recuperar la acción si se pierde la respuesta. No se envió nada.',
  'sin-candado': 'Este navegador no permite coordinar varias pestañas con seguridad, así que no se envían cambios desde aquí. No se envió nada.',
  'demasiado-grande': 'Esa acción es demasiado grande para enviarla. Acorta los textos. No se envió nada.',
  'cuerpo-invalido': 'No se pudo preparar la solicitud. No se envió nada.',
})

const TIPOS = ['alta', 'editar', 'desactivar', 'reactivar']
const ULTIMOS = ['enviando', 'incierto', 'sesion', 'sin-escritura', 'protocolo', 'conflicto']
const CLAVES = ['v', 'operacionId', 'tipo', 'ligaId', 'equipoId', 'fichaId', 'cuerpoJson', 'creadoEn', 'intentos', 'ultimo', 'conIncierto']
const RE_OPERACION = /^[A-Za-z0-9_-]{16,64}$/

const bytes = (texto) => new TextEncoder().encode(texto).length
export const clave = (organizadorId, ligaId) => `${PREFIJO}${organizadorId}:${ligaId}`

function almacen() {
  try {
    const a = globalThis.localStorage
    return a && typeof a.getItem === 'function' ? a : null
  } catch {
    return null
  }
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Valida la FORMA de un registro leído (texto). → registro | null. No lanza. */
export function validarRegistro(texto, organizadorId, ligaId) {
  try {
    if (typeof texto !== 'string' || bytes(texto) > MAX_REGISTRO_BYTES) return null
    const r = JSON.parse(texto)
    if (!esObjeto(r)) return null
    const claves = Object.keys(r)
    if (claves.length !== CLAVES.length || !CLAVES.every((k) => claves.includes(k))) return null
    if (r.v !== 1 || !RE_OPERACION.test(r.operacionId) || !TIPOS.includes(r.tipo)) return null
    if (r.ligaId !== ligaId || !idValido(r.equipoId)) return null
    if (r.tipo === 'alta' ? r.fichaId !== null : !idValido(r.fichaId)) return null
    if (typeof r.cuerpoJson !== 'string' || bytes(r.cuerpoJson) > MAX_CUERPO_BYTES) return null
    if (!Number.isSafeInteger(r.creadoEn) || !Number.isSafeInteger(r.intentos) || r.intentos < 1) return null
    if (!ULTIMOS.includes(r.ultimo) || typeof r.conIncierto !== 'boolean') return null
    const cuerpo = JSON.parse(r.cuerpoJson)
    if (!esObjeto(cuerpo) || cuerpo.operacionId !== r.operacionId) return null
    void organizadorId
    return r
  } catch {
    return null
  }
}

/**
 * Registros de ESTE organizador. Los de otros organizadores no se muestran (pero cuentan para la capacidad).
 * → { disponible, registros: [{ ligaId, valido, registro? }], total: { n, bytes } }
 */
export function leerRegistros(organizadorId) {
  const a = almacen()
  if (!a) return { disponible: false, registros: [], total: { n: 0, bytes: 0 } }
  const registros = []
  let n = 0
  let total = 0
  try {
    a.getItem(`${PREFIJO}__sonda`) // un almacenamiento vacío no basta para saber si se puede leer
    for (let i = 0; i < a.length; i += 1) {
      const k = a.key(i)
      if (typeof k !== 'string' || !k.startsWith(PREFIJO)) continue
      const texto = a.getItem(k)
      n += 1
      total += typeof texto === 'string' ? bytes(texto) : 0
      const m = /^sebel\.op\.v1:([^:]+):([^:]+)$/.exec(k)
      if (!m || m[1] !== organizadorId) continue
      registros.push({ ligaId: m[2], valido: false, ...(validarRegistro(texto, organizadorId, m[2]) ? { valido: true, registro: validarRegistro(texto, organizadorId, m[2]) } : {}) })
    }
  } catch {
    return { disponible: false, registros: [], total: { n: 0, bytes: 0 } }
  }
  return { disponible: true, registros, total: { n, bytes: total } }
}

export const hayPendientes = (organizadorId) => leerRegistros(organizadorId).registros.length > 0

// --- Aviso de cambios (misma pestaña) -----------------------------------------------------------------------------------
// El evento `storage` solo llega a OTRAS pestañas; las pantallas de esta se enteran por aquí.
const oyentes = new Set()
export const suscribirRegistros = (f) => { oyentes.add(f); return () => oyentes.delete(f) }
const notificar = () => { for (const f of oyentes) { try { f() } catch { /* un oyente roto no afecta a los demás */ } } }

// --- Candados --------------------------------------------------------------------------------------------------------

const candados = () => (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null)

async function conCandadoSiLibre(nombre, fn) {
  const c = candados()
  if (!c) return { tipo: 'bloqueado', motivo: 'sin-candado' }
  return c.request(nombre, { mode: 'exclusive', ifAvailable: true }, async (candado) => (candado ? fn() : { tipo: 'bloqueado', motivo: 'ocupado' }))
}
const conCandadoEsperando = (nombre, fn) => candados().request(nombre, { mode: 'exclusive' }, async () => fn())

// --- Escritura verificada ----------------------------------------------------------------------------------------------

/** Guarda y LEE DE VUELTA. true solo si lo leído es exactamente lo escrito y sigue siendo un registro válido. */
function guardarVerificado(a, k, registro, organizadorId, ligaId) {
  const texto = JSON.stringify(registro)
  if (bytes(texto) > MAX_REGISTRO_BYTES) return false
  try {
    a.setItem(k, texto)
    const leido = a.getItem(k)
    return leido === texto && validarRegistro(leido, organizadorId, ligaId) !== null
  } catch {
    return false
  }
}
function borrarVerificado(a, k) {
  try {
    a.removeItem(k)
    return a.getItem(k) === null
  } catch {
    return false
  }
}

const generarIdOperacion = () => `op-${globalThis.crypto.randomUUID()}`

// --- Intento -------------------------------------------------------------------------------------------------------------

/**
 * Envía el cuerpo del registro (ya guardado y verificado) y aplica el resultado al registro.
 * → { tipo: 'decidido', cuerpo, reproducido, limpiezaFallida } | { tipo: 'incierto'|'sesion'|'conflicto'|'sin-escritura'|'protocolo', ... }
 */
async function intentar(a, k, registro, organizadorId) {
  const r = await enviarCuerpo({ ruta: rutaDeOperacion(registro), cuerpoJson: registro.cuerpoJson, operacionId: registro.operacionId })
  if (r.clase === 'decidido') {
    const limpio = borrarVerificado(a, k)
    return { tipo: 'decidido', cuerpo: r.cuerpo, reproducido: r.cuerpo.reproducido === true, limpiezaFallida: !limpio }
  }
  const actualizar = (cambios) => { guardarVerificado(a, k, { ...registro, ...cambios }, organizadorId, registro.ligaId) } // si falla, queda el estado anterior (más conservador)
  if (r.clase === 'incierto') { actualizar({ ultimo: 'incierto', conIncierto: true }); return { tipo: 'incierto' } }
  if (r.clase === 'conflicto') { actualizar({ ultimo: 'conflicto', conIncierto: true }); return { tipo: 'conflicto' } }
  if (r.clase === 'sesion') { actualizar({ ultimo: 'sesion' }); return { tipo: 'sesion' } }
  // sin-escritura / protocolo: describen ESTE intento. Solo si es el primero (nada incierto antes) la operación queda resuelta
  // como «no aplicada»; si había un intento incierto antes, el registro se conserva.
  const resuelta = registro.conIncierto === false && registro.intentos === 1
  if (resuelta) {
    const limpio = borrarVerificado(a, k)
    return { tipo: r.clase, estado: r.estado ?? null, motivo: r.motivo ?? null, resuelta: true, limpiezaFallida: !limpio }
  }
  actualizar({ ultimo: r.clase })
  return { tipo: r.clase, estado: r.estado ?? null, motivo: r.motivo ?? null, resuelta: false }
}

/**
 * Envío NUEVO de una operación. `contenido` es el cuerpo sin `operacionId`.
 * → { tipo: 'bloqueado', motivo } | resultado de `intentar`
 */
export async function enviarNueva(parametros) {
  try { return await enviarNuevaInterno(parametros) } finally { notificar() }
}
async function enviarNuevaInterno({ organizadorId, ligaId, tipo, equipoId, fichaId = null, contenido }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { tipo: 'bloqueado', motivo: 'sin-conexion' }
  if (!idValido(ligaId) || !idValido(equipoId) || !TIPOS.includes(tipo) || (tipo === 'alta' ? fichaId !== null : !idValido(fichaId))) {
    return { tipo: 'bloqueado', motivo: 'cuerpo-invalido' }
  }
  return conCandadoSiLibre(`sebel-op:${organizadorId}:${ligaId}`, async () => {
    const a = almacen()
    if (!a) return { tipo: 'bloqueado', motivo: 'almacenamiento' }
    const k = clave(organizadorId, ligaId)

    let cuerpoJson
    try { cuerpoJson = JSON.stringify({ operacionId: generarIdOperacion(), ...contenido }) } catch { return { tipo: 'bloqueado', motivo: 'cuerpo-invalido' } }
    if (bytes(cuerpoJson) > MAX_CUERPO_BYTES) return { tipo: 'bloqueado', motivo: 'demasiado-grande' }
    const operacionId = JSON.parse(cuerpoJson).operacionId
    const registro = { v: 1, operacionId, tipo, ligaId, equipoId, fichaId, cuerpoJson, creadoEn: Date.now(), intentos: 1, ultimo: 'enviando', conIncierto: false }

    // Comprobación de capacidad + escritura bajo un candado global breve (varias pestañas, varias ligas).
    const escrito = await conCandadoEsperando('sebel-op:capacidad', () => {
      let existente
      try { existente = a.getItem(k) } catch { return { tipo: 'bloqueado', motivo: 'almacenamiento' } }
      if (existente !== null) return { tipo: 'bloqueado', motivo: validarRegistro(existente, organizadorId, ligaId) ? 'pendiente' : 'corrupto' }
      const { disponible, total } = leerRegistros(organizadorId)
      if (!disponible) return { tipo: 'bloqueado', motivo: 'almacenamiento' }
      if (total.n >= MAX_REGISTROS || total.bytes + bytes(JSON.stringify(registro)) > MAX_TOTAL_BYTES) return { tipo: 'bloqueado', motivo: 'capacidad' }
      return guardarVerificado(a, k, registro, organizadorId, ligaId) ? { tipo: 'ok' } : { tipo: 'bloqueado', motivo: 'almacenamiento' }
    })
    if (escrito.tipo !== 'ok') return escrito
    notificar() // el registro ya existe: las pantallas de esta pestaña lo muestran como «enviando»
    return intentar(a, k, registro, organizadorId)
  })
}

/**
 * Repite EXACTAMENTE la solicitud guardada de esa liga (mismo identificador, mismo cuerpo). Solo por acción explícita.
 * → { tipo: 'bloqueado', motivo } | resultado de `intentar`
 */
export async function reintentar(parametros) {
  try { return await reintentarInterno(parametros) } finally { notificar() }
}
async function reintentarInterno({ organizadorId, ligaId }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { tipo: 'bloqueado', motivo: 'sin-conexion' }
  if (!idValido(ligaId)) return { tipo: 'bloqueado', motivo: 'cuerpo-invalido' }
  return conCandadoSiLibre(`sebel-op:${organizadorId}:${ligaId}`, async () => {
    const a = almacen()
    if (!a) return { tipo: 'bloqueado', motivo: 'almacenamiento' }
    const k = clave(organizadorId, ligaId)
    let texto
    try { texto = a.getItem(k) } catch { return { tipo: 'bloqueado', motivo: 'almacenamiento' } }
    if (texto === null) return { tipo: 'bloqueado', motivo: 'cuerpo-invalido' }
    const registro = validarRegistro(texto, organizadorId, ligaId)
    if (!registro) return { tipo: 'bloqueado', motivo: 'corrupto' }
    // Un intento que quedó «enviando» (recarga a mitad del envío) cuenta como incierto.
    const siguiente = { ...registro, intentos: registro.intentos + 1, ultimo: 'enviando', conIncierto: registro.conIncierto || registro.ultimo === 'enviando' }
    if (!guardarVerificado(a, k, siguiente, organizadorId, ligaId)) return { tipo: 'bloqueado', motivo: 'almacenamiento' }
    return intentar(a, k, siguiente, organizadorId)
  })
}
