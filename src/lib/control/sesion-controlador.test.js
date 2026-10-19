import { describe, expect, it } from 'vitest'
import { crearAtribucion } from '../motor'
import { JUGADORES_DE_PRUEBA } from '../motor/prueba/banco'
import { JUGADORES_NUMERADOS, preparacionDePrueba } from '../motor/prueba/auxiliares-preparacion'
import {
  DEVICE, ID, T0, TOKEN, cmd, drenarPestana, navegadorFalso, nombreBase, pestana, respuesta, servidorNuevo, tick, volcarBase,
} from './prueba/auxiliares-controlador'
import { LIMITES, leerSesion } from './sesion-almacen'
import { crearCandado } from './sesion-candado'

// REPORT_125: el controlador del navegador con dobles de Web Locks, BroadcastChannel, conectividad y relojes. El servidor es el
// banco sintético del motor (procesador real). Se mira lo que queda en el almacén durable, no lo que el controlador dice de sí.

const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)
const inicioConfirmado = async (p, cmdId = cmd('ini')) => {
  const r = await p.ctl.iniciarPartido({ cmdId, confirmadoPorOperador: true })
  expect(r.ok, JSON.stringify(r)).toBe(true)
  await drenarPestana(p)
  expect((await leer(p)).sesion.inicio).toBe('confirmado')
}
const PUNTO = (extra = {}) => ({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId: cmd('pto'), ...extra })
async function par({ A = {}, B = {} } = {}) {
  const nav = navegadorFalso()
  const banco = servidorNuevo()
  const nombreBD = nombreBase()
  const a = await pestana(nav, banco, { nombreBD, ...A })
  const b = await pestana(nav, banco, { nombreBD, ...B })
  return { nav, banco, nombreBD, a, b }
}

describe('el candado', () => {
  it('Web Lock exclusivo por liga y partido; el segundo queda en solo lectura con UNA petición en cola', async () => {
    const nav = navegadorFalso()
    const log = []
    const mk = () => crearCandado({ ligaId: 'L1', partidoId: 'P', locks: nav.locks, alAdquirir: async () => { log.push('adquirido') }, alSoltar: async () => { log.push('soltando') } })
    const c1 = mk(); const c2 = mk()
    expect(await c1.iniciar()).toBe('propietario')
    expect(await c2.iniciar()).toBe('solo-lectura')
    expect([c1.esPropietario(), c2.esPropietario()]).toEqual([true, false])
    expect(nav.locks.enCola('sebel-ctl-sesion:L1:P')).toBe(1)
    await c1.cerrar()
    for (let i = 0; i < 5; i += 1) await tick()
    expect(c2.esPropietario()).toBe(true)
    expect(log).toEqual(['adquirido', 'soltando', 'adquirido'])
    await c2.cerrar()
    expect(nav.locks.tenido('sebel-ctl-sesion:L1:P')).toBe(false)
  })
  it('sin Web Locks no hay control (sin sustituto); identificadores inválidos tampoco', async () => {
    for (const locks of [null, undefined, {}]) {
      const c = crearCandado({ ligaId: 'L1', partidoId: 'P', locks: locks ?? null })
      expect(await c.iniciar()).toBe('sin-web-locks')
      expect(c.esPropietario()).toBe(false)
    }
    expect(await crearCandado({ ligaId: 'a/b', partidoId: 'P', locks: navegadorFalso().locks }).iniciar()).toBe('configuracion')
  })
  it('cerrar en solo lectura cancela la petición en cola; si el candado llega durante el cierre se libera sin actuar', async () => {
    const nav = navegadorFalso()
    const c1 = crearCandado({ ligaId: 'L1', partidoId: 'P', locks: nav.locks })
    await c1.iniciar()
    let adquirido = 0
    const c2 = crearCandado({ ligaId: 'L1', partidoId: 'P', locks: nav.locks, alAdquirir: async () => { adquirido += 1 } })
    await c2.iniciar()
    expect(nav.locks.enCola('sebel-ctl-sesion:L1:P')).toBe(1)
    await c2.cerrar()
    expect(nav.locks.enCola('sebel-ctl-sesion:L1:P')).toBe(0)
    await c1.cerrar()
    for (let i = 0; i < 5; i += 1) await tick()
    expect(adquirido).toBe(0)
    expect(nav.locks.tenido('sebel-ctl-sesion:L1:P')).toBe(false)
  })
  it('el candado se libera DESPUÉS de que alSoltar termine (nunca dos propietarios)', async () => {
    const nav = navegadorFalso()
    const orden = []
    let soltar
    const c1 = crearCandado({ ligaId: 'L1', partidoId: 'P', locks: nav.locks, alSoltar: () => new Promise((r) => { orden.push('c1-soltando'); soltar = r }) })
    const c2 = crearCandado({ ligaId: 'L1', partidoId: 'P', locks: nav.locks, alAdquirir: async () => { orden.push('c2-adquirido') } })
    await c1.iniciar(); await c2.iniciar()
    const cierre = c1.cerrar()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(c1.esPropietario()).toBe(false) // deja de serlo al empezar a soltar
    expect(orden).toEqual(['c1-soltando']) // c2 aún NO tiene el candado
    soltar(); await cierre
    for (let i = 0; i < 5; i += 1) await tick()
    expect(orden).toEqual(['c1-soltando', 'c2-adquirido'])
    await c2.cerrar()
  })
})

