import { describe, expect, it } from 'vitest'
import { ejecutar } from './orquestador'
import { procesar } from './procesador'
import { construirSobre } from './reglas'
import { crearAdaptadorMemoria } from './prueba/adaptador-memoria'
import { crearBanco, estadoDePrueba, T0 } from './prueba/banco'

// ---------------------------------------------------------------------------
// M1: la identidad (partido y dispositivo) la decide el adaptador con la
// credencial del transporte, nunca un campo del sobre. Ninguna prueba usa
// secretos reales: las credenciales son textos de prueba.
// ---------------------------------------------------------------------------

const D = { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }

function sobreDe(estado, deviceId, cmdId = 'c1', seq = 1) {
  return construirSobre(estado, { cmdId, tipo: 'anotar', datos: D, tiempo: { accionTs: T0 } }, { deviceId, clientSeq: seq })
}

const dosPartidos = () => {
  const estadoA = estadoDePrueba({ gameId: 'A' })
  const estadoB = estadoDePrueba({ gameId: 'B' })
  const adaptadorA = crearAdaptadorMemoria({
    estado: estadoA, credenciales: { 'cred-A': { gameId: 'A', deviceId: 'tel-A', actorId: 'ana' } },
  })
  const adaptadorB = crearAdaptadorMemoria({
    estado: estadoB, credenciales: { 'cred-B': { gameId: 'B', deviceId: 'tel-B', actorId: 'beto' } },
  })
  return { estadoA, estadoB, adaptadorA, adaptadorB }
}

const intacto = (adaptador, antes) => {
  expect(adaptador.foto()).toEqual(antes)
  expect(adaptador.cuarentena()).toEqual([])
}

describe('el partido de la credencial', () => {
  it('la credencial del partido A no puede actuar sobre el partido B', async () => {
    const { estadoB, adaptadorA, adaptadorB } = dosPartidos()
    const antes = adaptadorB.foto()
    const sobreB = sobreDe(estadoB, 'tel-B')

    // El adaptador de B no conoce la credencial de A.
    const r = await ejecutar(adaptadorB, sobreB, { recibidoEn: T0, credencial: 'cred-A' })
    expect(r).toMatchObject({ tipo: 'no-autorizado', motivo: 'credencial-invalida' })
    intacto(adaptadorB, antes)

    // Y la de A, usada para pedir el partido B, tampoco sirve en A.
    const antesA = adaptadorA.foto()
    const r2 = await ejecutar(adaptadorA, sobreB, { recibidoEn: T0, credencial: 'cred-A' })
    expect(r2).toMatchObject({ tipo: 'no-autorizado', motivo: 'juego-distinto' })
    intacto(adaptadorA, antesA)
  })

  it('una credencial compartida entre partidos (adaptador descuidado) sigue ligada al suyo', async () => {
    const { estadoB, adaptadorB } = dosPartidos()
    adaptadorB.otorgar('cred-A', { gameId: 'A', deviceId: 'tel-A', actorId: 'ana' })
    const antes = adaptadorB.foto()
    const r = await ejecutar(adaptadorB, sobreDe(estadoB, 'tel-A'), { recibidoEn: T0, credencial: 'cred-A' })
    expect(r).toMatchObject({ tipo: 'no-autorizado', motivo: 'juego-distinto' })
    intacto(adaptadorB, antes)
  })

  it('el orquestador no confía en un adaptador que autoriza pero devuelve otra identidad', async () => {
    const estado = estadoDePrueba({ gameId: 'P' })
    const base = crearAdaptadorMemoria({ estado })
    const antes = base.foto()
    const indulgente = (identidad) => ({
      ...base,
      transaccion: (gameId, fn) => base.transaccion(gameId, (tx) => fn({
        ...tx, autorizar: async () => ({ autorizado: true, version: 0, actorId: 'x', ...identidad }),
      })),
    })
    const sobre = sobreDe(estado, 'tel-A')
    expect(await ejecutar(indulgente({ gameId: 'Z', deviceId: 'tel-A' }), sobre, { recibidoEn: T0, credencial: 'c' }))
      .toMatchObject({ tipo: 'no-autorizado', motivo: 'juego-distinto' })
    expect(await ejecutar(indulgente({ gameId: 'P', deviceId: 'tel-OTRO' }), sobre, { recibidoEn: T0, credencial: 'c' }))
      .toMatchObject({ tipo: 'no-autorizado', motivo: 'dispositivo-distinto' })
    expect(await ejecutar(indulgente({ gameId: undefined, deviceId: undefined }), sobre, { recibidoEn: T0, credencial: 'c' }))
      .toMatchObject({ tipo: 'no-autorizado' })
    expect(await ejecutar(indulgente({ gameId: 'P', deviceId: 'tel-A', version: undefined }), sobre, { recibidoEn: T0, credencial: 'c' }))
      .toMatchObject({ tipo: 'no-autorizado', motivo: 'autorizacion-invalida' })
    intacto(base, antes)
  })
})

