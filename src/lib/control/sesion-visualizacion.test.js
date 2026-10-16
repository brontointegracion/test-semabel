import { describe, expect, it } from 'vitest'
import { crearAtribucion } from '../motor'
import { JUGADORES_DE_PRUEBA } from '../motor/prueba/banco'
import { JUGADORES_NUMERADOS, preparacionDePrueba } from '../motor/prueba/auxiliares-preparacion'
import { DEVICE, ID, LIGA, PARTIDO, T0, cuerpoDeServidor, reabrir, servidorNuevo, telefonoNuevo, visualizacionDeServidor } from './prueba/auxiliares-sesion'
import { LIMITES, abrirAlmacen, actualizarVisualizacion, leerSesion, leerTotales, marcarEnviando, verificarInstantanea } from './sesion-almacen'
import { construirSesion, medirSesion, actualizarVisualizacionDeSesion, refrescarAntesDelInicio } from './sesion-motor'
import { datosParaMostrar, descripcionDeJugador, igualesVisualizacion, validarFilaVisualizacion, validarVisualizacion } from './sesion-visualizacion'

// REPORT_127: nombres y números para mostrar. Todo SINTÉTICO. Lo que se comprueba está en el almacén durable, no en lo que el
// código dice de sí mismo; la identidad de los jugadores y los sobres NO cambian por añadir etiquetas.

const ctx = (extra = {}) => ({ ahoraEstimado: T0, actorId: 'yo', enLinea: true, ahora: T0, ...extra })
const volcar = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})
const cuerpo = (banco, v = true) => cuerpoDeServidor(banco, { visualizacion: v })
const conDatos = async (banco = servidorNuevo()) => {
  const tel = await telefonoNuevo(banco)
  await tel.crear({ cuerpoEstado: cuerpo(banco) })
  return { banco, tel }
}
const actualizar = (almacen, tel, c) => actualizarVisualizacion(almacen, { id: ID, revision: tel.revision, cuerpoEstado: c, ctx: tel.ctx() })
const cambiarNombres = (banco, f) => { const v = visualizacionDeServidor(banco); f(v); return v }

