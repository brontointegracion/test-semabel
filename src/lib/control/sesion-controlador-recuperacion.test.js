import { describe, expect, it } from 'vitest'
import {
  ID, T0, cmd, cuerpoDeServidor, drenarPestana, navegadorFalso, nombreBase, pestana, respuesta, servidorNuevo, tick,
} from './prueba/auxiliares-controlador'
import { leerSesion, registrarParadaDeTransporte, verificarInstantanea } from './sesion-almacen'

// REPORT_130: recuperación EXPLÍCITA de una parada persistida «no-autorizado» (401), con el controlador de punta a punta. El
// servidor es el banco sintético del motor; los 401 se fabrican con el guion de la red. Se mira el almacén durable y el orden de
// las peticiones, no lo que el controlador dice de sí.

const ctxLeer = { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }
const leer = (p) => leerSesion(p.almacen, ID, ctxLeer)
const PUNTO = (extra = {}) => ({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId: cmd('pto'), ...extra })
const asentar = async () => { for (let i = 0; i < 12; i += 1) await tick() }
const volcar = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})
/** Orden cronológico de las peticiones: 'P:<cmdId>' para comandos, 'E' para /estado, 'M' para muestras. */
const traza = (p) => p.f.llamadas.map((l) => (l.url.endsWith('/comandos') ? `P:${JSON.parse(l.cuerpo).cmdId}` : l.url.endsWith('/estado') ? 'E' : l.url.endsWith('/preparacion') ? 'R' : 'M'))
const sinMuestras = (t) => t.filter((x) => x !== 'M')

/**
 * Inicio confirmado; tres puntos guardados sin red; al volver la red el PRIMERO sale y llega un 401 fabricado (con `servidorLoRecibio` la
 * orden SÍ llegó al servidor y solo se perdió la respuesta). Resultado: parada persistida; la primera «enviando», dos pendientes detrás.
 */
async function escenario({ servidorLoRecibio = true, extra = {}, nombreBD = nombreBase(), nav = navegadorFalso(), banco = servidorNuevo() } = {}) {
  const a = await pestana(nav, banco, { nombreBD, ...extra })
  await a.ctl.abrir()
  expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
  await drenarPestana(a)
  await asentar()
  a.desconectar()
  const ids = []
  for (let i = 0; i < 3; i += 1) { const cmdId = cmd(`p${i}-`); ids.push(cmdId); expect((await a.ctl.registrar(PUNTO({ cmdId }))).ok).toBe(true) }
  a.f.guiones.comandos.push(async (llamada) => {
    if (servidorLoRecibio) await banco.reenviar(JSON.parse(llamada.cuerpo), banco.ahora)
    return respuesta(401, { error: 'no-autorizado' })
  })
  a.conectar()
  await drenarPestana(a)
  await asentar()
  const l = await leer(a)
  expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', clase: 'no-autorizado', http: 401, cmdId: ids[0] })
  expect(l.entradas.slice(1).map((e) => e.estado)).toEqual(['enviando', 'pendiente', 'pendiente'])
  return { nav, banco, nombreBD, a, ids }
}
const CONFIRMA = { confirmadoPorOperador: true }

