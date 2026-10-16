import { crearPreparacion } from '../preparacion'

// Contextos de preparación de prueba, con plantillas NUMERADAS. No se reutiliza JUGADORES_DE_PRUEBA
// (banco.js): esa plantilla no trae número y, evaluada como preparación, nunca estaría lista.
// Son fixtures sintéticos armados con la misma función que usa el adaptador real; no prueban recuperación
// completa ni autentican a nadie.

export const LIGA_DE_PRUEBA = { id: 'L1' }
export const EQUIPOS_DE_PRUEBA = [
  { id: 'E1', ligaId: 'L1', nombre: 'Alfa' },
  { id: 'E2', ligaId: 'L1', nombre: 'Beta' },
]
export const JUGADORES_NUMERADOS = [
  { id: 'J1', equipoId: 'E1', nombre: 'Ana Pérez', dorsal: 0 },
  { id: 'J2', equipoId: 'E1', nombre: 'Beto Gómez', dorsal: 7 },
  { id: 'JX', equipoId: 'E1', nombre: 'Dario Inactivo', activo: false },
  { id: 'J9', equipoId: 'E2', nombre: 'Eva Visita', dorsal: 0 },
  { id: 'J8', equipoId: 'E2', nombre: 'Fede Visita', dorsal: 9 },
]

/** Contexto listo para comenzar el partido `gameId` (E1 contra E2). `cambios` reemplaza campos de entrada. */
export function preparacionDePrueba(gameId = 'P', cambios = {}) {
  return crearPreparacion({
    gameId,
    partido: { ligaId: 'L1', localId: 'E1', visitaId: 'E2' },
    liga: { ...LIGA_DE_PRUEBA },
    equipos: EQUIPOS_DE_PRUEBA.map((e) => ({ ...e })),
    jugadores: JUGADORES_NUMERADOS.map((j) => ({ ...j })),
    consultaEquipos: ['E1', 'E2'],
    ...cambios,
  })
}

/** Plantilla cambiada (un número distinto): otra versión, y sigue lista. */
export const preparacionConCambioDeNumero = (gameId = 'P') => preparacionDePrueba(gameId, {
  jugadores: JUGADORES_NUMERADOS.map((j) => (j.id === 'J2' ? { ...j, dorsal: 8 } : { ...j })),
})

/** Plantilla con dos activos con el mismo número en E1: otra versión, y NO está lista. */
export const preparacionNoLista = (gameId = 'P') => preparacionDePrueba(gameId, {
  jugadores: JUGADORES_NUMERADOS.map((j) => (j.id === 'J2' ? { ...j, dorsal: 0 } : { ...j })),
})
