import { PUNTOS_POR_DEPORTE, marcaDePeriodo, periodoEnPosicion, periodoVisible } from '../marcador-calculo'
import { PERIODOS, corriendo, duracionMs, restanteMs } from '../reloj-calculo'
import { atribucionIntegra } from './atribucion'
import { camposDeReloj } from './estado'
import {
  TIPOS, TOLERANCIA_FUTURO_MS, USA_TIEMPO_TRANSCURRIDO,
} from './tipos'

// ---------------------------------------------------------------------------
// Las reglas de negocio del marcador y del reloj, sin almacenamiento.
//
// Cada orden se decide con (estado, sobre, contexto) y produce efectos
// descritos como datos; nada se escribe aquí. La hora y los identificadores
// llegan de fuera: la hora de acción viene en el sobre y los ids se derivan de
// cmdId, así que repetir un registro desde la misma base da el mismo resultado.
//
// contexto = { recibidoEn, actorId, tolerancia? }
//   recibidoEn  Cuándo lo recibió quien decide. Solo sirve para acotar horas
//               de acción imposibles (en el futuro); nunca entra en una cuenta.
//   actorId     Identidad que el adaptador ya autorizó. El motor no autentica.
//
// Son las mismas reglas que hoy ejecutan marcador.js y reloj.js dentro de
// transacciones de Dexie; esas funciones no se tocan.
// ---------------------------------------------------------------------------

const iguales = (a, b) => (a ?? null) === (b ?? null)
const ok = (efectos, enforzado = false) => ({ ok: true, efectos, enforzado })
const no = (motivo, extra = {}) => ({ ok: false, motivo, ...extra })

const efectivo = (estado, ts) => restanteMs(estado.partido, estado.config, ts)
const periodoDe = (estado) => periodoVisible(estado.eventos, estado.config.deporte)
const marcaDe = (estado) => marcaDePeriodo(estado.eventos)
const sigSeqEvento = (estado) => estado.eventos.reduce((m, e) => Math.max(m, e.seq), 0) + 1
const iso = (ts) => new Date(ts).toISOString()

const foto = (partido, config, ts) => ({
  estado: partido.estado ?? null,
  ...camposDeReloj(partido.relojEstado ?? null, partido.relojRestante ?? null, partido.relojDesde ?? null),
  efectivoMs: restanteMs(partido, config, ts),
})

const efectosVacios = () => ({
  eventosNuevos: [], eventosActualizados: [], partido: null, auditoria: [], reloj: {},
})

// ---------------------------------------------------------------------------
// Lo que la persona veía, y construcción del sobre a partir de una orden.
// ---------------------------------------------------------------------------

export function observadoDe(estado, tipo) {
  const o = { rev: estado.rev }
  const p = estado.partido
  if (['anotar', 'falta', 'siguiente-periodo'].includes(tipo)) {
    o.periodo = periodoDe(estado)
    o.marcaPeriodo = marcaDe(estado)
  }
  if (TIPOS[tipo] === 'reloj') {
    o.seq = estado.auditSeq
    o.estado = p.estado ?? null
    o.relojEstado = p.relojEstado ?? null
    o.relojRestante = p.relojRestante ?? null
    o.relojDesde = p.relojDesde ?? null
  }
  return o
}

/** Tiempo restante que vería la persona al ejecutar la orden (solo órdenes de reloj). */
export function restanteVistoDe(estado, tipo, ts) {
  switch (tipo) {
    case 'arrancar-reloj':
    case 'detener-reloj':
    case 'parada-automatica':
    case 'cerrar-partido':
    case 'corregir-reloj':
      return efectivo(estado, ts)
    default:
      return null
  }
}

/**
 * orden = { cmdId, tipo, datos?, tiempo: { accionTs, accionTsCrudo?, ajusteTsMs?, discontinuidad? } }
 * El sobre queda completo; quien lo guarda ya no lo cambia.
 */
export function construirSobre(estado, orden, { deviceId, clientSeq }) {
  const t = orden.tiempo
  const crudo = t.accionTsCrudo ?? t.accionTs
  return {
    cmdId: orden.cmdId,
    gameId: estado.gameId,
    deviceId,
    clientSeq,
    tipo: orden.tipo,
    datos: orden.datos ?? {},
    accionTs: t.accionTs,
    accionTsCrudo: crudo,
    ajusteTsMs: t.ajusteTsMs ?? (t.accionTs - crudo),
    discontinuidad: t.discontinuidad ?? null,
    observado: observadoDe(estado, orden.tipo),
    restanteVistoMs: restanteVistoDe(estado, orden.tipo, t.accionTs),
    atribucionVersion: ['anotar', 'falta'].includes(orden.tipo) ? (estado.atribucion?.version ?? null) : null,
    // Solo el inicio del partido, y solo lo que quien llama capturó (ver preparacion.js): sin valor por
    // defecto ni lectura del estado. Sin captura la clave no existe y el servidor rechaza el inicio nuevo.
    ...(orden.tipo === 'iniciar-partido' && orden.preparacionVersion !== undefined
      ? { preparacionVersion: orden.preparacionVersion } : {}),
  }
}

