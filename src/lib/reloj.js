import { db, uid } from '../db'
import { restanteMs, duracionMs, corriendo, PERIODOS } from './reloj-calculo'
import { marcaDePeriodo, periodoVisible } from './marcador-calculo'
import { evaluarProntitud } from './prontitud-plantilla'

// Acciones del reloj: lo que lo mueve y lo guarda.
// La cuenta en sí vive en reloj-calculo.js, sin base de datos, para poder probarla.
export * from './reloj-calculo'

// ---------------------------------------------------------------------------
// Comandos auditados.
//
// Cada comando es UNA transacción: comprueba lo que la pantalla creía ver (el
// estado observado), comprueba su precondición, cambia el partido y agrega su
// registro en `auditoriaReloj`. Si algo falla, no queda nada. Un comando que se
// rechaza no escribe nada y no se reintenta solo.
//
// El estado observado es { seq, estado, relojEstado, relojRestante, relojDesde }:
// el último seq de auditoría del partido más sus campos guardados (no el tiempo
// efectivo, que cambia con el paso del tiempo). Se lee en una sola transacción
// de lectura (ver `observadoDe` y `ultimoSeqAuditoria`) y se compara dentro de
// la de escritura. El seq atrapa cualquier secuencia auditada, aunque los
// campos vuelvan a verse iguales; los campos atrapan lo que no dejó registro.
// Así, un "Detener" de una pestaña vieja no puede parar una corrida más nueva.
//
// La auditoría es interna y vive aparte de los eventos del marcador: Deshacer,
// Rehacer y Anular no la ven, y los comandos no tocan el rehacer pendiente.
// El actor es la identidad del prototipo (la sesión local), no una identidad
// verificada.
// ---------------------------------------------------------------------------

/** Último seq de auditoría de un partido (0 si no tiene registros). */
export async function ultimoSeqAuditoria(partidoId) {
  const ultimo = await db.auditoriaReloj
    .where('[partidoId+seq]')
    .between([partidoId, -Infinity], [partidoId, Infinity], true, true)
    .last()
  return ultimo?.seq ?? 0
}

/** Lo que la pantalla observó: el seq de auditoría y los campos guardados del partido. */
export const observadoDe = (partido, seq) => ({
  seq,
  estado: partido.estado ?? null,
  relojEstado: partido.relojEstado ?? null,
  relojRestante: partido.relojRestante ?? null,
  relojDesde: partido.relojDesde ?? null,
})

const coincide = (observado, partido, seq) =>
  !!observado && JSON.stringify(observado) === JSON.stringify(observadoDe(partido, seq))

// Los campos guardados y, aparte, el tiempo efectivo (derivado, cambia con el tiempo).
const foto = (p, liga, ahora) => ({
  estado: p.estado ?? null,
  relojEstado: p.relojEstado ?? null,
  relojRestante: p.relojRestante ?? null,
  relojDesde: p.relojDesde ?? null,
  efectivoMs: restanteMs(p, liga, ahora),
})

/**
 * Ejecuta un comando.
 *   estados:  estados del partido en los que el comando tiene sentido.
 *   decidir:  ({ partido, liga, eventos, ahora }) → { rechazo } | { cambios, comando, extra? }
 *   tablasExtra / verificar: solo para comandos que deben leer más tablas en la misma
 *             transacción (hoy, el inicio). `verificar({ partido, liga })` corre después de
 *             la comprobación del reloj observado y antes de cualquier escritura; devuelve
 *             { ok: true } o { ok: false, motivo, detalle? }.
 */
