// ---------------------------------------------------------------------------
// ADAPTADOR de red de la sesión de puntuación del teléfono (REPORT_124). Es el ÚNICO módulo de control que habla con la red.
// No toca el almacén, no decide qué se envía ni cuándo, no lee relojes (el tiempo monótono, los temporizadores y `fetch` se
// inyectan) y NUNCA lanza: cada método devuelve un resultado clasificado.
//
// Reglas de toda petición:
//   - URL relativa del mismo origen, con los identificadores validados contra [A-Za-z0-9_-]{1,64} ANTES de construirla;
//   - credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer';
//   - el token llega en memoria (cadena o función) y solo viaja en la cabecera Authorization de las 3 rutas protegidas.
//     No se registra, no va en una URL, no se copia a ningún objeto devuelto y no aparece en ningún mensaje de error;
//   - una sola AbortController cubre cabeceras y cuerpo; el tiempo se acota; los bytes del cuerpo se cuentan MIENTRAS se leen
//     (y el flujo se cancela al pasarse); el texto se decodifica como UTF-8 estricto y debe ser application/json.
//     Abortar un `fetch` NO cancela lo que el servidor ya haya confirmado: solo deja de esperar la respuesta.
//
// Un cuerpo que no sea EXACTAMENTE una de las formas conocidas nunca fabrica un recibo ni un rechazo: queda «incierta» con
// `malformada: true` (HTML, JSON ilegible, claves de más o de menos, demasiado grande, estado HTTP inesperado…).
// ---------------------------------------------------------------------------

export const RE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Límites de REPORT_119, validados contra los endpoints reales en backend/test/sesion-emisor-contrato.check.js. */
export const LIMITES_API = Object.freeze({
  comando: Object.freeze({ tiempoMs: 20_000, bytes: 64 * 1024 }),
  muestra: Object.freeze({ tiempoMs: 5_000, bytes: 16 * 1024 }),
  preparacion: Object.freeze({ tiempoMs: 15_000, bytes: 256 * 1024 }),
  estado: Object.freeze({ tiempoMs: 30_000, bytes: Math.round(1.1 * 1024 * 1024) }),
})

/** Espera máxima aceptada de un Retry-After (un día); más allá se considera inválido (no se «acorta»). */
export const RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000

const MOTIVOS_SIN_ESCRITURA = ['interno', 'contencion', 'reversion-verificada', 'asercion-vencida']
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const mismasClaves = (o, claves) => {
  const k = Object.keys(o)
  return k.length === claves.length && claves.every((c) => Object.prototype.hasOwnProperty.call(o, c))
}
const RE_JSON = /^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i

/** Retry-After válido (segundos enteros o fecha HTTP) → milisegundos de espera, o null. No se acorta ni se limita hacia abajo. */
export function leerRetryAfter(valor, ahoraParedMs) {
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  if (/^\d{1,9}$/.test(t)) { const ms = Number(t) * 1000; return ms <= RETRY_AFTER_MAX_MS ? ms : null }
  if (t === '' || !/[A-Za-z]{3},/.test(t) || !Number.isSafeInteger(ahoraParedMs)) return null
  const f = Date.parse(t)
  if (!Number.isFinite(f)) return null
  const ms = Math.max(0, f - ahoraParedMs)
  return ms <= RETRY_AFTER_MAX_MS ? ms : null
}

/**
 * crearClienteSesion({ ligaId, partidoId, token, fetchImpl?, setTimeoutImpl?, clearTimeoutImpl?, monoAhora?, paredAhora?, limites? })
 *   token: cadena o función () => cadena (se lee en cada llamada protegida).
 * Todos los métodos aceptan { signal } (cancelación del llamador) y devuelven un objeto con `clase`.
 */
