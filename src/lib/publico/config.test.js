import { afterEach, describe, expect, it, vi } from 'vitest'
import { ID_PUBLICO, MAX_LIGAS_CONFIGURADAS, interpretarLigas, ligasConfiguradas } from './config.js'

afterEach(() => vi.unstubAllEnvs())

describe('ligas públicas configuradas', () => {
  it('por defecto no hay ninguna (ausente o vacía) y es una configuración válida', () => {
    expect(interpretarLigas(undefined)).toEqual({ ok: true, ids: [] })
    expect(interpretarLigas('')).toEqual({ ok: true, ids: [] })
    expect(ligasConfiguradas()).toEqual({ ok: true, ids: [] })
  })
  it('acepta IDs válidos, en orden, y se lee del entorno en cada llamada', () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,LIGA_pub-2')
    expect(ligasConfiguradas()).toEqual({ ok: true, ids: ['LIGAPUB1', 'LIGA_pub-2'] })
  })
  it('una configuración mal formada se descarta ENTERA (falla cerrada): ninguna liga y ok:false', () => {
    const malos = ['A,', ',A', 'A,,B', 'A, B', ' A', 'A B', 'A/B', '../x', 'A,A', 'ñ', 'A'.repeat(65), Array.from({ length: MAX_LIGAS_CONFIGURADAS + 1 }, (_, i) => `L${i}`).join(','), 'A;B']
    for (const m of malos) expect(interpretarLigas(m), JSON.stringify(m)).toEqual({ ok: false, ids: [], error: 'configuracion-invalida' })
    expect(interpretarLigas(5)).toMatchObject({ ok: false, ids: [] })
    expect(interpretarLigas({})).toMatchObject({ ok: false })
  })
  it('el patrón de ID es el del servidor', () => {
    expect(ID_PUBLICO.test('A'.repeat(64))).toBe(true)
    expect(ID_PUBLICO.test('A'.repeat(65))).toBe(false)
  })
})
