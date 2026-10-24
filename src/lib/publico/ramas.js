// ---------------------------------------------------------------------------
// Rama de un EQUIPO (REPORT_220): metadato nullable que publica el servidor ('masculino' | 'femenino' | 'mixta' | null). Nunca se infiere (ni del nombre, ni de la edad,
// ni del número, ni de la categoría de la liga) y no hay valor por omisión: sin valor, o con un valor desconocido, NO se muestra nada. No es la clasificación de la
// competición (categoría/subcategoría de la liga) y no entra en ningún filtro ni en la puntuación.
// ---------------------------------------------------------------------------

export const ETIQUETA_RAMA = Object.freeze({ masculino: 'Masculino', femenino: 'Femenino', mixta: 'Mixta' })

/** Valor del servidor → clave válida o null (cualquier otra cosa se descarta). */
export const ramaPublica = (v) => (typeof v === 'string' && Object.hasOwn(ETIQUETA_RAMA, v) ? v : null)

/** «Mixta» / «Masculino» / «Femenino», o null si no hay una rama válida. */
export const etiquetaRama = (v) => { const r = ramaPublica(v); return r === null ? null : ETIQUETA_RAMA[r] }
