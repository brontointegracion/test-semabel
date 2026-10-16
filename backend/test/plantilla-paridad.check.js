import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALTAS, EDICIONES, REACTIVACIONES } from '../../src/lib/roster-reglas.vectores.js'
import { control, reiniciarAcceso } from './ayuda-acceso.js'
import { accion, alta, escenarioPlantilla } from './ayuda-plantilla.js'

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null })

// Los MISMOS vectores que la prueba de la raíz usa sobre las reglas puras: aquí por HTTP, contra el backend. Los
// rechazos no mutan la base, así que comparten una liga; los casos válidos usan una liga nueva cada uno.

const esperado = (v) => (v.ok ? { resultado: 'aplicado' } : { resultado: 'rechazado', ...v.esperado })

describe('altas: el backend decide igual que las reglas puras', () => {
  it('rechazos', async () => {
    const e = await escenarioPlantilla()
    for (const v of ALTAS.filter((x) => !x.ok)) {
      const r = await alta(e.cookie, e.ligaId, 'E3', { campos: v.campos })
      expect(r.cuerpo, v.n).toMatchObject(esperado(v))
      expect(r.cuerpo.errores, v.n).toEqual(v.esperado.errores)
    }
  })
  for (const v of ALTAS.filter((x) => x.ok)) {
    it(`válido: ${v.n}`, async () => {
      const e = await escenarioPlantilla()
      const r = await alta(e.cookie, e.ligaId, 'E3', { campos: v.campos })
      expect(r.cuerpo, v.n).toMatchObject({ resultado: 'aplicado', tipo: 'creado' })
    })
  }
})

describe('ediciones sobre J2: el backend decide igual', () => {
  it('rechazos', async () => {
    const e = await escenarioPlantilla()
    for (const v of EDICIONES.filter((x) => !x.ok)) {
      const r = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: v.campos })
      expect(r.cuerpo, v.n).toMatchObject({ resultado: 'rechazado', tipo: v.esperado.tipo })
      if (v.esperado.errores) expect(r.cuerpo.errores, v.n).toEqual(v.esperado.errores)
    }
  })
  for (const v of EDICIONES.filter((x) => x.ok)) {
    it(`válido: ${v.n}`, async () => {
      const e = await escenarioPlantilla()
      const r = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: v.campos })
      expect(r.cuerpo, v.n).toMatchObject({ resultado: 'aplicado', tipo: 'editado' })
    })
  }
})

describe('reactivaciones de JX: el backend decide igual', () => {
  it('rechazos', async () => {
    const e = await escenarioPlantilla()
    for (const v of REACTIVACIONES.filter((x) => !x.ok)) {
      const r = await accion(e.cookie, e.ligaId, 'E1', 'JX', 'reactivar', { revEsperada: 1, ...v.entrada })
      expect(r.cuerpo, v.n).toMatchObject({ resultado: 'rechazado', tipo: v.esperado.tipo })
      if (v.esperado.errores) expect(r.cuerpo.errores, v.n).toEqual(v.esperado.errores)
    }
  })
  for (const v of REACTIVACIONES.filter((x) => x.ok)) {
    it(`válido: ${v.n}`, async () => {
      const e = await escenarioPlantilla()
      const r = await accion(e.cookie, e.ligaId, 'E1', 'JX', 'reactivar', { revEsperada: 1, ...v.entrada })
      expect(r.cuerpo, v.n).toMatchObject({ resultado: 'aplicado', tipo: 'reactivado' })
    })
  }
})
