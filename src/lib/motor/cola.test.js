import { describe, expect, it } from 'vitest'
import {
  alRecibir, crearCola, encolar, marcarEnviando, proximoEnvio, reanudar, reconstruirProvisional,
} from './cola'
import { ejecutarAutorizado as ejecutar } from './prueba/banco'
import { ordenParadaAutomatica } from './reglas'
import { canonico } from './sobre'
import { crearBanco, nuevoId, T0 } from './prueba/banco'

// ---------------------------------------------------------------------------
// El teléfono: cola de órdenes (valores puros) contra el servidor de pruebas
// (adaptador de memoria, no durable). Lo que se prueba es la regla de números
// y el trato de lo no aplicado, no la persistencia de la cola.
// ---------------------------------------------------------------------------

const D = { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }
const ctxLocal = (t) => ({ ahoraEstimado: t, actorId: 'yo' })

function telefono(b) {
  const servidor = b.adaptador.estado()
  return {
    cola: crearCola({ gameId: 'P', deviceId: b.deviceId, ultimoClientSeqServidor: b.adaptador.ultimoClientSeq(), revServidor: servidor.rev }),
    estado: servidor,
  }
}

function orden(tipo, datos, accionTs, extra = {}) {
  return { cmdId: extra.cmdId ?? nuevoId('o'), tipo, datos, tiempo: { accionTs, ...extra.tiempo } }
}

/** Encola y devuelve el teléfono actualizado más el resultado. */
function pulsar(tel, tipo, datos, t, extra) {
  const r = encolar(tel.cola, tel.estado, orden(tipo, datos, t, extra), ctxLocal(t))
  return { r, tel: { cola: r.cola, estado: r.estado } }
}

async function enviarSiguiente(b, tel, recibidoEn) {
  const sobre = proximoEnvio(tel.cola)
  if (!sobre) return { tel, resultado: null }
  const cola1 = marcarEnviando(tel.cola, sobre.cmdId)
  const resultado = await ejecutar(b.adaptador, sobre, { recibidoEn })
  return { tel: { ...tel, cola: alRecibir(cola1, sobre.cmdId, resultado) }, resultado, sobre }
}

describe('asignación de clientSeq: la validación local no consume números', () => {
  it('servidor en 7; una acción local inválida; la siguiente válida sincroniza como 8, sin hueco', async () => {
    const b = crearBanco({
      ultimoClientSeq: 7,
      reloj: { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: T0 },
      extra: { corridaSeq: 1, auditSeq: 1, cursorReloj: T0, rev: 7 },
    })
    let tel = telefono(b)
    expect(tel.cola.siguienteSeq).toBe(8)

    // Corregir el reloj con el reloj corriendo: rechazo LOCAL.
    const invalida = pulsar(tel, 'corregir-reloj', { restanteMs: 300000 }, T0 + 1000)
    expect(invalida.r.rechazoLocal.motivo).toBe('reloj-corriendo')
    expect(invalida.r.cola).toBe(tel.cola) // nada cambió: ni número, ni entrada
    expect(invalida.tel.cola.siguienteSeq).toBe(8)
    expect(invalida.tel.cola.entradas).toHaveLength(0)

    const valida = pulsar(tel, 'anotar', D, T0 + 2000)
    tel = valida.tel
    expect(valida.r.sobre.clientSeq).toBe(8)

    const { tel: tras, resultado } = await enviarSiguiente(b, tel, T0 + 2000)
    expect(resultado.tipo).toBe('aceptado')
    expect(resultado.recibo.clientSeq).toBe(8)
    expect(tras.cola.base).toEqual({ ultimoClientSeq: 8, rev: 8 })
    expect(b.adaptador.ultimoClientSeq()).toBe(8)
  })

  it('con 8 y 9 pendientes, una acción local inválida no abre hueco: la siguiente válida es la 10', () => {
    const b = crearBanco({ ultimoClientSeq: 7 })
    let tel = telefono(b)
    tel = pulsar(tel, 'anotar', D, T0).tel
    tel = pulsar(tel, 'anotar', D, T0 + 1).tel
    expect(tel.cola.entradas.map((e) => e.sobre.clientSeq)).toEqual([8, 9])
    const mala = pulsar(tel, 'anotar', { ...D, puntos: 4 }, T0 + 2)
    expect(mala.r.rechazoLocal.motivo).toBe('puntos-invalidos')
    tel = mala.tel
    tel = pulsar(tel, 'falta', { equipoId: 'E1', jugadorId: 'J1' }, T0 + 3).tel
    expect(tel.cola.entradas.map((e) => e.sobre.clientSeq)).toEqual([8, 9, 10])
  })

  it('el estado provisional refleja lo encolado, y el del servidor no se toca hasta enviar', () => {
    const b = crearBanco()
    const { tel } = pulsar(telefono(b), 'anotar', D, T0)
    expect(tel.estado.eventos).toHaveLength(1)
    expect(tel.estado.rev).toBe(1)
    expect(b.adaptador.estado().eventos).toHaveLength(0)
  })
})

