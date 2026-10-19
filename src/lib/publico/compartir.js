import { fechaCortaPanama, horaPanama, textoSede } from './formato.js'

// ---------------------------------------------------------------------------
// Compartir un partido (REPORT_179). Funciones puras. Lo único que se comparte es la dirección PÚBLICA y canónica del partido
// (/liga/<liga>/partido/<nombre-sufijo>, la de `enlacesDePartidos`) sobre el origen ACTUAL, y un texto con datos que ya son públicos
// (liga, equipos, fecha y hora de Panamá, sede, y el resultado si el partido terminó). Nunca códigos, credenciales, rutas privadas ni datos
// de jugadores. El texto no promete nada que el estado desmienta: uno en vivo o terminado no se presenta como próximo.
// ---------------------------------------------------------------------------

const RUTA_PUBLICA_DE_PARTIDO = /^\/liga\/[^/?#\s]+\/partido\/[^/?#\s]+$/

/** → URL absoluta del partido sobre `origen`, o null si el origen no es http(s) o la ruta no es una dirección pública de partido. */
export function urlPublicaDePartido(origen, ruta) {
  if (typeof ruta !== 'string' || !RUTA_PUBLICA_DE_PARTIDO.test(ruta)) return null
  let o
  try { o = new URL(origen) } catch { return null }
  if (o.protocol !== 'https:' && o.protocol !== 'http:') return null
  return `${o.origin}${ruta}`
}

const cuandoTexto = (iso) => (iso ? `${fechaCortaPanama(iso)}, ${horaPanama(iso)} (hora de Panamá)` : null)

/**
 * Texto para compartir. `partido`: { liga, local, visita, estado, programadoPara, inicioReal, sede, puntosLocal, puntosVisita }.
 * - programado: fecha y hora de Panamá (o «Fecha y hora por confirmar») y sede («Por avisar» si no hay).
 * - vivo: «En vivo ahora» (sin marcador: cambia y quedaría viejo); la hora de inicio si se conoce.
 * - final: el resultado final y la fecha si se conoce.
 */
export function mensajeDePartido({ liga, local, visita, estado, programadoPara = null, inicioReal = null, sede = null, puntosLocal = null, puntosVisita = null }, url) {
  const lineas = []
  if (liga) lineas.push(liga)
  if (estado === 'final' && Number.isInteger(puntosLocal) && Number.isInteger(puntosVisita)) {
    lineas.push(`${local} ${puntosLocal}–${puntosVisita} ${visita}`, 'Resultado final.')
    const c = cuandoTexto(programadoPara ?? inicioReal)
    if (c) lineas.push(`Fecha: ${c}`)
    lineas.push(`Ver el partido: ${url}`)
  } else if (estado === 'final') {
    lineas.push(`${local} vs ${visita}`, 'Partido terminado.')
    lineas.push(`Ver el partido: ${url}`)
  } else if (estado === 'vivo') {
    lineas.push(`${local} vs ${visita}`, 'En vivo ahora.')
    const c = cuandoTexto(inicioReal ?? programadoPara)
    if (c) lineas.push(`Comenzó: ${c}`)
    const s = textoSede({ estado, sede })
    if (s) lineas.push(`Sede: ${s}`)
    lineas.push(`Sigue el marcador: ${url}`)
  } else {
    lineas.push(`${local} vs ${visita}`)
    lineas.push(cuandoTexto(programadoPara) ?? 'Fecha y hora por confirmar')
    lineas.push(`Sede: ${textoSede({ estado: 'programado', sede })}`)
    lineas.push(`Marcador y detalles: ${url}`)
  }
  return lineas.join('\n')
}

/** Dirección que abre el redactor de WhatsApp con el texto ya escrito. Abrirla NO envía nada: la persona elige el chat y pulsa enviar. */
export const urlWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`

// --- Invitación de activación (REPORT_182) -------------------------------------------------------------------------------------------
// Es PRIVADA: la usa el organizador para mandar a otra persona la dirección de la pantalla de ACTIVACIÓN del teléfono que va a puntuar
// (/control/<liga>/<partido>). La dirección lleva solo los dos identificadores públicos: ni código, ni token, ni sesión, ni búsqueda, ni
// fragmento. El CÓDIGO nunca forma parte del enlace ni del mensaje: se comparte aparte. Activar el teléfono no comienza el partido.

const ID_PUBLICO = /^[A-Za-z0-9_-]{1,64}$/

/** → URL absoluta de la pantalla de activación sobre `origen`, o null si el origen no es http(s) o algún identificador no es válido. */
export function urlActivacion(origen, ligaId, partidoId) {
  if (typeof ligaId !== 'string' || typeof partidoId !== 'string' || !ID_PUBLICO.test(ligaId) || !ID_PUBLICO.test(partidoId)) return null
  let o
  try { o = new URL(origen) } catch { return null }
  if (o.protocol !== 'https:' && o.protocol !== 'http:') return null
  return `${o.origin}/control/${ligaId}/${partidoId}`
}

/** Texto de la invitación: equipos y enlace, y la aclaración de que el código se entrega aparte. No recibe ni puede contener el código. */
export function mensajeInvitacion({ local, visita }, url) {
  return [
    `Activación del teléfono de puntuación: ${local} vs ${visita}`,
    `Abre este enlace en el teléfono con el que vas a puntuar: ${url}`,
    'El código te lo da el organizador por separado. Activar el teléfono no comienza el partido.',
  ].join('\n')
}

/** ¿El origen es de este mismo computador (localhost, 127.x, ::1)? Un teléfono físico no podría abrir esa dirección. */
export function esOrigenLoopback(origen) {
  try {
    const h = new URL(origen).hostname.toLowerCase()
    return h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h)
  } catch { return false }
}

/** Copia `texto` al portapapeles. → true solo si el navegador confirmó la copia; false si no hay portapapeles o lo negó. Nunca registra el texto. */
export async function copiarTexto(texto) {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