describe('validación de los datos para mostrar', () => {
  const banco = servidorNuevo()
  const c = cuerpoDeServidor(banco)
  const ctxV = { atribucion: c.atribucion, partido: c.partido, eventos: c.estado.eventos }
  const buena = () => JSON.parse(JSON.stringify(visualizacionDeServidor(banco)))
  it('acepta lo bueno: el 0 es un número real, un hueco es null (nunca 0) y la forma guardada es canónica', () => {
    const v = buena()
    v.jugadores.find((j) => j.id === 'J2').dorsal = null
    v.jugadores.find((j) => j.id === 'J8').nombrePila = null
    const r = validarVisualizacion(v, ctxV)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    const por = Object.fromEntries(r.visualizacion.jugadores.map((j) => [j.id, j]))
    expect(por.J1.dorsal).toBe(0)
    expect(por.J2.dorsal).toBeNull()
    expect(por.J8.nombrePila).toBeNull()
    expect(r.visualizacion.jugadores.map((j) => j.id)).toEqual([...r.visualizacion.jugadores.map((j) => j.id)].sort())
    expect(r.visualizacion.atribucionVersion).toBe(c.atribucion.version)
    expect(validarFilaVisualizacion(r.visualizacion).ok).toBe(true)
    // mismo contenido en otro orden → mismos bytes
    const v2 = buena(); v2.jugadores.reverse()
    expect(JSON.stringify(validarVisualizacion(v2, ctxV).visualizacion)).toBe(JSON.stringify(validarVisualizacion(buena(), ctxV).visualizacion))
  })
  it('rechaza lo dudoso (cada caso con su motivo) y nunca corrige ni inventa', () => {
    const casos = [
      ['dorsal 100', (v) => { v.jugadores[0].dorsal = 100 }, 'dorsal'], ['dorsal -1', (v) => { v.jugadores[0].dorsal = -1 }, 'dorsal'],
      ['dorsal 1.5', (v) => { v.jugadores[0].dorsal = 1.5 }, 'dorsal'], ['dorsal texto', (v) => { v.jugadores[0].dorsal = '7' }, 'dorsal'],
      ['dorsal NaN', (v) => { v.jugadores[0].dorsal = NaN }, 'dorsal'], ['dorsal ausente', (v) => { delete v.jugadores[0].dorsal }, 'jugador'],
      ['nombre vacío', (v) => { v.jugadores[0].nombrePila = '' }, 'nombre'], ['nombre solo espacios', (v) => { v.jugadores[0].nombrePila = '   ' }, 'nombre'],
      ['apellido con control', (v) => { v.jugadores[0].apellido1 = 'A\u0000B' }, 'apellido'], ['nombre largo', (v) => { v.jugadores[0].nombrePila = 'x'.repeat(101) }, 'nombre'],
      ['equipo sin nombre', (v) => { v.equipos[0].nombre = '' }, 'equipo'], ['activo no booleano', (v) => { v.jugadores[0].activo = 1 }, 'activo'],
      ['clave sensible', (v) => { v.jugadores[0].fechaNacimiento = '2015-01-01' }, 'jugador'], ['personaId', (v) => { v.jugadores[0].personaId = 'p' }, 'jugador'],
      ['clave de más en la raíz', (v) => { v.contacto = 'x' }, 'forma'], ['jugador repetido', (v) => { v.jugadores.push({ ...v.jugadores[0] }) }, 'jugador-repetido'],
      ['equipo repetido', (v) => { v.equipos = [{ ...v.equipos[0] }, { ...v.equipos[0] }] }, 'equipo-repetido'], ['equipo desconocido', (v) => { v.jugadores[0].equipoId = 'E9' }, 'jugador'],
      ['equipos distintos del partido', (v) => { v.equipos[1].id = 'E9'; v.jugadores.forEach((j) => { if (j.equipoId === 'E2') j.equipoId = 'E9' }) }, 'equipos-inconsistentes'],
      ['jugador de otro equipo', (v) => { v.jugadores.find((j) => j.id === 'J1').equipoId = 'E2' }, 'jugador-de-otro-equipo'],
      ['jugador fuera de la atribución', (v) => { v.jugadores.push({ id: 'JZ', equipoId: 'E1', nombrePila: 'Z', apellido1: 'Z', dorsal: 3, activo: true }) }, 'jugador-fuera-de-la-atribucion'],
      ['activo distinto de elegible', (v) => { v.jugadores.find((j) => j.id === 'J2').activo = false }, 'activo-distinto-de-elegible'],
      ['falta un elegible', (v) => { v.jugadores = v.jugadores.filter((j) => j.id !== 'J2') }, 'elegible-ausente'],
      ['demasiados jugadores', (v) => { v.jugadores = Array.from({ length: 401 }, (_, i) => ({ id: `Q${i}`, equipoId: 'E1', nombrePila: 'a', apellido1: 'b', dorsal: null, activo: true })) }, 'jugadores'],
    ]
    for (const [nombre, mutar, motivo] of casos) {
      const v = buena(); mutar(v)
      expect(validarVisualizacion(v, ctxV), nombre).toEqual({ ok: false, motivo })
    }
    for (const x of [null, [], 'x', 5, {}]) expect(validarVisualizacion(x, ctxV).ok).toBe(false)
    expect(validarVisualizacion(buena(), { ...ctxV, atribucion: null }).motivo).toBe('sin-atribucion')
    expect(validarVisualizacion(buena(), { ...ctxV, partido: null }).motivo).toBe('sin-equipos-del-partido')
    // un jugador de un evento debe poder etiquetarse
    const v = buena()
    expect(validarVisualizacion(v, { ...ctxV, eventos: [{ jugadorId: 'JQ' }] }).motivo).toBe('jugador-de-evento-ausente')
  })
  it('descripcionDeJugador: «#0 …» con el cero, sin número, etiqueta de reserva y nada; el número del evento NUNCA se afirma', () => {
    const ses = { visualizacion: validarVisualizacion(buena(), ctxV).visualizacion, etiquetas: [{ id: 'JE', etiqueta: 'Etiqueta' }, { id: 'JN', etiqueta: null }] }
    expect(descripcionDeJugador(ses, 'J1')).toMatchObject({ origen: 'visualizacion', texto: '#0 Nombre-J1 Apellido-J1', dorsalActual: 0, dorsalAlEvento: null, activo: true })
    ses.visualizacion.jugadores.find((j) => j.id === 'J2').dorsal = null
    expect(descripcionDeJugador(ses, 'J2').texto).toBe('Nombre-J2 Apellido-J2')
    ses.visualizacion.jugadores.find((j) => j.id === 'J8').nombrePila = null
    ses.visualizacion.jugadores.find((j) => j.id === 'J8').apellido1 = null
    expect(descripcionDeJugador(ses, 'J8')).toMatchObject({ nombre: null, texto: '#9' })
    expect(descripcionDeJugador(ses, 'JE')).toMatchObject({ origen: 'etiqueta', texto: 'Etiqueta', dorsalActual: null, dorsalAlEvento: null })
    expect(descripcionDeJugador(ses, 'JN')).toMatchObject({ origen: 'ninguna', texto: null })
    expect(descripcionDeJugador({}, 'J1')).toMatchObject({ origen: 'ninguna', dorsalAlEvento: null })
    expect(igualesVisualizacion(undefined, null)).toBe(true)
  })
})

