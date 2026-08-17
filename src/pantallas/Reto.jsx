import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useReto } from '../datos'
import { marcadorEquipo } from '../lib/marcador'
import { codigoDe, urlLiga, urlPartido, urlJugador } from '../lib/enlaces'
import { compartir } from '../lib/votos'
import { useMeta } from '../lib/meta'
import { Topbar, Escudo, Vacio, fechaCorta } from '../ui'

const PAISES = { PA: 'Panamá', CO: 'Colombia' }

/**
 * Un reto entre dos ligas.
 *
 * Cada una juega lo suyo, en su cancha, con su gente; al final de la semana se
 * comparan los números. No hay que viajar, ni pedir permiso, ni cuadrar
 * calendarios — y por eso se puede repetir todas las semanas, que es lo que un
 * torneo internacional no puede.
 */
export default function Reto() {
  const { slug } = useParams()
  const d = useReto(codigoDe(slug))
  const [aviso, setAviso] = useState(null)

  useMeta({
    titulo: d && d.reto.nombre,
    descripcion: d && (
      `${d.a.liga?.nombre} contra ${d.b.liga?.nombre}: cada liga juega lo suyo y se comparan ` +
      'los números al final de la semana.'
    ),
  })

  if (!d) {
    return (
      <>
        <Topbar titulo="Reto" />
        <Vacio>Este reto no existe.</Vacio>
      </>
    )
  }

  const { reto, a, b, equipos, lider, porEmpezar, enCurso, terminado, diasParaEmpezar, diasRestantes } = d

  const mandar = async () => {
    const texto =
      `${reto.nombre}\n` +
      `${a.liga?.nombre}: ${a.promedio.toFixed(1)} pts por partido (${a.jugados} jugados)\n` +
      `${b.liga?.nombre}: ${b.promedio.toFixed(1)} pts por partido (${b.jugados} jugados)` +
      (lider ? `\nVa arriba ${lider.liga?.nombre}.` : '\nVan igualados.')
    const r = await compartir(texto, location.href)
    if (r) setAviso(r === 'copiado' ? 'Copiado: pégalo en el grupo' : null)
    setTimeout(() => setAviso(null), 2200)
  }

  return (
    <>
      <Topbar titulo={reto.nombre} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Reto entre ligas</div>
        <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Cada liga juega en su cancha, con su gente. Se comparan los promedios de la semana:
          si se comparara el total, ganaría siempre la que juega más veces.
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="pill acento">{reto.categoria}</span>
          <span className="pill">
            {fechaCorta(reto.desde)} — {fechaCorta(reto.hasta)}
          </span>
          {porEmpezar && (
            <span className="pill">
              Empieza en {diasParaEmpezar} día{diasParaEmpezar === 1 ? '' : 's'}
            </span>
          )}
          {enCurso && (
            <span className="pill vivo">
              Quedan {diasRestantes} día{diasRestantes === 1 ? '' : 's'}
            </span>
          )}
          {terminado && <span className="pill">Terminado</span>}
        </div>
      </div>

      <div className="paises" style={{ marginTop: 16 }}>
        {[a, b].map((lado) => (
          <div
            key={lado.liga?.id}
            className={`columna-pais ${lider && lider.liga?.id === lado.liga?.id ? 'lidera' : ''}`}
          >
            <div className="eyebrow">{PAISES[lado.liga?.pais] || lado.liga?.pais}</div>
            <Link to={urlLiga(lado.liga)} style={{ fontWeight: 700, display: 'block', marginTop: 2 }}>
              {lado.liga?.nombre}
            </Link>

            <div className="cifra-grande">{lado.promedio.toFixed(1)}</div>
            <div className="sub" style={{ marginTop: -4 }}>puntos por partido</div>

            <div className="metricas" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
              <div className="metrica">
                <div className="n">{lado.jugados}</div>
                <div className="q">Partidos</div>
              </div>
              <div className="metrica">
                <div className="n">{lado.puntos}</div>
                <div className="q">Puntos</div>
              </div>
            </div>

            {lado.mejor?.jugador && (
              <Link to={urlJugador(lado.mejor.jugador)} className="jugador-fila" style={{ marginTop: 10 }}>
                <div className="dorsal">{lado.mejor.jugador.dorsal}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nombre" style={{ fontWeight: 600 }}>{lado.mejor.jugador.nombre}</div>
                  <div className="sub" style={{ fontSize: '0.72rem' }}>El que más anotó</div>
                </div>
                <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {lado.mejor.puntos}
                </div>
              </Link>
            )}

            <div className="lista" style={{ marginTop: 10 }}>
              {lado.partidos.slice(0, 4).map((p) => (
                <Link
                  key={p.id}
                  to={urlPartido(p, equipos[p.localId], equipos[p.visitaId])}
                  className="jugador-fila"
                >
                  <Escudo equipo={equipos[p.localId]} size="sm" />
                  <Escudo equipo={equipos[p.visitaId]} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sub" style={{ fontSize: '0.72rem' }}>{fechaCorta(p.inicio)}</div>
                  </div>
                </Link>
              ))}
              {!lado.partidos.length && (
                <p className="sub">
                  {porEmpezar ? 'Cuando empiece, aquí van sus partidos.' : 'Todavía no han jugado esta semana.'}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
        <div style={{ fontWeight: 700 }}>
          {porEmpezar
            ? 'Todavía no arranca'
            : lider
              ? `Va arriba ${lider.liga?.nombre}`
              : 'Van igualados'}
        </div>
        <p className="sub" style={{ marginTop: 6 }}>
          {porEmpezar
            ? `Cuentan los partidos que se jueguen desde el ${fechaCorta(reto.desde)}. Los de antes no suman.`
            : enCurso
              ? 'Todavía se puede dar vuelta: quedan partidos por jugar.'
              : 'Así terminó la semana.'}
        </p>
        <button className="btn" style={{ marginTop: 10 }} onClick={mandar}>
          Mandar al grupo
        </button>
        {aviso && <div className="aviso" style={{ marginTop: 8 }}>{aviso}</div>}
      </div>
    </>
  )
}
