import { describe, expect, it } from 'vitest'
import { ID, T0, cmd, cuerpoDeServidor, drenarPestana, navegadorFalso, nombreBase, pestana, respuesta, servidorNuevo, tick } from './prueba/auxiliares-controlador'
import { leerSesion } from './sesion-almacen'

// REPORT_129: verificación de la instantánea cuando una cola con órdenes queda totalmente resuelta. Sin sondeo, a lo sumo una cada
// 60 s por controlador abierto (con UNA comprobación diferida si se frena), solo en reposo y con conexión.

const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)
const PUNTO = (extra = {}) => ({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId: cmd('pto'), ...extra })
const asentar = async () => { for (let i = 0; i < 12; i += 1) await tick() }
const lecturasDeEstado = (p) => p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length

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

async function abierta(extra = {}) {
  const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
  const a = await pestana(nav, banco, { nombreBD, ...extra })
  await a.ctl.abrir()
  return { nav, banco, nombreBD, a }
}
const iniciar = async (a) => {
  expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
  await drenarPestana(a)
  await asentar()
}
/** Guarda `n` puntos sin red y reconecta: la cola se vacía de una vez. */
async function vaciarCola(a, n = 3) {
  a.desconectar()
  for (let i = 0; i < n; i += 1) expect((await a.ctl.registrar(PUNTO({ cmdId: cmd(`p${i}-${Math.random()}`) }))).ok).toBe(true)
  a.conectar()
  await drenarPestana(a)
  await asentar()
}

describe('verificación al vaciarse la cola', () => {
  it('una cola con órdenes que queda resuelta se verifica UNA vez; abrir sin órdenes no verifica; no hay sondeo después', async () => {
    const { a, banco } = await abierta()
    await asentar()
    expect(lecturasDeEstado(a)).toBe(0) // abrir una sesión sin cola no lee nada
    const antesInicio = lecturasDeEstado(a)
    await iniciar(a) // el inicio es una cola no vacía que se resuelve
    const durante = lecturasDeEstado(a) - antesInicio
    expect(durante).toBe(2) // la lectura del propio inicio + UNA verificación
    expect(a.ctl.estado().ultimaVerificacion).toMatchObject({ ok: true, sincronizada: true })
    expect(a.ctl.estado().sesion.nivelBase).toBe('verificada')
    const base = lecturasDeEstado(a)
    await avanzar(a, banco, 30 * 60_000) // media hora quieta: ningún sondeo
    expect(lecturasDeEstado(a)).toBe(base)
    await a.ctl.cerrar()
  })

  it('varias órdenes que se resuelven juntas, y varias señales de «cola vacía», son UNA sola verificación', async () => {
    const { a } = await abierta()
    await iniciar(a)
    const antes = lecturasDeEstado(a)
    a.desconectar()
    for (let i = 0; i < 4; i += 1) expect((await a.ctl.registrar(PUNTO({ cmdId: cmd(`q${i}`) }))).ok).toBe(true)
    expect(lecturasDeEstado(a)).toBe(antes) // sin red no se pidió nada
    a.conectar()
    await drenarPestana(a)
    await asentar()
    await Promise.all([a.ctl.releer(), a.ctl.releer()]); await asentar()
    // el inicio verificó hace menos de 60 s: ahora la verificación queda DIFERIDA, una sola
    expect(a.ctl.estado().automatica.verificacion).toBe('diferida')
    expect(lecturasDeEstado(a)).toBe(antes)
    await a.ctl.cerrar()
  })

  it('cadencia: una por 60 s; lo que se vacía antes queda en UNA comprobación diferida que se hace al cumplirse el minuto', async () => {
    const { a, banco } = await abierta()
    await iniciar(a)
    const l0 = lecturasDeEstado(a)
    await vaciarCola(a, 2)
    expect(a.ctl.estado().automatica.verificacion).toBe('diferida')
    expect(lecturasDeEstado(a)).toBe(l0)
    await vaciarCola(a, 2) // otro vaciado mientras ya hay una diferida: sigue siendo una
    expect(a.ctl.estado().automatica.verificacion).toBe('diferida')
    expect(a.rv.timers.length).toBeGreaterThan(0)
    await avanzar(a, banco, 59_000)
    expect(lecturasDeEstado(a)).toBe(l0)
    await avanzar(a, banco, 2_000)
    expect(lecturasDeEstado(a)).toBe(l0 + 1)
    expect(a.ctl.estado().automatica.verificacion).toBe('ninguna')
    expect(a.ctl.estado().ultimaVerificacion).toMatchObject({ ok: true, sincronizada: true })
    await avanzar(a, banco, 10 * 60_000)
    expect(lecturasDeEstado(a)).toBe(l0 + 1) // y después, silencio
    await a.ctl.cerrar()
  })

  it('no se verifica sin conexión ni con órdenes sin resolver', async () => {
    const { a, banco } = await abierta()
    await iniciar(a)
    await avanzar(a, banco, 61_000)
    const l0 = lecturasDeEstado(a)
    a.desconectar()
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    await asentar()
    await a.ctl.releer(); await asentar()
    expect(lecturasDeEstado(a)).toBe(l0)
    expect(a.ctl.estado().automatica.verificacion).toBe('ninguna')
    a.conectar()
    await drenarPestana(a)
    await asentar()
    expect(lecturasDeEstado(a)).toBe(l0 + 1) // al resolverse la cola, UNA
    await a.ctl.cerrar()
  })
})

