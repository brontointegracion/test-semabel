import {
  VERSION_MOTOR, aplicarEfectos, alRecibir, atribucionIntegra, canonico, contenidoCanonico, crearEstado, decidirOrden,
  evaluarPreparacion, preparacionIntegra, reanudar, reconstruirProvisional, validarSobre, encolar as encolarEnCola,
} from '../motor'
import { datosParaMostrar, igualesVisualizacion, validarFilaVisualizacion, validarVisualizacion } from './sesion-visualizacion'

// ---------------------------------------------------------------------------
// Lógica PURA de la sesión de puntuación del teléfono (S1a). Sin almacenamiento, sin red, sin relojes.
// Recibe las filas que leyó el almacén (sesion-almacen.js) y devuelve filas nuevas y resultados; no escribe nada.
//
// Cómo se usa el motor, sin cambiarlo:
//   - la cola (`cola.js`) se reconstruye desde las filas; sus funciones puras deciden y numeran;
//   - el estado PROVISIONAL no se guarda: es la base más las órdenes vivas (`reconstruirProvisional`);
//   - la base avanza SOLO con un recibo verificado (evaluarRecibo) y queda marcada «derivada»: es una cuenta local del
//     estado que el servidor tenía, NO una lectura del servidor. Solo una instantánea comparada con ella
//     (compararInstantanea) la deja «verificada»;
//   - nunca se contradice un rechazo del servidor con una aceptación local, ni se infiere una aceptación de `rev`,
//     `ultimoClientSeq` o de un puntaje.
//
// Todo lo lento (hash SHA-256, red, relojes) ocurre FUERA de las transacciones: aquí solo hay funciones síncronas.
// ---------------------------------------------------------------------------

export const VERSION_SESION = 1
export const ESTADOS_ENTRADA = Object.freeze(['pendiente', 'enviando', 'confirmada', 'rechazada', 'no-aplicada'])
export const ESTADOS_INICIO = Object.freeze(['sin-iniciar', 'confirmado', 'sin-resolver'])
export const NIVELES_BASE = Object.freeze(['verificada', 'derivada'])

/**
 * Límites PROVISIONALES de la aplicación (no una garantía de cuota del navegador ni de que toda partida quepa en el límite
 * de lectura del servidor: 4.000 eventos / 1 MiB). Ver sesion-almacen.js.
 */
export const LIMITES = Object.freeze({
  maxComandosPartido: 1200,
  maxBytesPartido: 4 * 1024 * 1024,
  maxBytesTotal: 128 * 1024 * 1024,
  sobrecargaFila: 256,
  margenReservaBytes: 128,
  dependienteBytes: 64,
  motivoMax: 120,
  detalleMaxBytes: 512,
  advertenciasMax: 8,
  advertenciaMaxChars: 64,
  evidenciaMaxChars: 4096,
})

const CAMPOS_EVENTO = ['id', 'partidoId', 'seq', 'tipo', 'equipoId', 'jugadorId', 'puntos', 'periodo', 'anulado', 'creadoEn', 'anuladoEn', 'anuladoRev', 'rehacerBloqueado']
const CAMPOS_RELOJ = ['relojEstado', 'relojRestante', 'relojDesde']
const HEX64 = /^[0-9a-f]{64}$/

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const entero = (v) => Number.isSafeInteger(v) && v >= 0
const texto = (v) => typeof v === 'string' && v.length > 0
const vivas = (e) => e.estado === 'pendiente' || e.estado === 'enviando'
const copia = (v) => structuredClone(v)

export const bytesUtf8 = (t) => new TextEncoder().encode(t).length
/** Bytes UTF-8 de una fila de sesión (sin su contador `uso`) más una sobrecarga fija por fila. */
export const medirSesion = (fila) => bytesUtf8(JSON.stringify({ ...fila, uso: undefined })) + LIMITES.sobrecargaFila
/** Bytes UTF-8 de una fila de entrada (sin `bytes` ni `reserva`) más una sobrecarga fija por fila. */
export const medirEntrada = (fila) => bytesUtf8(JSON.stringify({ ...fila, bytes: undefined, reserva: undefined })) + LIMITES.sobrecargaFila