function comando({ partidoId, observado, estados, origen = 'consola', tablasExtra = [], verificar, decidir }) {
  return db.transaction('rw', [db.partidos, db.ligas, db.eventos, db.meta, db.auditoriaReloj, ...tablasExtra], async () => {
    const ahora = Date.now()
    const partido = await db.partidos.get(partidoId)
    if (!partido || !estados.includes(partido.estado)) {
      return { ok: false, motivo: 'partido-no-disponible', estado: partido?.estado ?? null }
    }
    // Un ligaId ausente, nulo, vacío o que no es texto no es una clave utilizable: db.ligas.get lanzaría.
    // Solo el inicio (el único con `verificar`) lo vuelve un rechazo estructurado, y lo hace después de
    // las comprobaciones de estado y de reloj; los demás comandos se comportan como siempre.
    const ligaLegible = !verificar || (typeof partido.ligaId === 'string' && partido.ligaId !== '')
    const liga = ligaLegible ? await db.ligas.get(partido.ligaId) : undefined
    const eventos = await db.eventos.where('partidoId').equals(partidoId).toArray()
    const seq = await ultimoSeqAuditoria(partidoId)

    // Primero lo que la pantalla creía ver; solo si coincide se mira la precondición del comando.
    if (!coincide(observado, partido, seq)) return { ok: false, motivo: 'reloj-desactualizado' }

    if (verificar) {
      const veredicto = await verificar({ partido, liga })
      if (!veredicto.ok) return veredicto
    }

    const decision = decidir({ partido, liga, eventos, ahora })
    if (decision.rechazo) return { ok: false, motivo: decision.rechazo }

    const despues = { ...partido, ...decision.cambios }
    const sesion = origen === 'consola' ? await db.meta.get('sesion') : null
    await db.partidos.update(partidoId, decision.cambios)
    await db.auditoriaReloj.add({
      id: uid(),
      partidoId,
      seq: seq + 1,
      reloj: 'juego',
      comando: decision.comando,
      periodo: periodoVisible(eventos, liga?.deporte),
      antes: foto(partido, liga, ahora),
      despues: foto(despues, liga, ahora),
      ts: new Date(ahora).toISOString(),
      origen,
      actorId: origen === 'consola' ? sesion?.cuentaId ?? null : null,
      ...decision.extra,
    })
    return { ok: true, comando: decision.comando }
  })
}

/**
 * Lee, dentro de la transacción de inicio, los equipos del partido y sus plantillas, y
 * decide con evaluarProntitud (Decisión 115). Es la autoridad: la pantalla no la sustituye.
 */
async function verificarProntitud({ partido, liga }) {
  const ids = [partido.localId, partido.visitaId].filter((id) => typeof id === 'string' && id !== '')
  const equipos = (await db.equipos.bulkGet(ids)).filter(Boolean)
  const jugadores = []
  for (const id of new Set(ids)) jugadores.push(...(await db.jugadores.where('equipoId').equals(id).toArray()))
  const r = evaluarProntitud({ partido, liga, equipos, jugadores })
  return r.lista ? { ok: true } : { ok: false, motivo: r.motivo, detalle: r.detalle }
}

/**
 * Comienza el partido: queda vivo con el reloj cargado y detenido. Solo el inicio
 * exige plantillas listas; reanudar, detener, cambiar de periodo y cerrar no.
 */
export function iniciarPartido(partidoId, observado) {
  return comando({
    partidoId, observado, estados: ['programado'],
    tablasExtra: [db.equipos, db.jugadores],
    verificar: verificarProntitud,
    decidir: ({ liga, ahora }) => ({
      comando: 'inicio-partido',
      cambios: {
        estado: 'vivo',
        inicio: new Date(ahora).toISOString(),
        relojEstado: 'detenido',
        relojRestante: duracionMs(liga),
        relojDesde: null,
      },
    }),
  })
}

export function arrancarReloj(partidoId, observado) {
  return comando({
    partidoId, observado, estados: ['vivo'],
    decidir: ({ partido, liga, ahora }) => {
      if (corriendo(partido)) return { rechazo: 'ya-corriendo' }
      const falta = restanteMs(partido, liga, ahora)
      if (falta === 0) return { rechazo: 'sin-tiempo' }
      return {
        comando: 'arrancar',
        cambios: { relojEstado: 'corriendo', relojRestante: falta, relojDesde: ahora },
      }
    },
  })
}

/**
 * Detiene el reloj. Manual (por defecto) o automático al llegar a cero
 * (`origen: 'sistema'`): el automático solo actúa si el reloj corre y ya no
 * queda tiempo, y queda como `parada-automatica`, sin actor.
 */
