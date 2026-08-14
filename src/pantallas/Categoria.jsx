import { Link, useParams } from 'react-router-dom'
import { useCategoria } from '../datos'
import { tablaPosiciones } from '../lib/marcador'
import { urlLiga, urlEquipo } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import { Topbar, Escudo, Vacio, fechaCorta } from '../ui'

const PAISES = { PA: 'Panamá', CO: 'Colombia' }
const DEPORTES = { baloncesto: 'Baloncesto', futsal: 'Fútbol sala' }

/**
 * Una categoría, país por país.
 *
 * Es la pantalla que dice lo importante: tu categoría no existe solo en tu
 * barrio, existe en todos lados, y ahí están los de tu edad en el otro país.
 *
 * Es también la excepción a la regla de país: aquí se ve el otro lado, porque
 * lo que se muestra es precisamente la conexión entre los dos.
 */
export default function Categoria() {
  const { deporte, categoria } = useParams()
  const d = useCategoria(deporte, decodeURIComponent(categoria))

  useMeta({
    titulo: `${DEPORTES[deporte] || deporte} ${decodeURIComponent(categoria)}: dónde se juega`,
    descripcion:
      `Ligas de ${DEPORTES[deporte] || deporte} categoría ${decodeURIComponent(categoria)} ` +
      'en cada país, con sus tablas y sus torneos internacionales.',
  })

  if (!d) {
    return (
      <>
        <Topbar titulo="Categoría" />
        <Vacio>Todavía no hay ligas en esta categoría.</Vacio>
      </>
    )
  }

  const { porPais, eventosPorPartido, torneos, equipos } = d

  return (
    <>
      <Topbar titulo={`${DEPORTES[deporte] || deporte} ${decodeURIComponent(categoria)}`} />

      <p className="sub" style={{ marginTop: 14 }}>
        La misma categoría, en cada país. Los de tu edad no juegan solo aquí.
      </p>

      {torneos.length > 0 && (
        <>
          <h2 className="seccion">Se cruzan aquí</h2>
          {torneos.map((t) => (
            <Link key={t.id} to={urlLiga(t)} className="card">
              <div className="eyebrow">Torneo internacional</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{t.nombre}</div>
              <div className="sub" style={{ marginTop: 2 }}>
                {(t.paises || []).map((p) => PAISES[p] || p).join(' · ')} — sede en {t.provincia}
              </div>
            </Link>
          ))}
        </>
      )}

      <div className="paises">
        {porPais.map((g) => {
          const tabla = tablaPosiciones({
            equipos: g.equipos,
            partidos: g.partidos,
            eventosPorPartido,
            deporte,
          }).filter((f) => f.jj > 0)

          return (
            <div key={g.pais} className="columna-pais">
              <h2 className="seccion" style={{ marginTop: 0 }}>{PAISES[g.pais] || g.pais}</h2>
              <div className="sub" style={{ marginTop: -6, marginBottom: 8 }}>
                {g.ligas.map((l) => l.provincia).join(', ')}
              </div>

              <div className="lista">
                {tabla.slice(0, 6).map((f, i) => (
                  <Link key={f.equipo.id} to={urlEquipo(f.equipo)} className="jugador-fila">
                    <span className="puesto">{i + 1}</span>
                    <Escudo equipo={f.equipo} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nombre" style={{ fontWeight: 600 }}>{f.equipo.nombre}</div>
                      <div className="sub" style={{ fontSize: '0.72rem' }}>{f.jg}-{f.jp}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{f.pts}</div>
                  </Link>
                ))}
                {!tabla.length && <p className="sub">Sin partidos jugados todavía.</p>}
              </div>

              {g.ligas.map((l) => (
                <Link key={l.id} to={urlLiga(l)} className="sub" style={{ display: 'block', marginTop: 8 }}>
                  {l.nombre} →
                </Link>
              ))}
            </div>
          )
        })}
      </div>

      <div className="aviso" style={{ marginTop: 20 }}>
        <div>
          Lo siguiente es el <strong>reto entre ligas</strong>: dos ligas de la misma categoría
          acuerdan una semana, cada una juega lo suyo, y se comparan los resultados. Sin viajar
          y sin permisos.
        </div>
      </div>
    </>
  )
}
