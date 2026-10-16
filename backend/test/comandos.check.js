import { describe, expect, it } from 'vitest'
import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, conteos, dentro, editarJugador, leerPartido, ligaSembrada, postComando, json } from './ayuda.js'

const D = { equipoId: 'E1', jugadorId: 'J1' }

describe('comando aceptado y duplicado', () => {
  it('un comando autorizado se confirma y la lectura pública lo muestra', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const inicio = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(inicio.respuesta.status).toBe(200)
    expect(inicio.cuerpo).toMatchObject({ resultado: 'aceptado', publicacion: 'pendiente' })
    expect(inicio.cuerpo.recibo).toMatchObject({ gameId: 'P', deviceId: 'tel-P', clientSeq: 1, resultado: 'aceptado', revDespues: 1 })

    expect((await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })).cuerpo.resultado).toBe('aceptado')
    expect((await P.mandar('anotar', { ...D, puntos: 3 }, { t: T0 + 3000 })).cuerpo.resultado).toBe('aceptado')
    expect((await P.mandar('falta', { equipoId: 'E2', jugadorId: 'J9' }, { t: T0 + 4000 })).cuerpo.resultado).toBe('aceptado')

    const pub = await json(await leerPartido(ligaId, 'P'))
    expect(pub).toMatchObject({
      rev: 4, estado: 'vivo', periodo: 1, reloj: { estado: 'corriendo' },
      local: { puntos: 3, faltas: 0 }, visita: { puntos: 0, faltas: 1 },
    })
    // Lo confirmado deja: un recibo, un evento y una fila de bandeja por orden aceptada.
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 4, eventos: 2, bandeja: 4, rev: 4, seq: 4 })
  })

  it('un duplicado (mismo sobre) devuelve el recibo original y no vuelve a confirmar', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const a = await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const antes = await conteos(ligaId, 'P')
    const b = await P.enviar(a.sobre)
    const cuerpo = await b.json()
    expect(b.status).toBe(200)
    expect(cuerpo.resultado).toBe('recibo-existente')
    expect(cuerpo.recibo).toEqual(a.cuerpo.recibo)
    expect(await conteos(ligaId, 'P')).toEqual(antes)
  })

  it('el mismo cmdId con contenido distinto es un conflicto y no repite ningún recibo', async () => {
    const { P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const a = await P.mandar('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 })
    const distinto = { ...a.sobre, datos: { ...a.sobre.datos, puntos: 3 } }
    const r = await P.enviar(distinto)
    expect(r.status).toBe(409)
    expect((await r.json()).tipo).toBe('conflicto-contenido')
  })

  it('hueco y secuencia ocupada no guardan nada', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const hueco = await P.mandar('iniciar-partido', {}, { t: T0 + 1000, seq: 5 })
    expect(hueco.respuesta.status).toBe(409)
    expect(hueco.cuerpo).toEqual({ tipo: 'hueco', esperado: 1 })
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, rev: 0, seq: 0 })
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const ocupada = await P.mandar('arrancar-reloj', {}, { t: T0 + 2000, seq: 1 })
    expect(ocupada.respuesta.status).toBe(409)
    expect(ocupada.cuerpo.tipo).toBe('secuencia-ocupada')
  })

  it('un bloqueo del organizador detiene las órdenes nuevas sin guardar recibo', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, async (inst) => {
      const { fijarBloqueo } = await import('../src/control.js')
      fijarBloqueo(inst.almacen, 'P', { por: 'organizador', motivo: 'prueba' })
    })
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.respuesta.status).toBe(409)
    expect(r.cuerpo).toEqual({ tipo: 'bloqueado' }) // el motivo del bloqueo no se publica
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, cuarentena: 1 })
  })
})

