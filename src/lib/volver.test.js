import { describe, expect, it } from 'vitest'
import { esDestinoInterno, estadoDeEntrada, origenDe, reenviar, pestanaDe } from './volver'

describe('esDestinoInterno', () => {
  it.each([
    '/', '/l/liga-4821', '/l/liga-4821?pestana=calendario', '/e/halcones-1111', '/j/ana-9',
    '/c/cancha-111', '/r/reto-1', '/n/noticia-1', '/cat/futsal/Libre', '/siguiendo', '/figuras', '/noticias',
    // modo compartido (REPORT_158): la liga con su pestaña y la página de un equipo
    '/liga/platinium-u10', '/liga/platinium-u10?pestana=calendario', '/liga/PLATINIUM-U10/equipo/deportivo',
  ])('acepta %s', (r) => expect(esDestinoInterno(r)).toBe(true))

  it.each([
    '//evil.com', '//evil.com/l/x', 'https://evil.com', 'http://localhost/l/x', 'javascript:alert(1)',
    '/\\evil.com', '/\\/evil.com', 'l/liga-1', '', '  /l/x', '/p/a-vs-b-2026-08-20-5680',
    '/p/a-vs-b-5680/consola', '/b/5680', '/ligas', '/nueva', '/l/x/retar', '/l/x/../p/y',
    undefined, null, 5, {}, ['/'],
    '/liga/platinium-u10/partido/cross-level-vs-deportivo-s0rqrd', '/liga/x/equipo/y/z', '/liga/', '/liga/x/../../anthony', '/liga', '/control/a/b', '/anthony/ligas',
  ])('rechaza %j', (r) => expect(esDestinoInterno(r)).toBe(false))
})

describe('estado de entrada y reenvío', () => {
  it('guarda ruta + búsqueda de la pantalla actual', () => {
    expect(estadoDeEntrada({ pathname: '/l/liga-1', search: '?pestana=calendario' }))
      .toEqual({ volverA: '/l/liga-1?pestana=calendario' })
  })
  it('no guarda nada si la pantalla actual no es un destino permitido', () => {
    expect(estadoDeEntrada({ pathname: '/p/a-1234', search: '' })).toBeUndefined()
    expect(estadoDeEntrada({ pathname: '/b/1234', search: '' })).toBeUndefined()
  })
  it('origenDe y reenviar revalidan lo guardado', () => {
    expect(origenDe({ state: { volverA: '/e/x-1' } })).toBe('/e/x-1')
    expect(origenDe({ state: { volverA: '//evil.com' } })).toBeNull()
    expect(origenDe({ state: null })).toBeNull()
    expect(origenDe({})).toBeNull()
    expect(reenviar({ state: { volverA: '/' } })).toEqual({ volverA: '/' })
    expect(reenviar({ state: { volverA: 'https://evil.com' } })).toBeUndefined()
  })
})

describe('estado de entrada en modo compartido', () => {
  it('guarda la liga con su pestaña Calendario y la devuelve validada', () => {
    const e = estadoDeEntrada({ pathname: '/liga/platinium-u10', search: '?pestana=calendario' })
    expect(e).toEqual({ volverA: '/liga/platinium-u10?pestana=calendario' })
    expect(origenDe({ state: e })).toBe('/liga/platinium-u10?pestana=calendario')
  })
  it('un partido público no es origen válido (no hay bucles entre partidos)', () => {
    expect(estadoDeEntrada({ pathname: '/liga/platinium-u10/partido/a-vs-b-abc123', search: '' })).toBeUndefined()
  })
})

describe('pestanaDe', () => {
  it('valida y cae a Posiciones', () => {
    expect(pestanaDe('calendario')).toBe('calendario')
    expect(pestanaDe('jugadores')).toBe('jugadores')
    expect(pestanaDe('tabla')).toBe('tabla')
    expect(pestanaDe('otra')).toBe('tabla')
    expect(pestanaDe(null)).toBe('tabla')
  })
})
