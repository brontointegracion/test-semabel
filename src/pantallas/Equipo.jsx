import { Link, useParams } from 'react-router-dom'
import { useEquipo, useSiguiendo } from '../datos'
import { tablaPosiciones, marcadorEquipo, estadisticaJugadores } from '../lib/marcador'
import { seguirEquipo, sigueEquipo } from '../lib/seguir'
import { codigoDe, urlLiga, urlPartido, urlJugador, urlCancha } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import { Topbar, Escudo, Vacio, RelojVivo, fechaCorta, hora, diaRelativo } from '../ui'

/**
 * La página del equipo.
 *
 * Nadie sigue "una liga": la gente sigue a su equipo. Es la unidad con la que
 * se identifican, la que buscan por nombre y la que quieren ver en la portada.
 */
export default function Equipo() {
  const { slug } = useParams()
  const d = useEquipo(codigoDe(slug))
  const siguiendo = useSiguiendo()

  useMeta({
    titulo: d && `${d.equipo.nombre}: resultados, plantilla y próximo partido`,
    descripcion: d && (
      `${d.equipo.nombre} en ${d.liga?.nombre}. Calendario, resultados, tabla y ` +
      `estadísticas de sus ${d.jugadores.length} jugadores.`
    ),
  })

  if (!d) return null
  const {
    equipo, liga, jugadores, partidos, jugados, proximo, vivo,
    equiposPorId, canchasPorId, eventosPorPartido,
    partidosLiga, equiposLiga, eventosLiga,
  } = d

  const tabla = tablaPosiciones({
    equipos: equiposLiga,
    partidos: partidosLiga,
    eventosPorPartido: eventosLiga,
    deporte: liga?.deporte,
  })
  const puesto = tabla.findIndex((f) => f.equipo.id === equipo.id) + 1
  const mia = tabla.find((f) => f.equipo.id === equipo.id)

  const stats = estadisticaJugadores({
    jugadores,
    partidos: jugados,
    eventosPorPartido,
  })

  // Los últimos cinco, del más viejo al más nuevo, como se lee la forma.
  const forma = jugados.slice(-5).map((p) => {
    const evs = eventosPorPartido[p.id] || []
    const mios = marcadorEquipo(evs, equipo.id)
    const otros = marcadorEquipo(evs, p.localId === equipo.id ? p.visitaId : p.localId)
    return mios > otros ? 'G' : mios < otros ? 'P' : 'E'
  })

  const sigo = sigueEquipo(siguiendo, equipo)

  return (
    <>
      <Topbar titulo={equipo.nombre} />

      <div className="perfil-hero">
        <Escudo equipo={equipo} size="lg" />
        <div className="datos" style={{ flex: 1, minWidth: 0 }}>
          <div className="nom">{equipo.nombre}</div>
          <Link to={urlLiga(liga)} className="sub">{liga?.nombre}</Link>
          {forma.length > 0 && (
            <div className="forma">
              {forma.map((r, i) => (
                <span key={i} className={`marca ${r === 'G' ? 'gano' : r === 'P' ? 'perdio' : ''}`}>{r}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <button className={`btn ${sigo ? 'fantasma' : ''}`} onClick={() => seguirEquipo(equipo.codigo)}>
        {sigo ? '✓ Siguiendo' : '+ Seguir a este equipo'}
      </button>
      <p className="sub" style={{ marginTop: 8, textAlign: 'center' }}>
        {sigo
          ? 'Aparece en tu pestaña Siguiendo, con su próximo partido.'
          : 'Para tener su próximo partido a mano, sin buscarlo.'}
      </p>

      {mia && (
        <div className="metricas" style={{ marginTop: 18 }}>
          <div className="metrica">
            <div className="n">{puesto}º</div>
            <div className="q">En la tabla</div>
          </div>
          <div className="metrica">
            <div className="n">{mia.jg}-{mia.jp}</div>
            <div className="q">Ganados-perdidos</div>
          </div>
          <div className="metrica">
            <div className="n">{mia.jj ? Math.round(mia.pf / mia.jj) : 0}</div>
            <div className="q">Anota por juego</div>
          </div>
          <div className="metrica">
            <div className="n">{mia.jj ? Math.round(mia.pc / mia.jj) : 0}</div>
            <div className="q">Recibe</div>
          </div>
        </div>
      )}

      {vivo && (
        <>
          <h2 className="seccion">Jugando ahora</h2>
          <Link to={urlPartido(vivo, equiposPorId[vivo.localId], equiposPorId[vivo.visitaId])} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="pill vivo"><i className="punto" />EN VIVO</span>
              <RelojVivo partido={vivo} liga={liga} eventos={eventosPorPartido[vivo.id] || []} />
            </div>
            {[equiposPorId[vivo.localId], equiposPorId[vivo.visitaId]].map((eq) => (
              <div key={eq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                <Escudo equipo={eq} size="sm" />
                <span style={{ flex: 1, fontWeight: 600 }}>{eq.nombre}</span>
                <span style={{ fontWeight: 800, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums' }}>
                  {marcadorEquipo(eventosPorPartido[vivo.id] || [], eq.id)}
                </span>
              </div>
            ))}
          </Link>
        </>
      )}

      {proximo && (
        <>
          <h2 className="seccion">Próximo partido</h2>
          <Link to={urlPartido(proximo, equiposPorId[proximo.localId], equiposPorId[proximo.visitaId])} className="card">
            <div style={{ fontWeight: 700 }}>
              vs {equiposPorId[proximo.localId === equipo.id ? proximo.visitaId : proximo.localId]?.nombre}
            </div>
            <div className="sub" style={{ marginTop: 4 }}>
              {diaRelativo(proximo.inicio)} · {fechaCorta(proximo.inicio)} · {hora(proximo.inicio)}
            </div>
            <div className="sub">{canchasPorId[proximo.canchaId]?.nombre}</div>
          </Link>
          <Link to={urlCancha(canchasPorId[proximo.canchaId])} className="btn fantasma" style={{ marginTop: 8 }}>
            Cómo llegar a la cancha
          </Link>
        </>
      )}

      <h2 className="seccion">Plantilla</h2>
      <div className="lista">
        {jugadores.map((j) => {
          const s = stats.find((x) => x.jugador.id === j.id)
          return (
            <Link key={j.id} to={urlJugador(j)} className="jugador-fila">
              <div className="dorsal">{j.dorsal}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{j.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>
                  {s?.partidos ? `${s.promedio.toFixed(1)} pts por juego · ${s.faltas} faltas` : 'Sin partidos'}
                </div>
              </div>
              {s?.partidos > 0 && (
                <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.puntos}</div>
              )}
            </Link>
          )
        })}
      </div>

      <h2 className="seccion">Resultados</h2>
      <div className="lista">
        {jugados.slice().reverse().map((p) => {
          const evs = eventosPorPartido[p.id] || []
          const mios = marcadorEquipo(evs, equipo.id)
          const rivalId = p.localId === equipo.id ? p.visitaId : p.localId
          const otros = marcadorEquipo(evs, rivalId)
          return (
            <Link key={p.id} to={urlPartido(p, equiposPorId[p.localId], equiposPorId[p.visitaId])} className="jugador-fila">
              <span className={`marca ${mios > otros ? 'gano' : mios < otros ? 'perdio' : ''}`}>
                {mios > otros ? 'G' : mios < otros ? 'P' : 'E'}
              </span>
              <Escudo equipo={equiposPorId[rivalId]} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{equiposPorId[rivalId]?.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>{fechaCorta(p.inicio)}</div>
              </div>
              <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{mios}-{otros}</div>
            </Link>
          )
        })}
        {!jugados.length && <Vacio>Todavía no ha jugado.</Vacio>}
      </div>
    </>
  )
}
