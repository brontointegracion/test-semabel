import { describe, expect, it } from 'vitest'
import { preparacionConCambioDeNumero, preparacionDePrueba } from '../motor/prueba/auxiliares-preparacion'
import {
  ID, PARTIDO, T0, cmd, cuerpoDeServidor, enviarAlServidor, reabrir, servidorNuevo, telefonoNuevo,
} from './prueba/auxiliares-sesion'
import {
  crearRelojTelefono, crearOrden, estimar, evaluarParadaAutomatica, incorporarMuestra,
} from './reloj-telefono'
import {
  aplicarRecibo, encolar, leerSesion, marcarEnviando, reanudarSesion, verificarInstantanea,
} from './sesion-almacen'
import { evaluarInicio, ordenDeInicio } from './sesion-motor'

// ---------------------------------------------------------------------------
// Escenarios de punta a punta de la parte local: sesión durable (IndexedDB falso) + servidor sintético (el procesador
// real del motor en memoria). Sin red ni controlador: el «emisor» de las pruebas marca → envía el texto guardado → aplica el
// recibo, que es lo que hará el controlador de S1b.
// ---------------------------------------------------------------------------

const L = (paredMs, monoMs, sesionId = 'p1') => ({ paredMs, monoMs, sesionId })
const SIN = estimar(crearRelojTelefono(), L(T0, 0)) // sin ninguna muestra: solo la hora cruda
const confiable = (ts) => ({ nivel: 'confiable', estimadoMs: ts, accionTsCrudo: ts + 3, discontinuidad: null, incertidumbreMs: 50, motivo: null })

async function listo(opciones = {}) {
  const banco = opciones.banco ?? servidorNuevo()
  const tel = await telefonoNuevo(banco, opciones)
  expect((await tel.crear()).ok).toBe(true)
  expect((await tel.iniciar()).ok).toBe(true)
  expect((await tel.enviarSiguiente()).aplicado.ok).toBe(true)
  return tel
}
const provisional = async (tel) => (await tel.leer()).vista.estadoProvisional
async function nueva(tel, tipo, datos = {}, estimacion = SIN, extra = {}) {
  const r = crearOrden({ estadoProvisional: await provisional(tel), tipo, datos, cmdId: cmd(tipo.slice(0, 3)), estimacion, ...extra })
  if (!r.ok) return { creada: r }
  return { creada: r, encolada: await tel.encolar(r.orden, tel.ctx({ ahoraEstimado: Math.max(tel.ahora, r.orden.tiempo.accionTs) })) }
}
const punto = (tel, equipoId, jugadorId, puntos = 2) => nueva(tel, 'anotar', { equipoId, jugadorId, puntos })
const falta = (tel, equipoId, jugadorId) => nueva(tel, 'falta', { equipoId, jugadorId })
const periodo = (tel) => nueva(tel, 'siguiente-periodo')
const todas = async (tel) => (await tel.leer()).entradas

// ---------------------------------------------------------------------------

describe('periodos 1 → 2 → 3 → 4 sin conexión: puntos y faltas por jugador y por periodo', () => {
  it('la atribución es POSICIONAL, se conserva al reconectar y el servidor llega al mismo estado', async () => {
    const tel = await listo()
    // Todo sin conexión: nada se envía hasta el final. La hora es solo la cruda del teléfono.
    const guion = [
      () => punto(tel, 'E1', 'J1', 2), () => falta(tel, 'E2', 'J9'),
      () => periodo(tel),
      () => punto(tel, 'E1', 'J2', 3), () => falta(tel, 'E1', 'J1'),
      () => periodo(tel),
      () => punto(tel, 'E2', 'J9', 1), () => punto(tel, 'E1', 'J1', 2),
      () => periodo(tel),
      () => punto(tel, 'E2', 'J8', 2), () => falta(tel, 'E1', 'J2'),
    ]
    for (const paso of guion) expect((await paso()).encolada.ok).toBe(true)
    const ultimo = await periodo(tel)
    expect(ultimo.encolada).toMatchObject({ ok: false, motivo: 'rechazo-local', rechazo: { motivo: 'ultimo-periodo' } })

    const previo = (await provisional(tel)).eventos
    const porJugadorYPeriodo = (eventos) => eventos.filter((e) => e.tipo === 'punto' || e.tipo === 'falta').map((e) => `${e.tipo}:${e.jugadorId}:p${e.periodo}`)
    expect(porJugadorYPeriodo(previo)).toEqual([
      'punto:J1:p1', 'falta:J9:p1', 'punto:J2:p2', 'falta:J1:p2', 'punto:J9:p3', 'punto:J1:p3', 'punto:J8:p4', 'falta:J2:p4',
    ])
    expect(previo.filter((e) => e.tipo === 'periodo').map((e) => e.periodo)).toEqual([1, 2, 3])
    expect((await tel.leer()).vista.confirmado.estado.eventos).toEqual([]) // nada confirmado todavía
    expect((await tel.leer()).vista.pendientes).toBe(11)

    // Reconexión: de a una, en orden, con el texto guardado.
    const salidas = await tel.enviarTodo()
    expect(salidas).toHaveLength(11)
    for (const s of salidas) expect(s.servidor.tipo).toBe('aceptado')
    const lect = await tel.leer()
    expect(lect.sesion.detenida).toBeNull()
    expect(lect.vista.pendientes).toBe(0)
    expect(porJugadorYPeriodo(lect.sesion.base.estado.eventos)).toEqual(porJugadorYPeriodo(previo))
    expect(porJugadorYPeriodo(banco(tel).adaptador.estado().eventos)).toEqual(porJugadorYPeriodo(previo))
    // La base derivada coincide con el servidor, y solo entonces se llama «verificada».
    expect(lect.vista.nivelBase).toBe('derivada')
    const v = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), ctx: tel.ctx() })
    expect(v).toMatchObject({ ok: true, verificada: true })
    expect(v.vista.nivelBase).toBe('verificada')
  })

  it('Deshacer respeta el límite de periodo: tras la transición no deshace la anterior; con un evento nuevo, solo ese', async () => {
    const tel = await listo()
    await punto(tel, 'E1', 'J1', 2)
    await periodo(tel)
    expect((await nueva(tel, 'deshacer')).encolada).toMatchObject({ ok: false, rechazo: { motivo: 'limite-periodo' } })
    expect((await nueva(tel, 'anular-evento', { eventoId: 'no-es-la-transicion' })).encolada.rechazo?.motivo).toBe('nada')
    const trans = (await provisional(tel)).eventos.find((e) => e.tipo === 'periodo')
    expect((await nueva(tel, 'anular-evento', { eventoId: trans.id })).encolada).toMatchObject({ ok: false, rechazo: { motivo: 'limite-periodo' } })
    await punto(tel, 'E1', 'J2', 3)
    expect((await nueva(tel, 'deshacer')).encolada.ok).toBe(true)
    expect((await nueva(tel, 'deshacer')).encolada).toMatchObject({ ok: false, rechazo: { motivo: 'limite-periodo' } })
    await tel.enviarTodo()
    const eventos = tel.banco.adaptador.estado().eventos
    expect(eventos.filter((e) => e.tipo !== 'periodo').map((e) => [e.jugadorId, e.periodo, e.anulado])).toEqual([['J1', 1, false], ['J2', 2, true]])
  })

  it('un punto «de antes» capturado después de la transición queda en el periodo nuevo (el motor no tiene atribución hacia atrás)', async () => {
    const tel = await listo()
    await periodo(tel)
    await punto(tel, 'E1', 'J1', 2)
    expect((await provisional(tel)).eventos.at(-1).periodo).toBe(2)
  })
})