describe('dos pestañas, un solo propietario y un solo emisor', () => {
  it('A es propietaria y envía; B es de solo lectura: no crea emisor, no pide nada a la red y no puede encolar ni enviar', async () => {
    const { a, b } = await par()
    await a.ctl.abrir(); await b.ctl.abrir()
    expect(a.ctl.estado()).toMatchObject({ modo: 'propietario', propietario: true })
    expect(b.ctl.estado()).toMatchObject({ modo: 'solo-lectura', propietario: false, emisor: null })
    await inicioConfirmado(a)
    for (let i = 0; i < 20; i += 1) await tick() // (REPORT_129) A verifica sola al vaciarse su cola: se espera a que termine antes de fotografiar la base
    expect(a.ctl.estado().automatica.verificacion).toBe('ninguna')
    const antes = await volcarBase(b.almacen)
    const lecturasB = b.f.llamadas.length
    for (const op of [() => b.ctl.registrar(PUNTO()), () => b.ctl.iniciarPartido({ cmdId: cmd('x'), confirmadoPorOperador: true }), () => b.ctl.verificar(), () => b.ctl.reintentarConConfirmacion({ confirmadoPorOperador: true }), () => b.ctl.refrescarAntesDelInicio(), () => b.ctl.remuestrearReloj()]) {
      expect(await op()).toMatchObject({ ok: false, motivo: 'solo-lectura' })
    }
    b.ctl.reintentarAhora()
    await tick(); await tick()
    expect(await volcarBase(b.almacen)).toBe(antes)
    expect(b.f.llamadas).toHaveLength(lecturasB)
    expect(b.f.llamadas).toHaveLength(0) // ni una sola petición de B
    expect(b.comandos()).toHaveLength(0)
    await a.ctl.cerrar(); await b.ctl.cerrar()
  })

  it('la pestaña de solo lectura relee lo durable cuando llega un aviso; el aviso solo lleva «cambio» (sin credenciales) y los avisos falsos solo causan una relectura', async () => {
    const { a, b, nav } = await par()
    await a.ctl.abrir(); await b.ctl.abrir()
    await inicioConfirmado(a)
    for (let i = 0; i < 10; i += 1) await tick()
    expect(b.ctl.estado().sesion).toMatchObject({ inicio: 'confirmado' })
    expect(nav.bus.mensajes.length).toBeGreaterThan(0)
    for (const m of nav.bus.mensajes) expect(m.datos).toEqual({ v: 1, tipo: 'cambio' })
    expect(JSON.stringify(nav.bus.mensajes)).not.toContain(TOKEN)
    // un mensaje cualquiera (incluso uno que dice «inicio confirmado») no cambia nada: solo se relee
    const falso = nav.canal('sebel-ctl-aviso:L1:P')
    falso.postMessage({ v: 1, tipo: 'cambio', inicio: 'confirmado', token: 'x' })
    falso.postMessage('basura')
    for (let i = 0; i < 10; i += 1) await tick()
    expect(b.ctl.estado().sesion.inicio).toBe('confirmado') // viene de lo durable, no del mensaje
    expect(b.f.llamadas).toHaveLength(0)
    falso.close()
    await a.ctl.cerrar(); await b.ctl.cerrar()
  })

  it('sin Web Locks: se rechaza el control, no hay emisor ni red ni escrituras', async () => {
    const nav = navegadorFalso()
    const p = await pestana(nav, servidorNuevo(), { nombreBD: nombreBase(), locks: null })
    await p.ctl.abrir()
    expect(p.ctl.estado()).toMatchObject({ modo: 'sin-web-locks', propietario: false, emisor: null })
    expect(await p.ctl.registrar(PUNTO())).toMatchObject({ ok: false, motivo: 'sin-web-locks' })
    expect(await p.ctl.iniciarPartido({ cmdId: 'x', confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'sin-web-locks' })
    expect(p.f.llamadas).toHaveLength(0)
    await p.ctl.cerrar()
  })

  it('cierre limpio del propietario: B adquiere, RELEE lo durable y retoma lo pendiente; A no escribe nada después de que B adquirió', async () => {
    const nav = navegadorFalso()
    const banco = servidorNuevo()
    const nombreBD = nombreBase()
    const eventos = []
    const a = await pestana(nav, banco, { nombreBD, gancho: (g) => { if (g.fase === 'escribir') eventos.push('A-escribe') } })
    const b = await pestana(nav, banco, { nombreBD, gancho: (g) => { if (g.fase === 'escribir') eventos.push('B-escribe') } })
    await a.ctl.abrir(); await b.ctl.abrir()
    await inicioConfirmado(a)
    // órdenes sin enviar: A está sin red
    a.desconectar()
    for (let i = 0; i < 2; i += 1) expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    expect((await leer(a)).entradas.filter((e) => e.estado === 'pendiente')).toHaveLength(2)
    await a.ctl.cerrar()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(b.ctl.estado()).toMatchObject({ modo: 'propietario', propietario: true })
    const primeraDeB = eventos.indexOf('B-escribe')
    expect(eventos.slice(primeraDeB).includes('A-escribe')).toBe(false)
    await drenarPestana(b)
    expect((await leer(b)).entradas.map((e) => e.estado)).toEqual(['confirmada', 'confirmada', 'confirmada'])
    expect(banco.adaptador.estado().eventos).toHaveLength(2)
    expect(a.comandos().length).toBe(1) // solo el inicio salió de A
    await b.ctl.cerrar()
  })

  it('A se cierra con un comando EN VUELO que el servidor sí confirmó: B reenvía el MISMO sobre, resuelve el recibo original y no hay puntos duplicados', async () => {
    const { a, b, banco } = await par()
    await a.ctl.abrir(); await b.ctl.abrir()
    await inicioConfirmado(a)
    let llega
    a.f.guion.push((llamada) => new Promise((resolver) => {
      banco.reenviar(JSON.parse(llamada.cuerpo), banco.ahora).then((r) => {
        const recibo = JSON.parse(JSON.stringify(r.recibo))
        llega = () => resolver(respuesta(200, { resultado: r.tipo, recibo, publicacion: {} }))
      })
    }))
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    for (let i = 0; i < 40 && a.comandos().length < 2; i += 1) await tick()
    for (let i = 0; i < 5; i += 1) await tick()
    expect(a.comandos()).toHaveLength(2)
    expect(banco.adaptador.estado().eventos).toHaveLength(1) // el servidor YA lo confirmó
    const original = a.comandos()[1].cuerpo
    const cierre = a.ctl.cerrar()
    await cierre
    expect(a.comandos()[1].abortada).toBe(true)
    llega() // la respuesta de la generación vencida
    for (let i = 0; i < 15; i += 1) await tick()
    expect(b.ctl.estado().propietario).toBe(true)
    await drenarPestana(b)
    expect(b.comandos().map((c) => c.cuerpo)).toEqual([original])
    const l = await leer(b)
    expect(l.entradas[1]).toMatchObject({ estado: 'confirmada', cuerpoJson: original })
    expect(banco.adaptador.estado().eventos).toHaveLength(1)
    expect(banco.adaptador.estado().eventos.filter((e) => e.tipo === 'anotar' || e.puntos === 2)).toHaveLength(1)
    await b.ctl.cerrar()
  })
})

describe('inicio, lecturas frescas y compuertas', () => {
  it('el inicio exige propietario, internet, confirmación explícita y lectura fresca; no se infiere de un «vivo»', async () => {
    const { a, banco } = await par({ B: {} })
    await a.ctl.abrir()
    expect(await a.ctl.iniciarPartido({ cmdId: 'x', confirmadoPorOperador: false })).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    expect(await a.ctl.iniciarPartido({ confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'cmdId' })
    a.desconectar()
    expect(await a.ctl.iniciarPartido({ cmdId: 'x', confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'sin-internet' })
    expect((await leer(a)).motivo).toBe('sesion-inexistente') // nada se creó
    a.conectar()
    // el servidor dice «vivo» (otro teléfono lo inició): la sesión nace «sin-resolver», no hay inicio ni puntuación
    banco.adaptador.estado().partido.estado = 'vivo'
    const vivo = servidorNuevo({ estado: 'vivo' })
    const nav = navegadorFalso()
    const p = await pestana(nav, vivo, { nombreBD: nombreBase() })
    await p.ctl.abrir()
    expect(await p.ctl.iniciarPartido({ cmdId: 'x', confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'inicio-sin-resolver' })
    const l = await leer(p)
    expect(l.sesion.inicio).toBe('sin-resolver')
    expect(l.entradas).toEqual([])
    expect(l.vista.puntuacion.habilitada).toBe(false)
    expect(p.comandos()).toHaveLength(0)
    await p.ctl.cerrar(); await a.ctl.cerrar()
  })

  it('sin preparación válida o sin estado leíble no se crea ni se encola nada', async () => {
    const { a } = await par()
    await a.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    a.f.guiones.preparacion.push(respuesta(503, { error: 'preparacion-no-disponible' }))
    expect(await a.ctl.iniciarPartido({ cmdId: cmd('x'), confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'preparacion-no-disponible' })
    a.f.guiones.estado.push(respuesta(503, { error: 'x' }))
    expect(await a.ctl.iniciarPartido({ cmdId: cmd('x'), confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'estado-no-disponible' })
    // un 401 (acceso retirado, vencido o de otro teléfono) se dice como tal (REPORT_181), igual que en la recuperación y en el emisor; tampoco crea ni encola nada
    a.f.guiones.estado.push(respuesta(401, { error: 'no-autorizado' }))
    expect(await a.ctl.iniciarPartido({ cmdId: cmd('x'), confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'no-autorizado' })
    a.f.guiones.estado.push(respuesta(507, { error: 'estado-demasiado-grande' }))
    expect(await a.ctl.iniciarPartido({ cmdId: cmd('x'), confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'estado-demasiado-grande' })
    expect((await leer(a)).motivo).toBe('sesion-inexistente')
    expect(a.comandos()).toHaveLength(0)
    await a.ctl.cerrar()
  })

  it('flujo normal: crea la sesión, encola el inicio y SOLO el recibo aceptado habilita la puntuación', async () => {
    const { a, banco } = await par()
    await a.ctl.abrir()
    let abrir
    const compuerta = new Promise((resolver) => { abrir = resolver })
    a.f.guiones.comandos.push(async (ll) => {
      await compuerta
      const rr = await banco.reenviar(JSON.parse(ll.cuerpo), banco.ahora)
      return respuesta(200, { resultado: rr.tipo, recibo: JSON.parse(JSON.stringify(rr.recibo)), publicacion: {} })
    })
    const r = await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    expect(r.ok).toBe(true)
    for (let i = 0; i < 20; i += 1) await tick()
    // antes del recibo: en vuelo, puntuación deshabilitada y no se aceptan más órdenes
    expect(a.ctl.estado().sesion).toMatchObject({ inicio: 'sin-iniciar', enviando: 1, puntuacion: { habilitada: false } })
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(false)
    abrir()
    await drenarPestana(a)
    expect(a.ctl.estado().sesion).toMatchObject({ inicio: 'confirmado', puntuacion: { habilitada: true } })
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    await drenarPestana(a)
    expect((await leer(a)).entradas.map((e) => e.estado)).toEqual(['confirmada', 'confirmada'])
    await a.ctl.cerrar()
  })

  it('plantilla cambiada antes del inicio: el inicio refresca la base (C3) con los mismos insumos y luego se crea; la puntuación sigue apagada hasta el recibo', async () => {
    const { a, banco } = await par()
    await a.ctl.abrir()
    // la sesión se crea con la plantilla vieja…
    const antes = await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    expect(antes.ok).toBe(true)
    await drenarPestana(a)
    await a.ctl.cerrar()
    // …otro caso: sesión previa al inicio obsoleta
    const nav = navegadorFalso()
    const banco2 = servidorNuevo()
    const nombreBD = nombreBase()
    const p = await pestana(nav, banco2, { nombreBD })
    const { construirSesion } = await import('./sesion-motor')
    const { crearSesion } = await import('./sesion-almacen')
    const { cuerpoDeServidor } = await import('./prueba/auxiliares-sesion')
    await crearSesion(p.almacen, construirSesion({ ligaId: 'L1', partidoId: 'P', cuerpoEstado: cuerpoDeServidor(banco2), deviceId: DEVICE }).sesion)
    banco2.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), { id: 'J7', equipoId: 'E1', nombre: 'Nueva' }] }))
    banco2.adaptador.fijarPreparacion(preparacionDePrueba('P', { jugadores: [...JUGADORES_NUMERADOS, { id: 'J7', equipoId: 'E1', nombre: 'Nueva', dorsal: 5 }] }))
    await p.ctl.abrir()
    const r = await p.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(p.ctl.estado().ultimoRefresco).toMatchObject({ ok: true })
    expect((await leer(p)).sesion.base.estado.atribucion.jugadores.J7).toBeTruthy()
    expect((await leer(p)).vista.puntuacion.habilitada).toBe(false)
    await drenarPestana(p)
    expect((await leer(p)).sesion.inicio).toBe('confirmado')
    await p.ctl.cerrar(); void banco
  })
})

describe('reloj: muestreo y compuertas sin conexión', () => {
  it('muestrea al abrir, al reconectar, al volver a ser visible y con el intervalo; sin conexión no pide nada', async () => {
    const { a } = await par()
    await a.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.f.muestras).toBe(1)
    expect(a.ctl.estado().reloj.nivel).toBe('confiable')
    a.desconectar()
    a.rv.mono += 400_000 // más de 5 min sin conexión: el modelo pide remuestreo, pero offline no se pide
    a.rv.dispararSiguiente()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.f.muestras).toBe(1)
    a.conectar()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.f.muestras).toBe(2)
    a.rv.mono += 400_000
    a.visibilidad(false); a.visibilidad(true)
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.f.muestras).toBe(3)
    // intervalo: pasados 5 min el ciclo de vigilancia remuestrea solo
    a.rv.mono += 310_000
    a.rv.timers.sort((x, y) => x.en - y.en)
    a.rv.dispararSiguiente()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.f.muestras).toBe(4)
    await a.ctl.cerrar()
  })

  it('salto del reloj de pared: el modelo lo detecta, la estimación deja de ser confiable y se remuestrea', async () => {
    const { a } = await par()
    await a.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.ctl.estado().reloj.nivel).toBe('confiable')
    a.paredExtra.ms = 120_000 // el usuario movió el reloj del teléfono
    expect(a.ctl.estado().reloj).toMatchObject({ nivel: 'degradado', motivo: 'salto-de-reloj' })
    a.rv.mono += 20_000
    a.rv.dispararSiguiente()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.f.muestras).toBe(2)
    expect(a.ctl.estado().reloj.nivel).toBe('confiable')
    await a.ctl.cerrar()
  })

  it('una muestra que llega tras una invalidación o tras el cierre se descarta', async () => {
    const { a } = await par()
    a.f.guion.push('colgar')
    await a.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    const m = a.f.llamadas.find((l) => !l.url.endsWith('/comandos'))
    expect(a.ctl.estado().reloj.muestreando).toBe(true)
    a.desconectar() // invalida lo que estaba en vuelo
    for (let i = 0; i < 10; i += 1) await tick()
    expect(m.abortada).toBe(true)
    expect(a.ctl.estado().reloj.nivel).toBe('sin-estimacion')
    // cierre con una muestra en vuelo que ignora la cancelación
    const b = await pestana(navegadorFalso(), servidorNuevo(), { nombreBD: nombreBase() })
    let llegar
    b.f.guion.push((l) => new Promise((resolver) => { llegar = () => resolver(respuesta(200, { servidorAhoraMs: T0 })) }))
    await b.ctl.abrir()
    for (let i = 0; i < 10; i += 1) await tick()
    await b.ctl.cerrar()
    llegar?.()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(b.ctl.estado().reloj.nivel).toBe('sin-estimacion')
    await a.ctl.cerrar()
  })

  it('recarga SIN conexión: sin ancla; las órdenes de reloj se rechazan antes de encolar (sin clientSeq ni escritura) y puntos, faltas y periodos siguen', async () => {
    const { a, nav, banco, nombreBD } = await par()
    await a.ctl.abrir()
    await inicioConfirmado(a)
    await a.ctl.cerrar()
    // «recarga» sin conexión
    const p = await pestana(nav, banco, { nombreBD, enLinea: false })
    await p.ctl.abrir()
    expect(p.ctl.estado().reloj).toMatchObject({ nivel: 'sin-estimacion' })
    expect(p.f.llamadas).toHaveLength(0)
    const antes = await leer(p)
    const dump = await volcarBase(p.almacen)
    const r = await p.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr') })
    expect(r).toMatchObject({ ok: false, motivo: 'sin-tiempo-confiable', escrito: false })
    expect(await volcarBase(p.almacen)).toBe(dump) // nada escrito
    expect((await leer(p)).sesion.siguienteSeq).toBe(antes.sesion.siguienteSeq) // ningún clientSeq consumido
    // un punto y una falta posteriores entran con el siguiente número
    const punto = await p.ctl.registrar(PUNTO())
    expect(punto.ok, JSON.stringify(punto)).toBe(true)
    const falta = await p.ctl.registrar({ tipo: 'falta', datos: { equipoId: 'E1', jugadorId: 'J1' }, cmdId: cmd('fal') })
    expect(falta.ok, JSON.stringify(falta)).toBe(true)
    const l = await leer(p)
    expect(l.entradas.slice(1).map((e) => e.clientSeq)).toEqual([antes.sesion.siguienteSeq, antes.sesion.siguienteSeq + 1])
    // cambio de periodo permitido sin tiempo de confianza (reloj detenido)
    const per = await p.ctl.registrar({ tipo: 'siguiente-periodo', datos: {}, cmdId: cmd('per') })
    expect(per.ok, JSON.stringify(per)).toBe(true)
    expect(p.f.llamadas).toHaveLength(0) // todo en cola, nada en la red
    expect(p.ctl.estado().emisor.fase).toBe('sin-conexion')
    await p.ctl.cerrar()
  })

  it('al reconectar se remuestrea y se vacía la cola EN ORDEN; ya con estimación, una orden de reloj sí se acepta', async () => {
    const { a, nav, banco, nombreBD } = await par()
    await a.ctl.abrir()
    await inicioConfirmado(a)
    await a.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD, enLinea: false })
    await p.ctl.abrir()
    for (let i = 0; i < 3; i += 1) expect((await p.ctl.registrar(PUNTO())).ok).toBe(true)
    const guardados = (await leer(p)).entradas.slice(1).map((e) => e.cuerpoJson)
    p.conectar()
    await drenarPestana(p)
    expect(p.f.muestras).toBeGreaterThanOrEqual(1)
    expect(p.ctl.estado().reloj.nivel).toBe('confiable')
    expect(p.comandos().map((c) => c.cuerpo)).toEqual(guardados)
    const arr = await p.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr') })
    expect(arr.ok, JSON.stringify(arr)).toBe(true)
    await drenarPestana(p)
    expect((await leer(p)).entradas.at(-1).estado).toBe('confirmada')
    await p.ctl.cerrar()
  })

  it('una orden de reloj YA encolada y retenida por falta de estimación no se toca: se expone la cola bloqueada y sale cuando hay estimación', async () => {
    const { a, nav, banco, nombreBD } = await par()
    await a.ctl.abrir()
    await inicioConfirmado(a)
    for (let i = 0; i < 10; i += 1) await tick()
    a.desconectar()
    expect((await a.ctl.registrar({ tipo: 'arrancar-reloj', datos: {}, cmdId: cmd('arr') })).ok).toBe(true)
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    const guardadas = (await leer(a)).entradas.map((e) => JSON.stringify([e.clientSeq, e.cmdId, e.cuerpoJson, e.estado, e.bytes, e.reserva]))
    await a.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD, enLinea: false }) // recarga sin conexión: sin ancla
    await p.ctl.abrir()
    p.f.guiones.muestra.push('colgar') // la muestra de la reconexión queda colgada: sigue sin estimación
    p.conectar()
    for (let i = 0; i < 20; i += 1) await tick()
    await p.ctl.reposo()
    expect(p.ctl.estado().colaBloqueadaPorReloj).toMatchObject({ motivo: 'sin-tiempo-confiable' })
    expect(p.ctl.estado().estados).toContain('cola-bloqueada-por-reloj')
    expect(p.comandos()).toHaveLength(0) // ni la de reloj ni el punto de detrás salen: el orden es estricto
    expect((await leer(p)).entradas.map((e) => JSON.stringify([e.clientSeq, e.cmdId, e.cuerpoJson, e.estado, e.bytes, e.reserva]))).toEqual(guardadas)
    p.f.llamadas.find((l) => !l.url.endsWith('/comandos')).abortada || (p.f.llamadas[0].liberar?.(respuesta(503, {}))) // suelta la muestra colgada
    await p.ctl.remuestrearReloj()
    await drenarPestana(p)
    expect((await leer(p)).entradas.map((e) => e.estado)).toEqual(['confirmada', 'confirmada', 'confirmada'])
    await p.ctl.cerrar()
  })
})

