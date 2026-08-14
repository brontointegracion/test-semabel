import { db } from '../db'

// ---------------------------------------------------------------------------
// Seguir un equipo o un jugador.
//
// Sin cuenta y sin pedir nada: se guarda igual que la provincia y el deporte.
// La gente no sigue "una liga", sigue a su equipo — y lo que quiere saber es
// cuándo juega y cómo quedó.
//
// Con backend esto pasa a la cuenta y habilita el aviso: "tu equipo juega
// mañana a las 7 en Don Bosco", que es lo que de verdad llena la cancha.
// ---------------------------------------------------------------------------

const vacio = { id: 'siguiendo', equipos: [], jugadores: [] }

const leer = async () => (await db.meta.get('siguiendo')) || vacio

const alternar = (lista, codigo) =>
  lista.includes(codigo) ? lista.filter((c) => c !== codigo) : [...lista, codigo]

export async function seguirEquipo(codigo) {
  const s = await leer()
  await db.meta.put({ ...s, id: 'siguiendo', equipos: alternar(s.equipos || [], codigo) })
}

export async function seguirJugador(codigo) {
  const s = await leer()
  await db.meta.put({ ...s, id: 'siguiendo', jugadores: alternar(s.jugadores || [], codigo) })
}

export const sigueEquipo = (siguiendo, equipo) =>
  !!equipo && (siguiendo?.equipos || []).includes(equipo.codigo)

export const sigueJugador = (siguiendo, jugador) =>
  !!jugador && (siguiendo?.jugadores || []).includes(jugador.codigo)
