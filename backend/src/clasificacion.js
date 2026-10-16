import { AutorizacionPerdida, FalloSinEscritura, ResultadoIncierto } from './adaptador-liga.js'
import { RESULTADO_DESCONOCIDO, aRespuesta, falloSinEscritura } from './respuestas.js'

// ---------------------------------------------------------------------------
// Qué respuesta merece una EXCEPCIÓN al ejecutar un comando. Se decide con la evidencia que dejó la ejecución
// (su `traza`) y con errores TIPADOS del adaptador; nunca por el texto de un error ni por ser "un error SQL".
//
//   1. AutorizacionPerdida                      → 401 genérico (nada se leyó ni se escribió).
//   2. La ejecución ya confirmó el comando      → se responde lo CONFIRMADO (aceptado/rechazado/bloqueado);
//      y algo falló después (no la publicación,   un fallo posterior a la confirmación no es un fallo del
//      que ya no lanza)                           comando.
//   3. FalloSinEscritura                        → 500 fallo-sin-escritura (reversión verificada o fallo antes de escribir).
//   4. Sin ninguna escritura iniciada por esta  → 500/503 fallo-sin-escritura (solo se leyó; incluye la
//      ejecución (traza.fase = 'lectura')         contención agotada: cada conflicto salió sin escribir).
//   5. ResultadoIncierto, o cualquier otra cosa → 503 resultado-desconocido (no se puede probar el desenlace).
// ---------------------------------------------------------------------------

export function clasificarFallo(error, traza) {
  if (error instanceof AutorizacionPerdida) return aRespuesta({ tipo: 'no-autorizado' })

  if (traza?.confirmado) {
    const c = traza.confirmado
    if (c.tipo === 'aceptado') return aRespuesta({ tipo: 'aceptado', recibo: c.recibo, publicacion: 'pendiente' })
    if (c.tipo === 'rechazado') return aRespuesta({ tipo: 'rechazado', recibo: c.recibo })
    return aRespuesta({ tipo: 'bloqueado' })
  }

  if (error instanceof FalloSinEscritura) return falloSinEscritura(error.motivo === 'no-escribio' ? 'interno' : error.motivo)
  if (error instanceof ResultadoIncierto) return RESULTADO_DESCONOCIDO

  if (traza?.fase === 'lectura') {
    return falloSinEscritura(error?.message === 'contencion-excesiva' ? 'contencion' : 'interno')
  }
  return RESULTADO_DESCONOCIDO
}
