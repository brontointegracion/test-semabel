// Cliente del arnés del navegador (REPORT_125): expone el controlador REAL de la sesión de puntuación en `window.__h` para que
// el script de DevTools lo maneje. Se empaqueta con esbuild en un directorio TEMPORAL; no es una ruta ni una pantalla de
// producción. Los contadores de temporizadores, oyentes y canales son del propio arnés (para demostrar el cierre) y NO
// contienen credenciales: el token solo existe en la variable `token` de cada `abrir` y en la cabecera de las peticiones.
import { abrirAlmacen, leerSesion } from '../../src/lib/control/sesion-almacen.js'
import { crearControlador } from '../../src/lib/control/sesion-controlador.js'

const cuentas = { temporizadoresVivos: 0, oyentesVivos: 0, canalesAbiertos: 0, avisos: [], peticiones: [], errores: [] }
window.addEventListener('error', (e) => cuentas.errores.push(String(e.message).slice(0, 200)))
window.addEventListener('unhandledrejection', (e) => cuentas.errores.push(String(e.reason?.message ?? e.reason).slice(0, 200)))

const ctxLeer = () => ({ ahoraEstimado: Date.now(), actorId: 'arnes', enLinea: navigator.onLine, ahora: Date.now() })
let actual = null
let almacen = null
let sesionPagina = null

