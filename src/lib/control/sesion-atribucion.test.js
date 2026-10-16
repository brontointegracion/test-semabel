import { describe, expect, it } from 'vitest'
import { canonico, crearAtribucion } from '../motor'
import { JUGADORES_DE_PRUEBA } from '../motor/prueba/banco'
import { ID, T0, cuerpoDeServidor, servidorNuevo, telefonoNuevo } from './prueba/auxiliares-sesion'
import { compararInstantanea, validarFilaSesion } from './sesion-motor'
import { leerSesion, leerTotales, verificarInstantanea } from './sesion-almacen'

// REPORT_121: verificar el JUEGO y refrescar la ATRIBUCIÓN son dos cosas. Tras un partido final, un cambio de plantilla permitido
// no es una divergencia; todo lo demás (juego, revisión, cursor, identidad, atribución incoherente, partido vivo) sigue deteniendo.
// Servidor sintético en memoria (procesador real del motor); la atribución del servidor se cambia como lo haría una edición
// de plantilla posterior al cierre.

const ctx = (extra = {}) => ({ ahoraEstimado: T0, actorId: 'yo', enLinea: true, ahora: T0, ...extra })
const NUEVA = { id: 'JN', equipoId: 'E1', nombre: 'Nueva Jugadora' }
const atribucionCon = (cambiar) => crearAtribucion({ equipos: ['E1', 'E2'], jugadores: cambiar(JUGADORES_DE_PRUEBA.map((j) => ({ ...j }))) })
const volcar = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})

/** Inicio, un punto y cierre ACEPTADOS: la sesión queda con el partido final en su base derivada. */
async function partidoFinal({ pendiente = false } = {}) {
  const banco = servidorNuevo()
  const tel = await telefonoNuevo(banco)
  await tel.crear()
  await tel.iniciar()
  await tel.enviarSiguiente()
  expect((await tel.encolar(tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }))).ok).toBe(true)
  await tel.enviarSiguiente()
  expect((await tel.encolar(tel.orden('cerrar-partido'))).ok).toBe(true)
  await tel.enviarSiguiente()
  expect(banco.adaptador.estado().partido.estado).toBe('final')
  if (pendiente) expect((await tel.encolar(tel.orden('deshacer'))).ok).toBe(true)
  return { banco, tel }
}
/** Edición de plantilla POSTERIOR al cierre (el servidor publica otra atribución). */
const editarPlantilla = (banco, cambiar = (j) => [...j, NUEVA]) => banco.adaptador.fijarAtribucion(atribucionCon(cambiar))

