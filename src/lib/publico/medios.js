import { pedirJson, rutaMedios } from './cliente.js'

// ---------------------------------------------------------------------------
// Medios del PILOTO (REPORT_191): logos de equipos y del organizador y patrocinadores, configurados A MANO como archivos estáticos locales.
// No hay servicio de carga, ni imágenes externas, ni pantalla de administración. El usuario edita public/medios/manifest.json y coloca las
// imágenes dentro de public/medios/ (ver docs/medios-piloto.md). Todo se indexa por identificadores estables: el id de la liga y el id del equipo.
//
//   { "version": 1,
//     "ligas": { "<LIGA_ID>": {
//        "organizador":    { "logo": "<liga>/organizador.png" },
//        "equipos":        { "<EQUIPO_ID>": { "logo": "<liga>/equipo.png", "color": "#1F4FA3" } },
//        "patrocinadores": [ <patrocinador>, … ] } } }
//
// Un patrocinador tiene UNO de dos formatos (campo `formato`; el mismo componente de pantalla muestra la publicidad del organizador y la de Semabel):
//   "tarjeta"  Tarjeta estructurada (el diseño v0): Semabel pinta nombre grande, rubro corto y, si se da, el logo, con los colores de la marca.
//                { id, formato, nombre*, descriptor, logo, fondo, texto, acento, borde, disposicion }        (* obligatorio)
//                `disposicion: "logo"` (solo con `logo` válido): variante con el LOGO como protagonista (REPORT_194): el logo completo ocupa la tarjeta, el nombre queda
//                solo como texto accesible (el logo ya lo lleva) y el rubro se pinta como texto. Sin ella, la tarjeta es la de siempre.
//   "arte"     Arte terminado: una imagen local ya compuesta, mostrada sin deformarla y sobre su propio fondo.
//                { id, formato, imagen*, imagenGrande, fondo, nombre, descriptor, texto, acento, borde }   (nombre y colores solo se usan si la imagen falla)
// Sin `formato` se deduce como antes: con `imagen` válida es «arte»; si no, «tarjeta». Así los manifiestos del REPORT_191 (id, nombre, descriptor,
// imagen, fondo) siguen funcionando igual. Colores: solo #RRGGBB. Los campos desconocidos se descartan; nunca se acepta HTML, CSS ni URLs externas.
//
// Raíz opcional `"semabel": { "logo": "<ruta>" }` (REPORT_196): el logo de Semabel para sus tarjetas de promoción (se registra solo en la configuración local de revisión).
// Las rutas de imagen son relativas a /medios/ y solo pueden ser archivos png, jpg, webp, gif o svg de ESTE sitio: cualquier otra cosa (una
// URL, «..», un esquema) se descarta. Un manifiesto ausente, roto o con entradas malas nunca rompe el marcador: cada entrada mala se omite.
// Sin patrocinadores propios de la liga se muestra la promoción de Semabel; no existe ningún patrocinador por omisión.
// ---------------------------------------------------------------------------

export const MAX_PATROCINADORES = 12
const RE_RUTA = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\.(png|jpe?g|webp|gif|svg)$/i
const RE_COLOR = /^#[0-9A-Fa-f]{6}$/
const FORMATOS = ['tarjeta', 'arte']
const DISPOSICIONES = ['logo']
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/
const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const texto = (v, max) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null)

