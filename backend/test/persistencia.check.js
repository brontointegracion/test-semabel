import { describe, expect, it } from 'vitest'
import { abortAllDurableObjects, evictDurableObject } from 'cloudflare:test'
import { nuevaLiga } from './fixtures/sintetico.js'
import { T0, conteos, dentro, json, leerPartido, ligaSembrada, stubDe } from './ayuda.js'

describe('el estado sobrevive a la expulsión del objeto (reinicio del Durable Object)', () => {
  it('estado, recibos, cursores y bandeja pendiente se conservan; el duplicado devuelve el mismo recibo', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const a = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const b = await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 3 }, { t: T0 + 3000 })
    const antes = await conteos(ligaId, 'P')

    await evictDurableObject(stubDe(ligaId))

    expect(await conteos(ligaId, 'P')).toEqual(antes)
    const pub = await json(await leerPartido(ligaId, 'P'))
    expect(pub).toMatchObject({ rev: 3, estado: 'vivo', local: { puntos: 3 } })
    const dup = await (await P.enviar(b.sobre)).json()
    expect(dup.resultado).toBe('recibo-existente')
    expect(dup.recibo).toEqual(b.cuerpo.recibo)
    expect((await (await P.enviar(a.sobre)).json()).recibo).toEqual(a.cuerpo.recibo)
    const pendientes = await dentro(ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM bandeja WHERE entregado_en IS NULL').one().n)
    expect(pendientes).toBe(3)
    // y se puede seguir jugando con la secuencia correcta
    expect((await P.mandar('falta', { equipoId: 'E2', jugadorId: 'J9' }, { t: T0 + 4000 })).cuerpo.recibo.clientSeq).toBe(4)
  })

  it('abortar todos los objetos tampoco pierde lo confirmado', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await abortAllDurableObjects()
    expect((await conteos(ligaId, 'P'))).toMatchObject({ rev: 1, recibos: 1, bandeja: 1 })
  })
})
