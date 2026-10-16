// ---------------------------------------------------------------------------
// Contrato que debe cumplir un adaptador de almacenamiento (Durable Object,
// Dexie, memoria de pruebas…). El motor no lo implementa: lo usa.
//
// adaptador.transaccion(gameId, fn)
//   Ejecuta fn(tx) dentro de la frontera protegida del partido: nadie más
//   decide ni confirma sobre ese partido mientras tanto, o la confirmación
//   detecta el cambio. Si fn lanza una excepción, NADA queda escrito.
//
// tx.autorizar({ gameId, credencial })
//   → { autorizado, motivo?, gameId, deviceId, actorId, version }
//   `credencial` viene del contexto de confianza del transporte (cabecera, token,
//   sesión…); NUNCA de un campo del sobre. El adaptador resuelve a qué partido y a
//   qué dispositivo pertenece, devuelve esa identidad autenticada y una versión
//   para detectar que cambió antes de confirmar. Una credencial de otro partido,
//   desconocida, ausente o revocada devuelve autorizado: false con su motivo.
//   El orquestador rechaza además si el gameId o el deviceId devueltos no son los
//   del sobre, y los recibos usan la identidad devuelta aquí.
//
// tx.leerVista(sobre) → vista (ver procesador.js), más `versionBloqueo`. Solo se llama
//   DESPUÉS de autorizar: ninguna lectura de recibos ocurre antes.
//   vista.estado.atribucion es el contexto de atribución de confianza (atribucion.js).
//   Obligación: si la elegibilidad o los equipos cambian, el adaptador publica una
//   atribución NUEVA (otra versión); las órdenes pendientes que usaron la anterior se
//   rechazan como 'atribucion-desactualizada' y no se reinterpretan.
//   vista.preparacion es el contexto de preparación de confianza (preparacion.js) del partido
//   autenticado, o null si no hay. Lo lee el adaptador DENTRO de su transacción y de forma completa
//   (partido, equipos y plantillas): el motor solo verifica su forma, su huella y que sea de este
//   partido; no puede probar de dónde salió ni que esté completo. Solo decide el inicio del partido.
//
// tx.confirmar({ esperado, recibo, efectos, estadoDespues, mensaje })
//   Compara `esperado` ({ rev, ultimoClientSeq, versionBloqueo,
//   versionAutorizacion }) con lo que hay AHORA. Para el inicio del partido `esperado` trae además
//   `versionPreparacion` (la versión del contexto que se leyó, o null): el adaptador debe compararla,
//   de forma atómica, con la versión de su contexto vigente. Si algo cambió devuelve
//   { conflicto: true } y no escribe nada. Si no, escribe de una sola vez, o
//   no escribe nada: eventos nuevos y cambiados, estado del partido y reloj,
//   filas de auditoría, el recibo (aceptado o rechazado), la revisión, el
//   cursor de clientSeq, el cursor de tiempo de reloj y el mensaje de
//   publicación pendiente (bandeja de salida). Un rechazo definitivo llega con
//   efectos = null: guarda el recibo y avanza el cursor de clientSeq.
//
// tx.registrarCuarentena({ esperado, sobre, recibidoEn })
//   Guarda, aparte del partido, una orden nueva rechazada por un bloqueo.
//   No cambia el partido ni consume clientSeq.
//
// adaptador.publicarPendientes(gameId)
//   Entrega los mensajes que ya quedaron confirmados. Solo se llama DESPUÉS de
//   confirmar. Si falla, el mensaje sigue pendiente; la orden NO se vuelve a
//   aplicar.
// ---------------------------------------------------------------------------

const METODOS = ['transaccion', 'publicarPendientes']

/** Comprobación mínima de forma, útil en pruebas de adaptadores. */
export function verificarAdaptador(adaptador) {
  const faltan = METODOS.filter((m) => typeof adaptador?.[m] !== 'function')
  if (faltan.length) throw new Error(`Adaptador incompleto: falta ${faltan.join(', ')}`)
  return adaptador
}