describe('el dispositivo de la credencial', () => {
  it('un sobre que dice ser de otro dispositivo se rechaza sin escribir ni revelar nada', async () => {
    const b = crearBanco()
    b.adaptador.otorgar('cred-B', { gameId: 'P', deviceId: 'tel-B', actorId: 'beto' })
    const antes = b.adaptador.foto()
    const reclamaB = b.sobre('anotar', D, { cmdId: 'x' })
    const r = await b.reenviar({ ...reclamaB, deviceId: 'tel-B' }, T0, 'cred-A')
    expect(r).toMatchObject({ tipo: 'no-autorizado', motivo: 'dispositivo-distinto' })
    expect(r.recibo).toBeUndefined()
    intacto(b.adaptador, antes)
  })

  it('el actor del registro sale de la autorización, no del sobre', async () => {
    const estado = estadoDePrueba()
    const a = crearAdaptadorMemoria({ estado, credenciales: { 'cred-M': { gameId: 'P', deviceId: 'tel-M', actorId: 'maria' } } })
    const sobre = construirSobre(estado, { cmdId: 'i', tipo: 'arrancar-reloj', tiempo: { accionTs: T0 } }, { deviceId: 'tel-M', clientSeq: 1 })
    expect((await ejecutar(a, sobre, { recibidoEn: T0, credencial: 'cred-M' })).tipo).toBe('aceptado')
    expect(a.auditoria()[0].actorId).toBe('maria')
    expect(Object.keys(sobre)).not.toContain('actorId')
  })

  it('los recibos usan la identidad autenticada del adaptador', async () => {
    const b = crearBanco()
    const r = await b.enviar('anotar', D, { cmdId: 'c1' })
    expect(r.recibo).toMatchObject({ gameId: 'P', deviceId: 'tel-A' })
  })

  it('procesar exige la identidad autenticada y la compara con la del sobre', () => {
    const estado = estadoDePrueba()
    const vista = { estado, ultimoClientSeq: 0, reciboPorCmdId: null, reciboPorSeq: null, bloqueo: null }
    const sobre = sobreDe(estado, 'tel-A')
    const ok = procesar(vista, sobre, { recibidoEn: T0, actorId: 'yo', gameId: 'P', deviceId: 'tel-A' })
    expect(ok.recibo).toMatchObject({ gameId: 'P', deviceId: 'tel-A' })
    expect(procesar(vista, sobre, { recibidoEn: T0, actorId: 'yo', gameId: 'P', deviceId: 'tel-B' }))
      .toEqual({ tipo: 'no-autorizado', motivo: 'dispositivo-distinto' })
    expect(procesar(vista, sobre, { recibidoEn: T0, actorId: 'yo', gameId: 'Q', deviceId: 'tel-A' }))
      .toEqual({ tipo: 'no-autorizado', motivo: 'juego-distinto' })
    expect(procesar(vista, sobre, { recibidoEn: T0, actorId: 'yo' }))
      .toEqual({ tipo: 'no-autorizado', motivo: 'identidad-ausente' })
  })

  it('el sobre no puede llevar una credencial: es un campo desconocido', async () => {
    const b = crearBanco()
    const r = await b.reenviar({ ...b.sobre('anotar', D), credencial: 'cred-A' })
    expect(r).toMatchObject({ tipo: 'invalido' })
    expect(r.errores).toContain('campo-desconocido:credencial')
  })
})

