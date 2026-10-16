import { describe, expect, it } from 'vitest'
import { ID, T0, cuerpoDeServidor, enviarAlServidor, servidorNuevo, telefonoNuevo } from './prueba/auxiliares-sesion'
import { aplicarRecibo, leerSesion, leerTotales, marcarEnviando, reanudarTrasNoAutorizadoSesion, registrarParadaDeTransporte } from './sesion-almacen'
import { CLASES_DE_TRANSPORTE, reanudarTrasNoAutorizado } from './sesion-motor'

// REPORT_130: la operación atómica que borra SOLO la parada «no-autorizado» (401). Datos sintéticos; el «servidor» es el banco del motor.

const volcar = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})
const PUNTO = (tel, j = 'J1') => tel.orden('anotar', { equipoId: 'E1', jugadorId: j, puntos: 2 })

/** Inicio confirmado; tres puntos guardados; el primero «enviando» (respuesta perdida) y la parada 401 que lo señala. */
async function conParada({ gancho = null, clase = 'no-autorizado', señalar = true } = {}) {
  const banco = servidorNuevo()
  const tel = await telefonoNuevo(banco, { gancho })
  await tel.crear()
  await tel.iniciar()
  expect((await tel.enviarSiguiente()).aplicado.ok).toBe(true)
  for (const j of ['J1', 'J2', 'J1']) expect((await tel.encolar(PUNTO(tel, j))).ok).toBe(true)
  const primera = (await tel.leer()).entradas.find((e) => e.estado === 'pendiente')
  const m = tel.nota(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: primera.cmdId, ctx: tel.ctx() }))
  expect(m.ok).toBe(true)
  const r = tel.nota(await registrarParadaDeTransporte(tel.almacen, { id: ID, revision: tel.revision, parada: { clase, ...(clase === 'conflicto' ? { subtipo: 'bloqueado' } : {}), ...(señalar ? { cmdId: primera.cmdId } : {}) }, ctx: tel.ctx() }))
  expect(r.ok).toBe(true)
  return { banco, tel, primera, cuerpoJson: m.cuerpoJson }
}
/** Resuelve la orden incierta como lo hace la vía explícita: mismo texto, un intento más, recibo aplicado (la parada sigue). */
async function resolver({ banco, tel, primera }) {
  const m = tel.nota(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: primera.cmdId, confirmadoPorOperador: true, ctx: tel.ctx() }))
  expect(m.ok).toBe(true)
  const s = await enviarAlServidor(banco, m.cuerpoJson)
  expect(tel.nota(await aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo: s.recibo, ctx: tel.ctx() })).ok).toBe(true)
}
const evidenciaDe = (l) => ({ revision: l.sesion.revision, paradaEn: l.sesion.detenida.en ?? null, paradaCmdId: l.sesion.detenida.cmdId ?? null })
const reanudar = (tel, l, extra = {}) => reanudarTrasNoAutorizadoSesion(tel.almacen, {
  id: ID, revision: l.sesion.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), evidencia: evidenciaDe(l), confirmadoPorOperador: true, ctx: tel.ctx(), ...extra,
})

