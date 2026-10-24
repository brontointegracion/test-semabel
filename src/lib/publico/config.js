// ---------------------------------------------------------------------------
// Ligas públicas configuradas EN LA COMPILACIÓN.
//
//   VITE_LIGAS_PUBLICAS="ID1,ID2"   → solo esas ligas se leen. Ausente o vacía → ninguna (el valor por defecto).
//
// No hay directorio de ligas: las pantallas públicas solo conocen las ligas de esta lista. La lista debe ser un SUBCONJUNTO de las ligas que el servidor admite
// (LIGAS_ADMITIDAS): puede ser más corta a propósito (una liga admitida pero no listada no se descubre ni se lee desde la interfaz, aunque su API siga respondiendo),
// pero NUNCA debe llevar una liga que el servidor no admita (daría 404 y avisos de error). Cada ID es exactamente [A-Za-z0-9_-]{1,64}. Una configuración MAL FORMADA
// (un ID inválido, una coma de más, un duplicado, demasiados IDs, un valor que no es texto) se descarta ENTERA: ninguna liga y
// `ok: false`; nunca se usa "lo que sea válido". Aquí no hay ningún ID real: los de las pruebas son sintéticos.
// Se lee en cada llamada para que las pruebas puedan fijar el entorno.
// ---------------------------------------------------------------------------

export const ID_PUBLICO = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_LIGAS_CONFIGURADAS = 12

/** → { ok: true, ids: [...] } | { ok: false, ids: [], error: 'configuracion-invalida' } */
export function interpretarLigas(crudo) {
  const invalida = { ok: false, ids: [], error: 'configuracion-invalida' }
  if (crudo === undefined || crudo === null || crudo === '') return { ok: true, ids: [] }
  if (typeof crudo !== 'string' || crudo.length > MAX_LIGAS_CONFIGURADAS * 65) return invalida
  const ids = crudo.split(',')
  if (ids.length > MAX_LIGAS_CONFIGURADAS || !ids.every((id) => ID_PUBLICO.test(id)) || new Set(ids).size !== ids.length) return invalida
  return { ok: true, ids }
}

export const ligasConfiguradas = () => interpretarLigas(import.meta.env.VITE_LIGAS_PUBLICAS)

// País del piloto: configurado de forma EXPLÍCITA (VITE_PAIS_PILOTO, dos letras mayúsculas) y Panamá por omisión. No hay
// búsqueda por IP ni selector del visitante: es una decisión del despliegue, no del navegador. Se lee en cada llamada.
export const PAIS_PILOTO_PREDETERMINADO = 'PA'
export function paisPiloto() {
  const crudo = import.meta.env.VITE_PAIS_PILOTO
  return typeof crudo === 'string' && /^[A-Z]{2}$/.test(crudo) ? crudo : PAIS_PILOTO_PREDETERMINADO
}
