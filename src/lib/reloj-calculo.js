// ---------------------------------------------------------------------------
// La cuenta del reloj, sin base de datos de por medio, para poder probarla.
//
// No se muestra cuánto lleva jugado sino cuánto FALTA, que es lo que la gente
// mira: "segundo cuarto, quedan 3:30". Corre hacia abajo y se detiene, porque
// en baloncesto el reloj para todo el tiempo.
//
// Lo que se guarda no es un contador sino el momento en que arrancó. Así el
// reloj sobrevive a recargar la página y no se atrasa si el teléfono se duerme.
// ---------------------------------------------------------------------------

import { estadoDeReglas } from './reglas-categoria.js'

export const PERIODOS = { baloncesto: 4, futsal: 2 }
export const MINUTOS_POR_PERIODO = { baloncesto: 10, futsal: 20 }

export const nombrePeriodo = (deporte) => (deporte === 'baloncesto' ? 'cuarto' : 'tiempo')

export function duracionMs(liga) {
  // Duración explícita del partido; si no hay, la del preset de su categoría (reglas fijadas al iniciar); si no, la del deporte.
  // Solo reglas VÁLIDAS (estadoDeReglas): unas inválidas no aportan duración (las órdenes que la necesitan se bloquean).
  const preset = estadoDeReglas(liga).reglas?.minutosPorPeriodo ?? null
  const min = liga?.minutosPorPeriodo ?? preset ?? MINUTOS_POR_PERIODO[liga?.deporte] ?? 10
  return min * 60 * 1000
}

export const corriendo = (partido) => partido?.relojEstado === 'corriendo'

/** Cuánto falta, en milisegundos. Nunca baja de cero. */
export function restanteMs(partido, liga, ahora = Date.now()) {
  if (!partido) return 0
  const base = partido.relojRestante ?? duracionMs(liga)
  if (corriendo(partido) && partido.relojDesde) {
    return Math.max(0, base - (ahora - partido.relojDesde))
  }
  return Math.max(0, base)
}

/** 210000 → "03:30". Redondea hacia arriba: el reloj de cancha no muestra 00:59 con un segundo entero por delante. */
export const mmss = (ms) => {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
