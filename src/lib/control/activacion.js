import { activar, sondear, SIN_CONEXION } from './activacion-api'
import { guardar, idValido, leerRegistro } from './activacion-almacen'

// ---------------------------------------------------------------------------
// Activación del teléfono que controlará un partido. Esta pieza SOLO activa y comprueba: no inicia el partido, no puntúa
// y nunca llama a /comandos.
//
// IDENTIDAD. Un token de 32 bytes criptográficos (64 hex) y su hash SHA-256 exacto. Se guarda y se LEE DE VUELTA antes de
// la primera petición; si no se puede, no se envía nada (no existe una activación solo en memoria). Hay UN registro por
// (liga, partido): el mismo token y el mismo hash se reutilizan siempre, también tras perder la respuesta. Nunca se genera
// otra identidad para una activación sin resolver, y NADA aquí reemplaza ni borra un registro: ni un 401, ni un sondeo.
//
// ORDEN de un intento (bajo un candado de Web Locks por liga+partido, hasta clasificar la respuesta):
//   1. sin conexión → la frase aprobada; no se genera nada ni se guarda nada;
//   2. registro ilegible → no se envía, se conserva;
//   3. no hay registro → se genera la identidad y se guarda (con la comprobación de capacidad bajo un candado global breve);
//      hay registro → se marca «activando» (con la incertidumbre ya anotada si venía de un intento sin resolver) y se guarda;
//   4. se envía { codigo, tokenHash } con el hash guardado;
//   5. el resultado se guarda. Un rechazo posterior NO borra una incertidumbre anterior: `conIncierto` solo se limpia con una
//      activación confirmada (200 de activar o 200 de la lectura protegida).
// El código solo existe en memoria durante la petición. Un registro «activando» que se encuentra al recargar significa que la
// pestaña murió con la petición en vuelo: se trata como incierto, y nada se reenvía solo.
// ---------------------------------------------------------------------------

export { SIN_CONEXION }

export const MENSAJES = Object.freeze({
  'sin-conexion': SIN_CONEXION,
  'enlace-invalido': 'Este enlace no es válido.',
  'codigo-invalido': 'Escribe el código del partido.',
  ocupado: 'Ya hay una activación en curso para este partido, en esta u otra pestaña. Espera a que termine.',
  'sin-candado': 'Este navegador no permite coordinar varias pestañas con seguridad, así que no se envía nada desde aquí. No se envió nada.',
  almacenamiento: 'No pudimos guardar en este teléfono el registro necesario para recuperar la activación si se pierde la respuesta. No se envió nada.',
  capacidad: 'Hay demasiados registros de control guardados en este teléfono. No se envió nada y no se borra ninguno automáticamente.',
  corrupto: 'Hay un registro de control ilegible o inesperado para este partido. Se conserva sin tocar. No se envió nada.',
  'sin-criptografia': 'Este navegador no puede generar la identidad segura de este teléfono. No se envió nada.',
  denegada: 'El servidor no activó este teléfono con ese código. El código puede ser incorrecto, estar vencido o ya usado, o el control de este partido puede no estar disponible. Pide al organizador que revise el control de este partido. Si vuelves a escribir un código, se reutiliza la identidad ya guardada de este teléfono.',
  limitada: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  'no-encontrada': 'No encontramos este partido en el servidor.',
  protocolo: 'El servidor no aceptó la solicitud. Este intento no activó nada.',
  incierta: 'No sabemos si el servidor activó este teléfono. Se conserva la identidad guardada: usa «Comprobar ahora» o vuelve a escribir el código.',
  'no-guardada': 'El servidor respondió, pero no pudimos guardar el resultado en este teléfono. Todavía no cuenta como activado aquí: usa «Comprobar ahora».',
  'acceso-confirmado-sin-estado': 'Acceso confirmado; no se pudo cargar el estado.',
  'no-activa': 'La credencial guardada no está activa ahora. Puede estar revocada, vencida o solo admitir reintentos de recibos; no sabemos cuál. El organizador puede revisar el control de este partido. El registro de este teléfono se conserva sin cambios.',
  'sin-resultado': 'No pudimos comprobarlo ahora. El registro de este teléfono se conserva sin cambios.',
})

export const urlControl = (ligaId, partidoId) => `/control/${ligaId}/${partidoId}`

// --- Aviso de cambios (misma pestaña) --------------------------------------------------------------------------------
const oyentes = new Set()
export const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f) }
const notificar = () => { for (const f of oyentes) { try { f() } catch { /* un oyente roto no afecta a los demás */ } } }

