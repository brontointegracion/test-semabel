import { describe, expect, it } from 'vitest'
import { ejecutar } from './orquestador'
import { crearBanco, T0 } from './prueba/banco'

// ---------------------------------------------------------------------------
// Orden, reintento, bloqueo y fallos, con el adaptador de MEMORIA (solo
// pruebas). Prueban la lógica de decisión y el comportamiento ante fallos
// inyectados; NO prueban durabilidad ni reinicio: eso necesita un adaptador
// real y su propia evidencia.
// ---------------------------------------------------------------------------

const D = { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }
const F = { equipoId: 'E1', jugadorId: 'J1' }

describe('reintentos y conflictos', () => {
  it('pérdida del acuse: el reintento devuelve el recibo original y no vuelve a aplicar', async () => {
    const b = crearBanco()
    const primero = await b.enviar('anotar', D, { cmdId: 'c1' })
    expect(primero.tipo).toBe('aceptado')
    const confirmaciones = b.adaptador.confirmaciones()
    const reintento = await b.reenviar(primero.sobre, T0 + 60_000)
    expect(reintento.tipo).toBe('recibo-existente')
    expect(reintento.recibo).toEqual(primero.recibo)
    expect(b.adaptador.estado().eventos).toHaveLength(1)
    expect(b.adaptador.estado().rev).toBe(1)
    expect(b.adaptador.confirmaciones()).toBe(confirmaciones)
  })

  it('mismo cmdId con contenido distinto: conflicto, el original queda', async () => {
    const b = crearBanco()
    const primero = await b.enviar('anotar', D, { cmdId: 'c1' })
    const manipulado = { ...primero.sobre, datos: { ...D, puntos: 3 } }
    const r = await b.reenviar(manipulado)
    expect(r.tipo).toBe('conflicto-contenido')
    expect(b.adaptador.estado().eventos[0].puntos).toBe(2)
  })

  it('un hueco no cambia nada; la entrega desordenada se resuelve al llegar el número esperado', async () => {
    const b = crearBanco()
    const s1 = b.sobre('anotar', D, { cmdId: 'a', seq: 1 })
    const antes = b.adaptador.foto()
    const tarde = b.sobre('falta', F, { cmdId: 'c', seq: 3 })
    const hueco = await b.reenviar(tarde)
    expect(hueco).toMatchObject({ tipo: 'hueco', esperado: 1 })
    expect(b.adaptador.foto()).toEqual(antes)

    expect((await b.reenviar(s1)).tipo).toBe('aceptado')
    // El sobre 3 se construyó con la revisión anterior; el 2 es el que toca ahora.
    expect(await b.reenviar(tarde)).toMatchObject({ tipo: 'hueco', esperado: 2 })
    const s2 = b.sobre('falta', F, { cmdId: 'b', seq: 2 })
    expect((await b.reenviar(s2)).tipo).toBe('aceptado')
  })

  it('un número ya usado por otro cmdId es secuencia-ocupada y no cambia nada', async () => {
    const b = crearBanco()
    await b.enviar('anotar', D, { cmdId: 'a' })
    const antes = b.adaptador.foto()
    const otro = b.sobre('falta', F, { cmdId: 'otro', seq: 1 })
    expect(await b.reenviar(otro)).toMatchObject({ tipo: 'secuencia-ocupada', ocupadaPor: 'a' })
    expect(b.adaptador.foto()).toEqual(antes)
  })

  it('un rechazo definitivo consume su número, guarda su recibo y su reintento devuelve el mismo rechazo', async () => {
    const b = crearBanco()
    await b.enviar('anotar', D, { cmdId: 'a' })
    const mal = await b.enviar('deshacer', {}, { cmdId: 'x' })
    await b.enviar('deshacer', {}, { cmdId: 'y' }) // deshace el punto
    const r = await b.enviar('deshacer', {}, { cmdId: 'z' })
    expect(r.recibo.motivo).toBe('nada')
    expect(mal.tipo).toBe('aceptado')
    expect(b.adaptador.ultimoClientSeq()).toBe(4)
    const rev = b.adaptador.estado().rev
    const otra = await b.reenviar(r.sobre)
    expect(otra).toMatchObject({ tipo: 'recibo-existente' })
    expect(otra.recibo.resultado).toBe('rechazado')
    expect(b.adaptador.estado().rev).toBe(rev)
    const sigue = await b.enviar('anotar', D, { cmdId: 'w' })
    expect(sigue.recibo.clientSeq).toBe(5)
  })

  it('el reintento de una orden aceptada tras el cierre devuelve su recibo original', async () => {
    const b = crearBanco()
    const a = await b.enviar('anotar', D, { cmdId: 'a' })
    await b.enviar('cerrar-partido')
    expect((await b.reenviar(a.sobre)).tipo).toBe('recibo-existente')
    expect((await b.enviar('anotar', D)).recibo.motivo).toBe('partido-no-disponible')
  })
})

