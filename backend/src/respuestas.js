// Traduce el resultado del orquestador a una respuesta HTTP. Reglas:
//   - Un rechazo DEFINITIVO (recibo guardado) es una respuesta 200 con resultado 'rechazado':
//     el teléfono sigue la política aprobada (releer, confirmar, nuevo cmdId).
//   - Un resultado INCIERTO (excepción, contención excesiva, fallo de almacenamiento) es 503
//     'resultado-desconocido': se reenvía el MISMO sobre con el mismo cmdId.
//   - Todo fallo de autorización es el mismo 401, sin decir la causa.

export const RESULTADO_DESCONOCIDO = Object.freeze({
  status: 503,
  cuerpo: { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' },
})

export function aRespuesta(r) {
  switch (r?.tipo) {
    case 'aceptado':
      return { status: 200, cuerpo: { resultado: 'aceptado', recibo: r.recibo, publicacion: r.publicacion } }
    case 'recibo-existente':
      return { status: 200, cuerpo: { resultado: 'recibo-existente', recibo: r.recibo, publicacion: 'no-aplica' } }
    case 'rechazado':
      return { status: 200, cuerpo: { resultado: 'rechazado', recibo: r.recibo, publicacion: 'no-aplica' } }
    case 'no-autorizado':
      return { status: 401, cuerpo: { error: 'no-autorizado' } }
    case 'invalido':
      return { status: 422, cuerpo: { error: 'sobre-invalido', errores: r.errores } }
    case 'bloqueado':
      return { status: 409, cuerpo: { tipo: 'bloqueado' } }
    case 'secuencia-ocupada':
      return { status: 409, cuerpo: { tipo: 'secuencia-ocupada', ocupadaPor: r.ocupadaPor ?? null } }
    case 'hueco':
      return { status: 409, cuerpo: { tipo: 'hueco', esperado: r.esperado } }
    case 'conflicto-contenido':
      return { status: 409, cuerpo: { tipo: 'conflicto-contenido', reciboOriginal: r.reciboOriginal } }
    default:
      return RESULTADO_DESCONOCIDO
  }
}

// Fallo CONOCIDO: este intento no dejó ninguna escritura (hay evidencia; ver adaptador-liga.js). Es un fallo de
// infraestructura, NO un rechazo del comando: no hay recibo ni se consumió la secuencia. `alcance` deja claro que
// solo habla de ESTE intento: no dice nada de intentos anteriores con el mismo cmdId, que pudieron aceptarse.
// El cliente reenvía el MISMO sobre (mismo cmdId); nunca debe crear un cmdId nuevo por esto.
// `motivo` es una etiqueta fija y pública; nunca texto de un error interno.
export const MOTIVOS_SIN_ESCRITURA = Object.freeze(['interno', 'contencion', 'reversion-verificada', 'asercion-vencida'])

export function falloSinEscritura(motivo) {
  const m = MOTIVOS_SIN_ESCRITURA.includes(motivo) ? motivo : 'interno'
  return {
    status: m === 'contencion' || m === 'asercion-vencida' ? 503 : 500, // condiciones temporales: 503
    cuerpo: { tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo: m, reintento: 'mismo-sobre' },
  }
}
