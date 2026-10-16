import { USA_TIEMPO_TRANSCURRIDO, ordenParadaAutomatica } from '../motor'

// ---------------------------------------------------------------------------
// Estimación de la hora de acción del teléfono (S1a). PURA: los relojes llegan como lecturas inyectadas
// ({ paredMs, monoMs, sesionId }); aquí no se lee `Date`, `performance` ni la red. El muestreo con el servidor y la
// programación del envío son del controlador (S1b).
//
// PARÁMETROS PROVISIONALES. Son diagnósticos y compuertas del teléfono, NO una garantía de que el servidor acepte una hora:
// el servidor decide con su propia hora de recepción y con el cursor de reloj que ya tiene.
//   - RTT máximo de una muestra: 1.000 ms;
//   - deriva supuesta: 200 ppm (SIN MEDIR en teléfonos reales);
//   - presupuesto de incertidumbre U = RTT/2 + deriva × tiempo desde la muestra ≤ 1.000 ms;
//   - remuestreo debido cada 5 min; salto pared/monótono: 1.000 ms; tolerancia de retroceso: 500 ms como máximo.
//
// Dos clases de órdenes (según el motor, sin cambiarlo):
//   - TIEMPO DE CONFIANZA (arrancar, detener, parada automática, cerrar con el reloj corriendo): el servidor rechaza de forma
//     definitiva una hora fuera de límites. Solo se crean con una estimación CONFIABLE: ancla monótona de esta sesión de
//     página, incertidumbre dentro del presupuesto y sin salto. Su marca de agua es el cursor y el ancla del ESTADO del motor
//     (`cursorReloj`, `relojDesde`), que solo mueven estas órdenes.
//   - TIEMPO INFORMATIVO (puntos, faltas, correcciones, siguiente periodo, corregir reloj detenido…): el motor solo lo registra
//     como advertencia. Se usa la mejor estimación que haya o la hora cruda, identificada como tal, y NUNCA entra en la marca de
//     agua del reloj: una hora cruda adelantada no puede envenenar una resincronización posterior.
// Los sobres ya guardados no se reescriben jamás: una nueva estimación solo afecta a las órdenes futuras.
// ---------------------------------------------------------------------------

export const PARAMETROS_RELOJ = Object.freeze({
  rttMaxMs: 1000,
  derivaPpm: 200, // SUPUESTO: no está medido en teléfonos reales
  presupuestoMs: 1000,
  remuestreoMs: 5 * 60 * 1000,
  saltoMs: 1000,
  retrocesoMaxMs: 500,
})

const entero = (v) => Number.isSafeInteger(v)
const esLectura = (l) => l && entero(l.paredMs) && entero(l.monoMs) && typeof l.sesionId === 'string' && l.sesionId !== ''

/** Estado del reloj: serializable (JSON). `ancla` es la última muestra aceptada. */
export const crearRelojTelefono = () => ({ v: 1, ancla: null })

/**
 * Incorpora una muestra del servidor. `servidorAhoraMs` es la hora del servidor al contestar y `rttMs` el viaje de ida y
 * vuelta medido por quien la tomó; `lectura` es la de los relojes del teléfono AL RECIBIR la respuesta. Una muestra con RTT
 * mayor que el máximo se descarta y el estado anterior se conserva.
 */
export function incorporarMuestra(reloj, { servidorAhoraMs, rttMs }, lectura) {
  if (!entero(servidorAhoraMs) || !Number.isFinite(rttMs) || rttMs < 0 || !esLectura(lectura)) return { ok: false, motivo: 'muestra-invalida', reloj }
  if (rttMs > PARAMETROS_RELOJ.rttMaxMs) return { ok: false, motivo: 'rtt-excesivo', reloj }
  return {
    ok: true,
    reloj: {
      ...reloj,
      ancla: {
        servidorMs: Math.round(servidorAhoraMs + rttMs / 2),
        rttMs,
        paredMs: lectura.paredMs,
        monoMs: lectura.monoMs,
        sesionId: lectura.sesionId,
      },
    },
  }
}

