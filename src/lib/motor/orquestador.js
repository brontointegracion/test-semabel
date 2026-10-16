import { verificarAdaptador } from './contrato-adaptador'
import { procesar } from './procesador'
import { validarSobre } from './sobre'

// ---------------------------------------------------------------------------
// Ejecuta una orden contra un adaptador. Es la secuencia que todos los
// adaptadores comparten; lo que cambia es cómo guardan.
//
//   autorizar y leer dentro de la frontera protegida → decidir (pura) →
//   confirmar de forma atómica → publicar DESPUÉS de confirmar.
//
// La credencial llega por el contexto de confianza del transporte (`credencial`),
// nunca dentro del sobre. El adaptador devuelve la identidad AUTENTICADA (partido,
// dispositivo, actor, versión); si no coincide con la del sobre, no se hace nada y
// no se revela ningún recibo. Los recibos usan la identidad autenticada.
//
// Si otra cosa cambió entre leer y confirmar (cursor, bloqueo, autorización o, para el inicio
// del partido, la versión del contexto de preparación),
// la confirmación lo detecta y se vuelve a leer y decidir desde cero.
// Una excepción al confirmar se propaga: no queda nada escrito ni publicado.
// ---------------------------------------------------------------------------

const MAX_INTENTOS = 3

const mensajeDe = (sobre, decision) => ({
  gameId: sobre.gameId,
  rev: decision.recibo.revDespues,
  cmdId: sobre.cmdId,
  partido: decision.estadoDespues.partido,
  corridaSeq: decision.estadoDespues.corridaSeq,
  advertencias: decision.recibo.advertencias,
})

const noAutorizado = (motivo) => ({ tipo: 'no-autorizado', motivo, publicacion: 'no-aplica' })

export async function ejecutar(adaptador, sobreCrudo, { recibidoEn, credencial, maxIntentos = MAX_INTENTOS } = {}) {
  verificarAdaptador(adaptador)
  if (!Number.isSafeInteger(recibidoEn)) throw new Error('ejecutar necesita recibidoEn')
  if (typeof credencial !== 'string' || credencial.length === 0) return noAutorizado('credencial-ausente')

  const previo = validarSobre(sobreCrudo)
  if (!previo.ok) return { tipo: 'invalido', errores: previo.errores }
  const sobre = previo.sobre

  for (let intento = 0; intento < maxIntentos; intento += 1) {
    const salida = await adaptador.transaccion(sobre.gameId, async (tx) => {
      const aut = await tx.autorizar({ gameId: sobre.gameId, credencial })
      if (!aut?.autorizado) return { final: { tipo: 'no-autorizado', motivo: aut?.motivo ?? 'no-autorizado' } }
      // Defensa en profundidad: el adaptador debe devolver SU identidad; si no es la del sobre, se rechaza.
      if (typeof aut.gameId !== 'string' || aut.gameId !== sobre.gameId) {
        return { final: { tipo: 'no-autorizado', motivo: 'juego-distinto' } }
      }
      if (typeof aut.deviceId !== 'string' || aut.deviceId !== sobre.deviceId) {
        return { final: { tipo: 'no-autorizado', motivo: 'dispositivo-distinto' } }
      }
      if (aut.version === undefined) return { final: { tipo: 'no-autorizado', motivo: 'autorizacion-invalida' } }

      const vista = await tx.leerVista(sobre)
      const decision = procesar(vista, sobre, {
        recibidoEn, actorId: aut.actorId ?? null, gameId: aut.gameId, deviceId: aut.deviceId,
      })
      const esperado = {
        rev: vista.estado.rev,
        ultimoClientSeq: vista.ultimoClientSeq,
        versionBloqueo: vista.versionBloqueo,
        versionAutorizacion: aut.version,
        // Solo el inicio del partido depende del contexto de preparación: las demás órdenes no
        // chocan por un cambio de plantilla. null si no hay un contexto con versión.
        ...(sobre.tipo === 'iniciar-partido'
          ? { versionPreparacion: typeof vista.preparacion?.version === 'string' ? vista.preparacion.version : null }
          : {}),
      }

      if (decision.tipo === 'aceptado') {
        const r = await tx.confirmar({
          esperado,
          recibo: decision.recibo,
          efectos: decision.efectos,
          estadoDespues: decision.estadoDespues,
          mensaje: mensajeDe(sobre, decision),
        })
        if (r.conflicto) return { reintentar: true }
        return { final: { tipo: 'aceptado', recibo: decision.recibo }, publicar: true }
      }
      if (decision.tipo === 'rechazado') {
        const r = await tx.confirmar({
          esperado, recibo: decision.recibo, efectos: null, estadoDespues: null, mensaje: null,
        })
        if (r.conflicto) return { reintentar: true }
        return { final: decision }
      }
      if (decision.tipo === 'bloqueado') {
        const r = await tx.registrarCuarentena({ esperado, sobre, recibidoEn })
        if (r.conflicto) return { reintentar: true }
        return { final: decision }
      }
      if (decision.tipo === 'no-autorizado') return { final: decision }
      return { final: decision }
    })

    if (salida.reintentar) continue

    let publicacion = 'no-aplica'
    if (salida.publicar) {
      try {
        await adaptador.publicarPendientes(sobre.gameId)
        publicacion = 'entregada'
      } catch {
        // Ya está confirmado: no se vuelve a aplicar. El mensaje sigue pendiente.
        publicacion = 'pendiente'
      }
    }
    return { ...salida.final, publicacion }
  }
  throw new Error('contencion-excesiva')
}