/**
 * La parada automática de la corrida en curso, o null si no corresponde (el
 * reloj no corre, o todavía queda tiempo). Su cmdId es fijo por corrida.
 */
export function ordenParadaAutomatica(estado, tiempo) {
  if (!corriendo(estado.partido) || estado.corridaSeq === null) return null
  if (efectivo(estado, tiempo.accionTs) !== 0) return null
  return {
    cmdId: `auto:${estado.gameId}:${estado.corridaSeq}`,
    tipo: 'parada-automatica',
    datos: { corridaSeq: estado.corridaSeq },
    tiempo,
  }
}

// ---------------------------------------------------------------------------
// Tiempo de confianza.
// ---------------------------------------------------------------------------

function tiempoValido(estado, sobre, ctx, { enCurso }) {
  const ts = sobre.accionTs
  if (ts > ctx.recibidoEn + (ctx.tolerancia ?? TOLERANCIA_FUTURO_MS)) return false
  if (estado.cursorReloj !== null && ts < estado.cursorReloj) return false
  if (enCurso && estado.partido.relojDesde !== null && ts < estado.partido.relojDesde) return false
  return true
}

/** Advertencias: lo detectado queda registrado, nunca se oculta. */
export function advertenciasDe(estado, sobre, ctx, enforzado) {
  const deterministas = []
  const recepcion = []
  if (sobre.discontinuidad) deterministas.push('discontinuidad-reloj-dispositivo')
  if (sobre.ajusteTsMs !== 0) deterministas.push('ajuste-de-tiempo')
  if (!enforzado) {
    if (estado.cursorReloj !== null && sobre.accionTs < estado.cursorReloj) {
      deterministas.push('tiempo-anterior-al-reloj')
    }
    if (sobre.accionTs > ctx.recibidoEn + (ctx.tolerancia ?? TOLERANCIA_FUTURO_MS)) {
      recepcion.push('tiempo-futuro')
    }
  }
  return { deterministas, recepcion }
}

// ---------------------------------------------------------------------------
// Filas de auditoría del reloj.
// ---------------------------------------------------------------------------

function filaAuditoria(estado, sobre, ctx, { comando, antes, despues, origen = 'consola', corridaSeq, extra }) {
  return {
    id: `${sobre.cmdId}:a`,
    partidoId: estado.gameId,
    seq: estado.auditSeq + 1,
    reloj: 'juego',
    comando,
    periodo: periodoDe(estado),
    antes,
    despues,
    ts: iso(sobre.accionTs),
    origen,
    actorId: origen === 'consola' ? (ctx.actorId ?? null) : null,
    cmdId: sobre.cmdId,
    corridaSeq: corridaSeq ?? null,
    accionTsCrudo: sobre.accionTsCrudo,
    ajusteTsMs: sobre.ajusteTsMs,
    discontinuidad: sobre.discontinuidad,
    ...extra,
  }
}

function efectosDeReloj(estado, sobre, ctx, { comando, cambios, origen, corridaSeq, reloj = {}, extra }) {
  const despues = { ...estado.partido, ...cambios }
  const e = efectosVacios()
  e.partido = cambios
  e.reloj = reloj
  e.auditoria = [filaAuditoria(estado, sobre, ctx, {
    comando,
    antes: foto(estado.partido, estado.config, sobre.accionTs),
    despues: foto(despues, estado.config, sobre.accionTs),
    origen,
    corridaSeq,
    extra,
  })]
  return e
}

// ---------------------------------------------------------------------------
// Reglas por orden.
// ---------------------------------------------------------------------------

function bloquearRehacer(estado) {
  return estado.eventos
    .filter((e) => e.anulado && !e.rehacerBloqueado)
    .map((e) => ({ id: e.id, cambios: { rehacerBloqueado: true } }))
}