describe('bloqueo explícito del organizador (distinto del cierre)', () => {
  it('rechaza cualquier orden nueva, incluidas Deshacer/Rehacer/Anular, sin recibo ni número, y la guarda en cuarentena', async () => {
    const b = crearBanco()
    await b.enviar('anotar', D, { cmdId: 'a' })
    b.adaptador.bloquear({ por: 'organizador', motivo: 'bateria' })
    const antes = b.adaptador.foto()
    for (const [tipo, datos] of [['anotar', D], ['deshacer', {}], ['rehacer', {}], ['anular-evento', { eventoId: 'a' }], ['arrancar-reloj', {}]]) {
      const s = b.sobre(tipo, datos, { cmdId: `n-${tipo}` })
      const r = await b.reenviar(s)
      expect(r.tipo, tipo).toBe('bloqueado')
    }
    const despues = b.adaptador.foto()
    expect(despues.estado).toEqual(antes.estado)
    expect(despues.ultimoClientSeq).toBe(antes.ultimoClientSeq)
    expect(Object.keys(despues.recibos)).toEqual(Object.keys(antes.recibos))
    expect(despues.cuarentena).toHaveLength(5)
  })

  it('los reintentos autorizados devuelven recibos existentes (aceptados y rechazados) aun bloqueado', async () => {
    const b = crearBanco()
    const a = await b.enviar('anotar', D, { cmdId: 'a' })
    const malo = await b.enviar('anular-evento', { eventoId: 'no-existe' }, { cmdId: 'm' })
    b.adaptador.bloquear()
    const r1 = await b.reenviar(a.sobre)
    const r2 = await b.reenviar(malo.sobre)
    expect(r1).toMatchObject({ tipo: 'recibo-existente', recibo: { resultado: 'aceptado' } })
    expect(r2).toMatchObject({ tipo: 'recibo-existente', recibo: { resultado: 'rechazado' } })
  })

  it('un dispositivo no autorizado no recibe ni recibos ni cuarentena', async () => {
    const b = crearBanco()
    const a = await b.enviar('anotar', D, { cmdId: 'a' })
    b.adaptador.revocar('cred-A')
    expect(await b.reenviar(a.sobre)).toMatchObject({ tipo: 'no-autorizado' })
    expect(b.adaptador.cuarentena()).toHaveLength(0)
  })

  it('el bloqueo se comprueba dentro de la frontera: si aparece entre leer y confirmar, la orden no se aplica', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', D, { cmdId: 'a' })
    b.adaptador.ganchos.trasLeer = (a) => a.bloquear()
    const r = await b.reenviar(s)
    expect(r.tipo).toBe('bloqueado')
    expect(b.adaptador.estado().eventos).toHaveLength(0)
    expect(b.adaptador.ultimoClientSeq()).toBe(0)
  })

  it('la autorización también: si se revoca entre leer y confirmar, no se aplica', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', D, { cmdId: 'a' })
    b.adaptador.ganchos.trasLeer = (a) => a.revocar('cred-A')
    expect((await b.reenviar(s)).tipo).toBe('no-autorizado')
    expect(b.adaptador.estado().eventos).toHaveLength(0)
  })

  it('el cierre normal no es un bloqueo: Deshacer sigue aceptándose', async () => {
    const b = crearBanco()
    await b.enviar('anotar', D)
    await b.enviar('cerrar-partido')
    expect((await b.enviar('deshacer')).tipo).toBe('aceptado')
  })

  it('contención excesiva: si la confirmación siempre encuentra cambios, falla en voz alta y no escribe', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', D)
    const rearmar = (a) => { a.bloquear(); a.desbloquear(); a.ganchos.trasLeer = rearmar }
    b.adaptador.ganchos.trasLeer = rearmar
    await expect(b.reenviar(s)).rejects.toThrow('contencion-excesiva')
    b.adaptador.ganchos.trasLeer = null
    expect(b.adaptador.estado().eventos).toHaveLength(0)
  })

  it('exige recibidoEn', async () => {
    const b = crearBanco()
    await expect(ejecutar(b.adaptador, b.sobre('anotar', D), {})).rejects.toThrow('recibidoEn')
  })
})

