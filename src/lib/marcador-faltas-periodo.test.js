import { describe, expect, it } from 'vitest'
import { faltasEquipo, faltasEquipoPeriodo, faltasJugador } from './marcador-calculo'

// REPORT_175: faltas de equipo del periodo visible, derivadas de la lista de eventos (que nunca se recorta). Sintético.
let n
const ev = (tipo, o = {}) => ({ id: `e${n}`, seq: n++, tipo, equipoId: null, jugadorId: null, anulado: false, ...o })
const falta = (equipoId, jugadorId, o) => ev('falta', { equipoId, jugadorId, ...o })
const cambio = (o) => ev('periodo', o)
const cuenta = (eventos, e) => faltasEquipoPeriodo(eventos, e, 'baloncesto')

describe('faltasEquipoPeriodo', () => {
  it('cuenta solo el periodo actual; el total de partido y la historia de cada jugador no cambian', () => {
    n = 1
    const eventos = [falta('A', 'a1'), falta('A', 'a1'), falta('B', 'b1'), cambio(), falta('A', 'a2'), falta('A', 'a1')]
    expect(cuenta(eventos, 'A')).toBe(2)
    expect(cuenta(eventos, 'B')).toBe(0)
    expect(faltasEquipo(eventos, 'A')).toBe(4)
    expect(faltasJugador(eventos, 'a1')).toBe(3) // historia completa del jugador
    expect(eventos).toHaveLength(6) // no se recortó nada
  })

  it('anular una falta de un periodo anterior no toca la cuenta del actual; anular la del actual sí', () => {
    n = 1
    const anterior = falta('A', 'a1')
    const eventos = [anterior, cambio(), falta('A', 'a2')]
    expect(cuenta(eventos, 'A')).toBe(1)
    anterior.anulado = true
    expect(cuenta(eventos, 'A')).toBe(1)
    expect(faltasEquipo(eventos, 'A')).toBe(1)
    eventos[2].anulado = true
    expect(cuenta(eventos, 'A')).toBe(0)
  })

  it('deshacer la transición de periodo devuelve esas faltas al periodo anterior (sin perder ninguna)', () => {
    n = 1
    const eventos = [falta('A', 'a1'), falta('A', 'a1'), cambio(), falta('A', 'a2')]
    expect(cuenta(eventos, 'A')).toBe(1)
    eventos[2].anulado = true // transición anulada: todo vuelve a ser periodo 1
    expect(cuenta(eventos, 'A')).toBe(3)
    eventos[2].anulado = false // rehacer
    expect(cuenta(eventos, 'A')).toBe(1)
  })

  it('tope de periodos del deporte y equipo sin faltas', () => {
    n = 1
    const eventos = [cambio(), cambio(), cambio(), cambio(), cambio(), falta('A', 'a1')]
    expect(cuenta(eventos, 'A')).toBe(1)
    expect(cuenta([], 'A')).toBe(0)
  })
})