describe('refresco de la atribución tras un partido final', () => {
  it('sin cambio de plantilla: verificada como siempre, sin refresco', async () => {
    const { banco, tel } = await partidoFinal()
    const l = await tel.leer()
    const c = compararInstantanea(l.sesion, l.entradas, cuerpoDeServidor(banco), ctx())
    expect(c.tipo).toBe('verificada')
    expect(c.atribucionRefrescada).toBeUndefined()
    expect(c.sesion.verificacion).toEqual({ nivel: 'verificada', verificadaRev: l.sesion.base.estado.rev })
  })

  it('con un cambio permitido: el juego coincide, la base adopta la atribución y las etiquetas ACTUALES y queda verificada', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco)
    const l = await tel.leer()
    const cuerpo = cuerpoDeServidor(banco)
    cuerpo.etiquetas = [{ id: 'J1', etiqueta: 'Ana (nueva etiqueta)' }, { id: 'JN', etiqueta: 'Nueva' }]
    const c = compararInstantanea(l.sesion, l.entradas, cuerpo, ctx())
    expect(c.tipo).toBe('verificada')
    const de = l.sesion.base.estado.atribucion.version
    expect(c.atribucionRefrescada).toEqual({ de, a: cuerpo.atribucion.version })
    expect(de).not.toBe(cuerpo.atribucion.version)
    expect(c.sesion.base.estado.atribucion).toEqual(cuerpo.atribucion)
    expect(c.sesion.etiquetas).toEqual(cuerpo.etiquetas)
    expect(c.sesion.verificacion).toEqual({ nivel: 'verificada', verificadaRev: l.sesion.base.estado.rev, atribucionRefrescada: { de, a: cuerpo.atribucion.version } })
    // El resto de la base es exactamente el mismo: eventos, partido, reloj, revisión, cursor
    const sinAtribucion = (e) => canonico({ ...e, atribucion: null })
    expect(sinAtribucion(c.sesion.base.estado)).toBe(sinAtribucion(l.sesion.base.estado))
    expect(c.sesion.base.ultimoClientSeq).toBe(l.sesion.base.ultimoClientSeq)
    expect(c.sesion.siguienteSeq).toBe(l.sesion.siguienteSeq)
    expect(c.entradas).toEqual([]) // ninguna fila de entrada se reescribe
    expect(validarFilaSesion({ ...c.sesion, uso: l.sesion.uso }, ID).ok).toBe(true)
    // y es estable: la base refrescada coincide con la misma instantánea sin volver a refrescar
    const otra = compararInstantanea({ ...c.sesion, revision: 1 }, l.entradas, cuerpo, ctx())
    expect(otra.tipo).toBe('verificada')
    expect(otra.atribucionRefrescada).toBeUndefined()
  })

  it('desactivar un jugador USADO, o cambiar solo etiquetas, también se acepta; la historia conserva al jugador', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco, (js) => js.map((j) => (j.id === 'J1' ? { ...j, activo: false } : j)))
    const l = await tel.leer()
    const c = compararInstantanea(l.sesion, l.entradas, cuerpoDeServidor(banco), ctx())
    expect(c.tipo).toBe('verificada')
    expect(c.sesion.base.estado.atribucion.jugadores.J1).toEqual({ equipoId: 'E1', elegible: false })
    expect(c.sesion.base.estado.eventos.find((e) => e.jugadorId === 'J1')).toBeTruthy()
  })

  it('las órdenes pendientes, los recibos y las huellas NO se tocan', async () => {
    const { banco, tel } = await partidoFinal({ pendiente: true })
    editarPlantilla(banco)
    const l = await tel.leer()
    const c = compararInstantanea(l.sesion, l.entradas, cuerpoDeServidor(banco), ctx())
    expect(c.tipo).toBe('verificada')
    expect(c.entradas).toEqual([])
    expect(l.entradas.at(-1)).toMatchObject({ estado: 'pendiente', tipo: 'deshacer' })
  })
})