// --- Candados --------------------------------------------------------------------------------------------------------
const candados = () => (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null)
export const nombreCandado = (ligaId, partidoId) => `sebel-ctl:${ligaId}:${partidoId}`

async function conCandadoSiLibre(nombre, fn) {
  const c = candados()
  if (!c) return { tipo: 'bloqueado', motivo: 'sin-candado' }
  return c.request(nombre, { mode: 'exclusive', ifAvailable: true }, async (candado) => (candado ? fn() : { tipo: 'bloqueado', motivo: 'ocupado' }))
}
const conCandadoEsperando = (nombre, fn) => candados().request(nombre, { mode: 'exclusive' }, async () => fn())

/** ¿Hay AHORA, en esta u otra pestaña, un intento en vuelo para este partido? Sin Web Locks no se puede saber: false. */
export async function intentoEnVuelo(ligaId, partidoId) {
  try {
    const q = await navigator.locks.query()
    return q.held.some((c) => c.name === nombreCandado(ligaId, partidoId))
  } catch {
    return false
  }
}

// --- Identidad -------------------------------------------------------------------------------------------------------
const aHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** SHA-256 hex (minúsculas) del texto exacto. */
export async function sha256Hex(texto) {
  return aHex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
}

/** → { token, tokenHash } con 32 bytes aleatorios criptográficos, o null si el navegador no puede. */
export async function generarIdentidad() {
  const c = globalThis.crypto
  if (!c || typeof c.getRandomValues !== 'function' || !c.subtle || typeof c.subtle.digest !== 'function') return null
  try {
    const token = aHex(c.getRandomValues(new Uint8Array(32)))
    return { token, tokenHash: await sha256Hex(token) }
  } catch {
    return null
  }
}

const bloqueado = (motivo) => ({ tipo: 'bloqueado', motivo })
const motivoDeGuardado = (g) => (g.motivo === 'capacidad' ? 'capacidad' : g.motivo === 'corrupto' ? 'corrupto' : 'almacenamiento')
const sinConexion = () => typeof navigator !== 'undefined' && navigator.onLine === false

// --- Activar ---------------------------------------------------------------------------------------------------------

/**
 * Un intento de activación con el código tecleado. → { tipo: 'bloqueado', motivo } | { tipo: 'ya-activada', registro }
 *   | { tipo: 'activada'|'denegada'|'limitada'|'no-encontrada'|'protocolo'|'incierta', registro, persistido }
 * `persistido: false` = el servidor respondió pero el resultado no se pudo guardar (queda el registro «activando»).
 */
export async function activarTelefono({ ligaId, partidoId, codigo }) {
  try { return await activarInterno({ ligaId, partidoId, codigo }) } finally { notificar() }
}

async function activarInterno({ ligaId, partidoId, codigo }) {
  if (!idValido(ligaId) || !idValido(partidoId)) return bloqueado('enlace-invalido')
  if (typeof codigo !== 'string' || codigo.trim() === '' || codigo.length > 64) return bloqueado('codigo-invalido')
  if (sinConexion()) return bloqueado('sin-conexion')
  return conCandadoSiLibre(nombreCandado(ligaId, partidoId), async () => {
    const lectura = leerRegistro(ligaId, partidoId)
    if (lectura.tipo === 'no-disponible') return bloqueado('almacenamiento')
    if (lectura.tipo === 'corrupto') return bloqueado('corrupto')

    let registro
    if (lectura.tipo === 'ninguno') {
      const identidad = await generarIdentidad()
      if (!identidad) return bloqueado('sin-criptografia')
      const ahora = Date.now()
      const nuevo = {
        v: 1, ligaId, partidoId, token: identidad.token, tokenHash: identidad.tokenHash, estado: 'activando', conIncierto: false,
        intentos: 1, creadoEn: ahora, actualizadoEn: ahora, deviceId: null, servidor: null,
      }
      // Comprobación de capacidad + escritura bajo un candado global breve (varias pestañas, varios partidos).
      const g = await conCandadoEsperando('sebel-ctl:capacidad', () => guardar(ligaId, partidoId, nuevo, { crear: true }))
      if (!g.ok) return bloqueado(motivoDeGuardado(g))
      registro = nuevo
    } else {
      const previo = lectura.registro
      if (previo.estado === 'activada') return { tipo: 'ya-activada', registro: previo }
      // El token guardado debe seguir siendo el que produce su hash: si no, el registro no es de fiar y se conserva sin tocar.
      if ((await sha256Hex(previo.token)) !== previo.tokenHash) return bloqueado('corrupto')
      const siguiente = {
        ...previo,
        estado: 'activando',
        intentos: previo.intentos + 1,
        // Un intento anterior que quedó «activando» (la pestaña murió) o «incierta» sigue sin resolver.
        conIncierto: previo.conIncierto || previo.estado === 'activando' || previo.estado === 'incierta',
        actualizadoEn: Date.now(),
      }
      const g = guardar(ligaId, partidoId, siguiente)
      if (!g.ok) return bloqueado(motivoDeGuardado(g))
      registro = siguiente
    }
    notificar() // el registro «activando» ya existe: las pantallas de esta pestaña lo muestran

    const r = await activar({ ligaId, partidoId, codigo, tokenHash: registro.tokenHash })
    if (r.clase === 'sin-conexion') return bloqueado('sin-conexion') // se fue la conexión justo antes de enviar: no salió nada

    let destino
    if (r.clase === 'activada') destino = { ...registro, estado: 'activada', conIncierto: false, deviceId: r.deviceId }
    else if (r.clase === 'incierta') destino = { ...registro, estado: 'incierta', conIncierto: true }
    else destino = { ...registro, estado: registro.conIncierto ? 'incierta' : 'denegada' } // un rechazo posterior no borra la incertidumbre
    destino.actualizadoEn = Date.now()
    const g2 = guardar(ligaId, partidoId, destino)
    return { tipo: r.clase, registro: g2.ok ? destino : registro, persistido: g2.ok }
  })
}

