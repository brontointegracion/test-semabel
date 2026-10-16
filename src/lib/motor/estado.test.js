import { describe, expect, it } from 'vitest'
import { estadoDeFilas } from './estado'
import { ejecutarAutorizado as ejecutar } from './prueba/banco'
import { ordenParadaAutomatica, construirSobre } from './reglas'
import { crearAdaptadorMemoria } from './prueba/adaptador-memoria'
import { T0 } from './prueba/banco'

// Conversión de las filas actuales (solo lectura) al estado del motor.

const liga = { id: 'L', deporte: 'baloncesto' }
const fila = (seq, comando, ts) => ({ id: `a${seq}`, partidoId: 'P', seq, comando, ts: new Date(ts).toISOString() })

describe('estadoDeFilas', () => {
  it('toma el último seq de auditoría, la corrida en curso y el cursor de tiempo de las filas', () => {
    const estadoReloj = (relojEstado, relojRestante, relojDesde) => ({ relojEstado, relojRestante, relojDesde })
    const conEvidencia = (seq, comando, ts, antes, despues) => ({ ...fila(seq, comando, ts), antes, despues })
    const e = estadoDeFilas({
      partido: { id: 'P', estado: 'vivo', relojEstado: 'corriendo', relojRestante: 1000, relojDesde: T0 + 5 },
      liga,
      auditoriaReloj: [
        conEvidencia(1, 'arrancar', T0, estadoReloj('detenido', 1000, null), estadoReloj('corriendo', 1000, T0)),
        conEvidencia(2, 'detener', T0 + 1, estadoReloj('corriendo', 1000, T0), estadoReloj('detenido', 1000, null)),
        fila(3, 'correccion-reloj', T0 + 9_000),
        conEvidencia(4, 'arrancar', T0 + 5, estadoReloj('detenido', 1000, null), estadoReloj('corriendo', 1000, T0 + 5)),
      ],
    })
    expect(e).toMatchObject({ gameId: 'P', auditSeq: 4, corridaSeq: 4, cursorReloj: T0 + 5, rev: 0 })
  })

  it('un reloj corriendo sin registro de arranque tiene una identidad heredada explícita', () => {
    const e = estadoDeFilas({
      partido: { id: 'P', estado: 'vivo', relojEstado: 'corriendo', relojRestante: 0, relojDesde: T0 },
      liga,
    })
    expect(e.corridaSeq).toBe(`legacy:${T0}:0`)
    expect(e.auditSeq).toBe(0)
    expect(e.cursorReloj).toBeNull()
  })

  it('la parada automática de una corrida heredada ocurre una sola vez', async () => {
    const e = estadoDeFilas({
      partido: { id: 'P', estado: 'vivo', relojEstado: 'corriendo', relojRestante: 3000, relojDesde: T0 },
      liga,
    })
    const a = crearAdaptadorMemoria({ estado: e })
    const orden = ordenParadaAutomatica(e, { accionTs: T0 + 3000 })
    expect(orden.cmdId).toBe(`auto:P:legacy:${T0}:0`)
    const sobre = construirSobre(e, orden, { deviceId: 'tel-A', clientSeq: 1 })
    expect((await ejecutar(a, sobre, { recibidoEn: T0 + 3000 })).tipo).toBe('aceptado')
    expect((await ejecutar(a, sobre, { recibidoEn: T0 + 9000 })).tipo).toBe('recibo-existente')
    expect(a.auditoria()).toHaveLength(1)
    expect(a.auditoria()[0]).toMatchObject({ seq: 1, comando: 'parada-automatica', corridaSeq: `legacy:${T0}:0` })
  })

  it('no modifica las filas recibidas y ordena los eventos por seq', () => {
    const eventos = [{ id: 'b', seq: 2, tipo: 'punto' }, { id: 'a', seq: 1, tipo: 'punto' }]
    const copia = structuredClone(eventos)
    const e = estadoDeFilas({ partido: { id: 'P', estado: 'vivo' }, liga, eventos })
    expect(eventos).toEqual(copia)
    expect(e.eventos.map((x) => x.id)).toEqual(['a', 'b'])
    e.eventos[0].tipo = 'otro'
    expect(eventos[1].tipo).toBe('punto')
  })

  it('usa la duración por periodo de la liga si la trae', () => {
    const e = estadoDeFilas({ partido: { id: 'P', estado: 'vivo' }, liga: { ...liga, minutosPorPeriodo: 8 } })
    expect(e.config.minutosPorPeriodo).toBe(8)
  })
})
