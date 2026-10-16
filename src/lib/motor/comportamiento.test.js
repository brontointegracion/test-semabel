import { describe, expect, it } from 'vitest'
import { marcadorEquipo } from '../marcador-calculo'
import { crearBanco, estadoDePrueba, T0 } from './prueba/banco'

// ---------------------------------------------------------------------------
// Reglas de negocio del motor, ejecutadas por el camino completo (sobre →
// orquestador → adaptador de memoria, solo pruebas). Mantienen las reglas que
// hoy cubren marcador.test.js y reloj.test.js sobre Dexie, sin copiarlas.
// ---------------------------------------------------------------------------

const D = { equipoId: 'E1', jugadorId: 'J1' }
const punto = (puntos = 2) => ({ ...D, puntos })
const vivos = (b) => b.adaptador.estado().eventos.filter((e) => !e.anulado)
const evento = (campos) => ({
  id: `x${campos.seq}`, partidoId: 'P', anulado: false, creadoEn: 1, equipoId: 'E1', jugadorId: 'J1', puntos: 2, periodo: 1, tipo: 'punto', ...campos,
})

async function acepta(promesa) {
  const r = await promesa
  expect(r.tipo, JSON.stringify(r.recibo ?? r)).toBe('aceptado')
  return r
}
async function rechaza(promesa, motivo) {
  const r = await promesa
  expect(r.tipo).toBe('rechazado')
  expect(r.recibo.motivo).toBe(motivo)
  return r
}

describe('puntos y faltas', () => {
  it('dos toques intencionales son dos eventos, aunque el contenido sea igual', async () => {
    const b = crearBanco()
    await acepta(b.enviar('anotar', punto(2), { cmdId: 'c1' }))
    await acepta(b.enviar('anotar', punto(2), { cmdId: 'c2' }))
    const ev = b.adaptador.estado().eventos
    expect(ev.map((e) => [e.id, e.seq, e.puntos])).toEqual([['c1', 1, 2], ['c2', 2, 2]])
    expect(marcadorEquipo(ev, 'E1')).toBe(4)
  })

  it('una falta es un evento sin puntos en el periodo visible', async () => {
    const b = crearBanco()
    await acepta(b.enviar('falta', D))
    expect(b.adaptador.estado().eventos[0]).toMatchObject({ tipo: 'falta', puntos: 0, periodo: 1, anulado: false })
  })

  it('rechaza un valor de puntos que el deporte no permite, sin escribir', async () => {
    const b = crearBanco()
    await rechaza(b.enviar('anotar', punto(4)), 'puntos-invalidos')
    expect(b.adaptador.estado().eventos).toHaveLength(0)
  })

  it('con el partido sin vivo (programado o final) no se anota', async () => {
    for (const estado of ['programado', 'final']) {
      const b = crearBanco({ estado })
      const r = await rechaza(b.enviar('anotar', punto()), 'partido-no-disponible')
      expect(r.recibo.detalle.estado).toBe(estado)
    }
  })

  it('anotar bloquea el rehacer pendiente', async () => {
    const b = crearBanco({ eventos: [evento({ seq: 1, anulado: true, anuladoEn: 5 })] })
    await acepta(b.enviar('anotar', punto()))
    expect(b.adaptador.estado().eventos.find((e) => e.seq === 1).rehacerBloqueado).toBe(true)
    await rechaza(b.enviar('rehacer'), 'nada')
  })

  it('un reloj detenido permite anotar', async () => {
    const b = crearBanco()
    await acepta(b.enviar('anotar', punto()))
  })

  it('un periodo viejo se rechaza y no se reetiqueta ni se reintenta', async () => {
    const b = crearBanco()
    const viejo = b.adaptador.estado()
    await acepta(b.enviar('siguiente-periodo'))
    const sobre = b.sobre('anotar', punto(), { estado: viejo, seq: b.adaptador.ultimoClientSeq() + 1 })
    const r = await rechaza(b.reenviar(sobre), 'periodo-desactualizado')
    expect(r.recibo.clientSeq).toBe(2) // consumió su número
    expect(b.adaptador.estado().eventos.filter((e) => e.tipo === 'punto')).toHaveLength(0)
  })

  it('una marca vieja se rechaza aunque el número de periodo coincida (transición anulada)', async () => {
    const conAnulada = estadoDePrueba({
      eventos: [evento({ seq: 1, tipo: 'punto' }), evento({ seq: 2, tipo: 'periodo', anulado: true, periodo: 1 })],
    })
    const b = crearBanco({ estadoInicial: conAnulada })
    const sobre = b.sobre('anotar', punto(), { estado: estadoDePrueba({ eventos: [evento({ seq: 1 })] }) })
    await rechaza(b.reenviar(sobre), 'periodo-desactualizado')
  })

  it('un periodo inventado por la pantalla se rechaza', async () => {
    const b = crearBanco()
    const sobre = b.sobre('anotar', punto())
    sobre.observado = { ...sobre.observado, periodo: 3 }
    await rechaza(b.reenviar(sobre), 'periodo-desactualizado')
  })

  it('con más transiciones que periodos (dato antiguo) se anota con el tope que muestra la pantalla', async () => {
    const eventos = [1, 2, 3, 4].map((seq) => evento({ seq, tipo: 'periodo', periodo: seq }))
    const b = crearBanco({ estadoInicial: estadoDePrueba({ eventos }) })
    await acepta(b.enviar('anotar', punto()))
    expect(b.adaptador.estado().eventos.at(-1).periodo).toBe(4)
  })

  it('si la revisión que vio la pantalla ya no es la actual, se rechaza (solo cambia rev)', async () => {
    const b = crearBanco()
    const viejo = b.adaptador.estado()
    await acepta(b.enviar('anotar', punto()))
    const sobre = b.sobre('anotar', punto(), { estado: viejo, seq: b.adaptador.ultimoClientSeq() + 1 })
    await rechaza(b.reenviar(sobre), 'revision-desactualizada')
  })
})

