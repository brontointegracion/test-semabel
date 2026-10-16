// ---------------------------------------------------------------------------
// Forma del estado del motor y conversión (solo lectura) desde las filas que
// hoy guarda la aplicación. No importa la base de datos: recibe filas ya leídas.
//
//   estado = {
//     gameId, rev, auditSeq, corridaSeq, cursorReloj, atribucion,
//     config:  { deporte, minutosPorPeriodo },
//     partido: { estado, inicio?, relojEstado, relojRestante, relojDesde },
//     eventos: [...],
//   }
//
// rev          Revisión autoritativa: sube 1 por cada orden aceptada.
// auditSeq     Último seq de auditoría del reloj.
// corridaSeq   Identidad de la corrida en curso: el seq de auditoría del
//              'arrancar' que la empezó (null si el reloj no corre). No
//              depende de ninguna hora.
// cursorReloj  Cursor de tiempo de confianza: la última hora de acción que
//              pasó la validación de una orden que usa tiempo transcurrido.
//              Las horas sin validar (puntos, faltas…) nunca lo tocan.
// ---------------------------------------------------------------------------

/**
 * Los tres campos guardados del reloj, juntos. Es el único lugar donde el motor
 * los arma; así queda claro que describe cambios como datos y no escribe nada.
 */
export const camposDeReloj = (relojEstado, relojRestante, relojDesde) => ({
  relojEstado, relojRestante, relojDesde,
})

export const configDe = (liga) => ({
  deporte: liga?.deporte ?? 'baloncesto',
  minutosPorPeriodo: liga?.minutosPorPeriodo ?? null,
})

export function crearEstado({
  gameId, config, partido, eventos = [], auditSeq = 0, corridaSeq = null, cursorReloj = null, rev = 0,
  atribucion = null,
}) {
  return {
    gameId,
    rev,
    auditSeq,
    corridaSeq,
    cursorReloj,
    // Contexto de atribución de confianza (ver atribucion.js). Sin él, los puntos y las faltas nuevos se rechazan.
    atribucion,
    config: { deporte: 'baloncesto', minutosPorPeriodo: null, ...config },
    partido: {
      estado: null, ...camposDeReloj(null, null, null), ...partido,
    },
    eventos: eventos.map((e) => ({ ...e })).sort((a, b) => a.seq - b.seq),
  }
}

// Comandos que, si aparecen DESPUÉS de un arranque, significan que esa corrida ya terminó
// (o que el reloj se detuvo y se reanudó sin registro): el arranque ya no identifica la corrida actual.
const CIERRAN_CORRIDA = new Set([
  'detener', 'parada-automatica', 'cierre-partido', 'reinicio-periodo', 'inicio-partido', 'correccion-reloj',
])

/**
 * Identidad de la corrida en curso a partir de las filas.
 * Un arranque registrado solo cuenta si (a) es el último y ninguna transición del reloj
 * vino después, y (b) su estado registrado coincide con el estado actual (mismo ancla y
 * mismo restante). Si no, la corrida actual no tiene registro propio y se identifica de
 * forma explícita como heredada, con el último seq de auditoría para no repetirse.
 */
function corridaDe(partido, filas, auditSeq) {
  if (partido.relojEstado !== 'corriendo') return null
  const heredada = `legacy:${partido.relojDesde}:${auditSeq}`
  let i = filas.length - 1
  while (i >= 0 && filas[i].comando !== 'arrancar') i -= 1
  if (i < 0) return heredada
  if (filas.slice(i + 1).some((f) => CIERRAN_CORRIDA.has(f.comando))) return heredada
  const d = filas[i].despues
  const coincide = d && d.relojEstado === 'corriendo'
    && d.relojDesde === partido.relojDesde && d.relojRestante === partido.relojRestante
  return coincide ? filas[i].seq : heredada
}

/**
 * Cursor de tiempo de reloj de confianza a partir de las filas. Solo cuentan filas con
 * evidencia que se puede comprobar, igual que las reglas del motor:
 *   arrancar              su hora debe ser el ancla que registró;
 *   detener / parada /    solo si el reloj corría (cerrar con el reloj detenido NO cuenta)
 *   cierre                y su hora no puede ser anterior al ancla de esa corrida.
 * Las demás filas (correcciones, cambios de periodo, inicio) y los eventos de marcador no
 * cuentan. Una fila que no se puede comprobar se ignora: un cursor demasiado bajo solo es
 * permisivo; uno demasiado alto rechazaría órdenes buenas.
 */
function cursorDe(filas) {
  let max = null
  for (const f of filas) {
    const ts = Date.parse(f.ts)
    if (!Number.isFinite(ts)) continue
    let valida = false
    if (f.comando === 'arrancar') {
      valida = f.despues?.relojEstado === 'corriendo' && f.despues.relojDesde === ts
    } else if (['detener', 'parada-automatica', 'cierre-partido'].includes(f.comando)) {
      valida = f.antes?.relojEstado === 'corriendo' && Number.isFinite(f.antes.relojDesde) && ts >= f.antes.relojDesde
    }
    if (valida && (max === null || ts > max)) max = ts
  }
  return max
}

/** Estado del motor a partir de las filas actuales (partido, liga, eventos, auditoriaReloj). */
export function estadoDeFilas({
  partido, liga, eventos = [], auditoriaReloj = [], rev = 0, atribucion = null,
}) {
  const filas = [...auditoriaReloj].sort((a, b) => a.seq - b.seq)
  const auditSeq = filas.length ? filas[filas.length - 1].seq : 0

  return crearEstado({
    gameId: partido.id,
    config: configDe(liga),
    partido: {
      estado: partido.estado ?? null,
      inicio: partido.inicio,
      ...camposDeReloj(partido.relojEstado ?? null, partido.relojRestante ?? null, partido.relojDesde ?? null),
    },
    eventos,
    auditSeq,
    corridaSeq: corridaDe(partido, filas, auditSeq),
    cursorReloj: cursorDe(filas),
    rev,
    atribucion,
  })
}
