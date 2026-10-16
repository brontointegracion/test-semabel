import { describe, expect, it } from 'vitest'
import { MOTIVOS, armarEquipo, etiquetaJugador, etiquetaNombre, etiquetaNumero, urlEquipoPublico } from './equipo.js'
import { respuestaEquipo } from './datos-prueba.js'
import { validarEquipo } from './validar.js'

const equipo = (cambios) => validarEquipo(respuestaEquipo(cambios), 'LIGAPUB1', 'E1')

describe('presentación de un equipo', () => {
  it('el número 0 es «#0»; sin número y sin nombre se dice explícitamente; nada se inventa', () => {
    expect(etiquetaNumero(0)).toBe('#0')
    expect(etiquetaNumero(7)).toBe('#7')
    expect(etiquetaNumero(null)).toBe('Sin número')
    expect(etiquetaNombre(null)).toBe('Nombre pendiente')
    expect(etiquetaJugador({ dorsalActual: 2, nombre: 'Saúl Montero' })).toBe('#2 Saúl Montero')
    expect(etiquetaJugador({ dorsalActual: 0, nombre: 'Ana Prueba' })).toBe('#0 Ana Prueba')
    expect(etiquetaJugador({ dorsalActual: null, nombre: null })).toBe('Nombre pendiente · Sin número')
  })
  it('une estadísticas por id estable: gemelos por nombre y por número NO se mezclan; sin eventos = 0 si hubo finales', () => {
    const v = armarEquipo(equipo())
    const por = Object.fromEntries(v.plantilla.map((j) => [j.id, j]))
    expect(por.J6).toMatchObject({ puntos: 5, faltas: 1 })
    expect(por.J7).toMatchObject({ puntos: 0, faltas: 0 }) // mismo nombre y número que J6, otra ficha
    expect(por.J2).toMatchObject({ nombre: 'Saúl Montero', puntos: 12, faltas: 4 })
    expect(por.J5).toMatchObject({ nombre: null, dorsalActual: null, puntos: 0 })
    expect(v.historicos).toEqual([{ id: 'JX', nombre: 'Retirado Ya', dorsalActual: 20, motivo: 'inactivo', puntos: 10, faltas: 2 }])
    expect(v.sinJugador).toBeNull()
    expect(MOTIVOS.inactivo).toBe('Inactivo')
  })
  it('sin partidos finales no hay estadísticas que mostrar (null), ni claim de cero', () => {
    const v = armarEquipo(equipo({ resultados: [], historicos: [], estadisticas: { alcance: 'partidos-finales-del-equipo', partidosFinales: 0, jugadores: [], sinJugador: { puntos: 0, faltas: 0 } } }))
    expect(v.hayFinales).toBe(false)
    for (const j of v.plantilla) expect(j).toMatchObject({ puntos: null, faltas: null })
  })
  it('lo anotado sin ficha se informa aparte; los resultados van del más reciente al más antiguo', () => {
    const base = respuestaEquipo()
    base.estadisticas.sinJugador = { puntos: 2, faltas: 1 }
    base.resultados.push({ ...base.resultados[0], gameId: 'G2', inicioReal: '2026-11-08T19:00:00.000Z' })
    const v = armarEquipo(validarEquipo(base, 'LIGAPUB1', 'E1'))
    expect(v.sinJugador).toEqual({ puntos: 2, faltas: 1 })
    expect(v.resultados.map((r) => r.gameId)).toEqual(['G2', 'G1'])
  })
  it('la URL del equipo', () => { expect(urlEquipoPublico('L1', 'E1')).toBe('/liga/l1/equipo/e1') })
})