describe('deshacer, rehacer y anular', () => {
  it('deshacer anula el último evento vivo; sin historial no hay nada que deshacer', async () => {
    const b = crearBanco()
    await rechaza(b.enviar('deshacer'), 'nada')
    await acepta(b.enviar('anotar', punto(1)))
    await acepta(b.enviar('anotar', punto(3)))
    await acepta(b.enviar('deshacer'))
    expect(vivos(b).map((e) => e.puntos)).toEqual([1])
  })

  it('se detiene en la transición: ni la anula ni salta a un punto anterior', async () => {
    const b = crearBanco()
    await acepta(b.enviar('anotar', punto()))
    await acepta(b.enviar('siguiente-periodo'))
    const r = await rechaza(b.enviar('deshacer'), 'limite-periodo')
    expect(r.recibo.revDespues).toBe(2)
    expect(vivos(b)).toHaveLength(2)
  })

  it('con acciones posteriores a la transición las deshace y luego se detiene en ella', async () => {
    const b = crearBanco()
    await acepta(b.enviar('siguiente-periodo'))
    await acepta(b.enviar('anotar', punto()))
    await acepta(b.enviar('deshacer'))
    await rechaza(b.enviar('deshacer'), 'limite-periodo')
  })

  it('una transición anulada (dato antiguo) no cuenta como frontera activa', async () => {
    const eventos = [evento({ seq: 1 }), evento({ seq: 2, tipo: 'periodo', anulado: true })]
    const b = crearBanco({ estadoInicial: estadoDePrueba({ eventos }) })
    await acepta(b.enviar('deshacer'))
    expect(b.adaptador.estado().eventos[0].anulado).toBe(true)
  })

  it('rehacer revive en orden de anulación más reciente, sin depender de las horas', async () => {
    const b = crearBanco()
    for (const p of [1, 2, 3]) await acepta(b.enviar('anotar', punto(p)))
    // La hora de acción de la segunda anulación es ANTERIOR a la primera: el orden lo da la revisión.
    await acepta(b.enviar('deshacer', {}, { t: T0 + 50_000 }))
    await acepta(b.enviar('deshacer', {}, { t: T0 + 10_000 }))
    await acepta(b.enviar('rehacer'))
    expect(vivos(b).map((e) => e.puntos)).toEqual([1, 2])
    await acepta(b.enviar('rehacer'))
    expect(vivos(b).map((e) => e.puntos)).toEqual([1, 2, 3])
  })

  it('rehacer no considera las transiciones anuladas, pero conserva sus registros', async () => {
    const eventos = [evento({ seq: 1 }), evento({ seq: 2, tipo: 'periodo', anulado: true, anuladoEn: 9 })]
    const b = crearBanco({ estadoInicial: estadoDePrueba({ eventos }) })
    await rechaza(b.enviar('rehacer'), 'nada')
    expect(b.adaptador.estado().eventos).toHaveLength(2)
  })

  it('un evento de un periodo anterior se puede rehacer tras cambiar de periodo y vuelve a su periodo', async () => {
    const b = crearBanco()
    const r1 = await acepta(b.enviar('anotar', punto(), { cmdId: 'p1' }))
    await acepta(b.enviar('siguiente-periodo'))
    await acepta(b.enviar('anular-evento', { eventoId: r1.sobre.cmdId }))
    await acepta(b.enviar('rehacer'))
    expect(b.adaptador.estado().eventos.find((e) => e.id === 'p1')).toMatchObject({ anulado: false, periodo: 1 })
  })

  it('si el periodo del candidato no encaja con su lugar, se detiene y no salta a otro', async () => {
    const eventos = [evento({ seq: 1, periodo: 2, anulado: true, anuladoEn: 5 }), evento({ seq: 2, anulado: true, anuladoEn: 1 })]
    const b = crearBanco({ estadoInicial: estadoDePrueba({ eventos }) })
    await rechaza(b.enviar('rehacer'), 'periodo-invalido')
    expect(b.adaptador.estado().eventos.every((e) => e.anulado)).toBe(true)
  })

  it('la transición de periodo conserva el rehacer pendiente', async () => {
    const b = crearBanco({ eventos: [evento({ seq: 1, anulado: true, anuladoEn: 5 })] })
    await acepta(b.enviar('siguiente-periodo'))
    expect(b.adaptador.estado().eventos.find((e) => e.seq === 1).rehacerBloqueado).toBeUndefined()
    await acepta(b.enviar('rehacer'))
  })

  it('anular-evento: rechaza transiciones, ignora ya anulados y desconocidos, y no toca el rehacer', async () => {
    const b = crearBanco()
    const a = await acepta(b.enviar('anotar', punto(), { cmdId: 'a' }))
    await acepta(b.enviar('siguiente-periodo', {}, { cmdId: 's' }))
    await rechaza(b.enviar('anular-evento', { eventoId: 's:e' }), 'limite-periodo')
    await acepta(b.enviar('anular-evento', { eventoId: a.sobre.cmdId }))
    await rechaza(b.enviar('anular-evento', { eventoId: 'a' }), 'nada')
    await rechaza(b.enviar('anular-evento', { eventoId: 'no-existe' }), 'nada')
    expect(b.adaptador.estado().eventos.find((e) => e.id === 'a').rehacerBloqueado).toBeUndefined()
  })

  it('deshacer, rehacer y anular siguen disponibles con el partido final; anotar y reloj no', async () => {
    const b = crearBanco()
    await acepta(b.enviar('anotar', punto(), { cmdId: 'a' }))
    await acepta(b.enviar('cerrar-partido'))
    expect(b.adaptador.estado().partido.estado).toBe('final')
    await acepta(b.enviar('deshacer'))
    await acepta(b.enviar('rehacer'))
    await acepta(b.enviar('anular-evento', { eventoId: 'a' }))
    await rechaza(b.enviar('anotar', punto()), 'partido-no-disponible')
    await rechaza(b.enviar('falta', D), 'partido-no-disponible')
    for (const tipo of ['arrancar-reloj', 'detener-reloj', 'siguiente-periodo', 'cerrar-partido']) {
      await rechaza(b.enviar(tipo), 'partido-no-disponible')
    }
    await rechaza(b.enviar('corregir-reloj', { restanteMs: 1000 }), 'partido-no-disponible')
  })
})

