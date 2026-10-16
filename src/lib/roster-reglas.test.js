import { describe, expect, it } from 'vitest'
import {
  claveDeComparacion, decidirEdicion, edadDe, nuevaFichaDe, numeroDisponibleEn, planAlta, planEdicion, planReactivacion, proyectarCandidato,
  validarCamposJugador, validarFechaNacimiento,
} from './roster-reglas'
import { ALTAS, EDICIONES, FICHAS_E1, REACTIVACIONES } from './roster-reglas.vectores'

// Reglas puras de plantilla, sin base de datos. Los mismos vectores los usa el backend por HTTP (backend/test/plantilla-paridad.check.js).

const AHORA = Date.UTC(2023, 10, 14)
const J2 = FICHAS_E1[1]
const JX = FICHAS_E1[2]

describe('alta (vectores compartidos)', () => {
  for (const v of ALTAS) {
    it(v.n, () => {
      const plan = planAlta(v.campos, AHORA)
      if (v.ok) expect(plan.errores).toBeUndefined()
      else expect(plan.errores).toEqual(v.esperado.errores)
      expect(validarCamposJugador(v.campos, AHORA)).toEqual(v.ok ? {} : v.esperado.errores)
    })
  }
  it('la forma canónica conserva mayúsculas y acentos, colapsa espacios y deriva el nombre', () => {
    const plan = planAlta({ nombrePila: '  María  José ', apellido1: ' DE  la Cruz', dorsal: ' 05 ', nombreCamiseta: ' Mari ' }, AHORA)
    expect(plan.canon).toEqual({ nombrePila: 'María José', apellido1: 'DE la Cruz', apellido2: '' })
    expect(plan.dorsal).toBe(5)
    expect(plan.nombreCamiseta).toBe('Mari')
    const ficha = nuevaFichaDe({ id: 'f1', codigo: '1234', ligaId: 'L', equipoId: 'E', personaId: 'p', plan })
    expect(ficha).toMatchObject({ nombre: 'María José DE la Cruz', dorsal: 5, activo: true, reclamado: false, fechaNacimiento: undefined })
  })
})

describe('edición (vectores compartidos)', () => {
  for (const v of EDICIONES) {
    it(v.n, () => {
      const d = decidirEdicion({ actual: J2, campos: v.campos, ahoraMs: AHORA })
      if (d.errores) return expect(v.esperado).toEqual({ tipo: 'invalido', errores: d.errores })
      const plan = planEdicion({ vivo: J2, decidida: d, fichasDelEquipo: FICHAS_E1 })
      if (v.ok) expect(plan.tipo).toBe('ok')
      else expect(plan).toEqual(v.esperado)
    })
  }
  it('solo un cambio real de los campos de nombre pide revisar duplicados', () => {
    expect(decidirEdicion({ actual: J2, campos: { dorsal: 8 }, ahoraMs: AHORA }).nombreCambio).toBe(false)
    expect(decidirEdicion({ actual: J2, campos: { nombrePila: ' Beto ' }, ahoraMs: AHORA }).nombreCambio).toBe(false)
    expect(decidirEdicion({ actual: J2, campos: { nombrePila: 'Roberto' }, ahoraMs: AHORA }).nombreCambio).toBe(true)
  })
  it('una ficha anterior sin número válido no se edita hasta recibir uno, y se decide contra la ficha releída', () => {
    const legado = { id: 'L', equipoId: 'E1', nombrePila: 'A', apellido1: 'B', activo: true }
    expect(decidirEdicion({ actual: legado, campos: { nombrePila: 'Otra' }, ahoraMs: AHORA }).errores).toEqual({ dorsal: 'El número es obligatorio.' })
    const d = decidirEdicion({ actual: J2, campos: { nombrePila: 'Otra' }, ahoraMs: AHORA })
    expect(planEdicion({ vivo: { ...J2, dorsal: undefined }, decidida: d, fichasDelEquipo: FICHAS_E1 })).toMatchObject({ tipo: 'invalido' })
  })
})

describe('reactivación (vectores compartidos)', () => {
  for (const v of REACTIVACIONES) {
    it(v.n, () => {
      const plan = planReactivacion({ actual: JX, ...v.entrada, fichasDelEquipo: FICHAS_E1 })
      if (v.ok) expect(plan.tipo).toBe('ok')
      else expect(plan).toEqual(v.esperado)
    })
  }
  it('sin número anterior válido exige uno nuevo', () => {
    expect(planReactivacion({ actual: { ...JX, dorsal: undefined }, fichasDelEquipo: FICHAS_E1 })).toEqual({ tipo: 'invalido', errores: { dorsal: 'El número es obligatorio.' } })
  })
})

describe('apoyos', () => {
  it('el número está disponible si ningún ACTIVO distinto lo tiene', () => {
    expect(numeroDisponibleEn(FICHAS_E1, 7)).toBe(false)
    expect(numeroDisponibleEn(FICHAS_E1, 7, 'J2')).toBe(true)
    expect(numeroDisponibleEn(FICHAS_E1, 9)).toBe(true) // el inactivo no lo ocupa
  })
  it('la fecha futura se decide con el instante recibido', () => {
    expect(validarFechaNacimiento('2023-11-15', AHORA)).toBe('La fecha no puede ser futura.')
    expect(validarFechaNacimiento('2023-11-13', AHORA)).toBeNull()
  })
  it('la clave de comparación ignora mayúsculas y acentos; el candidato muestra la edad y nunca la fecha', () => {
    expect(claveDeComparacion({ nombrePila: 'BÉTO', apellido1: 'muestra' })).toBe(claveDeComparacion({ nombrePila: 'Beto', apellido1: 'Muestra', apellido2: '' }))
    const c = proyectarCandidato({ ...J2, personaId: 'p' }, 'Alfa', new Date(2023, 10, 14))
    expect(c).toEqual({ fichaId: 'J2', personaId: 'p', equipoId: 'E1', equipoNombre: 'Alfa', nombreCompleto: 'Beto Muestra', dorsal: 7, activo: true, edad: 8 })
    expect(edadDe(undefined)).toBeUndefined()
  })
})
