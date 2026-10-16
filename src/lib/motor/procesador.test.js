import { describe, expect, it } from 'vitest'
import { procesar } from './procesador'
import { construirSobre } from './reglas'
import { estadoDePrueba, T0 } from './prueba/banco'

// La tabla de orden y reintento, sin adaptador: cada fila con un ejemplo.

const D = { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }
const ctx = { recibidoEn: T0, actorId: 'yo', gameId: 'P', deviceId: 'tel-A' }
const vistaDe = (estado, extra = {}) => ({
  estado, ultimoClientSeq: 0, reciboPorCmdId: null, reciboPorSeq: null, bloqueo: null, ...extra,
})
const sobreDe = (estado, cmdId, seq, tipo = 'anotar', datos = D, t = T0) =>
  construirSobre(estado, { cmdId, tipo, datos, tiempo: { accionTs: t } }, { deviceId: 'tel-A', clientSeq: seq })

describe('procesar: filas de la tabla', () => {
  const estado = estadoDePrueba()

  it('1. un sobre inválido no cambia nada y no genera recibo', () => {
    const r = procesar(vistaDe(estado), { cmdId: 'c' }, ctx)
    expect(r.tipo).toBe('invalido')
    expect(r.recibo).toBeUndefined()
  })

  it('1b. un sobre de otro partido es inválido', () => {
    const s = { ...sobreDe(estado, 'c1', 1), gameId: 'OTRO' }
    expect(procesar(vistaDe(estado), s, ctx)).toEqual({ tipo: 'no-autorizado', motivo: 'juego-distinto' })
  })

  it('2. el mismo cmdId con el mismo contenido devuelve el recibo original', () => {
    const s = sobreDe(estado, 'c1', 1)
    const aceptado = procesar(vistaDe(estado), s, ctx)
    expect(aceptado.tipo).toBe('aceptado')
    const reintento = procesar(
      vistaDe(aceptado.estadoDespues, { ultimoClientSeq: 1, reciboPorCmdId: aceptado.recibo }), s, { ...ctx, recibidoEn: T0 + 99999 },
    )
    expect(reintento).toEqual({ tipo: 'recibo-existente', recibo: aceptado.recibo })
  })

  it('2b. el reintento ocurre antes que las comprobaciones de estado: devuelve el recibo aun con el partido final y bloqueado', () => {
    const s = sobreDe(estado, 'c1', 1)
    const aceptado = procesar(vistaDe(estado), s, ctx)
    const final = { ...aceptado.estadoDespues, partido: { ...aceptado.estadoDespues.partido, estado: 'final' } }
    const r = procesar(
      vistaDe(final, { ultimoClientSeq: 5, reciboPorCmdId: aceptado.recibo, bloqueo: { por: 'org' } }), s, ctx,
    )
    expect(r.tipo).toBe('recibo-existente')
  })

  it('3. el mismo cmdId con otro contenido se rechaza y deja intacto el original', () => {
    const s = sobreDe(estado, 'c1', 1)
    const original = procesar(vistaDe(estado), s, ctx).recibo
    const otro = sobreDe(estado, 'c1', 1, 'anotar', { ...D, puntos: 3 })
    const r = procesar(vistaDe(estado, { ultimoClientSeq: 1, reciboPorCmdId: original }), otro, ctx)
    expect(r).toEqual({ tipo: 'conflicto-contenido', reciboOriginal: original })
  })

  it('4. con el partido bloqueado una orden nueva se rechaza sin recibo y sin consumir número', () => {
    const r = procesar(vistaDe(estado, { bloqueo: { por: 'org', motivo: 'bateria' } }), sobreDe(estado, 'c2', 1), ctx)
    expect(r).toEqual({ tipo: 'bloqueado', bloqueo: { por: 'org', motivo: 'bateria' } })
  })

  it('5. un clientSeq ya usado por otro cmdId es secuencia-ocupada', () => {
    const r = procesar(vistaDe(estado, { ultimoClientSeq: 3, reciboPorSeq: { cmdId: 'c-viejo' } }), sobreDe(estado, 'nuevo', 2), ctx)
    expect(r).toEqual({ tipo: 'secuencia-ocupada', ocupadaPor: 'c-viejo' })
  })

  it('6. un salto en clientSeq (hueco o llegada desordenada) no cambia nada y dice cuál se esperaba', () => {
    const r = procesar(vistaDe(estado, { ultimoClientSeq: 7 }), sobreDe(estado, 'c', 9), ctx)
    expect(r).toEqual({ tipo: 'hueco', esperado: 8 })
  })

  it('7a. aceptado: sube la revisión en 1 y lista lo que cambió', () => {
    const r = procesar(vistaDe(estado, { ultimoClientSeq: 7 }), sobreDe(estado, 'c', 8), ctx)
    expect(r.tipo).toBe('aceptado')
    expect(r.recibo).toMatchObject({
      resultado: 'aceptado', clientSeq: 8, revDespues: 1, refs: { eventosNuevos: ['c'], eventosActualizados: [], auditoria: [] },
    })
    expect(r.estadoDespues.rev).toBe(1)
  })

  it('7b. rechazo definitivo: guarda recibo, la revisión no cambia y no hay efectos', () => {
    const r = procesar(vistaDe(estado, { ultimoClientSeq: 7 }), sobreDe(estado, 'c', 8, 'deshacer', {}), ctx)
    expect(r.tipo).toBe('rechazado')
    expect(r.efectos).toBeUndefined()
    expect(r.recibo).toMatchObject({ resultado: 'rechazado', motivo: 'nada', clientSeq: 8, revDespues: 0 })
  })

  it('una parada automática de otra corrida se rechaza como corrida-distinta', () => {
    const corriendo = estadoDePrueba({
      reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: T0 - 5000 },
      extra: { corridaSeq: 4, auditSeq: 4 },
    })
    const s = sobreDe(corriendo, 'auto:P:9', 1, 'parada-automatica', { corridaSeq: 9 })
    const r = procesar(vistaDe(corriendo), s, ctx)
    expect(r.recibo).toMatchObject({ resultado: 'rechazado', motivo: 'corrida-distinta' })
  })

  it('no modifica la vista ni el estado recibidos', () => {
    const e = estadoDePrueba()
    const v = vistaDe(e)
    const antes = structuredClone(v)
    procesar(v, sobreDe(e, 'c', 1), ctx)
    procesar(v, sobreDe(e, 'c2', 1, 'deshacer', {}), ctx)
    expect(v).toEqual(antes)
  })

  it('es determinista: la misma vista, el mismo sobre y el mismo contexto dan el mismo resultado', () => {
    const e = estadoDePrueba()
    const s = sobreDe(e, 'c', 1)
    expect(procesar(vistaDe(e), s, ctx)).toEqual(procesar(vistaDe(structuredClone(e)), structuredClone(s), { ...ctx }))
  })
})
