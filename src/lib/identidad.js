// ---------------------------------------------------------------------------
// La identidad del jugador: nombre completo compuesto desde nombrePila/
// apellido —para que todo lo que ya lee jugador.nombre siga funcionando sin
// tocarlo— y el mejor esfuerzo para partir un nombre existente en sus partes.
//
// No hay forma confiable de partir un nombre latinoamericano en pila y
// apellido(s): "Sam Robles" puede ser un apellido compuesto o dos nombres, y
// nada en el string lo distingue. Por eso partirNombre() es solo un relleno
// editable para el organizador, nunca un dato de identidad autoritativo —
// ver docs/roster/ROSTER_MVP_SPEC.md §8, ROSTER_MVP_PLAN.md pregunta 3, y
// docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md, Decisión 19 (apellido1/apellido2).
// ---------------------------------------------------------------------------

/**
 * Compone el nombre completo tal como lo espera todo el código existente.
 *
 * jugador.nombre es hoy un campo derivado/compatibilidad, no autoritativo —
 * ver docs/roster/ROSTER_MVP_STAGE3_DECISIONS.md, Decisión 114. Cada vez que
 * Stage 3B cambia nombrePila/apellido1/apellido2, debe recomponer jugador.nombre
 * llamando esta función con los tres campos.
 */
export function nombreCompleto(nombrePila, apellido1, apellido2) {
  return [nombrePila, apellido1, apellido2].filter(Boolean).join(' ').trim()
}

/**
 * Mejor esfuerzo, no autoritativo: todo antes del último espacio es la
 * "pila", el último token es el apellido1. apellido2 queda vacío — partir un
 * nombre existente en tres no es más confiable que partirlo en dos. Defensivo
 * ante nombre vacío, null/undefined, espacios raros y nombres de una sola
 * palabra.
 */
export function partirNombre(nombre) {
  const partes = (nombre || '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return { nombrePila: '', apellido1: '', apellido2: '' }
  if (partes.length === 1) return { nombrePila: partes[0], apellido1: '', apellido2: '' }
  const apellido1 = partes.pop()
  return { nombrePila: partes.join(' '), apellido1, apellido2: '' }
}

/** Ausente se trata como activo: así se comportan todas las fichas de antes de que este campo existiera. */
export const activoDe = (jugador) => jugador?.activo !== false
