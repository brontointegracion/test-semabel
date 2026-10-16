// ---------------------------------------------------------------------------
// Clave PÚBLICA de un equipo dentro de su liga:  /liga/PLATINIUM-U10/equipo/DEPORTIVO
//
// Es el id interno SIN el prefijo de la liga («PLATINIUM-U10-DEPORTIVO» → «DEPORTIVO»); si el id no empieza por ese prefijo la
// clave es el id completo. Los ids internos NO cambian. Un enlace con el id completo sigue funcionando (compatibilidad).
// Se resuelve siempre contra la lista REAL de equipos de la liga admitida, y una clave desconocida o ambigua falla de forma clara:
// nunca se adivina ni se elige "el primero". Funciones puras.
// ---------------------------------------------------------------------------

/** Clave pública de un equipo. Con `todosLosIds` (los ids de la liga) se comprueba que no choque: si choca, se usa el id completo. */
export function claveEquipo(ligaId, equipoId, todosLosIds = null) {
  const prefijo = `${ligaId}-`
  const clave = equipoId.startsWith(prefijo) && equipoId.length > prefijo.length ? equipoId.slice(prefijo.length) : equipoId
  if (clave === equipoId || !Array.isArray(todosLosIds)) return clave
  const choca = todosLosIds.some((otro) => otro !== equipoId && (otro === clave || claveEquipo(ligaId, otro) === clave))
  return choca ? equipoId : clave
}

/**
 * → { ok: true, equipoId } | { ok: false, motivo: 'desconocido' | 'ambiguo' }.
 * Orden: (1) el id completo de un equipo de la liga; (2) la clave exacta; (3) la clave sin distinguir mayúsculas.
 * Si en un paso coinciden varios equipos distintos → ambiguo (no se pasa al siguiente paso).
 */
export function resolverEquipo(ligaId, equipos, parametro) {
  if (typeof parametro !== 'string' || parametro === '' || !Array.isArray(equipos)) return { ok: false, motivo: 'desconocido' }
  const ids = equipos.map((e) => e.id)
  const completo = ids.filter((id) => id === parametro)
  if (completo.length === 1) return { ok: true, equipoId: completo[0] }
  const pasos = [
    ids.filter((id) => claveEquipo(ligaId, id) === parametro),
    ids.filter((id) => claveEquipo(ligaId, id).toLowerCase() === parametro.toLowerCase()),
  ]
  for (const coinciden of pasos) {
    if (coinciden.length === 1) return { ok: true, equipoId: coinciden[0] }
    if (coinciden.length > 1) return { ok: false, motivo: 'ambiguo' }
  }
  return { ok: false, motivo: 'desconocido' }
}

/** Claves repetidas dentro de una liga (para validar la lista de equipos): [] si todas son únicas. */
export function clavesRepetidas(ligaId, equipos) {
  const vistas = new Map()
  for (const e of equipos) {
    const k = claveEquipo(ligaId, e.id)
    vistas.set(k, (vistas.get(k) ?? 0) + 1)
  }
  return [...vistas].filter(([, n]) => n > 1).map(([k]) => k)
}