export function detenerReloj(partidoId, observado, { origen = 'consola' } = {}) {
  return comando({
    partidoId, observado, estados: ['vivo'], origen,
    decidir: ({ partido, liga, ahora }) => {
      if (!corriendo(partido)) return { rechazo: 'no-corre' }
      const falta = restanteMs(partido, liga, ahora)
      const automatico = origen === 'sistema'
      if (automatico && falta !== 0) return { rechazo: 'aun-hay-tiempo' }
      return {
        comando: automatico ? 'parada-automatica' : 'detener',
        cambios: { relojEstado: 'detenido', relojRestante: falta, relojDesde: null },
        // Cuándo llegó a cero, derivado de lo guardado (no observado por nadie).
        extra: automatico ? { ceroEnDerivado: (partido.relojDesde ?? 0) + (partido.relojRestante ?? 0) } : undefined,
      }
    },
  })
}

/**
 * Cierra el período en curso y deja el reloj listo para el siguiente.
 *
 * Una sola transacción: se comprueba el partido, el periodo y la marca de
 * frontera que mostraba la pantalla, el estado observado del reloj, y recién
 * entonces se anota la transición, se reinicia el reloj y se registra la
 * auditoría. Un doble toque o una pestaña vieja no escriben nada. No toca el
 * rehacer pendiente.
 *
 * Devuelve { ok: true } o { ok: false, motivo, estado? }.
 */
export function siguientePeriodo(partido, liga, periodo, marcaPeriodo, observado) {
  const partidoId = partido.id
  return db.transaction('rw', db.eventos, db.partidos, db.ligas, db.meta, db.auditoriaReloj, async () => {
    const ahora = Date.now()
    const actual = await db.partidos.get(partidoId)
    if (!actual || actual.estado !== 'vivo') {
      return { ok: false, motivo: 'partido-no-disponible', estado: actual?.estado ?? null }
    }
    const ligaActual = (await db.ligas.get(actual.ligaId)) || liga
    const previos = await db.eventos.where('partidoId').equals(partidoId).toArray()

    const visible = periodoVisible(previos, ligaActual?.deporte)
    if (visible !== periodo || marcaDePeriodo(previos) !== marcaPeriodo) {
      return { ok: false, motivo: 'periodo-desactualizado' }
    }
    const seqAuditoria = await ultimoSeqAuditoria(partidoId)
    if (!coincide(observado, actual, seqAuditoria)) return { ok: false, motivo: 'reloj-desactualizado' }
    if (visible >= (PERIODOS[ligaActual?.deporte] || 2)) {
      return { ok: false, motivo: 'ultimo-periodo' }
    }

    const seq = previos.reduce((m, e) => Math.max(m, e.seq), 0) + 1
    const eventoPeriodoId = uid()
    await db.eventos.add({
      id: eventoPeriodoId,
      partidoId,
      seq,
      tipo: 'periodo',
      periodo,
      anulado: false,
      creadoEn: ahora,
    })

    const cambios = {
      relojEstado: 'detenido',
      relojRestante: duracionMs(ligaActual),
      relojDesde: null,
    }
    await db.partidos.update(partidoId, cambios)

    const sesion = await db.meta.get('sesion')
    await db.auditoriaReloj.add({
      id: uid(),
      partidoId,
      seq: seqAuditoria + 1,
      reloj: 'juego',
      comando: 'reinicio-periodo',
      periodo: visible,
      periodoDespues: visible + 1,
      eventoPeriodoId,
      antes: foto(actual, ligaActual, ahora),
      despues: foto({ ...actual, ...cambios }, ligaActual, ahora),
      ts: new Date(ahora).toISOString(),
      origen: 'consola',
      actorId: sesion?.cuentaId ?? null,
    })
    return { ok: true }
  })
}

/**
 * Cierra el partido: detiene el reloj en su tiempo efectivo, lo marca final y
 * registra la auditoría, todo junto. No toca ninguna cuenta ni saldo.
 */
export function cerrarPartido(partidoId, observado) {
  return comando({
    partidoId, observado, estados: ['vivo'],
    decidir: ({ partido, liga, ahora }) => ({
      comando: 'cierre-partido',
      cambios: {
        estado: 'final',
        relojEstado: 'detenido',
        relojRestante: restanteMs(partido, liga, ahora),
        relojDesde: null,
      },
    }),
  })
}
