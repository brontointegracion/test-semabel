import { describe, expect, it } from 'vitest'
import { CATEGORIAS_BALONCESTO } from './categorias.js'
import { duracionMs } from './reloj-calculo'
import {
  ALCANCES_FALTAS, REGLAS_POR_CATEGORIA, alcanceFaltasDe, copiaReglas, estadoDeReglas, firmaDeReglas, reglasDeCategoria, reglasDeConfig, reglasEfectivas,
} from './reglas-categoria.js'

// REPORT_175: presets de producto por categoría. Datos sintéticos.
describe('tabla de reglas por categoría', () => {
  it('usa EXACTAMENTE las claves del catálogo de categorías (no puede derivar: falta o sobra una y falla)', () => {
    expect(Object.keys(REGLAS_POR_CATEGORIA).sort()).toEqual(CATEGORIAS_BALONCESTO.map((c) => c.clave).sort())
  })

  it('valores pedidos: periodo, reloj de tiro, medio campo y alcance de faltas', () => {
    const r = (c) => reglasDeCategoria({ deporte: 'baloncesto', categoria: c })
    expect(r('baby')).toMatchObject({ minutosPorPeriodo: 8, relojTiro: { activo: false, segundos: null }, medioCampo: { activo: false, segundos: null }, faltasEquipo: 'oculto' })
    expect(r('mini-basketball')).toMatchObject({ minutosPorPeriodo: 8, relojTiro: { activo: true, segundos: 30 }, medioCampo: { activo: true, segundos: 20 }, faltasEquipo: 'periodo' })
    for (const c of ['intermediate', 'adult', 'veterans']) {
      expect(r(c), c).toMatchObject({ minutosPorPeriodo: 10, relojTiro: { activo: true, segundos: 24 }, medioCampo: { activo: true, segundos: 14 }, faltasEquipo: 'partido' })
    }
  })

  it('el preset u10/u12 de la subcategoría no cambia las reglas: manda la categoría', () => {
    expect(reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }).faltasEquipo).toBe('periodo')
  })
})

describe('desconocida, heredada o de otro deporte: sin reglas, nunca se adivina', () => {
  it.each([undefined, null, '', 'Libre', '40+', 'mini', 'Mini', 'ADULT', 'U10', 'Baby baloncesto', 'constructor', '__proto__', 7, {}])('categoría %j', (categoria) => {
    expect(reglasDeCategoria({ deporte: 'baloncesto', categoria })).toBeNull()
  })
  it('otro deporte con una clave que existe en baloncesto: null', () => {
    expect(reglasDeCategoria({ deporte: 'futsal', categoria: 'adult' })).toBeNull()
  })
})

describe('lectura de lo guardado', () => {
  const buenas = () => reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball' })
  it('copiaReglas acepta las propias y rechaza formas dudosas', () => {
    expect(copiaReglas(buenas())).toEqual(buenas())
    for (const mal of [null, 'x', [], { ...buenas(), version: 2 }, { ...buenas(), faltasEquipo: 'bonus' }, { ...buenas(), minutosPorPeriodo: 0 },
      { ...buenas(), relojTiro: { activo: true, segundos: null } }, { ...buenas(), relojTiro: { activo: false, segundos: 24 } }, { ...buenas(), categoria: '' },
      { ...buenas(), categoria: 'categoria-futura' }]) {
      expect(copiaReglas(mal)).toBeNull()
    }
  })
  it('alcance: el guardado válido manda; SIN reglas «partido» como siempre; presentes pero inválidas «no-disponible» (nunca «partido»)', () => {
    expect(alcanceFaltasDe({ reglas: buenas() })).toBe('periodo')
    expect(alcanceFaltasDe({})).toBe('partido')
    expect(alcanceFaltasDe(undefined)).toBe('partido')
    expect(alcanceFaltasDe({ reglas: { ...buenas(), faltasEquipo: 'otro' } })).toBe('no-disponible')
    expect(alcanceFaltasDe({ reglasInvalidas: true })).toBe('no-disponible')
    expect(ALCANCES_FALTAS).toEqual(['periodo', 'partido', 'oculto'])
  })
  it('reglasDeConfig: nada si faltan (forma anterior intacta), las reglas si son válidas, la marca reglasInvalidas si no lo son', () => {
    expect(reglasDeConfig({ deporte: 'baloncesto' })).toEqual({})
    expect(reglasDeConfig({ reglas: { basura: 1 } })).toEqual({ reglasInvalidas: true })
    expect(reglasDeConfig({ reglas: null })).toEqual({ reglasInvalidas: true })
    expect(reglasDeConfig({ reglas: buenas() })).toEqual({ reglas: buenas() })
  })
  it('estadoDeReglas distingue ausentes / válidas / inválidas (UNA interpretación) y firmaDeReglas lo refleja', () => {
    expect(estadoDeReglas({ deporte: 'baloncesto' })).toEqual({ estado: 'ausentes', reglas: null, motivo: null })
    expect(estadoDeReglas({ reglas: buenas() })).toMatchObject({ estado: 'validas', reglas: buenas() })
    for (const c of [{ reglas: null }, { reglas: 7 }, { reglas: {} }, { reglas: { ...buenas(), version: 2 } }, { reglasInvalidas: true }]) {
      expect(estadoDeReglas(c).estado, JSON.stringify(c)).toBe('invalidas')
    }
    expect(firmaDeReglas({})).toBe('ninguna')
    expect(firmaDeReglas({ reglas: buenas() })).toBe('1|mini-basketball|periodo|8|30|20')
    expect(firmaDeReglas({ reglas: reglasDeCategoria({ deporte: 'baloncesto', categoria: 'baby' }) })).toBe('1|baby|oculto|8|x|x')
    expect(firmaDeReglas({ reglas: { ...buenas(), version: 2 } })).toBe('invalidas')
  })
})

