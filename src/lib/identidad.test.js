import { describe, expect, it } from 'vitest'
import { nombreVisible, partirNombre } from './identidad'

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

describe('nombreVisible', () => {
  it('usa el nombre en camiseta con contenido y recorta espacios', () => {
    expect(nombreVisible({ nombre: 'Miguel Sam Robles', nombreCamiseta: 'SAM' })).toBe('SAM')
    expect(nombreVisible({ nombre: 'Miguel Sam Robles', nombreCamiseta: '  SAM  ' })).toBe('SAM')
  })

  it('cae al nombre si falta, está vacío, es solo espacios o no es texto', () => {
    const base = { nombre: 'Miguel Sam Robles' }
    expect(nombreVisible(base)).toBe('Miguel Sam Robles')
    expect(nombreVisible({ ...base, nombreCamiseta: '' })).toBe('Miguel Sam Robles')
    expect(nombreVisible({ ...base, nombreCamiseta: '   ' })).toBe('Miguel Sam Robles')
    expect(nombreVisible({ ...base, nombreCamiseta: null })).toBe('Miguel Sam Robles')
    expect(nombreVisible({ ...base, nombreCamiseta: 7 })).toBe('Miguel Sam Robles')
  })

  it('no falla con una ficha ausente', () => {
    expect(nombreVisible(undefined)).toBeUndefined()
  })
})