describe('reanudarTrasNoAutorizado — camino feliz', () => {
  it('con la orden incierta resuelta y una instantánea fresca del mismo juego y dispositivo, borra SOLO la parada; todo lo demás queda byte a byte', async () => {
    const c = await conParada()
    await resolver(c)
    const antes = await c.tel.leer()
    expect(antes.sesion.detenida).toMatchObject({ clase: 'no-autorizado', http: 401 })
    const totalesAntes = (await leerTotales(c.tel.almacen)).totales
    const r = await reanudar(c.tel, antes)
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, reanudada: true, desdeRevision: antes.sesion.revision, verificadaRev: antes.sesion.base.estado.rev })
    const despues = await c.tel.leer()
    expect(despues.sesion.detenida).toBeNull()
    expect(despues.sesion.verificacion).toMatchObject({ nivel: 'verificada', verificadaRev: antes.sesion.base.estado.rev })
    expect(despues.sesion.revision).toBe(antes.sesion.revision + 1)
    // entradas: idénticas (sobres, cmdId, número, intentos, recibos, huellas, reservas, bytes y estado)
    expect(JSON.stringify(despues.entradas)).toBe(JSON.stringify(antes.entradas))
    expect(despues.entradas.map((e) => e.estado)).toEqual(['confirmada', 'confirmada', 'pendiente', 'pendiente'])
    // sesión: solo cambian detenida, verificación, revisión y contabilidad (uso)
    const { detenida: d1, verificacion: v1, revision: r1, uso: u1, ...resto1 } = antes.sesion
    const { detenida: d2, verificacion: v2, revision: r2, uso: u2, ...resto2 } = despues.sesion
    void d1; void v1; void r1; void d2; void v2; void r2
    expect(resto2).toEqual(resto1)
    expect(resto2.siguienteSeq).toBe(antes.sesion.siguienteSeq)
    expect(u2.comandos).toBe(u1.comandos)
    expect(u2.reservado).toBe(u1.reservado)
    // contabilidad coherente: los totales siguen la diferencia de bytes de la sesión
    const totalesDespues = (await leerTotales(c.tel.almacen)).totales
    expect(totalesDespues.bytes - totalesAntes.bytes).toBe(u2.bytes - u1.bytes)
    expect(totalesDespues.reservado).toBe(totalesAntes.reservado)
    expect(r.vista.detenida).toBeNull()
    expect(r.vista.pendientes).toBe(2)
  })

  it('las órdenes guardadas sin enviar no cuentan como estado del servidor: la instantánea (sin ellas) verifica; con ellas, sería una divergencia', async () => {
    const c = await conParada()
    await resolver(c)
    const l = await c.tel.leer()
    // un servidor que YA tuviera los puntos pendientes no coincide con la base confirmada
    const adelantado = servidorNuevo()
    void adelantado
    const cuerpo = cuerpoDeServidor(c.banco)
    cuerpo.cursor.ultimoClientSeq += 2
    const r = await reanudarTrasNoAutorizadoSesion(c.tel.almacen, { id: ID, revision: l.sesion.revision, cuerpoEstado: cuerpo, evidencia: evidenciaDe(l), confirmadoPorOperador: true, ctx: c.tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'divergencia' })
    const d = await c.tel.leer()
    expect(d.sesion.divergencia).toMatchObject({ causa: 'instantanea-distinta' })
    expect(d.sesion.detenida).toMatchObject({ clase: 'no-autorizado' }) // la parada NO se borra
  })
})

