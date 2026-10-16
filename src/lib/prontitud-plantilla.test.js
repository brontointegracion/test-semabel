import { describe, expect, it } from 'vitest'
import { evaluarProntitud } from './prontitud-plantilla'

const liga = { id: 'L' }
const partido = { id: 'P', ligaId: 'L', localId: 'A', visitaId: 'B' }
const equipos = [{ id: 'A', ligaId: 'L', nombre: 'Alfa' }, { id: 'B', ligaId: 'L', nombre: 'Beta' }]
const j = (id, equipoId, dorsal, extra = {}) => ({ id, equipoId, ...(dorsal === undefined ? {} : { dorsal }), ...extra })
const evaluar = (jugadores, sobre = {}) => evaluarProntitud({ partido, liga, equipos, jugadores, ...sobre })

describe('evaluarProntitud — plantillas', () => {
  it('plantillas completas pasan, el #0 incluido; sin jugadores también', () => {
    expect(evaluar([j('a1', 'A', 0), j('a2', 'A', 7), j('b1', 'B', 0)])).toEqual({ lista: true })
    expect(evaluar([])).toEqual({ lista: true })
  })

  it.each([
    ['ausente', undefined], ['null', null], ['cadena vacía', ''], ['cero como texto', '0'], ['texto con cero', '07'],
    ['NaN', NaN], ['fuera de rango', 100], ['negativo', -1], ['fracción', 1.5], ['booleano', false],
  ])('un activo con número %s rechaza sin corregirlo', (_n, dorsal) => {
    const r = evaluar([j('a1', 'A', dorsal === undefined ? undefined : dorsal)])
    expect(r).toMatchObject({ lista: false, motivo: 'plantilla-incompleta' })
    expect(r.detalle.equipos).toEqual([{ equipoId: 'A', nombre: 'Alfa', sinNumero: 1, duplicados: [] }])
  })

  it('repetidos entre activos del mismo equipo rechazan, también el 0; en equipos distintos no', () => {
    const r = evaluar([j('a1', 'A', 0), j('a2', 'A', 0), j('a3', 'A', 5), j('a4', 'A', 5), j('b1', 'B', 0)])
    expect(r.detalle.equipos).toEqual([{ equipoId: 'A', nombre: 'Alfa', sinNumero: 0, duplicados: [0, 5] }])
    expect(evaluar([j('a1', 'A', 3), j('b1', 'B', 3)])).toEqual({ lista: true })
  })

  it('los inactivos no bloquean ni repiten; activo ausente o explícito sí cuenta', () => {
    expect(evaluar([
      j('a1', 'A', 4), j('a2', 'A', undefined, { activo: false }), j('a3', 'A', 4, { activo: false }), j('b1', 'B', 2, { activo: true }),
    ])).toEqual({ lista: true })
    expect(evaluar([j('a1', 'A', undefined, { activo: true })]).lista).toBe(false)
    expect(evaluar([j('a1', 'A', undefined, { activo: undefined })]).lista).toBe(false)
  })

  it('la fecha de nacimiento no importa y el detalle no lleva datos de jugadores', () => {
    const jugadores = [
      j('a1', 'A', 3, { fechaNacimiento: undefined }),
      j('a2', 'A', undefined, { nombre: 'Secreta Persona', fechaNacimiento: '2001-01-01', personaId: 'p9', codigo: '1234' }),
    ]
    const r = evaluar(jugadores)
    const texto = JSON.stringify(r)
    for (const privado of ['Secreta', '2001', 'p9', '1234', 'a2']) expect(texto).not.toContain(privado)
  })

  it('jugadores de otros equipos se ignoran', () => {
    expect(evaluar([j('c1', 'C', undefined)])).toEqual({ lista: true })
  })
})

describe('evaluarProntitud — equipos y liga', () => {
  it.each([
    ['sin liga', { liga: null }],
    ['liga de otro id', { liga: { id: 'X' } }],
    ['partido sin ligaId', { partido: { ...partido, ligaId: undefined } }],
    ['sin local', { partido: { ...partido, localId: undefined } }],
    ['visita vacía', { partido: { ...partido, visitaId: '' } }],
    ['mismo equipo dos veces', { partido: { ...partido, visitaId: 'A' } }],
    ['ids no cadena', { partido: { ...partido, localId: 1, visitaId: 2 } }],
    ['equipo inexistente', { partido: { ...partido, visitaId: 'Z' } }],
    ['equipos sin la visita', { equipos: [equipos[0]] }],
    ['equipo de otra liga', { equipos: [equipos[0], { id: 'B', ligaId: 'OTRA' }] }],
    ['equipo sin ligaId', { equipos: [equipos[0], { id: 'B' }] }],
  ])('%s rechaza con equipos-invalidos', (_n, sobre) => {
    expect(evaluar([], sobre)).toMatchObject({ lista: false, motivo: 'equipos-invalidos' })
  })

  it('los equipos inválidos tienen precedencia sobre la plantilla', () => {
    expect(evaluar([j('a1', 'A', undefined)], { liga: null }).motivo).toBe('equipos-invalidos')
  })
})