describe('inicio inicial: huella de preparación', () => {
  it('un reintento ya aceptado devuelve su recibo aunque la plantilla cambie después', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const inicio = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(inicio.cuerpo.resultado).toBe('aceptado')
    await editarJugador(ligaId, 'J2', { dorsal: 55 }) // cambia la huella de preparación
    const reintento = await (await P.enviar(inicio.sobre)).json()
    expect(reintento.resultado).toBe('recibo-existente')
    expect(reintento.recibo).toEqual(inicio.cuerpo.recibo)
  })

  it('un inicio con huella desactualizada es un rechazo DEFINITIVO: guarda recibo, consume la secuencia y se repite igual', async () => {
    const { ligaId, Q } = await ligaSembrada(nuevaLiga())
    const vieja = (await Q.preparacion()).version
    await editarJugador(ligaId, 'K1', { dorsal: 44 })
    const sobre = await Q.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: vieja })
    const r = await Q.enviar(sobre)
    const cuerpo = await r.json()
    expect(r.status).toBe(200) // definitivo, no incierto
    expect(cuerpo.resultado).toBe('rechazado')
    expect(cuerpo.recibo.motivo).toBe('preparacion-desactualizada')
    expect(cuerpo.recibo.detalle.versionServidor).toBe((await Q.preparacion()).version)
    expect(await conteos(ligaId, 'Q')).toMatchObject({ recibos: 1, seq: 1, rev: 0, eventos: 0, bandeja: 0 })

    const repetido = await (await Q.enviar(sobre)).json()
    expect(repetido.resultado).toBe('recibo-existente')
    expect(repetido.recibo).toEqual(cuerpo.recibo)

    // Recuperación aprobada: releer, confirmar y un cmdId NUEVO con la huella vigente.
    const nuevo = await Q.mandar('iniciar-partido', {}, { t: T0 + 2000 })
    expect(nuevo.sobre.cmdId).not.toBe(sobre.cmdId)
    expect(nuevo.cuerpo.resultado).toBe('aceptado')
    expect(nuevo.cuerpo.recibo.clientSeq).toBe(2)
  })

  it('sin huella capturada el inicio nuevo se rechaza de forma definitiva', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: null })
    expect(r.cuerpo).toMatchObject({ resultado: 'rechazado' })
    expect(r.cuerpo.recibo.motivo).toBe('preparacion-version-ausente')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 1, seq: 1, rev: 0 })
  })

  it('plantilla incompleta: rechazo definitivo con su motivo', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await editarJugador(ligaId, 'J2', { dorsal: null })
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.cuerpo.resultado).toBe('rechazado')
    expect(r.cuerpo.recibo.motivo).toBe('plantilla-incompleta')
  })

  it('un cambio que no afecta la preparación (el nombre) no cambia la huella ni causa rechazo', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const antes = (await P.preparacion()).version
    await editarJugador(ligaId, 'J1', { nombre: 'Otro Nombre' })
    expect((await P.preparacion()).version).toBe(antes)
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: antes })
    expect((await (await P.enviar(sobre)).json()).resultado).toBe('aceptado')
  })
})

describe('forma de la petición', () => {
  it('JSON inválido, cuerpo grande, sobre que no es objeto, partido distinto y método incorrecto', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const tok = tokenDe(ligaId, 'P')
    expect((await postComando(ligaId, 'P', tok, null, { crudo: '{no es json' })).status).toBe(400)
    expect((await postComando(ligaId, 'P', tok, null, { crudo: JSON.stringify({ x: 'a'.repeat(70 * 1024) }) })).status).toBe(413)
    expect((await postComando(ligaId, 'P', tok, [1, 2])).status).toBe(422)
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    expect((await postComando(ligaId, 'Q', tok, sobre)).status).toBe(400) // dirección ≠ sobre.gameId
    const invalido = await postComando(ligaId, 'P', tok, { ...sobre, campoRaro: 1 })
    expect(invalido.status).toBe(422)
    expect((await invalido.json()).errores).toContain('campo-desconocido:campoRaro')
    const { exports } = await import('cloudflare:workers')
    const get = await exports.default.fetch(new Request(`https://x/v1/ligas/${ligaId}/partidos/P/comandos`))
    expect(get.status).toBe(405)
  })
})
