import Dexie from 'dexie'

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

export const uid = () => Math.random().toString(36).slice(2, 10)

export async function resetear() {
  await db.delete()
  location.reload()
}
