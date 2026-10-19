import { reglasDeConfig } from '../reglas-categoria'
import { crearCandado } from './sesion-candado'
import { crearClienteSesion } from './sesion-api'
import { crearEmisor } from './sesion-emisor'
import { crearRelojTelefono, crearOrden, estimar, evaluarParadaAutomatica, incorporarMuestra, tiempoInformativo } from './reloj-telefono'
import { construirSesion, evaluarInicio, ordenDeInicio } from './sesion-motor'
import { actualizarVisualizacion, crearSesion, encolar, leerSesion, reanudarSesion, reanudarTrasNoAutorizadoSesion, refrescarAntesDelInicioDeSesion } from './sesion-almacen'
import { datosParaMostrar } from './sesion-visualizacion'
import { leerRegistro } from './activacion-almacen'

// ---------------------------------------------------------------------------
// CONTROLADOR de la sesión de puntuación del navegador (REPORT_125). Une el núcleo S1a, el adaptador de red y el emisor serie
// con: propiedad por Web Lock, conectividad/visibilidad, muestreo de la hora del servidor (modelo reloj-telefono) y las
// compuertas de las órdenes sin conexión. NO es una interfaz, no borra paradas, no recupera «de emergencia» y no guarda el ancla
// del reloj (vive solo en memoria).
//
// REGLAS
//   - Solo el PROPIETARIO (Web Lock exclusivo) encola, envía, resuelve recibos o muta la sesión. Una pestaña de solo lectura NO
//     crea emisor, NO hace peticiones y NO escribe: se limita a releer lo durable. Los avisos entre pestañas (BroadcastChannel)
//     solo disparan una relectura: no llevan credenciales ni son autoridad; se valida su forma y se ignora el contenido.
//   - Al adquirir la propiedad se RELEE el estado durable antes de actuar. Al soltarla se cierra el emisor y se espera a que
//     terminen sus operaciones y las del controlador ANTES de liberar el candado.
//   - Una orden de reloj que necesita tiempo de confianza se RECHAZA antes de encolar si no hay estimación utilizable: no se
//     reserva ningún clientSeq ni se escribe nada. Puntos, faltas, periodos y la corrección con el reloj detenido no dependen de
//     ella. Una orden de reloj ya encolada no se toca nunca: si bloquea la cola, se EXPONE (`colaBloqueadaPorReloj`).
//   - Solo un recibo de inicio ACEPTADO habilita la puntuación; un `vivo` del servidor no se interpreta como inicio.
//   - La verificación no se mezcla con un envío: mientras dura, el emisor no se despierta (se difiere) y solo se verifica en
//     reposo y sin órdenes en vuelo. Crear el inicio y refrescar la base van en una sección crítica.
//   - Con la propiedad perdida, cerrada o invalidada, las devoluciones tardías (muestras, respuestas, temporizadores) no
//     escriben ni envían nada.
//   - PARADA AUTOMÁTICA (REPORT_129): solo el propietario, con un inicio aceptado y una estimación utilizable, encola la parada de la
//     corrida en curso con el cmdId fijo `auto:{partido}:{corridaSeq}` y el PLAZO calculado por el motor (nunca una hora inventada).
//     Un solo temporizador seguido; se recalcula tras cada relectura de lo durable. Registrar una orden del operador y disparar la
//     parada comparten una cola en serie: si el plazo ya venció, la parada se encola ANTES de la orden nueva (las ya guardadas no se
//     reordenan) y la orden se evalúa de nuevo contra el estado resultante.
//   - VERIFICACIÓN TRAS VACIAR LA COLA (REPORT_129): una vez cuando una cola con órdenes queda totalmente resuelta; sin sondeo, a lo sumo
//     una cada 60 s por controlador abierto (si se frena, UNA comprobación diferida), solo en reposo y con conexión.
// ---------------------------------------------------------------------------

export const POLITICA_CONTROLADOR = Object.freeze({
  vigilanciaMs: 15_000, // comprobación de salto/deriva/vencimiento del ancla (sin red); remuestrea solo si el modelo lo pide
  espacioEntreMuestrasMs: 5_000, // mínimo entre intentos de muestreo
  esperaTrasFalloMuestraMs: 30_000,
  muestrasPorRonda: 3,
  separacionMuestrasMs: 1_000,
  pasosRevisionMax: 4,
  datosParaMostrarEsperasMs: Object.freeze([0, 5_000, 20_000]), // espera previa de cada intento de traer nombres y números (3 como máximo, sin sondeo)
  paradaEsperaMinimaMs: 10, // suelo del temporizador de la parada automática (un disparo adelantado se recalcula sin girar en vacío)
  verificacionTrasVaciarMs: 60_000, // separación mínima entre verificaciones automáticas tras vaciar la cola
})

const MAX_TEMPORIZADOR_MS = 2_147_483_647

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/

const identidadPorOmision = (ligaId, partidoId) => () => {
  const r = leerRegistro(ligaId, partidoId)
  return r.tipo === 'valido' && r.registro.estado === 'activada' && r.registro.deviceId ? { token: r.registro.token, deviceId: r.registro.deviceId } : null
}

/**
 * crearControlador({ ligaId, partidoId, almacen, ...inyectables })
 *   almacen      asa de abrirAlmacen (el que llama la abre y la cierra)
 *   locks        navigator.locks            canal(nombre)  fábrica de BroadcastChannel (o null)
 *   obtenerIdentidad  () => { token, deviceId } | null   (por omisión, el registro de activación; el token NO se copia)
 *   conexion     { enLinea(), alCambiar(cb) }   visibilidad { visible(), alCambiar(cb) }
 *   lectura      () => { paredMs, monoMs, sesionId }    (relojes del dispositivo; nada se lee del sistema aquí)
 *   fetchImpl, setTimeoutImpl, clearTimeoutImpl, azar, ahora, monoAhora
 */
