import { describe, expect, it } from 'vitest'
import { claveEquipoPublica, claveJuego, claveLiga, enlacesDePartidos, resolverJuego, resolverLiga, sufijoPartido } from './urls.js'

// Direcciones públicas amigables (REPORT_158). Datos SINTÉTICOS con la forma de los ids reales; ninguna lectura de red.

const LIGA = 'PLATINIUM-U10'
const G1 = 'PLATINIUM-U10-20261024-CROSS-LEVEL-VS-DEPORTIVO'
const G2 = 'PLATINIUM-U10-20261024-WEST-HORNETS-VS-VIP'
// Dos ids distintos con el MISMO sufijo (hallados por búsqueda; sirven para probar la colisión).
const C1 = 'COL-60792'
const C2 = 'COL-75646'

describe('liga', () => {
  it('la clave pública es el id en minúsculas; los ids internos no cambian', () => {
    expect(claveLiga('PLATINIUM-U10')).toBe('platinium-u10')
    expect(claveLiga('PLATINIUM-U10', ['PLATINIUM-U10', 'PLATINIUM-U12'])).toBe('platinium-u10')
  })
  it('si dos ids solo difieren por mayúsculas usa el id exacto (no elige uno)', () => {
    expect(claveLiga('Liga-A', ['Liga-A', 'LIGA-A'])).toBe('Liga-A')
    expect(resolverLiga(['Liga-A', 'LIGA-A'], 'liga-a')).toEqual({ ok: false, motivo: 'ambiguo' })
    expect(resolverLiga(['Liga-A', 'LIGA-A'], 'LIGA-A')).toEqual({ ok: true, ligaId: 'LIGA-A' })
  })
  it('resuelve minúsculas, el id original y rechaza lo desconocido', () => {
    const ids = ['PLATINIUM-U10', 'PLATINIUM-U12']
    expect(resolverLiga(ids, 'platinium-u10')).toEqual({ ok: true, ligaId: 'PLATINIUM-U10' })
    expect(resolverLiga(ids, 'PLATINIUM-U12')).toEqual({ ok: true, ligaId: 'PLATINIUM-U12' })
    for (const p of ['platinium-u1', 'otra', '', undefined, null]) expect(resolverLiga(ids, p)).toEqual({ ok: false, motivo: 'desconocido' })
  })
})

describe('equipo', () => {
  const ids = ['PLATINIUM-U10-DEPORTIVO', 'PLATINIUM-U10-HARDWORK-BASKETBALL']
  it('clave en minúsculas, sin el prefijo de la liga', () => {
    expect(claveEquipoPublica(LIGA, 'PLATINIUM-U10-DEPORTIVO', ids)).toBe('deportivo')
    expect(claveEquipoPublica(LIGA, 'PLATINIUM-U10-HARDWORK-BASKETBALL', ids)).toBe('hardwork-basketball')
  })
  it('si dos equipos solo difieren por mayúsculas, ambos usan su id completo exacto', () => {
    const dos = ['PLATINIUM-U10-Vip', 'PLATINIUM-U10-VIP']
    expect(claveEquipoPublica(LIGA, dos[0], dos)).toBe(dos[0])
    expect(claveEquipoPublica(LIGA, dos[1], dos)).toBe(dos[1])
  })
})

