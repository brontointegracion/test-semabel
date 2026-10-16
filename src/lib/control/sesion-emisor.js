import { aplicarRecibo, leerSesion, marcarEnviando, registrarParadaDeTransporte, verificarInstantanea } from './sesion-almacen'
import { requiereTiempoDeConfianza } from './reloj-telefono'

// ---------------------------------------------------------------------------
// EMISOR SERIE de la sesión de puntuación (REPORT_124). Envía, de uno en uno y en el orden del núcleo, el texto EXACTO guardado
// de cada orden viva, con el adaptador de red (sesion-api.js), y aplica cada recibo con la operación atómica del núcleo.
//
// Lo que NO es: no crea órdenes ni un inicio (jamás), no reconstruye un sobre, no estima la hora, no implementa Web Locks,
// controlador ni interfaz, y no borra paradas. La propiedad (quién puede enviar), la conectividad, el reloj, los temporizadores
// y el azar llegan INYECTADOS; esto NO demuestra seguridad entre pestañas reales: solo que, con la propiedad que se le inyecta,
// no envía ni escribe sin ella.
//
// Orden de un paso (todo comprobado contra la «generación» y la propiedad ANTES de actuar y DESPUÉS de cada espera):
//   1. leer filas confirmadas;  2. divergencia / parada → NO se envía solo;  3. primera orden viva;  4. retención por reloj
//   (solo órdenes aún sin enviar con tiempo de confianza);  5. marcarEnviando (persistido ANTES de transmitir);  6. enviar el
//   texto devuelto por el núcleo;  7. clasificar;  8. recibo → aplicarRecibo (persistido ANTES de pasar a la siguiente orden).
//
// Cierre y pérdida de propiedad: se cancelan temporizadores y la petición en vuelo (esto NO cancela lo que el servidor ya
// confirmó: la orden queda «enviando» y la resolverá el siguiente propietario reenviando el MISMO texto), se invalida la
// generación (ninguna devolución tardía envía ni escribe) y se espera a que terminen las operaciones de almacenamiento ya
// empezadas por esta instancia.
// ---------------------------------------------------------------------------

/** Valores de REPORT_119 (los exactos), más lo que pide REPORT_124. */
export const POLITICA_EMISOR = Object.freeze({
  esperasMs: Object.freeze([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]), // espera tras el intento n (±jitter)
  jitter: 0.2,
  intentosInciertosPorCorrida: 8, // intentos inciertos seguidos por orden y por corrida
  respuestasMalformadasSeguidas: 3, // y entonces se suspende («respuestas-malformadas»)
  presupuestoEsperaMs: 120_000, // espera acumulada máxima de una corrida (≈ 2 min); un Retry-After mayor SUSPENDE, no se acorta
  reintentosReciboMs: Object.freeze([500, 1000, 2000]), // tras fallar aplicar el recibo: 3 reintentos (4 intentos en total)
  relojMargenMs: 1000, // se retiene si accionTs > estimación + 1000 ms (el servidor tolera 2000)
  relojRetencionMaxMs: 30_000, // espera máxima de una retención; más allá: «reloj-adelantado» (suspensión)
  pasosRevisionMax: 5, // relecturas seguidas por revisión desactualizada (otra parte escribió entre la lectura y la operación)
})

const vivas = (e) => e.estado === 'pendiente' || e.estado === 'enviando'
const CLASES_DE_PARADA = new Set(['no-autorizado', 'protocolo', 'conflicto', 'sobre-invalido'])

/**
 * crearEmisor({ almacen, id, cliente, propiedad, conexion, reloj?, ctx?, politica?, setTimeoutImpl?, clearTimeoutImpl?, azar?, monoAhora? })
 *   propiedad: { esPropietario(): boolean, alPerder?(cb): () => void }   (inyectada; el candado real es trabajo posterior)
 *   conexion:  { enLinea(): boolean, alCambiar?(cb): () => void }
 *   reloj:     { estimar(): estimación del módulo reloj-telefono | Promise }   (no se inventa ninguna estimación aquí)
 *   ctx:       () => { ahoraEstimado, actorId, enLinea, ahora }               (por omisión se arma con Date.now)
 */
