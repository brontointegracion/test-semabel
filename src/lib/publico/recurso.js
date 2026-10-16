import { crearMuestra } from './reloj-servidor.js'

// ---------------------------------------------------------------------------
// Un RECURSO público: una lectura (la liga o un partido) que se refresca sola, con límites.
//
//   - UNA petición en vuelo por recurso, y un solo recurso por clave aunque haya varias pantallas montadas (registro con
//     conteo de referencias). Al desmontarse la última, se aborta la petición, se cancelan temporizadores y oyentes y se
//     olvida todo: no hay caché persistente ni en memoria entre montajes.
//   - Cadencia (la fija quien lo crea con `periodoDe`/`intervaloMinDe`): nunca antes de `intervaloMinDe` desde que empezó la
//     petición anterior, sea cual sea el motivo (temporizador, foco, visibilidad, volver a estar en línea).
//   - Pestaña oculta: sin temporizador y se aborta lo que esté en vuelo; al volver a verse, se pide (si ya toca).
//   - Fallos: se CONSERVA el último dato bueno con el error a la vista; el siguiente intento espera
//     max(retroceso exponencial acotado a 60 s con fluctuación, intervalo mínimo, Retry-After). 404 y 507 no se repiten.
//   - Respuestas tardías: cada petición lleva un número; si ya no es la vigente (desmontaje, otra clave) se descarta.
// ---------------------------------------------------------------------------

export const RETROCESO_BASE_MS = 5_000
export const RETROCESO_NO_DISPONIBLE_MS = 15_000
export const RETROCESO_MAX_MS = 60_000

const ESTADO_INICIAL = Object.freeze({
  fase: 'cargando', datos: null, muestra: null, ultimoExito: null, error: null, fallos: 0, enVuelo: false, version: 0,
})
export const estadoInicial = () => ESTADO_INICIAL

/** Retraso tras `fallos` fallos seguidos: exponencial, con fluctuación hacia abajo, nunca más de 60 s. */
export function retrocesoDe(fallos, tipo, aleatorio = Math.random) {
  const base = tipo === 'no-disponible' ? RETROCESO_NO_DISPONIBLE_MS : RETROCESO_BASE_MS
  const bruto = Math.min(RETROCESO_MAX_MS, base * 2 ** Math.max(0, fallos - 1))
  return Math.round(bruto * (0.75 + 0.25 * aleatorio()))
}

const entornoNavegador = () => ({
  mono: () => performance.now(),
  pared: () => Date.now(),
  aleatorio: Math.random,
  poner: (fn, ms) => setTimeout(fn, ms),
  quitar: (id) => clearTimeout(id),
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  oyentes: (fn) => {
    const alVer = () => fn('visible')
    const alFoco = () => fn('foco')
    const alConectar = () => fn('conexion')
    document.addEventListener('visibilitychange', alVer)
    window.addEventListener('focus', alFoco)
    window.addEventListener('online', alConectar)
    return () => {
      document.removeEventListener('visibilitychange', alVer)
      window.removeEventListener('focus', alFoco)
      window.removeEventListener('online', alConectar)
    }
  },
})

/**
 * @param {object} def
 *   clave          texto único del recurso
 *   cargar(senal)  → { tipo, ... } como pedirJson, YA con el cuerpo validado: { tipo:'ok', datos, monoInicio, monoFin }
 *                    o cualquier otro tipo de pedirJson ('malformado' si no valida)
 *   periodoDe(datos)      ms hasta el siguiente refresco programado (datos puede ser null)
 *   intervaloMinDe(datos) ms mínimos entre el INICIO de dos peticiones
 */