describe('reloj sin tiempo de confianza (reglas del motor, sin cambiarlas)', () => {
  it('corregir un reloj DETENIDO funciona sin tiempo de confianza, sin conexión, y el servidor lo acepta', async () => {
    const tel = await listo()
    const r = await nueva(tel, 'corregir-reloj', { restanteMs: 540000 })
    expect(r.creada.fuente).toBe('crudo')
    expect(r.encolada.ok).toBe(true)
    expect(r.encolada.sobre.restanteVistoMs).toBe(600000)
    expect(r.encolada.sobre.ajusteTsMs).toBe(0)
    const s = await tel.enviarTodo()
    expect(s[0].servidor.tipo).toBe('aceptado')
    expect(tel.banco.adaptador.estado().partido.relojRestante).toBe(540000)
  })

  it('con el reloj EN MARCHA y sin tiempo de confianza: se puede pasar de periodo; no se puede corregir ni detener', async () => {
    const tel = await listo()
    tel.ahora = T0 + 2000
    tel.banco.ahora = T0 + 2000
    const arr = await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 2000))
    expect(arr.encolada.ok).toBe(true)
    await tel.enviarTodo()
    expect(tel.banco.adaptador.estado().partido).toMatchObject({ relojEstado: 'corriendo', relojDesde: T0 + 2000 })

    // Se pierde el tiempo de confianza (recarga sin conexión): puntos y faltas siguen…
    await punto(tel, 'E1', 'J1', 2)
    const detener = await nueva(tel, 'detener-reloj', {}, SIN)
    expect(detener.creada).toMatchObject({ ok: false, motivo: 'sin-tiempo-confiable', requiereResincronizacion: true })
    expect(detener.encolada).toBeUndefined()
    const corregir = await nueva(tel, 'corregir-reloj', { restanteMs: 400000 })
    expect(corregir.encolada).toMatchObject({ ok: false, rechazo: { motivo: 'reloj-corriendo' } })
    // …y el cambio de periodo es una acción explícita del operador, permitida por el motor con el reloj en marcha.
    const sig = await periodo(tel)
    expect(sig.encolada.ok).toBe(true)
    expect(sig.encolada.sobre.observado).toMatchObject({ relojEstado: 'corriendo', relojDesde: T0 + 2000 })
    await punto(tel, 'E2', 'J9', 3)
    await falta(tel, 'E2', 'J8')
    const s = await tel.enviarTodo()
    expect(s.every((x) => x.servidor.tipo === 'aceptado')).toBe(true)
    const e = tel.banco.adaptador.estado()
    expect(e.partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    expect(e.corridaSeq).toBeNull()
    expect(e.eventos.filter((x) => x.tipo !== 'periodo').map((x) => `${x.jugadorId}:p${x.periodo}`)).toEqual(['J1:p1', 'J9:p2', 'J8:p2'])
    // la auditoría registra que el periodo cambió con el reloj en marcha
    expect(tel.banco.adaptador.auditoria().at(-1)).toMatchObject({ comando: 'reinicio-periodo', antes: { relojEstado: 'corriendo' } })
  })

  it('una hora cruda lejana en el futuro de un PUNTO no envenena el reloj: después, con tiempo de confianza, el servidor acepta', async () => {
    const tel = await listo()
    const lejos = await nueva(tel, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { accionTsCrudo: T0 + 7_200_000, estimadoMs: null, nivel: 'sin-estimacion', discontinuidad: null })
    expect(lejos.encolada.sobre.accionTs).toBe(T0 + 7_200_000)
    tel.ahora = T0 + 3000
    tel.banco.ahora = T0 + 3000
    const arr = await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 3000))
    expect(arr.encolada.ok).toBe(true)
    const s = await tel.enviarTodo()
    expect(s.map((x) => x.servidor.tipo)).toEqual(['aceptado', 'aceptado'])
    expect(tel.banco.adaptador.estado().cursorReloj).toBe(T0 + 3000)
    // la advertencia de hora futura de un punto sale como aviso de recepción, no como rechazo
    expect(s[0].servidor.recibo.meta.advertenciasRecepcion).toContain('tiempo-futuro')
  })
})