describe('sesión nueva: se guardan y sobreviven a reabrir sin conexión', () => {
  it('desde el cuerpo autorizado → fila de sesión → reabrir la base: nombres y números intactos (incluido el 0), sin red', async () => {
    const { tel } = await conDatos()
    const otra = await reabrir(tel.almacen) // «recarga»: otra asa sobre la MISMA base, sin servidor ni red de por medio
    const l = await leerSesion(otra, ID, ctx())
    expect(l.ok).toBe(true)
    expect(datosParaMostrar(l.sesion)).toMatchObject({ disponible: true, desactualizada: false })
    expect(descripcionDeJugador(l.sesion, 'J1').texto).toBe('#0 Nombre-J1 Apellido-J1')
    expect(descripcionDeJugador(l.sesion, 'J2').texto).toBe('#7 Nombre-J2 Apellido-J2')
    expect(l.sesion.visualizacion.equipos).toEqual([{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }])
    expect(l.sesion.uso.bytes).toBe(medirSesion(l.sesion)) // lo añadido cuenta en el uso medido
  })
  it('lo guardado no contiene nada sensible; datos inválidos o ausentes no impiden crear la sesión y no se inventan', async () => {
    const banco = servidorNuevo()
    const malo = cuerpoDeServidor(banco, { visualizacion: { ...visualizacionDeServidor(banco), contacto: 'x' } })
    const r = construirSesion({ ligaId: LIGA, partidoId: PARTIDO, cuerpoEstado: malo, deviceId: DEVICE })
    expect(r).toMatchObject({ ok: true, visualizacion: { estado: 'invalida', motivo: 'forma' } })
    expect(r.sesion.visualizacion).toBeUndefined()
    const sin = construirSesion({ ligaId: LIGA, partidoId: PARTIDO, cuerpoEstado: cuerpoDeServidor(banco), deviceId: DEVICE })
    expect(sin.visualizacion.estado).toBe('ausente')
    expect(datosParaMostrar(sin.sesion)).toMatchObject({ disponible: false, motivo: 'sin-datos-de-pantalla', jugadores: [] })
    const { tel } = await conDatos(banco)
    const texto = await volcar(tel.almacen)
    for (const prohibido of ['fechaNacimiento', 'personaId', 'codigo', 'contacto', 'documento', 'token', 'credencial', 'apellido2', 'nombreCamiseta']) expect(texto).not.toContain(prohibido)
  })
})