describe('sufijo del partido', () => {
  it('son 6 caracteres [0-9a-z], deterministas y distintos para ids distintos', () => {
    expect(sufijoPartido(G1)).toMatch(/^[0-9a-z]{6}$/)
    expect(sufijoPartido(G1)).toBe(sufijoPartido(G1))
    expect(sufijoPartido(G1)).not.toBe(sufijoPartido(G2))
    expect(sufijoPartido(G1)).toBe('s0rqrd') // valor fijado: cambiarlo rompería los enlaces ya compartidos
  })
  it('no depende de la hora programada, del orden de la lista ni de los nombres', () => {
    const lectura = (programadoPara, orden) => {
      const partidos = [
        { gameId: G1, programadoPara, local: { id: 'A' }, visita: { id: 'B' } },
        { gameId: G2, programadoPara: '2026-10-24T16:50:00.000Z', local: { id: 'C' }, visita: { id: 'D' } },
      ]
      return enlacesDePartidos({ liga: { id: LIGA }, equipos: [{ id: 'A', nombre: 'Cross Level' }, { id: 'B', nombre: 'Deportivo' }, { id: 'C', nombre: 'West Hornets' }, { id: 'D', nombre: 'VIP' }], partidos: orden ? partidos.reverse() : partidos })
    }
    const base = lectura('2026-10-24T14:00:00.000Z', false)
    expect(lectura('2026-12-31T23:59:00.000Z', false).get(G1)).toBe(base.get(G1)) // se movió la hora
    expect(lectura(null, false).get(G1)).toBe(base.get(G1)) // se quitó la hora
    expect(lectura('2026-10-24T14:00:00.000Z', true).get(G1)).toBe(base.get(G1)) // otro orden
    expect(base.get(G1)).toBe('/liga/platinium-u10/partido/cross-level-vs-deportivo-s0rqrd')
    expect(base.get(G2)).toBe('/liga/platinium-u10/partido/west-hornets-vs-vip-7m21xa')
  })
  it('la dirección nunca lleva la fecha y cabe en 64 caracteres aun con nombres largos', () => {
    expect(claveJuego(G1, { local: 'Cross Level', visita: 'Deportivo' })).not.toMatch(/2026|1024/)
    const larga = claveJuego(G1, { local: 'Un equipo con un nombre larguísimo de verdad', visita: 'Otro equipo con un nombre también larguísimo' })
    expect(larga.length).toBeLessThanOrEqual(64)
    expect(larga).toMatch(/-s0rqrd$/)
    expect(claveJuego(G1, { local: '', visita: '' })).toBe('partido-s0rqrd')
  })
})

describe('resolverJuego', () => {
  const partidos = [{ gameId: G1 }, { gameId: G2 }]
  it('el nombre-sufijo canónico, el id completo (legacy) y el id en minúsculas abren el mismo partido', () => {
    for (const p of ['cross-level-vs-deportivo-s0rqrd', G1, G1.toLowerCase()]) expect(resolverJuego(partidos, p)).toEqual({ ok: true, gameId: G1 })
  })
  it('el sufijo es la identidad: un equipo renombrado (nombre distinto, mismo sufijo) sigue encontrando el partido', () => {
    expect(resolverJuego(partidos, 'otro-nombre-vs-nuevo-s0rqrd')).toEqual({ ok: true, gameId: G1 })
  })
  it('desconocido: sufijo que no existe, texto sin sufijo, vacío o lista inválida', () => {
    for (const p of ['cross-level-vs-deportivo-zzzzzz', 'cross-level', 's0rqrd', '', 'a%20b', undefined]) expect(resolverJuego(partidos, p)).toEqual({ ok: false, motivo: 'desconocido' })
    expect(resolverJuego(null, G1)).toEqual({ ok: false, motivo: 'desconocido' })
  })
  it('sufijo repetido en la liga: ambiguo (nunca elige uno) y los enlaces generados usan el id completo', () => {
    expect(sufijoPartido(C1)).toBe(sufijoPartido(C2))
    const dos = [{ gameId: C1 }, { gameId: C2 }]
    expect(resolverJuego(dos, `a-vs-b-${sufijoPartido(C1)}`)).toEqual({ ok: false, motivo: 'ambiguo' })
    expect(resolverJuego(dos, C1)).toEqual({ ok: true, gameId: C1 }) // el id completo sí es exacto
    expect(claveJuego(C1, { local: 'A', visita: 'B' }, dos)).toBe(C1)
    expect(claveJuego(C2, { local: 'A', visita: 'B' }, dos)).toBe(C2)
  })
  it('ida y vuelta: toda dirección generada resuelve a su propio partido', () => {
    const datos = { liga: { id: LIGA }, equipos: [{ id: 'A', nombre: 'Uno' }, { id: 'B', nombre: 'Dos' }], partidos: [C1, C2, G1, G2].map((gameId) => ({ gameId, local: { id: 'A' }, visita: { id: 'B' } })) }
    for (const [gameId, ruta] of enlacesDePartidos(datos)) expect(resolverJuego(datos.partidos, ruta.split('/partido/')[1])).toEqual({ ok: true, gameId })
  })
})