// Puntos y faltas NUEVOS se atribuyen a un jugador del partido, validado contra el
// contexto de atribución de confianza (ver atribucion.js). Sin contexto, o con uno
// que no es el que usó quien lo pidió, se rechaza: nunca se reinterpreta en silencio.
// Deshacer, Rehacer y Anular no pasan por aquí: corrigen eventos que ya existen.
function reglaAnotar(estado, sobre) {
  const at = estado.atribucion
  if (!atribucionIntegra(at)) return no('atribucion-no-disponible')
  if (sobre.atribucionVersion !== at.version) {
    return no('atribucion-desactualizada', { versionServidor: at.version })
  }
  const { equipoId, jugadorId, puntos } = sobre.datos
  const tipo = sobre.tipo === 'falta' ? 'falta' : 'punto'
  if (tipo === 'punto' && !(PUNTOS_POR_DEPORTE[estado.config.deporte] ?? []).includes(puntos)) {
    return no('puntos-invalidos')
  }
  if (!at.equipos.includes(equipoId)) return no('equipo-invalido')
  if (jugadorId === null) return no('jugador-requerido')
  if (!Object.prototype.hasOwnProperty.call(at.jugadores, jugadorId)) return no('jugador-desconocido')
  const jugador = at.jugadores[jugadorId]
  if (jugador.equipoId !== equipoId) return no('jugador-de-otro-equipo')
  if (!jugador.elegible) return no('jugador-inactivo')
  const e = efectosVacios()
  e.eventosActualizados = bloquearRehacer(estado)
  e.eventosNuevos = [{
    id: sobre.cmdId,
    partidoId: estado.gameId,
    seq: sigSeqEvento(estado),
    tipo,
    equipoId,
    jugadorId,
    puntos: tipo === 'falta' ? 0 : puntos,
    periodo: periodoDe(estado),
    anulado: false,
    creadoEn: sobre.accionTs,
  }]
  return ok(e)
}

function reglaDeshacer(estado, sobre) {
  const vivo = estado.eventos.filter((e) => !e.anulado).sort((a, b) => b.seq - a.seq)[0]
  if (!vivo) return no('nada')
  if (vivo.tipo === 'periodo') return no('limite-periodo')
  const e = efectosVacios()
  e.eventosActualizados = [{
    id: vivo.id, cambios: { anulado: true, anuladoEn: sobre.accionTs, anuladoRev: estado.rev + 1 },
  }]
  return ok(e)
}

// Más reciente primero: las anulaciones del motor se ordenan por revisión
// (autoritativa); las anteriores al motor, por su hora, que es lo que tenían.
function masReciente(a, b) {
  const ra = a.anuladoRev ?? null
  const rb = b.anuladoRev ?? null
  if (ra !== null || rb !== null) {
    if (ra === null) return 1
    if (rb === null) return -1
    return rb - ra
  }
  return ((b.anuladoEn || 0) - (a.anuladoEn || 0)) || (b.seq - a.seq)
}

function reglaRehacer(estado) {
  const candidato = estado.eventos
    .filter((e) => e.anulado && !e.rehacerBloqueado && e.tipo !== 'periodo')
    .sort(masReciente)[0]
  if (!candidato) return no('nada')
  if (periodoEnPosicion(estado.eventos, candidato.seq, estado.config.deporte) !== candidato.periodo) {
    return no('periodo-invalido')
  }
  const e = efectosVacios()
  e.eventosActualizados = [{
    id: candidato.id, cambios: { anulado: false, anuladoEn: null, anuladoRev: null },
  }]
  return ok(e)
}

function reglaAnular(estado, sobre) {
  const evento = estado.eventos.find((x) => x.id === sobre.datos.eventoId)
  if (!evento) return no('nada')
  if (evento.tipo === 'periodo') return no('limite-periodo')
  if (evento.anulado) return no('nada')
  const e = efectosVacios()
  e.eventosActualizados = [{
    id: evento.id, cambios: { anulado: true, anuladoEn: sobre.accionTs, anuladoRev: estado.rev + 1 },
  }]
  return ok(e)
}

function reglaIniciar(estado, sobre, ctx) {
  const cambios = {
    estado: 'vivo',
    inicio: iso(sobre.accionTs),
    ...camposDeReloj('detenido', duracionMs(estado.config), null),
  }
  return ok(efectosDeReloj(estado, sobre, ctx, { comando: 'inicio-partido', cambios }))
}