export function crearEmisor({
  almacen, id, cliente, propiedad, conexion, reloj = null, ctx = null, politica = POLITICA_EMISOR,
  setTimeoutImpl = (...a) => globalThis.setTimeout(...a), clearTimeoutImpl = (...a) => globalThis.clearTimeout(...a),
  azar = () => Math.random(), monoAhora = () => globalThis.performance.now(),
}) {
  let generacion = 0
  let cerrado = false
  let perdida = false
  let bucle = null
  let controlador = null // AbortController de la petición en vuelo
  let enVuelo = false
  let paradaEnMemoria = false // parada que NO se pudo persistir: esta instancia no vuelve a enviar
  let noAntesDe = 0 // Retry-After vigente (tiempo monótono)
  const operaciones = new Set()
  const esperas = new Set() // { temporizador, resolver }
  const oyentes = new Set()
  const quitar = []
  let estado = { fase: 'inactivo' }

  const copia = (o) => JSON.parse(JSON.stringify(o))
  const publicar = () => { const s = copia(estado); for (const f of [...oyentes]) { try { f(s) } catch { /* un oyente no rompe el emisor */ } } }
  const fijar = (fase, extra = {}) => { estado = { fase, ...extra }; publicar() }

  const propietario = () => { try { return propiedad.esPropietario() === true } catch { return false } }
  const vigente = (gen) => !cerrado && !perdida && gen === generacion && propietario()
  const contexto = () => {
    if (ctx) return ctx()
    const ahora = Date.now()
    return { ahoraEstimado: ahora, actorId: null, enLinea: enLineaAhora(), ahora }
  }
  const enLineaAhora = () => { try { return conexion.enLinea() === true } catch { return false } }

  /** Una operación de almacenamiento de ESTA instancia: no empieza si ya no es vigente y el cierre espera a que termine. */
  function op(gen, hacer) {
    if (!vigente(gen)) return Promise.resolve({ ok: false, motivo: 'fuera-de-generacion' })
    const p = (async () => {
      try { return await hacer() } catch (e) { return { ok: false, motivo: 'almacenamiento', op: 'emisor', cuota: false, error: { nombre: e?.name ?? 'Error' }, escrituraEmitida: false } }
    })()
    operaciones.add(p)
    p.finally(() => operaciones.delete(p))
    return p
  }

  function dormir(ms) {
    return new Promise((resolver) => {
      const e = { temporizador: null, resolver }
      e.temporizador = setTimeoutImpl(() => { esperas.delete(e); resolver(true) }, Math.max(0, ms))
      esperas.add(e)
    })
  }
  function cancelarEsperas() {
    for (const e of [...esperas]) { try { clearTimeoutImpl(e.temporizador) } catch { /* nada */ } esperas.delete(e); e.resolver(false) }
  }
  function invalidar() {
    generacion += 1
    cancelarEsperas()
    const habia = enVuelo
    if (controlador) { try { controlador.abort() } catch { /* nada */ } }
    return habia
  }

  // -------------------------------------------------------------------------
  // Pasos auxiliares
  // -------------------------------------------------------------------------
  const leer = (gen) => op(gen, () => leerSesion(almacen, id, contexto()))

  /** Ejecuta `hacer(revision)` releyendo la revisión si otra parte escribió entre la lectura y la operación. */
  async function conRevision(gen, hacer) {
    for (let i = 0; i < politica.pasosRevisionMax; i += 1) {
      const l = await leer(gen)
      if (!l.ok) return l.motivo === 'fuera-de-generacion' ? l : { ok: false, motivo: l.motivo ?? 'lectura', lectura: true, ...(l.motivo === 'almacenamiento' ? { almacenamiento: true } : {}) }
      const r = await op(gen, () => hacer(l.sesion.revision, l))
      if (r.motivo !== 'revision-desactualizada') return r
    }
    return { ok: false, motivo: 'revision-desactualizada' }
  }

  async function retencionPorReloj(sesion, primera) {
    if (primera.estado !== 'pendiente') return null // un reenvío NO se retiene por el reloj: ya pudo llegar
    let sobre
    try { sobre = JSON.parse(primera.cuerpoJson) } catch { return { motivo: 'sobre-ilegible' } }
    if (!requiereTiempoDeConfianza(sesion.base.estado, sobre.tipo)) return null // puntos, faltas… nunca se retienen
    if (!reloj) return { motivo: 'sin-reloj' }
    let est
    try { est = await reloj.estimar() } catch { return { motivo: 'reloj-invalido' } }
    if (!est || est.nivel !== 'confiable' || !Number.isSafeInteger(est.estimadoMs)) return { motivo: 'sin-tiempo-confiable' }
    if (!Number.isSafeInteger(sobre.accionTs)) return { motivo: 'sobre-sin-hora' }
    const exceso = sobre.accionTs - (est.estimadoMs + politica.relojMargenMs)
    if (exceso <= 0) return null
    if (exceso > politica.relojRetencionMaxMs) return { motivo: 'reloj-adelantado' }
    return { motivo: 'accion-en-el-futuro', esperaMs: exceso }
  }

  async function pararPorTransporte(gen, r, cmdId) {
    const parada = { clase: r.clase, subtipo: r.subtipo ?? null, http: r.http, cmdId }
    const g = await conRevision(gen, (revision) => registrarParadaDeTransporte(almacen, { id, revision, parada, ctx: contexto() }))
    if (g.motivo === 'fuera-de-generacion') return 'fuera'
    if (g.ok) {
      fijar('detenida', { causa: 'transporte', clase: r.clase, subtipo: r.subtipo ?? null, http: r.http, cmdId, persistida: true, yaDetenida: g.yaDetenida === true })
      return 'detenida'
    }
    if (g.motivo === 'sesion-detenida-por-divergencia') { fijar('detenida', { causa: 'divergencia', persistida: true }); return 'detenida' }
    // No se pudo grabar: se detiene SOLO en memoria y se dice sin rodeos que una recarga no lo protege.
    paradaEnMemoria = true
    fijar('detenida', { causa: 'transporte', clase: r.clase, subtipo: r.subtipo ?? null, http: r.http, cmdId, persistida: false, protegidaTrasRecarga: false, motivoFalloAlGrabar: g.motivo })
    return 'detenida'
  }

  /** Aplica el recibo (persistido ANTES de seguir). Devuelve 'ok' | 'divergencia' | 'malformado' | 'almacenamiento' | 'detenida' | 'fuera'. */
  async function aplicar(gen, recibo, cmdId) {
    const esperas_ = politica.reintentosReciboMs
    for (let intento = 0; intento <= esperas_.length; intento += 1) {
      const r = await conRevision(gen, (revision) => aplicarRecibo(almacen, { id, revision, recibo, ctx: contexto() }))
      if (r.motivo === 'fuera-de-generacion') return 'fuera'
      if (r.ok) return 'ok'
      if (r.motivo === 'recibo-malformado') return 'malformado'
      if (r.motivo === 'divergencia' || r.motivo === 'sesion-detenida-por-divergencia') { fijar('detenida', { causa: 'divergencia', cmdId, persistida: true, detalle: r.causa ?? null }); return 'divergencia' }
      if (r.motivo !== 'almacenamiento' && !r.almacenamiento) { fijar('detenida', { causa: r.motivo ?? 'desconocida', cmdId, persistida: true }); return 'detenida' }
      if (intento === esperas_.length) break
      fijar('guardando-recibo', { cmdId, intento: intento + 1, esperaMs: esperas_[intento] })
      if (!(await dormir(esperas_[intento]))) return 'fuera'
      if (!vigente(gen)) return 'fuera'
    }
    // El recibo existe SOLO en memoria: se detiene. Al volver a empezar se reenvía el sobre original y el servidor devuelve el mismo recibo.
    fijar('almacenamiento', { cmdId, motivo: 'no-se-pudo-guardar-el-recibo', reciboSoloEnMemoria: true })
    return 'almacenamiento'
  }

  // -------------------------------------------------------------------------
  // La corrida
  // -------------------------------------------------------------------------
  async function corrida(gen, { explicito = false } = {}) {
    let inciertos = 0
    let malformadas = 0
    let esperado = 0
    let revisiones = 0
    for (;;) {
      if (!vigente(gen)) return
      if (!enLineaAhora()) { fijar('sin-conexion'); return }
      const ahora = monoAhora()
      if (noAntesDe > ahora) {
        const falta = noAntesDe - ahora
        if (falta > politica.presupuestoEsperaMs - esperado) { fijar('suspendida-retry-after', { noAntesDe, faltaMs: Math.ceil(falta) }); return }
        fijar('esperando-retry-after', { noAntesDe })
        if (!(await dormir(falta))) return
        esperado += falta
        continue
      }

      const l = await leer(gen)
      if (l.motivo === 'fuera-de-generacion') return
      if (!l.ok) { fijar(l.motivo === 'almacenamiento' ? 'almacenamiento' : 'detenida', { causa: l.motivo, persistida: true }); return }
      const { sesion, entradas } = l
      if (sesion.divergencia) { fijar('detenida', { causa: 'divergencia', persistida: true }); return }
      const paradaTransporte = sesion.detenida?.causa === 'transporte'
      if (sesion.detenida && !(explicito && paradaTransporte)) {
        fijar('detenida', { causa: sesion.detenida.causa, cmdId: sesion.detenida.cmdId ?? null, clase: sesion.detenida.clase ?? null, persistida: true })
        return
      }
      const primera = entradas.find(vivas)
      if (!primera) { fijar('inactivo'); return }

      if (!explicito) {
        const ret = await retencionPorReloj(sesion, primera)
        if (!vigente(gen)) return
        if (ret) {
          if (ret.esperaMs !== undefined) {
            fijar('retenida-por-reloj', { motivo: ret.motivo, cmdId: primera.cmdId, esperaMs: ret.esperaMs })
            if (!(await dormir(ret.esperaMs))) return
            continue
          }
          fijar('retenida-por-reloj', { motivo: ret.motivo, cmdId: primera.cmdId })
          return
        }
      }

      // 5. persistir «enviando» ANTES de transmitir
      const m = await op(gen, () => marcarEnviando(almacen, { id, revision: sesion.revision, cmdId: primera.cmdId, confirmadoPorOperador: explicito, ctx: contexto() }))
      if (m.motivo === 'fuera-de-generacion') return
      if (!m.ok) {
        if (m.motivo === 'revision-desactualizada') {
          revisiones += 1
          if (revisiones >= politica.pasosRevisionMax) { fijar('detenida', { causa: 'revision-desactualizada', persistida: true }); return }
          continue
        }
        fijar(m.motivo === 'almacenamiento' ? 'almacenamiento' : 'detenida', { causa: m.motivo, cmdId: primera.cmdId, persistida: true, enviado: false })
        return
      }
      revisiones = 0
      if (!vigente(gen)) return // se cerró mientras se marcaba: NO se envía; la orden queda «enviando» (sin haberse transmitido)

      // 6. transmitir el texto EXACTO que devolvió el núcleo
      fijar('enviando', { cmdId: primera.cmdId, intentos: m.intentos, explicito })
      controlador = new AbortController()
      enVuelo = true
      let r
      try { r = await cliente.enviarComando(m.cuerpoJson, { signal: controlador.signal }) } catch { r = { clase: 'incierta', motivo: 'error-interno', malformada: false, retryAfterMs: null } }
      enVuelo = false
      controlador = null
      if (!vigente(gen)) return // respuesta tardía de una generación vencida: se descarta SIN tocar el almacén

      // 7/8. clasificar
      if (r.clase === 'recibo') {
        const a = await aplicar(gen, r.recibo, primera.cmdId)
        if (a === 'fuera' || a === 'divergencia' || a === 'detenida' || a === 'almacenamiento') return
        if (a === 'ok') {
          inciertos = 0; malformadas = 0; esperado = 0
          if (explicito) {
            const d = await leer(gen)
            fijar(d.ok && d.sesion.detenida ? 'detenida' : 'inactivo', d.ok && d.sesion.detenida ? { causa: d.sesion.detenida.causa, persistida: true, ultimoReintento: 'recibo' } : {})
            return
          }
          continue
        }
        r = { clase: 'incierta', motivo: 'recibo-malformado', malformada: true, retryAfterMs: null } // 'malformado'
      }
      if (CLASES_DE_PARADA.has(r.clase)) { await pararPorTransporte(gen, r, primera.cmdId); return }
      if (r.clase === 'configuracion') { paradaEnMemoria = true; fijar('detenida', { causa: r.motivo, persistida: false, protegidaTrasRecarga: false, enviado: false }); return }

      // incierta / sin-escritura / cancelada inesperada: se conserva la incertidumbre y se reintenta el MISMO sobre
      if (r.malformada) {
        malformadas += 1
        if (malformadas >= politica.respuestasMalformadasSeguidas) { fijar('respuestas-malformadas', { cmdId: primera.cmdId, seguidas: malformadas, persistida: false }); return }
      } else malformadas = 0
      inciertos += 1
      const retry = Number.isFinite(r.retryAfterMs) ? r.retryAfterMs : null
      if (retry !== null) noAntesDe = monoAhora() + retry // se respeta aunque se agoten los intentos o sea un reintento explícito
      if (explicito) { fijar('detenida', { causa: 'transporte', persistida: true, ultimoReintento: r.motivo ?? r.clase }); return }
      if (inciertos >= politica.intentosInciertosPorCorrida) { fijar('reintentos-agotados', { cmdId: primera.cmdId, intentos: inciertos }); return }
      const nominal = politica.esperasMs[Math.min(inciertos - 1, politica.esperasMs.length - 1)]
      const espera = Math.max(0, Math.round(nominal * (1 + politica.jitter * (2 * azar() - 1))))
      const demora = retry === null ? espera : Math.max(retry, espera)
      if (demora > politica.presupuestoEsperaMs - esperado) {
        if (retry !== null && retry > politica.presupuestoEsperaMs - esperado) { fijar('suspendida-retry-after', { cmdId: primera.cmdId, noAntesDe, faltaMs: retry }); return }
        fijar('reintentos-agotados', { cmdId: primera.cmdId, intentos: inciertos })
        return
      }
      fijar('esperando-reintento', { cmdId: primera.cmdId, intentos: inciertos, esperaMs: demora, motivo: r.motivo ?? r.clase })
      if (!(await dormir(demora))) return
      esperado += demora
    }
  }

  function arrancar(opciones = {}) {
    if (cerrado || perdida || paradaEnMemoria || bucle) return bucle ?? Promise.resolve()
    const gen = generacion
    bucle = (async () => {
      try { await corrida(gen, opciones) } catch { if (vigente(gen)) fijar('detenida', { causa: 'error-interno', persistida: false }) } finally { bucle = null }
    })()
    return bucle
  }

  // -------------------------------------------------------------------------
  // Pérdida de propiedad y conectividad (inyectadas)
  // -------------------------------------------------------------------------
  function perder() {
    if (perdida || cerrado) return
    perdida = true
    invalidar()
    fijar('propiedad-perdida', { persistida: true })
  }
  try { const q = propiedad.alPerder?.(perder); if (typeof q === 'function') quitar.push(q) } catch { /* la propiedad se sigue comprobando en cada paso */ }
  try { const q = conexion.alCambiar?.((enLinea) => { if (enLinea === true || enLineaAhora()) despertar() }); if (typeof q === 'function') quitar.push(q) } catch { /* sin evento */ }

  // -------------------------------------------------------------------------
  // Interfaz
  // -------------------------------------------------------------------------
  /** Un aviso externo (reconexión, visibilidad, reapertura, remuestreo del reloj): empieza una corrida nueva si no hay una activa. */
  function despertar() { if (!cerrado && !perdida && !paradaEnMemoria && !bucle) arrancar() }

  /** Reintento pedido: reinicia los contadores y NUNCA antes de un Retry-After vigente. */
  function reintentarAhora() { despertar(); return bucle ?? Promise.resolve() }

  /**
   * Vía EXPLÍCITA para obtener el recibo de la orden señalada por una parada de transporte (reenvía el sobre original, una sola
   * vez). Exige la confirmación de la persona. No borra la parada. La reanudación general sigue sin existir.
   */
  async function reintentarConConfirmacion({ confirmadoPorOperador } = {}) {
    if (confirmadoPorOperador !== true) return { ok: false, motivo: 'falta-confirmacion' }
    if (cerrado || perdida || paradaEnMemoria) return { ok: false, motivo: 'no-disponible' }
    if (bucle) return { ok: false, motivo: 'ocupado' }
    await arrancar({ explicito: true })
    return { ok: true, estado: copia(estado) }
  }

  /**
   * Verificación explícita de la instantánea (solo en reposo y sin órdenes «enviando»). Una atribución que no cupo se informa
   * como «no sincronizada»: NUNCA como sincronización lograda.
   */
  async function verificarAhora() {
    if (cerrado || perdida || paradaEnMemoria) return { ok: false, motivo: 'no-disponible' }
    if (bucle) return { ok: false, motivo: 'ocupado' }
    const gen = generacion
    if (!enLineaAhora()) return { ok: false, motivo: 'sin-internet' }
    const l = await leer(gen)
    if (!l.ok) return { ok: false, motivo: l.motivo }
    if (l.entradas.some((e) => e.estado === 'enviando')) return { ok: false, motivo: 'entrada-en-vuelo' }
    controlador = new AbortController()
    enVuelo = true
    let est
    try { est = await cliente.leerEstado({ signal: controlador.signal }) } catch { est = { clase: 'incierta' } }
    enVuelo = false
    controlador = null
    if (!vigente(gen)) return { ok: false, motivo: 'fuera-de-generacion' }
    if (est.clase === 'sin-credencial') { await pararPorTransporte(gen, { clase: 'no-autorizado', http: 401 }, null); return { ok: false, motivo: 'sin-credencial', sincronizada: false } }
    if (est.clase !== 'ok') return { ok: false, motivo: est.clase === 'demasiado-grande' ? 'estado-demasiado-grande' : 'lectura-no-disponible', detalle: est.clase, sincronizada: false }
    const v = await conRevision(gen, (revision) => verificarInstantanea(almacen, { id, revision, cuerpoEstado: est.cuerpo, ctx: contexto() }))
    if (v.motivo === 'fuera-de-generacion') return { ok: false, motivo: 'fuera-de-generacion' }
    const resultado = traducirVerificacion(v)
    estado = { ...estado, ultimaVerificacion: resultado }
    if (v.motivo === 'divergencia') fijar('detenida', { causa: 'divergencia', persistida: true, ultimaVerificacion: resultado })
    else publicar()
    return resultado
  }

  async function cerrarEmisor() {
    if (cerrado) return { cerrado: true, yaCerrado: true }
    cerrado = true
    const habiaPeticion = invalidar()
    for (const q of quitar.splice(0)) { try { q() } catch { /* nada */ } }
    if (bucle) { try { await bucle } catch { /* nada */ } }
    await Promise.allSettled([...operaciones])
    fijar('cerrado')
    oyentes.clear()
    // Abortar la petición NO cancela un commit del servidor: si había una en vuelo, su resultado queda DESCONOCIDO.
    return { cerrado: true, peticionAbortada: habiaPeticion, resultadoDelServidorDesconocido: habiaPeticion, operacionesPendientes: operaciones.size }
  }

  return Object.freeze({
    estado: () => copia(estado),
    suscribir(f) { oyentes.add(f); return () => oyentes.delete(f) },
    despertar,
    reintentarAhora,
    reintentarConConfirmacion,
    verificarAhora,
    cerrar: cerrarEmisor,
    /** Para pruebas y para quien orquesta: se resuelve cuando no hay corrida activa. */
    reposo: async () => { while (bucle) { try { await bucle } catch { /* nada */ } } },
  })
}

/** Traduce el resultado de la verificación del núcleo; `atribucion-no-aplicada` es un fracaso visible, no una sincronización. */
export function traducirVerificacion(v) {
  if (v?.ok === true) return { ok: true, sincronizada: true, atribucionRefrescada: v.atribucionRefrescada ?? null }
  if (v?.motivo === 'atribucion-no-aplicada') {
    return { ok: false, motivo: 'atribucion-no-aplicada', sincronizada: false, atribucionAdoptada: false, causa: v.causa ?? null, limite: v.limite ?? null }
  }
  if (v?.motivo === 'divergencia') return { ok: false, motivo: 'divergencia', sincronizada: false, causa: v.causa ?? null }
  return { ok: false, motivo: v?.motivo ?? 'desconocido', sincronizada: false, ...(v?.detalle !== undefined ? { detalle: v.detalle } : {}) }
}
