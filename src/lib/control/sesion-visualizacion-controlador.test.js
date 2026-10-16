import { describe, expect, it } from 'vitest'
import { ID, T0, cmd, drenarPestana, navegadorFalso, nombreBase, pestana, servidorNuevo, tick, volcarBase } from './prueba/auxiliares-controlador'
import { LIMITES, leerSesion } from './sesion-almacen'

// REPORT_127, el controlador: los nombres y números se guardan al crear la sesión, sobreviven a una recarga SIN conexión (sin pedir
// nada a la red) y una lectura autorizada puede aportarlos a una sesión anterior. Todo sintético.

const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)

describe('controlador y datos para mostrar', () => {
  it('se guardan al crear la sesión y tras una recarga SIN conexión siguen ahí, sin una sola petición', async () => {
    const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
    const a = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    await a.ctl.abrir()
    expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
    await drenarPestana(a)
    await a.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD, enLinea: false })
    await p.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    const viz = p.ctl.estado().sesion.visualizacion
    expect(viz).toMatchObject({ disponible: true, desactualizada: false })
    expect(viz.equipos).toEqual([{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }])
    expect(viz.jugadores.find((j) => j.id === 'J1')).toMatchObject({ nombrePila: 'Nombre-J1', apellido1: 'Apellido-J1', dorsal: 0, activo: true })
    expect(p.f.llamadas).toHaveLength(0)
    await p.ctl.cerrar()
  })

  it('una sesión anterior dice «no disponible»; una lectura autorizada los aporta sin tocar órdenes; solo el propietario, con internet', async () => {
    const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
    const vieja = await pestana(nav, banco, { nombreBD }) // el servidor de esa época no mandaba los datos
    await vieja.ctl.abrir()
    expect((await vieja.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
    await drenarPestana(vieja)
    await vieja.ctl.cerrar()
    const a = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    const b = await pestana(nav, banco, { nombreBD, conVisualizacion: true })
    await a.ctl.abrir(); await b.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.ctl.estado().sesion.visualizacion).toMatchObject({ disponible: false, motivo: 'sin-datos-de-pantalla', jugadores: [] })
    expect(await b.ctl.actualizarDatosParaMostrar()).toMatchObject({ ok: false, motivo: 'solo-lectura' })
    a.desconectar()
    expect(await a.ctl.actualizarDatosParaMostrar()).toMatchObject({ ok: false, motivo: 'sin-internet' })
    a.conectar()
    const antes = await leer(a)
    const r = await a.ctl.actualizarDatosParaMostrar()
    expect(r).toMatchObject({ ok: true, adoptada: true })
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.ctl.estado().sesion.visualizacion.disponible).toBe(true)
    expect(a.ctl.estado().ultimaVisualizacion).toMatchObject({ ok: true, adoptada: true })
    const despues = await leer(a)
    expect(JSON.stringify(despues.entradas)).toBe(JSON.stringify(antes.entradas))
    expect(JSON.stringify(despues.sesion.base)).toBe(JSON.stringify(antes.sesion.base))
    // la otra pestaña lo ve al releer lo durable
    for (let i = 0; i < 10; i += 1) await tick()
    expect(b.ctl.estado().sesion.visualizacion.disponible).toBe(true)
    await a.ctl.cerrar(); await b.ctl.cerrar()
  })

  it('capacidad agotada: no se adoptan, se informa «capacidad-rechazada» y nada cambia', async () => {
    const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
    const vieja = await pestana(nav, banco, { nombreBD })
    await vieja.ctl.abrir()
    await vieja.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    await drenarPestana(vieja)
    const uso = (await leer(vieja)).sesion.uso
    await vieja.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD, conVisualizacion: true, limites: { ...LIMITES, maxBytesPartido: uso.bytes + uso.reservado } })
    await p.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    const antes = await volcarBase(p.almacen)
    const r = await p.ctl.actualizarDatosParaMostrar()
    expect(r).toMatchObject({ ok: false, motivo: 'visualizacion-no-aplicada', adoptada: false })
    expect(p.ctl.estado().estados).toContain('capacidad-rechazada')
    expect(p.ctl.estado().ultimaVisualizacion).toMatchObject({ ok: false, adoptada: false })
    expect(p.ctl.estado().sesion.visualizacion.disponible).toBe(false)
    expect(await volcarBase(p.almacen)).toBe(antes)
    await p.ctl.cerrar()
  })
})