function reglaArrancar(estado, sobre, ctx) {
  if (corriendo(estado.partido)) return no('ya-corriendo')
  if (!tiempoValido(estado, sobre, ctx, { enCurso: false })) return no('tiempo-invalido')
  const falta = efectivo(estado, sobre.accionTs)
  if (falta === 0) return no('sin-tiempo')
  if (sobre.restanteVistoMs !== falta) return no('reloj-divergente')
  const corridaSeq = estado.auditSeq + 1
  const e = efectosDeReloj(estado, sobre, ctx, {
    comando: 'arrancar',
    cambios: camposDeReloj('corriendo', falta, sobre.accionTs),
    corridaSeq,
    reloj: { corridaSeq, cursorReloj: sobre.accionTs },
  })
  return ok(e, true)
}

function reglaDetener(estado, sobre, ctx) {
  const automatico = sobre.tipo === 'parada-automatica'
  if (!corriendo(estado.partido)) return no('no-corre')
  if (automatico && sobre.datos.corridaSeq !== estado.corridaSeq) return no('corrida-distinta')
  if (!tiempoValido(estado, sobre, ctx, { enCurso: true })) return no('tiempo-invalido')
  const falta = efectivo(estado, sobre.accionTs)
  if (automatico && falta !== 0) return no('aun-hay-tiempo')
  if (sobre.restanteVistoMs !== falta) return no('reloj-divergente')
  const e = efectosDeReloj(estado, sobre, ctx, {
    comando: automatico ? 'parada-automatica' : 'detener',
    cambios: camposDeReloj('detenido', falta, null),
    origen: automatico ? 'sistema' : 'consola',
    corridaSeq: estado.corridaSeq,
    reloj: { corridaSeq: null, cursorReloj: sobre.accionTs },
    // Cuándo llegó a cero, derivado de lo guardado (no observado por nadie).
    extra: automatico ? { ceroEnDerivado: (estado.partido.relojDesde ?? 0) + (estado.partido.relojRestante ?? 0) } : undefined,
  })
  return ok(e, true)
}

function reglaCorregir(estado, sobre, ctx) {
  if (corriendo(estado.partido)) return no('reloj-corriendo')
  const nuevo = sobre.datos.restanteMs
  if (nuevo > duracionMs(estado.config)) return no('fuera-de-rango')
  const actual = efectivo(estado, sobre.accionTs)
  if (sobre.restanteVistoMs !== actual) return no('reloj-divergente')
  if (nuevo === actual) return no('sin-cambio')
  return ok(efectosDeReloj(estado, sobre, ctx, {
    comando: 'correccion-reloj',
    // Solo cambia el restante; los otros dos campos se escriben con el valor que ya tenían.
    cambios: camposDeReloj(estado.partido.relojEstado ?? null, nuevo, estado.partido.relojDesde ?? null),
    extra: { restanteAnteriorMs: actual, restanteNuevoMs: nuevo },
  }))
}

function reglaSiguientePeriodo(estado, sobre, ctx) {
  const visible = periodoDe(estado)
  if (visible >= (PERIODOS[estado.config.deporte] || 2)) return no('ultimo-periodo')
  const eventoId = `${sobre.cmdId}:e`
  const cambios = camposDeReloj('detenido', duracionMs(estado.config), null)
  const e = efectosDeReloj(estado, sobre, ctx, {
    comando: 'reinicio-periodo',
    cambios,
    corridaSeq: estado.corridaSeq,
    reloj: { corridaSeq: null },
    extra: { periodoDespues: visible + 1, eventoPeriodoId: eventoId },
  })
  e.eventosNuevos = [{
    id: eventoId,
    partidoId: estado.gameId,
    seq: sigSeqEvento(estado),
    tipo: 'periodo',
    periodo: visible,
    anulado: false,
    creadoEn: sobre.accionTs,
  }]
  return ok(e)
}

function reglaCerrar(estado, sobre, ctx) {
  const enCurso = corriendo(estado.partido)
  if (enCurso && !tiempoValido(estado, sobre, ctx, { enCurso })) return no('tiempo-invalido')
  const falta = efectivo(estado, sobre.accionTs)
  if (sobre.restanteVistoMs !== falta) return no('reloj-divergente')
  const e = efectosDeReloj(estado, sobre, ctx, {
    comando: 'cierre-partido',
    cambios: { estado: 'final', ...camposDeReloj('detenido', falta, null) },
    corridaSeq: estado.corridaSeq,
    reloj: enCurso ? { corridaSeq: null, cursorReloj: sobre.accionTs } : { corridaSeq: null },
  })
  return ok(e, enCurso)
}