// --- Comprobar (lectura protegida, sin código) ----------------------------------------------------------------------

/**
 * Pregunta al servidor, con el token guardado, si la credencial vale AHORA. Solo lee; lo único que puede cambiar es el
 * registro local, y solo hacia «activada» (200 o 507 esperado). Un 401 nunca modifica, reemplaza ni borra nada.
 * → { tipo: 'bloqueado', motivo } | { tipo: 'sin-registro' } | { tipo: 'vigente', datos, registro, persistido }
 *   | { tipo: 'acceso-confirmado-sin-estado', registro, persistido } | { tipo: 'no-activa' } | { tipo: 'sin-resultado' }
 */
export async function comprobarActivacion({ ligaId, partidoId }) {
  try { return await comprobarInterno({ ligaId, partidoId }) } finally { notificar() }
}

async function comprobarInterno({ ligaId, partidoId }) {
  if (!idValido(ligaId) || !idValido(partidoId)) return bloqueado('enlace-invalido')
  if (sinConexion()) return bloqueado('sin-conexion')
  return conCandadoSiLibre(nombreCandado(ligaId, partidoId), async () => {
    const lectura = leerRegistro(ligaId, partidoId)
    if (lectura.tipo === 'no-disponible') return bloqueado('almacenamiento')
    if (lectura.tipo === 'corrupto') return bloqueado('corrupto')
    if (lectura.tipo === 'ninguno') return { tipo: 'sin-registro' }
    const previo = lectura.registro
    if ((await sha256Hex(previo.token)) !== previo.tokenHash) return bloqueado('corrupto')

    const r = await sondear({ ligaId, partidoId, token: previo.token })
    if (r.clase === 'sin-conexion') return bloqueado('sin-conexion')
    if (r.clase === 'sin-credencial') return { tipo: 'no-activa' }
    if (r.clase === 'vigente') {
      // Si ya conocíamos un dispositivo y el servidor dice otro, algo no cuadra: no se toca nada.
      if (previo.deviceId !== null && previo.deviceId !== r.datos.deviceId) return { tipo: 'sin-resultado', motivo: 'dispositivo-distinto' }
      const destino = {
        ...previo,
        estado: 'activada',
        conIncierto: false,
        deviceId: previo.deviceId ?? r.datos.deviceId,
        servidor: { ahoraMs: r.datos.servidorAhoraMs, expiraEn: r.datos.expiraEn, retornoHasta: r.datos.retornoHasta, leidoEn: Date.now() },
        actualizadoEn: Date.now(),
      }
      const g = guardar(ligaId, partidoId, destino)
      return { tipo: 'vigente', datos: r.datos, registro: g.ok ? destino : previo, persistido: g.ok }
    }
    if (r.clase === 'confirmada-sin-estado') {
      // Acceso confirmado: no se inventa ni dispositivo, ni vigencia, ni estado del partido.
      const destino = { ...previo, estado: 'activada', conIncierto: false, actualizadoEn: Date.now() }
      const g = previo.estado === 'activada' && previo.conIncierto === false ? { ok: true } : guardar(ligaId, partidoId, destino)
      return { tipo: 'acceso-confirmado-sin-estado', registro: g.ok ? destino : previo, persistido: g.ok }
    }
    return { tipo: 'sin-resultado' }
  })
}
