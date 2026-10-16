import { describe, expect, it } from 'vitest'
import { nuevaLiga } from './fixtures/sintetico.js'
import { T0, conteos, dentro, json, leerPartido, ligaSembrada } from './ayuda.js'

const D = { equipoId: 'E1', jugadorId: 'J1' }
// Reversión COMPROBADA: el fallo ocurrió dentro de la transacción y lo observable después es igual a lo de antes.
// Es un fallo conocido de ESTE intento (500), no un rechazo del comando y no un resultado desconocido.
const REVERTIDO = {
  tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento',
  motivo: 'reversion-verificada', reintento: 'mismo-sobre',
}

describe('confirmación todo o nada', () => {
  it('un fallo en el ÚLTIMO paso deshace recibo, cursor, estado, eventos y auditoría; el mismo sobre se resuelve después', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'fallo-inyectado'); END",
    ).toArray())

    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const r = await P.enviar(sobre)
    expect(r.status).toBe(500) // fallo conocido sin escritura de este intento; no es un rechazo definitivo
    const cuerpo = await r.json()
    expect(cuerpo).toEqual(REVERTIDO)
    expect(JSON.stringify(cuerpo)).not.toContain('fallo-inyectado') // no se filtra el error interno
    expect(await conteos(ligaId, 'P')).toEqual({ recibos: 0, eventos: 0, auditoria: 0, bandeja: 0, cuarentena: 0, rev: 0, seq: 0 })
    expect((await json(await leerPartido(ligaId, 'P'))).estado).toBe('programado')

    // El fallo desaparece; se reenvía el MISMO sobre (mismo cmdId): se acepta una sola vez.
    await dentro(ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER fallo_bandeja').toArray())
    const reintento = await (await P.enviar(sobre)).json()
    expect(reintento.resultado).toBe('aceptado')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 1, rev: 1, seq: 1, bandeja: 1 })
    const otra = await (await P.enviar(sobre)).json()
    expect(otra.resultado).toBe('recibo-existente')
    expect(otra.recibo).toEqual(reintento.recibo)
  })

  it('un fallo a mitad (choque de clave en un evento) deshace lo ya escrito en la misma confirmación', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const antes = await conteos(ligaId, 'P')
    const sobre = await P.sobre('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 })
    // Ya existe una fila de evento con el id que el motor va a usar (el cmdId): el INSERT falla
    // DESPUÉS de haber escrito recibo, cursor y estado.
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "INSERT INTO eventos (partido_id, id, seq, json) VALUES ('P', ?, 999, '{}')", sobre.cmdId,
    ).toArray())
    const r = await P.enviar(sobre)
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual(REVERTIDO)
    expect(await conteos(ligaId, 'P')).toEqual({ ...antes, eventos: antes.eventos + 1 }) // solo la fila sembrada a propósito
    const reciboHuerfano = await dentro(ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM recibos WHERE cmd_id = ?', sobre.cmdId).one().n)
    expect(reciboHuerfano).toBe(0)
    expect((await json(await leerPartido(ligaId, 'P'))).local.puntos).toBe(0)
  })

  it('un fallo al guardar el rechazo definitivo tampoco deja el cursor avanzado a medias', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "CREATE TRIGGER fallo_recibo BEFORE UPDATE OF ultimo_client_seq ON partidos BEGIN SELECT RAISE(ABORT, 'fallo-inyectado'); END",
    ).toArray())
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: null })
    expect(r.respuesta.status).toBe(500)
    expect(r.cuerpo).toEqual(REVERTIDO)
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, seq: 0, rev: 0 })
  })

  it('la publicación pendiente queda registrada y NO se declara entregada', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.cuerpo.publicacion).toBe('pendiente')
    const filas = await dentro(ligaId, (inst) => inst.almacen.sql.exec('SELECT rev, cmd_id, entregado_en, mensaje_json FROM bandeja').toArray())
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ rev: 1, cmd_id: r.sobre.cmdId, entregado_en: null })
    expect(JSON.parse(filas[0].mensaje_json)).toMatchObject({ gameId: 'P', rev: 1, cmdId: r.sobre.cmdId })
  })
})
