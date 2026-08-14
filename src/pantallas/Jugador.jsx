import { Link, useParams } from 'react-router-dom'
import { db } from '../db'
import { useJugador, useOtrasFichas } from '../datos'
import { Topbar, Escudo, fechaCorta } from '../ui'
import { codigoDe, urlPartido, urlEquipo, urlJugador } from '../lib/enlaces'
import { useMeta } from '../lib/meta'

export default function Jugador() {
  const { slug } = useParams()
  const d = useJugador(codigoDe(slug))
  const otras = useOtrasFichas(d?.jugador?.personaId, d?.jugador?.id)
  useMeta({
    titulo: d && `${d.jugador.nombre} (${d.equipo?.nombre}): estadísticas`,
    descripcion: d && (
      `${d.jugador.nombre}, dorsal ${d.jugador.dorsal} de ${d.equipo?.nombre} en ${d.liga?.nombre}. ` +
      `${d.puntos} puntos en ${d.partidosJugados} partidos, ${d.faltas} faltas.`
    ),
    tipo: 'profile',
  })

  if (!d) return null

  const { jugador, equipo, liga, equiposPorId, partidosPorId, eventos, puntos, faltas, partidosJugados } = d
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
    if (ok) await db.jugadores.update(jugador.id, { reclamado: true })
  }

  return (
    <>
      <Topbar titulo={jugador.nombre} />

      <div className="perfil-hero">
        <Escudo equipo={equipo} size="lg" />
        <div className="datos">
          <div className="nom">{jugador.nombre}</div>
          <div className="sub">
            #{jugador.dorsal} · <Link to={urlEquipo(equipo)} style={{ textDecoration: 'underline' }}>{equipo?.nombre}</Link>
          </div>
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
        <div className="metrica">
          <div className="n" style={{ color: 'var(--acento-ink)' }}>{faltas}</div>
          <div className="q">Faltas</div>
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

      {otras.length > 0 && (
        <>
          <h2 className="seccion">También jugó</h2>
          <div className="lista">
            {otras.map(({ ficha, liga: l, equipo: eq }) => (
              <Link key={ficha.id} to={urlJugador(ficha)} className="jugador-fila">
                <Escudo equipo={eq} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nombre" style={{ fontWeight: 600 }}>{eq?.nombre}</div>
                  <div className="sub" style={{ fontSize: '0.74rem' }}>
                    {ficha.refuerzo && <span className="pill acento" style={{ marginRight: 6 }}>Refuerzo</span>}
                    {l?.nombre}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            Es la misma persona. Su récord no empieza de cero cada vez que lo convocan a otro
            lado.
          </p>
        </>
      )}

      <h2 className="seccion">Partido a partido</h2>
      <div className="lista">
        {historial.map(({ partido, pts }) => {
          const rival = partido.localId === equipo.id ? partido.visitaId : partido.localId
          return (
            <Link key={partido.id} to={urlPartido(partido, equiposPorId[partido.localId], equiposPorId[partido.visitaId])} className="jugador-fila">
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
