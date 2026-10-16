import { mmss } from '../reloj-calculo.js'
import { restanteVisible } from './reloj-servidor.js'

/**
 * Cómo se muestra el reloj de un partido, SOLO con lo que confirmó el servidor.
 *   → { texto: 'mm:ss' | null, nota: string | null, detenido: boolean }
 *
 * - corriendo y confiable      → cuenta regresiva con la hora estimada del servidor (nunca la del dispositivo).
 * - detenido                   → el restante confirmado, nota «Reloj detenido»; con 00:00, «Fin del período»
 *                                (00:00 NO significa que el partido terminó: eso solo lo dice el estado `final`).
 * - dato viejo o muestra rota  → el último valor confirmado, congelado y con la nota «Sin actualizar»
 *                                (no se inventa una pausa ni se sigue contando como si estuviera fresco).
 * - sin restante confirmado    → '--:--'.
 */
export function vistaReloj({ estado, reloj, muestra, mono, relojConfiable }) {
  if (estado !== 'vivo') return { texto: null, nota: null, detenido: true }
  if (reloj.restanteMs === null || !muestra) return { texto: '--:--', nota: 'Reloj sin confirmar', detenido: true }
  if (!relojConfiable) {
    const confirmado = restanteVisible({ reloj, muestra, mono: muestra.monoMedio })
    return { texto: mmss(confirmado), nota: 'Sin actualizar', detenido: true }
  }
  const restante = restanteVisible({ reloj, muestra, mono })
  if (reloj.estado === 'corriendo' && restante > 0) return { texto: mmss(restante), nota: null, detenido: false }
  return { texto: mmss(restante), nota: restante === 0 ? 'Fin del período' : 'Reloj detenido', detenido: true }
}

/** Iniciales de un nombre para el escudo de texto: «Los Tigres» → «LT». */
export function iniciales(nombre) {
  const palabras = String(nombre).trim().split(/\s+/u).filter(Boolean)
  const letras = palabras.length > 1 ? [palabras[0], palabras[1]].map((p) => [...p][0]) : [...(palabras[0] ?? '')].slice(0, 2)
  return letras.join('').toLocaleUpperCase('es') || '?'
}
