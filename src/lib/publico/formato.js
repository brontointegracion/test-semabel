// ---------------------------------------------------------------------------
// Fechas y horas en America/Panama, EXPLÍCITAMENTE: nunca la zona horaria del dispositivo de quien mira. Panamá no usa
// horario de verano (UTC−5 todo el año). Las etiquetas salen de tablas propias en español; Intl solo aporta los números de la
// zona, así que no dependen de qué idiomas tenga cargado el navegador.
// ---------------------------------------------------------------------------

export const ZONA = 'America/Panama'
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const partesFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
})

/** { anio, mes (1-12), dia, hora, minuto, segundo, diaSemana (0 = domingo) } en Panamá, o null si la fecha no es válida. */
export function partesPanama(valor) {
  const ms = typeof valor === 'number' ? valor : Date.parse(valor)
  if (!Number.isFinite(ms)) return null
  const p = Object.fromEntries(partesFmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]))
  return {
    anio: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second,
    diaSemana: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
  }
}

const dos = (n) => String(n).padStart(2, '0')

/**
 * Hora del día en formato de 12 horas con «a. m.» / «p. m.» (REPORT_161): el ÚNICO formato de hora del día de todo el sitio.
 * 0 → «12:00 a. m.», 9 → «9:00 a. m.», 12 → «12:00 p. m.», 13 → «1:00 p. m.», 18 → «6:00 p. m.». Con `segundo` (número) lo agrega:
 * «9:05:09 a. m.». No es para relojes de cuenta regresiva, duraciones ni cronómetros (esos siguen en mm:ss).
 */
export function hora12(hora, minuto, segundo = null) {
  const h = hora % 12 === 0 ? 12 : hora % 12
  return `${h}:${dos(minuto)}${segundo === null ? '' : `:${dos(segundo)}`} ${hora < 12 ? 'a. m.' : 'p. m.'}`
}

/** "7:05 p. m." (hora de Panamá) */
export function horaPanama(valor) {
  const p = partesPanama(valor)
  return p ? hora12(p.hora, p.minuto) : null
}

/** "7:05:09 p. m." (hora de Panamá) */
export function horaCompletaPanama(valor) {
  const p = partesPanama(valor)
  return p ? hora12(p.hora, p.minuto, p.segundo) : null
}

/**
 * "7:05 p. m." en la zona horaria del DISPOSITIVO (las pantallas del prototipo y los avisos de acceso/activación siempre mostraron la hora
 * local; el formato cambia, la zona no). `valor`: ISO o milisegundos; null si no es una fecha válida.
 */
export function horaLocal(valor, conSegundos = false) {
  const ms = typeof valor === 'number' ? valor : Date.parse(valor)
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return hora12(d.getHours(), d.getMinutes(), conSegundos ? d.getSeconds() : null)
}

/** "dom 1 nov" */
export function fechaCortaPanama(valor) {
  const p = partesPanama(valor)
  return p ? `${DIAS[p.diaSemana]} ${p.dia} ${MESES[p.mes - 1]}` : null
}

const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «Miércoles 21 de octubre» (día y mes de Panamá, nombres completos): solo para el marcador grande (REPORT_201). null si la fecha no es válida. */
export function fechaLargaPanama(valor) {
  const p = partesPanama(valor)
  return p ? `${DIAS_LARGOS[p.diaSemana]} ${p.dia} de ${MESES_LARGOS[p.mes - 1]}` : null
}

/** Clave del día calendario en Panamá: "2026-11-01" (sirve para agrupar y comparar días). */
export function claveDiaPanama(valor) {
  const p = partesPanama(valor)
  return p ? `${p.anio}-${dos(p.mes)}-${dos(p.dia)}` : null
}

/** "Hoy" / "Mañana" (según el día de Panamá de `ahoraMs`) o "dom 1 nov". */
export function diaRelativoPanama(valor, ahoraMs) {
  const clave = claveDiaPanama(valor)
  if (clave === null) return null
  if (clave === claveDiaPanama(ahoraMs)) return 'Hoy'
  if (clave === claveDiaPanama(ahoraMs + 86_400_000)) return 'Mañana'
  return fechaCortaPanama(valor)
}

/**
 * Sede que se muestra de un partido. Un partido PROGRAMADO sin sede (nula en el servidor: no hay cancha llamada «Por avisar») se rotula
 * «Por avisar»; uno en juego o terminado sin sede no muestra nada (no se inventa). → texto o null.
 */
export const SEDE_POR_AVISAR = 'Por avisar'
export const textoSede = ({ estado, sede }) => (sede ? sede : (estado === 'programado' ? SEDE_POR_AVISAR : null))
