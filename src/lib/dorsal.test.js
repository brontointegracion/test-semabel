import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MENSAJES_DORSAL, compararPorDorsal, dorsalDe, etiquetaDorsal, leerDorsal, resolverEntradaDorsal, textoDorsal, tieneNumero,
} from './dorsal'

// Número de camiseta: lectura estricta, intención explícita de "pendiente",
// y ayudantes puros de presentación y orden (todavía sin conectar a pantallas).

const real = (valor) => ({ tipo: 'real', valor })
const VACIO = { tipo: 'vacio' }
const INVALIDO = { tipo: 'invalido' }

describe('leerDorsal', () => {
  it.each([
    [0, real(0)], ['0', real(0)], ['00', real(0)], [' 0 ', real(0)], ['\t0\n', real(0)],
    [7, real(7)], ['7', real(7)], ['07', real(7)], ['007', real(7)], [' 12 ', real(12)],
    [99, real(99)], ['99', real(99)], ['099', real(99)],
  ])('%j es un número real', (entrada, esperado) => {
    expect(leerDorsal(entrada)).toEqual(esperado)
  })

  it('-0 se normaliza a 0', () => {
    const r = leerDorsal(-0)
    expect(r).toEqual(real(0))
    expect(Object.is(r.valor, 0)).toBe(true)
  })

  it.each([[undefined], [null], [''], ['   '], ['\t\n '], [' '], ['　']])(
    '%j es vacío, nunca cero', (entrada) => {
      expect(leerDorsal(entrada)).toEqual(VACIO)
    },
  )

  it('regresión: un texto en blanco no se convierte en 0 como hace Number()', () => {
    expect(Number('  ')).toBe(0) // el problema que se evita
    expect(leerDorsal('  ')).not.toEqual(real(0))
    expect(leerDorsal('  ').tipo).toBe('vacio')
  })

  it.each([
    [true], [false], [[]], [[7]], [['7']], [{}], [{ valueOf: () => 7 }], [() => 7], [Symbol('x')], [10n],
    [NaN], [Infinity], [-Infinity], [-1], [-0.5], [1.5], [7.0000001], [100], [1e3],
    ['-1'], ['1.5'], ['1e1'], ['7a'], ['a7'], ['abc'], ['0x10'], ['+7'], ['7 7'], ['٣'], ['١٢'], ['100'], ['0100'],
    ['1'.repeat(400)], [new Number(7)], [new String('7')],
  ])('%s se rechaza', (entrada) => {
    expect(leerDorsal(entrada)).toEqual(INVALIDO)
  })

  it('ceros a la izquierda muy largos siguen siendo ese número', () => {
    expect(leerDorsal(`${'0'.repeat(400)}7`)).toEqual(real(7))
  })

  it('devuelve siempre enteros, no textos', () => {
    expect(typeof leerDorsal('07').valor).toBe('number')
  })
})

describe('resolverEntradaDorsal (intención explícita)', () => {
  it('vacío sin intención es un error (no se omite sin querer)', () => {
    for (const dorsal of [undefined, null, '', '  ']) {
      expect(resolverEntradaDorsal({ dorsal })).toMatchObject({ tipo: 'error', clave: 'obligatorio' })
      expect(resolverEntradaDorsal({ dorsal, numeroPendiente: false })).toMatchObject({ tipo: 'error', clave: 'obligatorio' })
    }
  })

  it('vacío con la intención explícita es pendiente', () => {
    for (const dorsal of [undefined, null, '', '  ']) {
      expect(resolverEntradaDorsal({ dorsal, numeroPendiente: true })).toEqual({ tipo: 'pendiente' })
    }
  })

  it('un número real se acepta, incluido 0, con o sin numeroPendiente: false', () => {
    expect(resolverEntradaDorsal({ dorsal: 0 })).toEqual(real(0))
    expect(resolverEntradaDorsal({ dorsal: '0', numeroPendiente: false })).toEqual(real(0))
    expect(resolverEntradaDorsal({ dorsal: '07' })).toEqual(real(7))
  })

  it('un número real junto con la intención de dejarlo pendiente es una contradicción', () => {
    expect(resolverEntradaDorsal({ dorsal: 7, numeroPendiente: true })).toMatchObject({ tipo: 'error', clave: 'contradictorio' })
    expect(resolverEntradaDorsal({ dorsal: 0, numeroPendiente: true })).toMatchObject({ tipo: 'error', clave: 'contradictorio' })
    expect(resolverEntradaDorsal({ dorsal: '0', numeroPendiente: true })).toMatchObject({ tipo: 'error', clave: 'contradictorio' })
  })

  it('un valor mal formado es un error aunque haya intención de dejarlo pendiente', () => {
    for (const dorsal of [true, [], {}, NaN, Infinity, -1, 1.5, 100, '7a', 'abc']) {
      expect(resolverEntradaDorsal({ dorsal, numeroPendiente: true })).toMatchObject({ tipo: 'error', clave: 'invalido' })
      expect(resolverEntradaDorsal({ dorsal })).toMatchObject({ tipo: 'error', clave: 'invalido' })
    }
  })

  it('la intención debe ser booleana', () => {
    for (const numeroPendiente of ['true', 1, 0, null, [], {}, 'si']) {
      expect(resolverEntradaDorsal({ dorsal: 7, numeroPendiente })).toMatchObject({ tipo: 'error', clave: 'intencion-invalida' })
      expect(resolverEntradaDorsal({ dorsal: '', numeroPendiente })).toMatchObject({ tipo: 'error', clave: 'intencion-invalida' })
    }
  })

  it('cada error trae su mensaje', () => {
    expect(resolverEntradaDorsal({ dorsal: '' }).mensaje).toBe(MENSAJES_DORSAL.obligatorio)
    expect(resolverEntradaDorsal({ dorsal: 100 }).mensaje).toBe('El número debe ser un entero entre 0 y 99.')
    expect(MENSAJES_DORSAL.obligatorio).toBe('El número es obligatorio.')
  })

  it('sin argumentos tampoco lanza', () => {
    expect(resolverEntradaDorsal()).toMatchObject({ tipo: 'error', clave: 'obligatorio' })
  })
})

