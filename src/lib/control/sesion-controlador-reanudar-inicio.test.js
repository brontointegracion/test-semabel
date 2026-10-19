import { describe, expect, it } from 'vitest'
import {
  ID, T0, cmd, drenarPestana, navegadorFalso, nombreBase, pestana, respuesta, servidorNuevo, tick,
} from './prueba/auxiliares-controlador'
import { leerSesion } from './sesion-almacen'
import { reglasDeCategoria } from '../reglas-categoria'

// REPORT_178: recuperación EXPLÍCITA tras el rechazo definitivo del INICIO por reglas de categoría, con el controlador de punta a punta
// (servidor sintético = banco del motor con el procesador real). Se mira el almacén durable y el orden de las peticiones.

const MINI = reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball' })
const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)
const asentar = async () => { for (let i = 0; i < 12; i += 1) await tick() }
const traza = (p) => p.f.llamadas.map((l) => (l.url.endsWith('/comandos') ? `P:${JSON.parse(l.cuerpo).cmdId}` : l.url.endsWith('/estado') ? 'E' : l.url.endsWith('/preparacion') ? 'R' : 'M')).filter((x) => x !== 'M')
const CONFIRMA = { confirmadoPorOperador: true }

/** El teléfono pide el inicio; las reglas de categoría del servidor cambian justo antes de que procese la orden → rechazo definitivo. */
async function conInicioRechazado() {
  const ini = cmd('ini')
  const banco = servidorNuevo()
  const a = await pestana(navegadorFalso(), banco, { nombreBD: nombreBase() })
  await a.ctl.abrir()
  a.f.guiones.comandos.push(async (llamada) => {
    banco.adaptador.fijarConfig({ reglas: MINI }) // la categoría cambió después de la lectura de preparación
    const r = await banco.reenviar(JSON.parse(llamada.cuerpo), banco.ahora)
    return respuesta(200, { resultado: r.tipo, recibo: JSON.parse(JSON.stringify(r.recibo)), publicacion: 'no-aplica' })
  })
  expect((await a.ctl.iniciarPartido({ cmdId: ini, confirmadoPorOperador: true })).ok).toBe(true)
  await drenarPestana(a); await asentar()
  return { banco, a, ini }
}

describe('rechazo del inicio por reglas de categoría', () => {
  it('queda detenido, explicable y SIN cambios en el servidor; la orden rechazada se conserva', async () => {
    const { banco, a, ini } = await conInicioRechazado()
    const l = await leer(a)
    expect(l.sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo' })
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(l.entradas[0]).toMatchObject({ estado: 'rechazada', tipo: 'iniciar-partido' })
    expect(l.entradas[0].recibo.motivo).toBe('reglas-no-confirmadas')
    expect(a.ctl.estado().sesion.ultimoRechazo).toMatchObject({ tipo: 'iniciar-partido', motivo: 'reglas-no-confirmadas', cmdId: ini })
    const e = banco.adaptador.estado()
    expect(e.partido.estado).toBe('programado')
    expect(e.eventos).toHaveLength(0)
    expect(e.config.reglas).toMatchObject({ categoria: 'mini-basketball' }) // lo que fijó el servidor es suyo; el inicio NO ocurrió
    await a.ctl.cerrar()
  })
})

describe('actualizar la preparación (recuperación explícita)', () => {
  it('exige confirmación; sin ella no hace ni una petición', async () => {
    const { a } = await conInicioRechazado()
    const t0 = traza(a).length
    expect(await a.ctl.reanudarTrasRechazoDeInicio()).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    expect(await a.ctl.reanudarTrasRechazoDeInicio({ confirmadoPorOperador: false })).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    expect(traza(a).slice(t0)).toEqual([])
    await a.ctl.cerrar()
  })

  it('con confirmación: lee estado y preparación (nada se envía), reemplaza la base y NO inicia el partido; el rechazo queda en el historial', async () => {
    const { banco, a, ini } = await conInicioRechazado()
    const t0 = traza(a).length
    const r = await a.ctl.reanudarTrasRechazoDeInicio(CONFIRMA)
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, reanudada: true })
    await asentar(); await drenarPestana(a)
    expect(traza(a).slice(t0)).toEqual(['E', 'R']) // ningún comando
    const l = await leer(a)
    expect(l.sesion.detenida).toBeNull()
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(l.sesion.base.estado.config.reglas.categoria).toBe('mini-basketball') // la pantalla ahora usa las reglas vigentes
    expect(l.entradas[0]).toMatchObject({ cmdId: ini, estado: 'rechazada' })
    expect(banco.adaptador.estado().partido.estado).toBe('programado')
    expect(banco.adaptador.estado().eventos).toHaveLength(0)
    await a.ctl.cerrar()
  })

  it('el inicio nuevo usa un cmdId nuevo, confirma las reglas refrescadas y el servidor fija EXACTAMENTE esas; repetirlo devuelve el recibo original', async () => {
    const { banco, a, ini } = await conInicioRechazado()
    expect((await a.ctl.reanudarTrasRechazoDeInicio(CONFIRMA)).ok).toBe(true)
    await asentar()
    const ini2 = cmd('ini2')
    expect((await a.ctl.iniciarPartido({ cmdId: ini2, confirmadoPorOperador: true })).ok).toBe(true)
    await drenarPestana(a); await asentar()
    const l = await leer(a)
    const nuevo = l.entradas.find((e) => e.cmdId === ini2)
    expect(nuevo.estado).toBe('confirmada')
    expect(JSON.parse(nuevo.cuerpoJson).reglasConfirmadas).toBe('1|mini-basketball|periodo|8|30|20')
    const e = banco.adaptador.estado()
    expect(e.partido.estado).toBe('vivo')
    expect(e.config.reglas).toEqual(MINI)
    // repetir EXACTAMENTE el mismo sobre: recibo original, sin otro inicio
    const antes = banco.adaptador.recibos()
    const rep = await banco.reenviar(JSON.parse(nuevo.cuerpoJson), banco.ahora)
    expect(rep.tipo).toBe('recibo-existente')
    expect(rep.recibo.cmdId).toBe(ini2)
    expect(banco.adaptador.recibos()).toEqual(antes)
    expect(l.entradas.map((x) => x.cmdId)).toEqual([ini, ini2]) // el viejo sigue en el historial y no se reenvió
    await a.ctl.cerrar()
  })

  it('solo aplica al rechazo del inicio: sin parada o con otra parada, «no-reanudable»; sin internet, no hace nada', async () => {
    const banco = servidorNuevo()
    const limpio = await pestana(navegadorFalso(), banco, { nombreBD: nombreBase() })
    await limpio.ctl.abrir()
    expect((await limpio.ctl.iniciarPartido({ cmdId: cmd('i'), confirmadoPorOperador: true })).ok).toBe(true)
    await drenarPestana(limpio); await asentar()
    expect(await limpio.ctl.reanudarTrasRechazoDeInicio(CONFIRMA)).toMatchObject({ ok: false, motivo: 'no-reanudable' })
    await limpio.ctl.cerrar()
    const { a } = await conInicioRechazado()
    a.desconectar()
    const t0 = traza(a).length
    expect(await a.ctl.reanudarTrasRechazoDeInicio(CONFIRMA)).toMatchObject({ ok: false, motivo: 'sin-internet' })
    expect(traza(a).slice(t0)).toEqual([])
    expect((await leer(a)).sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo' }) // sigue igual
    await a.ctl.cerrar()
  })
})
