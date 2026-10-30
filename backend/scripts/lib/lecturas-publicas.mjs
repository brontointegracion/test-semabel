// Contraste OFFLINE entre un paquete portable y las lecturas PUBLICAS de la liga que el propietario guardo aparte (GET sin credenciales):
//   GET /v1/ligas/{liga}/publico            -> `lecturaLiga`
//   GET /v1/ligas/{liga}/jugadores/publico  -> `lecturaJugadores`
// No hace ninguna peticion. Devuelve solo CODIGOS e ids deportivos de lo que no coincide (nunca registros completos).
// Reglas de la lectura publica (ver backend/src/proyeccion-*.js): un partido RETIRADO no se publica; el marcador sale de un resumen vigente; los totales de jugadores cuentan solo eventos
// validos de partidos FINALES no retirados, agrupados por ficha y equipo; las entradas con valor 0 no se publican; los rankings se cortan (RANGO_MAXIMO / FILAS_MAXIMAS).

const igual = (a, b) => (a ?? null) === (b ?? null)

export function compararLecturasPublicas({ paquete, lecturaLiga, lecturaJugadores }) {
  const fallos = []
  let comprobaciones = 0
  const ver = (ok, code, p = {}) => { comprobaciones += 1; if (!ok) fallos.push({ code, gameId: p.gameId ?? null, entityId: p.entityId ?? null, field: p.field ?? null }) }

  const liga = paquete.leagues[0]
  ver(lecturaLiga?.liga?.id === liga.leagueId, 'league-id-differs')
  ver(igual(lecturaLiga?.liga?.nombre, liga.name), 'league-name-differs')

  // Equipos
  const equiposPub = new Map((lecturaLiga?.equipos ?? []).map((e) => [e.id, e]))
  for (const t of paquete.teams) {
    const e = equiposPub.get(t.teamId)
    ver(e !== undefined, 'team-missing-publicly', { entityId: t.teamId })
    if (e) { ver(igual(e.nombre, t.name), 'team-name-differs', { entityId: t.teamId }); ver(igual(e.rama, t.branch), 'team-branch-differs', { entityId: t.teamId }) }
  }
  for (const id of equiposPub.keys()) ver(paquete.teams.some((t) => t.teamId === id), 'public-team-missing-from-package', { entityId: id })

  // Partidos
  const pubPartidos = new Map((lecturaLiga?.partidos ?? []).map((p) => [p.gameId, p]))
  const puntos = new Map(paquete.game_scores.map((s) => [s.gameId, s]))
  for (const g of paquete.games) {
    const pub = pubPartidos.get(g.gameId)
    if (g.retired) { ver(pub === undefined, 'retired-game-visible-publicly', { gameId: g.gameId }); continue }
    ver(pub !== undefined, 'game-missing-publicly', { gameId: g.gameId })
    if (!pub) continue
    const c = { gameId: g.gameId }
    ver(igual(pub.estado, g.state), 'game-state-differs', c)
    ver(igual(pub.programadoPara, g.scheduledFor), 'game-schedule-differs', c)
    ver(igual(pub.sede, g.venue), 'game-venue-differs', c)
    ver(igual(pub.local?.id, g.homeTeamId) && igual(pub.visita?.id, g.awayTeamId), 'game-teams-differ', c)
    if (g.state !== 'programado') ver(igual(pub.inicioReal, g.startedAt), 'game-start-differs', c)
    const s = puntos.get(g.gameId)
    if (s && s.recordedScoreStatus === 'available') {
      ver(igual(pub.local?.puntos, s.recordedHomePoints) && igual(pub.visita?.puntos, s.recordedAwayPoints), 'game-score-differs', c)
      ver(igual(pub.local?.faltas, s.recordedHomeFouls) && igual(pub.visita?.faltas, s.recordedAwayFouls), 'game-fouls-differ', c)
    } else if (g.state === 'final') ver(false, 'recorded-score-not-available-for-comparison', c)
  }
  const retirados = new Set(paquete.games.filter((g) => g.retired).map((g) => g.gameId))
  for (const id of pubPartidos.keys()) if (!retirados.has(id)) ver(paquete.games.some((g) => g.gameId === id), 'public-game-missing-from-package', { gameId: id })

  // Totales de jugadores (solo partidos finales no retirados)
  if (lecturaJugadores) {
    const validos = new Set(paquete.games.filter((g) => g.state === 'final' && !g.retired).map((g) => g.gameId))
    const porClave = new Map()
    let sin = { puntos: 0, faltas: 0 }
    for (const t of paquete.player_game_totals) {
      if (!validos.has(t.gameId)) continue
      if (t.playerId === null) { sin = { puntos: sin.puntos + t.points, faltas: sin.faltas + t.fouls }; continue }
      const k = `${t.playerId}|${t.teamId}`
      const a = porClave.get(k) ?? { puntos: 0, faltas: 0 }
      porClave.set(k, { puntos: a.puntos + t.points, faltas: a.faltas + t.fouls })
    }
    ver(lecturaJugadores.partidosFinales === validos.size, 'final-game-count-differs')
    ver(lecturaJugadores.sinJugador?.puntos === sin.puntos && lecturaJugadores.sinJugador?.faltas === sin.faltas, 'unattributed-totals-differ')
    for (const [lista, campo, mio] of [[lecturaJugadores.maximosAnotadores ?? [], 'puntos', 'puntos'], [lecturaJugadores.masFaltas ?? [], 'faltas', 'faltas']]) {
      const vistos = new Set()
      for (const e of lista) {
        const k = `${e.id}|${e.equipo?.id}`
        vistos.add(k)
        const m = porClave.get(k)
        ver(m !== undefined && m[mio] === e[campo], `player-${campo}-differ`, { entityId: e.id })
      }
      const minimo = lista.length ? Math.min(...lista.map((e) => e[campo])) : null
      if (!lecturaJugadores.recortado && minimo !== null) {
        for (const [k, m] of porClave) if (m[mio] > minimo) ver(vistos.has(k), `player-${campo}-missing-from-public-ranking`, { entityId: k.split('|')[0] })
      }
    }
  }
  const porCodigo = {}
  for (const f of fallos) porCodigo[f.code] = (porCodigo[f.code] ?? 0) + 1
  return { ok: fallos.length === 0, comprobaciones, desacuerdos: fallos.length, porCodigo, detalle: fallos }
}
