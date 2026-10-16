import { JUGADORES_NUMERADOS } from '../../../src/lib/motor/prueba/auxiliares-preparacion.js'

// Datos SINTÉTICOS. Ningún nombre, equipo ni persona es real. Los tokens solo existen en
// pruebas locales. La plantilla es la misma que usa el banco del motor (E1 contra E2), de
// modo que los mismos guiones se pueden correr en el adaptador de memoria y aquí.

export const T0 = 1_700_000_000_000
export const SEMILLA_TOKEN = 'semilla-sintetica-solo-pruebas'

let contador = 0
export const nuevaLiga = () => `LIGA${++contador}`

export function payloadDeLiga(ligaId, { minutosPorPeriodo = 10 } = {}) {
  return {
    liga: { id: ligaId, nombre: `Liga sintética ${ligaId}`, deporte: 'baloncesto', minutosPorPeriodo },
    equipos: [
      { id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' },
      { id: 'E3', nombre: 'Gama' }, { id: 'E4', nombre: 'Delta' },
    ],
    jugadores: [
      ...JUGADORES_NUMERADOS.map((j) => ({
        id: j.id, equipoId: j.equipoId, nombre: j.nombre, dorsal: j.dorsal ?? null, activo: j.activo !== false, personaId: `persona-${j.id}`,
      })),
      { id: 'K1', equipoId: 'E3', nombre: 'Gil Tercero', dorsal: 4, activo: true, personaId: 'persona-K1' },
      { id: 'K2', equipoId: 'E4', nombre: 'Hugo Cuarto', dorsal: 5, activo: true, personaId: 'persona-K2' },
    ],
    partidos: [
      { id: 'P', localId: 'E1', visitaId: 'E2', inicio: null },
      { id: 'Q', localId: 'E3', visitaId: 'E4', inicio: null },
    ],
    credenciales: [
      { token: `tok-sintetico-P-${ligaId}-0001`, partidoId: 'P', deviceId: 'tel-P', actorId: 'actor-P' },
      { token: `tok-sintetico-Q-${ligaId}-0001`, partidoId: 'Q', deviceId: 'tel-Q', actorId: 'actor-Q' },
    ],
  }
}

export const tokenDe = (ligaId, partido) => `tok-sintetico-${partido}-${ligaId}-0001`