describe('recuperación explícita: camino feliz', () => {
  it('respuesta perdida de una orden ACEPTADA: se resuelve por repetición idéntica ANTES de que salga nada más; luego /estado; luego se reanuda en orden', async () => {
    const { a, banco, ids } = await escenario({ servidorLoRecibio: true })
    const antes = await leer(a)
    const original = antes.entradas[1].cuerpoJson
    const nPost = a.comandos().length
    const recibosAntes = antes.entradas.map((e) => e.recibo)
    const t0 = traza(a).length
    const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, reanudada: true })
    await asentar()
    await drenarPestana(a)
    // orden de la red tras la recuperación: la MISMA orden, luego /estado, y solo después las dependientes
    const t = sinMuestras(traza(a).slice(t0))
    expect(t).toEqual([`P:${ids[0]}`, 'E', `P:${ids[1]}`, `P:${ids[2]}`])
    expect(a.comandos()[nPost].cuerpo).toBe(original) // texto exacto: mismo sobre, mismo cmdId, misma secuencia
    const despues = await leer(a)
    expect(despues.sesion.detenida).toBeNull()
    expect(despues.entradas.map((e) => e.estado)).toEqual(['confirmada', 'confirmada', 'confirmada', 'confirmada'])
    // el recibo de la repetición es el mismo que el servidor dio la primera vez (repetición idéntica)
    expect(despues.entradas[1].recibo).toMatchObject({ resultado: 'aceptado' })
    expect(despues.entradas[0].recibo).toEqual(recibosAntes[0])
    expect(despues.entradas.slice(1).map((e) => e.cmdId)).toEqual(ids)
    expect(banco.adaptador.estado().eventos.filter((e) => e.tipo === 'punto')).toHaveLength(3) // ni duplicados ni pérdidas
    expect(a.ctl.estado().recuperacion).toMatchObject({ enCurso: false, ultima: { ok: true } })
    expect(a.ctl.estado().estados).not.toContain('parada-persistida')
    await a.ctl.cerrar()
  })

  it('401 transitorio donde el servidor NO recibió la orden: la repetición la entrega por primera vez y todo sigue igual', async () => {
    const { a, banco, ids } = await escenario({ servidorLoRecibio: false })
    expect(banco.adaptador.estado().eventos.filter((e) => e.tipo === 'punto')).toHaveLength(0)
    const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    await asentar(); await drenarPestana(a)
    expect(banco.adaptador.estado().eventos.filter((e) => e.tipo === 'punto')).toHaveLength(3)
    expect((await leer(a)).entradas.slice(1).map((e) => e.cmdId)).toEqual(ids)
    expect((await leer(a)).sesion.detenida).toBeNull()
    await a.ctl.cerrar()
  })

  it('sin orden incierta (la parada llegó con todo resuelto): solo /estado y la operación atómica; lo pendiente se conserva y sale después', async () => {
    const { a, ids } = await escenario({ servidorLoRecibio: true })
    // se resuelve primero la incierta y la segunda queda pendiente: se simula con una recuperación que falla en /estado
    a.f.guiones.estado.push(respuesta(503, {}))
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false, motivo: 'estado-no-disponible' })
    const l = await leer(a)
    expect(l.entradas.slice(1).map((e) => e.estado)).toEqual(['confirmada', 'pendiente', 'pendiente'])
    const t0 = traza(a).length
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: true })
    await asentar(); await drenarPestana(a)
    expect(sinMuestras(traza(a).slice(t0))).toEqual(['E', `P:${ids[1]}`, `P:${ids[2]}`])
    await a.ctl.cerrar()
  })
})

