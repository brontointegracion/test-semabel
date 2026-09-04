import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEquipo, useSesion, useSiguiendo, useRosterActivo, useRosterInactivo } from '../datos'
import { esDuenoDe } from '../lib/sesion'
import { tablaPosiciones, marcadorEquipo, estadisticaJugadores } from '../lib/marcador'
import { seguirEquipo, sigueEquipo } from '../lib/seguir'
import { codigoDe, urlLiga, urlPartido, urlJugador, urlCancha } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import { Topbar, Escudo, Vacio, RelojVivo, MenuJugador, fechaCorta, hora, diaRelativo } from '../ui'

/**
 * La página del equipo.
 *
 * Nadie sigue "una liga": la gente sigue a su equipo. Es la unidad con la que
 * se identifican, la que buscan por nombre y la que quieren ver en la portada.
 */
export default function Equipo() {
  const { slug } = useParams()
  const d = useEquipo(codigoDe(slug))
  const sesion = useSesion()
  const siguiendo = useSiguiendo()
  const plantillaActiva = useRosterActivo(d?.equipo?.id)
  const inactivos = useRosterInactivo(d?.equipo?.id)
  const [menuAbierto, setMenuAbierto] = useState(null)

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

  // Decisión 62/97: el organizador ve la misma Plantilla, con controles de
  // gestión encima — no una página de administración aparte.
  const esOrganizadorDelEquipo = esDuenoDe(sesion, liga)

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
              <span className="rotulo">Últimos {forma.length}</span>
              {forma.map((r, i) => (
                <span
                  key={i}
                  className={`marca ${r === 'G' ? 'gano' : r === 'P' ? 'perdio' : ''}`}
                  title={r === 'G' ? 'Ganó' : r === 'P' ? 'Perdió' : 'Empató'}
                >
                  {r}
                </span>
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '26px 0 10px' }}>
        <h2 className="seccion" style={{ margin: 0 }}>{liga?.esTorneo ? 'Convocatoria' : 'Plantilla'}</h2>
        {esOrganizadorDelEquipo && (
          <button className="btn fantasma" style={{ width: 'auto', padding: '7px 12px', fontSize: '0.82rem' }}>
            + Añadir jugador
          </button>
        )}
      </div>
      {liga?.esTorneo && (
        <p className="sub" style={{ marginTop: -6, marginBottom: 10 }}>
          Para un torneo no viaja el equipo: viajan los que pueden. El resto se completa con
          refuerzos de otros equipos, y por eso esta lista es propia del torneo.
        </p>
      )}
      <div className="lista">
        {plantillaActiva.map((j) => {
          const s = stats.find((x) => x.jugador.id === j.id)
          return (
            <div key={j.id} className="jugador-fila">
              <Link to={urlJugador(j)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <div className="dorsal">{j.dorsal}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nombre" style={{ fontWeight: 600 }}>{j.nombre}</div>
                  <div className="sub" style={{ fontSize: '0.74rem' }}>
                    {j.refuerzo && <span className="pill acento" style={{ marginRight: 6 }}>Refuerzo</span>}
                    {s?.partidos ? `${s.promedio.toFixed(1)} pts por juego · ${s.faltas} faltas` : 'Sin partidos'}
                    {j.deEquipo && <> · de {j.deEquipo}</>}
                  </div>
                </div>
                {s?.partidos > 0 && (
                  <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.puntos}</div>
                )}
              </Link>
              {esOrganizadorDelEquipo && (
                <MenuJugador
                  abierto={menuAbierto === j.id}
                  onAbrir={() => setMenuAbierto(j.id)}
                  onCerrar={() => setMenuAbierto(null)}
                  onEditar={() => setMenuAbierto(null)}
                  onDesactivar={() => setMenuAbierto(null)}
                />
              )}
            </div>
          )
        })}
        {!plantillaActiva.length && (
          <Vacio>
            Todavía no hay jugadores en este equipo.
            {esOrganizadorDelEquipo && (
              <div style={{ marginTop: 10 }}>
                <button className="btn fantasma" style={{ width: 'auto', padding: '7px 12px', fontSize: '0.82rem' }}>
                  Añadir primer jugador
                </button>
              </div>
            )}
          </Vacio>
        )}
      </div>
      {esOrganizadorDelEquipo && inactivos.length > 0 && (
        <button className="btn fantasma" style={{ width: 'auto', padding: '7px 12px', fontSize: '0.82rem', marginTop: 8 }}>
          Ver inactivos
        </button>
      )}

      <h2 className="seccion">Resultados</h2>
      <div className="lista">
        {jugados.slice().reverse().map((p) => {
          const evs = eventosPorPartido[p.id] || []
          const mios = marcadorEquipo(evs, equipo.id)
          const rivalId = p.localId === equipo.id ? p.visitaId : p.localId
          const otros = marcadorEquipo(evs, rivalId)
          return (
            <Link key={p.id} to={urlPartido(p, equiposPorId[p.localId], equiposPorId[p.visitaId])} className="resultado">
              <div className="duelo">
                <Escudo equipo={equipo} size="sm" />
                <Escudo equipo={equiposPorId[rivalId]} size="sm" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>vs {equiposPorId[rivalId]?.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>{fechaCorta(p.inicio)}</div>
              </div>
              <div className="cierre">
                <div className="cifra">{mios}-{otros}</div>
                <div className={`desenlace ${mios > otros ? 'gano' : mios < otros ? 'perdio' : ''}`}>
                  {mios > otros ? 'Ganó' : mios < otros ? 'Perdió' : 'Empató'}
                </div>
              </div>
            </Link>
          )
        })}
        {!jugados.length && <Vacio>Todavía no ha jugado.</Vacio>}
      </div>
    </>
  )
}
