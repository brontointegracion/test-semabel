import { describe, expect, it } from 'vitest'
import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, conteos, dentro, ligaSembrada, postComando } from './ayuda.js'
import { sha256Hex } from '../src/credenciales.js'
import { otorgarCredencial, revocarCredencial } from '../src/control.js'

const SOLO_ERROR = { error: 'no-autorizado' }

describe('autorización antes de cualquier recibo', () => {
  it('sin encabezado, token ajeno, token de otro partido o dispositivo distinto → el mismo 401 sin detalle, y no se escribe nada', async () => {
    const { ligaId, P, Q } = await ligaSembrada(nuevaLiga())
    const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await conteos(ligaId, 'P')

    const intentos = [
      await postComando(ligaId, 'P', null, aceptado.sobre), // sin Authorization
      await postComando(ligaId, 'P', 'token-inventado-0123456789', aceptado.sobre),
      await postComando(ligaId, 'P', tokenDe(ligaId, 'Q'), aceptado.sobre), // token válido, pero de OTRO partido
      await postComando(ligaId, 'P', null, aceptado.sobre, { cabeceras: { authorization: 'Basic abc' } }),
    ]
    // dispositivo distinto en el sobre con el token correcto
    intentos.push(await postComando(ligaId, 'P', tokenDe(ligaId, 'P'), { ...aceptado.sobre, deviceId: 'tel-ajeno' }))
    for (const r of intentos) {
      expect(r.status).toBe(401)
      expect(await r.json()).toEqual(SOLO_ERROR) // ni recibo, ni motivo
    }
    expect(await conteos(ligaId, 'P')).toEqual(antes)
    expect(await conteos(ligaId, 'Q')).toMatchObject({ recibos: 0 })
    expect(Q.gameId).toBe('Q')
  })

  it('un reintento ya aceptado NO se responde a quien no está autorizado (la autorización va antes del recibo)', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const a = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const r = await P.enviar(a.sobre, 'token-inventado-0123456789')
    expect(r.status).toBe(401)
    expect(JSON.stringify(await r.json())).not.toContain(a.sobre.cmdId)
    expect((await conteos(ligaId, 'P')).recibos).toBe(1)
  })

  it('una credencial revocada deja de funcionar, también para reintentos ya aceptados', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const a = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const hash = await sha256Hex(tokenDe(ligaId, 'P'))
    await dentro(ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    const r = await P.enviar(a.sobre)
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual(SOLO_ERROR)
    const nuevo = await P.sobre('arrancar-reloj', {}, { t: T0 + 2000 })
    expect((await P.enviar(nuevo)).status).toBe(401)
  })

  it('un solo teléfono con el control por partido; partidos distintos pueden tener su propio teléfono', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    const h2 = await sha256Hex('segundo-token-sintetico-0001')
    await expect(dentro(ligaId, (inst) => otorgarCredencial(inst.almacen, { tokenHash: h2, partidoId: 'P', deviceId: 'tel-2' })))
      .rejects.toThrow('credencial-activa-existente')
    const antes = await dentro(ligaId, (inst) => inst.almacen.sql.exec("SELECT COUNT(*) AS n FROM credenciales WHERE partido_id = 'P'").one().n)
    expect(antes).toBe(1)
    // el índice parcial único también lo impide aunque se salte la función
    await expect(dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "INSERT INTO credenciales (token_hash, partido_id, device_id, revocada) VALUES ('x', 'P', 'tel-3', 0)",
    ).toArray())).rejects.toThrow()
  })

  it('las credenciales se guardan solo como hash', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    const filas = await dentro(ligaId, (inst) => inst.almacen.sql.exec('SELECT token_hash FROM credenciales').toArray())
    for (const f of filas) {
      expect(f.token_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(f.token_hash).not.toContain('tok-sintetico')
    }
  })
})
