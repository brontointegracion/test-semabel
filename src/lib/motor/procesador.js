import {
  advertenciasDeRechazo, aplicarEfectos, decidirOrden,
} from './reglas'
import { evaluarPreparacion, preparacionIntegra } from './preparacion'
import { firmaDeReglas } from '../reglas-categoria'
import { contenidoCanonico, validarSobre } from './sobre'
import { VERSION_MOTOR } from './tipos'

// ---------------------------------------------------------------------------
// La tabla de orden y reintento, sin ninguna entrada ni salida.
//
//   ctx = { recibidoEn, actorId, gameId, deviceId }
//     gameId y deviceId son la identidad AUTENTICADA que resolvió el adaptador con la
//     credencial del transporte. Los recibos usan esa identidad, no la del sobre; si no
//     coincide con la del sobre, no se hace nada y no se revela ningún recibo.
//
//   vista = {
//     estado,              Estado autoritativo (con su rev).
//     ultimoClientSeq,     Último clientSeq procesado: aceptado o rechazado.
//     reciboPorCmdId,      Recibo guardado para este cmdId, o null.
//     reciboPorSeq,        Recibo guardado para este clientSeq, o null.
//     bloqueo,             null, o el bloqueo explícito del organizador.
//     preparacion,         Contexto de preparación de confianza (preparacion.js) que el adaptador
//                          leyó tras autorizar, o null/ausente. Solo lo usa el inicio del partido.
//   }
//
// Orden de evaluación (la autorización la resuelve el adaptador antes):
//   1. sobre inválido                         → 'invalido'
//   2. ya hay recibo de ese cmdId             → el mismo recibo, o 'conflicto-contenido'
//   3. el partido está bloqueado              → 'bloqueado' (sin recibo, sin seq)
//   4. clientSeq ya ocupado por otro cmdId    → 'secuencia-ocupada'
//   5. clientSeq salta un número              → 'hueco'
//   6. inicio del partido NUEVO (programado): contexto de preparación íntegro y del partido
//      autenticado → versión capturada presente → igual a la vigente → partido listo.
//      Cualquier fallo es un rechazo definitivo (como 7) con su propio motivo.
//   7. reglas de negocio                      → 'aceptado' o 'rechazado' (consume seq)
//
// El paso 2 va ANTES que el 6: una orden ya aceptada devuelve su recibo original aunque la
// plantilla haya cambiado después. El 6 no se aplica a un partido que ya no está programado
// (ahí sigue mandando 'partido-no-disponible') ni a ninguna otra orden.
//
// Los pasos 1, 3, 4 y 5 no cambian nada ni guardan recibo. Un rechazo
// definitivo (6) sí guarda su recibo y consume el seq, para que un reintento
// devuelva el mismo rechazo y los números sigan siendo contiguos.
// ---------------------------------------------------------------------------

/**
 * Puerta de preparación del inicio del partido. Devuelve null si pasa o { ok: false, motivo, … } con la
 * misma forma que un rechazo de decidirOrden. No lanza. El rechazo nunca nombra otro partido.
 * La coincidencia con el partido es la identidad AUTENTICADA (ctx.gameId); eso no prueba el origen del
 * contexto ni que esté completo (ver las notas de preparacion.js).
 */
function puertaDePreparacion(estado, sobre, ctx, prep) {
  if (sobre.tipo !== 'iniciar-partido' || (estado.partido.estado ?? null) !== 'programado') return null
  const no = (motivo, extra = {}) => ({ ok: false, motivo, ...extra })
  try {
    if (!preparacionIntegra(prep)) return no('preparacion-no-disponible')
    if (prep.gameId !== ctx.gameId) return no('preparacion-juego-distinto')
    if (sobre.preparacionVersion === undefined) return no('preparacion-version-ausente')
    if (sobre.preparacionVersion !== prep.version) {
      return no('preparacion-desactualizada', { versionServidor: prep.version })
    }
    const r = evaluarPreparacion(prep, { gameId: ctx.gameId })
    if (!r.lista) return no(r.motivo, r.detalle ?? {})
    // Las reglas de categoría que la persona confirmó deben ser EXACTAMENTE las que el servidor va a fijar con este inicio.
    // Unas reglas inválidas las rechaza decidirOrden con su diagnóstico.
    const firma = firmaDeReglas(estado.config)
    if (firma !== 'invalidas') {
      if (sobre.reglasConfirmadas === undefined) {
        if (firma !== 'ninguna') return no('reglas-no-confirmadas', { reglasServidor: firma })
      } else if (sobre.reglasConfirmadas !== firma) {
        return no('reglas-desactualizadas', { reglasServidor: firma, reglasConfirmadas: sobre.reglasConfirmadas })
      }
    }
    return null
  } catch {
    return no('preparacion-no-disponible')
  }
}