describe('un comando de reloj rechazado conserva las transiciones y los puntos que dependían de él', () => {
  async function conRechazo() {
    const tel = await listo()
    tel.ahora = T0 + 10_000 // el teléfono cree estar 10 s adelante; el servidor recibirá «antes»
    const arr = await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 10_000))
    expect(arr.encolada.ok).toBe(true)
    await periodo(tel)
    await punto(tel, 'E1', 'J1', 2)
    await falta(tel, 'E2', 'J9')
    const antes = await todas(tel)
    tel.banco.ahora = T0 // hora del servidor al recibir: 10 s antes de la acción
    const s = await tel.enviarSiguiente({ recibidoEn: T0 })
    return { tel, antes, s }
  }
  it('el servidor rechaza, la secuencia decidida avanza, la revisión no, y las dependientes se conservan sin tocarse', async () => {
    const { tel, antes, s } = await conRechazo()
    expect(s.servidor.tipo).toBe('rechazado')
    expect(s.servidor.recibo.motivo).toBe('tiempo-invalido')
    expect(s.aplicado.ok).toBe(true)
    const lect = await tel.leer()
    expect(lect.sesion.base.ultimoClientSeq).toBe(2) // inicio (1) + el arranque rechazado (2)
    expect(lect.sesion.base.estado.rev).toBe(1)
    expect(lect.sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo', motivo: 'tiempo-invalido' })
    const estados = lect.entradas.map((f) => f.estado)
    expect(estados).toEqual(['confirmada', 'rechazada', 'no-aplicada', 'no-aplicada', 'no-aplicada'])
    for (const f of lect.entradas.slice(1)) expect(f.cuerpoJson).toBe(antes.find((x) => x.cmdId === f.cmdId).cuerpoJson)
    expect(lect.entradas.filter((f) => f.estado === 'no-aplicada').every((f) => f.motivoNoAplicada === 'dependiente-de-rechazo' && f.reserva === 0)).toBe(true)
    expect(lect.vista.puntuacion.habilitada).toBe(true) // el inicio sigue confirmado; la cola está detenida
    // nada se reintroduce solo y no se envía lo que quedó en pausa
    expect(await tel.encolar(tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }))).toMatchObject({ ok: false, rechazo: { motivo: 'cola-detenida' } })
    expect(await tel.enviarSiguiente()).toEqual({ nada: true }) // no queda nada vivo que enviar
    const dependiente = lect.entradas.find((f) => f.estado === 'no-aplicada')
    expect(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: dependiente.cmdId, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'cola-detenida' })
    expect(tel.banco.adaptador.estado().eventos).toEqual([])
  })
  it('reanudar exige la confirmación del operador y una instantánea fresca; lo preservado sigue ahí y se actúa con cmdId nuevos', async () => {
    const { tel, antes } = await conRechazo()
    const fresca = cuerpoDeServidor(tel.banco)
    const sin = await reanudarSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: fresca, confirmadoPorOperador: false, ctx: tel.ctx() })
    expect(sin).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    const ok = await reanudarSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: fresca, confirmadoPorOperador: true, ctx: tel.ctx() })
    expect(ok.ok).toBe(true)
    tel.revision = ok.vista.revision
    const lect = await tel.leer()
    expect(lect.sesion.detenida).toBeNull()
    expect(lect.vista.nivelBase).toBe('verificada')
    expect(lect.entradas.map((f) => f.estado)).toEqual(['confirmada', 'rechazada', 'no-aplicada', 'no-aplicada', 'no-aplicada'])
    for (const f of lect.entradas.slice(1)) expect(f.cuerpoJson).toBe(antes.find((x) => x.cmdId === f.cmdId).cuerpoJson)
    // el operador vuelve a registrar el cambio de periodo y los puntos: son órdenes NUEVAS con números nuevos
    tel.ahora = T0
    const sig = await periodo(tel)
    expect(sig.encolada.ok).toBe(true)
    expect(sig.encolada.sobre.clientSeq).toBe(3)
    expect(antes.some((f) => f.cmdId === sig.encolada.sobre.cmdId)).toBe(false)
    // la regla de límite de periodo sigue vigente
    expect((await nueva(tel, 'deshacer')).encolada).toMatchObject({ ok: false, rechazo: { motivo: 'limite-periodo' } })
    const p2 = await punto(tel, 'E1', 'J1', 2)
    expect(p2.encolada.sobre.observado.periodo).toBe(2)
    const s = await tel.enviarTodo()
    expect(s.every((x) => x.servidor.tipo === 'aceptado')).toBe(true)
    expect(tel.banco.adaptador.estado().eventos.map((e) => `${e.tipo}:p${e.periodo}`)).toEqual(['periodo:p1', 'punto:p2'])
  })
  it('un instantánea que no coincide con el cursor recibido no reanuda', async () => {
    const { tel } = await conRechazo()
    const rara = cuerpoDeServidor(tel.banco)
    rara.cursor.ultimoClientSeq += 1
    expect(await reanudarSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: rara, confirmadoPorOperador: true, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'servidor-no-coincide' })
  })
})

