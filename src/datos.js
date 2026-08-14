import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

const porId = (filas) => Object.fromEntries(filas.map((f) => [f.id, f]))

export const useCuenta = () => useLiveQuery(() => db.cuenta.get('yo'), [])

export const useCanchas = () => useLiveQuery(() => db.canchas.toArray(), [], [])

/** País al que está restringido el sitio, y la provincia elegida dentro de él. */
export const useRegion = () => useLiveQuery(() => db.meta.get('region'), [])

/** Quién está mirando: invitado u organizador. */
export const useSesion = () => useLiveQuery(() => db.meta.get('sesion'), [])

/** Todo lo que necesita la portada. Los datos son pocos: se filtra en memoria. */
export function useDescubrir() {
  return useLiveQuery(async () => {
    const [ligas, partidos, equipos, canchas] = await Promise.all([
      db.ligas.toArray(),
      db.partidos.toArray(),
      db.equipos.toArray(),
      db.canchas.toArray(),
    ])

    const vivos = partidos.filter((p) => p.estado === 'vivo')
    const eventos = await db.eventos.where('partidoId').anyOf(vivos.map((p) => p.id)).toArray()
    const eventosPorPartido = {}
    for (const e of eventos) (eventosPorPartido[e.partidoId] ||= []).push(e)

    const ahora = Date.now()
    const proximos = partidos
      .filter((p) => p.estado === 'programado' && new Date(p.inicio).getTime() > ahora)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))

    const jugados = partidos.filter((p) => p.estado === 'final').length

    return {
      ligas,
      ligasPorId: porId(ligas),
      equipos: porId(equipos),
      canchas: porId(canchas),
      vivos,
      proximos,
      eventosPorPartido,
      totales: { ligas: ligas.length, jugados, canchas: canchas.length },
    }
  }, [], null)
}

export function useLigas({ soloMias = false } = {}) {
  return useLiveQuery(async () => {
    const sesion = await db.meta.get('sesion')
    const ligas = await db.ligas.toArray()
    const partidos = await db.partidos.toArray()
    const canchas = porId(await db.canchas.toArray())
    return ligas
      .filter((l) => (soloMias ? l.organizadorId === sesion?.cuentaId : true))
      .map((liga) => {
        const suyos = partidos
          .filter((p) => p.ligaId === liga.id)
          .sort((a, b) => a.inicio.localeCompare(b.inicio))
        return {
          liga,
          canchas: liga.canchaIds.map((id) => canchas[id]).filter(Boolean),
          total: suyos.length,
          jugados: suyos.filter((p) => p.estado === 'final').length,
          vivo: suyos.find((p) => p.estado === 'vivo') || null,
          proximo: suyos.find((p) => p.estado === 'programado') || null,
        }
      })
  }, [soloMias], [])
}

export function useLiga(codigo) {
  return useLiveQuery(async () => {
    const liga = await db.ligas.where('codigo').equals(codigo).first()
    if (!liga) return null
    const [equipos, jugadores, partidos, canchas] = await Promise.all([
      db.equipos.where('ligaId').equals(liga.id).toArray(),
      db.jugadores.where('ligaId').equals(liga.id).toArray(),
      db.partidos.where('ligaId').equals(liga.id).toArray(),
      db.canchas.toArray(),
    ])
    const eventos = await db.eventos.where('partidoId').anyOf(partidos.map((p) => p.id)).toArray()
    const eventosPorPartido = {}
    for (const e of eventos) (eventosPorPartido[e.partidoId] ||= []).push(e)

    return {
      liga,
      equipos,
      jugadores,
      partidos: partidos.sort((a, b) => a.inicio.localeCompare(b.inicio)),
      equiposPorId: porId(equipos),
      jugadoresPorId: porId(jugadores),
      canchasPorId: porId(canchas),
      eventosPorPartido,
    }
  }, [codigo])
}

export function usePartido(codigo) {
  return useLiveQuery(async () => {
    const partido = await db.partidos.where('codigo').equals(codigo).first()
    if (!partido) return null
    const liga = await db.ligas.get(partido.ligaId)
    const [equipos, jugadores, eventos, cancha] = await Promise.all([
      db.equipos.where('ligaId').equals(partido.ligaId).toArray(),
      db.jugadores.where('ligaId').equals(partido.ligaId).toArray(),
      db.eventos.where('partidoId').equals(partido.id).toArray(),
      db.canchas.get(partido.canchaId),
    ])
    const equiposPorId = porId(equipos)
    return {
      partido,
      liga,
      cancha,
      local: equiposPorId[partido.localId],
      visita: equiposPorId[partido.visitaId],
      jugadores,
      jugadoresPorId: porId(jugadores),
      eventos: eventos.sort((a, b) => a.seq - b.seq),
    }
  }, [codigo])
}

export function useJugador(codigo) {
  return useLiveQuery(async () => {
    const jugador = await db.jugadores.where('codigo').equals(codigo).first()
    if (!jugador) return null
    const [equipo, liga, partidos] = await Promise.all([
      db.equipos.get(jugador.equipoId),
      db.ligas.get(jugador.ligaId),
      db.partidos.where('ligaId').equals(jugador.ligaId).toArray(),
    ])
    const eventos = await db.eventos.where('partidoId').anyOf(partidos.map((p) => p.id)).toArray()
    const equipos = await db.equipos.where('ligaId').equals(jugador.ligaId).toArray()

    const finalizados = new Set(partidos.filter((p) => p.estado === 'final').map((p) => p.id))
    const suyos = eventos.filter(
      (e) => e.jugadorId === jugador.id && !e.anulado && finalizados.has(e.partidoId),
    )

    return {
      jugador,
      equipo,
      liga,
      equiposPorId: porId(equipos),
      partidosPorId: porId(partidos),
      eventos: suyos,
      puntos: suyos.filter((e) => e.tipo === 'punto').reduce((n, e) => n + e.puntos, 0),
      faltas: suyos.filter((e) => e.tipo === 'falta').length,
      partidosJugados: new Set(suyos.map((e) => e.partidoId)).size,
    }
  }, [codigo])
}

export function useCancha(codigo) {
  return useLiveQuery(async () => {
    const cancha = await db.canchas.where('codigo').equals(codigo).first()
    if (!cancha) return null
    const ligas = (await db.ligas.toArray()).filter((l) => l.canchaIds.includes(cancha.id))
    const partidos = (await db.partidos.where('canchaId').equals(cancha.id).toArray())
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
    const equipos = await db.equipos.toArray()
    return { cancha, ligas, partidos, equiposPorId: porId(equipos), ligasPorId: porId(ligas) }
  }, [codigo])
}

export function useNoticias() {
  return useLiveQuery(async () => {
    const noticias = await db.noticias.toArray()
    const ligas = porId(await db.ligas.toArray())
    return noticias
      .sort((a, b) => b.publicada.localeCompare(a.publicada))
      .map((n) => ({ ...n, liga: ligas[n.ligaId] }))
  }, [], [])
}

export function useNoticia(codigo) {
  return useLiveQuery(async () => {
    const noticia = await db.noticias.where('codigo').equals(codigo).first()
    if (!noticia) return null
    const liga = noticia.ligaId ? await db.ligas.get(noticia.ligaId) : null
    return { noticia, liga }
  }, [codigo])
}
