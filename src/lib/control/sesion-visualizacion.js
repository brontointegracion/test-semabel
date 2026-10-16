// ---------------------------------------------------------------------------
// DATOS PARA MOSTRAR de la sesión de puntuación (REPORT_127). PURO: sin red, sin almacenamiento, sin relojes.
//
// Qué es: nombres de equipos y de jugadores y números de camiseta, para que la pantalla muestre «#2 Saúl Montero» incluso tras
// recargar sin conexión. NO es identidad: los comandos siguen apuntando a los ids de registro de siempre (atribución), y estos
// datos no entran en la comparación del estado del juego, en la huella de la atribución ni en ningún sobre.
//
// Forma guardada (en la fila de sesión, dentro de la misma contabilidad que todo lo demás):
//   { v: 1, atribucionVersion, equipos: [{ id, nombre }], jugadores: [{ id, equipoId, nombrePila, apellido1, dorsal, activo }] }
//   - nombrePila / apellido1: texto o `null` (no se inventan a partir del nombre completo);
//   - dorsal: entero 0–99 (el 0 es un número real) o `null` (un hueco jamás se convierte en 0);
//   - activo: la distinción activo/elegible que ya existe; un jugador inactivo con eventos sigue siendo resoluble.
//   - NO hay fecha de nacimiento, contacto, documentos, personaId, códigos, apellido2, nombre en camiseta ni credenciales.
//
// Qué NO sabe: el número que tenía un jugador EN EL MOMENTO de cada evento. Solo se guarda el número ACTUAL (el de la última
// lectura autorizada); `dorsalAlEvento` es siempre `null` y nada lo afirma.
// ---------------------------------------------------------------------------

export const VERSION_VISUALIZACION = 1
export const MAX_VISUALIZACION_BYTES = 96 * 1024
const MAX_NOMBRE_EQUIPO = 200
const MAX_NOMBRE_PERSONA = 100
const MAX_JUGADORES = 400
const CLAVES_RAIZ = ['equipos', 'jugadores']
const CLAVES_RAIZ_GUARDADA = ['v', 'atribucionVersion', 'equipos', 'jugadores']
const CLAVES_EQUIPO = ['id', 'nombre']
const CLAVES_JUGADOR = ['id', 'equipoId', 'nombrePila', 'apellido1', 'dorsal', 'activo']

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const texto = (v) => typeof v === 'string' && v.length > 0
const mismasClaves = (o, claves) => esObjeto(o) && Object.keys(o).length === claves.length && claves.every((c) => Object.prototype.hasOwnProperty.call(o, c))
const sinControl = (s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s)
const nombreValido = (s, max) => typeof s === 'string' && s.trim() !== '' && s.length <= max && sinControl(s)
const dorsalValido = (d) => d === null || (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 99)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const bytes = (t) => new TextEncoder().encode(t).length

/** Comprobación ESTRUCTURAL (sin contraste con una atribución). → motivo | null */
function estructura(v, { guardada }) {
  if (!mismasClaves(v, guardada ? CLAVES_RAIZ_GUARDADA : CLAVES_RAIZ)) return 'forma'
  if (guardada && (v.v !== VERSION_VISUALIZACION || !texto(v.atribucionVersion))) return 'cabecera'
  if (!Array.isArray(v.equipos) || v.equipos.length < 1 || v.equipos.length > 2) return 'equipos'
  const idsEquipo = new Set()
  for (const e of v.equipos) {
    if (!mismasClaves(e, CLAVES_EQUIPO) || !texto(e.id) || !nombreValido(e.nombre, MAX_NOMBRE_EQUIPO)) return 'equipo'
    if (idsEquipo.has(e.id)) return 'equipo-repetido'
    idsEquipo.add(e.id)
  }
  if (!Array.isArray(v.jugadores) || v.jugadores.length > MAX_JUGADORES) return 'jugadores'
  const ids = new Set()
  for (const j of v.jugadores) {
    if (!mismasClaves(j, CLAVES_JUGADOR) || !texto(j.id) || !texto(j.equipoId) || !idsEquipo.has(j.equipoId)) return 'jugador'
    if (ids.has(j.id)) return 'jugador-repetido'
    ids.add(j.id)
    if (!(j.nombrePila === null || nombreValido(j.nombrePila, MAX_NOMBRE_PERSONA))) return 'nombre'
    if (!(j.apellido1 === null || nombreValido(j.apellido1, MAX_NOMBRE_PERSONA))) return 'apellido'
    if (!dorsalValido(j.dorsal)) return 'dorsal'
    if (typeof j.activo !== 'boolean') return 'activo'
  }
  if (bytes(JSON.stringify(v)) > MAX_VISUALIZACION_BYTES) return 'demasiado-grande'
  return null
}

