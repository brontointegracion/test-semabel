import { describe, expect, it } from 'vitest'
import { partirNombre } from './identidad'

describe('partirNombre', () => {
  it('nombre vacío o ausente', () => {
    const vacio = { nombrePila: '', apellido1: '', apellido2: '' }
    expect(partirNombre('')).toEqual(vacio)
    expect(partirNombre('   ')).toEqual(vacio)
    expect(partirNombre(undefined)).toEqual(vacio)
    expect(partirNombre(null)).toEqual(vacio)
  })

  it('una sola palabra', () => {
    expect(partirNombre('Miguel')).toEqual({ nombrePila: 'Miguel', apellido1: '', apellido2: '' })
  })

  it('nombre y apellido', () => {
    expect(partirNombre('Miguel Robles')).toEqual({ nombrePila: 'Miguel', apellido1: 'Robles', apellido2: '' })
  })

  it('nombre compuesto de varias palabras', () => {
    expect(partirNombre('Miguel Sam Robles')).toEqual({
      nombrePila: 'Miguel Sam',
      apellido1: 'Robles',
      apellido2: '',
    })
  })

  it('colapsa espacios extra al recomponer nombrePila', () => {
    expect(partirNombre('  Miguel   Sam  Robles  ')).toEqual({
      nombrePila: 'Miguel Sam',
      apellido1: 'Robles',
      apellido2: '',
    })
  })
})