describe('sesión anterior sin datos para mostrar', () => {
  it('se expone «no disponible», funciona igual (órdenes pendientes intactas) y una lectura autorizada los aporta SIN tocar nada más', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear() // sin datos para mostrar: como una sesión de antes
    await tel.iniciar()
    const antes = await tel.leer()
    expect(datosParaMostrar(antes.sesion)).toMatchObject({ disponible: false })
    expect(validarFilaVisualizacion).toBeTruthy()
    const r = await actualizar(tel.almacen, tel, cuerpo(banco))
    expect(r).toMatchObject({ ok: true, adoptada: true })
    tel.nota(r)
    const despues = await tel.leer()
    expect(datosParaMostrar(despues.sesion).disponible).toBe(true)
    // todo lo demás, byte a byte
    expect(JSON.stringify(despues.entradas)).toBe(JSON.stringify(antes.entradas))
    expect(JSON.stringify(despues.sesion.base)).toBe(JSON.stringify(antes.sesion.base))
    for (const k of ['siguienteSeq', 'inicio', 'detenida', 'divergencia', 'verificacion', 'etiquetas', 'deviceId', 'ligaId', 'partidoId']) expect(JSON.stringify(despues.sesion[k]), k).toBe(JSON.stringify(antes.sesion[k]))
    expect(despues.sesion.base.estado.atribucion.version).toBe(antes.sesion.base.estado.atribucion.version) // la huella de la atribución no cambia
    // y la sesión sigue funcionando: el inicio pendiente se envía y confirma
    const s = await tel.enviarSiguiente()
    expect(s.aplicado.ok).toBe(true)
    expect((await tel.leer()).sesion.inicio).toBe('confirmado')
  })
  it('sin cambios: no escribe; el mismo cuerpo dos veces no gasta una revisión', async () => {
    const { banco, tel } = await conDatos()
    const antes = await volcar(tel.almacen)
    expect(await actualizar(tel.almacen, tel, cuerpo(banco))).toMatchObject({ ok: true, sinCambios: true, adoptada: false })
    expect(await volcar(tel.almacen)).toBe(antes)
  })
})

describe('quién puede actualizar los datos', () => {
  it('juego o dispositivo equivocado, atribución distinta o referencias inconsistentes: nada se escribe y se dice por qué', async () => {
    const { banco, tel } = await conDatos()
    const antes = await volcar(tel.almacen)
    const buena = cuerpo(banco)
    const nuevos = cambiarNombres(banco, (v) => { v.jugadores[0].nombrePila = 'Cambiado' })
    const casos = [
      ['juego equivocado', { ...cuerpo(banco, nuevos), gameId: 'OTRO' }, 'instantanea-invalida'],
      ['dispositivo equivocado', { ...cuerpo(banco, nuevos), deviceId: 'otro-telefono' }, 'instantanea-invalida'],
      ['sin la clave', cuerpoDeServidor(banco), 'visualizacion-ausente'],
      ['jugador de otro equipo', cuerpo(banco, cambiarNombres(banco, (v) => { v.jugadores.find((j) => j.id === 'J1').equipoId = 'E2' })), 'visualizacion-invalida'],
      ['jugador desconocido', cuerpo(banco, cambiarNombres(banco, (v) => { v.jugadores.push({ id: 'JZ', equipoId: 'E1', nombrePila: 'Z', apellido1: 'Z', dorsal: 1, activo: true }) })), 'visualizacion-invalida'],
      ['equipos del partido distintos', { ...cuerpo(banco, nuevos), partido: { ligaId: LIGA, localId: 'E1', visitaId: 'E9' } }, 'visualizacion-invalida'],
      ['dorsal inválido', cuerpo(banco, cambiarNombres(banco, (v) => { v.jugadores[0].dorsal = 123 })), 'visualizacion-invalida'],
      ['campo sensible', cuerpo(banco, cambiarNombres(banco, (v) => { v.jugadores[0].fechaNacimiento = '2015-01-01' })), 'visualizacion-invalida'],
    ]
    for (const [nombre, c, motivo] of casos) {
      expect(await actualizar(tel.almacen, tel, c), nombre).toMatchObject({ ok: false, motivo })
    }
    // otra versión de la atribución: la identidad no se redefine desde aquí
    banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), { id: 'J7', equipoId: 'E1', nombre: 'Nueva' }] }))
    const v7 = visualizacionDeServidor(banco)
    expect(await actualizar(tel.almacen, tel, cuerpo(banco, v7))).toMatchObject({ ok: false, motivo: 'atribucion-distinta' })
    expect(await actualizarVisualizacion(tel.almacen, { id: ID, revision: tel.revision + 3, cuerpoEstado: buena, ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'revision-desactualizada' })
    expect(await volcar(tel.almacen)).toBe(antes)
  })
  it('una sesión con divergencia no se toca', async () => {
    const { banco, tel } = await conDatos()
    const l = await tel.leer()
    const r = actualizarVisualizacionDeSesion({ ...l.sesion, divergencia: { causa: 'x' } }, l.entradas, { cuerpoEstado: cuerpo(banco) })
    expect(r).toMatchObject({ tipo: 'rechazo', motivo: 'sesion-detenida-por-divergencia' })
  })
})

