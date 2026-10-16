import { describe, expect, it } from 'vitest'
import {
  ALFABETO, aleatorioHex, generarCodigo, hashSecreto, hashesIguales, normalizarCodigo, partirCodigo,
} from '../src/acceso/codigos.js'

describe('generación de códigos', () => {
  it('20 caracteres del alfabeto sin letras ambiguas, en 4 grupos de 5; id público de 5 y secreto de 15', () => {
    const c = generarCodigo()
    expect(c.texto).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
    expect(c.id).toHaveLength(5)
    expect(c.secreto).toHaveLength(15)
    expect(c.texto.replaceAll('-', '')).toBe(c.id + c.secreto)
    expect(ALFABETO).toHaveLength(32)
    for (const prohibida of 'ILOU') expect(ALFABETO).not.toContain(prohibida)
  })

  it('no se repite y usa todo el alfabeto (aleatoriedad criptográfica, sin sesgo evidente)', () => {
    const vistos = new Set()
    const letras = new Set()
    for (let i = 0; i < 3000; i += 1) {
      const c = generarCodigo()
      vistos.add(c.texto)
      for (const ch of c.texto.replaceAll('-', '')) letras.add(ch)
    }
    expect(vistos.size).toBe(3000)
    expect(letras.size).toBe(32)
  })

  it('aleatorioHex devuelve el doble de caracteres que bytes y no se repite', () => {
    const a = aleatorioHex(32)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(aleatorioHex(32)).not.toBe(a)
  })
})

describe('normalización de lo que se teclea', () => {
  const canon = 'ABCDE23456FGHJK78MNPQ'.slice(0, 20)
  it('acepta minúsculas, espacios y guiones en cualquier sitio', () => {
    const base = 'ABCDE-23456-FGHJK-78MNP'
    expect(normalizarCodigo(base)).toBe('ABCDE23456FGHJK78MNP')
    expect(normalizarCodigo(base.toLowerCase())).toBe('ABCDE23456FGHJK78MNP')
    expect(normalizarCodigo(' abcde 23456  fghjk-78mnp ')).toBe('ABCDE23456FGHJK78MNP')
    expect(normalizarCodigo('ABCDE23456FGHJK78MNP')).toBe('ABCDE23456FGHJK78MNP')
    expect(canon).toHaveLength(20)
  })
  it('pliega las letras que se confunden (O→0, I y L→1) como hace quien teclea', () => {
    expect(normalizarCodigo('OOOOO-IIIII-LLLLL-11111')).toBe('00000111111111111111')
  })
  it('rechaza lo que no es un código: U, longitud, caracteres raros, no texto y entradas enormes', () => {
    for (const malo of ['ABCDE-23456-FGHJK-78MNU', 'ABCDE-23456-FGHJK-78MN', 'ABCDE-23456-FGHJK-78MNPQ', 'ABCDE-23456-FGHJK-78MN!',
      '', ' ', null, undefined, 12345, {}, ['ABCDE23456FGHJK78MNP'], 'A'.repeat(65), `${'A'.repeat(20)}${' '.repeat(100)}`]) {
      expect(normalizarCodigo(malo), String(malo)).toBeNull()
    }
  })
  it('parte el código en id público y secreto', () => {
    expect(partirCodigo('abcde-23456-fghjk-78mnp')).toEqual({ id: 'ABCDE', secreto: '23456FGHJK78MNP' })
    expect(partirCodigo('nope')).toBeNull()
  })
})

describe('hash del secreto y comparación', () => {
  it('es determinista, de 64 hex y distinto por tipo de uso', async () => {
    const a = await hashSecreto('organizador', 'SECRETO')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashSecreto('organizador', 'SECRETO')).toBe(a)
    expect(await hashSecreto('partido', 'SECRETO')).not.toBe(a)
    expect(await hashSecreto('sesion', 'SECRETO')).not.toBe(a)
    expect(await hashSecreto('organizador', 'OTRO')).not.toBe(a)
  })
  it('rechaza tipos desconocidos y entradas que no son texto', async () => {
    await expect(hashSecreto('inventado', 'x')).rejects.toThrow()
    await expect(hashSecreto('partido', 123)).rejects.toThrow()
  })
  it('hashesIguales: igualdad exacta en tiempo constante; lo que no es hash nunca es igual', async () => {
    const a = await hashSecreto('partido', 'A')
    const b = await hashSecreto('partido', 'B')
    expect(hashesIguales(a, a)).toBe(true)
    expect(hashesIguales(a, b)).toBe(false)
    expect(hashesIguales(a, a.slice(0, 63))).toBe(false)
    expect(hashesIguales(a, a.toUpperCase())).toBe(false)
    expect(hashesIguales(null, a)).toBe(false)
    expect(hashesIguales(undefined, undefined)).toBe(false)
    expect(hashesIguales('x', 'x')).toBe(false)
  })
})
