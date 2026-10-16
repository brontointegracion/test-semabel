// ---------------------------------------------------------------------------
// Categoría y subcategoría de una liga, sin base de datos ni pantallas.
//
// La categoría guarda una CLAVE estable (la etiqueta es solo presentación y
// cambia por idioma). Las ligas de antes guardan el texto que se veía
// ('Libre', '40+'…): esos valores no se tocan, se muestran tal cual y siguen
// comparándose por igualdad. Aquí solo hay catálogo de baloncesto porque es el
// único deporte con categorías nuevas; el fútbol sala conserva su lista.
//
// Esto es CLASIFICACIÓN, nada más. No define edades, ni reglas de elegibilidad,
// ni duraciones, ni nada que el marcador lea: ningún dato de aquí entra en el
// motor de puntuación ni en la versión de preparación del partido.
//
// No importa nada y usa solo JavaScript estándar: se puede probar en Node y sirve
// igual en un servidor (por eso quien lo importe fuera de Vite debe escribir la
// extensión .js).
// ---------------------------------------------------------------------------

export const IDIOMA_PREDETERMINADO = 'es'
export const SUBCATEGORIA_TEXTO_MIN = 1
export const SUBCATEGORIA_TEXTO_MAX = 30

/** Categorías nuevas del baloncesto. La clave es estable; es/en son solo etiquetas. */
export const CATEGORIAS_BALONCESTO = Object.freeze([
  { clave: 'baby', es: 'Baby baloncesto', en: 'Baby', presets: [] },
  {
    clave: 'mini-basketball',
    es: 'Mini baloncesto',
    en: 'Mini Basketball',
    presets: [{ clave: 'u10', es: 'U10', en: 'U10' }],
  },
  {
    clave: 'intermediate',
    es: 'Intermedia',
    en: 'Intermediate',
    presets: [{ clave: 'u12', es: 'U12', en: 'U12' }],
  },
  { clave: 'adult', es: 'Adulto', en: 'Adult', presets: [] },
  { clave: 'veterans', es: 'Veteranos', en: 'Veterans', presets: [] },
])

/** Lista de siempre (fútbol sala y ligas anteriores): valor guardado y texto de la opción. */
export const CATEGORIAS_LEGADO = Object.freeze([
  { valor: 'Libre', etiqueta: 'Libre (cualquier edad)' },
  { valor: '35+', etiqueta: 'Veteranos 35+' },
  { valor: '40+', etiqueta: 'Veteranos 40+' },
  { valor: '45+', etiqueta: 'Veteranos 45+' },
  { valor: '50+', etiqueta: 'Veteranos 50+' },
])

const idiomaDe = (idioma) => (idioma === 'en' ? 'en' : IDIOMA_PREDETERMINADO)

export const categoriaDeBaloncesto = (clave) =>
  (typeof clave === 'string' ? CATEGORIAS_BALONCESTO.find((c) => c.clave === clave) : undefined) ?? null

const PRESETS = CATEGORIAS_BALONCESTO.flatMap((c) => c.presets)
const presetPorClave = (clave) => (typeof clave === 'string' ? PRESETS.find((p) => p.clave === clave) : undefined) ?? null

const esObjetoPlano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// --- Etiquetas --------------------------------------------------------------

/** Etiqueta de una categoría guardada. Un valor que no es una clave conocida se muestra tal cual (ligas de antes). */
export function etiquetaCategoria(valor, idioma) {
  const c = categoriaDeBaloncesto(valor)
  if (c) return c[idiomaDe(idioma)]
  return valor === undefined || valor === null ? '' : String(valor)
}

/** Etiqueta de una subcategoría guardada, o null si no hay o no tiene una forma reconocible. */
export function etiquetaSubcategoria(sub, idioma) {
  if (!esObjetoPlano(sub)) return null
  const claves = Object.keys(sub)
  if (claves.length !== 1) return null
  if (claves[0] === 'clave') return presetPorClave(sub.clave)?.[idiomaDe(idioma)] ?? null
  if (claves[0] === 'texto') return typeof sub.texto === 'string' && sub.texto.trim() !== '' ? sub.texto : null
  return null
}

/** Opciones del selector de categoría para un deporte: { valor, etiqueta }. */
export function opcionesDeCategoria(deporte, idioma) {
  if (deporte === 'baloncesto') {
    return CATEGORIAS_BALONCESTO.map((c) => ({ valor: c.clave, etiqueta: c[idiomaDe(idioma)] }))
  }
  return CATEGORIAS_LEGADO.map((c) => ({ ...c }))
}

/** Presets de una categoría de baloncesto: { clave, etiqueta }. Vacío si no tiene. */
export function presetsDeCategoria(categoria, idioma) {
  return (categoriaDeBaloncesto(categoria)?.presets ?? []).map((p) => ({ clave: p.clave, etiqueta: p[idiomaDe(idioma)] }))
}

// --- Texto personalizado ----------------------------------------------------

// Caracteres de control, de formato (invisibles) y saltos de línea o párrafo. Se
// rechazan sobre el texto CRUDO: normalizar espacios antes podría esconderlos.
const PROHIBIDOS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const LETRA_O_DIGITO = /[\p{L}\p{N}]/u

/**
 * Normaliza el texto de una subcategoría personalizada: NFC, recorte y espacios
 * internos colapsados. Conserva mayúsculas, acentos y puntuación. No produce
 * ninguna clave ni "slug". → { ok: true, texto } | { ok: false, error }
 */