describe('verificación: carreras y fallos', () => {
  it('una orden que llega MIENTRAS se lee el estado queda intacta, no sale antes de que termine la verificación y no produce una falsa divergencia', async () => {
    const { a, banco } = await abierta()
    await iniciar(a)
    await avanzar(a, banco, 61_000)
    let soltar
    a.f.guiones.estado.push(() => new Promise((resolver) => { soltar = () => resolver(respuesta(200, cuerpoDeServidor(banco))) }))
    a.desconectar()
    expect((await a.ctl.registrar(PUNTO({ cmdId: cmd('previo') }))).ok).toBe(true)
    a.conectar()
    // el envío del punto previo vacía la cola y dispara la verificación, que queda colgada leyendo
    for (let i = 0; i < 60 && !soltar; i += 1) { await tick(); if (!soltar) await drenarPestana(a, { hasta: () => !!soltar }).catch(() => {}) }
    expect(typeof soltar).toBe('function')
    const comandosAntes = a.comandos().length
    const r = await a.ctl.registrar(PUNTO({ cmdId: cmd('durante') }))
    expect(r.ok).toBe(true)
    await asentar()
    expect(a.comandos()).toHaveLength(comandosAntes) // no sale nada mientras se verifica
    soltar()
    await asentar()
    await drenarPestana(a)
    await asentar()
    expect(a.ctl.estado().ultimaVerificacion).toMatchObject({ ok: true, sincronizada: true })
    expect(a.ctl.estado().sesion.divergencia).toBeNull()
    expect(a.ctl.estado().estados).not.toContain('divergencia')
    const filas = (await leer(a)).entradas
    expect(filas.filter((e) => e.cmdId.startsWith('durante'))).toHaveLength(1)
    expect(filas.every((e) => e.estado === 'confirmada')).toBe(true) // y salió después, en orden
    await a.ctl.cerrar()
  })

  it('fallo de red, 503 o capacidad rechazada: NO se dice sincronizada y el nivel de la base no sube', async () => {
    for (const fallo of [new TypeError('sin conexión'), respuesta(503, {}), respuesta(507, {})]) {
      const { a, banco } = await abierta()
      await iniciar(a)
      expect(a.ctl.estado().sesion.nivelBase).toBe('verificada') // la del inicio
      await avanzar(a, banco, 61_000)
      a.f.guiones.estado.push(fallo)
      await vaciarCola(a, 1)
      await asentar()
      const e = a.ctl.estado() // pasó más de un minuto desde la última: la verificación se intentó en seguida y falló
      expect(e.ultimaVerificacion).toMatchObject({ ok: false, sincronizada: false })
      expect(e.estados).not.toContain('divergencia')
      expect(e.sesion.detenida).toBeNull() // un fallo de lectura no detiene nada
      expect(e.automatica.verificacion).toBe('ninguna') // y no se reintenta solo (sin sondeo)
      const lecturas = lecturasDeEstado(a)
      await avanzar(a, banco, 10 * 60_000)
      expect(lecturasDeEstado(a)).toBe(lecturas)
      await a.ctl.cerrar()
    }
  })

  it('una diferencia real con el servidor sigue el comportamiento de divergencia existente; nada se limpia solo y la orden posterior se rechaza', async () => {
    const { a, banco } = await abierta()
    await iniciar(a)
    await avanzar(a, banco, 61_000)
    a.f.guiones.estado.push(() => { const c = cuerpoDeServidor(banco); c.cursor.ultimoClientSeq += 7; return respuesta(200, c) })
    await vaciarCola(a, 1)
    await asentar()
    const e = a.ctl.estado()
    expect(e.ultimaVerificacion).toMatchObject({ ok: false, sincronizada: false, motivo: 'divergencia' })
    expect(e.estados).toContain('divergencia')
    expect(e.sesion.divergencia).toMatchObject({ causa: 'instantanea-distinta' })
    await avanzar(a, banco, 10 * 60_000)
    expect(a.ctl.estado().sesion.divergencia).not.toBeNull()
    expect(await a.ctl.registrar(PUNTO())).toMatchObject({ ok: false })
    await a.ctl.cerrar()
  })

  it('cerrar con una verificación diferida la cancela y deja el controlador sin temporizadores; un callback viejo no lee nada', async () => {
    const { a } = await abierta()
    await iniciar(a)
    await vaciarCola(a, 1)
    expect(a.ctl.estado().automatica.verificacion).toBe('diferida')
    const fns = a.rv.timers.map((t) => t.fn)
    const lecturas = a.f.llamadas.length
    const cierre = await a.ctl.cerrar()
    expect(cierre).toMatchObject({ temporizadores: 0, tareas: 0 })
    for (const f of fns) f()
    await asentar()
    expect(a.f.llamadas).toHaveLength(lecturas)
  })

  it('una pestaña de solo lectura nunca verifica', async () => {
    const { a, nav, banco, nombreBD } = await abierta()
    await iniciar(a)
    const b = await pestana(nav, banco, { nombreBD })
    await b.ctl.abrir()
    await vaciarCola(a, 1)
    await avanzar(b, banco, 120_000)
    expect(b.f.llamadas).toHaveLength(0)
    await b.ctl.cerrar(); await a.ctl.cerrar()
  })
})
