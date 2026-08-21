import Dexie from 'dexie'
import { partirNombre } from './lib/identidad'

// Todo vive en el navegador. IndexedDB via Dexie: cada tabla es la que
// tendría el backend, para que cambiar a un servidor no cambie las pantallas.
export const db = new Dexie('sebel')

db.version(1).stores({
  canchas: 'id, ciudad',
  ligas: 'id, codigo, estado',
  equipos: 'id, ligaId',
  jugadores: 'id, ligaId, equipoId',
  partidos: 'id, ligaId, canchaId, estado, codigo, inicio',
  eventos: 'id, partidoId, [partidoId+seq], seq',
  cuenta: 'id',
})

db.version(2).stores({
  canchas: 'id, pais, provincia',
  ligas: 'id, codigo, estado, deporte, pais, provincia',
  noticias: 'id, publicada',
  meta: 'id',
})

// Cada cosa que tiene dirección propia se busca por su código corto, no por el id.
db.version(3).stores({
  canchas: 'id, pais, provincia, codigo',
  jugadores: 'id, ligaId, equipoId, codigo',
  noticias: 'id, publicada, codigo',
})

// El equipo pasa a ser una cosa con página propia, y aparecen los votos.
db.version(4).stores({
  equipos: 'id, ligaId, codigo',
  votos: 'id, partidoId',
})

// Categorías (40+, 45+…), torneos internacionales, y la persona detrás de la
// ficha: el mismo señor puede estar inscrito en su liga y convocado a un torneo.
db.version(5).stores({
  ligas: 'id, codigo, estado, deporte, pais, provincia, categoria, internacional',
  jugadores: 'id, ligaId, equipoId, codigo, personaId',
})

// Retos entre ligas: dos ligas de la misma categoría se miden sin viajar.
db.version(6).stores({
  retos: 'id, codigo, estado',
})

// Nombre por separado y ficha activa/inactiva — ver docs/roster/ROSTER_MVP_SPEC.md.
// El índice de jugadores no cambia: nombrePila, apellido y activo son
// propiedades simples que nunca se consultan con .where(), así que no hace
// falta indexarlas. Esta versión solo existe para enganchar el upgrade() de
// abajo, que repara personaId y no toca id/codigo/eventos/partidos de nadie.
db.version(7).stores({
  jugadores: 'id, ligaId, equipoId, codigo, personaId',
}).upgrade((tx) => tx.table('jugadores').toCollection().modify((j) => {
  // Cada fila sin personaId es una persona nueva y distinta — el id se genera
  // aquí adentro, por fila, para que nunca dos jugadores terminen compartiendo
  // uno por accidente.
  if (!j.personaId) j.personaId = uid()

  // Relleno de baja confianza, editable por el organizador — nunca dato
  // autoritativo. nombre no se toca: sigue siendo lo que ya se mostraba.
  if (j.nombrePila === undefined) {
    const partido = partirNombre(j.nombre)
    j.nombrePila = partido.nombrePila
    j.apellido = partido.apellido
  }
}))

export const uid = () => Math.random().toString(36).slice(2, 10)

export async function resetear() {
  await db.delete()
  location.reload()
}