export function normalizarTextoSubcategoria(crudo) {
  if (typeof crudo !== 'string') return { ok: false, error: 'La subcategoría debe ser texto.' }
  if (PROHIBIDOS.test(crudo)) return { ok: false, error: 'La subcategoría no puede tener caracteres de control ni saltos de línea.' }
  const texto = crudo.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const largo = [...texto].length
  if (largo < SUBCATEGORIA_TEXTO_MIN || largo > SUBCATEGORIA_TEXTO_MAX) {
    return { ok: false, error: `La subcategoría debe tener entre ${SUBCATEGORIA_TEXTO_MIN} y ${SUBCATEGORIA_TEXTO_MAX} caracteres.` }
  }
  if (!LETRA_O_DIGITO.test(texto)) return { ok: false, error: 'La subcategoría debe tener al menos una letra o un número.' }
  return { ok: true, texto }
}

/**
 * ¿El texto escrito coincide con una opción predefinida de esa categoría? Solo es una sugerencia para
 * la pantalla: NUNCA convierte el texto en preset. → clave del preset o null
 */
export function sugerenciaPreset(categoria, crudo) {
  const r = normalizarTextoSubcategoria(crudo)
  if (!r.ok) return null
  const buscado = r.texto.toLocaleLowerCase('und')
  const p = (categoriaDeBaloncesto(categoria)?.presets ?? []).find(
    (x) => x.es.toLocaleLowerCase('und') === buscado || x.en.toLocaleLowerCase('und') === buscado,
  )
  return p ? p.clave : null
}

// --- Clasificación de una liga nueva ----------------------------------------

/**
 * Valida y normaliza lo que se va a guardar en una liga NUEVA.
 *   Baloncesto: una de las cinco categorías y una subcategoría explícita, o un preset de esa categoría
 *               ({ clave }) o un texto ({ texto }); nunca las dos.
 *   Otro deporte: una categoría de la lista de siempre y ninguna subcategoría.
 * → { ok, errores, categoria, subcategoria }  (subcategoria es undefined si no corresponde)
 */
export function resolverClasificacion({ deporte, categoria, subcategoria } = {}) {
  const errores = {}
  let sub

  if (deporte === 'baloncesto') {
    const cat = categoriaDeBaloncesto(categoria)
    if (!cat) {
      errores.categoria = 'Elige una categoría.'
    } else if (subcategoria === undefined) {
      errores.subcategoria = 'Elige una subcategoría o escribe una.'
    } else if (!esObjetoPlano(subcategoria)) {
      errores.subcategoria = 'La subcategoría no es válida.'
    } else {
      const claves = Object.keys(subcategoria)
      if (claves.length !== 1 || (claves[0] !== 'clave' && claves[0] !== 'texto')) {
        errores.subcategoria = 'La subcategoría debe ser una opción o un texto, no las dos.'
      } else if (claves[0] === 'clave') {
        if (cat.presets.some((p) => p.clave === subcategoria.clave)) sub = { clave: subcategoria.clave }
        else errores.subcategoria = 'Esa subcategoría no corresponde a la categoría elegida.'
      } else {
        const r = normalizarTextoSubcategoria(subcategoria.texto)
        if (r.ok) sub = { texto: r.texto }
        else errores.subcategoria = r.error
      }
    }
  } else {
    if (!CATEGORIAS_LEGADO.some((c) => c.valor === categoria)) errores.categoria = 'Elige una categoría.'
    if (subcategoria !== undefined) errores.subcategoria = 'Esta categoría no admite subcategoría.'
  }

  const ok = Object.keys(errores).length === 0
  return { ok, errores, categoria: ok ? categoria : undefined, subcategoria: ok ? sub : undefined }
}

/** Solo los errores: objeto vacío = válido. */
export const validarClasificacion = (entrada) => resolverClasificacion(entrada).errores

// --- Retos ------------------------------------------------------------------

// Clave de un preset válido de ESA liga, o null (personalizada, mal formada, sin subcategoría…).
function presetValidoDe(liga) {
  const cat = categoriaDeBaloncesto(liga?.categoria)
  const sub = liga?.subcategoria
  if (!cat || liga?.deporte !== 'baloncesto' || !esObjetoPlano(sub)) return null
  const claves = Object.keys(sub)
  if (claves.length !== 1 || claves[0] !== 'clave') return null
  return cat.presets.some((p) => p.clave === sub.clave) ? sub.clave : null
}

/**
 * ¿Pueden retarse estas dos ligas? (mismo deporte y categoría, y subcategoría compatible)
 *   - Ligas de antes (sin subcategoría y sin clave nueva): como siempre, igualdad de deporte y categoría.
 *   - Baloncesto nuevo: solo si las dos tienen el MISMO preset válido. Un texto personalizado, un valor mal
 *     formado o la ausencia de subcategoría no se emparejan con nada: normalizar un texto no demuestra que
 *     dos organizadores hablen de las mismas reglas de edad.
 */
export function esRivalCompatible(a, b) {
  if (!esObjetoPlano(a) || !esObjetoPlano(b)) return false
  if (a.deporte !== b.deporte || a.categoria !== b.categoria) return false
  if (categoriaDeBaloncesto(a.categoria)) {
    const pa = presetValidoDe(a)
    return pa !== null && pa === presetValidoDe(b)
  }
  return a.subcategoria === undefined && b.subcategoria === undefined
}

/** Texto estable de la subcategoría para usarlo como dependencia de una consulta (un objeto cambiaría de identidad). */
export function huellaSubcategoria(sub) {
  if (sub === undefined) return ''
  if (!esObjetoPlano(sub)) return '?'
  try { return JSON.stringify(sub) } catch { return '?' }
}

/** Copia de la subcategoría de una liga para guardarla en un reto nuevo: solo un preset válido; si no, undefined. */
export function copiaSubcategoriaParaReto(liga) {
  const clave = presetValidoDe(liga)
  return clave === null ? undefined : { clave }
}
