import { aplicarEfectos, construirSobre, decidirOrden } from './reglas'
import { validarSobre } from './sobre'

// ---------------------------------------------------------------------------
// La cola de órdenes del teléfono, como valores puros (sin almacenamiento).
//
// Reglas:
//  - Una orden se valida primero en local con las mismas reglas del servidor.
//    Si falla, es un RECHAZO LOCAL: no se asigna clientSeq, no se guarda nada
//    y la cola queda exactamente igual.
//  - Solo una orden aceptada en local recibe clientSeq. En la fase durable
//    posterior, asignar el número, guardar el sobre inmutable y actualizar el
//    estado provisional serán UNA transacción local; aquí `encolar` devuelve
//    los tres valores nuevos juntos para que quien persista los guarde juntos.
//  - El sobre guardado no se vuelve a generar: cada reintento reenvía el mismo.
//  - Se envía de a una. Un rechazo definitivo del servidor consume su número,
//    detiene la cola y marca lo que quedaba como 'no-aplicada'. Nada se
//    reintenta ni se reetiqueta solo; esos registros se conservan como historia.
//  - Reanudar reinicia la numeración desde lo último que el servidor procesó.
//
// entrada.estado: 'pendiente' | 'enviando' | 'confirmada' | 'rechazada' | 'no-aplicada'
// ---------------------------------------------------------------------------

export function crearCola({ gameId, deviceId, ultimoClientSeqServidor = 0, revServidor = 0 }) {
  return {
    gameId,
    deviceId,
    base: { ultimoClientSeq: ultimoClientSeqServidor, rev: revServidor },
    siguienteSeq: ultimoClientSeqServidor + 1,
    entradas: [],
    detenida: null,
  }
}

const vivas = (cola) => cola.entradas.filter((e) => e.estado === 'pendiente' || e.estado === 'enviando')

/**
 * Intenta encolar una orden sobre el estado provisional.
 *   ctx = { ahoraEstimado, actorId }
 * Devuelve uno de:
 *   { rechazoLocal: { motivo, errores? }, cola, estado }       (nada cambia)
 *   { duplicada: true, sobre, cola, estado }                    (ya existe ese cmdId: no se asigna otro número)
 *   { cola, estado, sobre, advertencias }                       (aceptada en local)
 */
export function encolar(cola, estadoProvisional, orden, ctx) {
  if (cola.detenida) {
    return { rechazoLocal: { motivo: 'cola-detenida' }, cola, estado: estadoProvisional }
  }
  const existente = cola.entradas.find((e) => e.sobre.cmdId === orden.cmdId)
  if (existente) return { duplicada: true, sobre: existente.sobre, cola, estado: estadoProvisional }

  const crudo = construirSobre(estadoProvisional, orden, { deviceId: cola.deviceId, clientSeq: cola.siguienteSeq })
  const v = validarSobre(crudo)
  if (!v.ok) {
    return { rechazoLocal: { motivo: 'sobre-invalido', errores: v.errores }, cola, estado: estadoProvisional }
  }
  const d = decidirOrden(estadoProvisional, v.sobre, { recibidoEn: ctx.ahoraEstimado, actorId: ctx.actorId })
  if (!d.ok) return { rechazoLocal: { motivo: d.motivo }, cola, estado: estadoProvisional }

  const entrada = { sobre: v.sobre, estado: 'pendiente', recibo: null, motivoNoAplicada: null }
  return {
    cola: { ...cola, siguienteSeq: cola.siguienteSeq + 1, entradas: [...cola.entradas, entrada] },
    estado: aplicarEfectos(estadoProvisional, d.efectos),
    sobre: v.sobre,
    advertencias: d.advertencias,
  }
}

/** Lo siguiente que hay que enviar (el mismo sobre si ya estaba en vuelo), o null. */
export function proximoEnvio(cola) {
  if (cola.detenida) return null
  return vivas(cola)[0]?.sobre ?? null
}

export function marcarEnviando(cola, cmdId) {
  const primera = vivas(cola)[0]
  if (!primera || primera.sobre.cmdId !== cmdId) return cola
  return {
    ...cola,
    entradas: cola.entradas.map((e) => (e === primera ? { ...e, estado: 'enviando' } : e)),
  }
}

