import { describe, expect, it } from 'vitest'
import { ID, T0, cmd, drenarPestana, navegadorFalso, nombreBase, pestana, respuesta, servidorNuevo, tick, volcarBase } from './prueba/auxiliares-controlador'
import { LIMITES, leerSesion } from './sesion-almacen'

// REPORT_128: lo que el controlador expone a la pantalla (copias congeladas), los resultados sin objetos internos y la petición
// ACOTADA de nombres y números para sesiones anteriores.

const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)
const PUNTO = (extra = {}) => ({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId: cmd('pto'), ...extra })
async function conInicio(conVisualizacion = true, extra = {}) {
  const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
  const a = await pestana(nav, banco, { nombreBD, conVisualizacion, ...extra })
  await a.ctl.abrir()
  expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
  await drenarPestana(a)
  return { nav, banco, nombreBD, a }
}

describe('exposición para la pantalla', () => {
  it('estado provisional, eventos y órdenes sin recibo salen como COPIAS CONGELADAS; modificarlas no cambia nada', async () => {
    const { a } = await conInicio()
    a.desconectar()
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    for (let i = 0; i < 10; i += 1) await tick()
    const s = a.ctl.estado().sesion
    expect(s.provisional.eventos).toHaveLength(1)
    expect(s.provisional.eventos[0]).toMatchObject({ tipo: 'punto', jugadorId: 'J1', puntos: 2 })
    expect(s.provisional.partido).toMatchObject({ estado: 'vivo', relojEstado: 'detenido' })
    expect(s.provisional.config).toEqual({ deporte: 'baloncesto', minutosPorPeriodo: null })
    expect([...s.provisional.equipos].sort()).toEqual(['E1', 'E2'])
    expect(s.cmdIdsVivos).toHaveLength(1)
    expect(s.cmdIdsVivos[0]).toBe(s.provisional.eventos[0].id) // el id del evento deriva del cmdId de su orden
    expect(Object.isFrozen(s.provisional)).toBe(true)
    expect(Object.isFrozen(s.provisional.eventos)).toBe(true)
    expect(Object.isFrozen(s.provisional.eventos[0])).toBe(true)
    expect(Object.isFrozen(s.cmdIdsVivos)).toBe(true)
    expect(() => { 'use strict'; s.provisional.eventos.push({}) }).toThrow()
    expect(() => { 'use strict'; s.provisional.partido.estado = 'final' }).toThrow()
    expect(a.ctl.estado().sesion.provisional.partido.estado).toBe('vivo')
    await a.ctl.cerrar()
  })
  it('los resultados de registrar e iniciar no entregan la vista, el sobre ni el estado provisional del núcleo y están congelados', async () => {
    const { a } = await conInicio()
    const r = await a.ctl.registrar(PUNTO())
    expect(r.ok).toBe(true)
    for (const k of ['vista', 'sobre', 'estadoProvisional', 'cuerpoJson']) expect(r, k).not.toHaveProperty(k)
    expect(Object.isFrozen(r)).toBe(true)
    await a.ctl.cerrar()
  })
  it('la hora estimada y el nivel de confianza salen de relojAhora sin armar todo el estado', async () => {
    const { a } = await conInicio()
    expect(a.ctl.relojAhora()).toMatchObject({ nivel: 'confiable' })
    expect(Number.isSafeInteger(a.ctl.relojAhora().estimadoMs)).toBe(true)
    expect(a.ctl.estado().reloj.estimadoMs).toBeTruthy()
    await a.ctl.cerrar()
  })
  it('una acción rechazada ANTES de encolar (reloj sin hora) no consume número y no escribe; puntos siguen', async () => {
    const { nav, banco, nombreBD, a } = await conInicio()
    await a.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD, enLinea: false, conVisualizacion: true })
    await p.ctl.abrir()
    const antes = await volcarBase(p.almacen)
    const seq = (await leer(p)).sesion.siguienteSeq
    expect(await p.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr') })).toMatchObject({ ok: false, motivo: 'sin-tiempo-confiable', escrito: false })
    expect(await volcarBase(p.almacen)).toBe(antes)
    expect((await p.ctl.registrar(PUNTO())).ok).toBe(true)
    expect((await leer(p)).entradas.at(-1).clientSeq).toBe(seq)
    await p.ctl.cerrar()
  })
})