describe('etiquetas nuevas y verificación del juego (sin falsas divergencias)', () => {
  it('un cambio de nombres o números por sí solo se adopta y la verificación del juego sigue siendo «verificada», sin divergencia', async () => {
    const { banco, tel } = await conDatos()
    await tel.iniciar(); await tel.enviarSiguiente()
    const nuevos = cambiarNombres(banco, (v) => { v.jugadores.find((j) => j.id === 'J2').nombrePila = 'Saúl'; v.jugadores.find((j) => j.id === 'J2').apellido1 = 'Montero'; v.jugadores.find((j) => j.id === 'J2').dorsal = 2 })
    const r = tel.nota(await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo(banco, nuevos), ctx: tel.ctx() }))
    expect(r).toMatchObject({ ok: true, verificada: true, visualizacion: { adoptada: true } })
    const l = await tel.leer()
    expect(l.sesion.divergencia).toBeNull()
    expect(l.sesion.verificacion.nivel).toBe('verificada')
    expect(descripcionDeJugador(l.sesion, 'J2').texto).toBe('#2 Saúl Montero')
  })
  it('si además el juego difiere hay divergencia como siempre y los datos NO se adoptan', async () => {
    const { banco, tel } = await conDatos()
    await tel.iniciar(); await tel.enviarSiguiente()
    const nuevos = cambiarNombres(banco, (v) => { v.jugadores[0].nombrePila = 'Otro' })
    const c = cuerpo(banco, nuevos)
    c.estado.auditSeq += 5 // el servidor «cambió» el juego
    const r = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: c, ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'divergencia' })
    expect((await tel.leer()).sesion.visualizacion.jugadores[0].nombrePila).not.toBe('Otro')
  })
  it('un jugador desactivado DESPUÉS de anotar sigue resoluble por su id en lo histórico; se distingue el número actual del del evento (que no se guardó)', async () => {
    const { banco, tel } = await conDatos()
    await tel.iniciar(); await tel.enviarSiguiente()
    await tel.encolar(tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 })); await tel.enviarSiguiente()
    await tel.encolar(tel.orden('cerrar-partido')); await tel.enviarSiguiente()
    expect(banco.adaptador.estado().partido.estado).toBe('final')
    // después del partido el organizador desactiva a J1 (permitido): atribución nueva, J1 sigue por los eventos
    banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: JUGADORES_DE_PRUEBA.map((j) => (j.id === 'J1' ? { ...j, activo: false } : { ...j })) }))
    const r = tel.nota(await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo(banco), ctx: tel.ctx() }))
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, verificada: true, visualizacion: { adoptada: true } })
    const l = await tel.leer()
    expect(l.sesion.divergencia).toBeNull()
    expect(descripcionDeJugador(l.sesion, 'J1')).toMatchObject({ activo: false, dorsalActual: 0, dorsalAlEvento: null, texto: '#0 Nombre-J1 Apellido-J1' })
    expect(datosParaMostrar(l.sesion).desactualizada).toBe(false)
    expect(l.sesion.base.estado.eventos.some((e) => e.jugadorId === 'J1')).toBe(true)
  })
})

