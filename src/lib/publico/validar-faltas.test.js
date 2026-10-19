import { describe, expect, it } from 'vitest'
import { respuestaJuego } from './datos-prueba.js'
import { validarJuego } from './validar.js'

// REPORT_175: alcance de las faltas de equipo en la lectura pública de un partido. Sintético.
const conPeriodo = (sobre = {}) => respuestaJuego({
  faltasEquipo: 'periodo',
  local: { id: 'E1', nombre: 'Alfa Norte', puntos: 12, faltas: 3, faltasPeriodo: 1 },
  visita: { id: 'E2', nombre: 'Beta Sur', puntos: 9, faltas: 4, faltasPeriodo: 2 }, ...sobre,
})
const v = (x) => validarJuego(x, 'LIGAPUB1', 'G1')

describe('validarJuego: faltasEquipo y faltasPeriodo', () => {
  it('respuesta de un servidor anterior (sin los campos): alcance «partido» y faltasPeriodo null', () => {
    const r = v(respuestaJuego())
    expect(r.faltasEquipo).toBe('partido')
    expect(r.local.faltasPeriodo).toBeNull()
  })
  it('«no-disponible» (reglas guardadas inválidas) se acepta y no exige cuenta de periodo', () => {
    const r = v(respuestaJuego({ faltasEquipo: 'no-disponible' }))
    expect(r.faltasEquipo).toBe('no-disponible')
    expect(r.local.faltas).toBe(3)
  })
  it('periodo, partido y oculto se aceptan; un valor desconocido se rechaza', () => {
    expect(v(conPeriodo()).faltasEquipo).toBe('periodo')
    expect(v(conPeriodo()).local.faltasPeriodo).toBe(1)
    expect(v(respuestaJuego({ faltasEquipo: 'partido' })).faltasEquipo).toBe('partido')
    expect(v(respuestaJuego({ faltasEquipo: 'oculto' })).faltasEquipo).toBe('oculto')
    for (const mal of ['bonus', '', null, 3, 'PERIODO']) expect(v(respuestaJuego({ faltasEquipo: mal })), String(mal)).toBeNull()
  })
  it('«periodo» sin la cuenta del periodo de ambos equipos no es una respuesta válida; la cuenta fuera de rango tampoco', () => {
    expect(v(respuestaJuego({ faltasEquipo: 'periodo' }))).toBeNull()
    expect(v(conPeriodo({ visita: { id: 'E2', nombre: 'Beta Sur', puntos: 9, faltas: 4, faltasPeriodo: null } }))).toBeNull()
    expect(v(conPeriodo({ local: { id: 'E1', nombre: 'Alfa Norte', puntos: 12, faltas: 3, faltasPeriodo: -1 } }))).toBeNull()
    expect(v(conPeriodo({ local: { id: 'E1', nombre: 'Alfa Norte', puntos: 12, faltas: 3, faltasPeriodo: 'x' } }))).toBeNull()
  })
  it('no deja pasar campos de más (alias, etiquetas) al copiar', () => {
    const r = v(conPeriodo({ local: { id: 'E1', nombre: 'Alfa Norte', puntos: 12, faltas: 3, faltasPeriodo: 1, alias: 'X', etiqueta: 'Y' } }))
    expect(Object.keys(r.local).sort()).toEqual(['faltas', 'faltasPeriodo', 'id', 'nombre', 'puntos'])
  })
})