export function crearClienteSesion({
  ligaId, partidoId, token, fetchImpl = (...a) => globalThis.fetch(...a), setTimeoutImpl = (...a) => globalThis.setTimeout(...a),
  clearTimeoutImpl = (...a) => globalThis.clearTimeout(...a), monoAhora = () => globalThis.performance.now(),
  paredAhora = () => Date.now(), limites = LIMITES_API,
} = {}) {
  const idsValidos = typeof ligaId === 'string' && typeof partidoId === 'string' && RE_ID.test(ligaId) && RE_ID.test(partidoId)
  const base = idsValidos ? `/v1/ligas/${ligaId}/partidos/${partidoId}` : null
  const tokenAhora = () => {
    try { const t = typeof token === 'function' ? token() : token; return typeof t === 'string' && t.length > 0 ? t : null } catch { return null }
  }

  /** Una petición acotada. Devuelve { fallo } o { status, headers, texto, json (o jsonError) }. */
  async function pedir({ metodo, ruta, cuerpo, protegida, limite, signal }) {
    if (base === null) return { fallo: { clase: 'configuracion', motivo: 'id-invalido' } }
    const cabeceras = { accept: 'application/json' }
    if (protegida) {
      const t = tokenAhora()
      if (t === null) return { fallo: { clase: 'configuracion', motivo: 'sin-token' } }
      cabeceras.authorization = `Bearer ${t}`
    }
    if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json'
    if (signal?.aborted) return { fallo: { clase: 'cancelada' } }

    const ac = new AbortController()
    let causa = null
    const abortar = (c) => { if (causa === null) { causa = c; try { ac.abort() } catch { /* ya abortada */ } } }
    const alExterno = () => abortar('cancelada')
    signal?.addEventListener?.('abort', alExterno, { once: true })
    const temporizador = setTimeoutImpl(() => abortar('timeout'), limite.tiempoMs)
    // Aunque un `fetch` (o su flujo) no atienda la señal, la espera NUNCA pasa del tiempo ni de la cancelación.
    const alAbortar = new Promise((_, rechazar) => {
      if (ac.signal.aborted) rechazar(new Error('abortada'))
      else ac.signal.addEventListener('abort', () => rechazar(new Error('abortada')), { once: true })
    })
    alAbortar.catch(() => {})
    const conAborto = (p) => Promise.race([p, alAbortar])
    const limpiar = () => { try { clearTimeoutImpl(temporizador) } catch { /* nada */ } signal?.removeEventListener?.('abort', alExterno) }
    try {
      let resp
      try {
        resp = await conAborto(Promise.resolve(fetchImpl(`${base}${ruta}`, {
          method: metodo,
          headers: cabeceras,
          body: cuerpo,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: ac.signal,
        })))
      } catch {
        // El mensaje del error se descarta a propósito: podría contener la URL o cabeceras.
        return { fallo: causa === 'cancelada' ? { clase: 'cancelada' } : { clase: 'incierta', motivo: causa === 'timeout' ? 'timeout' : 'red', http: null, malformada: false, retryAfterMs: null } }
      }
      const status = Number(resp?.status)
      const retryAfterMs = leerRetryAfter(resp?.headers?.get?.('retry-after') ?? null, paredAhora())
      const cancelarCuerpo = async () => { try { await resp?.body?.cancel?.() } catch { /* nada */ } }
      const tipo = resp?.headers?.get?.('content-type') ?? ''
      if (!Number.isInteger(status) || status < 100 || status > 599 || (resp?.type === 'opaqueredirect')) {
        await cancelarCuerpo()
        return { fallo: { clase: 'incierta', motivo: 'respuesta-inesperada', http: null, malformada: true, retryAfterMs: null } }
      }
      const declarado = resp.headers?.get?.('content-length')
      if (declarado !== null && declarado !== undefined && /^\d+$/.test(declarado) && Number(declarado) > limite.bytes) {
        await cancelarCuerpo()
        return { status, retryAfterMs, excedido: true }
      }
      // Cuerpo: contado mientras se lee; el flujo se cancela al pasarse.
      const trozos = []
      let total = 0
      let excedido = false
      try {
        const lector = resp.body?.getReader?.()
        if (lector) {
          for (;;) {
            const { done, value } = await conAborto(lector.read())
            if (done) break
            total += value.byteLength
            if (total > limite.bytes) { excedido = true; try { await lector.cancel() } catch { /* nada */ } break }
            trozos.push(value)
          }
        }
      } catch {
        return { fallo: causa === 'cancelada' ? { clase: 'cancelada' } : { clase: 'incierta', motivo: causa === 'timeout' ? 'timeout' : 'red', http: status, malformada: false, retryAfterMs: null } }
      }
      if (excedido) return { status, retryAfterMs, excedido: true }
      if (!RE_JSON.test(tipo)) return { status, retryAfterMs, noJson: true }
      let texto
      try {
        const junto = new Uint8Array(total)
        let o = 0
        for (const t of trozos) { junto.set(t, o); o += t.byteLength }
        texto = new TextDecoder('utf-8', { fatal: true }).decode(junto)
      } catch { return { status, retryAfterMs, noJson: true } }
      let json
      try { json = JSON.parse(texto) } catch { return { status, retryAfterMs, noJson: true } }
      return { status, retryAfterMs, json }
    } finally {
      limpiar()
    }
  }

  const malformada = (r, http = r.status ?? null) => ({ clase: 'incierta', motivo: r.excedido ? 'demasiado-grande' : r.noJson ? 'no-json' : 'respuesta-inesperada', http, malformada: true, retryAfterMs: r.retryAfterMs ?? null })

  // -------------------------------------------------------------------------
  // POST …/comandos
  // -------------------------------------------------------------------------
  function clasificarComando(r) {
    if (r.fallo) return r.fallo
    const { status, json } = r
    const incierta = (motivo) => ({ clase: 'incierta', motivo, http: status, malformada: false, retryAfterMs: r.retryAfterMs })
    if (status === 429) return incierta('429')
    if (r.excedido || r.noJson || json === undefined) {
      // 5xx de infraestructura: incierto, no es un cuerpo «malformado» de la API.
      if (status >= 500) return incierta('5xx')
      return malformada(r)
    }
    if (status === 200) {
      if (!esObjeto(json) || !mismasClaves(json, ['resultado', 'recibo', 'publicacion'])) return malformada(r)
      if (!['aceptado', 'recibo-existente', 'rechazado'].includes(json.resultado) || !esObjeto(json.recibo)) return malformada(r)
      const decidido = json.recibo.resultado
      const coherente = json.resultado === 'recibo-existente' ? (decidido === 'aceptado' || decidido === 'rechazado') : decidido === json.resultado
      if (!coherente) return malformada(r)
      return { clase: 'recibo', http: 200, resultado: json.resultado, recibo: json.recibo, repetido: json.resultado === 'recibo-existente' }
    }
    if (!esObjeto(json)) return status >= 500 ? incierta('5xx') : malformada(r)
    if (status === 401) return mismasClaves(json, ['error']) && json.error === 'no-autorizado' ? { clase: 'no-autorizado', http: 401 } : malformada(r)
    if (status === 422) {
      return mismasClaves(json, ['error', 'errores']) && json.error === 'sobre-invalido' && Array.isArray(json.errores)
        ? { clase: 'sobre-invalido', http: 422 } : malformada(r)
    }
    if (status === 409) {
      const t = json.tipo
      const ok = (t === 'bloqueado' && mismasClaves(json, ['tipo']))
        || (t === 'hueco' && mismasClaves(json, ['tipo', 'esperado']) && Number.isSafeInteger(json.esperado))
        || (t === 'secuencia-ocupada' && mismasClaves(json, ['tipo', 'ocupadaPor']) && (json.ocupadaPor === null || typeof json.ocupadaPor === 'string'))
        || (t === 'conflicto-contenido' && mismasClaves(json, ['tipo', 'reciboOriginal']) && esObjeto(json.reciboOriginal))
      return ok ? { clase: 'conflicto', http: 409, subtipo: t } : malformada(r)
    }
    const PROTOCOLO = { 400: ['juego-distinto', 'json-invalido'], 404: ['no-encontrado'], 405: ['metodo-no-permitido'], 413: ['cuerpo-demasiado-grande'] }
    if (PROTOCOLO[status]) {
      return mismasClaves(json, ['error']) && PROTOCOLO[status].includes(json.error) ? { clase: 'protocolo', http: status, subtipo: json.error } : malformada(r)
    }
    if (status === 503 || status === 500) {
      if (mismasClaves(json, ['tipo', 'reintento']) && json.tipo === 'resultado-desconocido' && json.reintento === 'mismo-sobre') return incierta('resultado-desconocido')
      if (mismasClaves(json, ['tipo', 'esteIntento', 'alcance', 'motivo', 'reintento']) && json.tipo === 'fallo-sin-escritura' && json.esteIntento === 'sin-escritura'
        && json.alcance === 'solo-este-intento' && json.reintento === 'mismo-sobre' && MOTIVOS_SIN_ESCRITURA.includes(json.motivo)) {
        return { clase: 'sin-escritura', http: status, motivo: json.motivo, retryAfterMs: r.retryAfterMs }
      }
      return incierta('5xx')
    }
    return status >= 500 ? incierta('5xx') : malformada(r)
  }

  /** Envía el TEXTO exacto guardado (`cuerpoJson`); nunca lo reconstruye. */
  async function enviarComando(cuerpoJson, { signal } = {}) {
    try {
      if (typeof cuerpoJson !== 'string' || cuerpoJson === '') return { clase: 'configuracion', motivo: 'sobre-ausente' }
      return clasificarComando(await pedir({ metodo: 'POST', ruta: '/comandos', cuerpo: cuerpoJson, protegida: true, limite: limites.comando, signal }))
    } catch {
      return { clase: 'incierta', motivo: 'error-interno', http: null, malformada: false, retryAfterMs: null }
    }
  }

  // -------------------------------------------------------------------------
  // Lecturas (estado, preparación, muestra pública)
  // -------------------------------------------------------------------------
  function clasificarLectura(r, { valida, noDisponible = null }) {
    if (r.fallo) return r.fallo
    const { status, json } = r
    if (status === 200) {
      if (r.excedido || r.noJson || !esObjeto(json) || !valida(json)) return malformada(r)
      return { clase: 'ok', http: 200, cuerpo: json }
    }
    if (status === 401) return esObjeto(json) && mismasClaves(json, ['error']) && json.error === 'no-autorizado' ? { clase: 'sin-credencial', http: 401 } : malformada(r)
    if (status === 507 && esObjeto(json) && mismasClaves(json, ['error']) && json.error === 'estado-demasiado-grande') return { clase: 'demasiado-grande', http: 507 }
    if (noDisponible && status === 503 && esObjeto(json) && mismasClaves(json, ['error']) && json.error === noDisponible) return { clase: 'no-disponible', http: 503 }
    if (status === 404 && esObjeto(json) && mismasClaves(json, ['error']) && json.error === 'no-encontrado') return { clase: 'no-encontrado', http: 404 }
    return status >= 500 || status === 429
      ? { clase: 'incierta', motivo: status === 429 ? '429' : '5xx', http: status, malformada: false, retryAfterMs: r.retryAfterMs }
      : malformada(r)
  }

  const leerEstado = async ({ signal } = {}) => {
    try {
      return clasificarLectura(await pedir({ metodo: 'GET', ruta: '/estado', protegida: true, limite: limites.estado, signal }), { valida: (j) => j.version === 1 })
    } catch { return { clase: 'incierta', motivo: 'error-interno', http: null, malformada: false, retryAfterMs: null } }
  }
  const leerPreparacion = async ({ signal } = {}) => {
    try {
      return clasificarLectura(await pedir({ metodo: 'GET', ruta: '/preparacion', protegida: true, limite: limites.preparacion, signal }), {
        valida: (j) => mismasClaves(j, ['preparacion', 'etiquetas', 'rev', 'ultimoClientSeq']) && esObjeto(j.preparacion),
        noDisponible: 'preparacion-no-disponible',
      })
    } catch { return { clase: 'incierta', motivo: 'error-interno', http: null, malformada: false, retryAfterMs: null } }
  }
  /** Lectura pública pequeña. Devuelve la hora del servidor y el viaje de ida y vuelta (reloj monótono inyectado); NO estima nada. */
  const tomarMuestra = async ({ signal } = {}) => {
    try {
      const antes = monoAhora()
      const r = clasificarLectura(await pedir({ metodo: 'GET', ruta: '', protegida: false, limite: limites.muestra, signal }), { valida: (j) => Number.isSafeInteger(j.servidorAhoraMs) })
      const despues = monoAhora()
      if (r.clase !== 'ok') return r
      return { clase: 'ok', http: 200, servidorAhoraMs: r.cuerpo.servidorAhoraMs, rttMs: Math.max(0, despues - antes) }
    } catch { return { clase: 'incierta', motivo: 'error-interno', http: null, malformada: false, retryAfterMs: null } }
  }

  return Object.freeze({ enviarComando, leerEstado, leerPreparacion, tomarMuestra })
}