// estados: en qué estados de partido tiene sentido la orden (null = en cualquiera,
// como hoy Deshacer/Rehacer/Anular, que siguen disponibles con el partido final).
// observa: qué se compara con lo que veía la persona, en este orden.
const REGLAS = {
  anotar: { estados: ['vivo'], observa: ['periodo', 'rev'], regla: reglaAnotar },
  falta: { estados: ['vivo'], observa: ['periodo', 'rev'], regla: reglaAnotar },
  deshacer: { estados: null, observa: ['rev'], regla: reglaDeshacer },
  rehacer: { estados: null, observa: ['rev'], regla: reglaRehacer },
  'anular-evento': { estados: null, observa: ['rev'], regla: reglaAnular },
  'iniciar-partido': { estados: ['programado'], observa: ['reloj', 'rev'], regla: reglaIniciar },
  'arrancar-reloj': { estados: ['vivo'], observa: ['reloj', 'rev'], regla: reglaArrancar },
  'detener-reloj': { estados: ['vivo'], observa: ['reloj', 'rev'], regla: reglaDetener },
  'parada-automatica': { estados: ['vivo'], observa: ['reloj', 'rev'], regla: reglaDetener },
  'corregir-reloj': { estados: ['vivo'], observa: ['reloj', 'rev'], regla: reglaCorregir },
  'siguiente-periodo': { estados: ['vivo'], observa: ['periodo', 'reloj', 'rev'], regla: reglaSiguientePeriodo },
  'cerrar-partido': { estados: ['vivo'], observa: ['reloj', 'rev'], regla: reglaCerrar },
}

const COMPROBACIONES = {
  periodo: (estado, obs) => (obs.periodo === periodoDe(estado) && obs.marcaPeriodo === marcaDe(estado)
    ? null : 'periodo-desactualizado'),
  reloj: (estado, obs) => {
    const p = estado.partido
    return iguales(obs.seq, estado.auditSeq) && iguales(obs.estado, p.estado)
      && iguales(obs.relojEstado, p.relojEstado) && iguales(obs.relojRestante, p.relojRestante)
      && iguales(obs.relojDesde, p.relojDesde) ? null : 'reloj-desactualizado'
  },
  rev: (estado, obs) => (obs.rev === estado.rev ? null : 'revision-desactualizada'),
}

/**
 * Decide una orden (sobre ya validado) sobre un estado. Es pura: no cambia el
 * estado recibido ni lee la hora.
 *
 * Devuelve { ok: false, motivo, estado? } o { ok: true, efectos, advertencias,
 * advertenciasRecepcion }.
 */
export function decidirOrden(estado, sobre, ctx) {
  const def = REGLAS[sobre.tipo]
  if (!def) return no('tipo-desconocido')

  const estadoPartido = estado.partido.estado ?? null
  if (def.estados && !def.estados.includes(estadoPartido)) {
    return no('partido-no-disponible', { estado: estadoPartido })
  }
  for (const c of def.observa) {
    const motivo = COMPROBACIONES[c](estado, sobre.observado)
    if (motivo) return no(motivo)
  }

  const r = def.regla(estado, sobre, ctx)
  if (!r.ok) return r
  const w = advertenciasDe(estado, sobre, ctx, r.enforzado && USA_TIEMPO_TRANSCURRIDO.has(sobre.tipo))
  return {
    ok: true,
    efectos: r.efectos,
    advertencias: w.deterministas,
    advertenciasRecepcion: w.recepcion,
  }
}

/** Advertencias de un sobre rechazado (no hay efectos que acotar). */
export const advertenciasDeRechazo = (estado, sobre, ctx) => advertenciasDe(estado, sobre, ctx, false)

/** Estado siguiente: nuevo objeto, el recibido no se modifica. */
export function aplicarEfectos(estado, efectos) {
  const cambiosPorId = new Map(efectos.eventosActualizados.map((u) => [u.id, u.cambios]))
  const eventos = estado.eventos
    .map((e) => (cambiosPorId.has(e.id) ? { ...e, ...cambiosPorId.get(e.id) } : e))
    .concat(efectos.eventosNuevos.map((e) => ({ ...e })))
  return {
    ...estado,
    rev: estado.rev + 1,
    auditSeq: estado.auditSeq + efectos.auditoria.length,
    corridaSeq: 'corridaSeq' in efectos.reloj ? efectos.reloj.corridaSeq : estado.corridaSeq,
    cursorReloj: 'cursorReloj' in efectos.reloj ? efectos.reloj.cursorReloj : estado.cursorReloj,
    partido: efectos.partido ? { ...estado.partido, ...efectos.partido } : estado.partido,
    eventos,
  }
}
