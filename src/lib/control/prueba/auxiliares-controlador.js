import { T0, ID, cmd, cuerpoDeServidor, servidorNuevo, telefonoNuevo, reabrir } from './auxiliares-sesion'
import { relojVirtual, respuesta, tick, volcarBase } from './auxiliares-emisor'
import { abrirAlmacen } from '../sesion-almacen'
import { crearControlador } from '../sesion-controlador'

// Dobles SINTÉTICOS del navegador para el controlador: Web Locks exclusivos con cola, BroadcastChannel, conectividad, relojes
// virtuales y un `fetch` que habla con el servidor sintético del motor. Cada «pestaña» tiene su propio controlador, su propia
// asa de IndexedDB (la misma base falsa) y su propio reloj virtual; comparten locks y canal, como en un navegador.

export { T0, ID, cmd, cuerpoDeServidor, servidorNuevo, telefonoNuevo, relojVirtual, respuesta, tick, volcarBase }
export const TOKEN = 'TOKEN-SECRETO-DEL-CONTROLADOR'
export const DEVICE = 'tel-A'

class LocksFalsos {
  constructor() { this.tenidos = new Map(); this.colas = new Map(); this.log = [] }

  request(nombre, a, b) {
    const opciones = typeof a === 'function' ? {} : a
    const cb = typeof a === 'function' ? a : b
    return new Promise((resolver, rechazar) => {
      const solicitud = { cb, resolver, rechazar, abortada: false, opciones }
      if (opciones.signal) {
        if (opciones.signal.aborted) { rechazar(Object.assign(new Error('abortada'), { name: 'AbortError' })); return }
        opciones.signal.addEventListener('abort', () => {
          solicitud.abortada = true
          const q = this.colas.get(nombre) ?? []
          const i = q.indexOf(solicitud)
          if (i >= 0) { q.splice(i, 1); this.log.push(`cancelada:${nombre}`); rechazar(Object.assign(new Error('abortada'), { name: 'AbortError' })) }
        }, { once: true })
      }
      if (!this.tenidos.has(nombre)) { this.conceder(nombre, solicitud); return }
      if (opciones.ifAvailable) { Promise.resolve().then(() => cb(null)).then(resolver, rechazar); return }
      if (!this.colas.has(nombre)) this.colas.set(nombre, [])
      this.colas.get(nombre).push(solicitud)
      this.log.push(`en-cola:${nombre}`)
    })
  }

  conceder(nombre, s) {
    this.tenidos.set(nombre, s)
    this.log.push(`concedido:${nombre}`)
    Promise.resolve().then(() => s.cb({ name: nombre })).then(
      (v) => { this.liberar(nombre); s.resolver(v) },
      (e) => { this.liberar(nombre); s.rechazar(e) },
    )
  }

  liberar(nombre) {
    this.tenidos.delete(nombre)
    this.log.push(`liberado:${nombre}`)
    const q = this.colas.get(nombre) ?? []
    while (q.length) { const s = q.shift(); if (!s.abortada) { this.conceder(nombre, s); break } }
  }

  enCola(nombre) { return (this.colas.get(nombre) ?? []).length }
  tenido(nombre) { return this.tenidos.has(nombre) }
}

class CanalFalso {
  constructor(bus, nombre) { this.bus = bus; this.nombre = nombre; this.onmessage = null; this.cerrado = false; bus.canales.add(this) }
  postMessage(datos) {
    this.bus.mensajes.push({ nombre: this.nombre, datos: JSON.parse(JSON.stringify(datos)) })
    for (const c of this.bus.canales) {
      if (c !== this && !c.cerrado && c.nombre === this.nombre && c.onmessage) setTimeout(() => { if (!c.cerrado && c.onmessage) c.onmessage({ data: datos }) }, 0)
    }
  }
  close() { this.cerrado = true; this.bus.canales.delete(this) }
}

export function navegadorFalso() {
  const bus = { canales: new Set(), mensajes: [] }
  return { locks: new LocksFalsos(), bus, canal: (nombre) => new CanalFalso(bus, nombre) }
}