/**
 * Estima la hora del servidor ahora.
 *   nivel 'confiable'      ancla de ESTA sesión de página, sin salto, con incertidumbre dentro del presupuesto;
 *   nivel 'degradado'      hay una estimación pero no se puede confiar en ella (recarga: se perdió el ancla monótona; salto
 *                          entre reloj de pared y monótono; incertidumbre excedida);
 *   nivel 'sin-estimacion' nunca hubo muestra.
 * Un salto de pared (se movió el reloj del teléfono) y un reloj monótono que se atrasó durante el sueño se ven igual: la
 * diferencia entre ambos. No se puede saber cuál de los dos se equivocó, así que se pierde la confianza hasta una nueva muestra.
 */
export function estimar(reloj, lectura) {
  if (!esLectura(lectura)) throw new Error('lectura inválida')
  const base = { accionTsCrudo: lectura.paredMs, estimadoMs: null, incertidumbreMs: null, discontinuidad: null }
  const a = reloj?.ancla ?? null
  if (!a) return { ...base, nivel: 'sin-estimacion', motivo: 'sin-muestra', remuestreoDebido: true }

  if (a.sesionId !== lectura.sesionId) {
    // Recarga: la lectura monótona del ancla ya no sirve. Solo queda el desfase guardado (pared → servidor), que arrastra
    // cualquier salto de pared ocurrido mientras tanto y por eso nunca es de confianza.
    return { ...base, nivel: 'degradado', motivo: 'ancla-perdida', estimadoMs: lectura.paredMs + (a.servidorMs - a.paredMs), remuestreoDebido: true }
  }
  const mono = lectura.monoMs - a.monoMs
  const pared = lectura.paredMs - a.paredMs
  if (mono < 0) return { ...base, nivel: 'degradado', motivo: 'mono-retrocede', remuestreoDebido: true }

  const estimadoMs = a.servidorMs + mono
  const incertidumbreMs = Math.ceil(a.rttMs / 2 + (mono * PARAMETROS_RELOJ.derivaPpm) / 1e6)
  const salto = pared - mono
  if (Math.abs(salto) > PARAMETROS_RELOJ.saltoMs) {
    return {
      ...base,
      nivel: 'degradado',
      motivo: 'salto-de-reloj',
      estimadoMs,
      incertidumbreMs,
      discontinuidad: { saltoMs: Math.round(salto), causa: salto > 0 ? 'pared-adelanta-al-monotono' : 'pared-atrasa-al-monotono' },
      remuestreoDebido: true,
    }
  }
  const dentro = incertidumbreMs <= PARAMETROS_RELOJ.presupuestoMs
  return {
    ...base,
    nivel: dentro ? 'confiable' : 'degradado',
    motivo: dentro ? null : 'incertidumbre-excedida',
    estimadoMs,
    incertidumbreMs,
    remuestreoDebido: !dentro || mono >= PARAMETROS_RELOJ.remuestreoMs,
  }
}

const tiempoDe = (accionTs, crudo, discontinuidad = null) => ({ accionTs, accionTsCrudo: crudo, ajusteTsMs: accionTs - crudo, discontinuidad })

/**
 * Tiempo INFORMATIVO para órdenes que el motor no valida por hora. Siempre existe, y dice de dónde sale:
 *   'estimado' (confiable) · 'estimado-degradado' (hay estimación sin confianza; se anota la discontinuidad si se vio una) ·
 *   'crudo' (sin muestra alguna: la hora del teléfono tal cual, sin ajuste).
 */
export function tiempoInformativo(est) {
  if (est.estimadoMs === null) return { tiempo: tiempoDe(est.accionTsCrudo, est.accionTsCrudo), fuente: 'crudo' }
  return {
    tiempo: tiempoDe(est.estimadoMs, est.accionTsCrudo, est.discontinuidad),
    fuente: est.nivel === 'confiable' ? 'estimado' : 'estimado-degradado',
  }
}

/**
 * La marca de agua de tiempo de confianza del ESTADO: la hora mínima que el servidor aceptará para una orden con tiempo de
 * confianza. Sale del cursor y del ancla del reloj en el estado del motor, que solo mueven estas órdenes (no los puntos).
 */
export function marcaDeAguaDeReloj(estado) {
  const cursor = estado.cursorReloj ?? null
  const ancla = estado.partido.relojEstado === 'corriendo' ? (estado.partido.relojDesde ?? null) : null
  if (cursor === null && ancla === null) return null
  return Math.max(cursor ?? -Infinity, ancla ?? -Infinity)
}