describe('sobre inmutable', () => {
  it('cada reintento reenvía exactamente los mismos bytes; recrear el mismo cmdId no asigna otro número', () => {
    const b = crearBanco()
    const { tel, r } = pulsar(telefono(b), 'anotar', D, T0, { cmdId: 'fijo' })
    const original = canonico(r.sobre)
    const enviando = marcarEnviando(tel.cola, 'fijo')
    expect(canonico(proximoEnvio(enviando))).toBe(original)
    expect(canonico(proximoEnvio(enviando))).toBe(original)
    const otra = encolar(enviando, tel.estado, orden('anotar', D, T0 + 500, { cmdId: 'fijo' }), ctxLocal(T0 + 500))
    expect(otra.duplicada).toBe(true)
    expect(otra.cola.siguienteSeq).toBe(enviando.siguienteSeq)
    expect(canonico(otra.sobre)).toBe(original)
  })
})

describe('rechazo definitivo del servidor', () => {
  async function conDivergencia() {
    const b = crearBanco({ ultimoClientSeq: 0 })
    let tel = telefono(b)
    tel = pulsar(tel, 'siguiente-periodo', {}, T0 + 10, { cmdId: 'c1' }).tel // seq 1
    tel = pulsar(tel, 'anotar', D, T0 + 20, { cmdId: 'c2' }).tel // seq 2, depende de c1
    tel = pulsar(tel, 'falta', { equipoId: 'E1', jugadorId: 'J1' }, T0 + 30, { cmdId: 'c3' }).tel // seq 3
    // Mientras tanto, el servidor cambió de periodo por otro camino (divergencia).
    await b.enviar('siguiente-periodo', {}, { cmdId: 'otro', seq: 1 })
    return { b, tel }
  }

  it('un número ya ocupado en el servidor (caso excepcional) detiene la cola sin tocar nada', async () => {
    const { b, tel } = await conDivergencia()
    // El servidor ya usó el seq 1 con otro cmdId: el envío del c1 es secuencia-ocupada (excepcional).
    const r1 = await enviarSiguiente(b, tel, T0 + 40)
    expect(r1.resultado.tipo).toBe('secuencia-ocupada')
    expect(r1.tel.cola.detenida.causa).toBe('secuencia-ocupada')
    expect(proximoEnvio(r1.tel.cola)).toBeNull()
  })

  it('rechazo de negocio real: el rechazo consume el número y las órdenes dependientes quedan sin aplicar, intactas', async () => {
    const b = crearBanco()
    let tel = telefono(b)
    tel = pulsar(tel, 'siguiente-periodo', {}, T0 + 10, { cmdId: 'c1' }).tel
    tel = pulsar(tel, 'anotar', D, T0 + 20, { cmdId: 'c2' }).tel
    tel = pulsar(tel, 'falta', { equipoId: 'E1', jugadorId: 'J1' }, T0 + 30, { cmdId: 'c3' }).tel
    const sobresOriginales = tel.cola.entradas.map((e) => canonico(e.sobre))
    // Otra pantalla del mismo partido cambió el periodo antes de que llegara c1.
    await b.enviar('siguiente-periodo', {}, { cmdId: 'otro' })
    // Para que c1 no choque en número, el servidor lo ve como el siguiente esperado (no hay hueco real):
    const ultimo = b.adaptador.ultimoClientSeq()
    const c1 = { ...tel.cola.entradas[0].sobre, clientSeq: ultimo + 1 }
    const r = await ejecutar(b.adaptador, c1, { recibidoEn: T0 + 40 })
    expect(r).toMatchObject({ tipo: 'rechazado' })
    expect(['periodo-desactualizado', 'reloj-desactualizado', 'revision-desactualizada']).toContain(r.recibo.motivo)

    const cola = alRecibir(marcarEnviando(tel.cola, 'c1'), 'c1', r)
    expect(cola.entradas.map((e) => e.estado)).toEqual(['rechazada', 'no-aplicada', 'no-aplicada'])
    expect(cola.detenida).toMatchObject({ causa: 'rechazo-definitivo', cmdId: 'c1' })
    expect(cola.base.ultimoClientSeq).toBe(ultimo + 1)
    expect(cola.entradas.map((e) => canonico(e.sobre))).toEqual(sobresOriginales) // historia intacta
    expect(proximoEnvio(cola)).toBeNull()
    // Lo dependiente nunca se reenvió ni se aplicó solo.
    expect(b.adaptador.estado().eventos.filter((e) => e.tipo === 'punto' || e.tipo === 'falta')).toHaveLength(0)
    // Mientras está detenida no se aceptan órdenes nuevas.
    expect(encolar(cola, tel.estado, orden('anotar', D, T0 + 50), ctxLocal(T0 + 50)).rechazoLocal.motivo).toBe('cola-detenida')

    // Reanudar: numeración desde lo último procesado; el servidor es la nueva base.
    const rea = reanudar(cola, { ultimoClientSeq: ultimo + 1, rev: b.adaptador.estado().rev })
    expect(rea.ok).toBe(true)
    expect(rea.cola.siguienteSeq).toBe(ultimo + 2)
    expect(rea.cola.detenida).toBeNull()
    const nueva = encolar(rea.cola, b.adaptador.estado(), orden('anotar', D, T0 + 60, { cmdId: 'n1' }), ctxLocal(T0 + 60))
    expect(nueva.sobre.clientSeq).toBe(ultimo + 2)
    const env = await ejecutar(b.adaptador, nueva.sobre, { recibidoEn: T0 + 60 })
    expect(env.tipo).toBe('aceptado')
    // Los registros viejos conservan su número original como historia.
    expect(rea.cola.entradas.map((e) => e.sobre.clientSeq)).toEqual([1, 2, 3])
  })

  it('solo se puede reanudar tras un rechazo definitivo (no tras un bloqueo)', async () => {
    const b = crearBanco()
    let tel = telefono(b)
    tel = pulsar(tel, 'anotar', D, T0, { cmdId: 'c1' }).tel
    tel = pulsar(tel, 'anotar', D, T0 + 1, { cmdId: 'c2' }).tel
    b.adaptador.bloquear()
    const { tel: tras, resultado } = await enviarSiguiente(b, tel, T0 + 5)
    expect(resultado.tipo).toBe('bloqueado')
    expect(tras.cola.detenida.causa).toBe('bloqueado')
    expect(tras.cola.entradas.map((e) => e.estado)).toEqual(['no-aplicada', 'no-aplicada'])
    expect(reanudar(tras.cola, { ultimoClientSeq: 0, rev: 0 })).toEqual({ ok: false, motivo: 'no-reanudable' })
  })
})