describe('inicio del partido', () => {
  it('sin conexión no se puede pedir; encolado, no se puntúa hasta que un recibo lo confirme', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    const lect = await tel.leer()
    const prep = preparacionDePrueba(PARTIDO)
    expect(evaluarInicio({ enLinea: false, sesion: lect.sesion, entradas: [], preparacion: prep }).motivo).toBe('sin-internet')
    const o = ordenDeInicio({ cmdId: 'ini', preparacion: prep, tiempo: tel.orden('x').tiempo, sesion: lect.sesion }).orden
    expect(await tel.encolar(o, tel.ctx({ enLinea: false }))).toMatchObject({ ok: false, motivo: 'sin-internet' })
    expect(await punto(tel, 'E1', 'J1')).toMatchObject({ encolada: { ok: false, motivo: 'inicio-no-confirmado' } })
    expect((await tel.encolar(o)).ok).toBe(true)
    // el provisional dice «vivo», pero nada se puntúa
    expect((await provisional(tel)).partido.estado).toBe('vivo')
    expect((await punto(tel, 'E1', 'J1')).encolada).toMatchObject({ ok: false, motivo: 'inicio-en-curso' })
    expect((await tel.leer()).vista.puntuacion).toEqual({ habilitada: false, motivo: 'inicio-en-curso' })
    await tel.enviarSiguiente()
    expect((await tel.leer()).vista.puntuacion.habilitada).toBe(true)
    expect((await punto(tel, 'E1', 'J1')).encolada.ok).toBe(true)
  })

  it('respuesta perdida: el sobre ORIGINAL se reenvía y el recibo-existente lo resuelve, aunque la plantilla haya cambiado después', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    await tel.iniciar()
    const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: (await todas(tel))[0].cmdId, ctx: tel.ctx() })
    tel.revision = m.vista.revision
    const primero = await enviarAlServidor(banco, m.cuerpoJson) // el servidor aceptó… y la respuesta se perdió
    expect(primero.tipo).toBe('aceptado')
    banco.adaptador.fijarPreparacion(preparacionConCambioDeNumero(PARTIDO)) // la plantilla cambió después
    // «recarga»: otra pestaña/sesión de página lee lo guardado y no infiere nada
    const otra = await reabrir(tel.almacen)
    const lect = await leerSesion(otra, ID, tel.ctx())
    expect(lect.entradas[0].estado).toBe('enviando')
    expect(lect.sesion.inicio).toBe('sin-iniciar') // la aceptación NO se infiere del estado del servidor ni del provisional
    const m2 = await marcarEnviando(otra, { id: ID, revision: lect.sesion.revision, cmdId: lect.entradas[0].cmdId, ctx: tel.ctx() })
    expect(m2.intentos).toBe(2)
    expect(m2.cuerpoJson).toBe(m.cuerpoJson)
    const segundo = await enviarAlServidor(banco, m2.cuerpoJson)
    expect(segundo.tipo).toBe('recibo-existente')
    expect(segundo.recibo).toEqual(primero.recibo)
    const ap = await aplicarRecibo(otra, { id: ID, revision: m2.vista.revision, recibo: segundo.recibo, ctx: tel.ctx() })
    expect(ap.ok).toBe(true)
    expect((await leerSesion(otra, ID)).sesion.inicio).toBe('confirmado')
  })

  it('inicio rechazado por preparación vieja: sin puntuar, con insumos frescos, confirmación y un cmdId NUEVO', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    const inicio = await tel.iniciar()
    expect(inicio.ok).toBe(true)
    const viejo = (await todas(tel))[0].cmdId
    banco.adaptador.fijarPreparacion(preparacionConCambioDeNumero(PARTIDO))
    const s = await tel.enviarSiguiente()
    expect(s.servidor.tipo).toBe('rechazado')
    expect(s.servidor.recibo.motivo).toBe('preparacion-desactualizada')
    let lect = await tel.leer()
    expect(lect.sesion.inicio).toBe('sin-iniciar')
    expect(lect.entradas[0].estado).toBe('rechazada')
    expect(lect.vista.puntuacion).toEqual({ habilitada: false, motivo: 'inicio-rechazado' })
    expect((await punto(tel, 'E1', 'J1')).encolada).toMatchObject({ ok: false, motivo: 'inicio-rechazado' })
    // sin reanudar no hay otro inicio
    const nuevaPrep = preparacionConCambioDeNumero(PARTIDO)
    const ordenNueva = (cmdId) => ordenDeInicio({ cmdId, preparacion: nuevaPrep, tiempo: tel.orden('x').tiempo, sesion: lect.sesion }).orden
    expect(await tel.encolar(ordenNueva('otro-inicio'))).toMatchObject({ ok: false, rechazo: { motivo: 'cola-detenida' } })
    // reanudar: preparación vieja o sin confirmar, no
    const base = { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), ctx: tel.ctx() }
    expect(await reanudarSesion(tel.almacen, { ...base, preparacion: nuevaPrep, confirmadoPorOperador: false })).toMatchObject({ motivo: 'falta-confirmacion' })
    expect(await reanudarSesion(tel.almacen, { ...base, preparacion: null, confirmadoPorOperador: true })).toMatchObject({ motivo: 'preparacion-no-disponible' })
    const ok = await reanudarSesion(tel.almacen, { ...base, preparacion: nuevaPrep, confirmadoPorOperador: true })
    expect(ok.ok).toBe(true)
    tel.revision = ok.vista.revision
    // el cmdId viejo no sirve; uno nuevo sí, con la versión de preparación fresca
    expect(await tel.encolar(ordenNueva(viejo))).toMatchObject({ ok: false, motivo: 'cmdId-reutilizado' })
    const nuevo = await tel.encolar(ordenNueva('inicio-2'))
    expect(nuevo.ok).toBe(true)
    expect(nuevo.sobre.clientSeq).toBe(2)
    expect(nuevo.sobre.preparacionVersion).toBe(nuevaPrep.version)
    const s2 = await tel.enviarSiguiente()
    expect(s2.servidor.tipo).toBe('aceptado')
    lect = await tel.leer()
    expect(lect.sesion.inicio).toBe('confirmado')
    expect(lect.entradas.map((f) => f.estado)).toEqual(['rechazada', 'confirmada']) // el rechazo se conserva
  })
})

