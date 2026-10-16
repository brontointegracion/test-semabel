import { describe, expect, it } from 'vitest'
import { claveEquipo, clavesRepetidas, resolverEquipo } from './claves.js'

const L = 'PLATINIUM-U10'
const eq = (...ids) => ids.map((id) => ({ id, nombre: id }))

describe('claveEquipo', () => {
  it('quita el prefijo de la liga; sin prefijo, la clave es el id completo', () => {
    expect(claveEquipo(L, 'PLATINIUM-U10-DEPORTIVO')).toBe('DEPORTIVO')
    expect(claveEquipo(L, 'PLATINIUM-U10-HARDWORK-BASKETBALL')).toBe('HARDWORK-BASKETBALL')
    expect(claveEquipo(L, 'E1')).toBe('E1')
    expect(claveEquipo(L, 'PLATINIUM-U10-')).toBe('PLATINIUM-U10-') // nada que quitar
  })
  it('con la lista de la liga, una clave que chocaría con otro equipo se sustituye por el id completo', () => {
    const ids = ['PLATINIUM-U10-VIP', 'VIP', 'PLATINIUM-U10-OTRO']
    expect(claveEquipo(L, 'PLATINIUM-U10-VIP', ids)).toBe('PLATINIUM-U10-VIP')
    expect(claveEquipo(L, 'PLATINIUM-U10-OTRO', ids)).toBe('OTRO')
  })
})

describe('resolverEquipo', () => {
  const lista = eq('PLATINIUM-U10-DEPORTIVO', 'PLATINIUM-U10-VIP', 'PLATINIUM-U10-HARDWORK-BASKETBALL')
  it('clave exacta, id completo y clave sin distinguir mayúsculas', () => {
    expect(resolverEquipo(L, lista, 'DEPORTIVO')).toEqual({ ok: true, equipoId: 'PLATINIUM-U10-DEPORTIVO' })
    expect(resolverEquipo(L, lista, 'PLATINIUM-U10-VIP')).toEqual({ ok: true, equipoId: 'PLATINIUM-U10-VIP' })
    expect(resolverEquipo(L, lista, 'hardwork-basketball')).toEqual({ ok: true, equipoId: 'PLATINIUM-U10-HARDWORK-BASKETBALL' })
  })
  it('desconocida: nunca adivina (ni por prefijo ni por subcadena)', () => {
    for (const p of ['DEPORT', 'XYZ', 'PLATINIUM-U10', '', 'DEPORTIVO/']) expect(resolverEquipo(L, lista, p)).toEqual({ ok: false, motivo: 'desconocido' })
    expect(resolverEquipo(L, [], 'DEPORTIVO')).toEqual({ ok: false, motivo: 'desconocido' })
    expect(resolverEquipo(L, null, 'DEPORTIVO')).toEqual({ ok: false, motivo: 'desconocido' })
  })
  it('ambigua: varias coincidencias en el mismo paso → no elige', () => {
    expect(resolverEquipo(L, eq('PLATINIUM-U10-Deportivo', 'PLATINIUM-U10-DEPORTIVO'), 'deportivo')).toEqual({ ok: false, motivo: 'ambiguo' })
    // el id completo de un equipo tiene prioridad: no se vuelve ambiguo por la clave de otro
    expect(resolverEquipo(L, eq('VIP', 'PLATINIUM-U10-VIP'), 'VIP')).toEqual({ ok: true, equipoId: 'VIP' })
    expect(resolverEquipo(L, eq('VIP', 'PLATINIUM-U10-VIP'), 'PLATINIUM-U10-VIP')).toEqual({ ok: true, equipoId: 'PLATINIUM-U10-VIP' })
  })
  it('claves repetidas de una liga se detectan', () => {
    expect(clavesRepetidas(L, lista)).toEqual([])
    expect(clavesRepetidas(L, eq('PLATINIUM-U10-VIP', 'VIP'))).toEqual(['VIP'])
  })
})
