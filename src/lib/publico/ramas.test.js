import { describe, expect, it } from 'vitest'
import { ETIQUETA_RAMA, etiquetaRama, ramaPublica } from './ramas.js'
import { respuestaEquipo, respuestaLiga } from './datos-prueba.js'
import { validarEquipo, validarLiga } from './validar.js'

// REPORT_220 — rama del equipo: nullable, nunca inferida, nunca con valor por omisión.

describe('etiquetas y valores', () => {
  it('tres ramas con su etiqueta; cualquier otra cosa (null, mayúsculas, texto libre, tipos raros) es «sin rama»', () => {
    expect(ETIQUETA_RAMA).toEqual({ masculino: 'Masculino', femenino: 'Femenino', mixta: 'Mixta' })
    expect(['masculino', 'femenino', 'mixta'].map(etiquetaRama)).toEqual(['Masculino', 'Femenino', 'Mixta'])
    for (const v of [null, undefined, '', 'Mixta', 'MIXTA', 'mixto', 'varonil', 7, {}, [], 'constructor', '__proto__', 'toString']) { expect(ramaPublica(v), String(v)).toBeNull(); expect(etiquetaRama(v)).toBeNull() }
  })
})

describe('validadores públicos', () => {
  it('lectura de la liga: cada equipo lleva rama o null; un servidor anterior (sin el campo) da null; un valor desconocido se descarta; nada más pasa', () => {
    const r = respuestaLiga()
    r.equipos = [{ id: 'E1', nombre: 'Alfa Norte', rama: 'mixta' }, { id: 'E2', nombre: 'Beta Sur' }, { id: 'E3', nombre: 'Gama Este', rama: 'varonil' }, { id: 'E4', nombre: 'Delta Oeste', rama: 'femenino', personaId: 'secreto' }]
    const v = validarLiga(r, 'LIGAPUB1')
    expect(v.equipos).toEqual([{ id: 'E1', nombre: 'Alfa Norte', rama: 'mixta' }, { id: 'E2', nombre: 'Beta Sur', rama: null }, { id: 'E3', nombre: 'Gama Este', rama: null }, { id: 'E4', nombre: 'Delta Oeste', rama: 'femenino' }])
    expect(JSON.stringify(v)).not.toContain('secreto')
    expect(v.liga).toEqual(validarLiga(respuestaLiga(), 'LIGAPUB1').liga) // la clasificación de la competición no cambia
  })
  it('lectura del equipo: rama o null', () => {
    const base = respuestaEquipo()
    expect(validarEquipo({ ...base, equipo: { ...base.equipo, rama: 'masculino' } }, 'LIGAPUB1', 'E1').equipo).toEqual({ id: 'E1', nombre: 'Alfa Norte', rama: 'masculino' })
    expect(validarEquipo(base, 'LIGAPUB1', 'E1').equipo.rama).toBeNull()
    expect(validarEquipo({ ...base, equipo: { ...base.equipo, rama: 'Mixta' } }, 'LIGAPUB1', 'E1').equipo.rama).toBeNull()
  })
})
