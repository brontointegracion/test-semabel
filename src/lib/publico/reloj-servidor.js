// ---------------------------------------------------------------------------
// Hora del servidor y reloj del partido, SIN restar nunca `Date.now()` del visitante a una hora del servidor.
//
// Una respuesta trae `servidorAhoraMs` (la hora del servidor al responder). Con el reloj MONOTÓNICO del navegador
// (performance.now) se mide cuándo se pidió y cuándo llegó; la hora del servidor se estima en el punto medio del viaje:
//
//     ahoraServidor(m) = servidorAhoraMs + (m − monoMedio)        con incertidumbre ± (monoFin − monoInicio) / 2
//
// El reloj del partido se calcula con ese estimado, no con la hora del dispositivo. Si el dispositivo duerme o su reloj
// salta (el reloj de pared avanza distinto del monotónico), la muestra deja de ser confiable hasta la siguiente respuesta.
// ---------------------------------------------------------------------------

export const MAX_VIAJE_MS = 15_000
export const SALTO_TOLERADO_MS = 1500

/** → { servidorAhoraMs, monoMedio, incertidumbreMs } o null si el viaje no es creíble. */
export function crearMuestra({ servidorAhoraMs, monoInicio, monoFin }) {
  const viaje = monoFin - monoInicio
  if (!Number.isFinite(viaje) || viaje < 0 || viaje > MAX_VIAJE_MS || !Number.isFinite(servidorAhoraMs)) return null
  return { servidorAhoraMs, monoMedio: monoInicio + viaje / 2, incertidumbreMs: viaje / 2 }
}

export const ahoraServidor = (muestra, mono) => muestra.servidorAhoraMs + (mono - muestra.monoMedio)

/**
 * Milisegundos que faltan en el periodo, según lo CONFIRMADO por el servidor.
 *   'corriendo'  → restante − (ahoraServidor − desde), sin bajar de 0 y sin subir de lo confirmado
 *   otro estado  → el restante confirmado, tal cual
 * Sin restante confirmado → null (no se inventa).
 */
export function restanteVisible({ reloj, muestra, mono }) {
  if (reloj.restanteMs === null) return null
  if (reloj.estado !== 'corriendo' || reloj.desdeMs === null) return reloj.restanteMs
  const transcurrido = Math.max(0, ahoraServidor(muestra, mono) - reloj.desdeMs)
  return Math.max(0, Math.min(reloj.restanteMs, reloj.restanteMs - transcurrido))
}

/** ¿Saltó el reloj de pared respecto del monotónico entre dos lecturas? */
export const huboSalto = (anterior, actual) =>
  Math.abs((actual.pared - anterior.pared) - (actual.mono - anterior.mono)) > SALTO_TOLERADO_MS