describe('recuperación explícita: nada se reanuda sin pruebas', () => {
  it('sin confirmación explícita no se hace nada (ni una petición)', async () => {
    const { a } = await escenario()
    const antes = await volcar(a.almacen)
    const n = a.f.llamadas.length
    for (const v of [undefined, {}, { confirmadoPorOperador: false }, { confirmadoPorOperador: 'true' }, { confirmadoPorOperador: 1 }]) {
      expect(await a.ctl.recuperarDeNoAutorizado(v)).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    }
    expect(a.f.llamadas).toHaveLength(n)
    expect(await volcar(a.almacen)).toBe(antes)
    await a.ctl.cerrar()
  })

  it('resultado desconocido (la repetición no obtiene respuesta) o un 401 otra vez: la parada, las órdenes y las dependientes quedan; no se pide /estado', async () => {
    for (const fallo of [new TypeError('sin conexión'), respuesta(401, { error: 'no-autorizado' }), respuesta(503, {}), respuesta(200, {}, { texto: 'no es json' })]) {
      const { a } = await escenario()
      const antes = (await leer(a)).entradas
      a.f.guiones.comandos.push(fallo)
      const t0 = traza(a).length
      const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
      expect(r, String(fallo)).toMatchObject({ ok: false, motivo: 'resultado-desconocido' })
      await asentar()
      const t = sinMuestras(traza(a).slice(t0))
      expect(t).toHaveLength(1) // solo la repetición de la orden incierta: ni /estado ni dependientes
      const despues = await leer(a)
      expect(despues.sesion.detenida).toMatchObject({ clase: 'no-autorizado', cmdId: antes[1].cmdId })
      expect(despues.entradas.map((e) => [e.cmdId, e.clientSeq, e.cuerpoJson])).toEqual(antes.map((e) => [e.cmdId, e.clientSeq, e.cuerpoJson]))
      expect(despues.entradas.map((e) => e.estado)).toEqual(['confirmada', 'enviando', 'pendiente', 'pendiente'])
      await a.ctl.cerrar()
    }
  })

  it('credencial revocada, vencida o «solo recibos» (el servidor responde 401 a /estado), 507, 503, red caída o cuerpo mal formado: NO se reanuda y la parada queda', async () => {
    const casos = [
      ['401 (revocada / vencida / solo recibos)', respuesta(401, { error: 'no-autorizado' }), 'no-autorizado'],
      ['507', respuesta(507, {}), 'estado-no-disponible'],
      ['503', respuesta(503, {}), 'estado-no-disponible'],
      ['red caída', new TypeError('sin conexión'), 'estado-no-disponible'],
      ['JSON roto', respuesta(200, {}, { texto: '{no' }), 'estado-no-disponible'],
      ['cuerpo sin forma', respuesta(200, { hola: 1 }), 'estado-no-disponible'],
    ]
    const { a, ids } = await escenario()
    for (const [nombre, paso, motivo] of casos) {
      a.f.guiones.estado.push(paso)
      const antes = await volcar(a.almacen)
      const posts = a.comandos().length
      const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
      expect(r, nombre).toMatchObject({ ok: false, motivo })
      await asentar()
      expect(a.comandos().length - posts, nombre).toBeLessThanOrEqual(nombre.startsWith('401') ? 1 : 0) // solo la repetición de la incierta, una vez
      const l = await leer(a)
      expect(l.sesion.detenida, nombre).toMatchObject({ clase: 'no-autorizado' })
      expect(l.entradas.slice(2).map((e) => e.estado), nombre).toEqual(['pendiente', 'pendiente']) // las dependientes no salieron
      if (nombre !== casos[0][0]) expect(await volcar(a.almacen), nombre).toBe(antes)
    }
    expect((await leer(a)).entradas.slice(1).map((e) => e.cmdId)).toEqual(ids)
    // y con una lectura buena sí se reanuda: la parada solo cedía a la prueba
    expect((await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).ok).toBe(true)
    await a.ctl.cerrar()
  })

  it('credencial de OTRO dispositivo: la instantánea no es de este dispositivo y no se reanuda', async () => {
    const { a, banco } = await escenario()
    a.f.guiones.estado.push(respuesta(200, cuerpoDeServidor(banco, { deviceId: 'tel-OTRO' })))
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false, motivo: 'instantanea-invalida' })
    expect((await leer(a)).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    await a.ctl.cerrar()
  })

  it('identidad de la activación de otro dispositivo, o sin identidad: ni una petición', async () => {
    const { a, nav, banco, nombreBD } = await escenario()
    await a.ctl.cerrar()
    for (const [identidad, motivo] of [[() => ({ token: 'T', deviceId: 'tel-OTRO' }), 'dispositivo-distinto'], [() => null, 'sin-identidad']]) {
      const p = await pestana(nav, banco, { nombreBD, identidad })
      await p.ctl.abrir()
      await asentar()
      const r = await p.ctl.recuperarDeNoAutorizado(CONFIRMA)
      expect(r.ok).toBe(false)
      expect(['dispositivo-distinto', 'sin-identidad']).toContain(r.motivo)
      void motivo
      expect(p.comandos()).toHaveLength(0)
      expect(p.f.llamadas.filter((l) => l.url.endsWith('/estado'))).toHaveLength(0)
      await p.ctl.cerrar()
    }
  })

  it('sin internet no se intenta nada', async () => {
    const { a } = await escenario()
    a.desconectar()
    const n = a.f.llamadas.length
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false, motivo: 'sin-internet' })
    expect(a.f.llamadas).toHaveLength(n)
    await a.ctl.cerrar()
  })

  it('una diferencia real con el servidor es una divergencia: se registra como siempre y la parada NO se borra', async () => {
    const { a, banco } = await escenario({ servidorLoRecibio: true })
    a.f.guiones.estado.push(() => { const c = cuerpoDeServidor(banco); c.cursor.ultimoClientSeq += 9; return respuesta(200, c) })
    const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r).toMatchObject({ ok: false, motivo: 'divergencia' })
    await asentar()
    const l = await leer(a)
    expect(l.sesion.divergencia).toMatchObject({ causa: 'instantanea-distinta' })
    expect(l.sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    expect(a.ctl.estado().estados).toContain('divergencia')
    // y con divergencia ya no hay recuperación posible
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false })
    expect((await leer(a)).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    await a.ctl.cerrar()
  })

  it('si la sesión cambia mientras se pide /estado, la evidencia se descarta; el siguiente intento usa evidencia nueva', async () => {
    const { a, banco } = await escenario({ servidorLoRecibio: true })
    a.f.guiones.estado.push(async () => {
      const cuerpo = cuerpoDeServidor(banco)
      // otra escritura legítima en medio (una verificación de la instantánea): la revisión avanza
      const l = await leer(a)
      expect((await verificarInstantanea(a.almacen, { id: ID, revision: l.sesion.revision, cuerpoEstado: cuerpo, ctx: ctxLeer })).ok).toBe(true)
      return respuesta(200, cuerpo)
    })
    const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r).toMatchObject({ ok: false, motivo: 'revision-cambio' })
    expect((await leer(a)).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    expect((await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).ok).toBe(true)
    await a.ctl.cerrar()
  })

  it('un fallo de la transacción (cuota, aborto) deja la parada intacta y el reintento funciona', async () => {
    let falla = false
    const gancho = (e) => { if (falla && e.op === 'reanudar-no-autorizado' && e.fase === 'antes-de-confirmar') { const x = new Error('cuota'); x.name = 'QuotaExceededError'; throw x } }
    const { a } = await escenario({ extra: { gancho } })
    falla = true
    const antes = await volcar(a.almacen)
    // la orden incierta ya se resolvió en el primer intento; el primero se prepara con una lectura mala para conservarla
    a.f.guiones.estado.push(respuesta(503, {}))
    expect((await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).ok).toBe(false)
    const mitad = await volcar(a.almacen)
    expect(mitad).not.toBe(antes) // la orden incierta SÍ quedó resuelta por su vía propia
    const r = await a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento' })
    expect(await volcar(a.almacen)).toBe(mitad)
    expect((await leer(a)).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    falla = false
    expect((await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).ok).toBe(true)
    await a.ctl.cerrar()
  })
})

