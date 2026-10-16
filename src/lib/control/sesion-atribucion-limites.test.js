import { describe, expect, it } from 'vitest'
import { crearAtribucion } from '../motor'
import { JUGADORES_DE_PRUEBA } from '../motor/prueba/banco'
import { ID, T0, cuerpoDeServidor, enviarAlServidor, servidorNuevo, sesionDe, telefonoNuevo } from './prueba/auxiliares-sesion'
import { LIMITES, abrirAlmacen, aplicarRecibo, crearSesion, evaluarCapacidad, leerSesion, leerTotales, marcarEnviando, verificarInstantanea } from './sesion-almacen'
import { compararInstantanea, medirSesion } from './sesion-motor'

// REPORT_122: el refresco de la atribución (REPORT_121) ocupa espacio NUEVO, así que se comprueba contra los topes de bytes por
// partido y entre sesiones, con las reservas incluidas, en la misma transacción. Si no cabe: cero escrituras y un resultado
// propio (no es una divergencia). Los tamaños son bytes UTF-8 MEDIDOS con las funciones del almacén, y los topes se inyectan
// pequeños: no se crea ninguna base grande.

const ctx = (extra = {}) => ({ ahoraEstimado: T0, actorId: 'yo', enLinea: true, ahora: T0, ...extra })
const extras = (n) => Array.from({ length: n }, (_, i) => ({ id: `N${i}`, equipoId: i % 2 ? 'E1' : 'E2', nombre: `Extra ${i}` }))
const atribucionCon = (cambiar) => crearAtribucion({ equipos: ['E1', 'E2'], jugadores: cambiar(JUGADORES_DE_PRUEBA.map((j) => ({ ...j }))) })
const editarPlantilla = (banco, n) => banco.adaptador.fijarAtribucion(atribucionCon((js) => [...js, ...extras(n)]))
const volcar = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})
const conLimites = (tel, limites) => abrirAlmacen({ nombre: tel.almacen.db.name, limites: { ...LIMITES, ...limites } })

/** Inicio, un punto y cierre ACEPTADOS (partido final en la base derivada); opcionalmente un `deshacer` vivo (con reserva). */
async function partidoFinal({ pendiente = true } = {}) {
  const banco = servidorNuevo()
  const tel = await telefonoNuevo(banco)
  await tel.crear(); await tel.iniciar(); await tel.enviarSiguiente()
  expect((await tel.encolar(tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }))).ok).toBe(true)
  await tel.enviarSiguiente()
  expect((await tel.encolar(tel.orden('cerrar-partido'))).ok).toBe(true)
  await tel.enviarSiguiente()
  expect(banco.adaptador.estado().partido.estado).toBe('final')
  if (pendiente) expect((await tel.encolar(tel.orden('deshacer'))).ok).toBe(true)
  return { banco, tel }
}

/** Lo que dejaría el refresco con ese cuerpo, calculado con las MISMAS funciones del almacén (bytes UTF-8 medidos). */
async function propuesto(tel, cuerpo) {
  const l = await tel.leer()
  const c = compararInstantanea(l.sesion, l.entradas, cuerpo, ctx())
  expect(c.tipo).toBe('verificada')
  expect(c.atribucionRefrescada).toBeTruthy()
  const bytes = medirSesion({ ...c.sesion, revision: l.sesion.revision + 1 }) + l.entradas.reduce((s, f) => s + f.bytes, 0)
  const reservado = l.entradas.reduce((s, f) => s + f.reserva, 0)
  const { totales } = await leerTotales(tel.almacen)
  return { actual: l.sesion.uso.bytes, bytes, reservado, partido: bytes + reservado, total: totales.bytes + totales.reservado + (bytes - l.sesion.uso.bytes) }
}
const refrescar = (almacen, tel, cuerpo) => verificarInstantanea(almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo, ctx: tel.ctx() })

