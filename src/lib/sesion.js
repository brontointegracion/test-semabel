import { db } from '../db'
import { modoCompartido } from './modo'

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
  // Modo compartido: nada local concede permisos. Un rol guardado en este navegador (de un uso anterior del prototipo)
  // se reemplaza por invitado; no se borra ninguna otra cosa de la base.
  if (modoCompartido()) {
    const invitado = { id: 'sesion', rol: 'invitado', cuentaId: null }
    await db.meta.put(invitado)
    return invitado
  }
  const actual = await db.meta.get('sesion')
  if (actual) return actual
  const invitado = { id: 'sesion', rol: 'invitado', cuentaId: null }
  await db.meta.put(invitado)
  return invitado
}

export async function entrar() {
  if (modoCompartido()) return // el atajo local no existe en modo compartido
  await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
}

export async function salir() {
  await db.meta.put({ id: 'sesion', rol: 'invitado', cuentaId: null })
}

export const esOrganizador = (sesion) => !modoCompartido() && sesion?.rol === 'organizador'

/** Solo el dueño de la liga puede tocarla. */
export const esDuenoDe = (sesion, liga) =>
  !modoCompartido() && esOrganizador(sesion) && !!liga && liga.organizadorId === sesion.cuentaId