describe('recuperación explícita: las demás paradas siguen cerradas', () => {
  it('conflicto (bloqueado, hueco, secuencia-ocupada, conflicto-contenido), protocolo y sobre inválido: no se recuperan ni se pide nada', async () => {
    const clases = [
      ['conflicto', 'bloqueado'], ['conflicto', 'hueco'], ['conflicto', 'secuencia-ocupada'], ['conflicto', 'conflicto-contenido'],
      ['protocolo', 'juego-distinto'], ['protocolo', 'json-invalido'], ['protocolo', 'no-encontrado'], ['sobre-invalido', null],
    ]
    for (const [clase, subtipo] of clases) {
      const nav = navegadorFalso(); const banco = servidorNuevo(); const nombreBD = nombreBase()
      const a = await pestana(nav, banco, { nombreBD })
      await a.ctl.abrir()
      expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
      await drenarPestana(a); await asentar()
      const l = await leer(a)
      expect((await registrarParadaDeTransporte(a.almacen, { id: ID, revision: l.sesion.revision, parada: { clase, subtipo }, ctx: ctxLeer })).ok).toBe(true)
      await a.ctl.releer()
      const antes = await volcar(a.almacen)
      const n = a.f.llamadas.length
      expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA), `${clase}/${subtipo}`).toMatchObject({ ok: false, motivo: 'parada-no-recuperable' })
      expect(a.f.llamadas).toHaveLength(n)
      expect(await volcar(a.almacen)).toBe(antes)
      await a.ctl.cerrar()
    }
  })

  it('sin ninguna parada, tampoco hay nada que recuperar', async () => {
    const nav = navegadorFalso(); const banco = servidorNuevo()
    const a = await pestana(nav, banco, { nombreBD: nombreBase() })
    await a.ctl.abrir()
    expect((await a.ctl.iniciarPartido({ cmdId: cmd('ini'), confirmadoPorOperador: true })).ok).toBe(true)
    await drenarPestana(a); await asentar()
    const n = a.f.llamadas.length
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false, motivo: 'parada-no-recuperable' })
    expect(a.f.llamadas).toHaveLength(n)
    await a.ctl.cerrar()
  })
})