describe('evaluarCapacidad: igualdad exacta, reservas incluidas', () => {
  const lim = { maxBytesPartido: 1000, maxBytesTotal: 2000 }
  const uso = { bytes: 400, reservado: 100 }
  it('por partido: bytes + reservado; exactamente el tope pasa y un byte más no', () => {
    expect(evaluarCapacidad(uso, { bytes: 0, reservado: 0 }, { bytes: 900, reservado: 100 }, lim)).toEqual({ ok: true })
    expect(evaluarCapacidad(uso, { bytes: 0, reservado: 0 }, { bytes: 901, reservado: 100 }, lim)).toEqual({ ok: false, motivo: 'limite-bytes-partido' })
    expect(evaluarCapacidad(uso, { bytes: 0, reservado: 0 }, { bytes: 900, reservado: 101 }, lim)).toEqual({ ok: false, motivo: 'limite-bytes-partido' })
  })
  it('global: lo de las demás sesiones, el aumento de usados y el de reservas', () => {
    // otras sesiones ocupan 1000; esta pasa de 500 a 600 (usados+reservados) → 1100 + 600 − 500... se calcula con los totales
    const tot = { bytes: 1300, reservado: 300 } // incluye esta sesión (500)
    expect(evaluarCapacidad(uso, tot, { bytes: 500, reservado: 100 }, { ...lim, maxBytesTotal: 1700 })).toEqual({ ok: true })
    expect(evaluarCapacidad(uso, tot, { bytes: 501, reservado: 100 }, { ...lim, maxBytesTotal: 1700 })).toEqual({ ok: false, motivo: 'limite-bytes-total' })
  })
  it('no mira el número de comandos ni la marca de sobre-reserva (eso es de las acciones nuevas)', () => {
    expect(evaluarCapacidad({ ...uso, sobreReserva: true, comandos: 99999 }, { bytes: 0, reservado: 0 }, { bytes: 10, reservado: 0, comandos: 99999 }, lim)).toEqual({ ok: true })
  })
})

describe('refresco de la atribución dentro de los topes', () => {
  it('con los topes por defecto: éxito, y la contabilidad coincide con el cálculo medido', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco, 12)
    const cuerpo = cuerpoDeServidor(banco)
    const P = await propuesto(tel, cuerpo)
    const antes = (await tel.leer()).sesion.uso
    const r = await refrescar(tel.almacen, tel, cuerpo)
    expect(r).toMatchObject({ ok: true, verificada: true })
    expect(r.atribucionRefrescada).toEqual(r.vista.atribucionRefrescada)
    const l = await tel.leer()
    expect(l.sesion.uso.bytes).toBe(P.bytes)
    expect(l.sesion.uso.bytes).toBeGreaterThan(antes.bytes)
    expect(l.sesion.uso.reservado).toBe(antes.reservado)
    expect(l.sesion.uso.sobreReserva).toBe(false)
    expect(l.sesion.uso.bytes).toBe(medirSesion(l.sesion) + l.entradas.reduce((s, f) => s + f.bytes, 0))
    expect((await leerTotales(tel.almacen)).totales).toMatchObject({ bytes: l.sesion.uso.bytes, reservado: l.sesion.uso.reservado })
  })

  it('tope POR PARTIDO: exactamente el tope pasa; un byte menos se rechaza (y las reservas cuentan)', async () => {
    const exacto = await partidoFinal()
    editarPlantilla(exacto.banco, 12)
    const cE = cuerpoDeServidor(exacto.banco)
    const PE = await propuesto(exacto.tel, cE)
    expect(PE.reservado).toBeGreaterThan(1) // hay una orden viva con reserva
    const aE = await conLimites(exacto.tel, { maxBytesPartido: PE.partido })
    expect(await refrescar(aE, exacto.tel, cE)).toMatchObject({ ok: true, verificada: true })

    const menos = await partidoFinal()
    editarPlantilla(menos.banco, 12)
    const cM = cuerpoDeServidor(menos.banco)
    const PM = await propuesto(menos.tel, cM)
    const aM = await conLimites(menos.tel, { maxBytesPartido: PM.partido - 1 })
    const r = await refrescar(aM, menos.tel, cM)
    expect(r).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', causa: 'limite-de-almacenamiento', limite: 'limite-bytes-partido', adoptada: false, verificada: false })
    // sin la reserva SÍ habría cabido: lo que decide es usado + reservado
    expect(PM.bytes).toBeLessThanOrEqual(PM.partido - 1)
  })

  it('tope GLOBAL entre sesiones: exactamente el tope pasa; un byte menos se rechaza', async () => {
    for (const [delta, ok] of [[0, true], [-1, false]]) {
      const { banco, tel } = await partidoFinal()
      expect((await crearSesion(tel.almacen, sesionDe(servidorNuevo({ gameId: 'Q' }), { partidoId: 'Q' }))).ok).toBe(true) // otra partida ocupa espacio
      editarPlantilla(banco, 12)
      const cuerpo = cuerpoDeServidor(banco)
      const P = await propuesto(tel, cuerpo)
      const a = await conLimites(tel, { maxBytesTotal: P.total + delta })
      const r = await refrescar(a, tel, cuerpo)
      if (ok) expect(r).toMatchObject({ ok: true, verificada: true })
      else expect(r).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', limite: 'limite-bytes-total', adoptada: false, verificada: false })
    }
  })
})