/** SHA-256 hexadecimal del recibo completo en JSON canónico. Asíncrono: SIEMPRE antes de abrir la transacción. */
export async function huellaDeRecibo(recibo) {
  const datos = new TextEncoder().encode(canonico(recibo))
  const h = await globalThis.crypto.subtle.digest('SHA-256', datos)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Validación de forma de lo que se lee.
// ---------------------------------------------------------------------------

export function validarFilaSesion(f, id) {
  const mal = (m) => ({ ok: false, motivo: m })
  if (!esObjeto(f) || f.v !== VERSION_SESION) return mal('version')
  if (!texto(f.id) || f.id !== id || !texto(f.ligaId) || !texto(f.partidoId) || f.id !== `${f.ligaId}:${f.partidoId}`) return mal('identidad')
  if (!texto(f.deviceId) || !entero(f.revision) || !entero(f.siguienteSeq) || f.siguienteSeq < 1) return mal('contadores')
  const b = f.base
  if (!esObjeto(b) || !entero(b.ultimoClientSeq) || !esObjeto(b.estado) || b.estado.gameId !== f.partidoId) return mal('base')
  const e = b.estado
  if (!entero(e.rev) || !Array.isArray(e.eventos) || !esObjeto(e.partido) || !esObjeto(e.config)) return mal('estado')
  if (f.siguienteSeq <= b.ultimoClientSeq) return mal('secuencia')
  if (!esObjeto(f.verificacion) || !NIVELES_BASE.includes(f.verificacion.nivel)) return mal('verificacion')
  if (!ESTADOS_INICIO.includes(f.inicio)) return mal('inicio')
  if (!(f.detenida === null || esObjeto(f.detenida)) || !(f.divergencia === null || esObjeto(f.divergencia))) return mal('estados')
  if (!Array.isArray(f.etiquetas)) return mal('etiquetas')
  // Datos para mostrar (REPORT_127): opcionales. Una fila anterior no los tiene (undefined) y eso NO es un error.
  if (f.visualizacion !== undefined && f.visualizacion !== null && !validarFilaVisualizacion(f.visualizacion).ok) return mal('visualizacion')
  const u = f.uso
  if (!esObjeto(u) || !entero(u.bytes) || !entero(u.comandos) || !entero(u.reservado) || typeof u.sobreReserva !== 'boolean') return mal('uso')
  return { ok: true }
}

export function validarFilaEntrada(f, id) {
  const mal = (m) => ({ ok: false, motivo: m })
  if (!esObjeto(f) || f.id !== id || !entero(f.clientSeq) || f.clientSeq < 1 || !texto(f.cmdId) || !texto(f.tipo)) return mal('identidad')
  if (!texto(f.cuerpoJson) || !ESTADOS_ENTRADA.includes(f.estado) || !entero(f.intentos)) return mal('campos')
  if (!(f.recibo === null || esObjeto(f.recibo)) || !(f.reciboHuella === null || HEX64.test(f.reciboHuella))) return mal('recibo')
  if (!entero(f.reserva) || !entero(f.bytes)) return mal('contadores')
  const decidida = f.estado === 'confirmada' || f.estado === 'rechazada'
  if (decidida && (f.recibo === null || f.reciboHuella === null)) return mal('decidida-sin-recibo')
  if (!decidida && (f.recibo !== null || f.reciboHuella !== null)) return mal('recibo-en-entrada-no-decidida')
  if (!vivas(f) && f.reserva !== 0) return mal('reserva-en-entrada-resuelta')
  return { ok: true }
}

/** Valida sesión + entradas juntas (clientSeq distintos y crecientes, cmdId distintos). */
export function validarSesionYEntradas(sesion, entradas) {
  const v = validarFilaSesion(sesion, sesion?.id)
  if (!v.ok) return { ok: false, motivo: `sesion:${v.motivo}` }
  const cmds = new Set()
  let previa = 0
  for (const f of entradas) {
    const w = validarFilaEntrada(f, sesion.id)
    if (!w.ok) return { ok: false, motivo: `entrada:${w.motivo}`, cmdId: f?.cmdId ?? null }
    if (f.clientSeq <= previa || cmds.has(f.cmdId)) return { ok: false, motivo: 'entrada:orden-o-repeticion', cmdId: f.cmdId }
    previa = f.clientSeq
    cmds.add(f.cmdId)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Instantánea del servidor (cuerpo de GET …/estado) → estado del motor.
// ---------------------------------------------------------------------------

/**
 * Valida la FORMA y la integridad de un cuerpo de `/estado` y arma el estado del motor. No habla con la red.
 * `esperado` = { gameId, deviceId? }.
 */
export function validarCuerpoEstado(cuerpo, esperado = {}) {
  const no = (motivo) => ({ ok: false, motivo })
  if (!esObjeto(cuerpo) || cuerpo.version !== 1) return no('version')
  if (!texto(cuerpo.gameId) || (esperado.gameId !== undefined && cuerpo.gameId !== esperado.gameId)) return no('juego-distinto')
  if (!texto(cuerpo.deviceId) || (esperado.deviceId !== undefined && cuerpo.deviceId !== esperado.deviceId)) return no('dispositivo-distinto')
  const c = cuerpo.cursor
  if (!esObjeto(c) || !entero(c.rev) || !entero(c.ultimoClientSeq)) return no('cursor')
  const e = cuerpo.estado
  if (!esObjeto(e) || !esObjeto(e.config) || !texto(e.config.deporte) || !esObjeto(e.partido) || !Array.isArray(e.eventos)) return no('estado')
  if (!entero(e.auditSeq) || !(e.cursorReloj === null || Number.isSafeInteger(e.cursorReloj))) return no('estado-reloj')
  if (!(e.corridaSeq === null || Number.isSafeInteger(e.corridaSeq) || texto(e.corridaSeq))) return no('corridaSeq')
  if (!e.eventos.every((x) => esObjeto(x) && texto(x.id) && Number.isSafeInteger(x.seq))) return no('eventos')
  if (!(cuerpo.atribucion === null || atribucionIntegra(cuerpo.atribucion))) return no('atribucion')
  if (!Array.isArray(cuerpo.etiquetas)) return no('etiquetas')
  const estado = crearEstado({
    gameId: cuerpo.gameId,
    config: copia(e.config),
    partido: copia(e.partido),
    eventos: copia(e.eventos),
    auditSeq: e.auditSeq,
    corridaSeq: e.corridaSeq,
    cursorReloj: e.cursorReloj,
    rev: c.rev,
    atribucion: cuerpo.atribucion === null ? null : copia(cuerpo.atribucion),
  })
  // Datos para mostrar: se validan contra la atribución y los equipos de ESTA instantánea. Que falten o sean inconsistentes NO
  // invalida la instantánea (el juego se verifica igual): solo impide adoptarlos.
  let visualizacion = { estado: 'ausente' }
  if (Object.prototype.hasOwnProperty.call(cuerpo, 'visualizacion')) {
    const r = validarVisualizacion(cuerpo.visualizacion, { atribucion: cuerpo.atribucion, partido: esObjeto(cuerpo.partido) ? cuerpo.partido : null, eventos: e.eventos })
    visualizacion = r.ok ? { estado: 'ok', datos: r.visualizacion } : { estado: 'invalida', motivo: r.motivo }
  }
  return {
    ok: true,
    estado,
    cursor: { rev: c.rev, ultimoClientSeq: c.ultimoClientSeq },
    etiquetas: copia(cuerpo.etiquetas),
    deviceId: cuerpo.deviceId,
    partido: esObjeto(cuerpo.partido) ? copia(cuerpo.partido) : null,
    visualizacion,
  }
}

/**
 * Fila de sesión nueva desde una instantánea ya validable. La base nace «verificada»: viene del servidor.
 * Un partido que NO está `programado` nace con inicio 'sin-resolver': se ignora si fue este teléfono quien lo inició
 * (recuperar un sobre de inicio perdido queda diferido) y no se puede puntuar.
 */
export function construirSesion({ ligaId, partidoId, cuerpoEstado, deviceId }) {
  if (!texto(ligaId) || !texto(partidoId) || ligaId.includes(':')) return { ok: false, motivo: 'identidad' }
  const v = validarCuerpoEstado(cuerpoEstado, { gameId: partidoId, deviceId })
  if (!v.ok) return v
  const sesion = {
    v: VERSION_SESION,
    id: `${ligaId}:${partidoId}`,
    ligaId,
    partidoId,
    deviceId: v.deviceId,
    revision: 0,
    base: { estado: v.estado, ultimoClientSeq: v.cursor.ultimoClientSeq },
    verificacion: { nivel: 'verificada', verificadaRev: v.cursor.rev },
    etiquetas: v.etiquetas,
    inicio: (v.estado.partido.estado ?? null) === 'programado' ? 'sin-iniciar' : 'sin-resolver',
    siguienteSeq: v.cursor.ultimoClientSeq + 1,
    detenida: null,
    divergencia: null,
    uso: { bytes: 0, comandos: 0, reservado: 0, sobreReserva: false },
    ...(v.visualizacion.estado === 'ok' ? { visualizacion: v.visualizacion.datos } : {}),
  }
  return { ok: true, sesion, visualizacion: v.visualizacion.estado === 'ok' ? { estado: 'ok' } : { estado: v.visualizacion.estado, motivo: v.visualizacion.motivo ?? null } }
}

// ---------------------------------------------------------------------------
// Cola y estado provisional derivados de las filas.
// ---------------------------------------------------------------------------

export function colaDeFilas(sesion, entradas) {
  const lista = []
  for (const f of entradas) {
    let crudo
    try { crudo = JSON.parse(f.cuerpoJson) } catch { return { ok: false, motivo: 'cuerpo-ilegible', cmdId: f.cmdId } }
    const v = validarSobre(crudo)
    if (!v.ok || v.sobre.cmdId !== f.cmdId || v.sobre.clientSeq !== f.clientSeq || v.sobre.tipo !== f.tipo
      || v.sobre.gameId !== sesion.partidoId || v.sobre.deviceId !== sesion.deviceId) {
      return { ok: false, motivo: 'cuerpo-incoherente', cmdId: f.cmdId }
    }
    lista.push({ sobre: v.sobre, estado: f.estado, recibo: f.recibo, motivoNoAplicada: f.motivoNoAplicada ?? null })
  }
  return {
    ok: true,
    cola: {
      gameId: sesion.partidoId,
      deviceId: sesion.deviceId,
      base: { ultimoClientSeq: sesion.base.ultimoClientSeq, rev: sesion.base.estado.rev },
      siguienteSeq: sesion.siguienteSeq,
      entradas: lista,
      detenida: sesion.detenida,
    },
  }
}

/**
 * Estado provisional = base + órdenes vivas, con las mismas reglas. Al reconstruir tras una recarga, «ahora» no puede ser
 * anterior a la hora de acción de una orden ya guardada (sería un falso aviso de futuro): se usa el mayor de ambos.
 * Eso es solo para PINTAR; no cambia ningún sobre ni decide nada que se envíe.
 */
export function provisionalDe(sesion, cola, ctx) {
  const maxTs = cola.entradas.filter(vivas).reduce((m, e) => Math.max(m, e.sobre.accionTs), 0)
  const ahoraEstimado = Math.max(Number.isSafeInteger(ctx?.ahoraEstimado) ? ctx.ahoraEstimado : 0, maxTs)
  return reconstruirProvisional(sesion.base.estado, cola, { ahoraEstimado, actorId: ctx?.actorId ?? null })
}

// ---------------------------------------------------------------------------
// Inicio del partido: compuertas y constructor (puros).
// ---------------------------------------------------------------------------

/** ¿Se puede puntuar? Solo con el inicio CONFIRMADO por un recibo; el `vivo` provisional nunca cuenta. */
export function puntuacionHabilitada(sesion, entradas = []) {
  if (sesion.divergencia) return { habilitada: false, motivo: 'divergencia' }
  if (sesion.inicio === 'confirmado') return { habilitada: true, motivo: null }
  if (sesion.inicio === 'sin-resolver') return { habilitada: false, motivo: 'inicio-sin-resolver' }
  if (entradas.some((e) => e.tipo === 'iniciar-partido' && vivas(e))) return { habilitada: false, motivo: 'inicio-en-curso' }
  if (sesion.detenida) return { habilitada: false, motivo: 'inicio-rechazado' }
  return { habilitada: false, motivo: 'inicio-no-confirmado' }
}

function idsActivosDe(at) {
  return Object.entries(at.jugadores).filter(([, j]) => j.elegible).map(([id]) => id).sort()
}

function coincidenAtribucionYPreparacion(atribucion, prep) {
  if (!atribucion || !atribucionIntegra(atribucion)) return false
  const equipos = [...new Set([prep.partido.localId, prep.partido.visitaId])].sort()
  if (canonico(equipos) !== canonico([...atribucion.equipos].sort())) return false
  return canonico(prep.jugadores.map((j) => j.id).sort()) === canonico(idsActivosDe(atribucion))
}

/**
 * ¿Puede pedirse el inicio? Necesita internet, un contexto de preparación íntegro y listo para ESTE partido, y que la
 * atribución de la base coincida con esa preparación. Pura: no lee la red; `preparacion` la trae quien llama.
 */
export function evaluarInicio({ enLinea, sesion, entradas = [], preparacion }) {
  const no = (motivo, detalle) => ({ puede: false, motivo, ...(detalle ? { detalle } : {}) })
  if (enLinea !== true) return no('sin-internet')
  if (sesion.divergencia) return no('divergencia')
  if (sesion.inicio === 'confirmado') return no('ya-iniciado')
  if (sesion.inicio === 'sin-resolver') return no('inicio-sin-resolver')
  if (entradas.some((e) => e.tipo === 'iniciar-partido' && vivas(e))) return no('inicio-en-curso')
  if (sesion.detenida) return no('cola-detenida')
  if (!preparacionIntegra(preparacion, { gameId: sesion.partidoId })) return no('preparacion-no-disponible')
  const r = evaluarPreparacion(preparacion, { gameId: sesion.partidoId })
  if (!r.lista) return no(r.motivo, r.detalle)
  if (!coincidenAtribucionYPreparacion(sesion.base.estado.atribucion, preparacion)) return no('atribucion-no-coincide-con-preparacion')
  return { puede: true }
}

/** La orden de inicio con la versión de preparación CAPTURADA. `cmdId` y `tiempo` los pone quien llama. */
export function ordenDeInicio({ cmdId, preparacion, tiempo, sesion }) {
  if (!texto(cmdId)) return { ok: false, motivo: 'cmdId' }
  if (!preparacionIntegra(preparacion, { gameId: sesion.partidoId })) return { ok: false, motivo: 'preparacion-no-disponible' }
  return { ok: true, orden: { cmdId, tipo: 'iniciar-partido', datos: {}, tiempo, preparacionVersion: preparacion.version } }
}

// ---------------------------------------------------------------------------
// Recibos recortados.
// ---------------------------------------------------------------------------

const recorta = (s, n) => (typeof s === 'string' ? s.slice(0, n) : s)

/**
 * Lo mínimo del recibo que se conserva. La identidad (gameId, cmdId, clientSeq, deviceId) y el contenido ya están en el
 * sobre guardado; el hash SHA-256 del recibo completo detecta cualquier otra diferencia. Los tamaños están acotados POR
 * CONSTRUCCIÓN (motivo, detalle, advertencias), de modo que la reserva de resolución es un máximo conocido.
 */
export function recortarRecibo(recibo) {
  const lim = LIMITES
  const salida = {
    resultado: recibo.resultado,
    revDespues: recibo.revDespues,
    recibidoEn: recibo.meta.recibidoEn,
    versionMotor: recibo.meta.versionMotor,
    advertencias: (recibo.advertencias ?? []).slice(0, lim.advertenciasMax).map((a) => recorta(a, lim.advertenciaMaxChars)),
    advertenciasRecepcion: (recibo.meta.advertenciasRecepcion ?? []).slice(0, lim.advertenciasMax).map((a) => recorta(a, lim.advertenciaMaxChars)),
    refs: {
      eventosNuevos: [...recibo.refs.eventosNuevos],
      eventosActualizados: [...recibo.refs.eventosActualizados],
      auditoria: [...recibo.refs.auditoria],
    },
  }
  if (recibo.resultado === 'rechazado') {
    salida.motivo = recorta(String(recibo.motivo ?? ''), lim.motivoMax)
    let detalle = recibo.detalle ?? {}
    try { if (bytesUtf8(canonico(detalle)) > lim.detalleMaxBytes) detalle = { truncado: true } } catch { detalle = { truncado: true } }
    salida.detalle = detalle
  }
  return salida
}

function formaDeReciboValida(r) {
  if (!esObjeto(r) || !texto(r.gameId) || !texto(r.cmdId) || !texto(r.deviceId) || !entero(r.clientSeq) || r.clientSeq < 1) return false
  if (r.resultado !== 'aceptado' && r.resultado !== 'rechazado') return false
  if (!entero(r.revDespues) || typeof r.contenido !== 'string') return false
  if (!esObjeto(r.meta) || !Number.isSafeInteger(r.meta.recibidoEn) || !Number.isSafeInteger(r.meta.versionMotor)) return false
  if (!esObjeto(r.refs) || !['eventosNuevos', 'eventosActualizados', 'auditoria'].every((k) => Array.isArray(r.refs[k]) && r.refs[k].every(texto))) return false
  if (!Array.isArray(r.advertencias) || !r.advertencias.every((a) => typeof a === 'string')) return false
  if (r.meta.advertenciasRecepcion !== undefined && !(Array.isArray(r.meta.advertenciasRecepcion) && r.meta.advertenciasRecepcion.every((a) => typeof a === 'string'))) return false
  if (r.resultado === 'rechazado' && typeof r.motivo !== 'string') return false
  return true
}

const refsIguales = (a, b) => ['eventosNuevos', 'eventosActualizados', 'auditoria'].every((k) => canonico(a[k]) === canonico(b[k]))
const idsDe = (lista) => lista.map((x) => x.id)

/** Peor caso de lo que crece una fila de entrada cuando se decide (recibo recortado + hash), con el esperado exacto de aceptación. */
function reservaDeRecibo(fila, esperadoAceptado) {
  const antes = medirEntrada(fila)
  const hash = '0'.repeat(64)
  const aceptada = medirEntrada({ ...fila, estado: 'confirmada', recibo: esperadoAceptado, reciboHuella: hash }) - antes
  const lim = LIMITES
  const rechazada = medirEntrada({
    ...fila,
    estado: 'rechazada',
    recibo: {
      resultado: 'rechazado', revDespues: 9_999_999_999, recibidoEn: 9_999_999_999_999, versionMotor: 99,
      advertencias: Array.from({ length: lim.advertenciasMax }, () => 'a'.repeat(lim.advertenciaMaxChars)),
      advertenciasRecepcion: Array.from({ length: lim.advertenciasMax }, () => 'a'.repeat(lim.advertenciaMaxChars)),
      refs: { eventosNuevos: [], eventosActualizados: [], auditoria: [] },
      motivo: 'm'.repeat(lim.motivoMax), detalle: { d: 'd'.repeat(lim.detalleMaxBytes - 10) },
    },
    reciboHuella: hash,
  }) - antes
  return Math.max(aceptada, rechazada)
}

const proyeccionBase = (e) => ({
  rev: e.rev,
  config: { deporte: e.config.deporte, minutosPorPeriodo: e.config.minutosPorPeriodo ?? null },
  partido: {
    estado: e.partido.estado ?? null,
    inicio: e.partido.inicio ?? null,
    ...Object.fromEntries(CAMPOS_RELOJ.map((k) => [k, e.partido[k] ?? null])),
  },
  auditSeq: e.auditSeq,
  corridaSeq: e.corridaSeq ?? null,
  cursorReloj: e.cursorReloj ?? null,
  atribucion: e.atribucion ? e.atribucion.version : null,
  eventos: e.eventos.map((ev) => Object.fromEntries(CAMPOS_EVENTO.filter((k) => Object.prototype.hasOwnProperty.call(ev, k)).map((k) => [k, ev[k]]))),
})

const crecimientoDe = (antes, despues) => Math.max(0, bytesUtf8(canonico(proyeccionBase(despues))) - bytesUtf8(canonico(proyeccionBase(antes))))

// ---------------------------------------------------------------------------
// T2 — encolar.
// ---------------------------------------------------------------------------

function bloqueoDeSesion(sesion) {
  if (sesion.divergencia) return 'sesion-detenida-por-divergencia'
  return null
}

/**
 * Prepara (sin escribir) el encolado de una orden. Devuelve:
 *   { tipo: 'rechazo', motivo, … }        nada que escribir;
 *   { tipo: 'duplicada', sobre }          ya había una orden viva con ese cmdId: no se asigna otro número;
 *   { tipo: 'ok', sesion, entradas, resultado }
 * ctx = { ahoraEstimado (entero), actorId?, enLinea? }
 */
export function prepararEncolado(sesion, entradas, orden, ctx) {
  const rechazo = (motivo, extra = {}) => ({ tipo: 'rechazo', motivo, ...extra })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return rechazo(bloqueo)
  if (!Number.isSafeInteger(ctx?.ahoraEstimado)) return rechazo('sin-ahora')
  if (!esObjeto(orden) || !texto(orden.cmdId)) return rechazo('orden-invalida')

  const previa = entradas.find((e) => e.cmdId === orden.cmdId)
  if (previa && !vivas(previa)) return rechazo('cmdId-reutilizado')

  if (orden.tipo === 'iniciar-partido') {
    if (ctx.enLinea !== true) return rechazo('sin-internet')
    if (sesion.inicio === 'confirmado') return rechazo('ya-iniciado')
    if (sesion.inicio === 'sin-resolver') return rechazo('inicio-sin-resolver')
    if (typeof orden.preparacionVersion !== 'string' || orden.preparacionVersion === '') return rechazo('preparacion-ausente')
    if (!previa && entradas.some((e) => e.tipo === 'iniciar-partido' && vivas(e))) return rechazo('inicio-en-curso')
  } else if (sesion.inicio !== 'confirmado') {
    // El estado provisional puede decir `vivo` apenas se encola el inicio: no es una confirmación.
    return rechazo(puntuacionHabilitada(sesion, entradas).motivo ?? 'inicio-no-confirmado')
  }

  const c = colaDeFilas(sesion, entradas)
  if (!c.ok) return rechazo('registro-corrupto', { detalle: c.motivo, cmdId: c.cmdId })
  const prov = provisionalDe(sesion, c.cola, ctx)
  if (!prov.ok) return rechazo('divergencia-local', { divergencia: prov.divergencia })

  const r = encolarEnCola(c.cola, prov.estado, orden, { ahoraEstimado: ctx.ahoraEstimado, actorId: ctx.actorId ?? null })
  if (r.rechazoLocal) return rechazo('rechazo-local', { rechazo: r.rechazoLocal })
  if (r.duplicada) return { tipo: 'duplicada', sobre: r.sobre }

  // Lo que el servidor devolvería si acepta, calculado con la misma decisión pura (para acotar la reserva).
  const d = decidirOrden(prov.estado, r.sobre, { recibidoEn: ctx.ahoraEstimado, actorId: ctx.actorId ?? null })
  const refs = d.ok
    ? { eventosNuevos: idsDe(d.efectos.eventosNuevos), eventosActualizados: idsDe(d.efectos.eventosActualizados), auditoria: idsDe(d.efectos.auditoria) }
    : { eventosNuevos: [], eventosActualizados: [], auditoria: [] }
  const esperado = {
    resultado: 'aceptado', revDespues: 9_999_999_999, recibidoEn: 9_999_999_999_999, versionMotor: VERSION_MOTOR,
    advertencias: d.ok ? d.advertencias : [], advertenciasRecepcion: d.ok ? d.advertenciasRecepcion : [], refs,
  }
  const fila = {
    id: sesion.id,
    clientSeq: r.sobre.clientSeq,
    cmdId: r.sobre.cmdId,
    tipo: r.sobre.tipo,
    cuerpoJson: JSON.stringify(r.sobre),
    estado: 'pendiente',
    intentos: 0,
    motivoNoAplicada: null,
    recibo: null,
    reciboHuella: null,
    reserva: 0,
    bytes: 0,
  }
  fila.reserva = reservaDeRecibo(fila, esperado) + crecimientoDe(prov.estado, r.estado) + LIMITES.dependienteBytes + LIMITES.margenReservaBytes

  const nueva = { ...sesion, siguienteSeq: r.cola.siguienteSeq }
  return {
    tipo: 'ok',
    sesion: nueva,
    entradas: [fila],
    resultado: { sobre: r.sobre, cuerpoJson: fila.cuerpoJson, advertencias: r.advertencias, estadoProvisional: r.estado },
  }
}

// ---------------------------------------------------------------------------
// T3 — marcar un envío.
// ---------------------------------------------------------------------------

/**
 * Marca la entrada como «enviando» (intentos + 1). Solo la PRIMERA viva, en orden. El texto exacto a enviar lo devuelve
 * el almacén DESPUÉS de confirmar la transacción.
 */
export function prepararEnvio(sesion, entradas, cmdId, { confirmadoPorOperador = false } = {}) {
  const rechazo = (motivo) => ({ tipo: 'rechazo', motivo })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return rechazo(bloqueo)
  const primera = entradas.find(vivas)
  if (sesion.detenida) {
    // Única excepción: una parada DE TRANSPORTE, con confirmación explícita de la persona, deja reenviar el sobre ORIGINAL de la
    // orden que la parada señala (o, si no señala ninguna, de la primera viva) para poder obtener su recibo. Nada más se reabre:
    // una parada por rechazo definitivo (o cualquier otra causa) sigue cerrada, y la parada de transporte NO se borra.
    const reabre = confirmadoPorOperador === true && sesion.detenida.causa === CAUSA_TRANSPORTE
      && primera && (sesion.detenida.cmdId === null || sesion.detenida.cmdId === primera.cmdId)
    if (!reabre) return rechazo(confirmadoPorOperador === true && sesion.detenida.causa === CAUSA_TRANSPORTE && primera ? 'parada-de-otra-orden' : 'cola-detenida')
  }
  if (!primera) return rechazo('nada-que-enviar')
  if (primera.cmdId !== cmdId) return rechazo(entradas.some((e) => e.cmdId === cmdId) ? 'fuera-de-orden' : 'cmdId-desconocido')
  const fila = { ...primera, estado: 'enviando', intentos: primera.intentos + 1 }
  return { tipo: 'ok', sesion, entradas: [fila], resultado: { cmdId, cuerpoJson: primera.cuerpoJson, intentos: fila.intentos } }
}

// ---------------------------------------------------------------------------
// C1 — parada DE TRANSPORTE (durable). Contrato para el emisor posterior (S1b):
//
//   Qué es: una respuesta del canal que NO es un recibo (401, error de protocolo, conflicto HTTP, sobre inválido) y por la que el
//   emisor debe dejar de enviar SOLO. Es `sesion.detenida = { causa: 'transporte', clase, subtipo, http, cmdId, en }`. NO es un
//   rechazo definitivo (no hay recibo, no se consume secuencia, nada se marca «rechazada» ni «no-aplicada») y NO es una
//   divergencia. Una orden «enviando» sigue INCIERTA: su texto, cmdId, número, intentos, reserva y bytes no cambian.
//   Evidencia acotada: solo `clase`, `subtipo` y `http` de listas CERRADAS, el cmdId de una entrada existente y la hora local.
//   Nunca tokens, cabeceras, códigos privados ni cuerpos de respuesta (lo demás que traiga quien llama se ignora).
//   Efecto: prepararEnvio/encolar/evaluarInicio rechazan con «cola-detenida» tras recargar. Una verificación de instantánea
//   NO la borra. NO existe aquí un borrado general de paradas. Para obtener el recibo de la orden señalada hay una vía
//   EXPLÍCITA: marcarEnviando con confirmadoPorOperador (reenvía el sobre original) y luego aplicarRecibo, que sigue
//   funcionando con la parada puesta; un rechazo definitivo así obtenido sustituye la parada por «rechazo-definitivo», que ya
//   tiene su recuperación explícita (reanudarTrasRechazo). Un recibo aceptado deja la parada de transporte donde estaba.
// ---------------------------------------------------------------------------

export const CAUSA_TRANSPORTE = 'transporte'
/** clase → subtipos permitidos y códigos HTTP permitidos. Listas cerradas: lo que no esté aquí se rechaza. */
export const CLASES_DE_TRANSPORTE = Object.freeze({
  'no-autorizado': { subtipos: [null], http: [401] },
  protocolo: { subtipos: ['juego-distinto', 'json-invalido', 'cuerpo-demasiado-grande', 'metodo-no-permitido', 'no-encontrado'], http: [400, 404, 405, 413] },
  conflicto: { subtipos: ['bloqueado', 'secuencia-ocupada', 'hueco', 'conflicto-contenido'], http: [409] },
  'sobre-invalido': { subtipos: [null], http: [422] },
})

/** ¿Se puede enviar sin intervención de la persona? Pura; el emisor la consulta antes de cada envío automático. */
export const envioAutomaticoPermitido = (sesion) => !sesion.divergencia && !sesion.detenida

/**
 * Prepara (sin escribir) la parada de transporte. `parada = { clase, subtipo?, http?, cmdId? }`; los campos fuera de la lista
 * cerrada hacen que se rechace (no se «arregla» ni se trunca nada). Ya detenida (por lo que sea): no se sobrescribe.
 */
export function prepararParadaDeTransporte(sesion, entradas, parada, ctx) {
  const rechazo = (motivo, detalle) => ({ tipo: 'rechazo', motivo, ...(detalle !== undefined ? { detalle } : {}) })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return rechazo(bloqueo)
  const def = esObjeto(parada) && Object.prototype.hasOwnProperty.call(CLASES_DE_TRANSPORTE, parada.clase) ? CLASES_DE_TRANSPORTE[parada.clase] : null
  if (!def) return rechazo('clase-invalida')
  const subtipo = parada.subtipo ?? null
  if (!def.subtipos.includes(subtipo)) return rechazo('subtipo-invalido')
  const http = parada.http ?? def.http[0]
  if (!def.http.includes(http)) return rechazo('http-invalido')
  const cmdId = parada.cmdId ?? null
  if (cmdId !== null && !entradas.some((e) => e.cmdId === cmdId && vivas(e))) return rechazo('cmdId-sin-orden-viva')
  if (sesion.detenida) return { tipo: 'ya-detenida', detenida: sesion.detenida }
  const detenida = { causa: CAUSA_TRANSPORTE, clase: parada.clase, subtipo, http, cmdId, en: Number.isSafeInteger(ctx?.ahora) ? ctx.ahora : null }
  return { tipo: 'ok', sesion: { ...sesion, detenida }, entradas: [], resultado: { detenida } }
}

// ---------------------------------------------------------------------------
// T4 — aplicar un recibo.
// ---------------------------------------------------------------------------

function divergencia(sesion, causa, { cmdId = null, detalle = null, recibo = null, ctx = null } = {}) {
  if (sesion.divergencia) return { tipo: 'divergencia', sesion, entradas: [], causa: sesion.divergencia.causa, yaRegistrada: true }
  let evidencia = null
  if (recibo !== null) {
    try { evidencia = canonico(recibo) } catch { evidencia = String(recibo) }
    evidencia = evidencia.slice(0, LIMITES.evidenciaMaxChars)
  }
  const registro = { causa, cmdId, detalle, en: Number.isSafeInteger(ctx?.ahora) ? ctx.ahora : null, reciboJson: evidencia }
  return { tipo: 'divergencia', sesion: { ...sesion, divergencia: registro }, entradas: [], causa }
}

/**
 * Evalúa un recibo contra la sesión. Orden (REPORT_116 §1):
 *   1. forma → si está mal formado es un resultado DESCONOCIDO: no se escribe nada, la entrada sigue como estaba;
 *   2. la entrada existe y el recibo es de ELLA (gameId, cmdId, clientSeq, deviceId y contenido canónico) → si no, parada;
 *   3. entrada ya decidida → idéntico (campos recortados + hash) = no-op; distinto = parada (no se toca lo guardado);
 *   4. solo una entrada «enviando» y la primera viva puede recibir un resultado nuevo;
 *   5. secuencia y revisión; 6. derivación determinista de la base (nunca contradice un rechazo del servidor).
 * Devuelve { tipo: 'noop' | 'malformado' | 'divergencia' | 'aplicar', … }.
 */
export function evaluarRecibo(sesion, entradas, recibo, huella, ctx) {
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return { tipo: 'bloqueada', motivo: bloqueo }
  if (!formaDeReciboValida(recibo) || !HEX64.test(huella ?? '')) return { tipo: 'malformado' }

  const entrada = entradas.find((e) => e.cmdId === recibo.cmdId)
  const cada = (causa, detalle) => divergencia(sesion, causa, { cmdId: recibo.cmdId, detalle, recibo, ctx })
  if (!entrada) return cada('recibo-sin-entrada')

  const c = colaDeFilas(sesion, entradas)
  if (!c.ok) return cada('registro-corrupto', c.motivo)
  const sobre = c.cola.entradas.find((e) => e.sobre.cmdId === recibo.cmdId).sobre
  if (recibo.gameId !== sobre.gameId || recibo.cmdId !== sobre.cmdId || recibo.clientSeq !== sobre.clientSeq
    || recibo.deviceId !== sobre.deviceId) return cada('identidad-de-recibo')
  if (recibo.contenido !== contenidoCanonico(sobre)) return cada('contenido-de-recibo')

  const recortado = recortarRecibo(recibo)

  if (entrada.estado === 'confirmada' || entrada.estado === 'rechazada') {
    const igual = canonico(entrada.recibo) === canonico(recortado) && entrada.reciboHuella === huella
    return igual ? { tipo: 'noop', entrada } : cada('recibo-incoherente', 'distinto del ya aplicado')
  }
  if (entrada.estado !== 'enviando') return cada('recibo-para-entrada-no-enviada', entrada.estado)
  const primera = entradas.find(vivas)
  if (!primera || primera.cmdId !== entrada.cmdId) return cada('recibo-fuera-de-orden')

  const S = sesion.base.estado
  if (recibo.clientSeq !== sesion.base.ultimoClientSeq + 1) return cada('secuencia-de-recibo', { esperada: sesion.base.ultimoClientSeq + 1, recibida: recibo.clientSeq })
  if (recibo.meta.versionMotor !== VERSION_MOTOR) return cada('motor-distinto', { servidor: recibo.meta.versionMotor, local: VERSION_MOTOR })

  let estadoNuevo = S
  if (recibo.resultado === 'aceptado') {
    if (recibo.revDespues !== S.rev + 1) return cada('revision-de-recibo', { esperada: S.rev + 1, recibida: recibo.revDespues })
    const d = decidirOrden(S, sobre, { recibidoEn: recibo.meta.recibidoEn, actorId: null })
    if (!d.ok) return cada('derivacion-contradice-recibo', d.motivo)
    estadoNuevo = aplicarEfectos(S, d.efectos)
    const refs = { eventosNuevos: idsDe(d.efectos.eventosNuevos), eventosActualizados: idsDe(d.efectos.eventosActualizados), auditoria: idsDe(d.efectos.auditoria) }
    if (estadoNuevo.rev !== recibo.revDespues) return cada('revision-derivada')
    if (!refsIguales(refs, recibo.refs)) return cada('referencias-derivadas')
    if (canonico(d.advertencias) !== canonico(recibo.advertencias)
      || canonico(d.advertenciasRecepcion) !== canonico(recibo.meta.advertenciasRecepcion ?? [])) return cada('advertencias-derivadas')
  } else {
    // Un rechazo definitivo consume la secuencia y NO cambia la revisión ni el estado.
    if (recibo.revDespues !== S.rev) return cada('revision-de-rechazo', { esperada: S.rev, recibida: recibo.revDespues })
    if (recibo.refs.eventosNuevos.length || recibo.refs.eventosActualizados.length || recibo.refs.auditoria.length) return cada('rechazo-con-efectos')
  }

  const cola2 = alRecibir(c.cola, recibo.cmdId, { tipo: recibo.resultado === 'aceptado' ? 'aceptado' : 'rechazado', recibo })
  const filas = []
  entradas.forEach((f, i) => {
    const despues = cola2.entradas[i]
    if (f.cmdId === recibo.cmdId) {
      filas.push({
        ...f, estado: despues.estado, recibo: recortado, reciboHuella: huella, reserva: 0, motivoNoAplicada: null,
      })
    } else if (despues.estado !== f.estado) {
      filas.push({
        ...f, estado: despues.estado, motivoNoAplicada: despues.motivoNoAplicada, reserva: 0,
      })
    }
  })
  const nueva = {
    ...sesion,
    base: { estado: estadoNuevo, ultimoClientSeq: cola2.base.ultimoClientSeq },
    verificacion: { nivel: 'derivada', verificadaRev: sesion.verificacion.verificadaRev },
    detenida: cola2.detenida,
    inicio: recibo.resultado === 'aceptado' && sobre.tipo === 'iniciar-partido' ? 'confirmado' : sesion.inicio,
  }
  return { tipo: 'aplicar', sesion: nueva, entradas: filas, resultado: { cmdId: recibo.cmdId, resultado: recibo.resultado, motivo: recibo.motivo ?? null } }
}

// ---------------------------------------------------------------------------
// Instantánea del servidor frente a la base derivada.
// ---------------------------------------------------------------------------

/**
 * ¿La atribución ACTUAL de una instantánea es una actualización legítima de la que ya tiene la base?
 * Solo se pregunta cuando TODO el estado del juego ya coincide con la instantánea y el partido está FINAL en ambos lados.
 * Se exige, sobre las filas ya validadas (huella íntegra en validarCuerpoEstado):
 *   - la instantánea trae atribución (no `null`) y los mismos dos equipos que la de la base;
 *   - esos equipos son exactamente los del partido que declara la propia instantánea (`partido.localId/visitaId`);
 *   - todo jugador que aparece en un evento existe en la atribución nueva y en el MISMO equipo que dice el evento
 *     (los eventos son historia: la plantilla puede crecer o desactivar fichas, pero una ficha usada no desaparece ni cambia de equipo).
 * Devuelve null si es coherente, o un texto con la causa.
 */
function incoherenciaDeAtribucion(baseEstado, v, { previaPuedeFaltar = false } = {}) {
  const nueva = v.estado.atribucion
  const vieja = baseEstado.atribucion
  if (!nueva || !atribucionIntegra(nueva)) return 'atribucion-ausente-o-no-integra'
  if (!vieja && !previaPuedeFaltar) return 'atribucion-previa-ausente'
  const equipos = (xs) => canonico([...xs].sort())
  if (vieja && equipos(nueva.equipos) !== equipos(vieja.equipos)) return 'equipos-de-la-atribucion-cambiaron'
  const p = v.partido
  if (!p || !texto(p.localId) || !texto(p.visitaId)) return 'partido-sin-equipos'
  if (equipos(nueva.equipos) !== equipos([...new Set([p.localId, p.visitaId])])) return 'equipos-distintos-del-partido'
  for (const e of v.estado.eventos) {
    if (typeof e.jugadorId !== 'string') continue
    const j = Object.prototype.hasOwnProperty.call(nueva.jugadores, e.jugadorId) ? nueva.jugadores[e.jugadorId] : null
    if (!j) return 'jugador-de-un-evento-ausente'
    if (typeof e.equipoId === 'string' && j.equipoId !== e.equipoId) return 'jugador-de-un-evento-en-otro-equipo'
  }
  return null
}

/**
 * Compara una instantánea con la base derivada. PURA: no habla con la red.
 *   - con una entrada «enviando» la instantánea NO se puede interpretar (puede incluirla o no): no se adopta nada;
 *   - iguales → la base pasa a «verificada»; distintas → parada por divergencia con la lista de diferencias; la base no se toca.
 * Una instantánea nunca reemplaza la base de una sesión con órdenes en vuelo. Las órdenes sin enviar no están en el servidor,
 * así que la comparación sigue siendo exacta aunque existan.
 *
 * VERIFICAR EL JUEGO Y REFRESCAR LA ATRIBUCIÓN SON DOS COSAS. Marcador, eventos, periodo, reloj, revisión, cursor de secuencia,
 * identidad del teléfono y la versión del motor se comparan SIEMPRE y cualquier diferencia detiene la sesión. La atribución
 * (quién puede recibir puntos NUEVOS) solo difiere por sí sola de forma legítima cuando el partido ya terminó, porque la
 * plantilla queda bloqueada mientras corre y se puede editar después. Entonces, y solo entonces —el estado del juego coincide
 * por completo, el partido es `final` en la base DERIVADA y en la instantánea, la nueva atribución es coherente (ver
 * incoherenciaDeAtribucion) y no hay órdenes vivas con atribución propia— la base adopta la atribución y las etiquetas actuales
 * y queda «verificada». En cualquier otro caso (partido vivo o sin iniciar, atribución incoherente, instantánea que dice `final`
 * cuando la base no lo es) la diferencia es una divergencia como siempre.
 * La atribución anterior sigue viva donde importa: los eventos y los sobres guardados llevan sus propios ids y su propia versión
 * de atribución, y los recibos y sus huellas no se tocan. Solo se anota qué versión se reemplazó por cuál.
 */
export function compararInstantanea(sesion, entradas, cuerpoEstado, ctx) {
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return { tipo: 'bloqueada', motivo: bloqueo }
  const v = validarCuerpoEstado(cuerpoEstado, { gameId: sesion.partidoId, deviceId: sesion.deviceId })
  if (!v.ok) return { tipo: 'invalida', motivo: v.motivo }
  if (entradas.some((e) => e.estado === 'enviando')) return { tipo: 'no-aplicable', motivo: 'entrada-en-vuelo' }
  const local = proyeccionBase(sesion.base.estado)
  const remoto = proyeccionBase(v.estado)
  const diferencias = Object.keys(local).filter((k) => canonico(local[k]) !== canonico(remoto[k]))
  if (v.cursor.ultimoClientSeq !== sesion.base.ultimoClientSeq) diferencias.push('ultimoClientSeq')
  const soloAtribucion = diferencias.length === 1 && diferencias[0] === 'atribucion'
  // Datos para mostrar (REPORT_127): NO entran en la comparación del juego. Solo se ofrecen cuando el resultado es «verificada»;
  // una divergencia no toca nada. Un cambio de etiquetas, por sí solo, nunca es una divergencia.
  const conVisualizacion = (r) => {
    const info = propuestaDeVisualizacion(sesion, v)
    if (!info.cambia) return { ...r, visualizacion: { estado: info.estado, motivo: info.motivo ?? null, cambia: false } }
    return { ...r, sesion: { ...r.sesion, visualizacion: info.datos }, sesionSinVisualizacion: r.sesion, visualizacionNueva: true, visualizacion: { estado: 'ok', cambia: true } }
  }

  if (diferencias.length === 0) {
    return conVisualizacion({
      tipo: 'verificada',
      sesion: { ...sesion, verificacion: { nivel: 'verificada', verificadaRev: sesion.base.estado.rev } },
      entradas: [],
    })
  }

  const parar = (causa, extra = {}) => {
    const d = divergencia(sesion, causa, { detalle: { diferencias, ...extra }, ctx })
    return { ...d, tipo: 'divergencia', diferencias }
  }
  if (!soloAtribucion) return parar('instantanea-distinta')
  // Solo difiere la atribución. Con el juego vivo o sin iniciar es una divergencia como siempre (la plantilla está bloqueada).
  if (sesion.base.estado.partido.estado !== 'final' || v.estado.partido.estado !== 'final') return parar('instantanea-distinta')
  const incoherencia = incoherenciaDeAtribucion(sesion.base.estado, v)
  if (incoherencia) return parar('atribucion-incoherente', { motivo: incoherencia })
  // Una orden viva con atribución propia se validó contra la versión que ya no será la de la base: no se toca, no se decide aquí.
  const colaViva = colaDeFilas(sesion, entradas)
  if (!colaViva.ok) return parar('registro-corrupto', { motivo: colaViva.motivo })
  if (colaViva.cola.entradas.some((e) => vivas(e) && e.sobre.atribucionVersion !== null)) {
    return { tipo: 'no-aplicable', motivo: 'ordenes-vivas-con-atribucion' }
  }
  const de = sesion.base.estado.atribucion.version
  const a = v.estado.atribucion.version
  return conVisualizacion({
    tipo: 'verificada',
    atribucionRefrescada: { de, a },
    sesion: {
      ...sesion,
      base: { ...sesion.base, estado: { ...sesion.base.estado, atribucion: copia(v.estado.atribucion) } },
      etiquetas: v.etiquetas,
      verificacion: { nivel: 'verificada', verificadaRev: sesion.base.estado.rev, atribucionRefrescada: { de, a } },
    },
    entradas: [],
  })
}

/** ¿Qué haría adoptar los datos para mostrar de esta instantánea? Pura; no escribe. */
function propuestaDeVisualizacion(sesion, v) {
  if (v.visualizacion.estado !== 'ok') return { estado: v.visualizacion.estado, motivo: v.visualizacion.motivo ?? null, cambia: false }
  return { estado: 'ok', cambia: !igualesVisualizacion(sesion.visualizacion, v.visualizacion.datos), datos: v.visualizacion.datos }
}

/**
 * Actualiza SOLO los datos para mostrar con una instantánea autorizada, sin comparar el juego (no puede crear una divergencia) ni
 * tocar órdenes, recibos, base o verificación. Exige el mismo partido y dispositivo y que la atribución de la instantánea sea la
 * MISMA versión que la de la base: la identidad de los jugadores no se redefine desde aquí (si cambió, el camino es el refresco
 * previo al inicio o el posterior al final).
 */
export function actualizarVisualizacionDeSesion(sesion, entradas, { cuerpoEstado }) {
  const no = (motivo, detalle) => ({ tipo: 'rechazo', motivo, ...(detalle !== undefined ? { detalle } : {}) })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return no(bloqueo)
  const v = validarCuerpoEstado(cuerpoEstado, { gameId: sesion.partidoId, deviceId: sesion.deviceId })
  if (!v.ok) return no('instantanea-invalida', v.motivo)
  const base = sesion.base.estado.atribucion
  if (!base || !v.estado.atribucion || v.estado.atribucion.version !== base.version) return no('atribucion-distinta')
  if (v.visualizacion.estado !== 'ok') return no(v.visualizacion.estado === 'ausente' ? 'visualizacion-ausente' : 'visualizacion-invalida', v.visualizacion.motivo)
  if (igualesVisualizacion(sesion.visualizacion, v.visualizacion.datos)) return { tipo: 'sin-cambio' }
  return {
    tipo: 'ok',
    sesion: { ...sesion, visualizacion: v.visualizacion.datos },
    entradas: [],
    comprobarCapacidad: true,
    refresco: 'visualizacion',
    resultado: { adoptada: true, sinCambios: false },
  }
}

export { datosParaMostrar }

// ---------------------------------------------------------------------------
// C3 — refrescar la base ANTES del inicio (sesión obsoleta, partido todavía «programado»).
//
//   Solo si: sin divergencia, sin parada de ninguna clase, inicio 'sin-iniciar', ninguna orden viva (pendiente o enviando: un
//   resultado sin resolver, p. ej. un inicio cuya respuesta se perdió, NO se puede saltar), la base y la instantánea dicen
//   `programado`, la instantánea es de este partido y teléfono, trae el MISMO cursor (número y revisión) y se diferencia de la
//   base SOLO en la atribución; la atribución es coherente (mismos equipos que el partido) y coincide con una preparación
//   íntegra de este partido. Cualquier otra cosa se rechaza SIN escribir (no es una divergencia: nadie contradijo un recibo).
//   Efecto: reemplaza la base por la instantánea (verificada) y las etiquetas. NO toca ninguna fila de entrada (sobres, recibos,
//   rechazadas, no-aplicadas, cmdId), ni el número siguiente, ni crea/encola/acepta un inicio, ni habilita la puntuación:
//   el inicio sigue 'sin-iniciar' hasta un recibo ACEPTADO de inicio. Pedir un inicio nuevo sigue exigiendo internet,
//   preparación fresca y confirmación explícita (evaluarInicio / ordenDeInicio). Tras un rechazo definitivo del inicio la
//   cola está detenida: ese camino es reanudarTrasRechazo (con confirmación), no este.
// ---------------------------------------------------------------------------

export function refrescarAntesDelInicio(sesion, entradas, { cuerpoEstado, preparacion }) {
  const no = (motivo, detalle) => ({ tipo: 'rechazo', motivo, ...(detalle !== undefined ? { detalle } : {}) })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return no(bloqueo)
  if (sesion.inicio !== 'sin-iniciar') return no('no-es-previa-al-inicio', sesion.inicio)
  if ((sesion.base.estado.partido.estado ?? null) !== 'programado') return no('partido-no-programado')
  if (sesion.detenida) return no('cola-detenida', sesion.detenida.causa)
  if (entradas.some((e) => e.estado === 'enviando')) return no('resultado-sin-resolver')
  if (entradas.some(vivas)) return no('ordenes-vivas')
  const v = validarCuerpoEstado(cuerpoEstado, { gameId: sesion.partidoId, deviceId: sesion.deviceId })
  if (!v.ok) return no('instantanea-invalida', v.motivo)
  if ((v.estado.partido.estado ?? null) !== 'programado') return no('partido-ya-no-programado')
  if (v.cursor.ultimoClientSeq !== sesion.base.ultimoClientSeq) return no('servidor-no-coincide', { servidor: v.cursor, local: { ultimoClientSeq: sesion.base.ultimoClientSeq, rev: sesion.base.estado.rev } })
  const local = proyeccionBase(sesion.base.estado)
  const remoto = proyeccionBase(v.estado)
  const diferencias = Object.keys(local).filter((k) => canonico(local[k]) !== canonico(remoto[k]))
  if (diferencias.some((k) => k !== 'atribucion')) return no('instantanea-distinta', { diferencias })
  const incoherencia = incoherenciaDeAtribucion(sesion.base.estado, v, { previaPuedeFaltar: true })
  if (incoherencia) return no('atribucion-incoherente', incoherencia)
  if (!preparacionIntegra(preparacion, { gameId: sesion.partidoId })) return no('preparacion-no-disponible')
  if (!coincidenAtribucionYPreparacion(v.estado.atribucion, preparacion)) return no('atribucion-no-coincide-con-preparacion')
  const de = sesion.base.estado.atribucion ? sesion.base.estado.atribucion.version : null
  const a = v.estado.atribucion.version
  const refrescada = de !== a ? { de, a } : null
  return {
    tipo: 'verificada',
    atribucionRefrescada: refrescada,
    comprobarCapacidad: true,
    sesion: {
      ...sesion,
      base: { estado: v.estado, ultimoClientSeq: sesion.base.ultimoClientSeq },
      etiquetas: v.etiquetas,
      verificacion: { nivel: 'verificada', verificadaRev: v.cursor.rev, ...(refrescada ? { atribucionRefrescada: refrescada } : {}) },
      // Los datos para mostrar viajan con la base nueva (se validaron contra su atribución). Si no son utilizables se conservan los anteriores.
      ...(v.visualizacion.estado === 'ok' ? { visualizacion: v.visualizacion.datos } : {}),
    },
    entradas: [],
  }
}

// ---------------------------------------------------------------------------
// Reanudar tras un rechazo definitivo (explícito, con insumos frescos y confirmación del operador).
// ---------------------------------------------------------------------------

/**
 * La cola está detenida por un rechazo definitivo. Para seguir se necesitan: confirmación explícita del operador, una
 * instantánea FRESCA cuyo cursor coincida con el que ya recibimos (el rechazo consumió su número y no cambió la revisión) y,
 * si lo rechazado fue el inicio, una preparación fresca, íntegra y lista. La base se reemplaza por la instantánea fresca
 * (verificada); lo no aplicado queda como historia y NADA se reintroduce solo: lo que siga lo ordena la persona con cmdId nuevos.
 */
export function reanudarTrasRechazo(sesion, entradas, { cuerpoEstado, preparacion, confirmadoPorOperador }) {
  const no = (motivo, detalle) => ({ tipo: 'rechazo', motivo, ...(detalle ? { detalle } : {}) })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return no(bloqueo)
  if (!sesion.detenida || sesion.detenida.causa !== 'rechazo-definitivo') return no('no-reanudable')
  if (confirmadoPorOperador !== true) return no('falta-confirmacion')
  if (entradas.some((e) => e.estado === 'enviando')) return no('entrada-en-vuelo')
  const v = validarCuerpoEstado(cuerpoEstado, { gameId: sesion.partidoId, deviceId: sesion.deviceId })
  if (!v.ok) return no('instantanea-invalida', v.motivo)
  if (v.cursor.ultimoClientSeq !== sesion.base.ultimoClientSeq || v.cursor.rev !== sesion.base.estado.rev) {
    return no('servidor-no-coincide', { servidor: v.cursor, local: { ultimoClientSeq: sesion.base.ultimoClientSeq, rev: sesion.base.estado.rev } })
  }
  if (sesion.inicio === 'sin-iniciar') {
    if ((v.estado.partido.estado ?? null) !== 'programado') return no('partido-ya-no-programado')
    if (!preparacionIntegra(preparacion, { gameId: sesion.partidoId })) return no('preparacion-no-disponible')
    const r = evaluarPreparacion(preparacion, { gameId: sesion.partidoId })
    if (!r.lista) return no(r.motivo, r.detalle)
    if (!coincidenAtribucionYPreparacion(v.estado.atribucion, preparacion)) return no('atribucion-no-coincide-con-preparacion')
  }
  const c = colaDeFilas(sesion, entradas)
  if (!c.ok) return no('registro-corrupto', c.motivo)
  const r = reanudar(c.cola, v.cursor)
  if (!r.ok) return no(r.motivo)
  const filas = []
  entradas.forEach((f, i) => {
    const despues = r.cola.entradas[i]
    if (despues.estado !== f.estado) filas.push({ ...f, estado: despues.estado, motivoNoAplicada: despues.motivoNoAplicada, reserva: 0 })
  })
  const nueva = {
    ...sesion,
    base: { estado: v.estado, ultimoClientSeq: v.cursor.ultimoClientSeq },
    verificacion: { nivel: 'verificada', verificadaRev: v.cursor.rev },
    etiquetas: v.etiquetas,
    siguienteSeq: r.cola.siguienteSeq,
    detenida: null,
  }
  return { tipo: 'ok', sesion: nueva, entradas: filas, resultado: { reanudada: true } }
}

// ---------------------------------------------------------------------------
// Reanudar tras una parada «no-autorizado» (HTTP 401) — REPORT_130. ÚNICA parada de transporte que se puede borrar, y solo así.
//
//   Qué prueba cada cosa (nada de esto lo decide un booleano de la interfaz):
//     - la parada que se borra es EXACTAMENTE la que la persona vio: `evidencia.paradaEn`/`paradaCmdId` deben coincidir con la
//       guardada, y su clase debe ser no-autorizado/401 (409, protocolo, 422, rechazo definitivo y divergencia NO entran aquí);
//     - la instantánea es una lectura protegida del MISMO partido y dispositivo (`validarCuerpoEstado`): el servidor solo la
//       entrega a una credencial vigente (revocada, vencida o «solo recibos» reciben 401), así que recibirla es la prueba de que
//       la credencial sigue autorizada AHORA;
//     - esa instantánea se compara con la base CONFIRMADA por las reglas de siempre (`compararInstantanea`): lo guardado sin enviar
//       no es estado del servidor y no cuenta; una diferencia real es una divergencia (que se registra, no se borra nada);
//     - la evidencia está atada a la revisión (`evidencia.revision` = la de la sesión que se leyó ANTES de pedir la instantánea; el
//       almacén además exige esa misma revisión al escribir): si algo escribió en medio, se rechaza y hay que empezar otro intento;
//     - no queda ninguna orden «enviando» ni una orden incierta señalada por la parada sin resolver;
//     - confirmación explícita de la persona.
//   Efecto: SOLO `detenida` pasa a null y la base queda «verificada». Órdenes, sobres, recibos, huellas, secuencias y reservas no se
//   tocan. La autorización del servidor sigue siendo la autoridad en cada petición: esto no impide una revocación posterior.
// ---------------------------------------------------------------------------

export function reanudarTrasNoAutorizado(sesion, entradas, { cuerpoEstado, evidencia, confirmadoPorOperador, ctx }) {
  const no = (motivo, detalle) => ({ tipo: 'rechazo', motivo, ...(detalle !== undefined ? { detalle } : {}) })
  const bloqueo = bloqueoDeSesion(sesion)
  if (bloqueo) return no(bloqueo)
  const d = sesion.detenida
  if (!d || d.causa !== CAUSA_TRANSPORTE || d.clase !== 'no-autorizado' || d.http !== 401 || (d.subtipo ?? null) !== null) return no('parada-no-recuperable')
  if (confirmadoPorOperador !== true) return no('falta-confirmacion')
  if (!esObjeto(evidencia) || evidencia.revision !== sesion.revision || evidencia.paradaEn !== (d.en ?? null) || evidencia.paradaCmdId !== (d.cmdId ?? null)) return no('evidencia-obsoleta')
  if (entradas.some((e) => e.estado === 'enviando')) return no('entrada-en-vuelo')
  if (d.cmdId !== null && d.cmdId !== undefined) {
    const señalada = entradas.find((e) => e.cmdId === d.cmdId)
    if (señalada && vivas(señalada)) return no('orden-incierta-sin-resolver')
  }
  const c = compararInstantanea(sesion, entradas, cuerpoEstado, ctx)
  if (c.tipo !== 'verificada') return c // divergencia (se registra como siempre), instantánea inválida, no aplicable…
  const sinParada = (x) => ({ ...x, detenida: null })
  return {
    ...c,
    tipo: 'ok',
    sesion: sinParada(c.sesion),
    ...(c.sesionSinVisualizacion ? { sesionSinVisualizacion: sinParada(c.sesionSinVisualizacion) } : {}),
    resultado: { reanudada: true, verificadaRev: sesion.base.estado.rev, desdeRevision: sesion.revision, atribucionRefrescada: c.atribucionRefrescada ?? null },
  }
}

// ---------------------------------------------------------------------------
// Vista derivada (se publica DESPUÉS de confirmar la transacción).
// ---------------------------------------------------------------------------

export function vistaDe(sesion, entradas, ctx = {}) {
  const base = {
    id: sesion.id,
    revision: sesion.revision,
    nivelBase: sesion.verificacion.nivel,
    verificadaRev: sesion.verificacion.verificadaRev,
    atribucionRefrescada: sesion.verificacion.atribucionRefrescada ?? null,
    confirmado: { estado: sesion.base.estado, ultimoClientSeq: sesion.base.ultimoClientSeq, rev: sesion.base.estado.rev },
    inicio: sesion.inicio,
    detenida: sesion.detenida,
    divergencia: sesion.divergencia,
    pendientes: entradas.filter((e) => e.estado === 'pendiente').length,
    enviando: entradas.filter((e) => e.estado === 'enviando').length,
    puntuacion: puntuacionHabilitada(sesion, entradas),
    uso: sesion.uso,
  }
  const c = colaDeFilas(sesion, entradas)
  if (!c.ok) return { ...base, ok: false, motivo: 'registro-corrupto', estadoProvisional: null }
  const prov = provisionalDe(sesion, c.cola, ctx)
  if (!prov.ok) return { ...base, ok: false, motivo: 'divergencia-local', divergenciaLocal: prov.divergencia, estadoProvisional: null }
  return { ...base, ok: true, estadoProvisional: prov.estado }
}