describe('recarga, caída y reintentos exactos', () => {
  it('tras reabrir la base el estado provisional es el mismo y el reenvío de «enviando» usa el texto guardado', async () => {
    const tel = await listo()
    await punto(tel, 'E1', 'J1', 2)
    await falta(tel, 'E2', 'J9')
    const antes = await provisional(tel)
    const textos = (await todas(tel)).map((f) => f.cuerpoJson)
    const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: (await todas(tel))[1].cmdId, ctx: tel.ctx() }) // se marcó… y la página murió
    tel.almacen.cerrar()
    const nuevaPagina = await reabrir(tel.almacen)
    const lect = await leerSesion(nuevaPagina, ID, tel.ctx({ ahoraEstimado: T0 - 99_999 })) // reloj atrasado: sin falso aviso
    expect(lect.ok).toBe(true)
    expect(lect.vista.estadoProvisional).toEqual(antes)
    expect(lect.entradas.map((f) => f.cuerpoJson)).toEqual(textos)
    expect(lect.entradas[1]).toMatchObject({ estado: 'enviando', intentos: 1 })
    const m2 = await marcarEnviando(nuevaPagina, { id: ID, revision: lect.sesion.revision, cmdId: lect.entradas[1].cmdId, ctx: tel.ctx() })
    expect(m2.cuerpoJson).toBe(m.cuerpoJson)
  })
  it('el estado final tras fallas del almacén en cada paso es el de una corrida sin fallas', async () => {
    const guion = async (tel) => {
      await punto(tel, 'E1', 'J1', 2)
      await periodo(tel)
      await falta(tel, 'E2', 'J9')
    }
    const limpio = await listo()
    await guion(limpio)
    await limpio.enviarTodo()

    const roto = await listo()
    let fallos = 0
    roto.almacen.gancho = (i) => { if (i.fase === 'antes-de-confirmar' && fallos < 6) { fallos += 1; throw new DOMException('x', 'QuotaExceededError') } }
    const reintentar = async (fn) => { for (let k = 0; k < 10; k += 1) { const r = await fn(); if (r?.ok || r?.aplicado?.ok) return r } return null }
    await reintentar(() => punto(roto, 'E1', 'J1', 2).then((x) => x.encolada))
    await reintentar(() => periodo(roto).then((x) => x.encolada))
    await reintentar(() => falta(roto, 'E2', 'J9').then((x) => x.encolada))
    for (let k = 0; k < 40; k += 1) { const r = await roto.enviarSiguiente(); if (r.nada) break }
    roto.almacen.gancho = null
    for (let k = 0; k < 10; k += 1) { const r = await roto.enviarSiguiente(); if (r.nada) break }
    expect(fallos).toBe(6)
    const A = (await limpio.leer()).sesion
    const B = (await roto.leer()).sesion
    const sinCmd = (e) => e.map((x) => ({ ...x, id: undefined }))
    expect(B.base.estado.rev).toBe(A.base.estado.rev)
    expect(B.base.ultimoClientSeq).toBe(A.base.ultimoClientSeq)
    expect(sinCmd(B.base.estado.eventos).map((e) => [e.tipo, e.periodo, e.jugadorId])).toEqual(sinCmd(A.base.estado.eventos).map((e) => [e.tipo, e.periodo, e.jugadorId]))
  })
  it('el servidor y la base derivada coinciden tras una recarga y varios envíos', async () => {
    const tel = await listo()
    for (const f of [() => punto(tel, 'E1', 'J1', 3), () => periodo(tel), () => falta(tel, 'E1', 'J2')]) await f()
    const otra = await reabrir(tel.almacen)
    tel.almacen = otra
    await tel.enviarTodo()
    const v = await verificarInstantanea(otra, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), ctx: tel.ctx() })
    expect(v.ok).toBe(true)
  })
})