describe('comandos del reloj', () => {
  it('iniciar-partido: queda vivo con el reloj cargado y detenido (8 minutos si así se configura)', async () => {
    const b = crearBanco({ estado: 'programado', minutosPorPeriodo: 8, reloj: { relojRestante: null } })
    await acepta(b.enviar('iniciar-partido'))
    expect(b.adaptador.estado().partido).toMatchObject({
      estado: 'vivo', relojEstado: 'detenido', relojRestante: 480000, relojDesde: null,
    })
    expect(b.adaptador.auditoria()[0]).toMatchObject({ seq: 1, comando: 'inicio-partido', origen: 'consola', actorId: 'yo' })
    await rechaza(b.enviar('iniciar-partido'), 'partido-no-disponible')
  })

  it('arrancar y detener guardan el tiempo efectivo y su registro', async () => {
    const b = crearBanco()
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    expect(b.adaptador.estado()).toMatchObject({ corridaSeq: 1, partido: { relojEstado: 'corriendo', relojDesde: T0, relojRestante: 600000 } })
    await rechaza(b.enviar('arrancar-reloj', {}, { t: T0 + 1 }), 'ya-corriendo')
    await acepta(b.enviar('detener-reloj', {}, { t: T0 + 60_000 }))
    expect(b.adaptador.estado()).toMatchObject({ corridaSeq: null, partido: { relojEstado: 'detenido', relojRestante: 540000, relojDesde: null } })
    const [a, d] = b.adaptador.auditoria()
    expect(a).toMatchObject({ seq: 1, comando: 'arrancar', corridaSeq: 1, despues: { relojEstado: 'corriendo' } })
    expect(d).toMatchObject({ seq: 2, comando: 'detener', corridaSeq: 1, antes: { efectivoMs: 540000 }, despues: { relojRestante: 540000 } })
    await rechaza(b.enviar('detener-reloj', {}, { t: T0 + 61_000 }), 'no-corre')
  })

  it('no arranca sin tiempo; detener en cero a mano se clasifica como detener', async () => {
    const sin = crearBanco({ reloj: { relojRestante: 0 } })
    await rechaza(sin.enviar('arrancar-reloj'), 'sin-tiempo')
    const b = crearBanco({ reloj: { relojRestante: 5000 } })
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    await acepta(b.enviar('detener-reloj', {}, { t: T0 + 9000 }))
    expect(b.adaptador.auditoria()[1]).toMatchObject({ comando: 'detener', actorId: 'yo' })
    expect(b.adaptador.estado().partido.relojRestante).toBe(0)
  })

  it('el tiempo restante visto que no coincide con el cálculo se rechaza como reloj-divergente', async () => {
    const b = crearBanco()
    const sobre = b.sobre('arrancar-reloj')
    sobre.restanteVistoMs += 1000
    await rechaza(b.reenviar(sobre), 'reloj-divergente')
    expect(b.adaptador.estado().partido.relojEstado).toBe('detenido')
  })

  it('un arrancar viejo se rechaza aunque los campos guardados hayan vuelto a verse iguales (lo atrapa el seq)', async () => {
    const b = crearBanco()
    const viejo = b.adaptador.estado()
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    await acepta(b.enviar('detener-reloj', {}, { t: T0 }))
    const sobre = b.sobre('arrancar-reloj', {}, { estado: viejo, seq: b.adaptador.ultimoClientSeq() + 1 })
    await rechaza(b.reenviar(sobre), 'reloj-desactualizado')
  })

  it('un detener viejo no detiene una corrida nueva', async () => {
    const b = crearBanco()
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    const viejo = b.adaptador.estado()
    await acepta(b.enviar('detener-reloj', {}, { t: T0 + 1000 }))
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 + 2000 }))
    const sobre = b.sobre('detener-reloj', {}, { estado: viejo, t: T0 + 3000, seq: b.adaptador.ultimoClientSeq() + 1 })
    await rechaza(b.reenviar(sobre), 'reloj-desactualizado')
    expect(b.adaptador.estado().partido.relojEstado).toBe('corriendo')
  })

  it('sin la observación completa no se actúa', async () => {
    const b = crearBanco()
    const sobre = b.sobre('arrancar-reloj')
    delete sobre.observado.relojEstado
    const r = await b.reenviar(sobre)
    expect(r.tipo).toBe('invalido')
  })

  it('parada automática: solo con el reloj corriendo y sin tiempo; origen sistema y sin actor', async () => {
    const b = crearBanco({ reloj: { relojRestante: 5000 } })
    expect(await b.paradaAutomatica(T0)).toBeNull() // detenido
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    expect(await b.paradaAutomatica(T0 + 1000)).toBeNull() // aún hay tiempo
    const { resultado } = await b.paradaAutomatica(T0 + 5000)
    expect(resultado.tipo).toBe('aceptado')
    expect(b.adaptador.auditoria()[1]).toMatchObject({
      comando: 'parada-automatica', origen: 'sistema', actorId: null, ceroEnDerivado: T0 + 5000, corridaSeq: 1,
    })
    expect(b.adaptador.estado().partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 0 })
  })

  it('una parada automática vieja de otra corrida no detiene la corrida nueva', async () => {
    const b = crearBanco({ reloj: { relojRestante: 5000 } })
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    const p = await b.paradaAutomatica(T0 + 5000)
    expect(p.resultado.tipo).toBe('aceptado')
    await acepta(b.enviar('corregir-reloj', { restanteMs: 8000 }, { t: T0 + 5001 }))
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 + 6000 })) // corrida nueva
    const rec = b.adaptador.estado()
    // La orden de la corrida anterior ya no encaja: la identidad es otra.
    const vieja = b.sobre('parada-automatica', { corridaSeq: 1 }, { cmdId: 'auto:P:1', t: T0 + 20_000, estado: { ...rec, partido: { ...rec.partido, relojRestante: 0 } } })
    const r = await b.reenviar(vieja, T0 + 20_000)
    // cmdId ya tiene recibo con otro contenido: nunca se aplica una segunda vez.
    expect(r.tipo).toBe('conflicto-contenido')
  })

  it('corregir-reloj con el reloj corriendo se rechaza; en pausa se acepta con auditoría completa', async () => {
    const b = crearBanco()
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    await rechaza(b.enviar('corregir-reloj', { restanteMs: 300000 }, { t: T0 + 1000 }), 'reloj-corriendo')
    await acepta(b.enviar('detener-reloj', {}, { t: T0 + 60_000 }))
    const antes = b.adaptador.estado()
    await acepta(b.enviar('corregir-reloj', { restanteMs: 327000 }, { t: T0 + 70_000 }))
    const e = b.adaptador.estado()
    expect(e.partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 327000, relojDesde: null })
    expect(e.eventos).toEqual(antes.eventos)
    expect(e.cursorReloj).toBe(antes.cursorReloj)
    const fila = b.adaptador.auditoria().at(-1)
    expect(fila).toMatchObject({
      comando: 'correccion-reloj', actorId: 'yo', restanteAnteriorMs: 540000, restanteNuevoMs: 327000,
      antes: { relojRestante: 540000 }, despues: { relojRestante: 327000 },
    })
  })

  it('corregir-reloj rechaza fuera de rango, sin cambio y con el partido final', async () => {
    const b = crearBanco()
    await rechaza(b.enviar('corregir-reloj', { restanteMs: 600001 }), 'fuera-de-rango')
    await rechaza(b.enviar('corregir-reloj', { restanteMs: 600000 }), 'sin-cambio')
    await acepta(b.enviar('corregir-reloj', { restanteMs: 0 }))
    await acepta(b.enviar('cerrar-partido'))
    await rechaza(b.enviar('corregir-reloj', { restanteMs: 5000 }), 'partido-no-disponible')
  })

  it('siguiente-periodo: transición, reinicio del reloj y registro juntos; último periodo rechazado', async () => {
    const b = crearBanco()
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    await acepta(b.enviar('siguiente-periodo', {}, { cmdId: 's1', t: T0 + 4000 }))
    const e = b.adaptador.estado()
    expect(e.corridaSeq).toBeNull()
    expect(e.partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    expect(e.eventos).toEqual([expect.objectContaining({ id: 's1:e', tipo: 'periodo', periodo: 1, seq: 1 })])
    expect(b.adaptador.auditoria().at(-1)).toMatchObject({
      comando: 'reinicio-periodo', periodo: 1, periodoDespues: 2, eventoPeriodoId: 's1:e', corridaSeq: 1,
    })
    await acepta(b.enviar('siguiente-periodo'))
    await acepta(b.enviar('siguiente-periodo'))
    await rechaza(b.enviar('siguiente-periodo'), 'ultimo-periodo')
  })

  it('cerrar-partido detiene el reloj en su tiempo efectivo y no toca cuentas ni eventos', async () => {
    const b = crearBanco()
    await acepta(b.enviar('anotar', punto()))
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    const antes = b.adaptador.estado().eventos
    await acepta(b.enviar('cerrar-partido', {}, { t: T0 + 30_000 }))
    expect(b.adaptador.estado().partido).toMatchObject({ estado: 'final', relojEstado: 'detenido', relojRestante: 570000, relojDesde: null })
    expect(b.adaptador.estado().eventos).toEqual(antes)
    expect(b.adaptador.auditoria().at(-1)).toMatchObject({ comando: 'cierre-partido', corridaSeq: 1 })
  })

  it('ningún comando del reloj toca el rehacer pendiente ni los eventos (salvo la transición)', async () => {
    const b = crearBanco({ eventos: [evento({ seq: 1, anulado: true, anuladoEn: 3 })] })
    await acepta(b.enviar('arrancar-reloj', {}, { t: T0 }))
    await acepta(b.enviar('detener-reloj', {}, { t: T0 + 1 }))
    await acepta(b.enviar('corregir-reloj', { restanteMs: 1000 }, { t: T0 + 2 }))
    expect(b.adaptador.estado().eventos).toEqual([evento({ seq: 1, anulado: true, anuladoEn: 3 })])
  })
})
