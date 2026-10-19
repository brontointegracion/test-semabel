import { describe, expect, it } from 'vitest'
import {
  ALIAS_PILOTO, RUTA_ACCESO, RUTA_PANEL, destinoDeRetorno, esRutaOrganizador, rutaActivacion, rutaCanonicaDeLegado, rutaEquipo, rutaLiga, rutaPartido,
} from './rutas-organizador'

describe('direcciones canónicas del organizador', () => {
  it('son las pedidas y no cambian los identificadores', () => {
    expect(RUTA_ACCESO).toBe('/organizador/acceso')
    expect(RUTA_PANEL).toBe('/organizador')
    expect(rutaLiga('LIGA-U10')).toBe('/organizador/ligas/LIGA-U10')
    expect(rutaEquipo('LIGA-U10', 'E1')).toBe('/organizador/ligas/LIGA-U10/equipos/E1')
    expect(rutaPartido('LIGA-U10', 'g-1')).toBe('/organizador/ligas/LIGA-U10/partidos/g-1')
    expect(rutaActivacion('LIGA-U10', 'g-1')).toBe('/control/LIGA-U10/g-1') // la activación, no la consola
    for (const r of [RUTA_ACCESO, RUTA_PANEL, rutaLiga('a'), rutaEquipo('a', 'b'), rutaPartido('a', 'b')]) expect(esRutaOrganizador(r)).toBe(true)
    expect(esRutaOrganizador('/organizadorx')).toBe(false)
    expect(esRutaOrganizador('/anthony/ligas')).toBe(false)
  })
})

describe('rutaCanonicaDeLegado', () => {
  it.each([
    ['/anthony', '/organizador/acceso'],
    ['/anthony/', '/organizador/acceso'],
    ['/anthony/access', '/organizador/acceso'],
    ['/anthony/ligas', '/organizador'],
    ['/ligas', '/organizador'],
    ['/anthony/ligas/L1', '/organizador/ligas/L1'],
    ['/anthony/ligas/L1/equipos/E1', '/organizador/ligas/L1/equipos/E1'],
    ['/anthony/ligas/L1/partidos/g-1', '/organizador/ligas/L1/partidos/g-1'],
    ['/anthony/otra-cosa', '/organizador'],
    ['/deportivo-vip/ligas', '/organizador'],
    ['/deportivo-vip/ligas/', '/organizador'],
  ])('%s → %s', (de, a) => expect(rutaCanonicaDeLegado(de)).toBe(a))
  it('lo que no es antiguo no se redirige (sin bucles): canónicas, públicas y control → null', () => {
    for (const r of ['/organizador', '/organizador/acceso', '/organizador/ligas/L1', '/', '/liga/x', '/control/a/b', '/ligaz', undefined, 7]) expect(rutaCanonicaDeLegado(r), String(r)).toBeNull()
  })
  it('nunca devuelve una dirección antigua', () => {
    for (const r of ['/anthony', '/anthony/access', '/anthony/ligas', '/anthony/ligas/L/equipos/E', '/anthony/x/y', '/ligas']) expect(rutaCanonicaDeLegado(r)).toMatch(/^\/organizador/)
  })
})

describe('alias de entrada del piloto', () => {
  it('es una lista cerrada y escrita a mano: solo /deportivo-vip/ligas, sin identificadores de ligas ni comodines', () => {
    expect(ALIAS_PILOTO).toEqual(['/deportivo-vip/ligas'])
    for (const a of ALIAS_PILOTO) expect(a).toMatch(/^\/[a-z0-9-]+\/ligas$/)
  })
  it('no se amplía a otros nombres: ni /otro/ligas, ni /deportivo-vip, ni /deportivo-vip/ligas/x se redirigen', () => {
    for (const r of ['/otro/ligas', '/deportivo-vip', '/deportivo-vip/ligas/LIGA-U10', '/deportivo-vip/x', '/deportivo-vipx/ligas']) expect(rutaCanonicaDeLegado(r), r).toBeNull()
  })
  it('un destino de retorno con el alias se traduce a /organizador (nunca se conserva el alias)', () => {
    expect(destinoDeRetorno('/deportivo-vip/ligas')).toBe('/organizador')
    expect(destinoDeRetorno('/deportivo-vip/ligas?x=1')).toBe('/organizador?x=1')
  })
})

describe('destinoDeRetorno', () => {
  it('acepta canónicas y antiguas (traducidas) conservando la búsqueda y el fragmento', () => {
    expect(destinoDeRetorno('/organizador/ligas/L1?a=1#x')).toBe('/organizador/ligas/L1?a=1#x')
    expect(destinoDeRetorno('/anthony/ligas/L1/equipos/E1?pestana=2')).toBe('/organizador/ligas/L1/equipos/E1?pestana=2')
    expect(destinoDeRetorno('/anthony/ligas?x=1')).toBe('/organizador?x=1')
    expect(destinoDeRetorno('/organizador')).toBe('/organizador')
  })
  it('rechaza la propia entrada (bucle), destinos externos, esquemas y basura', () => {
    for (const d of ['/organizador/acceso', '/organizador/acceso?x=1', '/anthony/access', '/anthony', 'https://evil.example/', '//evil.example', 'javascript:alert(1)', '/liga/x/partido/y', '/control/a/b', '/organizador/ligas/\\x', '/organizador\n', '', null, undefined, 3]) {
      expect(destinoDeRetorno(d), String(d)).toBeNull()
    }
  })
})