describe('paradas, capacidad y resultados desconocidos: estados distintos', () => {
  it('una parada persistida (401) sobrevive al cambio de pestaña y NUNCA se borra sola; el nuevo propietario no envía y lo informa', async () => {
    const { a, b, banco } = await par()
    await a.ctl.abrir(); await b.ctl.abrir()
    a.f.guiones.comandos.push(respuesta(401, { error: 'no-autorizado' }))
    const r = await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    expect(r.ok).toBe(true)
    await drenarPestana(a)
    expect(a.ctl.estado().estados).toContain('parada-persistida')
    expect(a.ctl.estado().estados).not.toContain('resultado-desconocido')
    const orden = (await leer(a)).entradas[0]
    await a.ctl.cerrar()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(b.ctl.estado().propietario).toBe(true)
    await drenarPestana(b)
    expect(b.comandos()).toHaveLength(0)
    expect(b.ctl.estado().estados).toContain('parada-persistida')
    expect((await leer(b)).sesion.detenida).toMatchObject({ causa: 'transporte', clase: 'no-autorizado' })
    expect((await leer(b)).entradas[0]).toMatchObject({ cmdId: orden.cmdId, estado: 'enviando', recibo: null })
    // ni reintentar, ni verificar, ni reabrir la borran
    b.ctl.reintentarAhora(); await drenarPestana(b)
    b.conectar(); b.visibilidad(true); await drenarPestana(b)
    expect(b.comandos()).toHaveLength(0)
    expect((await leer(b)).sesion.detenida).toMatchObject({ causa: 'transporte' })
    // la vía explícita (con confirmación) obtiene el recibo original sin borrar la parada
    expect(await b.ctl.reintentarConConfirmacion({})).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    expect((await b.ctl.reintentarConConfirmacion({ confirmadoPorOperador: true })).ok).toBe(true)
    expect(b.comandos().map((c) => c.cuerpo)).toEqual([orden.cuerpoJson])
    expect((await leer(b)).sesion.detenida).toMatchObject({ causa: 'transporte' })
    expect((await leer(b)).sesion.inicio).toBe('confirmado')
    void banco
    await b.ctl.cerrar()
  })

  it('un resultado desconocido (orden en vuelo sin recibo) es un estado distinto de una parada', async () => {
    const { a } = await par()
    await a.ctl.abrir()
    a.f.guiones.comandos.push(new Error('red'), 'colgar')
    expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
    for (let i = 0; i < 40 && a.comandos().length < 1; i += 1) await tick()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.ctl.estado().estados).toContain('resultado-desconocido')
    expect(a.ctl.estado().estados).not.toContain('parada-persistida')
    expect(a.ctl.estado().sesion.puntuacion.habilitada).toBe(false)
    await a.ctl.cerrar()
  })

  it('capacidad: una atribución que no cabe se informa como «capacidad-rechazada» (no sincronizada) y no cambia nada', async () => {
    const nav = navegadorFalso()
    const banco = servidorNuevo()
    const nombreBD = nombreBase()
    const a = await pestana(nav, banco, { nombreBD })
    await a.ctl.abrir()
    await inicioConfirmado(a)
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    await drenarPestana(a)
    expect((await a.ctl.registrar({ tipo: 'cerrar-partido', datos: {}, cmdId: cmd('cer') })).ok).toBe(true)
    await drenarPestana(a)
    expect(banco.adaptador.estado().partido.estado).toBe('final')
    const uso = (await leer(a)).sesion.uso
    await a.ctl.cerrar()
    const estrecho = { ...LIMITES, maxBytesPartido: uso.bytes + uso.reservado }
    const extras = Array.from({ length: 12 }, (_, i) => ({ id: `N${i}`, equipoId: i % 2 ? 'E1' : 'E2', nombre: `Extra ${i}` }))
    banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), ...extras] }))
    const p = await pestana(nav, banco, { nombreBD, limites: estrecho })
    await p.ctl.abrir()
    await drenarPestana(p)
    const antes = await volcarBase(p.almacen)
    const v = await p.ctl.verificar()
    expect(v).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', sincronizada: false })
    expect(p.ctl.estado().estados).toContain('capacidad-rechazada')
    expect(await volcarBase(p.almacen)).toBe(antes)
    await p.ctl.cerrar()
  })
})