describe('lo que NO se refresca y sigue deteniendo', () => {
  const diverge = (c, causa, motivo) => {
    expect(c.tipo).toBe('divergencia')
    expect(c.causa).toBe(causa)
    if (motivo) expect(c.sesion.divergencia.detalle.motivo).toBe(motivo)
    expect(c.sesion.base).toBeDefined()
  }
  it.each([
    ['falta un jugador usado en un evento', (c) => { c.atribucion = atribucionCon((js) => js.filter((j) => j.id !== 'J1')) }, 'jugador-de-un-evento-ausente'],
    ['un jugador usado cambió de equipo', (c) => { c.atribucion = atribucionCon((js) => js.map((j) => (j.id === 'J1' ? { ...j, equipoId: 'E2' } : j))) }, 'jugador-de-un-evento-en-otro-equipo'],
    ['otros equipos', (c) => { c.atribucion = crearAtribucion({ equipos: ['E1', 'E3'], jugadores: [{ id: 'J1', equipoId: 'E1' }] }) }, 'equipos-de-la-atribucion-cambiaron'],
    ['el partido declara otros equipos', (c) => { c.partido.visitaId = 'E3' }, 'equipos-distintos-del-partido'],
    ['sin equipos de partido', (c) => { c.partido = null }, 'partido-sin-equipos'],
    ['sin atribución', (c) => { c.atribucion = null }, 'atribucion-ausente-o-no-integra'],
  ])('atribución incoherente: %s', async (_n, torcer, motivo) => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco)
    const l = await tel.leer()
    const cuerpo = cuerpoDeServidor(banco)
    torcer(cuerpo)
    const c = compararInstantanea(l.sesion, l.entradas, cuerpo, ctx())
    diverge(c, 'atribucion-incoherente', motivo)
    expect(c.sesion.base).toBe(l.sesion.base) // nada se adopta
  })

  it('con el partido VIVO una atribución distinta es divergencia (plantilla bloqueada)', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear(); await tel.iniciar(); await tel.enviarSiguiente()
    editarPlantilla(banco)
    const l = await tel.leer()
    const c = compararInstantanea(l.sesion, l.entradas, cuerpoDeServidor(banco), ctx())
    diverge(c, 'instantanea-distinta')
    expect(c.diferencias).toEqual(['atribucion'])
  })

  it('con el partido SIN INICIAR tampoco se refresca (el refresco previo al inicio es otra tarea)', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    editarPlantilla(banco)
    const l = await tel.leer()
    const c = compararInstantanea(l.sesion, l.entradas, cuerpoDeServidor(banco), ctx())
    diverge(c, 'instantanea-distinta')
    expect(c.diferencias).toEqual(['atribucion'])
  })

  it('una instantánea que dice «final» cuando la base NO lo es, aunque cambie la plantilla: divergencia por el estado del juego', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear(); await tel.iniciar(); await tel.enviarSiguiente()
    const l = await tel.leer()
    const falsa = cuerpoDeServidor(banco)
    falsa.estado.partido.estado = 'final' // etiqueta falsa: el servidor real sigue «vivo»
    falsa.atribucion = atribucionCon((js) => [...js, NUEVA])
    const c = compararInstantanea(l.sesion, l.entradas, falsa, ctx())
    diverge(c, 'instantanea-distinta')
    expect(c.diferencias).toEqual(expect.arrayContaining(['partido', 'atribucion']))
  })

  it.each([
    ['revisión', (c) => { c.cursor.rev += 1 }, 'rev'],
    ['cursor de secuencia', (c) => { c.cursor.ultimoClientSeq += 1 }, 'ultimoClientSeq'],
    ['eventos', (c) => { c.estado.eventos[0].puntos += 1 }, 'eventos'],
    ['reloj', (c) => { c.estado.partido.relojRestante -= 1 }, 'partido'],
    ['periodo (marca de auditoría)', (c) => { c.estado.auditSeq += 1 }, 'auditSeq'],
    ['reloj de cursor', (c) => { c.estado.cursorReloj = 7 }, 'cursorReloj'],
    ['configuración', (c) => { c.estado.config.minutosPorPeriodo = 99 }, 'config'],
  ])('un desajuste de %s detiene aunque la atribución también haya cambiado', async (_n, tocar, campo) => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco)
    const l = await tel.leer()
    const cuerpo = cuerpoDeServidor(banco)
    tocar(cuerpo)
    const c = compararInstantanea(l.sesion, l.entradas, cuerpo, ctx())
    diverge(c, 'instantanea-distinta')
    expect(c.diferencias).toEqual(expect.arrayContaining([campo, 'atribucion']))
  })

  it('otra identidad de teléfono, otro partido o una atribución con la huella manipulada: instantánea inválida', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco)
    const l = await tel.leer()
    const base = cuerpoDeServidor(banco)
    expect(compararInstantanea(l.sesion, l.entradas, { ...base, deviceId: 'otro' }, ctx())).toEqual({ tipo: 'invalida', motivo: 'dispositivo-distinto' })
    expect(compararInstantanea(l.sesion, l.entradas, { ...base, gameId: 'X' }, ctx())).toEqual({ tipo: 'invalida', motivo: 'juego-distinto' })
    const manip = JSON.parse(JSON.stringify(base))
    manip.atribucion.jugadores.J9.elegible = false
    expect(compararInstantanea(l.sesion, l.entradas, manip, ctx())).toEqual({ tipo: 'invalida', motivo: 'atribucion' })
  })

  it('una entrada en vuelo impide cualquier adopción, también la de la atribución', async () => {
    const { banco, tel } = await partidoFinal({ pendiente: true })
    editarPlantilla(banco)
    const l = await tel.leer()
    const enVuelo = l.entradas.map((f) => (f.estado === 'pendiente' ? { ...f, estado: 'enviando', intentos: 1 } : f))
    expect(compararInstantanea(l.sesion, enVuelo, cuerpoDeServidor(banco), ctx())).toEqual({ tipo: 'no-aplicable', motivo: 'entrada-en-vuelo' })
  })

  it('una orden VIVA con atribución propia no se decide aquí: no aplicable, sin adoptar nada', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco)
    const l = await tel.leer()
    const previa = l.entradas.find((f) => f.tipo === 'anotar')
    const sobre = { ...JSON.parse(previa.cuerpoJson), cmdId: 'viva-anotar', clientSeq: l.sesion.siguienteSeq }
    const viva = { ...previa, clientSeq: sobre.clientSeq, cmdId: sobre.cmdId, cuerpoJson: JSON.stringify(sobre), estado: 'pendiente', intentos: 0, recibo: null, reciboHuella: null, reserva: 0 }
    expect(sobre.atribucionVersion).not.toBeNull()
    const c = compararInstantanea({ ...l.sesion, siguienteSeq: sobre.clientSeq + 1 }, [...l.entradas, viva], cuerpoDeServidor(banco), ctx())
    expect(c).toEqual({ tipo: 'no-aplicable', motivo: 'ordenes-vivas-con-atribucion' })
  })
})