describe('atomicidad y publicación (con fallos inyectados)', () => {
  for (const punto of ['antes-de-confirmar', 'tras-recibo', 'durante-confirmar']) {
    it(`un fallo en "${punto}" no deja nada parcial: ni estado, ni auditoría, ni recibo, ni publicación; y el reintento se aplica una sola vez`, async () => {
      const b = crearBanco({ estado: 'programado', reloj: { relojRestante: null } })
      const antes = b.adaptador.foto()
      const s = b.sobre('iniciar-partido', {}, { cmdId: 'i1' })
      b.adaptador.ganchos.falloEn = punto
      await expect(b.reenviar(s)).rejects.toThrow('fallo inyectado')
      expect(b.adaptador.foto()).toEqual(antes)
      expect(b.adaptador.entregados()).toEqual([])
      expect(b.adaptador.bandeja()).toEqual([])

      const bien = await b.reenviar(s)
      expect(bien.tipo).toBe('aceptado')
      expect(b.adaptador.auditoria()).toHaveLength(1)
      expect(Object.keys(b.adaptador.recibos())).toEqual(['i1'])
      expect(b.adaptador.estado().rev).toBe(1)
      expect(b.adaptador.entregados()).toHaveLength(1)
    })
  }

  it('un fallo al guardar un rechazo definitivo tampoco deja recibo ni consume número', async () => {
    const b = crearBanco()
    const s = b.sobre('deshacer', {}, { cmdId: 'x' })
    b.adaptador.ganchos.falloEn = 'durante-confirmar'
    await expect(b.reenviar(s)).rejects.toThrow()
    expect(b.adaptador.ultimoClientSeq()).toBe(0)
    expect(b.adaptador.recibos()).toEqual({})
    expect((await b.reenviar(s)).recibo.resultado).toBe('rechazado')
  })

  it('se publica solo después de confirmar, y el mensaje sale del recibo confirmado', async () => {
    const b = crearBanco()
    const r = await b.enviar('anotar', D, { cmdId: 'a' })
    expect(r.publicacion).toBe('entregada')
    expect(b.adaptador.entregados()).toEqual([
      expect.objectContaining({ gameId: 'P', rev: 1, cmdId: 'a' }),
    ])
    // Un rechazo no publica nada.
    await b.enviar('anular-evento', { eventoId: 'no' })
    expect(b.adaptador.entregados()).toHaveLength(1)
  })

  it('si falla la publicación después de confirmar, la orden NO se vuelve a aplicar', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', D, { cmdId: 'a' })
    b.adaptador.ganchos.falloEn = 'publicar'
    const r = await b.reenviar(s)
    expect(r.tipo).toBe('aceptado')
    expect(r.publicacion).toBe('pendiente')
    expect(b.adaptador.estado().eventos).toHaveLength(1)
    expect(b.adaptador.entregados()).toEqual([])

    const reintento = await b.reenviar(s)
    expect(reintento.tipo).toBe('recibo-existente')
    expect(b.adaptador.estado().eventos).toHaveLength(1)
    expect(b.adaptador.bandeja()).toHaveLength(1)

    await b.adaptador.publicarPendientes('P')
    await b.adaptador.publicarPendientes('P')
    expect(b.adaptador.entregados()).toHaveLength(1)
  })
})

describe('repetición determinista frente a reenvío duplicado', () => {
  async function registro(b) {
    const pasos = [
      ['arrancar-reloj', {}, T0],
      ['anotar', D, T0 + 5000],
      ['anotar', { ...D, puntos: 3 }, T0 + 9000],
      ['falta', { equipoId: 'E1', jugadorId: 'J1' }, T0 + 12_000],
      ['deshacer', {}, T0 + 15_000],
      ['detener-reloj', {}, T0 + 60_000],
      ['corregir-reloj', { restanteMs: 500000 }, T0 + 70_000],
      ['siguiente-periodo', {}, T0 + 80_000],
      ['anotar', D, T0 + 90_000],
      ['cerrar-partido', {}, T0 + 100_000],
    ]
    const sobres = []
    for (const [i, [tipo, datos, t]] of pasos.entries()) {
      const r = await b.enviar(tipo, datos, { t, cmdId: `k${i}` })
      expect(r.tipo, tipo).toBe('aceptado')
      sobres.push(r.sobre)
    }
    return sobres
  }

  it('repetir el mismo registro desde la misma base reproduce estado, auditoría, ids y recibos', async () => {
    const a = crearBanco(); const sa = await registro(a)
    const c = crearBanco(); const sc = await registro(c)
    expect(sc).toEqual(sa)
    expect(c.adaptador.estado()).toEqual(a.adaptador.estado())
    expect(c.adaptador.auditoria()).toEqual(a.adaptador.auditoria())
    expect(c.adaptador.recibos()).toEqual(a.adaptador.recibos())
  })

  it('reenviar todos los sobres ya aceptados no aplica nada dos veces', async () => {
    const b = crearBanco(); const sobres = await registro(b)
    const antes = b.adaptador.foto()
    for (const s of sobres) expect((await b.reenviar(s, T0 + 999_999)).tipo).toBe('recibo-existente')
    expect(b.adaptador.foto()).toEqual(antes)
  })
})