let n = 0
/** Una pestaña: controlador + asa de la base compartida + reloj virtual + red. */
export async function pestana(nav, banco, {
  nombreBD, enLinea = true, locks = nav.locks, token = TOKEN, deviceId = DEVICE, limites, gancho = null, sinCanal = false, politica, politicaEmisor, saltoParedMs = 0, identidad = undefined, conVisualizacion = false,
} = {}) {
  const rv = relojVirtual()
  const almacen = await abrirAlmacen({ nombre: nombreBD, gancho, ...(limites ? { limites } : {}) })
  const red = { enLinea, oyentes: new Set() }
  const vis = { visible: true, oyentes: new Set() }
  const paredExtra = { ms: saltoParedMs }
  const f = { llamadas: [], guion: [], guiones: { comandos: [], estado: [], preparacion: [], muestra: [] }, muestras: 0 }
  const servidorAhora = () => T0 + (rv.mono - 1000)
  f.fetch = (url, init) => {
    const llamada = { url, init, metodo: init?.method ?? 'GET', cuerpo: init?.body ?? null, abortada: false }
    f.llamadas.push(llamada)
    init?.signal?.addEventListener?.('abort', () => { llamada.abortada = true })
    if (!red.enLinea) return Promise.reject(new TypeError('sin conexión'))
    const tipo = url.endsWith('/comandos') ? 'comandos' : url.endsWith('/estado') ? 'estado' : url.endsWith('/preparacion') ? 'preparacion' : 'muestra'
    const paso = f.guiones[tipo].length ? f.guiones[tipo].shift() : f.guion.length ? f.guion.shift() : null
    if (paso === 'colgar') return new Promise((resolver, rechazar) => { llamada.liberar = resolver; init?.signal?.addEventListener?.('abort', () => rechazar(Object.assign(new Error('abortada'), { name: 'AbortError' }))) })
    if (typeof paso === 'function') return Promise.resolve().then(() => paso(llamada))
    if (paso instanceof Error) return Promise.reject(paso)
    if (paso) return Promise.resolve(paso)
    if (url.endsWith('/comandos')) {
      return banco.reenviar(JSON.parse(llamada.cuerpo), banco.ahora).then((r) => {
        const recibo = JSON.parse(JSON.stringify(r.recibo))
        return respuesta(200, { resultado: r.tipo, recibo, publicacion: r.tipo === 'aceptado' ? { rev: recibo.revDespues } : 'no-aplica' })
      })
    }
    if (url.endsWith('/estado')) return Promise.resolve(respuesta(200, cuerpoDeServidor(banco, { deviceId, visualizacion: conVisualizacion })))
    if (url.endsWith('/preparacion')) {
      const e = banco.adaptador.estado()
      return Promise.resolve(respuesta(200, { preparacion: banco.adaptador.preparacion(), etiquetas: [], rev: e.rev, ultimoClientSeq: banco.adaptador.ultimoClientSeq() }))
    }
    f.muestras += 1
    return Promise.resolve(respuesta(200, { servidorAhoraMs: servidorAhora() }))
  }
  n += 1
  const sesionId = `pagina-${n}`
  const ctl = crearControlador({
    ligaId: 'L1',
    partidoId: 'P',
    almacen,
    locks,
    canal: sinCanal ? null : nav.canal,
    obtenerIdentidad: identidad === undefined ? () => ({ token, deviceId }) : identidad,
    conexion: { enLinea: () => red.enLinea, alCambiar: (cb) => { red.oyentes.add(cb); return () => red.oyentes.delete(cb) } },
    visibilidad: { visible: () => vis.visible, alCambiar: (cb) => { vis.oyentes.add(cb); return () => vis.oyentes.delete(cb) } },
    lectura: () => ({ paredMs: servidorAhora() + paredExtra.ms, monoMs: Math.round(rv.mono), sesionId }),
    fetchImpl: f.fetch,
    setTimeoutImpl: rv.setTimeoutImpl,
    clearTimeoutImpl: rv.clearTimeoutImpl,
    azar: () => 0.5,
    ahora: () => servidorAhora() + paredExtra.ms,
    monoAhora: rv.monoAhora,
    ...(politica ? { politica } : {}),
    ...(politicaEmisor ? { politicaEmisor } : {}),
  })
  return {
    ctl, almacen, rv, f, red, vis, paredExtra, nav,
    conectar() { red.enLinea = true; for (const cb of [...red.oyentes]) cb(true) },
    desconectar() { red.enLinea = false; for (const cb of [...red.oyentes]) cb(false) },
    visibilidad(v) { vis.visible = v; for (const cb of [...vis.oyentes]) cb(v) },
    oyentesVivos: () => red.oyentes.size + vis.oyentes.size,
    comandos: () => f.llamadas.filter((l) => l.url.endsWith('/comandos')),
    lecturas: () => f.llamadas.filter((l) => !l.url.endsWith('/comandos')),
  }
}

export const nombreBase = () => `prueba-ctl-${++n}-${Math.random().toString(36).slice(2)}`
const ESPERAS = new Set(['esperando-reintento', 'esperando-retry-after', 'guardando-recibo'])
/** Hasta el reposo del emisor, disparando solo los temporizadores que lo desbloquean. */
export async function drenarPestana(p, { max = 400, hasta = null } = {}) {
  for (let i = 0; i < max; i += 1) {
    await tick()
    if (hasta && hasta()) return
    const fase = p.ctl.estado().emisor?.fase
    const ocupado = await Promise.race([p.ctl.reposo().then(() => false), tick().then(() => true)])
    if (!ocupado) { for (let k = 0; k < 4; k += 1) await tick(); return }
    if (ESPERAS.has(fase) && p.rv.timers.length) p.rv.dispararSiguiente()
  }
  throw new Error(`drenarPestana: sin reposo; fase ${p.ctl.estado().emisor?.fase}`)
}
export { reabrir }