describe('un refresco que no cabe: no escribe nada, no es divergencia y se puede reintentar más pequeño', () => {
  async function rechazado() {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco, 12)
    const grande = cuerpoDeServidor(banco)
    const Pg = await propuesto(tel, grande)
    editarPlantilla(banco, 1)
    const chico = cuerpoDeServidor(banco)
    const Pc = await propuesto(tel, chico)
    expect(Pc.partido).toBeLessThan(Pg.partido)
    const tope = Pc.partido // cabe el chico, exactamente; el grande no
    const estrecho = await conLimites(tel, { maxBytesPartido: tope })
    const antes = await volcar(tel.almacen)
    const r = await refrescar(estrecho, tel, grande)
    return { banco, tel, grande, chico, Pg, Pc, estrecho, antes, r }
  }

  it('resultado acotado, sin vista ni «verificada», y los tres almacenes quedan idénticos byte a byte', async () => {
    const { tel, estrecho, antes, r, Pg } = await rechazado()
    expect(r).toEqual({
      ok: false,
      motivo: 'atribucion-no-aplicada',
      causa: 'limite-de-almacenamiento',
      limite: 'limite-bytes-partido',
      adoptada: false,
      verificada: false,
      bytes: expect.objectContaining({ propuestosSesion: Pg.bytes, reservadosSesion: Pg.reservado, maximoPartido: estrecho.limites.maxBytesPartido }),
    })
    for (const k of ['vista', 'atribucionRefrescada', 'divergencia']) expect(r).not.toHaveProperty(k)
    expect(r.motivo).not.toBe('divergencia')
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('no hay parada: ni divergencia registrada, ni base «verificada»; las entradas, recibos y reservas no cambian', async () => {
    const { tel, antes } = await rechazado()
    const l = await tel.leer()
    expect(l.sesion.divergencia).toBeNull()
    expect(l.sesion.verificacion.nivel).toBe('derivada')
    expect(l.sesion.verificacion.atribucionRefrescada).toBeUndefined()
    expect(l.vista.puntuacion).toEqual({ habilitada: true, motivo: null })
    expect(JSON.parse(antes).entradas).toEqual(l.entradas)
  })

  it('tras recargar (otra conexión) se conserva la sesión anterior, con su atribución antigua', async () => {
    const { tel, banco } = await rechazado()
    const viejaVersion = (await tel.leer()).sesion.base.estado.atribucion.version
    tel.almacen.cerrar()
    const nueva = await abrirAlmacen({ nombre: tel.almacen.db.name })
    const l = await leerSesion(nueva, ID, ctx())
    expect(l.ok).toBe(true)
    expect(l.sesion.base.estado.atribucion.version).toBe(viejaVersion)
    expect(l.sesion.base.estado.atribucion.version).not.toBe(cuerpoDeServidor(banco).atribucion.version)
    expect(l.sesion.divergencia).toBeNull()
  })

  it('un refresco MÁS PEQUEÑO que sí cabe tiene éxito después, con el mismo tope', async () => {
    const { tel, chico, estrecho, Pc } = await rechazado()
    const r = await refrescar(estrecho, tel, chico)
    expect(r).toMatchObject({ ok: true, verificada: true })
    const l = await tel.leer()
    expect(l.sesion.uso.bytes).toBe(Pc.bytes)
    expect(l.sesion.base.estado.atribucion).toEqual(chico.atribucion)
    expect(l.sesion.divergencia).toBeNull()
  })

  it('el rechazo por tope global tampoco escribe ni acusa divergencia', async () => {
    const { banco, tel } = await partidoFinal()
    await crearSesion(tel.almacen, sesionDe(servidorNuevo({ gameId: 'Q' }), { partidoId: 'Q' }))
    editarPlantilla(banco, 12)
    const cuerpo = cuerpoDeServidor(banco)
    const P = await propuesto(tel, cuerpo)
    const a = await conLimites(tel, { maxBytesTotal: P.total - 1 })
    const antes = await volcar(tel.almacen)
    const r = await refrescar(a, tel, cuerpo)
    expect(r).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', limite: 'limite-bytes-total' })
    expect(r.bytes.propuestosTotal).toBe(P.total)
    expect(r.bytes.maximoTotal).toBe(P.total - 1)
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('lo que sigue siendo incoherente o divergente conserva su resultado propio aunque no quepa', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco, 12)
    const estrecho = await conLimites(tel, { maxBytesPartido: 1 })
    const incoherente = cuerpoDeServidor(banco)
    incoherente.atribucion = atribucionCon((js) => js.filter((j) => j.id !== 'J1'))
    expect(await refrescar(estrecho, tel, incoherente)).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'atribucion-incoherente' })
    expect((await tel.leer()).sesion.divergencia.causa).toBe('atribucion-incoherente')
  })
})