describe('el estimador cambia, los sobres guardados NO', () => {
  it('una resincronización posterior no reescribe ni una hora ni un byte de lo ya guardado', async () => {
    const tel = await listo()
    let reloj = incorporarMuestra(crearRelojTelefono(), { servidorAhoraMs: T0, rttMs: 80 }, L(T0 + 5000, 0)).reloj
    tel.ahora = T0 + 100
    const e1 = estimar(reloj, L(T0 + 5100, 100))
    expect((await nueva(tel, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, e1)).encolada.ok).toBe(true)
    expect((await nueva(tel, 'siguiente-periodo', {}, e1)).encolada.ok).toBe(true)
    const antes = (await todas(tel)).map((f) => f.cuerpoJson)
    const horas = antes.map((t) => JSON.parse(t).accionTs)
    // una muestra nueva dice que el servidor está 3 s más adelante
    reloj = incorporarMuestra(reloj, { servidorAhoraMs: T0 + 3000 + 100, rttMs: 60 }, L(T0 + 5100, 100)).reloj
    const e2 = estimar(reloj, L(T0 + 5200, 200))
    expect(e2.estimadoMs).not.toBe(e1.estimadoMs)
    expect((await nueva(tel, 'anotar', { equipoId: 'E2', jugadorId: 'J9', puntos: 1 }, e2)).encolada.ok).toBe(true)
    const despues = await todas(tel)
    expect(despues.slice(1, 3).map((f) => f.cuerpoJson)).toEqual(antes.slice(1, 3))
    expect(JSON.parse(despues[3].cuerpoJson).accionTs).toBeGreaterThan(horas[0])
    await tel.enviarTodo()
    expect((await todas(tel)).slice(1, 3).map((f) => f.cuerpoJson)).toEqual(antes.slice(1, 3)) // tampoco al resolverse
  })
})

describe('deriva, sueño, salto de pared y recarga sin conexión, frente al servidor real', () => {
  const muestra = (servidorMs, lectura) => incorporarMuestra(crearRelojTelefono(), { servidorAhoraMs: servidorMs, rttMs: 100 }, lectura).reloj

  it('una orden con tiempo de confianza, con estimación utilizable, la acepta el servidor', async () => {
    const tel = await listo()
    const reloj = muestra(T0 + 5000, L(T0 + 5050, 10))
    tel.ahora = T0 + 5100
    tel.banco.ahora = T0 + 5100
    const est = estimar(reloj, L(T0 + 5150, 110))
    expect(est.nivel).toBe('confiable')
    expect((await nueva(tel, 'arrancar-reloj', {}, est)).encolada.ok).toBe(true)
    expect((await tel.enviarTodo())[0].servidor.tipo).toBe('aceptado')
  })

  it('tras un sueño (pared adelanta al monótono) se bloquean las órdenes de reloj, los puntos siguen y registran la discontinuidad', async () => {
    const tel = await listo()
    const reloj = muestra(T0 + 5000, L(T0 + 5050, 10))
    const dormido = estimar(reloj, L(T0 + 5050 + 600_000, 10 + 200)) // la pared avanzó 10 min; el monótono, 200 ms
    expect(dormido).toMatchObject({ nivel: 'degradado', motivo: 'salto-de-reloj' })
    expect((await nueva(tel, 'arrancar-reloj', {}, dormido)).creada).toMatchObject({ ok: false, motivo: 'sin-tiempo-confiable' })
    const p = await nueva(tel, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, dormido)
    expect(p.creada.fuente).toBe('estimado-degradado')
    expect(p.encolada.sobre.discontinuidad).toEqual({ saltoMs: 599_800, causa: 'pared-adelanta-al-monotono' })
    const s = await tel.enviarTodo()
    expect(s[0].servidor.recibo.advertencias).toEqual(expect.arrayContaining(['discontinuidad-reloj-dispositivo', 'ajuste-de-tiempo']))
    // una muestra nueva restablece la confianza y entonces SÍ se crea y el servidor acepta
    const nuevoReloj = incorporarMuestra(reloj, { servidorAhoraMs: T0 + 9000, rttMs: 90 }, L(T0 + 5050 + 600_000 + 5000, 300)).reloj
    tel.ahora = T0 + 9100
    tel.banco.ahora = T0 + 9100
    const est = estimar(nuevoReloj, L(T0 + 5050 + 600_000 + 5100, 400))
    expect(est.nivel).toBe('confiable')
    expect((await nueva(tel, 'arrancar-reloj', {}, est)).encolada.ok).toBe(true)
    expect((await tel.enviarTodo())[0].servidor.tipo).toBe('aceptado')
  })

  it('recarga sin conexión: las órdenes de reloj esperan una muestra; puntos, periodo y corrección del reloj detenido siguen', async () => {
    const tel = await listo()
    const reloj = JSON.parse(JSON.stringify(muestra(T0 + 5000, L(T0 + 5050, 10))))
    const recargado = estimar(reloj, L(T0 + 5050 + 90_000, 3, 'p2'))
    expect(recargado.nivel).toBe('degradado')
    expect((await nueva(tel, 'arrancar-reloj', {}, recargado)).creada.ok).toBe(false)
    expect((await punto(tel, 'E1', 'J1', 2)).encolada.ok).toBe(true)
    expect((await nueva(tel, 'corregir-reloj', { restanteMs: 590000 }, recargado)).encolada.ok).toBe(true)
    expect((await periodo(tel)).encolada.ok).toBe(true)
    const s = await tel.enviarTodo()
    expect(s.every((x) => x.servidor.tipo === 'aceptado')).toBe(true)
  })

  it('seguro frente a rechazo repetido: el ajuste de ≤ 500 ms por detrás se acepta; más allá no se crea ninguna orden', async () => {
    const tel = await listo()
    tel.ahora = T0 + 1000
    tel.banco.ahora = T0 + 1000
    expect((await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 1000))).encolada.ok).toBe(true)
    await tel.enviarTodo() // relojDesde = T0 + 1000
    // La estimación quedó 300 ms por detrás del ancla: se sube a la marca de agua y el servidor acepta (no tiempo-invalido)
    tel.ahora = T0 + 5000
    tel.banco.ahora = T0 + 5000
    const detras = await nueva(tel, 'detener-reloj', {}, confiable(T0 + 700))
    expect(detras.creada).toMatchObject({ ok: true, ajustadoPorRetroceso: true })
    expect(detras.encolada.sobre.accionTs).toBe(T0 + 1000)
    const s = await tel.enviarSiguiente({ recibidoEn: T0 + 5000 })
    expect(s.servidor.tipo).toBe('aceptado')
    // 4 s por detrás (ejemplo B del informe): no se crea nada y se pide resincronizar
    const r = await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 1000 - 4000))
    expect(r.creada).toMatchObject({ ok: false, motivo: 'estimacion-detras-del-reloj' })
    expect(r.creada.faltaMs).toBeGreaterThan(500)
    expect(r.encolada).toBeUndefined()
  })

  it('los parámetros son diagnósticos, no garantías: el servidor decide con SU hora de recepción', async () => {
    const tel = await listo()
    const intento = async (adelanto, cmdId) => {
      tel.ahora = T0 + 20_000
      tel.banco.ahora = T0 + 20_000
      const e = await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 20_000 + adelanto))
      return { e, s: await tel.enviarSiguiente({ recibidoEn: T0 + 20_000 }), cmdId }
    }
    const dentro = await intento(2000, 'a')
    expect(dentro.s.servidor.tipo).toBe('aceptado') // justo en la tolerancia de 2000 ms
    const tel2 = await listo()
    tel2.ahora = T0 + 20_000
    const e = await nueva(tel2, 'arrancar-reloj', {}, confiable(T0 + 22_001))
    expect(e.encolada.ok).toBe(true) // el teléfono creía estar bien…
    const s = await tel2.enviarSiguiente({ recibidoEn: T0 + 20_000 })
    expect(s.servidor.recibo.motivo).toBe('tiempo-invalido') // …y el servidor lo rechazó
    expect((await tel2.leer()).sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo' })
  })
})

