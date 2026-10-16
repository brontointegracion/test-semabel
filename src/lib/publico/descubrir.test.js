import { describe, expect, it } from 'vitest'
import { construirDescubrir } from './descubrir.js'
import { partidoLiga, respuestaLiga } from './datos-prueba.js'

const listo = (datos) => ({ fase: 'listo', datos })
const cargando = { fase: 'cargando', datos: null }
const fallo = { fase: 'sin-datos', datos: null, error: { tipo: 'x' } }

describe('construirDescubrir', () => {
  it('fases: cargando, error, parcial y ok', () => {
    const l1 = respuestaLiga({ id: 'A' })
    expect(construirDescubrir({ ids: ['A'], estados: [cargando], pais: 'PA' }).fase).toBe('cargando')
    expect(construirDescubrir({ ids: ['A'], estados: [fallo], pais: 'PA' }).fase).toBe('error')
    expect(construirDescubrir({ ids: ['A', 'B'], estados: [listo(l1), fallo], pais: 'PA' })).toMatchObject({ fase: 'parcial', fallidas: ['B'] })
    expect(construirDescubrir({ ids: ['A', 'B'], estados: [listo(l1), cargando], pais: 'PA' }).fase).toBe('parcial')
    expect(construirDescubrir({ ids: ['A'], estados: [listo(l1)], pais: 'PA' }).fase).toBe('ok')
  })

  it('ligas, equipos y partidos salen SOLO de la lectura; el país es el del piloto; nada de provincia, organizador ni canchas', () => {
    const a = respuestaLiga({ id: 'A', nombre: 'Liga A', partidos: [partidoLiga({ gameId: 'G1' })] })
    const d = construirDescubrir({ ids: ['A'], estados: [listo(a)], pais: 'PA' })
    expect(d.ligas).toEqual([{ id: 'A', codigo: 'A', nombre: 'Liga A', deporte: 'baloncesto', categoria: 'mini-basketball', pais: 'PA', clasificacion: 'Mini baloncesto · U10' }])
    expect(d.ligas[0]).not.toHaveProperty('provincia')
    expect(d.ligas[0]).not.toHaveProperty('organizador')
    expect(d.equipos.map((e) => [e.ligaId, e.id])).toEqual([['A', 'E1'], ['A', 'E2'], ['A', 'E3'], ['A', 'E4']])
    expect(d.idsPorLiga.A).toEqual(['E1', 'E2', 'E3', 'E4'])
    expect(d.partidos.map((p) => [p.ligaId, p.gameId, p.local.nombre])).toEqual([['A', 'G1', 'Alfa Norte']])
  })

  it('sin lecturas cargadas no hay ligas ni partidos (nunca datos de otra parte)', () => {
    const d = construirDescubrir({ ids: ['A'], estados: [cargando], pais: 'PA' })
    expect([d.ligas, d.equipos, d.partidos]).toEqual([[], [], []])
  })
})
