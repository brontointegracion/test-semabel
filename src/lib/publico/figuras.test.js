import { describe, expect, it } from 'vitest'
import { PODIO_FILAS_MAX, PODIO_RANGO, figurasDeLiga } from './figuras.js'
import { respuestaJugadores } from './datos-prueba.js'
import { validarJugadores } from './validar.js'

const E1 = { id: 'E1', nombre: 'Alfa Norte' }
const E2 = { id: 'E2', nombre: 'Beta Sur' }
const datos = (anotadores, extra = {}) => validarJugadores(respuestaJugadores({ anotadores, ...extra }), 'LIGAPUB1')
const a = (id, puntos, equipo = E1, extra = {}) => ({ id, nombre: `Jugador ${id}`, equipo, puntos, ...extra })

describe('figurasDeLiga: qué destaca la portada de cada liga (prefijo del ranking público; nada se suma ni se reordena)', () => {
  it('constantes: podio de tres puestos y tope de cinco filas por liga', () => { expect([PODIO_RANGO, PODIO_FILAS_MAX]).toEqual([3, 5]) })
  it('sin partidos terminados y sin puntos son estados distintos del «hay figuras»', () => {
    expect(figurasDeLiga(datos([], { partidosFinales: 0 }))).toEqual({ estado: 'sin-partidos', entradas: [], masEmpatados: 0 })
    expect(figurasDeLiga(datos([], { partidosFinales: 2 }))).toEqual({ estado: 'sin-puntos', entradas: [], masEmpatados: 0 })
  })
  it('puestos 1, 2, 2, 4: las tres entradas hasta el puesto 3 (el empate comparte puesto); el cuarto no entra', () => {
    const r = figurasDeLiga(datos([a('J1', 30), a('J2', 20), a('J3', 20), a('J4', 10)]))
    expect(r.entradas.map((e) => [e.id, e.rango])).toEqual([['J1', 1], ['J2', 2], ['J3', 2]])
    expect(r.masEmpatados).toBe(0)
  })
  it('un empate en el puesto 3 se muestra COMPLETO (nunca se corta a un empatado por su nombre) y el puesto 4 queda fuera', () => {
    const r = figurasDeLiga(datos([a('J1', 30), a('J2', 20), a('J3', 10), a('J4', 10), a('J5', 5)]))
    expect(r.entradas.map((e) => [e.id, e.rango])).toEqual([['J1', 1], ['J2', 2], ['J3', 3], ['J4', 3]])
  })
  it('empate de muchos en el primer puesto: tope de 5 filas y se dice cuántas quedaron fuera', () => {
    const r = figurasDeLiga(datos(Array.from({ length: 8 }, (_, i) => a(`J${i + 1}`, 12))))
    expect(r.entradas).toHaveLength(5)
    expect(r.entradas.every((e) => e.rango === 1)).toBe(true)
    expect(r.masEmpatados).toBe(3)
  })
  it('personas con el mismo nombre o el mismo número son entradas distintas (por ficha y equipo); nada se une', () => {
    const r = figurasDeLiga(datos([
      { id: 'F1', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E1, puntos: 14 },
      { id: 'F2', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E2, puntos: 14 },
      { id: 'F1', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E2, puntos: 9 }, // la MISMA ficha con otro equipo: otra entrada
    ]))
    expect(r.entradas.map((e) => `${e.id}|${e.equipo.id}|${e.puntos}|${e.rango}`)).toEqual(['F1|E1|14|1', 'F2|E2|14|1', 'F1|E2|9|3'])
  })
})
