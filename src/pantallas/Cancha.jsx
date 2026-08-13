import { Link, useParams } from 'react-router-dom'
import { useCancha } from '../datos'
import { Topbar, Escudo, fechaCorta, hora, mismoDia } from '../ui'

export default function Cancha() {
  const { id } = useParams()
  const d = useCancha(id)
  if (!d) return null

  const { cancha, ligas, partidos, equiposPorId, ligasPorId } = d
  const ahora = Date.now()
  const agenda = partidos.filter((p) => new Date(p.inicio).getTime() > ahora - 3 * 3600 * 1000).slice(0, 14)

  let ultimoDia = null

  return (
    <>
      <Topbar titulo={cancha.nombre} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Página de la cancha</div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', marginTop: 6 }}>{cancha.nombre}</div>
        <div className="sub">{cancha.barrio}, {cancha.ciudad}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="pill">{cancha.techada ? 'Techada' : 'Al aire libre'}</span>
          <span className="pill">{ligas.length} liga{ligas.length === 1 ? '' : 's'}</span>
          <span className="pill acento">Plan mensual</span>
        </div>
        <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
          Con el plan mensual, esta cancha tiene su propio link y marcador ilimitado para todas
          las ligas que juegan aquí.
        </p>
      </div>

      <h2 className="seccion">Ligas que juegan aquí</h2>
      <div className="lista">
        {ligas.map((l) => (
          <Link key={l.id} to={`/liga/${l.id}`} className="card">
            <div className="fila-liga">
              <div className="info">
                <div className="nombre">{l.nombre}</div>
                <div className="sub">
                  {l.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala'} · organiza {l.organizador}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <h2 className="seccion">Agenda de la cancha</h2>
      <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>
        Una franja se vende una sola vez. Lo que está aquí ya no existe para nadie más.
      </p>

      {agenda.map((p) => {
        const nuevoDia = !ultimoDia || !mismoDia(ultimoDia, p.inicio)
        ultimoDia = p.inicio
        return (
          <div key={p.id}>
            {nuevoDia && <div className="dia-sep">{fechaCorta(p.inicio)}</div>}
            <Link to={`/partido/${p.id}`} className="partido" style={{ marginBottom: 8 }}>
              <div className="cuando">
                <div className="hora">{hora(p.inicio)}</div>
                <div className="dia">ocupada</div>
              </div>
              <div className="enfrenta">
                <div className="lado">
                  <Escudo equipo={equiposPorId[p.localId]} size="sm" />
                  <span className="nombre">{equiposPorId[p.localId]?.nombre}</span>
                </div>
                <div className="lado">
                  <Escudo equipo={equiposPorId[p.visitaId]} size="sm" />
                  <span className="nombre">{equiposPorId[p.visitaId]?.nombre}</span>
                </div>
              </div>
            </Link>
          </div>
        )
      })}
    </>
  )
}