const ids = (lista) => lista.map((x) => x.id)
const esTexto = (s) => typeof s === 'string' && s.length > 0

function reciboBase(sobre, contenido, ctx) {
  return {
    gameId: ctx.gameId,
    cmdId: sobre.cmdId,
    clientSeq: sobre.clientSeq,
    deviceId: ctx.deviceId,
    contenido,
    accionTs: sobre.accionTs,
    meta: { recibidoEn: ctx.recibidoEn, versionMotor: VERSION_MOTOR },
  }
}

export function procesar(vista, sobreCrudo, ctx) {
  const v = validarSobre(sobreCrudo)
  if (!v.ok) return { tipo: 'invalido', errores: v.errores }
  const sobre = v.sobre
  const { estado } = vista

  if (!esTexto(ctx?.gameId) || !esTexto(ctx?.deviceId)) {
    return { tipo: 'no-autorizado', motivo: 'identidad-ausente' }
  }
  if (sobre.gameId !== ctx.gameId || sobre.gameId !== estado.gameId) {
    return { tipo: 'no-autorizado', motivo: 'juego-distinto' }
  }
  if (sobre.deviceId !== ctx.deviceId) return { tipo: 'no-autorizado', motivo: 'dispositivo-distinto' }

  const contenido = contenidoCanonico(sobre)

  if (vista.reciboPorCmdId) {
    return vista.reciboPorCmdId.contenido === contenido
      ? { tipo: 'recibo-existente', recibo: vista.reciboPorCmdId }
      : { tipo: 'conflicto-contenido', reciboOriginal: vista.reciboPorCmdId }
  }

  if (vista.bloqueo) return { tipo: 'bloqueado', bloqueo: vista.bloqueo }

  if (sobre.clientSeq <= vista.ultimoClientSeq) {
    return { tipo: 'secuencia-ocupada', ocupadaPor: vista.reciboPorSeq?.cmdId ?? null }
  }
  if (sobre.clientSeq > vista.ultimoClientSeq + 1) {
    return { tipo: 'hueco', esperado: vista.ultimoClientSeq + 1 }
  }

  const d = puertaDePreparacion(estado, sobre, ctx, vista.preparacion) ?? decidirOrden(estado, sobre, ctx)
  const base = reciboBase(sobre, contenido, ctx)

  if (!d.ok) {
    const w = advertenciasDeRechazo(estado, sobre, ctx)
    const { ok, motivo, ...detalle } = d
    return {
      tipo: 'rechazado',
      recibo: {
        ...base,
        resultado: 'rechazado',
        motivo,
        detalle,
        revDespues: estado.rev,
        advertencias: w.deterministas,
        refs: { eventosNuevos: [], eventosActualizados: [], auditoria: [] },
        meta: { ...base.meta, advertenciasRecepcion: w.recepcion },
      },
    }
  }

  const estadoDespues = aplicarEfectos(estado, d.efectos)
  return {
    tipo: 'aceptado',
    recibo: {
      ...base,
      resultado: 'aceptado',
      revDespues: estadoDespues.rev,
      advertencias: d.advertencias,
      refs: {
        eventosNuevos: ids(d.efectos.eventosNuevos),
        eventosActualizados: ids(d.efectos.eventosActualizados),
        auditoria: ids(d.efectos.auditoria),
      },
      meta: { ...base.meta, advertenciasRecepcion: d.advertenciasRecepcion },
    },
    efectos: d.efectos,
    estadoDespues,
  }
}
