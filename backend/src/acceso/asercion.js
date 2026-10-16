import { TOLERANCIA_RELOJ_MS, VENTANA_ASERCION_MS } from './config.js'

// ---------------------------------------------------------------------------
// Afirmación de organizador: la que el objeto de acceso entrega al Worker tras validar una sesión y que el Worker
// pasa al objeto de liga. NO es una credencial: solo viaja por el binding interno.
//
// Garantía (y su límite): el punto de decisión es la lectura de validación en el objeto de acceso. Una revocación
// ya confirmada allí antes de esa lectura la niega. Cualquier número de peticiones validadas ANTES de la
// revocación pueden terminar mientras `ahora − validadoEn` esté dentro de la ventana. Pasada la ventana, ninguna.
// No hay atomicidad entre ambos objetos.
//
// La comprobación se hace en el objeto de liga, como PRIMERA sentencia de la transacción sincrónica de la
// mutación, antes de leer o escribir nada.
// ---------------------------------------------------------------------------

export const ASERCION = Object.freeze({ OK: 'ok', VENCIDA: 'vencida', INVALIDA: 'invalida' })

export function evaluarAsercion(asercion, ligaId, ahora) {
  if (!asercion || typeof asercion !== 'object') return ASERCION.INVALIDA
  const { organizadorId, sesionId, ligas, validadoEn } = asercion
  if (typeof organizadorId !== 'string' || typeof sesionId !== 'string' || !Array.isArray(ligas)) return ASERCION.INVALIDA
  if (!Number.isFinite(validadoEn) || !Number.isFinite(ahora)) return ASERCION.INVALIDA
  if (typeof ligaId !== 'string' || !ligas.includes(ligaId)) return ASERCION.INVALIDA
  const edad = ahora - validadoEn
  return edad <= VENTANA_ASERCION_MS && edad >= -TOLERANCIA_RELOJ_MS ? ASERCION.OK : ASERCION.VENCIDA
}
