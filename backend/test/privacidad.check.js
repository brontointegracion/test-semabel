import { describe, expect, it } from 'vitest'
import { CAMPOS_PUBLICOS } from '../src/proyeccion-publica.js'
import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, json, leerPartido, ligaSembrada } from './ayuda.js'

const claves = (o) => Object.keys(o).sort()

describe('lectura pública: solo campos aprobados', () => {
  it('las claves son exactamente la lista blanca, antes y después de jugar', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const comprobar = (c) => {
      expect(claves(c)).toEqual([...CAMPOS_PUBLICOS.raiz].sort())
      expect(claves(c.liga)).toEqual([...CAMPOS_PUBLICOS.liga].sort())
      expect(claves(c.reloj)).toEqual([...CAMPOS_PUBLICOS.reloj].sort())
      expect(claves(c.local)).toEqual([...CAMPOS_PUBLICOS.equipo].sort())
      expect(claves(c.visita)).toEqual([...CAMPOS_PUBLICOS.equipo].sort())
    }
    comprobar(await json(await leerPartido(ligaId, 'P')))
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: T0 + 3000 })
    comprobar(await json(await leerPartido(ligaId, 'P')))
  })

  it('no aparece ninguna credencial, hash, dispositivo, recibo, persona, jugador, número ni contexto interno', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const a = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: T0 + 3000 })
    const r = await leerPartido(ligaId, 'P')
    const texto = await r.text()
    const prohibidos = [
      tokenDe(ligaId, 'P'), tokenDe(ligaId, 'Q'), 'tok-sintetico', 'semilla-sintetica',
      'tel-P', 'actor-P', 'deviceId', 'persona', 'J1', 'J2', 'Beto', 'Eva',
      'recibo', 'cmdId', a.sobre.cmdId, 'atribucion', 'preparacion', 'token_hash', 'clientSeq', 'bandeja',
    ]
    for (const p of prohibidos) expect(texto, `contiene «${p}»`).not.toContain(p)
    // REPORT_191: la ÚNICA información de jugador es el nombre público y el número de la canasta confirmada, dentro de `anotaciones`.
    const cuerpo = JSON.parse(texto)
    expect(cuerpo.anotaciones).toEqual([{ seq: 1, lado: 'local', puntos: 2, jugador: { nombre: 'Ana Pérez', dorsalActual: 0 } }])
    const { anotaciones, ...resto } = cuerpo
    for (const p of ['Ana', 'dorsal', 'jugador']) expect(JSON.stringify(resto), `fuera de anotaciones: «${p}»`).not.toContain(p)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('la lectura no necesita credencial y no cambia nada', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    const uno = await (await leerPartido(ligaId, 'P')).json()
    const dos = await (await leerPartido(ligaId, 'P')).json()
    expect({ ...uno, servidorAhoraMs: 0 }).toEqual({ ...dos, servidorAhoraMs: 0 })
  })
})