export function crearRecurso({ clave, cargar, periodoDe, intervaloMinDe }, entorno = entornoNavegador()) {
  let estado = ESTADO_INICIAL
  const oyentes = new Set()
  let activo = false
  let temporizador = null
  let controlador = null
  let numero = 0
  let ultimoInicio = null
  let noAntesDe = null
  let quitarOyentes = null

  const emitir = (cambios) => {
    estado = { ...estado, ...cambios, version: estado.version + 1 }
    for (const fn of [...oyentes]) fn()
  }
  const limpiarTemporizador = () => { if (temporizador !== null) { entorno.quitar(temporizador); temporizador = null } }

  function programar(ms) {
    limpiarTemporizador()
    if (!activo || !entorno.visible()) return
    temporizador = entorno.poner(() => { temporizador = null; solicitar('temporizador') }, Math.max(0, ms))
  }

  /** Asegura que haya un temporizador para la siguiente petición según lo ya sabido. */
  function reprogramar() {
    if (!activo || !entorno.visible() || controlador) return
    if (estado.fase === 'no-encontrado' || estado.fase === 'terminal') return
    const ahora = entorno.mono()
    const desde = ultimoInicio ?? ahora
    const normal = estado.fallos > 0 ? 0 : periodoDe(estado.datos)
    const objetivo = Math.max(desde + Math.max(normal, intervaloMinDe(estado.datos)), noAntesDe ?? 0)
    programar(Math.max(objetivo - ahora, 0))
  }

  async function solicitar(motivo) {
    if (!activo || !entorno.visible() || controlador) return
    if (estado.fase === 'no-encontrado' || estado.fase === 'terminal') return
    const ahora = entorno.mono()
    if (ultimoInicio !== null) {
      const falta = ultimoInicio + intervaloMinDe(estado.datos) - ahora
      if (falta > 0) { if (temporizador === null) reprogramar(); return }
    }
    if (noAntesDe !== null && ahora < noAntesDe) { programar(noAntesDe - ahora); return }
    limpiarTemporizador()
    const miNumero = ++numero
    const ctl = new AbortController()
    controlador = ctl
    ultimoInicio = ahora
    emitir({ enVuelo: true })
    let r
    try { r = await cargar(ctl.signal) } catch { r = { tipo: 'red' } }
    if (!activo || miNumero !== numero) return // respuesta tardía de una petición ya descartada
    controlador = null
    if (r.tipo === 'cancelado') { emitir({ enVuelo: false }); return }
    if (r.tipo === 'ok') {
      const muestra = crearMuestra({ servidorAhoraMs: r.datos.servidorAhoraMs, monoInicio: r.monoInicio, monoFin: r.monoFin })
      if (muestra) {
        noAntesDe = null
        emitir({ fase: 'listo', datos: r.datos, muestra, ultimoExito: { mono: entorno.mono(), servidorMs: r.datos.servidorAhoraMs }, error: null, fallos: 0, enVuelo: false })
        reprogramar()
        return
      }
      r = { tipo: 'malformado' } // un viaje imposible de medir no es una respuesta utilizable
    }
    if (r.tipo === 'no-encontrado') { emitir({ fase: 'no-encontrado', error: { tipo: r.tipo }, enVuelo: false }); return }
    if (r.tipo === 'demasiado-grande') { emitir({ fase: 'terminal', error: { tipo: r.tipo }, enVuelo: false }); return }
    const fallos = estado.fallos + 1
    const espera = Math.max(retrocesoDe(fallos, r.tipo, entorno.aleatorio), intervaloMinDe(estado.datos), r.reintentoMs ?? 0)
    noAntesDe = r.reintentoMs ? entorno.mono() + r.reintentoMs : null
    emitir({ fase: estado.datos ? 'listo' : 'sin-datos', error: { tipo: r.tipo, status: r.status ?? null }, fallos, enVuelo: false })
    programar(espera)
  }

  function alEvento(motivo) {
    if (!activo) return
    if (motivo === 'visible' && !entorno.visible()) {
      limpiarTemporizador()
      if (controlador) { numero += 1; controlador.abort(); controlador = null; emitir({ enVuelo: false }) }
      return
    }
    solicitar(motivo)
  }

  return {
    clave,
    obtener: () => estado,
    suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn) },
    iniciar() {
      if (activo) return
      activo = true
      quitarOyentes = entorno.oyentes(alEvento)
      if (entorno.visible()) solicitar('montaje')
    },
    detener() {
      activo = false
      numero += 1
      limpiarTemporizador()
      if (controlador) { controlador.abort(); controlador = null }
      if (quitarOyentes) { quitarOyentes(); quitarOyentes = null }
    },
    /** Pide un refresco ya (respeta los intervalos mínimos y que haya una sola petición en vuelo). */
    solicitar,
  }
}

// --- Registro: un recurso por clave, compartido por todas las pantallas montadas ---------------------------------------
const registro = new Map()

/** Cuenta una referencia a `def.clave` (la crea e inicia si es la primera). → { recurso, liberar } */
export function adquirir(def, entorno) {
  let entrada = registro.get(def.clave)
  if (!entrada) {
    entrada = { recurso: crearRecurso(def, entorno), refs: 0 }
    registro.set(def.clave, entrada)
  }
  entrada.refs += 1
  entrada.recurso.iniciar()
  let liberado = false
  return {
    recurso: entrada.recurso,
    liberar() {
      if (liberado) return
      liberado = true
      entrada.refs -= 1
      if (entrada.refs <= 0) {
        entrada.recurso.detener()
        if (registro.get(def.clave) === entrada) registro.delete(def.clave)
      }
    },
  }
}

/** El estado actual de un recurso ya montado, o el inicial (para renderizar antes de suscribirse: nunca datos de otra clave). */
export const espiar = (clave) => registro.get(clave)?.recurso.obtener() ?? ESTADO_INICIAL
export const recursosActivos = () => registro.size

/** Pide un refresco ya del recurso montado con esa clave (respeta el intervalo mínimo y una sola petición en vuelo). */
export const refrescarRecurso = (clave) => registro.get(clave)?.recurso.solicitar('manual')
