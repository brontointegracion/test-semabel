import { describe, expect, it } from 'vitest'
import { crearAtribucion } from '../motor'
import { JUGADORES_DE_PRUEBA } from '../motor/prueba/banco'
import { JUGADORES_NUMERADOS, preparacionDePrueba } from '../motor/prueba/auxiliares-preparacion'
import { ID, PARTIDO, T0, cmd, cuerpoDeServidor, enviarAlServidor, reabrir, servidorNuevo, telefonoNuevo } from './prueba/auxiliares-sesion'
import {
  LIMITES, aplicarRecibo, leerSesion, leerTotales, marcarEnviando, reanudarSesion, refrescarAntesDelInicioDeSesion,
  registrarParadaDeTransporte, verificarInstantanea, abrirAlmacen, encolar,
} from './sesion-almacen'
import {
  CLASES_DE_TRANSPORTE, envioAutomaticoPermitido, evaluarInicio, medirEntrada, medirSesion, ordenDeInicio, prepararEnvio, prepararParadaDeTransporte, refrescarAntesDelInicio,
} from './sesion-motor'

// REPORT_123. C1: parada DE TRANSPORTE durable (no es un rechazo ni una divergencia; no inventa recibos). C3: refrescar la base
// de una sesión que todavía no inició. Datos sintéticos; el «servidor» es el banco del motor (procesador real).

const ctxDe = (extra = {}) => ({ ahoraEstimado: T0, actorId: 'yo', enLinea: true, ahora: T0, ...extra })
const volcar = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})
const JUGADOR_NUEVO = { id: 'J7', equipoId: 'E1', nombre: 'Nueva Jugadora' }
const prepNueva = () => preparacionDePrueba(PARTIDO, { jugadores: [...JUGADORES_NUMERADOS, { ...JUGADOR_NUEVO, dorsal: 5 }] })
/** Cambio de plantilla en el servidor sintético (partido aún programado): atribución con una ficha más. */
const cambiarPlantilla = (banco) => banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), { ...JUGADOR_NUEVO }] }))

/** Encola el inicio con la preparación dada (como lo hace quien llama tras evaluarInicio). */
async function encolarInicio(tel, prep = preparacionDePrueba(PARTIDO)) {
  const l = await tel.leer()
  const g = evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: l.entradas, preparacion: prep })
  if (!g.puede) throw new Error(`inicio: ${g.motivo}`)
  const o = ordenDeInicio({ cmdId: cmd('ini'), preparacion: prep, tiempo: tel.orden('x').tiempo, sesion: l.sesion })
  const r = await tel.encolar(o.orden)
  expect(r.ok).toBe(true)
  return o.orden
}
const parar = (tel, parada, extra = {}) => registrarParadaDeTransporte(tel.almacen, { id: ID, revision: tel.revision, parada, ctx: tel.ctx(), ...extra })
const aTel = (r, tel) => tel.nota(r)

/** Inicio «enviando» sin recibo (respuesta perdida). */
async function conInicioIncierto() {
  const banco = servidorNuevo()
  const tel = await telefonoNuevo(banco)
  await tel.crear()
  const orden = await encolarInicio(tel)
  const m = tel.nota(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: orden.cmdId, ctx: tel.ctx() }))
  expect(m.ok).toBe(true)
  return { banco, tel, orden, cuerpoJson: m.cuerpoJson }
}