/** Validación de lo que llega del servidor, contrastada con la atribución ÍNTEGRA y los equipos del partido de la MISMA instantánea. */
export function validarVisualizacion(v, { atribucion, partido, eventos = [] } = {}) {
  const no = (motivo) => ({ ok: false, motivo })
  const motivo = estructura(v, { guardada: false })
  if (motivo) return no(motivo)
  if (!atribucion || !texto(atribucion.version) || !esObjeto(atribucion.jugadores) || !Array.isArray(atribucion.equipos)) return no('sin-atribucion')
  if (!esObjeto(partido) || !texto(partido.localId) || !texto(partido.visitaId)) return no('sin-equipos-del-partido')
  const delPartido = [...new Set([partido.localId, partido.visitaId])].sort(cmp)
  const deAtribucion = [...atribucion.equipos].sort(cmp)
  const dePantalla = v.equipos.map((e) => e.id).sort(cmp)
  if (JSON.stringify(delPartido) !== JSON.stringify(dePantalla) || JSON.stringify(delPartido) !== JSON.stringify(deAtribucion)) return no('equipos-inconsistentes')
  const porId = new Map(v.jugadores.map((j) => [j.id, j]))
  for (const j of v.jugadores) {
    if (!Object.prototype.hasOwnProperty.call(atribucion.jugadores, j.id)) return no('jugador-fuera-de-la-atribucion')
    const a = atribucion.jugadores[j.id]
    if (a.equipoId !== j.equipoId) return no('jugador-de-otro-equipo')
    if (a.elegible !== j.activo) return no('activo-distinto-de-elegible')
  }
  // La lista debe bastar para ELEGIR (todo elegible está) y para ETIQUETAR la historia (todo jugador de un evento está).
  for (const [id, a] of Object.entries(atribucion.jugadores)) if (a.elegible && !porId.has(id)) return no('elegible-ausente')
  for (const e of eventos) if (typeof e.jugadorId === 'string' && !porId.has(e.jugadorId)) return no('jugador-de-evento-ausente')
  // Forma canónica y estable (mismos bytes para los mismos datos): equipos en el orden dado, jugadores por id.
  const jugadores = [...v.jugadores].sort((a, b) => cmp(a.id, b.id)).map((j) => ({
    id: j.id, equipoId: j.equipoId, nombrePila: j.nombrePila, apellido1: j.apellido1, dorsal: j.dorsal, activo: j.activo,
  }))
  const equipos = v.equipos.map((e) => ({ id: e.id, nombre: e.nombre }))
  return { ok: true, visualizacion: { v: VERSION_VISUALIZACION, atribucionVersion: atribucion.version, equipos, jugadores } }
}

/** Lo que se lee de la fila guardada: solo la estructura (el contraste ya se hizo al guardarla). */
export function validarFilaVisualizacion(v) {
  const motivo = estructura(v, { guardada: true })
  return motivo ? { ok: false, motivo } : { ok: true }
}

export const igualesVisualizacion = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Estado para quien muestra: «disponible» o «no disponible», sin inventar nada. */
export function datosParaMostrar(sesion) {
  const v = sesion?.visualizacion
  if (v === undefined || v === null) return { disponible: false, motivo: 'sin-datos-de-pantalla', equipos: [], jugadores: [] }
  const base = sesion.base?.estado?.atribucion?.version ?? null
  return {
    disponible: true,
    motivo: null,
    desactualizada: base !== null && v.atribucionVersion !== base,
    atribucionVersion: v.atribucionVersion,
    equipos: v.equipos,
    jugadores: v.jugadores,
  }
}

/**
 * Cómo llamar a un jugador. SIEMPRE resoluble mientras esté en la lista (también inactivo). El número es el ACTUAL; el que tenía
 * en el momento de un evento NO se guardó (`dorsalAlEvento: null`). Sin datos: se cae a la etiqueta de la instantánea si la hay,
 * y si no, a `null`: nunca se inventa un nombre ni un número.
 */
export function descripcionDeJugador(sesion, jugadorId) {
  const j = sesion?.visualizacion?.jugadores?.find((x) => x.id === jugadorId) ?? null
  if (j) {
    const nombre = [j.nombrePila, j.apellido1].filter((x) => x !== null).join(' ')
    const dorsalActual = j.dorsal
    return {
      origen: 'visualizacion',
      id: j.id,
      equipoId: j.equipoId,
      nombre: nombre === '' ? null : nombre,
      dorsalActual,
      dorsalAlEvento: null,
      activo: j.activo,
      texto: [dorsalActual === null ? null : `#${dorsalActual}`, nombre === '' ? null : nombre].filter((x) => x !== null).join(' ') || null,
    }
  }
  const e = sesion?.etiquetas?.find?.((x) => x.id === jugadorId) ?? null
  if (e && typeof e.etiqueta === 'string' && e.etiqueta !== '') {
    return { origen: 'etiqueta', id: jugadorId, equipoId: null, nombre: e.etiqueta, dorsalActual: null, dorsalAlEvento: null, activo: null, texto: e.etiqueta }
  }
  return { origen: 'ninguna', id: jugadorId, equipoId: null, nombre: null, dorsalActual: null, dorsalAlEvento: null, activo: null, texto: null }
}
