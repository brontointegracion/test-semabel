import { describe, expect, it, afterEach } from 'vitest'
import { control } from './worker-prueba.js'
import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, conteos, dentro, editarJugador, json, leerPartido, ligaSembrada, sqlDe } from './ayuda.js'
import { sha256Hex } from '../src/credenciales.js'
import { revocarCredencial } from '../src/control.js'

const D = { equipoId: 'E1', jugadorId: 'J1' }
afterEach(() => { control.pausa = null; control.ahoraMs = null })

// El cuerpo se lee de inmediato: el runtime no permite leer después de otras llamadas a objetos distintos.
const leerCuerpo = async (respuesta) => ({ status: respuesta.status, cuerpo: await respuesta.json() })

/** Pausa UNA vez la primera orden que llegue a leerVista y avisa cuando está pausada. */
function pausarUnaVez(esCandidata = () => true) {
  let avisar
  const pausada = new Promise((r) => { avisar = r })
  let liberar
  const hastaLiberar = new Promise((r) => { liberar = r })
  let usada = false
  control.pausa = async (sobre) => {
    if (usada || !esCandidata(sobre)) return
    usada = true
    avisar()
    await hastaLiberar
  }
  return { pausada, liberar }
}

describe('partidos simultáneos y aislamiento entre ligas', () => {
  it('dos partidos de la misma liga anotan a la vez, cada uno con su secuencia y su marcador', async () => {
    const { ligaId, P, Q } = await ligaSembrada(nuevaLiga())
    await Promise.all([P.mandar('iniciar-partido', {}, { t: T0 + 1000 }), Q.mandar('iniciar-partido', {}, { t: T0 + 1000 })])
    await Promise.all([P.mandar('arrancar-reloj', {}, { t: T0 + 2000 }), Q.mandar('arrancar-reloj', {}, { t: T0 + 2000 })])
    // Rondas concurrentes: un toque de P y uno de Q por ronda.
    for (let i = 0; i < 3; i += 1) {
      const [a, b] = await Promise.all([
        P.mandar('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 + i }),
        Q.mandar('anotar', { equipoId: 'E4', jugadorId: 'K2', puntos: 3 }, { t: T0 + 3000 + i }),
      ])
      expect(a.cuerpo.resultado).toBe('aceptado')
      expect(b.cuerpo.resultado).toBe('aceptado')
    }
    const p = await json(await leerPartido(ligaId, 'P'))
    const q = await json(await leerPartido(ligaId, 'Q'))
    expect(p.local.puntos).toBe(6)
    expect(p.visita.puntos).toBe(0)
    expect(q.visita.puntos).toBe(9)
    expect(q.local.puntos).toBe(0)
    expect(await conteos(ligaId, 'P')).toMatchObject({ rev: 5, seq: 5 })
    expect(await conteos(ligaId, 'Q')).toMatchObject({ rev: 5, seq: 5 })
  })

  it('la credencial de un partido no sirve en el otro de la misma liga', async () => {
    const { ligaId, P, Q } = await ligaSembrada(nuevaLiga())
    const sobreQ = await Q.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    expect((await Q.enviar(sobreQ, tokenDe(ligaId, 'P'))).status).toBe(401)
    expect((await conteos(ligaId, 'Q')).recibos).toBe(0)
    expect(P.gameId).toBe('P')
  })

  it('dos ligas con el mismo id de partido no se mezclan, y un token de una no sirve en la otra', async () => {
    const a = await ligaSembrada(nuevaLiga())
    const b = await ligaSembrada(nuevaLiga())
    expect((await a.P.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    expect((await json(await leerPartido(b.ligaId, 'P'))).estado).toBe('programado')
    expect((await b.P.enviar(await b.P.sobre('iniciar-partido', {}, { t: T0 + 1000 }), tokenDe(a.ligaId, 'P'))).status).toBe(401)
    expect((await conteos(b.ligaId, 'P')).recibos).toBe(0)
  })

  it('el mismo sobre enviado dos veces a la vez se confirma una sola vez', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const sobre = await P.sobre('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 })
    const [x, y] = await Promise.all([P.enviar(sobre), P.enviar(sobre)])
    const resultados = [(await x.json()).resultado, (await y.json()).resultado].sort()
    expect(resultados).toEqual(['aceptado', 'recibo-existente'])
    expect(await conteos(ligaId, 'P')).toMatchObject({ eventos: 1, rev: 3 })
  })
})

describe('conflictos entre la lectura y la confirmación', () => {
  it('una edición de plantilla confirmada entre leer y confirmar el inicio NO deja aceptar con la lectura vieja', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 }) // huella V1, partido listo
    const { pausada, liberar } = pausarUnaVez((s) => s.tipo === 'iniciar-partido')
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada // el servidor ya leyó V1 y decidió "aceptado"
    await editarJugador(ligaId, 'J2', { dorsal: 77 }) // se confirma otra huella (V2)
    liberar()
    const { cuerpo } = await envio
    // Se releyó y se volvió a decidir: la huella capturada (V1) ya no es la vigente → rechazo definitivo.
    expect(cuerpo.resultado).toBe('rechazado')
    expect(cuerpo.recibo.motivo).toBe('preparacion-desactualizada')
    expect(await conteos(ligaId, 'P')).toMatchObject({ rev: 0, eventos: 0, bandeja: 0, recibos: 1, seq: 1 })
    expect((await json(await leerPartido(ligaId, 'P'))).estado).toBe('programado')
  })

  it('un cambio de elegibilidad entre leer y confirmar una anotación se detecta (atribución) y no se pisa', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const sobre = await P.sobre('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 }) // atribución V1
    const versionVieja = (await P.estado()).atribucion.version
    const { pausada, liberar } = pausarUnaVez((s) => s.tipo === 'anotar')
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada
    await editarJugador(ligaId, 'J2', { activo: 0 }) // cambia la elegibilidad → atribución V2
    liberar()
    const { cuerpo } = await envio
    expect(cuerpo.resultado).toBe('rechazado')
    expect(cuerpo.recibo.motivo).toBe('atribucion-desactualizada')
    const e = await P.estado()
    expect(e.atribucion.version).not.toBe(versionVieja) // la atribución vigente no fue sobrescrita por la lectura vieja
    expect((await conteos(ligaId, 'P')).eventos).toBe(0)
  })

  it('un lector retrasado del mismo sobre ve el cursor avanzado, relee y devuelve el recibo original (sin segundo evento)', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const sobre = await P.sobre('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 })
    const { pausada, liberar } = pausarUnaVez((s) => s.tipo === 'anotar')
    const lento = P.enviar(sobre).then(leerCuerpo) // lee "sin recibo" y se detiene
    await pausada
    const rapido = await leerCuerpo(await P.enviar(sobre)) // el mismo sobre llega y se confirma
    expect(rapido.cuerpo.resultado).toBe('aceptado')
    liberar()
    const { status, cuerpo } = await lento
    expect(status).toBe(200)
    expect(cuerpo.resultado).toBe('recibo-existente')
    expect(cuerpo.recibo).toEqual(rapido.cuerpo.recibo)
    expect(await conteos(ligaId, 'P')).toMatchObject({ eventos: 1, rev: 3, recibos: 3, bandeja: 3 })
  })

  it('el cursor de secuencia también protege cuando el rechazo definitivo ya se guardó (rev no cambia)', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: null })
    const { pausada, liberar } = pausarUnaVez((s) => s.tipo === 'iniciar-partido')
    const lento = P.enviar(sobre).then(leerCuerpo)
    await pausada
    const rapido = await leerCuerpo(await P.enviar(sobre))
    expect(rapido.cuerpo.resultado).toBe('rechazado')
    liberar()
    const { status, cuerpo } = await lento
    expect(status).toBe(200)
    expect(cuerpo.resultado).toBe('recibo-existente')
    expect(cuerpo.recibo).toEqual(rapido.cuerpo.recibo)
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 1, seq: 1, rev: 0 })
  })

  it('una credencial revocada entre leer y confirmar impide la confirmación', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const hash = await sha256Hex(tokenDe(ligaId, 'P'))
    const { pausada, liberar } = pausarUnaVez()
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada
    await dentro(ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    liberar()
    const r = await envio
    expect(r.status).toBe(401)
    expect(r.cuerpo).toEqual({ error: 'no-autorizado' })
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, rev: 0, seq: 0 })
  })

  it('un bloqueo puesto entre leer y confirmar también obliga a releer', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const { pausada, liberar } = pausarUnaVez()
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada
    await dentro(ligaId, async (inst) => (await import('../src/control.js')).fijarBloqueo(inst.almacen, 'P', { por: 'organizador' }))
    liberar()
    const r = await envio
    expect(r.status).toBe(409)
    expect(r.cuerpo.tipo).toBe('bloqueado')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, rev: 0 })
  })
})
