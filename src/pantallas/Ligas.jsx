import { Link, useNavigate } from 'react-router-dom'
import { useLigas, useCuenta } from '../datos'
import { Marca, Chevron, diaRelativo, hora } from '../ui'

export default function Ligas() {
  const ligas = useLigas()
  const cuenta = useCuenta()
  const nav = useNavigate()

  return (
    <>
      <Marca />

      <div className="eyebrow" style={{ marginTop: 18 }}>
        {cuenta ? `${cuenta.nombre} · organizador` : ' '}
      </div>
      <h2 className="seccion" style={{ marginTop: 4 }}>Mis ligas</h2>

      <div className="lista">
        {(ligas || []).map(({ liga, canchas, total, jugados, vivo, proximo }) => (
          <Link key={liga.id} to={`/liga/${liga.id}`} className="card">
            <div className="fila-liga">
              <div className="info">
                <div className="nombre">{liga.nombre}</div>
                <div className="sub" style={{ marginTop: 2 }}>
                  {liga.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala'} ·{' '}
                  {canchas.map((c) => c.nombre).join(' y ')}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                  {vivo && (
                    <span className="pill vivo"><i className="punto" />EN VIVO</span>
                  )}
                  <span className="pill">{jugados} de {total} jugados</span>
                  {proximo && !vivo && (
                    <span className="pill">
                      {diaRelativo(proximo.inicio)} {hora(proximo.inicio)}
                    </span>
                  )}
                </div>
              </div>
              <Chevron />
            </div>
          </Link>
        ))}
      </div>

      {cuenta && (
        <div className="aviso" style={{ marginTop: 18 }}>
          <div>
            Te quedan <strong>{cuenta.saldo} partidos</strong> de saldo gratis para llevar el
            marcador en vivo. Anotar el resultado final a mano no gasta saldo.
          </div>
        </div>
      )}

      <h2 className="seccion">Empezar otra</h2>
      <button className="btn" onClick={() => nav('/nueva')}>
        Crear una liga
      </button>
      <p className="sub" style={{ marginTop: 10, textAlign: 'center' }}>
        Dices cuántos equipos, qué días y en qué cancha. El calendario lo arma Sebel.
      </p>
    </>
  )
}