describe('parada automática', () => {
  async function conCorrida() {
    const tel = await listo()
    tel.ahora = T0 + 1000
    tel.banco.ahora = T0 + 1000
    expect((await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 1000))).encolada.ok).toBe(true)
    await tel.enviarTodo()
    return { tel, plazo: T0 + 1000 + 600_000 }
  }
  it('no vencida / incierta / vencida; el servidor la acepta con el plazo calculado; sin duplicados, tampoco tras recargar', async () => {
    const { tel, plazo } = await conCorrida()
    const prov = await provisional(tel)
    expect(evaluarParadaAutomatica(prov, confiable(plazo - 500))).toMatchObject({ estado: 'no-vencida', faltaMs: 500 })
    expect(evaluarParadaAutomatica(prov, { nivel: 'degradado', motivo: 'ancla-perdida', estimadoMs: plazo + 10_000, accionTsCrudo: plazo + 10_000, discontinuidad: null }).estado).toBe('incierta')

    const vencida = evaluarParadaAutomatica(prov, confiable(plazo + 40))
    expect(vencida).toMatchObject({ estado: 'vencida', vencimientoMs: plazo })
    tel.ahora = plazo + 40
    const e = await tel.encolar(vencida.orden)
    expect(e.ok).toBe(true)
    expect(e.sobre).toMatchObject({ cmdId: 'auto:P:2', accionTs: plazo, accionTsCrudo: plazo + 43, ajusteTsMs: -43, restanteVistoMs: 0 })

    // ya encolada: el provisional está detenido → nada que evaluar; el mismo cmdId otra vez es duplicada; tampoco tras recargar
    expect(evaluarParadaAutomatica(await provisional(tel), confiable(plazo + 80)).estado).toBe('no-aplica')
    expect(await tel.encolar(vencida.orden)).toMatchObject({ ok: true, duplicada: true })
    const otra = await reabrir(tel.almacen)
    const lect = await leerSesion(otra, ID, tel.ctx())
    expect(evaluarParadaAutomatica(lect.vista.estadoProvisional, confiable(plazo + 90)).estado).toBe('no-aplica')
    expect(lect.entradas.filter((f) => f.cmdId === 'auto:P:2')).toHaveLength(1)

    tel.banco.ahora = plazo + 100
    const s = await tel.enviarSiguiente({ recibidoEn: plazo + 100 })
    expect(s.servidor.tipo).toBe('aceptado')
    expect(s.servidor.recibo.advertencias).toContain('ajuste-de-tiempo') // el ajuste queda visible
    expect(tel.banco.adaptador.estado().partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 0 })
    expect(tel.banco.adaptador.auditoria().at(-1)).toMatchObject({ origen: 'sistema', ceroEnDerivado: plazo })
  })
  it('una nueva corrida tiene otro cmdId (auto:{partido}:{corridaSeq}) y la anterior no se repite', async () => {
    const { tel, plazo } = await conCorrida()
    const p1 = evaluarParadaAutomatica(await provisional(tel), confiable(plazo))
    tel.ahora = plazo
    await tel.encolar(p1.orden)
    tel.banco.ahora = plazo
    await tel.enviarTodo()
    // corregir el reloj y arrancar de nuevo → corridaSeq distinto
    expect((await nueva(tel, 'corregir-reloj', { restanteMs: 60_000 })).encolada.ok).toBe(true)
    tel.ahora = plazo + 5000
    tel.banco.ahora = plazo + 5000
    expect((await nueva(tel, 'arrancar-reloj', {}, confiable(plazo + 5000))).encolada.ok).toBe(true)
    await tel.enviarTodo()
    const p2 = evaluarParadaAutomatica(await provisional(tel), confiable(plazo + 5000 + 60_000))
    expect(p2.estado).toBe('vencida')
    expect(p2.orden.cmdId).not.toBe(p1.orden.cmdId)
    expect(p2.orden.cmdId).toBe(`auto:P:${tel.banco.adaptador.estado().corridaSeq}`)
  })
})