describe('verificación serializada con el envío', () => {
  it('mientras dura la verificación no se despierta al emisor: una orden encolada espera y no provoca una divergencia falsa', async () => {
    const { a, banco } = await par()
    await a.ctl.abrir()
    await inicioConfirmado(a)
    for (let i = 0; i < 10; i += 1) await tick()
    a.f.guion.push('colgar') // la lectura de /estado queda en vuelo
    const verificacion = a.ctl.verificar()
    for (let i = 0; i < 10; i += 1) await tick()
    const lectura = a.f.llamadas.filter((l) => l.url.endsWith('/estado')).at(-1)
    expect(lectura).toBeTruthy()
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true) // se encola…
    for (let i = 0; i < 10; i += 1) await tick()
    expect(a.comandos()).toHaveLength(1) // …pero NO sale mientras verifica
    expect((await a.ctl.verificar())).toMatchObject({ ok: false, motivo: 'ocupado' })
    // llega la instantánea (tomada ANTES del punto): coincide con la base, sin divergencia
    const { cuerpoDeServidor } = await import('./prueba/auxiliares-sesion')
    lectura.liberar(respuesta(200, cuerpoDeServidor(banco)))
    expect(await verificacion).toMatchObject({ ok: true, sincronizada: true })
    await drenarPestana(a)
    expect(a.comandos()).toHaveLength(2) // ahora sí
    const l = await leer(a)
    expect(l.sesion.divergencia).toBeNull()
    expect(l.entradas.map((e) => e.estado)).toEqual(['confirmada', 'confirmada'])
    await a.ctl.cerrar()
  })
  it('no se verifica con el emisor ocupado o con una orden en vuelo', async () => {
    const { a } = await par()
    await a.ctl.abrir()
    a.f.guiones.comandos.push('colgar')
    await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })
    for (let i = 0; i < 30; i += 1) await tick()
    expect(await a.ctl.verificar()).toMatchObject({ ok: false, motivo: 'emisor-ocupado' })
    await a.ctl.cerrar()
  })
})

