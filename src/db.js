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

export const uid = () => Math.random().toString(36).slice(2, 10)

export async function resetear() {
  await db.delete()
  location.reload()
}
