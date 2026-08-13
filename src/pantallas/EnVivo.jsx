import { Link } from 'react-router-dom'
import { useEnVivo } from '../datos'
import { marcadorEquipo } from '../lib/marcador'
import { Marca, Escudo, Vacio, diaRelativo, hora, transcurrido } from '../ui'

export default function EnVivo() {
  const d = useEnVivo()
  if (!d) return null

  const { vivos, proximos, ligas, equipos, canchas, eventosPorPartido } = d

  return (
    <>
      <Marca />

      <h2 className="seccion">Ahora mismo</h2>
      {vivos.length === 0 && <Vacio>No hay partidos en curso.</Vacio>}

      <div className="lista">
        {vivos.map((p) => {
          const evs = eventosPorPartido[p.id] || []
          const local = equipos[p.localId]
          const visita = equipos[p.visitaId]
          return (
            <Link key={p.id} to={`/partido/${p.id}`} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span className="pill vivo"><i className="punto" />EN VIVO</span>
                <span className="sub">{transcurrido(p.inicio)}</span>
                <span className="sub" style={{ marginLeft: 'auto' }}>{ligas[p.ligaId]?.nombre}</span>
              </div>
              {[local, visita].map((eq) => (
                <div key={eq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                  <Escudo equipo={eq} size="sm" />
                  <span style={{ flex: 1, fontWeight: 600 }}>{eq.nombre}</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {marcadorEquipo(evs, eq.id)}
                  </span>
                </div>
              ))}
              <div className="sub" style={{ marginTop: 10 }}>
                {canchas[p.canchaId]?.nombre} · abre el marcador grande
              </div>
            </Link>
          )
        })}
      </div>

      <h2 className="seccion">Lo que viene</h2>
      <div className="lista">
        {proximos.map((p) => (
          <Link key={p.id} to={`/partido/${p.id}`} className="partido">
            <div className="cuando">
              <div className="dia">{diaRelativo(p.inicio)}</div>
              <div className="hora">{hora(p.inicio)}</div>
            </div>
            <div className="enfrenta">
              <div className="lado">
                <Escudo equipo={equipos[p.localId]} size="sm" />
                <span className="nombre">{equipos[p.localId]?.nombre}</span>
              </div>
              <div className="lado">
                <Escudo equipo={equipos[p.visitaId]} size="sm" />
                <span className="nombre">{equipos[p.visitaId]?.nombre}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