describe('capacidad: se cuenta, con reservas, al byte, y nunca se adopta lo que no cupo', () => {
  async function conPendiente() {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    await tel.iniciar()
    return { banco, tel }
  }
  async function propuesto(tel, banco) {
    const l = await tel.leer()
    const calc = actualizarVisualizacionDeSesion(l.sesion, l.entradas, { cuerpoEstado: cuerpo(banco) })
    expect(calc.tipo).toBe('ok')
    const bytes = medirSesion({ ...calc.sesion, revision: l.sesion.revision + 1 }) + l.entradas.reduce((s, f) => s + f.bytes, 0)
    const reservado = l.entradas.reduce((s, f) => s + f.reserva, 0)
    const { totales } = await leerTotales(tel.almacen)
    return { actual: l.sesion.uso.bytes, bytes, reservado, partido: bytes + reservado, total: totales.bytes + totales.reservado + (bytes - l.sesion.uso.bytes) }
  }
  const conLimites = (tel, limites) => abrirAlmacen({ nombre: tel.almacen.db.name, limites: { ...LIMITES, ...limites } })
  const ejecutar = (almacen, tel, banco) => actualizarVisualizacion(almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpo(banco), ctx: tel.ctx() })

  it('por partido (bytes + reservas): exactamente el tope pasa, un byte menos rechaza sin escribir; luego un tope mayor adopta', async () => {
    const { banco, tel } = await conPendiente()
    const P = await propuesto(tel, banco)
    expect(P.reservado).toBeGreaterThan(0) // hay una reserva viva: cuenta
    expect(P.bytes).toBeGreaterThan(P.actual)
    const antes = await volcar(tel.almacen)
    const bajo = await ejecutar(await conLimites(tel, { maxBytesPartido: P.partido - 1 }), tel, banco)
    expect(bajo).toMatchObject({ ok: false, motivo: 'visualizacion-no-aplicada', causa: 'limite-de-almacenamiento', limite: 'limite-bytes-partido', adoptada: false })
    expect(bajo.bytes).toMatchObject({ actualesSesion: P.actual, propuestosSesion: P.bytes, reservadosSesion: P.reservado })
    expect(await volcar(tel.almacen)).toBe(antes)
    expect(datosParaMostrar((await tel.leer()).sesion).disponible).toBe(false)
    // solo por las reservas: los bytes solos sí cabrían
    expect(P.bytes).toBeLessThanOrEqual(P.partido - 1)
    const justo = await ejecutar(await conLimites(tel, { maxBytesPartido: P.partido }), tel, banco)
    expect(justo).toMatchObject({ ok: true, adoptada: true })
    expect((await tel.leer()).sesion.uso).toMatchObject({ bytes: P.bytes, reservado: P.reservado })
  })
  it('global (usado + reservado de TODAS las sesiones): exactamente el tope pasa y un byte menos rechaza', async () => {
    const { banco, tel } = await conPendiente()
    // otra sesión ocupa espacio en los totales
    const otro = await telefonoNuevo(servidorNuevo(), { almacen: tel.almacen })
    void otro
    const P = await propuesto(tel, banco)
    const antes = await volcar(tel.almacen)
    const bajo = await ejecutar(await conLimites(tel, { maxBytesTotal: P.total - 1 }), tel, banco)
    expect(bajo).toMatchObject({ ok: false, motivo: 'visualizacion-no-aplicada', limite: 'limite-bytes-total', adoptada: false })
    expect(await volcar(tel.almacen)).toBe(antes)
    expect(await ejecutar(await conLimites(tel, { maxBytesTotal: P.total }), tel, banco)).toMatchObject({ ok: true, adoptada: true })
  })
  it('con la verificación del juego: si los datos no caben, la verificación SE REGISTRA igual, sin ellos, y se dice que no se adoptaron', async () => {
    const { banco, tel } = await conPendiente()
    await tel.enviarSiguiente()
    const l0 = await tel.leer()
    const c = cuerpo(banco)
    const calc = (await import('./sesion-motor')).compararInstantanea(l0.sesion, l0.entradas, c, ctx())
    const bytes = medirSesion({ ...calc.sesion, revision: l0.sesion.revision + 1 }) + l0.entradas.reduce((s, f) => s + f.bytes, 0)
    const sin = medirSesion({ ...calc.sesionSinVisualizacion, revision: l0.sesion.revision + 1 }) + l0.entradas.reduce((s, f) => s + f.bytes, 0)
    expect(bytes).toBeGreaterThan(sin)
    const estrecho = await conLimites(tel, { maxBytesPartido: bytes - 1 })
    const r = await verificarInstantanea(estrecho, { id: ID, revision: tel.revision, cuerpoEstado: c, ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: true, verificada: true, visualizacion: { adoptada: false, motivo: 'visualizacion-no-aplicada', causa: 'limite-de-almacenamiento' } })
    const l = await leerSesion(estrecho, ID, ctx())
    expect(l.sesion.visualizacion).toBeUndefined()
    expect(l.sesion.verificacion.nivel).toBe('verificada')
    expect(l.sesion.uso.bytes).toBe(sin)
    // con espacio, la siguiente sí los adopta
    const ancho = await conLimites(tel, { maxBytesPartido: bytes })
    expect(await verificarInstantanea(ancho, { id: ID, revision: l.sesion.revision, cuerpoEstado: c, ctx: tel.ctx() })).toMatchObject({ ok: true, visualizacion: { adoptada: true } })
  })
  it('una falla de almacenamiento (cada escritura y antes de confirmar) deja todo igual y el reintento adopta', async () => {
    const banco = servidorNuevo()
    let falla = null
    const tel = await telefonoNuevo(banco, { gancho: (e) => { if (falla && ((falla.n && e.fase === 'escribir' && e.n === falla.n) || (falla.fin && e.fase === 'antes-de-confirmar'))) { const x = new Error('cuota'); x.name = 'QuotaExceededError'; throw x } } })
    await tel.crear(); await tel.iniciar()
    for (const f of [{ n: 1 }, { n: 2 }, { fin: true }]) {
      const antes = await volcar(tel.almacen)
      falla = f
      expect(await actualizar(tel.almacen, tel, cuerpo(banco))).toMatchObject({ ok: false, motivo: 'almacenamiento', op: 'visualizacion' })
      expect(await volcar(tel.almacen)).toBe(antes)
    }
    falla = null
    expect(await actualizar(tel.almacen, tel, cuerpo(banco))).toMatchObject({ ok: true, adoptada: true })
  })
  it('lo medido: tamaño de los datos para 2 equipos y 30 jugadores con nombres largos', () => {
    const v = { equipos: [{ id: 'E-' + 'x'.repeat(30), nombre: 'Equipo '.repeat(10).trim() }, { id: 'F-' + 'x'.repeat(30), nombre: 'Equipo '.repeat(10).trim() }], jugadores: Array.from({ length: 30 }, (_, i) => ({ id: `ficha-${String(i).padStart(8, '0')}-${'a'.repeat(20)}`, equipoId: i % 2 ? 'E-' + 'x'.repeat(30) : 'F-' + 'x'.repeat(30), nombrePila: 'Nombre'.repeat(4), apellido1: 'Apellido'.repeat(4), dorsal: i, activo: true })) }
    const t = JSON.stringify({ v: 1, atribucionVersion: 'a'.repeat(64), ...v })
    expect(new TextEncoder().encode(t).length).toBeLessThan(10 * 1024)
  })
})