describe('recuperación explícita: propiedad, recarga y automatismos', () => {
  it('dos pestañas: la de solo lectura no puede recuperar (ni una petición); la propietaria sí', async () => {
    const { a, nav, banco, nombreBD } = await escenario()
    const b = await pestana(nav, banco, { nombreBD })
    await b.ctl.abrir()
    expect(b.ctl.estado().propietario).toBe(false)
    const antes = await volcar(b.almacen)
    expect(await b.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false, motivo: 'solo-lectura' })
    expect(b.f.llamadas).toHaveLength(0)
    expect(await volcar(b.almacen)).toBe(antes)
    expect((await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).ok).toBe(true)
    await asentar()
    // B ve el resultado desde lo durable, sin escribir
    await b.ctl.releer()
    expect(b.ctl.estado().sesion.detenida).toBeNull()
    await b.ctl.cerrar(); await a.ctl.cerrar()
  })

  it('recargar, reconectar, volver a la pestaña, reintentar o verificar NUNCA borran la parada ni mandan las dependientes', async () => {
    const { a, nav, banco, nombreBD } = await escenario()
    await a.ctl.cerrar()
    const p = await pestana(nav, banco, { nombreBD })
    await p.ctl.abrir()
    await drenarPestana(p); await asentar()
    p.desconectar(); p.conectar(); p.visibilidad(false); p.visibilidad(true)
    p.ctl.reintentarAhora()
    await drenarPestana(p)
    await p.ctl.verificar()
    await avanzarMucho(p, banco)
    expect(p.comandos()).toHaveLength(0)
    const l = await leer(p)
    expect(l.sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    expect(l.entradas.slice(1).map((e) => e.estado)).toEqual(['enviando', 'pendiente', 'pendiente'])
    expect(p.ctl.estado().recuperacion).toMatchObject({ enCurso: false, ultima: null })
    // y tras la recarga la recuperación explícita sigue funcionando con la misma credencial
    expect((await p.ctl.recuperarDeNoAutorizado(CONFIRMA)).ok).toBe(true)
    await p.ctl.cerrar()
  })

  it('mientras se recupera no se despierta el emisor; una segunda llamada simultánea se rechaza por ocupada', async () => {
    const { a, banco } = await escenario()
    let soltar
    a.f.guiones.estado.push(() => new Promise((resolver) => { soltar = () => resolver(respuesta(200, cuerpoDeServidor(banco))) }))
    const primera = a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    for (let i = 0; i < 60 && !soltar; i += 1) await tick()
    expect(typeof soltar).toBe('function')
    expect(a.ctl.estado().recuperacion.enCurso).toBe(true)
    expect(await a.ctl.recuperarDeNoAutorizado(CONFIRMA)).toMatchObject({ ok: false, motivo: 'ocupado' })
    a.ctl.reintentarAhora(); await asentar()
    const posts = a.comandos().length
    soltar()
    expect((await primera).ok).toBe(true)
    await asentar(); await drenarPestana(a)
    expect(a.comandos().length).toBeGreaterThan(posts) // las dependientes salen DESPUÉS de confirmarse la operación
    expect((await leer(a)).entradas.slice(1).every((e) => e.estado === 'confirmada')).toBe(true)
    await a.ctl.cerrar()
  })

  it('cerrar el controlador durante la recuperación no escribe nada y la parada queda', async () => {
    const { a, banco } = await escenario()
    let soltar
    a.f.guiones.estado.push(() => new Promise((resolver) => { soltar = () => resolver(respuesta(200, cuerpoDeServidor(banco))) }))
    const primera = a.ctl.recuperarDeNoAutorizado(CONFIRMA)
    for (let i = 0; i < 60 && !soltar; i += 1) await tick()
    const cierre = a.ctl.cerrar()
    soltar()
    expect((await primera).ok).toBe(false)
    await cierre
    expect((await leer(a)).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
  })
})

async function avanzarMucho(p, banco) {
  for (let k = 0; k < 12; k += 1) {
    p.rv.mono += 60_000
    banco.ahora = T0 + (p.rv.mono - 1000)
    while (p.rv.timers.length && p.rv.timers.some((t) => t.en <= p.rv.mono)) { p.rv.timers.sort((x, y) => x.en - y.en); const t = p.rv.timers.shift(); t.fn(); await asentar() }
  }
}
