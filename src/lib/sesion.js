import { db } from '../db'

// ---------------------------------------------------------------------------
// Quién está mirando.
//
// Invitado: la portada, las ligas, el detalle de un partido, los jugadores y
// las noticias. Todo eso es público y no pide cuenta.
//
// Organizador: además, sus ligas, crear una nueva, el saldo y la consola para
// llevar el marcador — y solo de las ligas que son suyas.
//
// En el prototipo se entra con un botón. En el producto, aquí va la sesión de
// verdad; lo que no cambia es dónde se pregunta por el permiso.
// ---------------------------------------------------------------------------

export async function asegurarSesion() {
  const actual = await db.meta.get('sesion')
  if (actual) return actual
  const invitado = { id: 'sesion', rol: 'invitado', cuentaId: null }
  await db.meta.put(invitado)
  return invitado
}

export async function entrar() {
  await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
}

export async function salir() {
  await db.meta.put({ id: 'sesion', rol: 'invitado', cuentaId: null })
}

export const esOrganizador = (sesion) => sesion?.rol === 'organizador'

/** Solo el dueño de la liga puede tocarla. */
export const esDuenoDe = (sesion, liga) =>
  esOrganizador(sesion) && !!liga && liga.organizadorId === sesion.cuentaId
