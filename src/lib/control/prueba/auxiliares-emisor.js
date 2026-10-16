import { T0, ID, cmd, servidorNuevo, telefonoNuevo } from './auxiliares-sesion'
import { crearClienteSesion } from '../sesion-api'
import { crearEmisor } from '../sesion-emisor'

// Ayudas SINTÉTICAS del adaptador de red y del emisor: relojes y temporizadores virtuales, un `fetch` guionizado (o el
// servidor sintético del motor), propiedad y conectividad inyectadas. Nada toca la red, el reloj del sistema ni datos reales.

export { T0, ID, cmd, servidorNuevo, telefonoNuevo }

export function relojVirtual() {
  const r = { mono: 1000, timers: [], siguienteId: 1 }
  r.setTimeoutImpl = (fn, ms) => { const t = { id: r.siguienteId++, en: r.mono + Math.max(0, ms), fn }; r.timers.push(t); return t.id }
  r.clearTimeoutImpl = (id) => { r.timers = r.timers.filter((t) => t.id !== id) }
  r.monoAhora = () => r.mono
  /** Dispara el temporizador más próximo (avanzando el reloj virtual hasta él). */
  r.dispararSiguiente = () => {
    if (!r.timers.length) return false
    r.timers.sort((a, b) => a.en - b.en || a.id - b.id)
    const t = r.timers.shift()
    r.mono = Math.max(r.mono, t.en)
    t.fn()
    return true
  }
  return r
}

export const tick = () => new Promise((resolver) => setTimeout(resolver, 0))

export const respuesta = (status, cuerpo, { cabeceras = {}, tipo = 'application/json; charset=utf-8', texto = null } = {}) =>
  new Response(texto ?? JSON.stringify(cuerpo), { status, headers: { 'content-type': tipo, ...cabeceras } })

/** `fetch` inyectado: registra cada llamada y responde con el guion o, si no hay, con el servidor sintético. */
export function fetchSintetico(banco, { guion = [] } = {}) {
  const f = { llamadas: [], guion, colgadas: [] }
  f.fetch = (url, init) => {
    const llamada = { url, init, cuerpo: init?.body ?? null, abortada: false }
    f.llamadas.push(llamada)
    init?.signal?.addEventListener?.('abort', () => { llamada.abortada = true })
    const paso = f.guion.length ? f.guion.shift() : null
    if (paso === 'colgar') {
      return new Promise((resolver, rechazar) => {
        llamada.liberar = (r) => resolver(r)
        init?.signal?.addEventListener?.('abort', () => rechazar(Object.assign(new Error('abortada'), { name: 'AbortError' })))
      })
    }
    if (typeof paso === 'function') return Promise.resolve().then(() => paso(llamada))
    if (paso instanceof Error) return Promise.reject(paso)
    if (paso) return Promise.resolve(paso)
    return banco.reenviar(JSON.parse(llamada.cuerpo), banco.ahora).then((r) => {
      const recibo = JSON.parse(JSON.stringify(r.recibo))
      return respuesta(200, { resultado: r.tipo, recibo, publicacion: r.tipo === 'aceptado' ? { rev: recibo.revDespues } : 'no-aplica' })
    })
  }
  return f
}

/** Teléfono + emisor + dobles. `token` solo viaja en la cabecera. */
export async function entornoEmisor({ banco = servidorNuevo(), guion = [], enLinea = true, reloj = null, azar = () => 0.5, politica, tel = null, ctxEmisor = true } = {}) {
  const rv = relojVirtual()
  const telefono = tel ?? await telefonoNuevo(banco)
  if (!tel) await telefono.crear()
  const f = fetchSintetico(banco, { guion })
  const estadoRed = { enLinea, oyentes: new Set() }
  const conexion = { enLinea: () => estadoRed.enLinea, alCambiar: (cb) => { estadoRed.oyentes.add(cb); return () => estadoRed.oyentes.delete(cb) } }
  const estadoProp = { propietario: true, oyentes: new Set() }
  const propiedad = { esPropietario: () => estadoProp.propietario, alPerder: (cb) => { estadoProp.oyentes.add(cb); return () => estadoProp.oyentes.delete(cb) } }
  const cliente = crearClienteSesion({
    ligaId: 'L1', partidoId: 'P', token: 'TOKEN-SECRETO-DE-PRUEBA', fetchImpl: f.fetch, setTimeoutImpl: rv.setTimeoutImpl, clearTimeoutImpl: rv.clearTimeoutImpl, monoAhora: rv.monoAhora,
  })
  const crear = (extra = {}) => crearEmisor({
    almacen: telefono.almacen, id: ID, cliente, propiedad, conexion, reloj, azar, setTimeoutImpl: rv.setTimeoutImpl, clearTimeoutImpl: rv.clearTimeoutImpl, monoAhora: rv.monoAhora,
    ctx: ctxEmisor ? () => ({ ahoraEstimado: T0, actorId: 'emisor', enLinea: estadoRed.enLinea, ahora: T0 }) : null,
    ...(politica ? { politica } : {}), ...extra,
  })
  const emisor = crear()
  return {
    banco, tel: telefono, rv, f, emisor, cliente, crear, estadoRed, estadoProp,
    conectar() { estadoRed.enLinea = true; for (const cb of [...estadoRed.oyentes]) cb(true) },
    desconectar() { estadoRed.enLinea = false; for (const cb of [...estadoRed.oyentes]) cb(false) },
    perderPropiedad() { estadoProp.propietario = false; for (const cb of [...estadoProp.oyentes]) cb() },
  }
}

const ESPERAS = new Set(['esperando-reintento', 'esperando-retry-after', 'guardando-recibo'])
/** Hace avanzar el emisor hasta el reposo, disparando los temporizadores (sin tiempo real). Devuelve los tiempos de espera usados. */
export async function drenar(e, emisor = e.emisor, { max = 400, hasta = null } = {}) {
  const esperas = []
  for (let i = 0; i < max; i += 1) {
    await tick()
    if (hasta && hasta()) return esperas
    const s = emisor.estado()
    const ocupado = await Promise.race([emisor.reposo().then(() => false), tick().then(() => true)])
    if (!ocupado) return esperas
    if (e.rv.timers.length && (ESPERAS.has(s.fase) || s.fase === 'retenida-por-reloj' || s.fase === 'almacenamiento-espera')) {
      const antes = e.rv.mono
      e.rv.dispararSiguiente()
      esperas.push(Math.round(e.rv.mono - antes))
    }
  }
  throw new Error(`drenar: no llegó al reposo; fase ${emisor.estado().fase}`)
}

export const volcarBase = (almacen) => new Promise((resolver, rechazar) => {
  const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
  const out = {}
  for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
  tx.oncomplete = () => resolver(JSON.stringify(out))
  tx.onerror = () => rechazar(tx.error)
})

/** Inicio aceptado y confirmado (sin pasar por el emisor), y `n` puntos pendientes. */
export async function conInicioYPuntos(e, n = 0) {
  await e.tel.iniciar()
  await e.tel.enviarSiguiente()
  for (let i = 0; i < n; i += 1) await e.tel.encolar(e.tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }))
}
