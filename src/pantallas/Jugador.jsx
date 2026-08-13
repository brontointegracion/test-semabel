import { Link, useParams } from 'react-router-dom'
import { db } from '../db'
import { useJugador } from '../datos'
import { Topbar, Escudo, fechaCorta } from '../ui'

export default function Jugador() {
  const { id } = useParams()
  const d = useJugador(id)
  if (!d) return null

  const { jugador, equipo, liga, equiposPorId, partidosPorId, eventos, puntos, partidosJugados } = d
  const promedio = partidosJugados ? puntos / partidosJugados : 0

  const porPartido = {}
  for (const e of eventos) porPartido[e.partidoId] = (porPartido[e.partidoId] || 0) + e.puntos
  const historial = Object.entries(porPartido)
    .map(([pid, pts]) => ({ partido: partidosPorId[pid], pts }))
    .filter((x) => x.partido)
    .sort((a, b) => b.partido.inicio.localeCompare(a.partido.inicio))

  const reclamar = async () => {
    const ok = confirm(
      'Al registrarte, tu perfil se vuelve público y completo.\n\n' +
      'Aquí es donde se pide el consentimiento: antes de esto solo eres un nombre en una ' +
      'planilla; después, tu récord te pertenece y te sigue de liga en liga.',
    )
    if (ok) await db.jugadores.update(id, { reclamado: true })
  }

  return (
    <>
      <Topbar titulo={jugador.nombre} />

      <div className="perfil-hero">
        <Escudo equipo={equipo} size="lg" />
        <div className="datos">
          <div className="nom">{jugador.nombre}</div>
          <div className="sub">#{jugador.dorsal} · {equipo?.nombre}</div>
          <div style={{ marginTop: 8 }}>
            {jugador.reclamado ? (
              <span className="pill acento">Perfil verificado</span>
            ) : (
              <span className="pill">Sin reclamar</span>
            )}
          </div>
        </div>
      </div>

      <div className="metricas">
        <div className="metrica">
          <div className="n">{puntos}</div>
          <div className="q">Puntos</div>
        </div>
        <div className="metrica">
          <div className="n">{partidosJugados}</div>
          <div className="q">Partidos</div>
        </div>
        <div className="metrica">
          <div className="n">{promedio.toFixed(1)}</div>
          <div className="q">Promedio</div>
        </div>
      </div>

      {!jugador.reclamado && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700 }}>¿Eres tú?</div>
          <p className="sub" style={{ marginTop: 6 }}>
            El organizador te anotó en la planilla con tu nombre. Si registras tu perfil, tus
            números dejan de vivir dentro de una sola liga y pasan a ser tuyos.
          </p>
          <button className="btn" style={{ marginTop: 12 }} onClick={reclamar}>
            Reclamar mi perfil
          </button>
        </div>
      )}

      <h2 className="seccion">Partido a partido</h2>
      <div className="lista">
        {historial.map(({ partido, pts }) => {
          const rival = partido.localId === equipo.id ? partido.visitaId : partido.localId
          return (
            <Link key={partido.id} to={`/partido/${partido.id}`} className="jugador-fila">
              <Escudo equipo={equiposPorId[rival]} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>
                  vs {equiposPorId[rival]?.nombre}
                </div>
                <div className="sub" style={{ fontSize: '0.75rem' }}>{fechaCorta(partido.inicio)}</div>
              </div>
              <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pts}</div>
            </Link>
          )
        })}
        {!historial.length && <p className="sub">Todavía no ha anotado en un partido cerrado.</p>}
      </div>

      <p className="sub" style={{ marginTop: 16 }}>
        Estos números salen de {liga?.nombre} y se quedan aquí para siempre, aunque la liga
        termine o el organizador deje de pagar.
      </p>
    </>
  )
}