describe('refresco previo al inicio: los datos viajan con la base nueva', () => {
  it('la plantilla cambia antes del inicio: base, atribución y datos para mostrar se adoptan juntos (o ninguno si no caben)', async () => {
    const { banco, tel } = await conDatos()
    banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), { id: 'J7', equipoId: 'E1', nombre: 'Nueva' }] }))
    const v = visualizacionDeServidor(banco)
    Object.assign(v.jugadores.find((j) => j.id === 'J7'), { nombrePila: 'Siete', apellido1: 'Nueva', dorsal: 5 })
    const prep = preparacionDePrueba(PARTIDO, { jugadores: [...JUGADORES_NUMERADOS, { id: 'J7', equipoId: 'E1', nombre: 'Nueva', dorsal: 5 }] })
    const l = await tel.leer()
    const calc = refrescarAntesDelInicio(l.sesion, l.entradas, { cuerpoEstado: cuerpo(banco, v), preparacion: prep })
    expect(calc.tipo).toBe('verificada')
    expect(descripcionDeJugador(calc.sesion, 'J7').texto).toBe('#5 Siete Nueva')
    expect(calc.sesion.visualizacion.atribucionVersion).toBe(calc.sesion.base.estado.atribucion.version)
    expect(datosParaMostrar(calc.sesion).desactualizada).toBe(false)
  })
})
