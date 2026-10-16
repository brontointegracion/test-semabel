// ---------------------------------------------------------------------------
// Admisión de ligas para esta etapa del piloto: una lista EXPLÍCITA en la configuración.
//
//   LIGAS_ADMITIDAS = "ID1,ID2,…"
//
//   - Cada ID es exactamente [A-Za-z0-9_-]{1,64}, sin espacios, y se compara por IGUALDAD EXACTA (con mayúsculas):
//     nada de prefijos, subcadenas ni nombres para mostrar.
//   - Ausente, vacía o MAL FORMADA (cualquier elemento inválido, una coma de más, más de 100 IDs, un valor que no
//     es texto) → la lista entera se descarta y NO se admite ninguna liga (falla cerrada). No se admite "lo válido".
//   - Admitir una liga solo permite ENRUTAR hacia su Durable Object. No autoriza a nadie ni prueba que la liga
//     tenga datos: la autorización del partido y del dispositivo sigue siendo la de siempre.
//   - La lista sale solo de la configuración: no hay forma de añadir ligas en ejecución, y nada la copia a una
//     respuesta.
// ---------------------------------------------------------------------------

const ID_LIGA = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_LIGAS_ADMITIDAS = 100

/** → Set de IDs, o null si la configuración falta o no es válida (todo queda cerrado). */
export function ligasAdmitidas(env) {
  const crudo = env?.LIGAS_ADMITIDAS
  if (typeof crudo !== 'string' || crudo.length === 0 || crudo.length > MAX_LIGAS_ADMITIDAS * 65) return null
  const ids = crudo.split(',')
  if (ids.length > MAX_LIGAS_ADMITIDAS || !ids.every((id) => ID_LIGA.test(id))) return null
  return new Set(ids)
}

export function ligaAdmitida(env, ligaId) {
  const admitidas = ligasAdmitidas(env)
  return admitidas !== null && typeof ligaId === 'string' && admitidas.has(ligaId)
}
