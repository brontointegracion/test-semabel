import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

const porId = (filas) => Object.fromEntries(filas.map((f) => [f.id, f]))

export const useCuenta = () => useLiveQuery(() => db.cuenta.get('yo'), [])

export const useCanchas = () => useLiveQuery(() => db.canchas.toArray(), [], [])

/** País al que está restringido el sitio, y la provincia elegida dentro de él. */
export const useRegion = () => useLiveQuery(() => db.meta.get('region'), [])

/** Quién está mirando: invitado u organizador. */
export const useSesion = () => useLiveQuery(() => db.meta.get('sesion'), [])

/** Equipos y jugadores que sigue quien mira. */
export const useSiguiendo = () =>
  useLiveQuery(() => db.meta.get('siguiendo'), [], { equipos: [], jugadores: [] })

/** Mi voto en un partido, si ya voté. */
export const useMiVoto = (partidoId) =>
  useLiveQuery(
    () => (partidoId ? db.votos.where('partidoId').equals(partidoId).first() : null),
    [partidoId],
  )

/**
 * Qué puede ver quien mira.
 *
 * La regla sigue siendo: tu país y nada más. La excepción son los objetos
 * compartidos —un torneo internacional, un reto entre ligas— donde las dos
 * partes se conectaron a propósito. Ahí la frontera se abre, porque las dos
 * comunidades ya decidieron que querían verse.
 */
export const visibleEn = (liga, pais) =>
  !!liga && (liga.pais === pais || (liga.internacional && (liga.paises || []).includes(pais)))