describe('credenciales ausentes, inválidas o revocadas', () => {
  it.each([
    ['ausente (undefined)', undefined, 'credencial-ausente'],
    ['vacía', '', 'credencial-ausente'],
    ['no es texto', 123, 'credencial-ausente'],
    ['desconocida', 'no-existe', 'credencial-invalida'],
    ['una clave heredada del prototipo', 'constructor', 'credencial-invalida'],
  ])('%s se rechaza sin escribir ni devolver recibos', async (_n, credencial, motivo) => {
    const b = crearBanco()
    const primero = await b.enviar('anotar', D, { cmdId: 'a' })
    const antes = b.adaptador.foto()
    const reintento = await ejecutar(b.adaptador, primero.sobre, { recibidoEn: T0 + 1, credencial })
    expect(reintento).toMatchObject({ tipo: 'no-autorizado', motivo })
    expect(reintento.recibo).toBeUndefined()
    expect(JSON.stringify(reintento)).not.toContain(primero.recibo.contenido)
    intacto(b.adaptador, antes)
  })

  it('una credencial revocada se rechaza, también para reintentar lo ya aceptado', async () => {
    const b = crearBanco()
    const primero = await b.enviar('anotar', D, { cmdId: 'a' })
    b.adaptador.revocar('cred-A')
    const r = await b.reenviar(primero.sobre)
    expect(r).toMatchObject({ tipo: 'no-autorizado', motivo: 'credencial-revocada' })
    expect(r.recibo).toBeUndefined()
    const nueva = await b.enviar('anotar', D, { cmdId: 'b' })
    expect(nueva.tipo).toBe('no-autorizado')
    expect(b.adaptador.estado().eventos).toHaveLength(1)
  })

  it('la autorización se comprueba antes de leer o revelar cualquier recibo', async () => {
    const b = crearBanco()
    const primero = await b.enviar('anotar', D, { cmdId: 'a' })
    let leyo = false
    const base = b.adaptador
    const vigilado = {
      ...base,
      transaccion: (g, fn) => base.transaccion(g, (tx) => fn({ ...tx, leerVista: (s) => { leyo = true; return tx.leerVista(s) } })),
    }
    await ejecutar(vigilado, primero.sobre, { recibidoEn: T0, credencial: 'mala' })
    expect(leyo).toBe(false)
    await ejecutar(vigilado, primero.sobre, { recibidoEn: T0, credencial: 'cred-A' })
    expect(leyo).toBe(true)
  })
})

describe('bloqueo y cambios de autorización', () => {
  it('con el partido bloqueado, el reintento autorizado devuelve su recibo original; el no autorizado, nada', async () => {
    const b = crearBanco()
    const primero = await b.enviar('anotar', D, { cmdId: 'a' })
    b.adaptador.bloquear({ por: 'organizador', motivo: 'bateria' })
    const autorizado = await b.reenviar(primero.sobre, T0 + 60_000)
    expect(autorizado).toMatchObject({ tipo: 'recibo-existente', recibo: primero.recibo })
    const sin = await b.reenviar(primero.sobre, T0 + 60_000, 'otra')
    expect(sin.tipo).toBe('no-autorizado')
    expect(sin.recibo).toBeUndefined()
    expect(b.adaptador.estado().eventos).toHaveLength(1)
  })

  it('si la credencial se revoca entre leer y confirmar, no hay efectos nuevos', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', D, { cmdId: 'a' })
    b.adaptador.ganchos.trasLeer = (a) => a.revocar('cred-A')
    const r = await b.reenviar(s)
    expect(r).toMatchObject({ tipo: 'no-autorizado', motivo: 'credencial-revocada' })
    expect(b.adaptador.estado().eventos).toHaveLength(0)
    expect(b.adaptador.ultimoClientSeq()).toBe(0)
    expect(b.adaptador.recibos()).toEqual({})
  })

  it('si la credencial se reasigna a otro dispositivo entre leer y confirmar, tampoco hay efectos', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', D, { cmdId: 'a' })
    b.adaptador.ganchos.trasLeer = (a) => a.otorgar('cred-A', { gameId: 'P', deviceId: 'tel-OTRO', actorId: 'x' })
    const r = await b.reenviar(s)
    expect(r).toMatchObject({ tipo: 'no-autorizado', motivo: 'dispositivo-distinto' })
    expect(b.adaptador.estado().eventos).toHaveLength(0)
    expect(b.adaptador.recibos()).toEqual({})
  })
})