/**
 * Tiempo para una orden CON tiempo de confianza. Si no hay estimación confiable, o si la estimación quedó por detrás de la
 * marca de agua más de lo tolerado, NO se crea la orden y se pide resincronizar: no se sostiene un ajuste hacia atrás que
 * acabe en una hora que el servidor rechazaría. Un retroceso de hasta 500 ms se corrige subiendo la hora a la marca de agua.
 */
export function tiempoDeConfianza(estadoProvisional, est) {
  if (est.nivel !== 'confiable') {
    return { ok: false, motivo: 'sin-tiempo-confiable', detalle: est.motivo, requiereResincronizacion: true }
  }
  const marca = marcaDeAguaDeReloj(estadoProvisional)
  let ts = est.estimadoMs
  if (marca !== null && ts < marca) {
    const faltaMs = marca - ts
    if (faltaMs > PARAMETROS_RELOJ.retrocesoMaxMs) {
      return { ok: false, motivo: 'estimacion-detras-del-reloj', faltaMs, requiereResincronizacion: true }
    }
    ts = marca
  }
  return { ok: true, tiempo: tiempoDe(ts, est.accionTsCrudo), ajustadoPorRetroceso: ts !== est.estimadoMs }
}

/** ¿Esta orden necesita tiempo de confianza? Según las reglas del motor, sin cambiarlas. */
export function requiereTiempoDeConfianza(estado, tipo) {
  if (tipo === 'cerrar-partido') return estado.partido.relojEstado === 'corriendo'
  return USA_TIEMPO_TRANSCURRIDO.has(tipo)
}

/**
 * Arma la orden con el tiempo que le corresponde. Los puntos, las faltas, el cambio de periodo y la corrección de un reloj
 * detenido NO dependen de tiempo de confianza; detener un reloj en marcha SÍ (y sin él queda bloqueado).
 * { ok: true, orden, fuente } | { ok: false, motivo, … }
 */
export function crearOrden({ estadoProvisional, tipo, datos = {}, cmdId, estimacion, preparacionVersion }) {
  if (requiereTiempoDeConfianza(estadoProvisional, tipo)) {
    const r = tiempoDeConfianza(estadoProvisional, estimacion)
    if (!r.ok) return r
    return { ok: true, orden: { cmdId, tipo, datos, tiempo: r.tiempo }, fuente: 'confianza', ajustadoPorRetroceso: r.ajustadoPorRetroceso }
  }
  const { tiempo, fuente } = tiempoInformativo(estimacion)
  const orden = { cmdId, tipo, datos, tiempo }
  if (preparacionVersion !== undefined) orden.preparacionVersion = preparacionVersion
  return { ok: true, orden, fuente }
}

/**
 * ¿Hay que detener el reloj por tiempo cumplido? El plazo es el CALCULADO `relojDesde + relojRestante` (no una lectura del
 * reloj). Solo se crea la orden cuando la estimación es utilizable y alcanzó el plazo; si no se puede establecer si venció,
 * NO se inventa. La hora de acción de la orden es el plazo derivado (exacto, sin depender del reloj del dispositivo); la
 * hora cruda y su diferencia quedan visibles como `ajusteTsMs`. El cmdId fijo `auto:{partido}:{corridaSeq}` evita duplicados.
 *   { estado: 'no-aplica' | 'incierta' | 'no-vencida' | 'vencida', vencimientoMs?, faltaMs?, orden? }
 */
export function evaluarParadaAutomatica(estadoProvisional, est) {
  const p = estadoProvisional.partido
  if (p.relojEstado !== 'corriendo' || estadoProvisional.corridaSeq === null || !entero(p.relojDesde) || !entero(p.relojRestante)) {
    return { estado: 'no-aplica' }
  }
  const vencimientoMs = p.relojDesde + p.relojRestante
  if (est.nivel !== 'confiable') return { estado: 'incierta', vencimientoMs, motivo: est.motivo }
  if (est.estimadoMs < vencimientoMs) return { estado: 'no-vencida', vencimientoMs, faltaMs: vencimientoMs - est.estimadoMs }
  const orden = ordenParadaAutomatica(estadoProvisional, tiempoDe(vencimientoMs, est.accionTsCrudo, est.discontinuidad))
  if (!orden) return { estado: 'no-aplica' }
  return { estado: 'vencida', vencimientoMs, orden }
}