describe('dorsalDe, tieneNumero, textoDorsal y etiquetaDorsal', () => {
  it('el 0 es un número real', () => {
    expect(dorsalDe({ dorsal: 0 })).toBe(0)
    expect(tieneNumero({ dorsal: 0 })).toBe(true)
    expect(textoDorsal({ dorsal: 0 })).toBe('0')
    expect(etiquetaDorsal({ dorsal: 0 })).toBe('#0')
  })

  it('ausente, null, texto, NaN, fuera de rango o fracción: no hay número, y se muestra "—"', () => {
    for (const ficha of [{}, { dorsal: undefined }, { dorsal: null }, { dorsal: '' }, { dorsal: '7' }, { dorsal: NaN },
      { dorsal: 150 }, { dorsal: -1 }, { dorsal: 2.5 }, undefined, null]) {
      expect(dorsalDe(ficha)).toBeNull()
      expect(tieneNumero(ficha)).toBe(false)
      expect(textoDorsal(ficha)).toBe('—')
      expect(etiquetaDorsal(ficha)).toBe('—')
    }
  })

  it('nunca produce undefined, NaN ni "#—"', () => {
    for (const ficha of [{}, { dorsal: NaN }, { dorsal: 5 }, { dorsal: 0 }]) {
      for (const t of [textoDorsal(ficha), etiquetaDorsal(ficha)]) {
        expect(t).not.toMatch(/undefined|NaN|#—/)
      }
    }
  })
})

describe('compararPorDorsal', () => {
  const f = (id, dorsal, apellido1 = 'Zeta', nombrePila = 'Ana', extra = {}) => ({ id, dorsal, apellido1, nombrePila, ...extra })

  it('con número de menor a mayor (el 0 antes que el 1) y sin número al final', () => {
    const lista = [f('a', undefined), f('b', 10), f('c', 0), f('d', 1), f('e', null), f('f', 99), f('g', 2)]
    const orden = [...lista].sort(compararPorDorsal).map((x) => x.id)
    expect(orden.slice(0, 5)).toEqual(['c', 'd', 'g', 'b', 'f'])
    expect(new Set(orden.slice(5))).toEqual(new Set(['a', 'e']))
  })

  it('el resultado no depende del orden de entrada: empates por apellido, nombre y id', () => {
    const lista = [
      f('1', 5, 'Pérez', 'Luis'), f('2', 5, 'Perez', 'Ana'), f('3', 5, 'Pérez', 'Luis'),
      f('4', undefined, 'Álvarez', 'Zoe'), f('5', undefined, 'Alvarez', 'Zoe'), f('6', undefined),
      f('7', 0, 'Zeta'), f('8', 3, 'Zeta'),
    ]
    const esperado = [...lista].sort(compararPorDorsal).map((x) => x.id)
    for (let i = 0; i < 50; i += 1) {
      const barajada = [...lista].sort(() => Math.random() - 0.5)
      expect(barajada.sort(compararPorDorsal).map((x) => x.id)).toEqual(esperado)
    }
  })

  it('el apellido se compara sin acentos ni mayúsculas, y el id desempata del todo', () => {
    expect(compararPorDorsal(f('a', 5, 'Álvarez'), f('b', 5, 'alvarez'))).toBeLessThan(0) // mismo texto: decide el id
    expect(compararPorDorsal(f('b', 5, 'Alvarez'), f('a', 5, 'Álvarez'))).toBeGreaterThan(0)
    expect(compararPorDorsal(f('a', 5, 'Álvarez'), f('b', 5, 'Beltrán'))).toBeLessThan(0)
    expect(compararPorDorsal(f('a', 5), f('a', 5))).toBe(0)
  })

  it('usa el nombre completo si faltan las partes estructuradas', () => {
    const x = { id: 'x', dorsal: 4, nombre: 'Carlos Díaz' }
    const y = { id: 'y', dorsal: 4, nombre: 'Ana Zuñiga' }
    expect(compararPorDorsal(x, y)).toBeGreaterThan(0)
  })

  it('es antisimétrico y no modifica sus argumentos', () => {
    const a = Object.freeze(f('a', 3))
    const b = Object.freeze(f('b', undefined))
    expect(Math.sign(compararPorDorsal(a, b))).toBe(-Math.sign(compararPorDorsal(b, a)))
  })
})

describe('dorsal.js es puro', () => {
  const fuente = readFileSync('src/lib/dorsal.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  it('no importa nada ni toca almacenamiento, hora o azar', () => {
    expect(fuente).not.toMatch(/^\s*import\s/m)
    expect(fuente).not.toMatch(/Date\.now|Math\.random|indexedDB|localStorage|fetch\s*\(|\bdb\b/)
  })
})