function marcarNoAplicadas(entradas, motivo, desdeCmdId) {
  let desde = false
  return entradas.map((e) => {
    if (e.sobre.cmdId === desdeCmdId) desde = true
    return desde && (e.estado === 'pendiente' || e.estado === 'enviando')
      ? { ...e, estado: 'no-aplicada', motivoNoAplicada: motivo }
      : e
  })
}

/**
 * Registra lo que respondió el servidor a un envío.
 *   resultado = lo que devuelve `ejecutar` ({ tipo, recibo? , esperado? ...}).
 */
export function alRecibir(cola, cmdId, resultado) {
  const recibo = resultado.recibo
  const esAceptado = (resultado.tipo === 'aceptado' || resultado.tipo === 'recibo-existente')
    && recibo?.resultado === 'aceptado'
  const esRechazo = (resultado.tipo === 'rechazado' || resultado.tipo === 'recibo-existente')
    && recibo?.resultado === 'rechazado'

  if (esAceptado) {
    return {
      ...cola,
      base: { ultimoClientSeq: recibo.clientSeq, rev: recibo.revDespues },
      entradas: cola.entradas.map((e) => (e.sobre.cmdId === cmdId ? { ...e, estado: 'confirmada', recibo } : e)),
    }
  }

  if (esRechazo) {
    const entradas = cola.entradas.map((e) => (e.sobre.cmdId === cmdId ? { ...e, estado: 'rechazada', recibo } : e))
    return {
      ...cola,
      base: { ultimoClientSeq: recibo.clientSeq, rev: cola.base.rev },
      entradas: marcarNoAplicadas(entradas, 'dependiente-de-rechazo', cmdId),
      detenida: { causa: 'rechazo-definitivo', cmdId, motivo: recibo.motivo },
    }
  }

  if (resultado.tipo === 'bloqueado') {
    return {
      ...cola,
      entradas: marcarNoAplicadas(cola.entradas, 'juego-bloqueado', cmdId),
      detenida: { causa: 'bloqueado', cmdId },
    }
  }

  // hueco, secuencia ocupada, conflicto de contenido, no autorizado, inválido:
  // la cola se detiene sin tocar nada; el caso es excepcional.
  return { ...cola, detenida: { causa: resultado.tipo, cmdId } }
}

/**
 * Reanuda tras un rechazo definitivo. `servidor` es lo último que procesó el
 * servidor: { ultimoClientSeq, rev }. Quien llama reemplaza el estado
 * provisional por el autoritativo. Lo no aplicado queda como historia.
 */
export function reanudar(cola, servidor) {
  if (!cola.detenida || cola.detenida.causa !== 'rechazo-definitivo') {
    return { ok: false, motivo: 'no-reanudable' }
  }
  if (cola.entradas.some((e) => e.estado === 'enviando')) return { ok: false, motivo: 'entrada-en-vuelo' }
  return {
    ok: true,
    cola: {
      ...cola,
      base: { ultimoClientSeq: servidor.ultimoClientSeq, rev: servidor.rev },
      siguienteSeq: servidor.ultimoClientSeq + 1,
      detenida: null,
      entradas: cola.entradas.map((e) => (e.estado === 'pendiente'
        ? { ...e, estado: 'no-aplicada', motivoNoAplicada: e.motivoNoAplicada ?? 'dependiente-de-rechazo' }
        : e)),
    },
  }
}

/**
 * Reconstruye el estado provisional tras recargar: la base autoritativa más
 * las órdenes vivas, en orden, con las mismas reglas.
 */
export function reconstruirProvisional(estadoBase, cola, ctx) {
  let estado = estadoBase
  for (const entrada of vivas(cola)) {
    const d = decidirOrden(estado, entrada.sobre, { recibidoEn: ctx.ahoraEstimado, actorId: ctx.actorId })
    if (!d.ok) return { ok: false, divergencia: { cmdId: entrada.sobre.cmdId, motivo: d.motivo } }
    estado = aplicarEfectos(estado, d.efectos)
  }
  return { ok: true, estado }
}
