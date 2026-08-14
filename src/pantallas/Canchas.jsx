import { Link } from 'react-router-dom'
import { useCanchas, useRegion } from '../datos'
import { Marca, Chevron, Vacio } from '../ui'

export default function Canchas() {
  const canchas = useCanchas()
  const region = useRegion()

  if (!region) return null

  const delPais = (canchas || []).filter((c) => c.pais === region.pais)
  const porProvincia = {}
  for (const c of delPais) (porProvincia[c.provincia] ||= []).push(c)

  return (
    <>
      <Marca />
      <h2 className="seccion">Canchas</h2>
      <p className="sub" style={{ marginTop: -4, marginBottom: 12 }}>
        La cancha es una entidad propia. A veces el dueño de la cancha es el mismo organizador,
        a veces solo alquila la hora. Los dos casos funcionan.
      </p>

      {Object.entries(porProvincia).sort().map(([provincia, lista]) => (
        <div key={provincia}>
          <div className="dia-sep">{provincia}</div>
          <div className="lista">
            {lista.map((c) => (
              <Link key={c.id} to={`/cancha/${c.id}`} className="card">
                <div className="fila-liga">
                  <div className="info">
                    <div className="nombre">{c.nombre}</div>
                    <div className="sub" style={{ marginTop: 2 }}>{c.barrio}</div>
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
        </div>
      ))}

      {!delPais.length && <Vacio>Todavía no hay canchas registradas en tu país.</Vacio>}
    </>
  )
}