describe('fallas de la transacción y registro de resultados cerca del tope', () => {
  it('con el refresco justo en el tope, una falla en cualquier escritura revierte todo; el reintento lo aplica', async () => {
    const { banco, tel } = await partidoFinal()
    editarPlantilla(banco, 12)
    const cuerpo = cuerpoDeServidor(banco)
    const P = await propuesto(tel, cuerpo)
    const justo = await conLimites(tel, { maxBytesPartido: P.partido })
    const antes = await volcar(tel.almacen)
    for (const cuando of [(i) => i.fase === 'escribir' && i.n === 1, (i) => i.fase === 'escribir' && i.n === 2, (i) => i.fase === 'antes-de-confirmar']) {
      justo.gancho = (i) => { if (cuando(i)) throw new DOMException('simulada', 'QuotaExceededError') }
      const r = await refrescar(justo, tel, cuerpo)
      justo.gancho = null
      expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true })
      expect(await volcar(tel.almacen)).toBe(antes)
    }
    expect(await refrescar(justo, tel, cuerpo)).toMatchObject({ ok: true, verificada: true })
  })

  it('con el tope del partido AJUSTADO al uso actual: el refresco se rechaza, pero registrar el recibo de una orden aceptada sigue funcionando', async () => {
    const { banco, tel } = await partidoFinal()
    const l0 = await tel.leer()
    const pendiente = l0.entradas.find((f) => f.estado === 'pendiente')
    const textoAntes = pendiente.cuerpoJson
    const tope = l0.sesion.uso.bytes + l0.sesion.uso.reservado // sin ni un byte de holgura
    const justo = await conLimites(tel, { maxBytesPartido: tope })
    editarPlantilla(banco, 12)
    const cuerpo = cuerpoDeServidor(banco)

    // 1) el refresco (información nueva) no cabe
    const antes = await volcar(tel.almacen)
    expect(await refrescar(justo, tel, cuerpo)).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', limite: 'limite-bytes-partido' })
    expect(await volcar(tel.almacen)).toBe(antes)

    // 2) el resultado de la orden ya aceptada SÍ se registra, con el mismo tope
    const m = await marcarEnviando(justo, { id: ID, cmdId: pendiente.cmdId, ctx: tel.ctx() })
    expect(m).toMatchObject({ ok: true, cuerpoJson: textoAntes })
    const { recibo, tipo } = await enviarAlServidor(banco, m.cuerpoJson)
    expect(tipo).toBe('aceptado')
    const ap = await aplicarRecibo(justo, { id: ID, recibo, ctx: tel.ctx() })
    expect(ap).toMatchObject({ ok: true, sobreReserva: false })
    const l = await tel.leer()
    const fila = l.entradas.find((f) => f.cmdId === pendiente.cmdId)
    expect(fila).toMatchObject({ estado: 'confirmada', cuerpoJson: textoAntes, reserva: 0 })
    expect(l.sesion.uso.bytes + l.sesion.uso.reservado).toBeLessThanOrEqual(tope)
    // Con el resultado ya registrado, el servidor cambió (el `deshacer` anuló el punto): hace falta una instantánea NUEVA. El refresco se
    // decide solo por el cálculo medido contra el mismo tope (cabe si y solo si usado + reservado propuestos ≤ tope).
    const fresco = cuerpoDeServidor(banco)
    const P2 = await propuesto(tel, fresco)
    const r = await refrescar(justo, tel, fresco)
    expect(r.ok).toBe(P2.partido <= tope)
    if (!r.ok) expect(r).toMatchObject({ motivo: 'atribucion-no-aplicada', adoptada: false })
  })

  it('en operación normal: recibir, verificar y refrescar no alteran los sobres guardados ni los recibos', async () => {
    const { banco, tel } = await partidoFinal()
    const antes = (await tel.leer()).entradas
    editarPlantilla(banco, 3)
    expect(await refrescar(tel.almacen, tel, cuerpoDeServidor(banco))).toMatchObject({ ok: true })
    const despues = (await tel.leer()).entradas
    expect(despues).toEqual(antes)
  })
})