/** Todo lo que necesita la portada. Los datos son pocos: se filtra en memoria. */
export function useDescubrir() {
  return useLiveQuery(async () => {
    const [ligas, partidos, equipos, canchas, jugadores] = await Promise.all([
      db.ligas.toArray(),
      db.partidos.toArray(),
      db.equipos.toArray(),
      db.canchas.toArray(),
      db.jugadores.toArray(),
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
      // Listas planas para el buscador; los mapas para pintar.
      listaEquipos: equipos,
      listaJugadores: jugadores,
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


/** Todo lo de un equipo: plantilla, resultados, próximo partido y forma. */
export function useEquipo(codigo) {
  return useLiveQuery(async () => {
    const equipo = await db.equipos.where('codigo').equals(codigo).first()
    if (!equipo) return null

    const [liga, jugadores, todos] = await Promise.all([
      db.ligas.get(equipo.ligaId),
      db.jugadores.where('equipoId').equals(equipo.id).toArray(),
      db.partidos.where('ligaId').equals(equipo.ligaId).toArray(),
    ])

    const suyos = todos
      .filter((p) => p.localId === equipo.id || p.visitaId === equipo.id)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))

    const eventos = await db.eventos.where('partidoId').anyOf(suyos.map((p) => p.id)).toArray()
    const eventosPorPartido = {}
    for (const e of eventos) (eventosPorPartido[e.partidoId] ||= []).push(e)

    const equipos = await db.equipos.where('ligaId').equals(equipo.ligaId).toArray()
    const canchas = await db.canchas.toArray()

    return {
      equipo,
      liga,
      jugadores: jugadores.sort((a, b) => a.dorsal - b.dorsal),
      partidos: suyos,
      jugados: suyos.filter((p) => p.estado === 'final'),
      proximo: suyos.find((p) => p.estado === 'programado') || null,
      vivo: suyos.find((p) => p.estado === 'vivo') || null,
      equiposPorId: porId(equipos),
      canchasPorId: porId(canchas),
      eventosPorPartido,
      // La liga entera hace falta para saber en qué puesto va.
      partidosLiga: todos,
      equiposLiga: equipos,
      eventosLiga: await (async () => {
        const evs = await db.eventos.where('partidoId').anyOf(todos.map((p) => p.id)).toArray()
        const m = {}
        for (const e of evs) (m[e.partidoId] ||= []).push(e)
        return m
      })(),
    }
  }, [codigo])
}

/** Lo que sigue quien mira: próximos partidos y últimos resultados. */
export function useLoQueSigo() {
  return useLiveQuery(async () => {
    const siguiendo = (await db.meta.get('siguiendo')) || { equipos: [], jugadores: [] }
    const codigos = siguiendo.equipos || []
    if (!codigos.length) return { equipos: [], proximos: [], recientes: [], jugadores: [] }

    const equipos = await db.equipos.where('codigo').anyOf(codigos).toArray()
    const ids = new Set(equipos.map((e) => e.id))
    const ligas = porId(await db.ligas.toArray())
    const canchas = porId(await db.canchas.toArray())
    const todosEquipos = porId(await db.equipos.toArray())

    const partidos = (await db.partidos.toArray())
      .filter((p) => ids.has(p.localId) || ids.has(p.visitaId))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))

    const eventos = await db.eventos.where('partidoId').anyOf(partidos.map((p) => p.id)).toArray()
    const eventosPorPartido = {}
    for (const e of eventos) (eventosPorPartido[e.partidoId] ||= []).push(e)

    const jugadores = (siguiendo.jugadores || []).length
      ? await db.jugadores.where('codigo').anyOf(siguiendo.jugadores).toArray()
      : []

    return {
      equipos,
      jugadores,
      ligas,
      canchas,
      todosEquipos,
      eventosPorPartido,
      vivos: partidos.filter((p) => p.estado === 'vivo'),
      proximos: partidos.filter((p) => p.estado === 'programado').slice(0, 8),
      recientes: partidos.filter((p) => p.estado === 'final').slice(-6).reverse(),
    }
  }, [], null)
}

/** Máximos anotadores de la provincia, cruzando todas sus ligas. */
export function useFiguras() {
  return useLiveQuery(async () => {
    const region = await db.meta.get('region')
    if (!region) return null

    const ligas = (await db.ligas.toArray()).filter(
      (l) => l.pais === region.pais && !l.esTorneo &&
        (!region.provincia || region.provincia === 'todas' || l.provincia === region.provincia),
    )
    const ligaIds = new Set(ligas.map((l) => l.id))

    const partidos = (await db.partidos.toArray()).filter((p) => ligaIds.has(p.ligaId))
    const finalizados = new Set(partidos.filter((p) => p.estado === 'final').map((p) => p.id))
    const eventos = (await db.eventos.where('partidoId').anyOf([...finalizados]).toArray())
      .filter((e) => !e.anulado)

    const jugadores = porId((await db.jugadores.toArray()).filter((j) => ligaIds.has(j.ligaId)))
    const equipos = porId(await db.equipos.toArray())

    const acc = {}
    for (const e of eventos) {
      const j = jugadores[e.jugadorId]
      if (!j) continue
      const a = (acc[j.id] ||= { jugador: j, equipo: equipos[j.equipoId], liga: ligas.find((l) => l.id === j.ligaId), puntos: 0, faltas: 0, partidos: new Set() })
      if (e.tipo === 'punto') a.puntos += e.puntos
      if (e.tipo === 'falta') a.faltas++
      a.partidos.add(e.partidoId)
    }

    const filas = Object.values(acc).map((a) => ({
      ...a,
      partidos: a.partidos.size,
      promedio: a.partidos.size ? a.puntos / a.partidos.size : 0,
    }))

    return {
      region,
      ligas,
      anotadores: [...filas].sort((a, b) => b.promedio - a.promedio).slice(0, 20),
      faltas: [...filas].sort((a, b) => b.faltas - a.faltas).slice(0, 10),
      totalJugadores: filas.length,
    }
  }, [], null)
}


/** Una categoría, país por país: la pantalla que enseña que tu categoría existe en todas partes. */
export function useCategoria(deporte, categoria) {
  return useLiveQuery(async () => {
    const todas = await db.ligas.toArray()
    const ligas = todas.filter(
      (l) => !l.esTorneo && l.deporte === deporte && l.categoria === categoria,
    )
    if (!ligas.length) return null

    const partidos = await db.partidos.toArray()
    const equipos = await db.equipos.toArray()
    const eventos = await db.eventos
      .where('partidoId')
      .anyOf(partidos.filter((p) => p.estado === 'final').map((p) => p.id))
      .toArray()
    const eventosPorPartido = {}
    for (const e of eventos) (eventosPorPartido[e.partidoId] ||= []).push(e)

    const porPais = {}
    for (const liga of ligas) {
      const suyos = equipos.filter((e) => e.ligaId === liga.id)
      const g = (porPais[liga.pais] ||= { pais: liga.pais, ligas: [], equipos: [], partidos: [] })
      g.ligas.push(liga)
      g.equipos.push(...suyos)
      g.partidos.push(...partidos.filter((p) => p.ligaId === liga.id))
    }

    // Torneos internacionales de esta categoría: el puente entre los dos lados.
    const torneos = todas.filter(
      (l) => l.esTorneo && l.internacional && l.deporte === deporte && l.categoria === categoria,
    )

    return { ligas, porPais: Object.values(porPais), eventosPorPartido, torneos, equipos }
  }, [deporte, categoria], null)
}

/** Las otras fichas de la misma persona: su liga, y los torneos que jugó. */
export function useOtrasFichas(personaId, fichaId) {
  return useLiveQuery(async () => {
    if (!personaId) return []
    const fichas = (await db.jugadores.where('personaId').equals(personaId).toArray())
      .filter((f) => f.id !== fichaId)
    const ligas = porId(await db.ligas.toArray())
    const equipos = porId(await db.equipos.toArray())
    return fichas.map((f) => ({ ficha: f, liga: ligas[f.ligaId], equipo: equipos[f.equipoId] }))
  }, [personaId, fichaId], [])
}


/**
 * Un reto: dos ligas de la misma categoría, la misma ventana de fechas, y los
 * números de cada lado puestos uno al lado del otro. Nadie viaja.
 */
export function useReto(codigo) {
  return useLiveQuery(async () => {
    const reto = await db.retos.where('codigo').equals(codigo).first()
    if (!reto) return null

    const [ligaA, ligaB] = await Promise.all([
      db.ligas.get(reto.ligaAId),
      db.ligas.get(reto.ligaBId),
    ])
    const equipos = porId(await db.equipos.toArray())
    const jugadores = porId(await db.jugadores.toArray())
    const desde = new Date(reto.desde).getTime()
    const hasta = new Date(reto.hasta).getTime()

    const lado = async (liga) => {
      const suyos = (await db.partidos.where('ligaId').equals(liga.id).toArray()).filter((p) => {
        const t = new Date(p.inicio).getTime()
        return p.estado === 'final' && t >= desde && t <= hasta
      })
      const eventos = (await db.eventos.where('partidoId').anyOf(suyos.map((p) => p.id)).toArray())
        .filter((e) => !e.anulado)

      const puntos = eventos.filter((e) => e.tipo === 'punto').reduce((n, e) => n + e.puntos, 0)
      const faltas = eventos.filter((e) => e.tipo === 'falta').length

      const porJugador = {}
      for (const e of eventos) {
        if (e.tipo !== 'punto' || !e.jugadorId) continue
        porJugador[e.jugadorId] = (porJugador[e.jugadorId] || 0) + e.puntos
      }
      const mejor = Object.entries(porJugador).sort((a, b) => b[1] - a[1])[0]

      return {
        liga,
        partidos: suyos.sort((a, b) => b.inicio.localeCompare(a.inicio)),
        jugados: suyos.length,
        puntos,
        faltas,
        promedio: suyos.length ? puntos / suyos.length : 0,
        mejor: mejor ? { jugador: jugadores[mejor[0]], puntos: mejor[1] } : null,
      }
    }

    const a = await lado(ligaA)
    const b = await lado(ligaB)
    const dias = Math.ceil((hasta - Date.now()) / 86400000)

    return {
      reto,
      a,
      b,
      equipos,
      // Se compara el promedio por partido: si se comparara el total, ganaría
      // siempre la liga que juega más veces, que no es mérito de nadie.
      lider: a.promedio === b.promedio ? null : a.promedio > b.promedio ? a : b,
      diasRestantes: dias > 0 ? dias : 0,
      abierto: Date.now() <= hasta,
    }
  }, [codigo])
}

/** Retos en los que participa una liga. */
export const useRetosDeLiga = (ligaId) =>
  useLiveQuery(async () => {
    if (!ligaId) return []
    const todos = await db.retos.toArray()
    return todos.filter((r) => r.ligaAId === ligaId || r.ligaBId === ligaId)
  }, [ligaId], [])

/** Retos de una categoría, para la pantalla que cruza países. */
export const useRetosDeCategoria = (deporte, categoria) =>
  useLiveQuery(async () => {
    const todos = await db.retos.toArray()
    return todos.filter((r) => r.deporte === deporte && r.categoria === categoria)
  }, [deporte, categoria], [])
