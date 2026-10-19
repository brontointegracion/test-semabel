import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { digitosDelMarcador } from './PartidoPublico.jsx'

// Escala del marcador público (REPORT_174): el dígito mayor manda para AMBOS lados; el CSS usa --d. Datos sintéticos.
describe('digitosDelMarcador', () => {
  it('mínimo 2; 3 dígitos en cualquiera de los lados; marcadores desiguales usan el mayor', () => {
    expect(digitosDelMarcador(0, 0)).toBe(2)
    expect(digitosDelMarcador(7, 9)).toBe(2)
    expect(digitosDelMarcador(16, 11)).toBe(2)
    expect(digitosDelMarcador(111, 7)).toBe(3)
    expect(digitosDelMarcador(5, 100)).toBe(3)
    expect(digitosDelMarcador(1000, 3)).toBe(4)
  })
})

describe('CSS del marcador público', () => {
  const css = readFileSync(new URL('./publico.css', import.meta.url), 'utf8')
  it('toda regla nueva del marcador está acotada a «.publico» (no cambia el prototipo ni la consola)', () => {
    const bloque = css.slice(css.indexOf('Marcador público (REPORT_174)'), css.indexOf('/* Marcador público */'))
    const reglas = bloque.split('\n').filter((l) => /^\s*\.(app|publico)/.test(l) || /^\s*\.board/.test(l))
    expect(reglas.length).toBeGreaterThan(5)
    for (const l of reglas) expect(l.trim().startsWith('.publico') || l.trim().startsWith('.app:has(.board-pagina.publico)')).toBe(true)
  })
})