describe('reglas efectivas: fijadas mandan; solo un partido sin iniciar toma la categoría vigente', () => {
  const fijadas = reglasDeCategoria({ deporte: 'baloncesto', categoria: 'baby' })
  it('fijadas en el partido mandan aunque la categoría de la liga sea otra', () => {
    expect(reglasEfectivas({ config: { reglas: fijadas }, estadoPartido: 'vivo', deporte: 'baloncesto', categoria: 'adult' }).categoria).toBe('baby')
    expect(reglasEfectivas({ config: { reglas: fijadas }, estadoPartido: 'final', deporte: 'baloncesto', categoria: 'adult' }).categoria).toBe('baby')
  })
  it('reglas presentes pero inválidas: nunca se reemplazan por las de la categoría ni se tratan como ausentes', () => {
    for (const estadoPartido of ['programado', 'vivo', 'final']) {
      expect(reglasEfectivas({ config: { reglas: { version: 9 } }, estadoPartido, deporte: 'baloncesto', categoria: 'adult' })).toBeNull()
    }
  })
  it('programado sin reglas: la categoría vigente; iniciado o final sin reglas: ninguna', () => {
    expect(reglasEfectivas({ config: {}, estadoPartido: 'programado', deporte: 'baloncesto', categoria: 'adult' }).categoria).toBe('adult')
    expect(reglasEfectivas({ config: {}, estadoPartido: 'vivo', deporte: 'baloncesto', categoria: 'adult' })).toBeNull()
    expect(reglasEfectivas({ config: {}, estadoPartido: 'final', deporte: 'baloncesto', categoria: 'adult' })).toBeNull()
    expect(reglasEfectivas({ config: {}, estadoPartido: 'programado', deporte: 'baloncesto', categoria: 'Libre' })).toBeNull()
  })
})

describe('duración del periodo: la explícita manda', () => {
  const reglas = reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball' })
  it('2 minutos explícitos siguen siendo 2; sin duración explícita se usa el preset; sin reglas, el valor del deporte', () => {
    expect(duracionMs({ deporte: 'baloncesto', minutosPorPeriodo: 2, reglas })).toBe(120_000)
    expect(duracionMs({ deporte: 'baloncesto', minutosPorPeriodo: null, reglas })).toBe(8 * 60_000)
    expect(duracionMs({ deporte: 'baloncesto', minutosPorPeriodo: null })).toBe(10 * 60_000)
    // reglas inválidas no aportan duración (ni siquiera una «parcialmente válida»): la explícita sigue mandando
    expect(duracionMs({ deporte: 'baloncesto', minutosPorPeriodo: null, reglas: { ...reglas, version: 3 } })).toBe(10 * 60_000)
    expect(duracionMs({ deporte: 'baloncesto', minutosPorPeriodo: 2, reglas: { ...reglas, version: 3 } })).toBe(120_000)
    expect(duracionMs({ deporte: 'futsal', minutosPorPeriodo: null })).toBe(20 * 60_000)
  })
})