export function crearControlador({
  ligaId, partidoId, almacen, locks = globalThis.navigator?.locks, canal = null, obtenerIdentidad = null, conexion, visibilidad, lectura,
  fetchImpl = (...a) => globalThis.fetch(...a), setTimeoutImpl = (...a) => globalThis.setTimeout(...a), clearTimeoutImpl = (...a) => globalThis.clearTimeout(...a),
  azar = () => Math.random(), ahora = () => Date.now(), monoAhora = () => globalThis.performance.now(), politica = POLITICA_CONTROLADOR, politicaEmisor,
}) {
  const idValidos = typeof ligaId === 'string' && typeof partidoId === 'string' && RE_ID.test(ligaId) && RE_ID.test(partidoId)
  const id = `${ligaId}:${partidoId}`
  const identidad = obtenerIdentidad ?? identidadPorOmision(ligaId, partidoId)

  // --- cuentas de lo que este controlador posee (para demostrar que el cierre no deja nada) ---
  const timers = new Set()
  const bajas = new Set() // funciones de baja de oyentes
  const solicitudes = new Set() // AbortController de peticiones propias
  const tareas = new Set() // promesas de operaciones propias
  const oyentes = new Set()

  let candado = null
  let emisor = null
  let bajaEmisor = null
  let cerrado = false
  let soltando = false
  let generacion = 0 // generación de propiedad: cada adquisición la incrementa
  let genReloj = 0 // invalida muestras en vuelo
  let reloj = crearRelojTelefono()
  let muestreando = false
  let ultimoIntentoMuestra = -Infinity
  let esperaMuestraHasta = -Infinity
  let verificando = false
  let despertarDiferido = false
  let seccion = Promise.resolve() // sección crítica (inicio / refresco)
  let canalAviso = null
  let avisoPendiente = false
  let relecturaPendiente = null
  let vista = null // última lectura durable (resumen)
  let ultimaVerificacion = null
  let ultimoRefresco = null
  let ultimaVisualizacion = null
  let aviso = null // fallo propio no recuperable (identidad, etc.)
  let modoBase = 'inicial'
  let clienteActual = null
  let adquisicion = null
  // --- parada automática ---
  const parada = { timer: null, tok: 0 }
  let paradaUltima = null // resultado visible del último intento: { ok, cmdId, motivo? }
  let paradaFallo = null // { clave, motivo }: el último fallo de ESA corrida; no se reintenta solo (se limpia con muestra, reconexión o visibilidad)
  let serieRegistro = Promise.resolve() // cola en serie de registrar y de la parada automática
  // --- verificación tras vaciar la cola ---
  const verifAuto = { activa: null, timer: null, ultimaMono: -Infinity }
  let huboCola = false
  // --- recuperación explícita de la parada «no-autorizado» ---
  let recuperando = false
  let ultimaRecuperacion = null // { ok, motivo? }: resultado visible del último intento

  const enLinea = () => { try { return conexion.enLinea() === true } catch { return false } }
  const visible = () => { try { return visibilidad ? visibilidad.visible() === true : true } catch { return true } }
  const propietario = (g) => !cerrado && !soltando && g === generacion && candado !== null && candado.esPropietario()
  const lecturaReloj = () => lectura()
  const ctx = () => {
    const l = lecturaReloj()
    const est = estimar(reloj, l)
    return { ahoraEstimado: est.estimadoMs ?? l.paredMs, actorId: null, enLinea: enLinea(), ahora: ahora() }
  }

  // --- utilidades con contabilidad ---
  function temporizador(fn, ms) {
    const t = { id: null }
    t.id = setTimeoutImpl(() => { timers.delete(t); fn() }, ms)
    timers.add(t)
    return t
  }
  function cancelar(t) { if (!t) return; try { clearTimeoutImpl(t.id) } catch { /* nada */ } timers.delete(t) }
  function oyente(baja) { if (typeof baja === 'function') bajas.add(baja); return baja }
  function tarea(promesa) { tareas.add(promesa); promesa.finally(() => tareas.delete(promesa)).catch(() => {}); return promesa }

  // Esperas cancelables (una promesa que SIEMPRE termina: al cerrar o soltar se resuelve con false).
  const dormidos = new Set()
  function dormir(ms) {
    return new Promise((resolver) => {
      const d = { t: null, resolver }
      d.t = temporizador(() => { dormidos.delete(d); resolver(true) }, ms)
      dormidos.add(d)
    })
  }
  function despertarDormidos() { for (const d of [...dormidos]) { cancelar(d.t); dormidos.delete(d); d.resolver(false) } }

  // --- estado compuesto ---
  const congelar = (v) => {
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) congelar(v[k]) }
    return v
  }
  /** Lo que necesita la pantalla del estado provisional (base + órdenes vivas): copia PROFUNDA y congelada, nunca el objeto del motor. */
  const proyeccionProvisional = (e) => (e ? congelar(structuredClone({
    gameId: e.gameId,
    config: { deporte: e.config.deporte, minutosPorPeriodo: e.config.minutosPorPeriodo ?? null, ...reglasDeConfig(e.config) },
    // (las claves del reloj se copian por nombre: este módulo no escribe el reloj, solo lo lee)
    partido: Object.fromEntries(['estado', 'inicio', 'relojEstado', 'relojRestante', 'relojDesde'].map((k) => [k, e.partido[k] ?? null])),
    equipos: [...e.atribucion.equipos],
    eventos: e.eventos,
  })) : null)
  const resumen = (l) => {
    if (!l || !l.ok) return l ? { ok: false, motivo: l.motivo } : null
    const s = l.sesion
    const enviando = l.entradas.filter((e) => e.estado === 'enviando').length
    return {
      ok: true,
      inicio: s.inicio,
      puntuacion: l.vista.puntuacion,
      nivelBase: s.verificacion.nivel,
      verificadaRev: s.verificacion.verificadaRev,
      pendientes: l.entradas.filter((e) => e.estado === 'pendiente').length,
      enviando,
      confirmadas: l.entradas.filter((e) => e.estado === 'confirmada').length,
      rechazadas: l.entradas.filter((e) => e.estado === 'rechazada').length,
      // El último rechazo definitivo (solo lo necesario para EXPLICARLO): qué orden fue y el motivo que dio el servidor.
      ultimoRechazo: (() => {
        const rs = l.entradas.filter((e) => e.estado === 'rechazada')
        const e = rs.length ? rs[rs.length - 1] : null
        return e ? { cmdId: e.cmdId, tipo: e.tipo ?? null, motivo: e.recibo?.motivo ?? null } : null
      })(),
      noAplicadas: l.entradas.filter((e) => e.estado === 'no-aplicada').length,
      detenida: s.detenida ? { causa: s.detenida.causa, clase: s.detenida.clase ?? null, subtipo: s.detenida.subtipo ?? null, http: s.detenida.http ?? null, cmdId: s.detenida.cmdId ?? null } : null,
      divergencia: s.divergencia ? { causa: s.divergencia.causa } : null,
      uso: s.uso,
      revision: s.revision,
      // Estado provisional (copia congelada) y las órdenes que aún no tienen recibo: para distinguir «guardado aquí» de «confirmado».
      provisional: l.vista.ok ? proyeccionProvisional(l.vista.estadoProvisional) : null,
      cmdIdsVivos: Object.freeze(l.entradas.filter((e) => e.estado === 'pendiente' || e.estado === 'enviando').map((e) => e.cmdId)),
      // Nombres y números para mostrar: los guardados (sobreviven a recargar sin conexión), o «no disponibles» sin inventar nada.
      visualizacion: datosParaMostrar(s),
      ultimoClientSeq: s.base.ultimoClientSeq,
      siguienteSeq: s.siguienteSeq,
    }
  }

  /**
   * REPORT_178 — recuperación EXPLÍCITA tras el rechazo definitivo del INICIO (p. ej. «reglas-desactualizadas»): con confirmación de la
   * persona, lee de nuevo el partido y la preparación y reemplaza la base de la sesión por esa lectura fresca (`reanudarTrasRechazo`:
   * exige que el cursor del servidor coincida con el de la base, que el partido siga programado y la preparación lista). NO inicia el
   * partido, NO escribe nada en el servidor y NO reintroduce nada solo: el inicio nuevo lo pide la persona con un cmdId nuevo. Solo se
   * ofrece cuando lo rechazado fue el inicio (la pantalla no lo ofrece para otras órdenes).
   */
  function reanudarTrasRechazoDeInicio({ confirmadoPorOperador } = {}) {
    const no = soloPropietario()
    if (no) return Promise.resolve(no)
    if (confirmadoPorOperador !== true) return Promise.resolve({ ok: false, motivo: 'falta-confirmacion' })
    if (recuperando || verificando) return Promise.resolve({ ok: false, motivo: 'ocupado' })
    const g = generacion
    return enSeccion(async () => {
      recuperando = true
      verificando = true // el emisor no se despierta mientras dura
      publicar()
      try {
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        if (!enLinea()) return { ok: false, motivo: 'sin-internet' }
        const ident = identidad()
        if (!ident) return { ok: false, motivo: 'sin-identidad' }
        if (emisor) await emisor.reposo()
        let l = await leerSesion(almacen, id, ctx())
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        if (!l.ok) return { ok: false, motivo: l.motivo }
        if (l.sesion.deviceId !== ident.deviceId) return { ok: false, motivo: 'dispositivo-distinto' }
        if (l.sesion.divergencia) return { ok: false, motivo: 'sesion-detenida-por-divergencia' }
        const ultimo = l.entradas.filter((e) => e.estado === 'rechazada').pop()
        if (l.sesion.detenida?.causa !== 'rechazo-definitivo' || l.sesion.inicio !== 'sin-iniciar' || ultimo?.tipo !== 'iniciar-partido') return { ok: false, motivo: 'no-reanudable' }
        const ac = new AbortController()
        solicitudes.add(ac)
        let est
        let prep
        try {
          est = await clienteActual.leerEstado({ signal: ac.signal })
          if (est.clase === 'ok') prep = await clienteActual.leerPreparacion({ signal: ac.signal })
        } catch { est = { clase: 'incierta' } } finally { solicitudes.delete(ac) }
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        if (est.clase === 'sin-credencial') return { ok: false, motivo: 'no-autorizado' }
        if (est.clase !== 'ok') return { ok: false, motivo: est.clase === 'demasiado-grande' ? 'estado-demasiado-grande' : 'estado-no-disponible', detalle: est.clase }
        if (prep?.clase !== 'ok') return { ok: false, motivo: prep?.clase === 'no-disponible' ? 'preparacion-no-disponible' : 'preparacion-no-leida', detalle: prep?.clase ?? null }
        const r = await reanudarSesion(almacen, { id, revision: l.sesion.revision, cuerpoEstado: est.cuerpo, preparacion: prep.cuerpo.preparacion, confirmadoPorOperador: true, ctx: ctx() })
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        tarea(releer(g)); avisar()
        if (r.ok) return { ok: true, reanudada: true }
        return { ok: false, motivo: r.motivo === 'revision-desactualizada' ? 'revision-cambio' : r.motivo, ...(r.detalle !== undefined ? { detalle: r.detalle } : {}) }
      } catch { return { ok: false, motivo: 'error-interno' } } finally {
        recuperando = false
        verificando = false
        if (despertarDiferido) { despertarDiferido = false; despertarEmisor() }
        if (!cerrado) publicar()
      }
    })
  }

  function estado() {
    const e = emisor ? emisor.estado() : null
    const est = estimar(reloj, lecturaReloj())
    const v = vista
    const estados = []
    if (v?.ok) {
      if (v.detenida) estados.push(v.detenida.causa === 'transporte' ? 'parada-persistida' : v.detenida.causa === 'rechazo-definitivo' ? 'rechazo-definitivo' : 'cola-detenida')
      if (v.divergencia) estados.push('divergencia')
      if (v.enviando > 0 && !v.detenida) estados.push('resultado-desconocido')
    }
    if (ultimaVerificacion?.motivo === 'atribucion-no-aplicada' || ultimoRefresco?.motivo === 'atribucion-no-aplicada' || ultimaVisualizacion?.motivo === 'visualizacion-no-aplicada') estados.push('capacidad-rechazada')
    if (e && e.fase === 'retenida-por-reloj') estados.push('cola-bloqueada-por-reloj')
    if (e && e.fase === 'detenida' && e.persistida === false) estados.push('parada-solo-en-memoria')
    return {
      modo: cerrado ? 'cerrado' : modoBase,
      propietario: !cerrado && !soltando && candado?.esPropietario() === true,
      conexion: { enLinea: enLinea(), visible: visible() },
      reloj: { nivel: est.nivel, motivo: est.motivo ?? null, estimadoMs: est.estimadoMs ?? null, remuestreoDebido: est.remuestreoDebido === true, muestreando },
      emisor: e ? { fase: e.fase, causa: e.causa ?? null, motivo: e.motivo ?? null, cmdId: e.cmdId ?? null, persistida: e.persistida ?? null, protegidaTrasRecarga: e.protegidaTrasRecarga ?? null, clase: e.clase ?? null, subtipo: e.subtipo ?? null, http: e.http ?? null, intentos: e.intentos ?? null } : null,
      sesion: v ? { ...v } : null,
      colaBloqueadaPorReloj: e && e.fase === 'retenida-por-reloj' ? { cmdId: e.cmdId, motivo: e.motivo } : null,
      estados,
      ultimaVerificacion,
      ultimoRefresco,
      ultimaVisualizacion,
      recuperacion: { enCurso: recuperando, ultima: ultimaRecuperacion },
      automatica: { parada: paradaUltima, paradaProgramada: parada.timer !== null, verificacion: verifAuto.activa ? 'en-curso' : verifAuto.timer ? 'diferida' : 'ninguna' },
      aviso,
      listo: !cerrado && (emisor !== null || aviso !== null || modoBase !== 'propietario'),
    }
  }
  function publicar() { const s = estado(); for (const f of [...oyentes]) { try { f(s) } catch { /* un oyente no rompe el controlador */ } } }

  // --- avisos entre pestañas: solo disparan una RELECTURA de lo durable ---
  function avisar() {
    // Un aviso por ráfaga (microtarea): solo dice «hay algo nuevo en lo durable»; no lleva datos.
    if (!canalAviso || cerrado || avisoPendiente) return
    avisoPendiente = true
    Promise.resolve().then(() => {
      avisoPendiente = false
      if (!canalAviso || cerrado) return
      try { canalAviso.postMessage({ v: 1, tipo: 'cambio' }) } catch { /* sin canal */ }
    })
  }
  async function releer(g = generacion) {
    if (cerrado) return null
    const l = await leerSesion(almacen, id, ctx())
    if (cerrado || g !== generacion) return null
    vista = resumen(l)
    publicar()
    if (l?.ok) { evaluarParada(l, g); observarCola(g) }
    return l
  }
  function pedirRelectura() {
    // Se agrupa en una microtarea (sin temporizador): varias peticiones seguidas son UNA lectura de lo durable.
    if (cerrado || relecturaPendiente) return
    relecturaPendiente = true
    tarea(Promise.resolve().then(async () => { relecturaPendiente = false; if (!cerrado) await releer() }))
  }

  // --- el emisor, solo mientras se es propietario ---
  function despertarEmisor() {
    if (!emisor || cerrado || soltando) return
    if (verificando) { despertarDiferido = true; return }
    emisor.despertar()
  }

  async function alAdquirir() {
    const g = ++generacion
    modoBase = 'propietario'
    soltando = false
    const ident = (() => { try { return identidad() } catch { return null } })()
    // Se RELEE lo durable antes de actuar. Si la sesión existe, su dispositivo debe ser el de la activación.
    const l = await releer(g)
    if (cerrado || g !== generacion) return
    if (!ident) { aviso = { tipo: 'sin-identidad' }; publicar(); return }
    if (l?.ok && l.sesion.deviceId !== ident.deviceId) { aviso = { tipo: 'dispositivo-distinto' }; publicar(); return }
    aviso = null
    const cliente = crearClienteSesion({ ligaId, partidoId, token: () => { try { return identidad()?.token ?? null } catch { return null } }, fetchImpl, setTimeoutImpl: (fn, ms) => setTimeoutImpl(fn, ms), clearTimeoutImpl, monoAhora })
    clienteActual = cliente
    emisor = crearEmisor({
      almacen,
      id,
      cliente,
      propiedad: { esPropietario: () => propietario(g) },
      conexion: { enLinea }, // sin alCambiar: los eventos los gestiona el controlador (para diferirlos durante una verificación)
      reloj: { estimar: () => estimar(reloj, lecturaReloj()) },
      ctx,
      setTimeoutImpl,
      clearTimeoutImpl,
      azar,
      monoAhora,
      ...(politicaEmisor ? { politica: politicaEmisor } : {}),
    })
    bajaEmisor = emisor.suscribir(() => { pedirRelectura(); avisar() })
    iniciarVigilancia(g)
    publicar()
    if (enLinea()) tarea(muestrear('apertura'))
    despertarEmisor()
    tarea(releer(g)) // con emisor y propiedad ya fijados: recalcula la parada de una corrida que seguía en marcha (recarga)
  }

  async function alSoltar() {
    soltando = true
    genReloj += 1
    cancelarParada()
    cancelarVerifDiferida()
    despertarDormidos()
    for (const s of [...solicitudes]) { try { s.abort() } catch { /* nada */ } }
    if (emisor) { try { await emisor.cerrar() } catch { /* nada */ } }
    if (bajaEmisor) { bajaEmisor(); bajaEmisor = null }
    emisor = null
    await Promise.allSettled([...tareas])
    avisar()
  }

  // --- muestreo de la hora del servidor ---
  async function muestrear(motivo) {
    const g = generacion
    if (!propietario(g) || !enLinea() || muestreando || clienteActual === null) return { ok: false, motivo: 'no-aplica' }
    if (monoAhora() < esperaMuestraHasta) return { ok: false, motivo: 'en-espera' }
    muestreando = true
    const r0 = genReloj
    const ac = new AbortController()
    solicitudes.add(ac)
    publicar()
    try {
      for (let i = 0; i < politica.muestrasPorRonda; i += 1) {
        ultimoIntentoMuestra = monoAhora()
        const m = await clienteActual.tomarMuestra({ signal: ac.signal })
        if (!propietario(g) || r0 !== genReloj) return { ok: false, motivo: 'obsoleta' } // llegó tras una invalidación o el cierre
        if (m.clase !== 'ok') { esperaMuestraHasta = monoAhora() + politica.esperaTrasFalloMuestraMs; return { ok: false, motivo: m.clase } }
        const r = incorporarMuestra(reloj, { servidorAhoraMs: m.servidorAhoraMs, rttMs: m.rttMs }, lecturaReloj())
        if (r.ok) {
          reloj = r.reloj
          paradaFallo = null
          publicar()
          despertarEmisor() // una orden retenida por falta de estimación puede salir ahora
          tarea(releer(g)) // con estimación nueva, la parada automática se recalcula
          return { ok: true, motivo }
        }
        if (i < politica.muestrasPorRonda - 1) {
          const seguir = await new Promise((resolver) => { const t = temporizador(() => resolver(true), politica.separacionMuestrasMs); ac.signal.addEventListener('abort', () => { cancelar(t); resolver(false) }, { once: true }) })
          if (!seguir || !propietario(g) || r0 !== genReloj) return { ok: false, motivo: 'obsoleta' }
        }
      }
      esperaMuestraHasta = monoAhora() + politica.esperaTrasFalloMuestraMs
      return { ok: false, motivo: 'rtt-excesivo' }
    } finally {
      solicitudes.delete(ac)
      muestreando = false
      if (!cerrado) publicar()
    }
  }
  function invalidarReloj() {
    genReloj += 1
    for (const s of [...solicitudes]) { try { s.abort() } catch { /* nada */ } }
  }

  // --- vigilancia y eventos (acotados: un temporizador y un puñado de oyentes) ---
  let vigilancia = null
  function iniciarVigilancia(g) {
    const ciclo = () => {
      vigilancia = null
      if (!propietario(g)) return
      const est = estimar(reloj, lecturaReloj())
      // El modelo marca «remuestreo debido» ante salto de reloj, ancla perdida, incertidumbre o los 5 min. Solo con internet.
      if (est.remuestreoDebido && enLinea() && !muestreando && monoAhora() - ultimoIntentoMuestra >= politica.espacioEntreMuestrasMs) {
        if (est.nivel === 'degradado' && est.motivo === 'salto-de-reloj') invalidarReloj()
        tarea(muestrear(est.motivo ?? 'periodico'))
      }
      vigilancia = temporizador(ciclo, politica.vigilanciaMs)
    }
    vigilancia = temporizador(ciclo, politica.vigilanciaMs)
  }

  function alCambiarConexion(enLineaAhora) {
    if (cerrado) return
    if (!enLineaAhora) { invalidarReloj(); publicar(); return } // lo que estaba en vuelo ya no vale
    publicar()
    if (candado?.esPropietario()) { paradaFallo = null; tarea(muestrear('reconexion')); despertarEmisor(); if (quiereDatos) tarea(asegurarDatosParaMostrar()); pedirRelectura() } else pedirRelectura()
  }
  function alCambiarVisibilidad() {
    if (cerrado) return
    if (!visible()) { publicar(); return }
    if (candado?.esPropietario()) {
      // Vuelta de una suspensión: el modelo detecta el salto; además se remuestrea si hace falta.
      const est = estimar(reloj, lecturaReloj())
      if (est.nivel !== 'confiable' || est.remuestreoDebido) { if (est.motivo === 'salto-de-reloj') invalidarReloj(); tarea(muestrear('visibilidad')) }
      despertarEmisor()
      paradaFallo = null
      pedirRelectura() // al volver a ser visible el temporizador pudo haberse retrasado: se recalcula la parada
    } else pedirRelectura()
  }

  // --- parada automática en el plazo del motor ---
  const claveDeParada = (prov) => `${prov.gameId}:${prov.corridaSeq}`
  const puedeParar = (l, g) => propietario(g) && emisor !== null && !aviso && l?.ok === true && l.vista.ok === true && l.sesion.inicio === 'confirmado' && !l.sesion.detenida && !l.sesion.divergencia
  function cancelarParada() { parada.tok += 1; cancelar(parada.timer); parada.timer = null }
  function armarParada(g, faltaMs) {
    const ms = Math.min(Math.max(Math.ceil(faltaMs), politica.paradaEsperaMinimaMs), MAX_TEMPORIZADOR_MS)
    const tok = parada.tok
    parada.timer = temporizador(() => {
      parada.timer = null
      if (tok !== parada.tok || !propietario(g)) return // llamada tardía o repetida: no hace nada
      tarea(dispararParada(g))
    }, ms)
  }
  /** Recalcula el único temporizador de la corrida en curso a partir de una lectura durable (sin red). */
  function evaluarParada(l, g) {
    cancelarParada()
    if (!puedeParar(l, g)) return
    const prov = l.vista.estadoProvisional
    const d = evaluarParadaAutomatica(prov, estimar(reloj, lecturaReloj()))
    if (d.estado === 'no-vencida') armarParada(g, d.faltaMs)
    else if (d.estado === 'vencida' && paradaFallo?.clave !== claveDeParada(prov)) tarea(dispararParada(g))
    // 'incierta' (sin estimación utilizable) y 'no-aplica': ni parada ni temporizador; un remuestreo o una relectura lo recalcula
  }
  /** Encola la parada si el plazo venció DE FORMA FIABLE. Devuelve { intentada, ok?, reintentar?, motivo? }. */
  async function intentarParada(l, g) {
    if (!puedeParar(l, g)) return { intentada: false }
    const prov = l.vista.estadoProvisional
    const d = evaluarParadaAutomatica(prov, estimar(reloj, lecturaReloj()))
    if (d.estado !== 'vencida') return { intentada: false }
    const cmdId = d.orden.cmdId
    const r = await encolar(almacen, { id, revision: l.sesion.revision, orden: d.orden, ctx: ctx() })
    if (!propietario(g)) return { intentada: true, ok: false, motivo: 'propiedad-perdida' }
    if (r.ok) { // incluye la duplicada: el cmdId fijo hace que repetir sea inocuo
      paradaUltima = { ok: true, cmdId, duplicada: r.duplicada === true }
      paradaFallo = null
      avisar(); tarea(releer(g)); despertarEmisor()
      return { intentada: true, ok: true, cmdId }
    }
    if (r.motivo === 'revision-desactualizada') return { intentada: true, ok: false, reintentar: true, motivo: r.motivo }
    paradaFallo = { clave: claveDeParada(prov), motivo: r.motivo }
    paradaUltima = { ok: false, cmdId, motivo: r.motivo }
    publicar()
    return { intentada: true, ok: false, motivo: r.motivo }
  }
  /** Disparo del temporizador (o de una relectura que ve el plazo vencido): en serie, con lectura fresca. */
  function dispararParada(g) {
    return enSerie(async () => {
      for (let i = 0; i < politica.pasosRevisionMax; i += 1) {
        if (!propietario(g)) return
        const l = await leerSesion(almacen, id, ctx())
        if (!propietario(g)) return
        const r = await intentarParada(l, g)
        if (r.reintentar) continue
        if (!r.intentada) evaluarParada(l, g) // todavía no vence (disparo adelantado) o ya no corresponde
        return
      }
    })
  }
  function enSerie(fn) {
    const p = serieRegistro.then(fn, fn)
    serieRegistro = p.then(() => {}, () => {})
    return tarea(p)
  }

  // --- verificación una vez que la cola con órdenes queda resuelta ---
  function cancelarVerifDiferida() { cancelar(verifAuto.timer); verifAuto.timer = null }
  /** Cuenta las órdenes vivas de lo último leído: al pasar de «con órdenes» a «todas resueltas» pide UNA verificación. */
  function observarCola(g) {
    if (!propietario(g) || !vista?.ok) return
    if (vista.pendientes + vista.enviando > 0) { huboCola = true; cancelarVerifDiferida(); return }
    if (!huboCola) return
    huboCola = false
    pedirVerificacionTrasVaciar(g)
  }
  function pedirVerificacionTrasVaciar(g) {
    if (verifAuto.activa || verifAuto.timer) return // varias señales de vaciado son una sola verificación
    const espera = verifAuto.ultimaMono + politica.verificacionTrasVaciarMs - monoAhora()
    if (espera > 0) {
      verifAuto.timer = temporizador(() => { verifAuto.timer = null; if (propietario(g)) ejecutarVerificacionTrasVaciar(g) }, espera)
      return
    }
    ejecutarVerificacionTrasVaciar(g)
  }
  function ejecutarVerificacionTrasVaciar(g) {
    const em = emisor
    verifAuto.activa = tarea((async () => {
      try {
        if (!em) return { ok: false, motivo: 'sin-emisor' }
        await em.reposo()
        if (!propietario(g) || em !== emisor || !enLinea()) return { ok: false, motivo: 'condiciones' }
        const l = await leerSesion(almacen, id, ctx())
        if (!propietario(g) || em !== emisor || !enLinea()) return { ok: false, motivo: 'condiciones' }
        // Solo con la cola totalmente resuelta, sin parada ni divergencia y con el emisor en reposo. Si se agregó algo, el siguiente vaciado lo vuelve a pedir.
        if (!l.ok || l.sesion.detenida || l.sesion.divergencia || l.entradas.some((e) => e.estado === 'pendiente' || e.estado === 'enviando') || em.estado().fase !== 'inactivo') return { ok: false, motivo: 'condiciones' }
        verifAuto.ultimaMono = monoAhora()
        return await verificar()
      } finally { verifAuto.activa = null; if (!cerrado) publicar() }
    })())
  }

  // --- secciones críticas ---
  function enSeccion(fn) {
    const p = seccion.then(fn, fn)
    seccion = p.then(() => {}, () => {})
    return tarea(p)
  }

  // --- operaciones públicas ---
  const soloPropietario = () => {
    if (cerrado) return { ok: false, motivo: 'cerrado' }
    if (soltando || !candado?.esPropietario()) return { ok: false, motivo: candado?.estado?.() === 'sin-web-locks' ? 'sin-web-locks' : 'solo-lectura' }
    if (aviso && !emisor) return { ok: false, motivo: aviso.tipo }
    return null
  }

  /** Resultado para la pantalla: sin la vista derivada ni el sobre (no se entregan objetos internos mutables). */
  const resultadoPublico = (r) => { const { vista, sobre, estadoProvisional, cuerpoJson, ...resto } = r ?? {}; void vista; void sobre; void estadoProvisional; void cuerpoJson; return Object.freeze(structuredClone(resto)) }

  /**
   * Orden del operador. Las que necesitan tiempo de confianza se rechazan ANTES de encolar si no hay estimación: ningún clientSeq,
   * ninguna escritura. Devuelve el resultado del núcleo (o el rechazo local).
   */
  async function registrar({ tipo, datos = {}, cmdId } = {}) {
    const no = soloPropietario()
    if (no) return no
    const g = generacion
    return enSerie(async () => {
      let paradaDeEstaOrden = null
      let paradaProbada = false
      for (let i = 0; i < politica.pasosRevisionMax; i += 1) {
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        const l = await leerSesion(almacen, id, ctx())
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        if (!l.ok) return { ok: false, motivo: l.motivo }
        if (!l.vista.ok) return { ok: false, motivo: l.vista.motivo ?? 'sesion-no-utilizable' }
        // Plazo vencido de forma fiable: la parada va ANTES de la orden nueva (las ya guardadas no se mueven) y la orden se evalúa de nuevo.
        if (!paradaProbada) {
          const p = await intentarParada(l, g)
          if (p.reintentar) continue
          if (p.intentada) {
            paradaProbada = true
            paradaDeEstaOrden = { ok: p.ok, cmdId: paradaUltima?.cmdId ?? null, ...(p.ok ? {} : { motivo: p.motivo }) }
            if (p.ok) { i -= 1; continue } // lectura nueva contra el estado provisional resultante
          }
        }
        const est = estimar(reloj, lecturaReloj())
        const o = crearOrden({ estadoProvisional: l.vista.estadoProvisional, tipo, datos, cmdId, estimacion: est })
        if (!o.ok) return { ok: false, motivo: o.motivo, detalle: o.detalle ?? null, faltaMs: o.faltaMs ?? null, requiereResincronizacion: o.requiereResincronizacion === true, escrito: false, ...(paradaDeEstaOrden ? { paradaAutomatica: Object.freeze({ ...paradaDeEstaOrden }) } : {}) }
        const r = await encolar(almacen, { id, revision: l.sesion.revision, orden: o.orden, ctx: ctx() })
        if (r.motivo === 'revision-desactualizada') continue
        if (r.ok && r.vista) { avisar(); tarea(releer(g)); despertarEmisor() }
        return paradaDeEstaOrden ? Object.freeze({ ...resultadoPublico(r), paradaAutomatica: Object.freeze({ ...paradaDeEstaOrden }) }) : resultadoPublico(r)
      }
      return { ok: false, motivo: 'revision-desactualizada' }
    })
  }

  /**
   * Crea el INICIO: exige internet, lectura fresca de estado y preparación y confirmación explícita del operador. Crea la sesión si
   * no existe (un partido que no está «programado» nace «sin-resolver»: no se infiere un inicio de un `vivo`). Si la sesión es
   * previa al inicio y su atribución quedó obsoleta, la refresca (C3) con esos mismos insumos. Nunca habilita la puntuación: eso
   * solo lo hace el recibo aceptado.
   */
  function iniciarPartido({ cmdId, confirmadoPorOperador } = {}) {
    const no = soloPropietario()
    if (no) return Promise.resolve(no)
    if (confirmadoPorOperador !== true) return Promise.resolve({ ok: false, motivo: 'falta-confirmacion' })
    if (typeof cmdId !== 'string' || cmdId === '') return Promise.resolve({ ok: false, motivo: 'cmdId' })
    const g = generacion
    return enSeccion(async () => {
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      if (!enLinea()) return { ok: false, motivo: 'sin-internet' }
      const ident = identidad()
      if (!ident) return { ok: false, motivo: 'sin-identidad' }
      const ac = new AbortController()
      solicitudes.add(ac)
      let est
      let prep
      try {
        est = await clienteActual.leerEstado({ signal: ac.signal })
        if (est.clase === 'ok') prep = await clienteActual.leerPreparacion({ signal: ac.signal })
      } finally { solicitudes.delete(ac) }
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      // Un 401 (acceso retirado, vencido o de otro teléfono) NO es «no se pudo leer»: se dice que este teléfono ya no tiene permiso (REPORT_181).
      if (est.clase === 'sin-credencial') return { ok: false, motivo: 'no-autorizado' }
      if (est.clase !== 'ok') return { ok: false, motivo: est.clase === 'demasiado-grande' ? 'estado-demasiado-grande' : 'estado-no-disponible', detalle: est.clase }
      if (prep.clase !== 'ok') return { ok: false, motivo: prep.clase === 'no-disponible' ? 'preparacion-no-disponible' : 'preparacion-no-leida', detalle: prep.clase }
      let l = await leerSesion(almacen, id, ctx())
      if (!l.ok && l.motivo === 'sesion-inexistente') {
        const s = construirSesion({ ligaId, partidoId, cuerpoEstado: est.cuerpo, deviceId: ident.deviceId })
        if (!s.ok) return { ok: false, motivo: 'estado-invalido', detalle: s.motivo }
        const c = await crearSesion(almacen, s.sesion)
        if (!c.ok) return { ok: false, motivo: c.motivo ?? 'no-se-creo-la-sesion', detalle: c.motivo }
        l = await leerSesion(almacen, id, ctx())
      }
      if (!l.ok) return { ok: false, motivo: l.motivo }
      if (l.sesion.deviceId !== ident.deviceId) return { ok: false, motivo: 'dispositivo-distinto' }
      const preparacion = prep.cuerpo.preparacion
      let ev = evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: l.entradas, preparacion })
      if (!ev.puede && ev.motivo === 'atribucion-no-coincide-con-preparacion' && l.sesion.inicio === 'sin-iniciar') {
        const rf = await refrescarAntesDelInicioDeSesion(almacen, { id, revision: l.sesion.revision, cuerpoEstado: est.cuerpo, preparacion, ctx: ctx() })
        ultimoRefresco = rf.ok ? { ok: true, atribucionRefrescada: rf.atribucionRefrescada ?? null } : { ok: false, motivo: rf.motivo, causa: rf.causa ?? null, sincronizada: false }
        if (!rf.ok) { publicar(); return { ok: false, motivo: rf.motivo === 'atribucion-no-aplicada' ? 'atribucion-no-aplicada' : 'refresco-rechazado', detalle: rf.motivo, causa: rf.causa ?? null } }
        l = await leerSesion(almacen, id, ctx())
        ev = evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: l.entradas, preparacion })
      }
      if (!ev.puede) return { ok: false, motivo: ev.motivo, detalle: ev.detalle ?? null }
      const lect = lecturaReloj()
      const t = tiempoInformativo(estimar(reloj, lect)).tiempo
      const o = ordenDeInicio({ cmdId, preparacion, tiempo: t, sesion: l.sesion })
      if (!o.ok) return { ok: false, motivo: o.motivo }
      const r = await encolar(almacen, { id, revision: l.sesion.revision, orden: o.orden, ctx: ctx() })
      if (r.ok) { avisar(); tarea(releer(g)); despertarEmisor() }
      return resultadoPublico(r)
    })
  }

  /** Refresca la base previa al inicio con insumos frescos (C3), sin crear ni encolar un inicio. */
  function refrescarAntesDelInicio() {
    const no = soloPropietario()
    if (no) return Promise.resolve(no)
    const g = generacion
    return enSeccion(async () => {
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      if (!enLinea()) return { ok: false, motivo: 'sin-internet' }
      const est = await clienteActual.leerEstado()
      const prep = est.clase === 'ok' ? await clienteActual.leerPreparacion() : null
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      if (est.clase !== 'ok' || prep.clase !== 'ok') return { ok: false, motivo: 'insumos-no-disponibles', detalle: est.clase !== 'ok' ? est.clase : prep.clase }
      const l = await leerSesion(almacen, id, ctx())
      if (!l.ok) return { ok: false, motivo: l.motivo }
      const rf = await refrescarAntesDelInicioDeSesion(almacen, { id, revision: l.sesion.revision, cuerpoEstado: est.cuerpo, preparacion: prep.cuerpo.preparacion, ctx: ctx() })
      ultimoRefresco = rf.ok ? { ok: true, atribucionRefrescada: rf.atribucionRefrescada ?? null } : { ok: false, motivo: rf.motivo, causa: rf.causa ?? null, sincronizada: false }
      tarea(releer(g)); avisar()
      return rf
    })
  }

  /**
   * Lee el estado autorizado y adopta los datos para mostrar (nombres y números) si son válidos y distintos de los guardados. No
   * compara el juego ni toca órdenes: no puede crear una divergencia, y se serializa con el inicio/refresco. Capacidad agotada →
   * `visualizacion-no-aplicada` (nada cambia y NUNCA se dice que se adoptó). Sin internet o sin sesión, no hace nada.
   */
  function actualizarDatosParaMostrar() {
    const no = soloPropietario()
    if (no) return Promise.resolve(no)
    const g = generacion
    return enSeccion(async () => {
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      if (!enLinea()) return { ok: false, motivo: 'sin-internet' }
      const ac = new AbortController()
      solicitudes.add(ac)
      let est
      try { est = await clienteActual.leerEstado({ signal: ac.signal }) } finally { solicitudes.delete(ac) }
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      if (est.clase !== 'ok') return { ok: false, motivo: est.clase === 'demasiado-grande' ? 'estado-demasiado-grande' : 'estado-no-disponible', detalle: est.clase }
      let r = { ok: false, motivo: 'revision-desactualizada' }
      for (let i = 0; i < politica.pasosRevisionMax && r.motivo === 'revision-desactualizada'; i += 1) {
        const l = await leerSesion(almacen, id, ctx())
        if (!l.ok) return { ok: false, motivo: l.motivo }
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        r = await actualizarVisualizacion(almacen, { id, revision: l.sesion.revision, cuerpoEstado: est.cuerpo, ctx: ctx() })
      }
      ultimaVisualizacion = r.ok ? { ok: true, adoptada: r.adoptada === true, sinCambios: r.sinCambios === true } : { ok: false, motivo: r.motivo, causa: r.causa ?? null, adoptada: false }
      tarea(releer(g)); avisar()
      return r
    })
  }

  /**
   * Para una sesión anterior sin nombres ni números: los pide UNA vez al propietario con internet, con reintentos ACOTADOS (3 intentos,
   * esperas 0 / 5 s / 20 s) y sin sondeo. Un rechazo definitivo (capacidad, referencias inconsistentes, atribución distinta) no se
   * reintenta. Sin internet queda anotado y se vuelve a intentar UNA vez al reconectar. Nunca inventa nada.
   */
  let quiereDatos = false
  let asegurando = null
  function asegurarDatosParaMostrar() {
    const no = soloPropietario()
    if (no) return Promise.resolve(no)
    if (asegurando) return asegurando
    const g = generacion
    asegurando = tarea((async () => {
      try {
        const esperas = politica.datosParaMostrarEsperasMs
        for (let i = 0; i < esperas.length; i += 1) {
          if (i > 0 && !(await dormir(esperas[i]))) return { ok: false, motivo: 'cancelado' }
          if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
          const l = await leerSesion(almacen, id, ctx())
          if (!l.ok) return { ok: false, motivo: l.motivo }
          if (l.sesion.visualizacion) { quiereDatos = false; return { ok: true, yaTenia: true } }
          if (!enLinea()) { quiereDatos = true; return { ok: false, motivo: 'sin-internet' } }
          const r = await actualizarDatosParaMostrar()
          if (r.ok) { quiereDatos = false; return r }
          if (['visualizacion-no-aplicada', 'atribucion-distinta', 'visualizacion-ausente', 'visualizacion-invalida', 'propiedad-perdida', 'cerrado', 'solo-lectura'].includes(r.motivo)) return r
        }
        return { ok: false, motivo: 'reintentos-agotados' }
      } finally { asegurando = null }
    })())
    return asegurando
  }

  /** Verificación explícita: solo en reposo y sin órdenes en vuelo; el emisor no se despierta mientras dura. */
  async function verificar() {
    const no = soloPropietario()
    if (no) return no
    if (verificando) return { ok: false, motivo: 'ocupado' }
    const fase = emisor?.estado().fase
    if (!['inactivo', 'detenida', 'reintentos-agotados', 'respuestas-malformadas', 'sin-conexion', 'retenida-por-reloj', 'suspendida-retry-after'].includes(fase)) return { ok: false, motivo: 'emisor-ocupado' }
    const g = generacion
    verificando = true
    try {
      const r = await tarea(emisor.verificarAhora())
      if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
      ultimaVerificacion = r
      tarea(releer(g)); avisar()
      return r
    } finally {
      verificando = false
      if (despertarDiferido) { despertarDiferido = false; despertarEmisor() }
      if (!cerrado) publicar()
    }
  }

  /**
   * REPORT_130 — recuperación EXPLÍCITA de una parada persistida «no-autorizado» (401), y solo de ella. Nunca se llama sola (ni al
   * recargar, ni al reconectar, ni al volver a la pestaña). Secuencia:
   *   1. propietario, con internet, identidad de la activación y mismo partido/dispositivo que la sesión; parada persistida 401;
   *   2. si hay una orden INCIERTA («enviando»), se reenvía su sobre ORIGINAL por la vía existente con confirmación (la parada
   *      sigue puesta; las órdenes que dependen de ella NO se envían); si el resultado sigue desconocido, o aparece un rechazo
   *      definitivo o una divergencia, se termina aquí con todo intacto;
   *   3. se lee la sesión (revisión R) y DESPUÉS se pide una instantánea protegida fresca con la MISMA credencial (no se rota ni se
   *      renueva nada): un 401, 507, red caída o respuesta mal formada no autoriza nada;
   *   4. una sola operación atómica del núcleo, atada a R y a la parada vista, compara la instantánea con la base confirmada y borra
   *      solo esa parada. Si la revisión cambió, la evidencia se descarta y hace falta otro intento;
   *   5. solo con la transacción confirmada se despierta el emisor. La autorización sigue decidiéndola el servidor en CADA petición.
   * El emisor no se despierta mientras dura (se difiere), igual que en una verificación.
   */
  async function recuperarDeNoAutorizado({ confirmadoPorOperador } = {}) {
    const no = soloPropietario()
    if (no) return no
    if (confirmadoPorOperador !== true) return { ok: false, motivo: 'falta-confirmacion' }
    if (recuperando || verificando) return { ok: false, motivo: 'ocupado' }
    const g = generacion
    recuperando = true
    ultimaRecuperacion = null
    verificando = true // el emisor no se despierta mientras se recupera
    publicar()
    const terminar = (r) => { ultimaRecuperacion = r.ok ? { ok: true } : { ok: false, motivo: r.motivo }; return r }
    try {
      return terminar(await tarea((async () => {
        if (!enLinea()) return { ok: false, motivo: 'sin-internet' }
        const ident = (() => { try { return identidad() } catch { return null } })()
        if (!ident) return { ok: false, motivo: 'sin-identidad' }
        if (!emisor || !clienteActual) return { ok: false, motivo: 'no-disponible' }
        const em = emisor
        await em.reposo()
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        const leerTodo = async () => {
          const l = await leerSesion(almacen, id, ctx())
          if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
          if (!l.ok) return { ok: false, motivo: l.motivo }
          return l
        }
        const recuperable = (s) => (s.detenida?.causa === 'transporte' && s.detenida.clase === 'no-autorizado' && s.detenida.http === 401 ? null : 'parada-no-recuperable')
        let l = await leerTodo()
        if (!l.sesion) return l
        if (l.sesion.deviceId !== ident.deviceId) return { ok: false, motivo: 'dispositivo-distinto' }
        if (l.sesion.divergencia) return { ok: false, motivo: 'sesion-detenida-por-divergencia' }
        const noRec = recuperable(l.sesion)
        if (noRec) return { ok: false, motivo: noRec }
        if (em.estado().persistida === false) return { ok: false, motivo: 'parada-solo-en-memoria' } // sin parada persistida no hay nada que borrar
        // 2. resolver primero la incertidumbre: reenvío explícito del sobre original; la parada no se toca
        if (l.entradas.some((e) => e.estado === 'enviando')) {
          const r = await tarea(em.reintentarConConfirmacion({ confirmadoPorOperador: true }))
          await em.reposo()
          if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
          if (!r.ok) return { ok: false, motivo: r.motivo }
          l = await leerTodo()
          if (!l.sesion) return l
          if (l.sesion.divergencia) return { ok: false, motivo: 'divergencia' }
          if (l.sesion.detenida?.causa === 'rechazo-definitivo') return { ok: false, motivo: 'rechazo-definitivo' } // su recuperación es la que ya existe
          const noRec2 = recuperable(l.sesion)
          if (noRec2) return { ok: false, motivo: noRec2 }
          if (l.entradas.some((e) => e.estado === 'enviando')) return { ok: false, motivo: 'resultado-desconocido' }
        }
        // 3. instantánea fresca DESPUÉS de leer la revisión a la que quedará atada
        const parada = l.sesion.detenida
        const evidencia = { revision: l.sesion.revision, paradaEn: parada.en ?? null, paradaCmdId: parada.cmdId ?? null }
        if (!enLinea()) return { ok: false, motivo: 'sin-internet' }
        const ac = new AbortController()
        solicitudes.add(ac)
        let est
        try { est = await clienteActual.leerEstado({ signal: ac.signal }) } catch { est = { clase: 'incierta' } } finally { solicitudes.delete(ac) }
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        if (est.clase === 'sin-credencial') return { ok: false, motivo: 'no-autorizado' }
        if (est.clase !== 'ok') return { ok: false, motivo: est.clase === 'demasiado-grande' ? 'estado-demasiado-grande' : 'estado-no-disponible', detalle: est.clase }
        // 4. una operación atómica: verificar y borrar solo esta parada
        const r = await reanudarTrasNoAutorizadoSesion(almacen, { id, revision: evidencia.revision, cuerpoEstado: est.cuerpo, evidencia, confirmadoPorOperador: true, ctx: ctx() })
        if (!propietario(g)) return { ok: false, motivo: 'propiedad-perdida' }
        tarea(releer(g)); avisar()
        if (r.ok) {
          ultimaVerificacion = { ok: true, sincronizada: true, atribucionRefrescada: r.atribucionRefrescada ?? null }
          return { ok: true, reanudada: true }
        }
        if (r.motivo === 'divergencia') { ultimaVerificacion = { ok: false, motivo: 'divergencia', sincronizada: false, causa: r.causa ?? null }; return { ok: false, motivo: 'divergencia', causa: r.causa ?? null } }
        if (r.motivo === 'revision-desactualizada') return { ok: false, motivo: 'revision-cambio' } // la evidencia no se reutiliza
        return { ok: false, motivo: r.motivo, ...(r.detalle !== undefined ? { detalle: r.detalle } : {}) }
      })().catch(() => ({ ok: false, motivo: 'error-interno' }))))
    } finally {
      recuperando = false
      verificando = false
      if (despertarDiferido) { despertarDiferido = false }
      if (!cerrado) { publicar(); if (ultimaRecuperacion?.ok) despertarEmisor() }
    }
  }

  async function reintentarConConfirmacion({ confirmadoPorOperador } = {}) {
    const no = soloPropietario()
    if (no) return no
    return tarea(emisor.reintentarConConfirmacion({ confirmadoPorOperador }))
  }
  function reintentarAhora() { const no = soloPropietario(); if (no) return Promise.resolve(no); despertarEmisor(); return Promise.resolve({ ok: true }) }
  async function remuestrearReloj() {
    const no = soloPropietario()
    if (no) return no
    invalidarReloj() // lo que estaba en vuelo ya no vale; se espera a que termine antes de pedir otra muestra
    await Promise.allSettled([...tareas])
    esperaMuestraHasta = -Infinity
    return tarea(muestrear('explicito'))
  }

  // --- ciclo de vida ---
  async function abrir() {
    if (cerrado) return estado()
    if (!idValidos) { modoBase = 'configuracion'; publicar(); return estado() }
    candado = crearCandado({
      ligaId,
      partidoId,
      locks,
      alAdquirir: () => { adquisicion = alAdquirir(); return adquisicion },
      alSoltar,
      alCambiar: (e) => {
        if (cerrado) return
        modoBase = e === 'propietario' ? 'propietario' : e === 'soltando' ? 'soltando' : e
        publicar()
      },
    })
    oyente(conexion?.alCambiar?.(alCambiarConexion))
    oyente(visibilidad?.alCambiar?.(alCambiarVisibilidad))
    if (canal) {
      try {
        canalAviso = canal(`sebel-ctl-aviso:${ligaId}:${partidoId}`)
        if (canalAviso) {
          canalAviso.onmessage = (ev) => {
            // Solo la FORMA; el contenido no es autoridad y no se usa: basta para saber que hay que releer lo durable.
            const d = ev?.data
            if (d && typeof d === 'object' && d.v === 1 && d.tipo === 'cambio' && !candado?.esPropietario()) pedirRelectura()
          }
          oyente(() => { try { canalAviso.onmessage = null; canalAviso.close() } catch { /* nada */ } canalAviso = null })
        }
      } catch { canalAviso = null }
    }
    const e = await candado.iniciar()
    modoBase = e
    if (e === 'propietario' && adquisicion) await adquisicion
    if (e !== 'propietario') {
      // Solo lectura / sin Web Locks: se muestra lo durable sin escribir ni pedir nada.
      if (e === 'solo-lectura') tarea(releer())
    }
    publicar()
    return estado()
  }

  async function cerrarControlador() {
    if (cerrado) return { yaCerrado: true }
    const eraPropietario = candado?.esPropietario() === true
    cerrado = true
    genReloj += 1
    generacion += 1
    despertarDormidos()
    for (const s of [...solicitudes]) { try { s.abort() } catch { /* nada */ } }
    for (const t of [...timers]) cancelar(t)
    for (const baja of [...bajas]) { try { baja() } catch { /* nada */ } }
    bajas.clear()
    if (candado) await candado.cerrar() // propietario: alSoltar() (cierra el emisor y espera) y luego libera el candado
    await Promise.allSettled([...tareas])
    for (const t of [...timers]) cancelar(t)
    publicar()
    oyentes.clear()
    return { cerrado: true, eraPropietario, ...diagnostico() }
  }

  const diagnostico = () => ({ temporizadores: timers.size, oyentes: bajas.size, solicitudes: solicitudes.size, tareas: tareas.size, canal: canalAviso !== null })

  return Object.freeze({
    abrir,
    cerrar: cerrarControlador,
    estado,
    suscribir(f) { oyentes.add(f); return () => oyentes.delete(f) },
    registrar,
    iniciarPartido,
    refrescarAntesDelInicio,
    actualizarDatosParaMostrar,
    asegurarDatosParaMostrar,
    /** Hora del servidor estimada AHORA (o null) y el nivel de confianza: para pintar el reloj sin volver a armar todo el estado. */
    relojAhora: () => { const e = estimar(reloj, lecturaReloj()); return { estimadoMs: e.estimadoMs ?? null, nivel: e.nivel } },
    verificar,
    recuperarDeNoAutorizado,
    reanudarTrasRechazoDeInicio,
    reintentarAhora,
    reintentarConConfirmacion,
    remuestrearReloj,
    releer: () => releer(),
    diagnostico,
    /** Para pruebas: se resuelve cuando el emisor está en reposo. */
    reposo: async () => { if (emisor) await emisor.reposo() },
  })
}