describe('reanudarTrasNoAutorizado — rechazos sin escribir nada', () => {
  const sinCambios = async (c, l, esperado, extra = {}, argumentos = {}) => {
    const antes = await volcar(c.tel.almacen)
    const r = await reanudar(c.tel, l, { ...argumentos, ...extra })
    expect(r, JSON.stringify(argumentos)).toMatchObject({ ok: false, motivo: esperado })
    expect(await volcar(c.tel.almacen)).toBe(antes)
    expect((await c.tel.leer()).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
  }

  it('sin confirmación explícita, o con una «confirmación» que no es exactamente true', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    for (const v of [false, undefined, 'true', 1, null]) await sinCambios(c, l, 'falta-confirmacion', { confirmadoPorOperador: v })
  })

  it('evidencia atada a la revisión y a la parada: revisión vieja, parada distinta, evidencia ausente o inventada', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    await sinCambios(c, l, 'revision-desactualizada', { revision: l.sesion.revision - 1 })
    await sinCambios(c, l, 'revision-desactualizada', { revision: l.sesion.revision + 1 })
    await sinCambios(c, l, 'evidencia-obsoleta', { evidencia: { ...evidenciaDe(l), revision: l.sesion.revision - 1 } })
    await sinCambios(c, l, 'evidencia-obsoleta', { evidencia: { ...evidenciaDe(l), paradaEn: (l.sesion.detenida.en ?? 0) + 1 } })
    await sinCambios(c, l, 'evidencia-obsoleta', { evidencia: { ...evidenciaDe(l), paradaCmdId: 'otra' } })
    await sinCambios(c, l, 'evidencia-obsoleta', { evidencia: null })
    await sinCambios(c, l, 'evidencia-obsoleta', { evidencia: true })
    await sinCambios(c, l, 'evidencia-obsoleta', { evidencia: {} })
  })

  it('tras un cambio de la sesión (aquí, otra verificación) la evidencia anterior no se reutiliza', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    const evidencia = evidenciaDe(l)
    const cuerpo = cuerpoDeServidor(c.banco)
    // algo escribe en medio: la revisión avanza
    expect((await c.tel.encolar(PUNTO(c.tel))).motivo).toBeDefined() // la parada impide encolar; no cambia nada
    const { verificarInstantanea } = await import('./sesion-almacen')
    expect((await verificarInstantanea(c.tel.almacen, { id: ID, revision: l.sesion.revision, cuerpoEstado: cuerpo, ctx: c.tel.ctx() })).ok).toBe(true)
    const antes = await volcar(c.tel.almacen)
    const r = await reanudarTrasNoAutorizadoSesion(c.tel.almacen, { id: ID, revision: l.sesion.revision, cuerpoEstado: cuerpo, evidencia, confirmadoPorOperador: true, ctx: c.tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'revision-desactualizada' })
    expect(await volcar(c.tel.almacen)).toBe(antes)
    // incluso con la revisión nueva, la evidencia vieja (otra revisión) se rechaza
    const l2 = await c.tel.leer()
    expect(await reanudarTrasNoAutorizadoSesion(c.tel.almacen, { id: ID, revision: l2.sesion.revision, cuerpoEstado: cuerpo, evidencia, confirmadoPorOperador: true, ctx: c.tel.ctx() })).toMatchObject({ ok: false, motivo: 'evidencia-obsoleta' })
    expect(await volcar(c.tel.almacen)).toBe(antes)
  })

  it('con una orden todavía «enviando» (resultado desconocido) no se borra nada', async () => {
    const c = await conParada()
    const l = await c.tel.leer()
    expect(l.entradas.some((e) => e.estado === 'enviando')).toBe(true)
    await sinCambios(c, l, 'entrada-en-vuelo')
  })

  it('la orden que señala la parada aún sin resolver (pendiente) tampoco permite borrarla', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    const pendiente = l.entradas.find((e) => e.estado === 'pendiente')
    const sesion = { ...l.sesion, detenida: { ...l.sesion.detenida, cmdId: pendiente.cmdId } }
    expect(reanudarTrasNoAutorizado(sesion, l.entradas, { cuerpoEstado: cuerpoDeServidor(c.banco), evidencia: { revision: sesion.revision, paradaEn: sesion.detenida.en ?? null, paradaCmdId: pendiente.cmdId }, confirmadoPorOperador: true, ctx: c.tel.ctx() }))
      .toMatchObject({ tipo: 'rechazo', motivo: 'orden-incierta-sin-resolver' })
  })

  it('instantánea de otro dispositivo, de otro juego, mal formada o sin cuerpo: rechazada', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    await sinCambios(c, l, 'instantanea-invalida', { cuerpoEstado: cuerpoDeServidor(c.banco, { deviceId: 'tel-OTRO' }) })
    await sinCambios(c, l, 'instantanea-invalida', { cuerpoEstado: { ...cuerpoDeServidor(c.banco), gameId: 'OTRO' } })
    await sinCambios(c, l, 'instantanea-invalida', { cuerpoEstado: { ...cuerpoDeServidor(c.banco), version: 2 } })
    await sinCambios(c, l, 'instantanea-invalida', { cuerpoEstado: { error: 'no-autorizado' } })
    await sinCambios(c, l, 'instantanea-invalida', { cuerpoEstado: null })
    await sinCambios(c, l, 'instantanea-invalida', { cuerpoEstado: '{}' })
  })

  it('una sesión con divergencia no se puede reanudar', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    const sesion = { ...l.sesion, divergencia: { causa: 'x', cmdId: null, detalle: null, en: null, reciboJson: null } }
    expect(reanudarTrasNoAutorizado(sesion, l.entradas, { cuerpoEstado: cuerpoDeServidor(c.banco), evidencia: evidenciaDe(l), confirmadoPorOperador: true, ctx: c.tel.ctx() }))
      .toMatchObject({ tipo: 'rechazo', motivo: 'sesion-detenida-por-divergencia' })
  })
})

