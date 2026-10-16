import { describe, expect, it } from 'vitest'
import { ID, T0, cmd, drenarPestana, navegadorFalso, nombreBase, pestana, servidorNuevo, tick } from './prueba/auxiliares-controlador'
import { LIMITES, leerSesion } from './sesion-almacen'
import { crearRegistroDeIntenciones, INTENCIONES } from './sesion-intencion'

// REPORT_129: parada automática al llegar a cero. El servidor es el banco sintético del motor y el tiempo es el reloj virtual de la
// pestaña (nada de tiempo real). Se mira lo que queda en el almacén durable y lo que sale por la red.

const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)
const PUNTO = (extra = {}) => ({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId: cmd('pto'), ...extra })
const autos = async (p) => (await leer(p)).entradas.filter((e) => e.cmdId.startsWith('auto:'))
const tipos = async (p) => (await leer(p)).entradas.map((e) => e.tipo)
const asentar = async () => { for (let i = 0; i < 10; i += 1) await tick() }

/** Avanza el reloj virtual (disparando en orden los temporizadores vencidos) y mantiene la hora del servidor sintético. */
async function avanzar(p, banco, ms) {
  const meta = p.rv.mono + ms
  for (;;) {
    p.rv.timers.sort((a, b) => a.en - b.en || a.id - b.id)
    const t = p.rv.timers[0]
    if (!t || t.en > meta) break
    p.rv.timers.shift()
    p.rv.mono = Math.max(p.rv.mono, t.en)
    banco.ahora = T0 + (p.rv.mono - 1000)
    t.fn()
    await asentar()
  }
  p.rv.mono = meta
  banco.ahora = T0 + (meta - 1000)
  await asentar()
}
/** Avanza SIN disparar temporizadores (el plazo vence «en silencio»): para probar el orden dentro de registrar. */
function saltarSinDisparar(p, banco, ms) { p.rv.mono += ms; banco.ahora = T0 + (p.rv.mono - 1000) }

async function conRelojCorriendo({ restanteMs = 5000, pestanaExtra = {} } = {}) {
  const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
  const a = await pestana(nav, banco, { nombreBD, ...pestanaExtra })
  await a.ctl.abrir()
  expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
  await drenarPestana(a)
  await asentar()
  expect((await a.ctl.registrar({ tipo: 'corregir-reloj', datos: { restanteMs }, cmdId: cmd('cor') })).ok).toBe(true)
  const arr = await a.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr') })
  expect(arr.ok, JSON.stringify(arr)).toBe(true)
  await drenarPestana(a)
  await asentar()
  const entradaArr = (await leer(a)).entradas.find((e) => e.cmdId.startsWith('arr'))
  const plazo = JSON.parse(entradaArr.cuerpoJson).accionTs + restanteMs // la hora de acción del arranque + lo que quedaba
  return { nav, banco, nombreBD, a, plazo }
}