describe('parada automática: identidad de la corrida y un solo efecto', () => {
  function relojAlCero() {
    return crearBanco({ reloj: { relojRestante: 5000 } })
  }

  async function llegarAlCero() {
    const b = relojAlCero()
    let tel = telefono(b)
    tel = pulsar(tel, 'arrancar-reloj', {}, T0, { cmdId: 'arr' }).tel
    let e = await enviarSiguiente(b, tel, T0)
    expect(e.resultado.tipo).toBe('aceptado')
    // El servidor y el teléfono comparten corrida: audit seq del arranque = 1.
    tel = { cola: e.tel.cola, estado: tel.estado }
    return { b, tel }
  }

  it('ticks repetidos, recarga y pérdida del acuse: un solo envelope, un solo efecto, un solo registro de auditoría', async () => {
    const { b, tel: tel0 } = await llegarAlCero()
    const tZero = T0 + 5000

    // Tick 1: se genera, valida y encola UNA vez.
    const orden1 = ordenParadaAutomatica(tel0.estado, { accionTs: tZero })
    expect(orden1.cmdId).toBe('auto:P:1')
    const p1 = encolar(tel0.cola, tel0.estado, orden1, ctxLocal(tZero))
    expect(p1.sobre.clientSeq).toBe(2)
    let tel = { cola: p1.cola, estado: p1.estado }

    // Ticks 2…n: el estado provisional ya está detenido; no hay nada que generar.
    for (let i = 1; i <= 5; i += 1) {
      expect(ordenParadaAutomatica(tel.estado, { accionTs: tZero + i * 1000 })).toBeNull()
    }
    // Un tick atrasado que aún sostenga la orden vieja tampoco asigna otro número.
    const atrasado = encolar(tel.cola, tel.estado, orden1, ctxLocal(tZero + 6000))
    expect(atrasado.duplicada).toBe(true)
    expect(atrasado.cola.siguienteSeq).toBe(p1.cola.siguienteSeq)

    // Recarga antes de la respuesta: se reconstruye desde la base autoritativa + la cola.
    const base = b.adaptador.estado()
    const tras = reconstruirProvisional(base, marcarEnviando(tel.cola, 'auto:P:1'), ctxLocal(tZero + 7000))
    expect(tras.ok).toBe(true)
    expect(tras.estado).toEqual(tel.estado)
    expect(ordenParadaAutomatica(tras.estado, { accionTs: tZero + 8000 })).toBeNull()

    // Envío; el acuse se pierde (no se registra); reintento con los mismos bytes.
    const sobre = proximoEnvio(marcarEnviando(tel.cola, 'auto:P:1'))
    const a = await ejecutar(b.adaptador, sobre, { recibidoEn: tZero + 9000 })
    expect(a.tipo).toBe('aceptado')
    const reintento = await ejecutar(b.adaptador, proximoEnvio(marcarEnviando(tel.cola, 'auto:P:1')), { recibidoEn: tZero + 30_000 })
    expect(reintento.tipo).toBe('recibo-existente')
    expect(reintento.recibo).toEqual(a.recibo)

    const paradas = b.adaptador.auditoria().filter((f) => f.comando === 'parada-automatica')
    expect(paradas).toHaveLength(1)
    expect(paradas[0]).toMatchObject({ cmdId: 'auto:P:1', corridaSeq: 1, ceroEnDerivado: tZero, origen: 'sistema', actorId: null })
    expect(b.adaptador.estado().partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 0 })
    expect(alRecibir(marcarEnviando(tel.cola, 'auto:P:1'), 'auto:P:1', reintento).entradas.at(-1).estado).toBe('confirmada')
  })

  it('otro envelope para la misma corrida con distinto contenido es conflicto; con otro cmdId ni siquiera es válido', async () => {
    const { b, tel } = await llegarAlCero()
    const orden1 = ordenParadaAutomatica(tel.estado, { accionTs: T0 + 5000 })
    const p = encolar(tel.cola, tel.estado, orden1, ctxLocal(T0 + 5000))
    await ejecutar(b.adaptador, p.sobre, { recibidoEn: T0 + 5000 })

    const otro = { ...p.sobre, accionTs: T0 + 5500, accionTsCrudo: T0 + 5500, clientSeq: 3 }
    expect((await ejecutar(b.adaptador, otro, { recibidoEn: T0 + 6000 })).tipo).toBe('conflicto-contenido')
    const otroId = { ...p.sobre, cmdId: 'auto:P:otro' }
    expect((await ejecutar(b.adaptador, otroId, { recibidoEn: T0 + 6000 })).tipo).toBe('invalido')
    expect(b.adaptador.auditoria().filter((f) => f.comando === 'parada-automatica')).toHaveLength(1)
  })

  it('dos corridas distintas tienen identidades distintas aunque se parezcan: cada una tiene su propia parada', async () => {
    const { b, tel } = await llegarAlCero()
    const t1 = ordenParadaAutomatica(tel.estado, { accionTs: T0 + 5000 })
    const p1 = encolar(tel.cola, tel.estado, t1, ctxLocal(T0 + 5000))
    expect((await ejecutar(b.adaptador, p1.sobre, { recibidoEn: T0 + 5000 })).tipo).toBe('aceptado')

    // Corrección y una corrida nueva con el mismo tiempo restante: otra identidad.
    await b.enviar('corregir-reloj', { restanteMs: 5000 }, { t: T0 + 6000 })
    await b.enviar('arrancar-reloj', {}, { t: T0 + 7000 })
    const estado2 = b.adaptador.estado()
    const o2 = ordenParadaAutomatica(estado2, { accionTs: T0 + 12_000 })
    expect(o2.cmdId).not.toBe('auto:P:1')
    expect(o2.cmdId).toBe(`auto:P:${estado2.corridaSeq}`)
    const r = await b.enviar('parada-automatica', o2.datos, { cmdId: o2.cmdId, t: T0 + 12_000 })
    expect(r.tipo).toBe('aceptado')
    const paradas = b.adaptador.auditoria().filter((f) => f.comando === 'parada-automatica')
    expect(paradas.map((f) => f.corridaSeq)).toEqual([1, estado2.corridaSeq])
  })
})

describe('reconstruir el estado provisional tras recargar', () => {
  it('reproduce el mismo estado que tenía el teléfono, y detecta una base que ya no encaja', () => {
    const b = crearBanco()
    let tel = telefono(b)
    tel = pulsar(tel, 'arrancar-reloj', {}, T0).tel
    tel = pulsar(tel, 'anotar', D, T0 + 1000).tel
    tel = pulsar(tel, 'detener-reloj', {}, T0 + 2000).tel
    const r = reconstruirProvisional(b.adaptador.estado(), tel.cola, ctxLocal(T0 + 3000))
    expect(r.ok).toBe(true)
    expect(r.estado).toEqual(tel.estado)

    const otraBase = crearBanco({ reloj: { relojRestante: 300000 } }).adaptador.estado()
    const mal = reconstruirProvisional(otraBase, tel.cola, ctxLocal(T0 + 3000))
    expect(mal.ok).toBe(false)
    expect(mal.divergencia.cmdId).toBe(tel.cola.entradas[0].sobre.cmdId)
  })
})
