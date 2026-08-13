import { Link } from 'react-router-dom'
import { useCanchas } from '../datos'
import { Marca, Chevron } from '../ui'

export default function Canchas() {
  const canchas = useCanchas()

  return (
    <>
      <Marca />
      <h2 className="seccion">Canchas</h2>
      <p className="sub" style={{ marginTop: -4, marginBottom: 12 }}>
        La cancha es una entidad propia. A veces el dueño de la cancha es el mismo organizador,
        a veces solo alquila la hora. Los dos casos funcionan.
      </p>

      <div className="lista">
        {(canchas || []).map((c) => (
          <Link key={c.id} to={`/cancha/${c.id}`} className="card">
            <div className="fila-liga">
              <div className="info">
                <div className="nombre">{c.nombre}</div>
                <div className="sub" style={{ marginTop: 2 }}>{c.barrio}, {c.ciudad}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                  <span className="pill">{c.techada ? 'Techada' : 'Al aire libre'}</span>
                  <span className="pill">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</span>
                </div>
              </div>
              <Chevron />
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