describe('parada automática: plazo del motor, un solo temporizador, una sola orden', () => {
  it('no hay orden antes del plazo; al vencer se encola EXACTAMENTE una, con el cmdId fijo y la hora del plazo, y el servidor la confirma', async () => {
    const { a, banco, plazo } = await conRelojCorriendo()
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(true)
    await avanzar(a, banco, 4000)
    expect(await autos(a)).toHaveLength(0)
    await avanzar(a, banco, 1100)
    await drenarPestana(a)
    const as = await autos(a)
    expect(as).toHaveLength(1)
    expect(as[0].cmdId).toMatch(/^auto:P:/)
    expect(as[0].tipo).toBe('parada-automatica')
    const sobre = JSON.parse(as[0].cuerpoJson)
    expect(sobre.accionTs).toBe(plazo) // el plazo del motor, no la hora del dispositivo
    expect(sobre.ajusteTsMs).toBe(sobre.accionTs - sobre.accionTsCrudo)
    expect(as[0].estado).toBe('confirmada')
    expect(a.ctl.estado().sesion.provisional.partido.relojEstado).toBe('detenido')
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(false)
    await avanzar(a, banco, 60_000)
    expect(await autos(a)).toHaveLength(1)
    await a.ctl.cerrar()
  })

  it('llamadas repetidas o tardías (relecturas, avisos, un temporizador viejo) no crean una segunda parada', async () => {
    const { a, banco } = await conRelojCorriendo()
    const viejos = a.rv.timers.map((t) => t.fn) // los callbacks de ANTES del plazo
    saltarSinDisparar(a, banco, 5200)
    await Promise.all([a.ctl.releer(), a.ctl.releer(), a.ctl.releer(), a.ctl.reintentarAhora()])
    await asentar()
    for (const f of viejos) f() // se invocan tarde y repetidos
    for (const f of viejos) f()
    await asentar()
    await drenarPestana(a)
    expect(await autos(a)).toHaveLength(1)
    expect((await leer(a)).entradas.filter((e) => e.tipo === 'parada-automatica')).toHaveLength(1)
    expect(a.comandos().filter((c) => c.cuerpo.includes('"parada-automatica"'))).toHaveLength(1)
    await a.ctl.cerrar()
  })

  it('recarga: con el plazo cumplido y la parada ya guardada, la pestaña nueva no crea otra; con el plazo aún por venir vuelve a armar UN temporizador', async () => {
    const { a, banco, nav, nombreBD } = await conRelojCorriendo({ restanteMs: 20_000 })
    await a.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD })
    await p.ctl.abrir()
    await asentar()
    expect(p.ctl.estado().automatica.paradaProgramada).toBe(true)
    expect(p.rv.timers.length).toBeGreaterThan(0)
    await avanzar(p, banco, 21_000)
    await drenarPestana(p)
    expect(await autos(p)).toHaveLength(1)
    await p.ctl.cerrar()
    const q = await pestana(nav, banco, { nombreBD })
    await q.ctl.abrir()
    await asentar(); await avanzar(q, banco, 120_000)
    expect(await autos(q)).toHaveLength(1)
    expect(q.ctl.estado().automatica.paradaProgramada).toBe(false)
    await q.ctl.cerrar()
  })

  it('un paro manual, una corrección o el cierre anulan el temporizador viejo: no sale ninguna parada automática', async () => {
    const { a, banco } = await conRelojCorriendo()
    expect((await a.ctl.registrar({ tipo: 'detener-reloj', datos: {}, cmdId: cmd('det') })).ok).toBe(true)
    await asentar()
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(false)
    expect((await a.ctl.registrar({ tipo: 'corregir-reloj', datos: { restanteMs: 30_000 }, cmdId: cmd('cor2') })).ok).toBe(true)
    await drenarPestana(a)
    await avanzar(a, banco, 120_000)
    expect(await autos(a)).toHaveLength(0)
    // un arranque nuevo es OTRA corrida: su temporizador y su cmdId son nuevos
    expect((await a.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr2') })).ok).toBe(true)
    await drenarPestana(a)
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(true)
    // cerrar el partido con el reloj en marcha lo detiene y apaga el temporizador
    expect((await a.ctl.registrar({ tipo: 'cerrar-partido', datos: {}, cmdId: cmd('cie') })).ok).toBe(true)
    await asentar()
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(false)
    await drenarPestana(a)
    await avanzar(a, banco, 120_000)
    expect(await autos(a)).toHaveLength(0)
    await a.ctl.cerrar()
  })

  it('un cambio de periodo con el reloj ya detenido no deja temporizador; cada corrida usa su propio cmdId', async () => {
    const { a, banco } = await conRelojCorriendo({ restanteMs: 3000 })
    await avanzar(a, banco, 3500)
    await drenarPestana(a)
    const primera = (await autos(a))[0].cmdId
    expect((await a.ctl.registrar({ tipo: 'siguiente-periodo', datos: {}, cmdId: cmd('per') })).ok).toBe(true)
    await asentar()
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(false)
    expect((await a.ctl.registrar({ tipo: 'corregir-reloj', datos: { restanteMs: 2000 }, cmdId: cmd('cor3') })).ok).toBe(true)
    expect((await a.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr3') })).ok).toBe(true)
    await drenarPestana(a)
    await avanzar(a, banco, 2500)
    await drenarPestana(a)
    const todas = await autos(a)
    expect(todas).toHaveLength(2)
    expect(todas[1].cmdId).not.toBe(primera)
    expect(todas.every((e) => e.estado === 'confirmada')).toBe(true)
    await a.ctl.cerrar()
  })
})

describe('parada automática: orden respecto a las acciones del operador en el cero', () => {
  it('con el plazo vencido, la parada va ANTES de la acción nueva, después de lo ya guardado, y la acción se evalúa contra el estado resultante', async () => {
    const { a, banco, plazo } = await conRelojCorriendo()
    a.desconectar() // sin red: todo queda guardado en orden
    expect((await a.ctl.registrar(PUNTO({ cmdId: cmd('antes') }))).ok).toBe(true)
    const guardadas = (await leer(a)).entradas.map((e) => [e.clientSeq, e.cmdId, e.cuerpoJson])
    saltarSinDisparar(a, banco, 5300) // el plazo venció y nadie lo ha procesado todavía
    const r = await a.ctl.registrar(PUNTO({ cmdId: cmd('despues') }))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.paradaAutomatica).toMatchObject({ ok: true })
    const filas = (await leer(a)).entradas
    const ids = filas.map((e) => e.cmdId)
    expect(ids.slice(-3)).toEqual([guardadas.at(-1)[1], expect.stringMatching(/^auto:P:/), expect.stringMatching(/^despues/)])
    // lo anterior no cambió ni de lugar ni de contenido; los números de secuencia siguen siendo consecutivos
    expect(filas.slice(0, guardadas.length).map((e) => [e.clientSeq, e.cmdId, e.cuerpoJson])).toEqual(guardadas)
    expect(filas.map((e) => e.clientSeq)).toEqual(filas.map((_, i) => i + 1))
    expect(filas.filter((e) => e.cmdId.startsWith('auto:'))).toHaveLength(1)
    // la hora de la parada es el plazo del motor, NO la hora (posterior) de este dispositivo; la diferencia queda visible
    const sobreAuto = JSON.parse(filas.find((e) => e.cmdId.startsWith('auto:')).cuerpoJson)
    expect(sobreAuto.accionTs).toBe(plazo)
    expect(sobreAuto.accionTsCrudo).toBeGreaterThan(plazo)
    expect(sobreAuto.ajusteTsMs).toBe(plazo - sobreAuto.accionTsCrudo)
    expect(a.ctl.estado().sesion.provisional.partido.relojEstado).toBe('detenido')
    await a.ctl.cerrar()
  })

  it('una orden de «detener» en el cero: la parada automática va primero y la orden del operador se rechaza como «ya detenido» sin duplicar la parada', async () => {
    const { a, banco } = await conRelojCorriendo()
    saltarSinDisparar(a, banco, 5300)
    const r = await a.ctl.registrar({ tipo: 'detener-reloj', datos: {}, cmdId: cmd('det') })
    expect(r.paradaAutomatica).toMatchObject({ ok: true })
    expect(r.ok).toBe(false)
    expect(await autos(a)).toHaveLength(1)
    expect((await tipos(a)).filter((t) => t === 'detener-reloj')).toHaveLength(0)
    await a.ctl.cerrar()
  })

  it('sin plazo vencido o sin reloj en marcha, registrar no añade nada (no hay parada «de más»)', async () => {
    const { a, banco } = await conRelojCorriendo()
    saltarSinDisparar(a, banco, 2000)
    const r = await a.ctl.registrar(PUNTO())
    expect(r.ok).toBe(true)
    expect(r).not.toHaveProperty('paradaAutomatica')
    expect(await autos(a)).toHaveLength(0)
    await a.ctl.cerrar()
  })
})

describe('parada automática: sin estimación utilizable no se inventa nada', () => {
  it('salto del reloj del teléfono: la estimación deja de ser confiable; al vencer no hay parada, y los puntos siguen', async () => {
    const { a, banco } = await conRelojCorriendo()
    a.red.enLinea = false // sin red para que no se vuelva a muestrear
    a.paredExtra.ms = 600_000
    expect(a.ctl.estado().reloj.nivel).not.toBe('confiable')
    await avanzar(a, banco, 6000)
    expect(await autos(a)).toHaveLength(0)
    expect(a.comandos().filter((c) => c.cuerpo.includes('parada-automatica'))).toHaveLength(0)
    const r = await a.ctl.registrar(PUNTO())
    expect(r.ok).toBe(true)
    expect(r).not.toHaveProperty('paradaAutomatica')
    expect(await autos(a)).toHaveLength(0)
    await a.ctl.cerrar()
  })

  it('recarga sin conexión con el reloj en marcha y el plazo cumplido: sin ancla no hay parada; puntos, faltas y periodo siguen; al reconectar y volver a tener hora, se encola UNA', async () => {
    const { a, banco, nav, nombreBD } = await conRelojCorriendo()
    await a.ctl.cerrar()
    saltarSinDisparar(a, banco, 8000)
    const p = await pestana(nav, banco, { nombreBD, enLinea: false })
    p.rv.mono = a.rv.mono
    await p.ctl.abrir()
    await asentar()
    expect(p.ctl.estado().reloj.nivel).toBe('sin-estimacion')
    expect(p.ctl.estado().automatica.paradaProgramada).toBe(false)
    expect((await p.ctl.registrar(PUNTO())).ok).toBe(true)
    expect((await p.ctl.registrar({ tipo: 'falta', datos: { equipoId: 'E1', jugadorId: 'J1' }, cmdId: cmd('fal') })).ok).toBe(true)
    expect(await autos(p)).toHaveLength(0)
    banco.ahora = T0 + (p.rv.mono - 1000)
    p.conectar()
    await drenarPestana(p)
    await asentar()
    await drenarPestana(p)
    const as = await autos(p)
    expect(as).toHaveLength(1)
    expect(as[0].estado).toBe('confirmada')
    await p.ctl.cerrar()
  })
})

describe('parada automática: cierre, pérdida de propiedad y fallos', () => {
  it('cerrar el controlador cancela el temporizador y un callback viejo invocado después no escribe ni envía nada', async () => {
    const { a, banco } = await conRelojCorriendo()
    expect(a.ctl.estado().automatica.paradaProgramada).toBe(true)
    const fns = a.rv.timers.map((t) => t.fn)
    const llamadas = a.f.llamadas.length
    const cierre = await a.ctl.cerrar()
    expect(cierre).toMatchObject({ temporizadores: 0, tareas: 0 })
    saltarSinDisparar(a, banco, 8000)
    for (const f of fns) f()
    await asentar()
    expect(a.f.llamadas).toHaveLength(llamadas)
    expect(await autos(a)).toHaveLength(0)
  })

  it('una pestaña de solo lectura nunca arma ni dispara la parada', async () => {
    const { a, banco, nav, nombreBD } = await conRelojCorriendo()
    const b = await pestana(nav, banco, { nombreBD })
    await b.ctl.abrir()
    expect(b.ctl.estado().propietario).toBe(false)
    await asentar()
    expect(b.ctl.estado().automatica.paradaProgramada).toBe(false)
    expect(b.rv.timers).toHaveLength(0)
    saltarSinDisparar(b, banco, 8000)
    await b.ctl.releer()
    await asentar()
    expect(b.f.llamadas).toHaveLength(0)
    await b.ctl.cerrar(); await a.ctl.cerrar()
  })

  it('si la parada NO se puede guardar (sin espacio) no gira en vacío, no se dice «guardada» y la orden del operador sigue su camino', async () => {
    const limites = { ...LIMITES, maxComandosPartido: 3 }
    const { a, banco } = await conRelojCorriendo({ pestanaExtra: { limites } })
    const antes = (await leer(a)).entradas.length
    a.desconectar()
    saltarSinDisparar(a, banco, 5300)
    await a.ctl.releer(); await asentar()
    for (let i = 0; i < 5; i += 1) { await a.ctl.releer(); await asentar() }
    expect(await autos(a)).toHaveLength(0)
    expect((await leer(a)).entradas).toHaveLength(antes)
    expect(a.ctl.estado().automatica.parada).toMatchObject({ ok: false, motivo: expect.any(String) })
    expect(a.ctl.estado().automatica.parada.ok).toBe(false)
    expect(a.rv.timers.every((t) => t.en >= a.rv.mono)).toBe(true)
    await a.ctl.cerrar()
  })
})

describe('toques sucesivos del operador (REPORT_129, aclaración del REPORT_128)', () => {
  it('dos toques intencionales seguidos son DOS órdenes con DOS cmdId, aunque la primera aún no esté confirmada por el servidor', async () => {
    const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
    const a = await pestana(nav, banco, { nombreBD })
    await a.ctl.abrir()
    expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
    await drenarPestana(a)
    a.desconectar() // nada se confirma: las órdenes quedan «pendiente»
    const registro = crearRegistroDeIntenciones()
    const tocar = () => registro.ejecutar(INTENCIONES.anotar('E1', 'J1', 2), (cmdId) => a.ctl.registrar({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId }))
    const r1 = await tocar()
    expect(r1.resultado.ok).toBe(true)
    expect(registro.pendiente('anotar:J1:2')).toBe(false) // la promesa de la intención ya terminó
    const r2 = await tocar()
    expect(r2.resultado.ok).toBe(true)
    const puntos = (await leer(a)).entradas.filter((e) => e.tipo === 'anotar')
    expect(puntos).toHaveLength(2)
    expect(puntos.every((e) => e.estado === 'pendiente')).toBe(true)
    expect(new Set(puntos.map((e) => e.cmdId)).size).toBe(2)
    // mientras ESA promesa está pendiente, una repetición se ignora
    const [x, y] = await Promise.all([tocar(), tocar()])
    expect([x.duplicada, y.duplicada].sort()).toEqual([false, true])
    expect((await leer(a)).entradas.filter((e) => e.tipo === 'anotar')).toHaveLength(3)
    await a.ctl.cerrar()
  })
})