describe('forma de los comandos: la reserva cubre cada uno y nunca se supera', () => {
  it('las 12 órdenes admitidas, con su aceptación real, resuelven dentro de lo reservado', async () => {
    const tel = await listo()
    let ts = T0 + 1000
    const pasos = []
    const paso = async (tipo, datos = {}, estimacion = SIN, extra = {}) => {
      ts += 1000
      tel.ahora = ts
      tel.banco.ahora = ts
      const uso0 = (await tel.leer()).sesion.uso
      const r = await nueva(tel, tipo, datos, estimacion, extra)
      expect(r.encolada?.ok, `${tipo}: ${JSON.stringify(r.creada)} ${JSON.stringify(r.encolada)}`).toBe(true)
      const uso1 = (await tel.leer()).sesion.uso
      const s = await tel.enviarSiguiente()
      expect(s.servidor.tipo, tipo).toBe('aceptado')
      const uso2 = (await tel.leer()).sesion.uso
      pasos.push({ tipo, comprometido: uso1.bytes + uso1.reservado - (uso0.bytes + uso0.reservado), alResolver: uso2.bytes + uso2.reservado - (uso0.bytes + uso0.reservado) })
      expect(uso2.sobreReserva, tipo).toBe(false)
      expect(uso2.bytes + uso2.reservado, tipo).toBeLessThanOrEqual(uso1.bytes + uso1.reservado)
      return r
    }
    await paso('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 })
    await paso('falta', { equipoId: 'E2', jugadorId: 'J9' })
    await paso('deshacer')
    await paso('rehacer')
    const a2 = await paso('anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 })
    await paso('anular-evento', { eventoId: a2.encolada.sobre.cmdId })
    await paso('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 1 }) // bloquea el rehacer de lo anulado (actualiza eventos)
    await paso('arrancar-reloj', {}, confiable(ts + 1000))
    await paso('detener-reloj', {}, confiable(ts + 1000))
    await paso('corregir-reloj', { restanteMs: 500_000 })
    await paso('arrancar-reloj', {}, confiable(ts + 1000))
    const prov = await provisional(tel)
    const plazo = prov.partido.relojDesde + prov.partido.relojRestante
    ts = plazo
    tel.ahora = plazo
    tel.banco.ahora = plazo + 10
    const auto = evaluarParadaAutomatica(prov, confiable(plazo))
    const uso0 = (await tel.leer()).sesion.uso
    expect((await tel.encolar(auto.orden)).ok).toBe(true)
    const uso1 = (await tel.leer()).sesion.uso
    expect((await tel.enviarSiguiente({ recibidoEn: plazo + 10 })).servidor.tipo).toBe('aceptado')
    const uso2 = (await tel.leer()).sesion.uso
    expect(uso2.sobreReserva).toBe(false)
    expect(uso2.bytes + uso2.reservado).toBeLessThanOrEqual(uso1.bytes + uso1.reservado)
    expect(uso0.bytes).toBeLessThan(uso1.bytes)
    await paso('siguiente-periodo')
    await paso('cerrar-partido')
    // el ejercicio recorrió todos los tipos
    const tipos = new Set((await todas(tel)).map((f) => f.tipo))
    for (const t of ['iniciar-partido', 'anotar', 'falta', 'deshacer', 'rehacer', 'anular-evento', 'arrancar-reloj', 'detener-reloj', 'corregir-reloj', 'parada-automatica', 'siguiente-periodo', 'cerrar-partido']) expect(tipos.has(t), t).toBe(true)
    for (const p of pasos) expect(p.alResolver).toBeLessThanOrEqual(p.comprometido)
    // al final, base derivada = servidor
    const v = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), ctx: tel.ctx() })
    expect(v.ok).toBe(true)
  })
  it('y también la forma de un rechazo del servidor', async () => {
    const tel = await listo()
    tel.ahora = T0 + 10_000
    await nueva(tel, 'arrancar-reloj', {}, confiable(T0 + 10_000))
    await periodo(tel)
    const u1 = (await tel.leer()).sesion.uso
    const s = await tel.enviarSiguiente({ recibidoEn: T0 })
    expect(s.servidor.tipo).toBe('rechazado')
    const u2 = (await tel.leer()).sesion.uso
    expect(u2.sobreReserva).toBe(false)
    expect(u2.bytes + u2.reservado).toBeLessThanOrEqual(u1.bytes + u1.reservado)
    expect(u2.reservado).toBe(0)
  })
})

describe('un envío en orden, uno a la vez', () => {
  it('no se puede marcar una entrada que no es la primera viva, ni dos a la vez', async () => {
    const tel = await listo()
    await punto(tel, 'E1', 'J1', 2)
    await falta(tel, 'E2', 'J9')
    const [, a, b] = await todas(tel)
    expect(await marcarEnviando(tel.almacen, { id: ID, cmdId: b.cmdId, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'fuera-de-orden' })
    expect((await marcarEnviando(tel.almacen, { id: ID, cmdId: a.cmdId, ctx: tel.ctx() })).ok).toBe(true)
    expect(await marcarEnviando(tel.almacen, { id: ID, cmdId: b.cmdId, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'fuera-de-orden' })
  })
})

const banco = (tel) => tel.banco
void encolar
