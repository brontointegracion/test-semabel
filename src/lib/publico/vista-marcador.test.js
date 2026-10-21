import { describe, expect, it } from 'vitest'
import { etiquetaPeriodo, periodosTotales, proximoPartido, vistaDelMarcador } from './vista-marcador.js'

const reloj = (estado, restanteMs) => ({ estado, restanteMs, desdeMs: null })

describe('vistaDelMarcador: solo lo que confirmó el servidor', () => {
  const v = (o) => vistaDelMarcador({ estado: 'vivo', periodo: 2, reloj: reloj('corriendo', 300000), deporte: 'baloncesto', ...o })
  it('programado y final salen del estado autoritativo, nunca de la hora ni del reloj', () => {
    expect(v({ estado: 'programado', reloj: reloj(null, null) })).toBe('programado')
    expect(v({ estado: 'final', reloj: reloj('detenido', 0), periodo: 4 })).toBe('final')
    expect(v({ estado: null })).toBe('programado')
  })
  it('una pausa normal NO es un descanso, con o sin tiempo restante', () => {
    expect(v({ reloj: reloj('detenido', 300000) })).toBe('juego')
    expect(v({ reloj: reloj('detenido', 1) })).toBe('juego')
    expect(v({ reloj: reloj('detenido', 600000) })).toBe('juego') // periodo recién preparado
    expect(v({ reloj: reloj(null, null) })).toBe('juego')
  })
  it('un reloj CORRIENDO nunca es fin de periodo, aunque el restante sea 0 (cuenta del dispositivo sin confirmar)', () => {
    expect(v({ reloj: reloj('corriendo', 0) })).toBe('juego')
  })
  it('reloj detenido en 00:00 confirmado: fin de periodo, y en el último periodo fin del tiempo (no es final)', () => {
    expect(v({ reloj: reloj('detenido', 0), periodo: 1 })).toBe('fin-periodo')
    expect(v({ reloj: reloj('detenido', 0), periodo: 3 })).toBe('fin-periodo')
    expect(v({ reloj: reloj('detenido', 0), periodo: 4 })).toBe('fin-tiempo')
    expect(v({ reloj: reloj('detenido', 0), periodo: 2, deporte: 'futsal' })).toBe('fin-tiempo') // futsal: 2 tiempos
    expect(v({ reloj: reloj('detenido', 0), periodo: 1, deporte: 'futsal' })).toBe('fin-periodo')
  })
  it('al preparar el período siguiente (periodo+1, restante completo) vuelve a juego', () => {
    expect(v({ reloj: reloj('detenido', 0), periodo: 1 })).toBe('fin-periodo')
    expect(v({ reloj: reloj('detenido', 600000), periodo: 2 })).toBe('juego')
  })
  it('periodosTotales y etiquetas por deporte', () => {
    expect(periodosTotales('baloncesto')).toBe(4)
    expect(periodosTotales('futsal')).toBe(2)
    expect(periodosTotales('otro')).toBe(2)
    expect(etiquetaPeriodo('baloncesto', 1)).toBe('1.er cuarto')
    expect(etiquetaPeriodo('baloncesto', 4)).toBe('4.º cuarto')
    expect(etiquetaPeriodo('futsal', 2)).toBe('2.º tiempo')
    expect(etiquetaPeriodo('otro', 3)).toBe('Periodo 3')
  })
})

describe('proximoPartido: solo con alcance explícito y sin ambigüedad', () => {
  const p = (gameId, h, o = {}) => ({ gameId, estado: 'programado', programadoPara: `2026-12-05T${h}:00Z`, sede: 'Cancha A', local: { id: 'E1' }, visita: { id: 'E2' }, ...o })
  const actual = p('A', '15:00', { estado: 'final' })
  it('sin alcance explícito no elige nada (la dirección de un partido fijo no adivina el siguiente)', () => {
    const lista = [actual, p('B', '16:00')]
    expect(proximoPartido(lista, actual, null)).toBeNull()
    expect(proximoPartido(lista, actual, undefined)).toBeNull()
    expect(proximoPartido(lista, actual, {})).toBeNull()
    expect(proximoPartido(lista, actual, { sede: false })).toBeNull()
  })
  it('alcance «sede»: el siguiente programado en la misma sede, el más cercano en el tiempo', () => {
    const lista = [actual, p('C', '17:00'), p('B', '16:00'), p('D', '15:30', { sede: 'Cancha B' }), p('E', '14:00')]
    expect(proximoPartido(lista, actual, { sede: true }).gameId).toBe('B')
  })
  it('ambigüedad, sede o hora desconocida, partidos que no están programados: null', () => {
    expect(proximoPartido([actual, p('B', '16:00'), p('C', '16:00')], actual, { sede: true })).toBeNull() // dos a la misma hora
    expect(proximoPartido([actual, p('B', '16:00', { estado: 'vivo' }), p('C', '17:00', { estado: 'final' })], actual, { sede: true })).toBeNull()
    expect(proximoPartido([{ ...actual, sede: null }, p('B', '16:00')], { ...actual, sede: null }, { sede: true })).toBeNull()
    expect(proximoPartido([{ ...actual, programadoPara: null }, p('B', '16:00')], { ...actual, programadoPara: null }, { sede: true })).toBeNull()
    expect(proximoPartido([actual, p('B', '16:00', { programadoPara: null })], actual, { sede: true })).toBeNull()
    expect(proximoPartido([actual], actual, { sede: true })).toBeNull()
    expect(proximoPartido([actual, p('B', '16:00')], null, { sede: true })).toBeNull()
  })
})