/** «liga/a.png» → «/medios/liga/a.png», o null si no es una ruta local válida. */
export function urlDeMedio(ruta) {
  if (typeof ruta !== 'string' || !RE_RUTA.test(ruta) || ruta.split('/').some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null
  return `/medios/${ruta}`
}

const color = (v) => (typeof v === 'string' && RE_COLOR.test(v) ? v.toUpperCase() : null)

/** Un patrocinador del manifiesto → la forma normalizada, o null si no hay nada válido que mostrar. Cada campo inválido se descarta por separado. */
export function patrocinadorValido(p) {
  const nombre = texto(p.nombre, 60)
  const descriptor = texto(p.descriptor, 40)
  const imagen = urlDeMedio(p.imagen)
  const imagenGrande = urlDeMedio(p.imagenGrande)
  const logo = urlDeMedio(p.logo)
  const pedido = FORMATOS.includes(p.formato) ? p.formato : null
  // «arte» necesita una imagen válida; sin ella, con nombre, cae a «tarjeta» (como el REPORT_191 mostraba el nombre cuando faltaba la imagen).
  const formato = pedido === 'arte' || (pedido === null && imagen) ? (imagen ? 'arte' : (nombre ? 'tarjeta' : null)) : (nombre ? 'tarjeta' : null)
  if (formato === null) return null
  return { id: p.id, formato, nombre, descriptor, logo, imagen, imagenGrande, fondo: color(p.fondo), texto: color(p.texto), acento: color(p.acento), borde: p.borde === true, disposicion: formato === 'tarjeta' && logo && DISPOSICIONES.includes(p.disposicion) ? p.disposicion : null }
}

// Contraste WCAG entre dos #RRGGBB (para no dejar un texto ilegible sobre su fondo).
const luz = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
export const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
export const FONDO_PREDETERMINADO = '#FFFFFF'
export const TEXTO_OSCURO = '#12151C'
export const UMBRAL_TEXTO = 3 // contraste mínimo del nombre (texto grande)
export const UMBRAL_ACENTO = 2.2 // contraste mínimo del rubro y del logo de acento

/**
 * Colores con los que se pinta una tarjeta: los de la marca si son legibles; si no, se corrigen (nombre: blanco u oscuro según el fondo; rubro:
 * el color del nombre). Los colores del diseño v0 pasan sin cambios.
 */
export function tintasDe(p) {
  const fondo = p.fondo ?? FONDO_PREDETERMINADO
  const legible = contraste('#FFFFFF', fondo) >= contraste(TEXTO_OSCURO, fondo) ? '#FFFFFF' : TEXTO_OSCURO
  const texto = p.texto && contraste(p.texto, fondo) >= UMBRAL_TEXTO ? p.texto : legible
  const acento = p.acento && contraste(p.acento, fondo) >= UMBRAL_ACENTO ? p.acento : texto
  return { fondo, texto, acento }
}

export const MEDIOS_VACIOS = Object.freeze({ organizador: { logo: null }, equipos: {}, patrocinadores: [], semabelLogo: null })

/** Medios de UNA liga a partir del manifiesto ya leído (o null). Siempre devuelve la forma completa; lo inválido se omite. */
export function mediosDeLiga(manifiesto, ligaId) {
  if (!objeto(manifiesto) || manifiesto.version !== 1) return MEDIOS_VACIOS
  // El logo de Semabel es de la raíz (no de una liga): sirve a todas las ligas del manifiesto.
  const semabelLogo = objeto(manifiesto.semabel) ? urlDeMedio(manifiesto.semabel.logo) : null
  if (!objeto(manifiesto.ligas) || typeof ligaId !== 'string' || !Object.hasOwn(manifiesto.ligas, ligaId)) return semabelLogo ? { ...MEDIOS_VACIOS, semabelLogo } : MEDIOS_VACIOS
  const l = manifiesto.ligas[ligaId]
  if (!objeto(l)) return semabelLogo ? { ...MEDIOS_VACIOS, semabelLogo } : MEDIOS_VACIOS
  const equipos = {}
  if (objeto(l.equipos)) {
    for (const [id, e] of Object.entries(l.equipos)) {
      if (!RE_ID.test(id) || !objeto(e)) continue
      const logo = urlDeMedio(e.logo)
      const tinta = color(e.color)
      if (logo || tinta) equipos[id] = { logo, color: tinta }
    }
  }
  const patrocinadores = []
  if (Array.isArray(l.patrocinadores)) {
    const ids = new Set()
    for (const p of l.patrocinadores.slice(0, MAX_PATROCINADORES)) {
      if (!objeto(p) || typeof p.id !== 'string' || !RE_ID.test(p.id) || ids.has(p.id)) continue
      const e = patrocinadorValido(p)
      if (!e) continue
      ids.add(p.id)
      patrocinadores.push(e)
    }
  }
  return { organizador: { logo: objeto(l.organizador) ? urlDeMedio(l.organizador.logo) : null }, equipos, patrocinadores, semabelLogo }
}

/** Parejas de patrocinadores para la banda (dos a la vez). Una pareja incompleta se completa con `relleno` (la promoción de Semabel). */
export function parejasDePatrocinio(patrocinadores, relleno) {
  const parejas = []
  for (let i = 0; i < patrocinadores.length; i += 2) parejas.push([patrocinadores[i], patrocinadores[i + 1] ?? relleno])
  return parejas
}

/**
 * Diapositivas de la BANDA en vivo (REPORT_196), de dos tarjetas cada una y cada una ≈ 12 s:
 *   1. Los patrocinadores en su orden, de dos en dos (ninguno se pierde ni se repite).
 *   2. Si el número es impar, el último patrocinador se acompaña con `espectador` (la tarjeta de Semabel para quien mira).
 *   3. SIEMPRE una diapositiva dedicada de Semabel, la última: [`organizador`, `espectador`]; con 0 patrocinadores es la única.
 * Con un número impar, `espectador` aparece dos veces por ciclo: es lo mínimo posible sin repetir un patrocinador ni dejar una tarjeta sola.
 */
export function diapositivasDeBanda(patrocinadores, organizador, espectador) {
  const pares = []
  for (let i = 0; i < patrocinadores.length; i += 2) pares.push([patrocinadores[i], patrocinadores[i + 1] ?? espectador])
  return [...pares, [organizador, espectador]]
}

// Lectura única del manifiesto por carga de la página (no se vuelve a pedir). Un fallo cuenta como «sin medios».
let promesa = null
export function leerMedios(pedir = pedirJson) {
  promesa ??= pedir(rutaMedios()).then((r) => (r.tipo === 'ok' ? r.cuerpo : null)).catch(() => null)
  return promesa
}
export const olvidarMedios = () => { promesa = null }