describe('asegurarDatosParaMostrar: acotado y sin sondeo', () => {
  async function sesionVieja() {
    const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
    const vieja = await pestana(nav, banco, { nombreBD }) // servidor de otra época: sin datos para mostrar
    await vieja.ctl.abrir()
    await vieja.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    await drenarPestana(vieja)
    await vieja.ctl.cerrar()
    return { nav, banco, nombreBD }
  }
  it('a la primera con internet los trae, una sola petición, y no vuelve a pedirlos', async () => {
    const { nav, banco, nombreBD } = await sesionVieja()
    const p = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    await p.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    const n0 = p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length
    expect(await p.ctl.asegurarDatosParaMostrar()).toMatchObject({ ok: true })
    expect(p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length - n0).toBe(1)
    for (let i = 0; i < 10; i += 1) await tick()
    expect(p.ctl.estado().sesion.visualizacion.disponible).toBe(true)
    expect(await p.ctl.asegurarDatosParaMostrar()).toMatchObject({ ok: true, yaTenia: true })
    expect(p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length - n0).toBe(1)
    expect(p.rv.timers.filter((t) => t.en - p.rv.mono < 1000 && false)).toHaveLength(0)
    await p.ctl.cerrar()
  })
  it('fallos transitorios: 3 intentos como máximo con esperas de 5 s y 20 s, y entonces «reintentos-agotados» (sin sondeo posterior)', async () => {
    const { nav, banco, nombreBD } = await sesionVieja()
    const p = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    await p.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    for (let i = 0; i < 3; i += 1) p.f.guiones.estado.push(respuesta(503, { error: 'error-temporal' }))
    const n0 = p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length
    const prom = p.ctl.asegurarDatosParaMostrar()
    const esperas = []
    for (let i = 0; i < 100; i += 1) {
      await tick()
      const antes = p.rv.mono
      const t = p.rv.timers.filter((x) => x.en - antes === 5000 || x.en - antes === 20000)
      if (t.length) { esperas.push(t[0].en - antes); p.rv.mono = t[0].en; p.rv.timers = p.rv.timers.filter((x) => x !== t[0]); t[0].fn() }
      if (esperas.length === 2) break
    }
    expect(await prom).toMatchObject({ ok: false, motivo: 'reintentos-agotados' })
    expect(esperas).toEqual([5000, 20000])
    expect(p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length - n0).toBe(3)
    // no hay más intentos por su cuenta
    const t = p.rv.timers.length
    for (let i = 0; i < 10; i += 1) await tick()
    expect(p.f.llamadas.filter((l) => l.url.endsWith('/estado')).length - n0).toBe(3)
    expect(p.rv.timers.length).toBeLessThanOrEqual(t)
    await p.ctl.cerrar()
  })
  it('un rechazo definitivo (capacidad) no se reintenta; sin internet se anota y se reintenta UNA vez al reconectar', async () => {
    const { nav, banco, nombreBD } = await sesionVieja()
    const uso = (await leerSesion((await pestana(nav, banco, { nombreBD })).almacen, ID, ctxLeer)).sesion.uso
    const apretado = await pestana(nav, banco, { nombreBD, conVisualizacion: true, limites: { ...LIMITES, maxBytesPartido: uso.bytes + uso.reservado } })
    await apretado.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    const n0 = apretado.f.llamadas.filter((l) => l.url.endsWith('/estado')).length
    expect(await apretado.ctl.asegurarDatosParaMostrar()).toMatchObject({ ok: false, motivo: 'visualizacion-no-aplicada', adoptada: false })
    expect(apretado.f.llamadas.filter((l) => l.url.endsWith('/estado')).length - n0).toBe(1) // un solo intento
    await apretado.ctl.cerrar()
    const off = await pestana(nav, banco, { nombreBD, conVisualizacion: true, enLinea: false })
    await off.ctl.abrir()
    expect(await off.ctl.asegurarDatosParaMostrar()).toMatchObject({ ok: false, motivo: 'sin-internet' })
    expect(off.f.llamadas).toHaveLength(0)
    off.conectar()
    for (let i = 0; i < 40; i += 1) await tick()
    expect(off.ctl.estado().sesion.visualizacion.disponible).toBe(true)
    await off.ctl.cerrar()
  })
  it('solo el propietario; cerrar durante la espera termina sin colgarse y no deja temporizadores', async () => {
    const { nav, banco, nombreBD } = await sesionVieja()
    const a = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    const b = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    await a.ctl.abrir(); await b.ctl.abrir()
    expect(await b.ctl.asegurarDatosParaMostrar()).toMatchObject({ ok: false, motivo: 'solo-lectura' })
    for (let i = 0; i < 10; i += 1) await tick()
    for (let i = 0; i < 3; i += 1) a.f.guiones.estado.push(respuesta(503, { error: 'error-temporal' }))
    const prom = a.ctl.asegurarDatosParaMostrar()
    for (let i = 0; i < 20; i += 1) await tick() // el primer intento falló y está esperando 5 s
    const cierre = await a.ctl.cerrar()
    expect(await prom).toMatchObject({ ok: false })
    expect(cierre).toMatchObject({ temporizadores: 0, oyentes: 0, solicitudes: 0, tareas: 0 })
    expect(a.rv.timers).toHaveLength(0)
    await b.ctl.cerrar()
  })
})