describe('el refresco es atómico y contable en el almacén', () => {
  it('una falla en cualquier punto de escritura deja la sesión anterior intacta; el reintento la refresca', async () => {
    const { banco, tel } = await partidoFinal({ pendiente: true })
    editarPlantilla(banco)
    const cuerpo = cuerpoDeServidor(banco)
    const antes = await volcar(tel.almacen)
    const l0 = await tel.leer()
    for (const cuando of [(i) => i.fase === 'escribir' && i.n === 1, (i) => i.fase === 'escribir' && i.n === 2, (i) => i.fase === 'antes-de-confirmar']) {
      tel.almacen.gancho = (i) => { if (cuando(i)) throw new DOMException('simulada', 'QuotaExceededError') }
      const r = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo, ctx: tel.ctx() })
      tel.almacen.gancho = null
      expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true })
      for (const k of ['vista', 'verificada', 'atribucionRefrescada']) expect(r).not.toHaveProperty(k)
      expect(await volcar(tel.almacen)).toBe(antes) // sesión, entradas y totales: idénticos
    }
    const intacta = await tel.leer()
    expect(intacta.sesion.base.estado.atribucion.version).toBe(l0.sesion.base.estado.atribucion.version)
    expect(intacta.sesion.verificacion.atribucionRefrescada).toBeUndefined()
    expect(intacta.sesion.divergencia).toBeNull()

    const trazas = []
    tel.almacen.gancho = (i) => { trazas.push(`${i.fase}:${i.almacen ?? ''}`) }
    const ok = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo, ctx: tel.ctx() })
    tel.almacen.gancho = null
    expect(trazas).toEqual(['escribir:sesiones', 'escribir:meta', 'antes-de-confirmar:']) // solo la sesión y los totales: las entradas no se reescriben
    expect(ok).toMatchObject({ ok: true, verificada: true })
    expect(ok.vista.atribucionRefrescada).toEqual({ de: l0.sesion.base.estado.atribucion.version, a: cuerpo.atribucion.version })
    const despues = await tel.leer()
    expect(despues.entradas).toEqual(l0.entradas) // filas de entrada byte a byte (texto, recibo, huella, reserva, bytes)
    expect(despues.sesion.base.estado.atribucion).toEqual(cuerpo.atribucion)
  })

  it('la contabilidad se recalcula con la sesión nueva: bytes de la sesión y totales cuadran; la reserva no cambia', async () => {
    const { banco, tel } = await partidoFinal({ pendiente: true })
    const l0 = await tel.leer()
    editarPlantilla(banco, (js) => [...js, NUEVA, ...Array.from({ length: 12 }, (_, i) => ({ id: `N${i}`, equipoId: i % 2 ? 'E1' : 'E2', nombre: `Extra ${i}` }))])
    const r = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(banco), ctx: tel.ctx() })
    expect(r.ok).toBe(true)
    const l = await leerSesion(tel.almacen, ID)
    const filas = l.entradas
    expect(l.sesion.uso.bytes).toBeGreaterThan(l0.sesion.uso.bytes) // la atribución nueva es mayor
    expect(l.sesion.uso.reservado).toBe(l0.sesion.uso.reservado)
    expect(l.sesion.uso.sobreReserva).toBe(false)
    const { medirSesion } = await import('./sesion-motor')
    expect(l.sesion.uso.bytes).toBe(medirSesion(l.sesion) + filas.reduce((s, f) => s + f.bytes, 0))
    expect((await leerTotales(tel.almacen)).totales).toMatchObject({ bytes: l.sesion.uso.bytes, reservado: l.sesion.uso.reservado })
  })

  it('una divergencia real (no un cambio de plantilla) se sigue persistiendo y bloquea', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco)
    const cuerpo = cuerpoDeServidor(banco)
    cuerpo.estado.eventos[0].puntos += 1
    const r = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo, ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'instantanea-distinta' })
    const l = await tel.leer()
    expect(l.sesion.divergencia.detalle.diferencias).toEqual(expect.arrayContaining(['eventos', 'atribucion']))
    expect(l.sesion.base.estado.atribucion.version).not.toBe(cuerpo.atribucion.version) // no se adoptó nada
  })
})