describe('reanudarTrasNoAutorizado — las demás paradas siguen cerradas', () => {
  it('conflicto (bloqueado, hueco, secuencia-ocupada, conflicto-contenido), protocolo y sobre-invalido: ni borra ni escribe', async () => {
    for (const [clase, def] of Object.entries(CLASES_DE_TRANSPORTE)) {
      if (clase === 'no-autorizado') continue
      for (const subtipo of def.subtipos) {
        const c = await conParada({ clase: 'no-autorizado' })
        await resolver(c)
        const l = await c.tel.leer()
        const sesion = { ...l.sesion, detenida: { ...l.sesion.detenida, clase, subtipo, http: def.http[0] } }
        const r = reanudarTrasNoAutorizado(sesion, l.entradas, { cuerpoEstado: cuerpoDeServidor(c.banco), evidencia: evidenciaDe({ sesion }), confirmadoPorOperador: true, ctx: c.tel.ctx() })
        expect(r, `${clase}/${subtipo}`).toMatchObject({ tipo: 'rechazo', motivo: 'parada-no-recuperable' })
      }
    }
  })

  it('un 401 con subtipo o http inesperado, un rechazo definitivo y una sesión sin parada tampoco', async () => {
    const c = await conParada(); await resolver(c)
    const l = await c.tel.leer()
    const intento = (detenida) => {
      const sesion = { ...l.sesion, detenida }
      return reanudarTrasNoAutorizado(sesion, l.entradas, { cuerpoEstado: cuerpoDeServidor(c.banco), evidencia: { revision: sesion.revision, paradaEn: detenida?.en ?? null, paradaCmdId: detenida?.cmdId ?? null }, confirmadoPorOperador: true, ctx: c.tel.ctx() })
    }
    expect(intento({ ...l.sesion.detenida, http: 409 })).toMatchObject({ motivo: 'parada-no-recuperable' })
    expect(intento({ ...l.sesion.detenida, subtipo: 'bloqueado' })).toMatchObject({ motivo: 'parada-no-recuperable' })
    expect(intento({ ...l.sesion.detenida, causa: 'rechazo-definitivo' })).toMatchObject({ motivo: 'parada-no-recuperable' })
    expect(intento(null)).toMatchObject({ motivo: 'parada-no-recuperable' })
  })
})

describe('reanudarTrasNoAutorizado — fallo de almacenamiento', () => {
  it('en cada escritura y justo antes de confirmar: la parada y todo lo demás quedan como estaban; el reintento funciona', async () => {
    let falla = null
    const c = await conParada({ gancho: (e) => { if (falla && e.op === 'reanudar-no-autorizado' && ((falla.n && e.fase === 'escribir' && e.n === falla.n) || (falla.fin && e.fase === 'antes-de-confirmar'))) { const x = new Error('cuota'); x.name = 'QuotaExceededError'; throw x } } })
    await resolver(c)
    const l = await c.tel.leer()
    for (const f of [{ n: 1 }, { n: 2 }, { fin: true }]) {
      const antes = await volcar(c.tel.almacen)
      falla = f
      const r = await reanudar(c.tel, l)
      expect(r, JSON.stringify(f)).toMatchObject({ ok: false, motivo: 'almacenamiento' })
      expect(await volcar(c.tel.almacen)).toBe(antes)
      expect((await c.tel.leer()).sesion.detenida).toMatchObject({ clase: 'no-autorizado' })
    }
    falla = null
    expect((await reanudar(c.tel, l)).ok).toBe(true)
    expect((await leerSesion(c.tel.almacen, ID, c.tel.ctx())).sesion.detenida).toBeNull()
  })
})

void T0