// ---------------------------------------------------------------------------
describe('C1 — parada de transporte', () => {
  it('se guarda atómicamente, sobrevive a reabrir la base y bloquea el envío automático y las órdenes nuevas', async () => {
    const { tel, orden } = await conInicioIncierto()
    const r = aTel(await parar(tel, { clase: 'no-autorizado', cmdId: orden.cmdId }), tel)
    expect(r).toMatchObject({ ok: true, detenida: { causa: 'transporte', clase: 'no-autorizado', subtipo: null, http: 401, cmdId: orden.cmdId, en: T0 } })
    // recarga: otra conexión sobre la MISMA base
    const otra = await reabrir(tel.almacen)
    const l = await leerSesion(otra, ID, ctxDe())
    expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', clase: 'no-autorizado' })
    expect(envioAutomaticoPermitido(l.sesion)).toBe(false)
    expect(await marcarEnviando(otra, { id: ID, revision: l.sesion.revision, cmdId: orden.cmdId, ctx: ctxDe() })).toMatchObject({ ok: false, motivo: 'cola-detenida' })
    expect(await encolar(otra, { id: ID, revision: l.sesion.revision, orden: tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }), ctx: ctxDe() })).toMatchObject({ ok: false })
    // no es un rechazo ni una divergencia
    expect(l.sesion.divergencia).toBeNull()
    expect(l.entradas[0].estado).toBe('enviando')
    expect(l.vista.puntuacion.habilitada).toBe(false)
  })

  it('deja intactos sobres, cmdId, número, intentos, recibos y reservas; la contabilidad se recalcula y es coherente', async () => {
    const { tel } = await conInicioIncierto()
    const antes = await tel.leer()
    const t0 = (await leerTotales(tel.almacen)).totales
    const r = aTel(await parar(tel, { clase: 'conflicto', subtipo: 'hueco' }), tel)
    expect(r.ok).toBe(true)
    const despues = await tel.leer()
    expect(JSON.stringify(despues.entradas)).toBe(JSON.stringify(antes.entradas)) // byte a byte
    expect(despues.sesion.siguienteSeq).toBe(antes.sesion.siguienteSeq)
    expect(despues.sesion.base).toEqual(antes.sesion.base)
    expect(despues.sesion.uso.reservado).toBe(antes.sesion.uso.reservado)
    expect(despues.sesion.uso.bytes).toBe(medirSesion(despues.sesion) + despues.entradas.reduce((s, f) => s + f.bytes, 0))
    const t1 = (await leerTotales(tel.almacen)).totales
    expect(t1.bytes - t0.bytes).toBe(despues.sesion.uso.bytes - antes.sesion.uso.bytes)
    expect(t1.reservado).toBe(t0.reservado)
    expect(despues.entradas.every((f) => f.bytes === medirEntrada(f))).toBe(true)
  })

  it('evidencia acotada: solo listas cerradas; token, cabeceras y cuerpos de respuesta no se guardan', async () => {
    const { tel } = await conInicioIncierto()
    const r = aTel(await parar(tel, { clase: 'protocolo', subtipo: 'json-invalido', http: 400, token: 'SECRETO-TOKEN', cabeceras: { authorization: 'Bearer SECRETO' }, cuerpo: '{"codigo":"PRIVADO"}' }), tel)
    expect(r.ok).toBe(true)
    expect(Object.keys(r.detenida).sort()).toEqual(['causa', 'clase', 'cmdId', 'en', 'http', 'subtipo'])
    expect(await volcar(tel.almacen)).not.toMatch(/SECRETO|PRIVADO|authorization/)
    // lo que no está en las listas cerradas se rechaza SIN escribir
    const antes = await volcar(tel.almacen)
    for (const [p, motivo] of [
      [{ clase: 'otra' }, 'clase-invalida'], [{}, 'clase-invalida'], [null, 'clase-invalida'], [{ clase: 'toString' }, 'clase-invalida'],
      [{ clase: 'conflicto', subtipo: 'x' }, 'subtipo-invalido'], [{ clase: 'conflicto' }, 'subtipo-invalido'], [{ clase: 'no-autorizado', subtipo: 'hueco' }, 'subtipo-invalido'],
      [{ clase: 'conflicto', subtipo: 'hueco', http: 500 }, 'http-invalido'], [{ clase: 'sobre-invalido', http: 401 }, 'http-invalido'],
      [{ clase: 'no-autorizado', cmdId: 'no-existe' }, 'cmdId-sin-orden-viva'],
    ]) {
      expect(await registrarParadaDeTransporte(tel.almacen, { id: ID, revision: tel.revision, parada: p, ctx: tel.ctx() }), JSON.stringify(p)).toMatchObject({ ok: false, motivo })
    }
    expect(await volcar(tel.almacen)).toBe(antes)
    expect(Object.keys(CLASES_DE_TRANSPORTE).sort()).toEqual(['conflicto', 'no-autorizado', 'protocolo', 'sobre-invalido'])
  })

  it('revisión desactualizada y sesión inexistente: ningún cambio', async () => {
    const { tel } = await conInicioIncierto()
    const antes = await volcar(tel.almacen)
    expect(await registrarParadaDeTransporte(tel.almacen, { id: ID, revision: tel.revision - 1, parada: { clase: 'no-autorizado' }, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'revision-desactualizada' })
    expect(await registrarParadaDeTransporte(tel.almacen, { id: ID, revision: tel.revision + 5, parada: { clase: 'no-autorizado' }, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'revision-desactualizada' })
    expect(await registrarParadaDeTransporte(tel.almacen, { id: 'L1:otro', revision: 0, parada: { clase: 'no-autorizado' }, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'sesion-inexistente' })
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('falla de almacenamiento (cada escritura y justo antes de confirmar): nada queda, resultado explícito; el reintento funciona', async () => {
    const banco = servidorNuevo()
    let falla = null
    const tel = await telefonoNuevo(banco, { gancho: (e) => { if (falla && ((falla.n && e.fase === 'escribir' && e.n === falla.n) || (falla.fin && e.fase === 'antes-de-confirmar'))) { const x = new Error('cuota'); x.name = 'QuotaExceededError'; throw x } } })
    await tel.crear()
    await encolarInicio(tel)
    for (const f of [{ n: 1 }, { n: 2 }, { fin: true }]) {
      const antes = await volcar(tel.almacen)
      falla = f
      const r = await parar(tel, { clase: 'no-autorizado' })
      expect(r, JSON.stringify(f)).toMatchObject({ ok: false, motivo: 'almacenamiento', op: 'parada', cuota: true })
      expect(await volcar(tel.almacen)).toBe(antes)
      expect((await tel.leer()).sesion.detenida).toBeNull()
    }
    falla = null
    expect(await parar(tel, { clase: 'no-autorizado' })).toMatchObject({ ok: true })
    expect((await tel.leer()).sesion.detenida).toMatchObject({ causa: 'transporte' })
  })

  it('se registra aun con los topes agotados (es una medida de seguridad) y no cambia las reservas', async () => {
    const { tel } = await conInicioIncierto()
    const estrecho = await abrirAlmacen({ nombre: tel.almacen.db.name, limites: { ...LIMITES, maxBytesPartido: 1, maxBytesTotal: 1 } })
    const l = await tel.leer()
    const r = await registrarParadaDeTransporte(estrecho, { id: ID, revision: l.sesion.revision, parada: { clase: 'no-autorizado' }, ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: true })
    expect((await leerSesion(estrecho, ID, ctxDe())).sesion.uso.reservado).toBe(l.sesion.uso.reservado)
  })

  it('ya detenida: no se sobrescribe ni se escribe; con divergencia se rechaza', async () => {
    const { tel } = await conInicioIncierto()
    aTel(await parar(tel, { clase: 'no-autorizado' }), tel)
    const antes = await volcar(tel.almacen)
    const otra = await parar(tel, { clase: 'conflicto', subtipo: 'hueco' })
    expect(otra).toMatchObject({ ok: true, yaDetenida: true, detenida: { clase: 'no-autorizado' } })
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('cuando recarga: lo incierto se resuelve SOLO por la vía explícita con el sobre ORIGINAL; el recibo aceptado no borra la parada', async () => {
    const { banco, tel, orden, cuerpoJson } = await conInicioIncierto()
    aTel(await parar(tel, { clase: 'no-autorizado', cmdId: orden.cmdId }), tel)
    const antes = await tel.leer()
    // sin confirmación, o con la confirmación pero otro cmdId: cerrado
    expect(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: orden.cmdId, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'cola-detenida' })
    expect(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'otro', confirmadoPorOperador: true, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'cmdId-desconocido' })
    // la parada señala OTRA orden que la primera viva: tampoco se reabre
    expect(prepararEnvio({ ...antes.sesion, detenida: { ...antes.sesion.detenida, cmdId: 'otra' } }, antes.entradas, orden.cmdId, { confirmadoPorOperador: true })).toMatchObject({ tipo: 'rechazo', motivo: 'parada-de-otra-orden' })
    expect(prepararEnvio({ ...antes.sesion, detenida: { ...antes.sesion.detenida, causa: 'rechazo-definitivo' } }, antes.entradas, orden.cmdId, { confirmadoPorOperador: true })).toMatchObject({ tipo: 'rechazo', motivo: 'cola-detenida' })
    expect(await volcar(tel.almacen)).toBe(JSON.stringify({ sesiones: [antes.sesion], entradas: antes.entradas, meta: [(await leerTotales(tel.almacen)).totales] }))
    // explícito: el MISMO texto, un intento más
    const m = aTel(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: orden.cmdId, confirmadoPorOperador: true, ctx: tel.ctx() }), tel)
    expect(m).toMatchObject({ ok: true, cmdId: orden.cmdId, intentos: 2 })
    expect(m.cuerpoJson).toBe(cuerpoJson)
    const s = await enviarAlServidor(banco, m.cuerpoJson)
    expect(s.recibo.resultado).toBe('aceptado')
    const ap = aTel(await aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo: s.recibo, ctx: tel.ctx() }), tel)
    expect(ap.ok).toBe(true)
    const l = await tel.leer()
    expect(l.entradas[0]).toMatchObject({ estado: 'confirmada', cuerpoJson })
    expect(l.sesion.inicio).toBe('confirmado')
    expect(l.sesion.detenida).toMatchObject({ causa: 'transporte' }) // no se borra de forma general
    expect(envioAutomaticoPermitido(l.sesion)).toBe(false)
    // el mismo recibo otra vez: idempotente, bajo la parada
    expect(await aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo: s.recibo, ctx: tel.ctx() })).toMatchObject({ ok: true, noop: true })
  })

  it('una parada por rechazo definitivo (o cualquier otra) NO se reabre con la confirmación, y la de transporte no es «reanudable»', async () => {
    const { tel } = await conInicioIncierto()
    aTel(await parar(tel, { clase: 'protocolo', subtipo: 'no-encontrado', http: 404 }), tel)
    const l = await tel.leer()
    // sin cmdId señalado se permite la primera viva con confirmación; reanudar (rechazo definitivo) no aplica
    const rr = await reanudarSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), confirmadoPorOperador: true, ctx: tel.ctx() })
    expect(rr).toMatchObject({ ok: false, motivo: 'no-reanudable' })
    expect((await tel.leer()).sesion.detenida).toEqual(l.sesion.detenida)
  })

  it('un rechazo definitivo obtenido por la vía explícita sustituye la parada por «rechazo-definitivo» (recuperación existente)', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    // inicio con una preparación VIEJA: el servidor tiene otra versión
    const orden = await encolarInicio(tel, preparacionDePrueba(PARTIDO))
    banco.adaptador.fijarPreparacion(prepNueva())
    const m1 = aTel(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: orden.cmdId, ctx: tel.ctx() }), tel)
    aTel(await parar(tel, { clase: 'no-autorizado', cmdId: orden.cmdId }), tel)
    const m = aTel(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: orden.cmdId, confirmadoPorOperador: true, ctx: tel.ctx() }), tel)
    expect(m.cuerpoJson).toBe(m1.cuerpoJson)
    const s = await enviarAlServidor(banco, m.cuerpoJson)
    expect(s.recibo).toMatchObject({ resultado: 'rechazado', motivo: 'preparacion-desactualizada' })
    expect((await aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo: s.recibo, ctx: tel.ctx() })).ok).toBe(true)
    const l = await tel.leer()
    expect(l.sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo', cmdId: orden.cmdId })
    expect(l.entradas[0].estado).toBe('rechazada')
  })

  it('con divergencia se rechaza; con otra parada (p. ej. rechazo definitivo) se conserva sin sobrescribir', async () => {
    const { tel } = await conInicioIncierto()
    const { sesion, entradas } = await tel.leer()
    expect(prepararParadaDeTransporte({ ...sesion, divergencia: { causa: 'x' } }, entradas, { clase: 'no-autorizado' }, ctxDe())).toMatchObject({ tipo: 'rechazo', motivo: 'sesion-detenida-por-divergencia' })
    const previa = { causa: 'rechazo-definitivo', cmdId: 'a', motivo: 'm' }
    expect(prepararParadaDeTransporte({ ...sesion, detenida: previa }, entradas, { clase: 'no-autorizado' }, ctxDe())).toEqual({ tipo: 'ya-detenida', detenida: previa })
  })

  it('la verificación de una instantánea NO borra la parada', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear(); await tel.iniciar(); await tel.enviarSiguiente()
    aTel(await parar(tel, { clase: 'conflicto', subtipo: 'bloqueado' }), tel)
    const v = aTel(await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), ctx: tel.ctx() }), tel)
    expect(v).toMatchObject({ ok: true, verificada: true })
    const l = await tel.leer()
    expect(l.sesion.verificacion.nivel).toBe('verificada')
    expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', subtipo: 'bloqueado' })
    expect(envioAutomaticoPermitido(l.sesion)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('C3 — refrescar antes del inicio', () => {
  async function sesionObsoleta() {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    cambiarPlantilla(banco)
    banco.adaptador.fijarPreparacion(prepNueva())
    return { banco, tel }
  }
  const refrescar = (tel, cuerpo, preparacion, extra = {}) => refrescarAntesDelInicioDeSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo, preparacion, ctx: tel.ctx(), ...extra })

  it('antes del refresco el inicio con la preparación nueva no es posible; después sí, y la puntuación sigue deshabilitada', async () => {
    const { banco, tel } = await sesionObsoleta()
    const l0 = await tel.leer()
    expect(evaluarInicio({ enLinea: true, sesion: l0.sesion, entradas: [], preparacion: prepNueva() })).toMatchObject({ puede: false, motivo: 'atribucion-no-coincide-con-preparacion' })
    const r = aTel(await refrescar(tel, cuerpoDeServidor(banco), prepNueva()), tel)
    expect(r).toMatchObject({ ok: true, verificada: true, previaAlInicio: true })
    expect(r.atribucionRefrescada.de).not.toBe(r.atribucionRefrescada.a)
    const l = await tel.leer()
    expect(l.sesion.base.estado.atribucion.version).toBe(r.atribucionRefrescada.a)
    expect(l.sesion.base.estado.atribucion.jugadores.J7).toBeTruthy()
    expect(l.sesion).toMatchObject({ inicio: 'sin-iniciar', detenida: null, divergencia: null, siguienteSeq: l0.sesion.siguienteSeq })
    expect(l.sesion.verificacion).toMatchObject({ nivel: 'verificada', atribucionRefrescada: r.atribucionRefrescada })
    expect(l.entradas).toEqual([]) // no crea ni encola un inicio
    expect(l.vista.puntuacion).toMatchObject({ habilitada: false, motivo: 'inicio-no-confirmado' })
    expect(l.sesion.uso.bytes).toBe(medirSesion(l.sesion))
    expect((await leerTotales(tel.almacen)).totales.bytes).toBe(l.sesion.uso.bytes)
    // pedir el inicio sigue exigiendo todo lo de siempre
    expect(evaluarInicio({ enLinea: false, sesion: l.sesion, entradas: [], preparacion: prepNueva() })).toMatchObject({ puede: false, motivo: 'sin-internet' })
    expect(evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: [], preparacion: prepNueva() })).toEqual({ puede: true })
  })

  it('sin cambios en la atribución: verificada sin marca de refresco; es idempotente', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    const r = aTel(await refrescar(tel, cuerpoDeServidor(banco), preparacionDePrueba(PARTIDO)), tel)
    expect(r).toMatchObject({ ok: true, previaAlInicio: true, atribucionRefrescada: null })
    expect((await tel.leer()).sesion.verificacion.atribucionRefrescada).toBeUndefined()
  })

  it('rechaza sin escribir: orden pendiente, resultado sin resolver (inicio con respuesta perdida), parada y divergencia', async () => {
    // pendiente
    const a = await sesionObsoleta()
    await encolarInicio(a.tel)
    let antes = await volcar(a.tel.almacen)
    expect(await refrescar(a.tel, cuerpoDeServidor(a.banco), prepNueva())).toMatchObject({ ok: false, motivo: 'ordenes-vivas' })
    expect(await volcar(a.tel.almacen)).toBe(antes)
    // enviando (respuesta perdida): ni siquiera con el servidor ya iniciado puede saltarse eso ni habilitar la puntuación
    const { banco, tel, orden } = await conInicioIncierto()
    await enviarAlServidor(banco, (await tel.leer()).entradas[0].cuerpoJson) // el servidor SÍ lo aceptó; el teléfono no lo sabe
    antes = await volcar(tel.almacen)
    const fresco = cuerpoDeServidor(banco)
    expect(fresco.estado.partido.estado).toBe('vivo')
    expect(await refrescar(tel, fresco, preparacionDePrueba(PARTIDO))).toMatchObject({ ok: false, motivo: 'resultado-sin-resolver' })
    expect(await volcar(tel.almacen)).toBe(antes)
    const l = await tel.leer()
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(l.vista.puntuacion).toMatchObject({ habilitada: false, motivo: 'inicio-en-curso' })
    expect(l.entradas[0]).toMatchObject({ cmdId: orden.cmdId, estado: 'enviando' })
    // parada de transporte (no se borra) y parada con rechazo
    const b = await sesionObsoleta()
    aTel(await parar(b.tel, { clase: 'no-autorizado' }), b.tel)
    antes = await volcar(b.tel.almacen)
    expect(await refrescar(b.tel, cuerpoDeServidor(b.banco), prepNueva())).toMatchObject({ ok: false, motivo: 'cola-detenida', detalle: 'transporte' })
    expect(await volcar(b.tel.almacen)).toBe(antes)
  })

  it('rechaza partido en curso o finalizado (base o instantánea) y cualquier cosa que no sea «programado»', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear(); await tel.iniciar(); await tel.enviarSiguiente()
    const antes = await volcar(tel.almacen)
    // base vivo, inicio confirmado
    expect(await refrescar(tel, cuerpoDeServidor(banco), preparacionDePrueba(PARTIDO))).toMatchObject({ ok: false, motivo: 'no-es-previa-al-inicio' })
    expect(await volcar(tel.almacen)).toBe(antes)
    // sesión sin iniciar pero el servidor ya no está programado
    const b = await sesionObsoleta()
    const vivo = cuerpoDeServidor(banco)
    const r = await refrescar(b.tel, vivo, prepNueva())
    expect(r).toMatchObject({ ok: false, motivo: 'partido-ya-no-programado' })
    // sesión creada con un partido ya vivo o final (sin-resolver)
    const c = servidorNuevo({ estado: 'final' })
    const tc = await telefonoNuevo(c)
    await tc.crear()
    expect((await tc.leer()).sesion.inicio).toBe('sin-resolver')
    expect(await refrescar(tc, cuerpoDeServidor(c), preparacionDePrueba(PARTIDO))).toMatchObject({ ok: false, motivo: 'no-es-previa-al-inicio' })
  })

  it('juego o dispositivo equivocado, atribución malformada, equipos cambiados, preparación ausente o distinta, cursor y juego distintos: sin escribir', async () => {
    const { banco, tel } = await sesionObsoleta()
    const antes = await volcar(tel.almacen)
    const bueno = cuerpoDeServidor(banco)
    const prep = prepNueva()
    const casos = [
      ['juego equivocado', { ...bueno, gameId: 'OTRO' }, prep, 'instantanea-invalida'],
      ['dispositivo equivocado', { ...bueno, deviceId: 'tel-B' }, prep, 'instantanea-invalida'],
      ['atribución manipulada (huella)', { ...bueno, atribucion: { ...bueno.atribucion, jugadores: { ...bueno.atribucion.jugadores, J7: { equipoId: 'E2', elegible: true } } } }, prep, 'instantanea-invalida'],
      ['sin atribución', { ...bueno, atribucion: null }, prep, 'atribucion-incoherente'],
      ['cursor distinto', { ...bueno, cursor: { ...bueno.cursor, ultimoClientSeq: 3 } }, prep, 'servidor-no-coincide'],
      ['estado de juego distinto', { ...bueno, estado: { ...bueno.estado, auditSeq: 7 } }, prep, 'instantanea-distinta'],
      ['partido de otros equipos', { ...bueno, partido: { ...bueno.partido, visitaId: 'E3' } }, prep, 'atribucion-incoherente'],
      ['sin preparación', bueno, null, 'preparacion-no-disponible'],
      ['preparación de otra plantilla', bueno, preparacionDePrueba(PARTIDO), 'atribucion-no-coincide-con-preparacion'],
      ['preparación de otro juego', bueno, preparacionDePrueba('OTRO'), 'preparacion-no-disponible'],
    ]
    for (const [nombre, cuerpo, p, motivo] of casos) {
      expect(await refrescar(tel, cuerpo, p), nombre).toMatchObject({ ok: false, motivo })
    }
    expect(await volcar(tel.almacen)).toBe(antes)
    expect(JSON.stringify(refrescarAntesDelInicio((await tel.leer()).sesion, [], { cuerpoEstado: bueno, preparacion: prep }).sesion)).toContain('J7')
  })

  it('topes de bytes: exactamente el tope pasa, un byte menos rechaza (por partido y global, con reservas) y no escribe', async () => {
    const { banco, tel } = await sesionObsoleta()
    const l = await tel.leer()
    const calc = refrescarAntesDelInicio(l.sesion, l.entradas, { cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva() })
    const propuestoBytes = medirSesion({ ...calc.sesion, revision: l.sesion.revision + 1 })
    expect(propuestoBytes).toBeGreaterThan(l.sesion.uso.bytes)
    const antes = await volcar(tel.almacen)
    const prueba = async (limites) => {
      const al = await abrirAlmacen({ nombre: tel.almacen.db.name, limites: { ...LIMITES, ...limites } })
      return refrescarAntesDelInicioDeSesion(al, { id: ID, revision: l.sesion.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva(), ctx: tel.ctx() })
    }
    const rp = await prueba({ maxBytesPartido: propuestoBytes - 1 })
    expect(rp).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', causa: 'limite-de-almacenamiento', limite: 'limite-bytes-partido', adoptada: false, verificada: false })
    const rt = await prueba({ maxBytesTotal: propuestoBytes - 1 })
    expect(rt).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', limite: 'limite-bytes-total' })
    expect(await volcar(tel.almacen)).toBe(antes)
    expect((await tel.leer()).sesion.base.estado.atribucion.jugadores.J7).toBeUndefined()
    const ok = await prueba({ maxBytesPartido: propuestoBytes, maxBytesTotal: propuestoBytes })
    expect(ok).toMatchObject({ ok: true, previaAlInicio: true })
  })

  it('falla de almacenamiento: todo queda como estaba y el reintento funciona', async () => {
    const banco = servidorNuevo()
    let falla = null
    const tel = await telefonoNuevo(banco, { gancho: (e) => { if (falla && ((falla.n && e.fase === 'escribir' && e.n === falla.n) || (falla.fin && e.fase === 'antes-de-confirmar'))) { const x = new Error('cuota'); x.name = 'QuotaExceededError'; throw x } } })
    await tel.crear()
    cambiarPlantilla(banco)
    banco.adaptador.fijarPreparacion(prepNueva())
    for (const f of [{ n: 1 }, { n: 2 }, { fin: true }]) {
      const antes = await volcar(tel.almacen)
      falla = f
      expect(await refrescarAntesDelInicioDeSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva(), ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'almacenamiento', op: 'refrescar-previo' })
      expect(await volcar(tel.almacen)).toBe(antes)
    }
    falla = null
    expect((await refrescarAntesDelInicioDeSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva(), ctx: tel.ctx() })).ok).toBe(true)
  })

  it('revisión desactualizada: sin escribir', async () => {
    const { banco, tel } = await sesionObsoleta()
    const antes = await volcar(tel.almacen)
    expect(await refrescar(tel, cuerpoDeServidor(banco), prepNueva(), { revision: 9 })).toMatchObject({ ok: false, motivo: 'revision-desactualizada' })
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('tras un rechazo definitivo del inicio (preparación obsoleta): este camino se cierra; la recuperación existente (reanudar) conserva todo y exige cmdId nuevo', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    const viejo = await encolarInicio(tel, preparacionDePrueba(PARTIDO))
    cambiarPlantilla(banco)
    banco.adaptador.fijarPreparacion(prepNueva())
    const s = await tel.enviarSiguiente()
    expect(s.servidor.recibo).toMatchObject({ resultado: 'rechazado', motivo: 'preparacion-desactualizada' })
    const l1 = await tel.leer()
    expect(l1.sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo' })
    // refrescar por la vía de C3: cerrado, sin escribir
    const antes = await volcar(tel.almacen)
    expect(await refrescarAntesDelInicioDeSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva(), ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'cola-detenida', detalle: 'rechazo-definitivo' })
    expect(await volcar(tel.almacen)).toBe(antes)
    // recuperación explícita existente
    const rr = await reanudarSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva(), confirmadoPorOperador: true, ctx: tel.ctx() })
    expect(rr.ok).toBe(true)
    tel.revision = rr.vista.revision
    const l2 = await tel.leer()
    expect(l2.entradas[0]).toMatchObject({ cmdId: viejo.cmdId, estado: 'rechazada', cuerpoJson: l1.entradas[0].cuerpoJson, reciboHuella: l1.entradas[0].reciboHuella })
    // el cmdId rechazado no se reutiliza; uno nuevo sí
    const reuso = ordenDeInicio({ cmdId: viejo.cmdId, preparacion: prepNueva(), tiempo: tel.orden('x').tiempo, sesion: l2.sesion })
    expect(await tel.encolar(reuso.orden)).toMatchObject({ ok: false, motivo: 'cmdId-reutilizado' })
    const nuevo = await encolarInicio(tel, prepNueva())
    expect(nuevo.cmdId).not.toBe(viejo.cmdId)
    const s2 = await tel.enviarSiguiente()
    expect(s2.servidor.recibo.resultado).toBe('aceptado')
    expect((await tel.leer()).sesion.inicio).toBe('confirmado')
  })

  it('con entradas rechazadas y no-aplicadas ya resueltas (sin órdenes vivas) el refresco las deja byte a byte y no reutiliza su cmdId', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    const viejo = await encolarInicio(tel, preparacionDePrueba(PARTIDO))
    cambiarPlantilla(banco)
    banco.adaptador.fijarPreparacion(prepNueva())
    await tel.enviarSiguiente()
    const rr = await reanudarSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: prepNueva(), confirmadoPorOperador: true, ctx: tel.ctx() })
    tel.revision = rr.vista.revision
    // otra edición de plantilla antes del nuevo inicio
    banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), { ...JUGADOR_NUEVO }, { id: 'J6', equipoId: 'E2', nombre: 'Otra' }] }))
    banco.adaptador.fijarPreparacion(preparacionDePrueba(PARTIDO, { jugadores: [...JUGADORES_NUMERADOS, { ...JUGADOR_NUEVO, dorsal: 5 }, { id: 'J6', equipoId: 'E2', nombre: 'Otra', dorsal: 6 }] }))
    const antes = await tel.leer()
    const r = await refrescarAntesDelInicioDeSesion(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), preparacion: banco.adaptador.preparacion(), ctx: tel.ctx() })
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, previaAlInicio: true })
    tel.nota(r)
    const despues = await tel.leer()
    expect(JSON.stringify(despues.entradas)).toBe(JSON.stringify(antes.entradas))
    expect(despues.entradas[0].cmdId).toBe(viejo.cmdId)
    expect(despues.sesion.siguienteSeq).toBe(antes.sesion.siguienteSeq)
    expect(despues.sesion.inicio).toBe('sin-iniciar')
    expect(despues.vista.puntuacion.habilitada).toBe(false)
  })
})