describe('cierre: nada queda vivo', () => {
  it('tras cerrar no hay temporizadores, oyentes, peticiones ni tareas; los eventos, avisos y respuestas tardías no hacen nada', async () => {
    const { a, b, nav, banco } = await par()
    await a.ctl.abrir(); await b.ctl.abrir()
    await inicioConfirmado(a)
    for (let i = 0; i < 10; i += 1) await tick()
    a.f.guion.push('colgar')
    expect((await a.ctl.registrar(PUNTO())).ok).toBe(true)
    for (let i = 0; i < 30 && a.comandos().length < 2; i += 1) await tick()
    const r = await a.ctl.cerrar()
    expect(r).toMatchObject({ cerrado: true, eraPropietario: true, temporizadores: 0, oyentes: 0, solicitudes: 0, tareas: 0, canal: false })
    expect(a.rv.timers).toHaveLength(0)
    expect(a.oyentesVivos()).toBe(0)
    expect(a.ctl.estado().modo).toBe('cerrado')
    // B, promovida, ya es la dueña; lo de A no la afecta. Se prueba con A: eventos tardíos
    const antes = await volcarBase(a.almacen)
    const llamadas = a.f.llamadas.length
    a.conectar(); a.visibilidad(true); a.desconectar()
    a.ctl.reintentarAhora()
    for (const t of [...a.rv.timers]) t.fn()
    for (let i = 0; i < 20; i += 1) await tick()
    expect(a.f.llamadas).toHaveLength(llamadas)
    expect(await a.ctl.registrar(PUNTO())).toMatchObject({ ok: false, motivo: 'cerrado' })
    expect(a.ctl.diagnostico()).toMatchObject({ temporizadores: 0, oyentes: 0, solicitudes: 0, tareas: 0 })
    void antes; void nav; void banco
    await b.ctl.cerrar()
  })
  it('cerrar una pestaña de solo lectura: cancela su espera en cola y no deja nada', async () => {
    const { a, b, nav } = await par()
    await a.ctl.abrir(); await b.ctl.abrir()
    expect(nav.locks.enCola('sebel-ctl-sesion:L1:P')).toBe(1)
    const r = await b.ctl.cerrar()
    expect(r).toMatchObject({ cerrado: true, eraPropietario: false, temporizadores: 0, oyentes: 0, solicitudes: 0, tareas: 0 })
    expect(nav.locks.enCola('sebel-ctl-sesion:L1:P')).toBe(0)
    expect(b.oyentesVivos()).toBe(0)
    expect(b.rv.timers).toHaveLength(0)
    expect(a.ctl.estado().propietario).toBe(true)
    await a.ctl.cerrar()
  })
  it('identidad: sin registro de activación o con otro dispositivo no se controla (sin emisor ni red)', async () => {
    for (const [identidad, motivo] of [[() => null, 'sin-identidad'], [() => ({ token: TOKEN, deviceId: 'otro-telefono' }), 'dispositivo-distinto']]) {
      const nav = navegadorFalso()
      const banco = servidorNuevo()
      const nombreBD = nombreBase()
      const normal = await pestana(nav, banco, { nombreBD })
      await normal.ctl.abrir()
      await inicioConfirmado(normal)
      await normal.ctl.cerrar()
      const p = await pestana(nav, banco, { nombreBD, identidad })
      await p.ctl.abrir()
      expect(p.ctl.estado().aviso).toMatchObject({ tipo: motivo })
      expect(await p.ctl.registrar(PUNTO())).toMatchObject({ ok: false, motivo })
      expect(p.f.llamadas).toHaveLength(0)
      await p.ctl.cerrar()
    }
  })
})