window.__h = {
  cuentas: () => JSON.parse(JSON.stringify({ ...cuentas, peticiones: cuentas.peticiones.slice(-60), avisos: cuentas.avisos.slice(-40) })),
  /** Abre almacén y controlador. `token` y `deviceId` vienen del arnés (credencial SINTÉTICA sembrada). */
  async abrir({ ligaId, partidoId, token, deviceId, nombreBD, sinWebLocks = false, politicaEmisor = undefined }) {
    window.__h._id = `${ligaId}:${partidoId}`
    sesionPagina = `pagina-${Math.random().toString(36).slice(2)}` // sesión de ESTA carga de página: el ancla del reloj no sobrevive a una recarga
    almacen = await abrirAlmacen({ nombre: nombreBD })
    const timers = new Map()
    const setT = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); cuentas.temporizadoresVivos -= 1; fn() }, ms); timers.set(id, true); cuentas.temporizadoresVivos += 1; return id }
    const clrT = (id) => { if (timers.delete(id)) cuentas.temporizadoresVivos -= 1; clearTimeout(id) }
    const conOyente = (objetivo, evento, fn) => {
      objetivo.addEventListener(evento, fn)
      cuentas.oyentesVivos += 1
      let vivo = true
      return () => { if (vivo) { vivo = false; cuentas.oyentesVivos -= 1; objetivo.removeEventListener(evento, fn) } }
    }
    const bajas = (...b) => () => { for (const x of b) x() }
    const fetchRegistrado = async (url, init) => {
      let cmdId = null
      try { if (typeof init?.body === 'string') cmdId = JSON.parse(init.body).cmdId ?? null } catch { /* sin cuerpo JSON */ }
      const reg = { url, metodo: init?.method ?? 'GET', cmdId, status: null }
      cuentas.peticiones.push(reg)
      try { const r = await fetch(url, init); reg.status = r.status; return r } catch (e) { reg.status = `error:${e?.name ?? 'Error'}`; throw e }
    }
    const canal = (nombre) => {
      const c = new BroadcastChannel(nombre)
      cuentas.canalesAbiertos += 1
      const cerrar = c.close.bind(c)
      c.close = () => { cuentas.canalesAbiertos -= 1; cerrar() }
      const enviar = c.postMessage.bind(c)
      c.postMessage = (m) => { cuentas.avisos.push(JSON.stringify(m)); enviar(m) }
      return c
    }
    actual = crearControlador({
      ligaId,
      partidoId,
      almacen,
      locks: sinWebLocks ? null : navigator.locks,
      canal,
      obtenerIdentidad: () => ({ token, deviceId }),
      conexion: { enLinea: () => navigator.onLine, alCambiar: (cb) => bajas(conOyente(window, 'online', () => cb(true)), conOyente(window, 'offline', () => cb(false))) },
      visibilidad: { visible: () => document.visibilityState === 'visible', alCambiar: (cb) => bajas(conOyente(document, 'visibilitychange', () => cb(document.visibilityState === 'visible')), conOyente(window, 'focus', () => cb(document.visibilityState === 'visible'))) },
      lectura: () => ({ paredMs: Date.now(), monoMs: Math.round(performance.now()), sesionId: sesionPagina }),
      fetchImpl: fetchRegistrado,
      setTimeoutImpl: setT,
      clearTimeoutImpl: clrT,
      ...(politicaEmisor ? { politicaEmisor } : {}),
    })
    return JSON.parse(JSON.stringify(await actual.abrir()))
  },
  estado: () => JSON.parse(JSON.stringify(actual.estado())),
  registrar: async (orden) => { const r = await actual.registrar(orden); return JSON.parse(JSON.stringify({ ...r, vista: undefined, sobre: undefined, estadoProvisional: undefined })) },
  iniciarPartido: async (o) => { const r = await actual.iniciarPartido(o); return JSON.parse(JSON.stringify({ ...r, vista: undefined, sobre: undefined })) },
  verificar: async () => JSON.parse(JSON.stringify(await actual.verificar())),
  reintentarAhora: async () => JSON.parse(JSON.stringify(await actual.reintentarAhora())),
  reintentarConConfirmacion: async (o) => JSON.parse(JSON.stringify(await actual.reintentarConConfirmacion(o))),
  remuestrear: async () => JSON.parse(JSON.stringify(await actual.remuestrearReloj())),
  reposo: async () => { await actual.reposo(); return true },
  cerrar: async () => JSON.parse(JSON.stringify(await actual.cerrar())),
  diagnostico: () => JSON.parse(JSON.stringify(actual.diagnostico())),
  /** Lo durable, sin la vista derivada: filas de entrada (texto exacto del sobre) y la sesión. */
  async leer() {
    const l = await leerSesion(almacen, window.__h._id, ctxLeer())
    if (!l.ok) return { ok: false, motivo: l.motivo }
    return JSON.parse(JSON.stringify({
      ok: true,
      inicio: l.sesion.inicio,
      siguienteSeq: l.sesion.siguienteSeq,
      detenida: l.sesion.detenida,
      divergencia: l.sesion.divergencia,
      puntuacion: l.vista.puntuacion,
      entradas: l.entradas.map((e) => ({ clientSeq: e.clientSeq, cmdId: e.cmdId, tipo: e.tipo, estado: e.estado, intentos: e.intentos, cuerpoJson: e.cuerpoJson, tieneRecibo: e.recibo !== null })),
    }))
  },
  _id: null,
  /** Volcado textual de las tres tablas (para comparar antes/después y buscar secretos). */
  volcar: () => new Promise((resolver, rechazar) => {
    const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
    const out = {}
    for (const n of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result } }
    tx.oncomplete = () => resolver(JSON.stringify(out))
    tx.onerror = () => rechazar(tx.error)
  }),
  async locks() {
    const q = await navigator.locks.query()
    const f = (l) => l.filter((x) => x.name.startsWith('sebel-ctl-sesion:')).map((x) => ({ name: x.name, mode: x.mode }))
    return { held: f(q.held ?? []), pending: f(q.pending ?? []) }
  },
  entorno: () => ({ onLine: navigator.onLine, visible: document.visibilityState, locks: typeof navigator.locks?.request === 'function', canal: typeof BroadcastChannel === 'function', seguro: window.isSecureContext }),
  /** Evento sintético, solo para demostrar que un controlador cerrado no reacciona. */
  evento: (nombre) => { window.dispatchEvent(new Event(nombre)) },
  avisoExterno: (nombre, m) => { const c = new BroadcastChannel(nombre); c.postMessage(m); c.close() },
}
