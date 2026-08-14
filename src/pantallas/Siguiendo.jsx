import { Link } from 'react-router-dom'
import { useLoQueSigo } from '../datos'
import { marcadorEquipo } from '../lib/marcador'
import { urlEquipo, urlPartido, urlJugador, urlCancha } from '../lib/enlaces'
import { urlWaze, tieneUbicacion } from '../lib/mapas'
import { useMeta } from '../lib/meta'
import { Marca, Escudo, Vacio, RelojVivo, fechaCorta, hora, diaRelativo } from '../ui'

/**
 * Lo que sigue quien mira.
 *
 * La pregunta que trae a la gente de vuelta no es "qué pasó en el barrio" sino
 * "cuándo juega mi equipo y dónde". Esta pantalla contesta eso primero: fecha,
 * hora, cancha y cómo llegar, sin buscar nada.
 */
export default function Siguiendo() {
  const d = useLoQueSigo()

  useMeta({
    titulo: 'Tus equipos: próximos partidos y resultados',
    descripcion: 'Sigue a tu equipo y ten a mano cuándo juega, dónde y cómo quedó.',
  })

  if (!d) return null
  const { equipos, jugadores, ligas, canchas, todosEquipos, eventosPorPartido, vivos, proximos, recientes } = d

  if (!equipos.length) {
    return (
      <>
        <Marca />
        <Vacio>
          Todavía no sigues a nadie.<br /><br />
          Entra a un equipo y toca <strong>Seguir</strong>: aquí van a aparecer sus próximos
          partidos, con la cancha y cómo llegar.
        </Vacio>
        <Link to="/" className="btn">Buscar mi equipo</Link>
      </>
    )
  }

  const rival = (p, equipoId) => todosEquipos[p.localId === equipoId ? p.visitaId : p.localId]
  const mio = (p) => equipos.find((e) => e.id === p.localId || e.id === p.visitaId)

  return (
    <>
      <Marca />

      <h2 className="seccion">Mis equipos</h2>
      <div className="carrete">
        {equipos.map((e) => (
          <Link key={e.id} to={urlEquipo(e)} className="chip-equipo">
            <Escudo equipo={e} size="sm" />
            <span>{e.nombre}</span>
          </Link>
        ))}
      </div>

      {vivos.length > 0 && (
        <>
          <h2 className="seccion">Jugando ahora</h2>
          <div className="lista">
            {vivos.map((p) => {
              const evs = eventosPorPartido[p.id] || []
              return (
                <Link key={p.id} to={urlPartido(p, todosEquipos[p.localId], todosEquipos[p.visitaId])} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span className="pill vivo"><i className="punto" />EN VIVO</span>
                    <RelojVivo partido={p} liga={ligas[p.ligaId]} eventos={evs} />
                  </div>
                  {[todosEquipos[p.localId], todosEquipos[p.visitaId]].map((eq) => (
                    <div key={eq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                      <Escudo equipo={eq} size="sm" />
                      <span style={{ flex: 1, fontWeight: 600 }}>{eq.nombre}</span>
                      <span style={{ fontWeight: 800, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums' }}>
                        {marcadorEquipo(evs, eq.id)}
                      </span>
                    </div>
                  ))}
                </Link>
              )
            })}
          </div>
        </>
      )}

      <h2 className="seccion">Cuándo juegan</h2>
      <div className="lista">
        {proximos.map((p) => {
          const yo = mio(p)
          const cancha = canchas[p.canchaId]
          return (
            <div key={p.id} className="card">
              <Link to={urlPartido(p, todosEquipos[p.localId], todosEquipos[p.visitaId])}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Escudo equipo={yo} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>
                      {yo?.nombre} vs {rival(p, yo?.id)?.nombre}
                    </div>
                    <div className="sub" style={{ marginTop: 2 }}>
                      {diaRelativo(p.inicio)} · {hora(p.inicio)} · {cancha?.nombre}
                    </div>
                  </div>
                </div>
              </Link>
              {tieneUbicacion(cancha) && (
                <div className="mapas">
                  <a className="btn" href={urlWaze(cancha)} target="_blank" rel="noopener noreferrer">
                    Cómo llegar
                  </a>
                  <Link className="btn fantasma" to={urlCancha(cancha)}>La cancha</Link>
                </div>
              )}
            </div>
          )
        })}
        {!proximos.length && <p className="sub">No hay partidos programados por ahora.</p>}
      </div>

      <h2 className="seccion">Cómo les fue</h2>
      <div className="lista">
        {recientes.map((p) => {
          const yo = mio(p)
          const evs = eventosPorPartido[p.id] || []
          const mios = marcadorEquipo(evs, yo?.id)
          const otros = marcadorEquipo(evs, rival(p, yo?.id)?.id)
          return (
            <Link key={p.id} to={urlPartido(p, todosEquipos[p.localId], todosEquipos[p.visitaId])} className="jugador-fila">
              <span className={`marca ${mios > otros ? 'gano' : mios < otros ? 'perdio' : ''}`}>
                {mios > otros ? 'G' : mios < otros ? 'P' : 'E'}
              </span>
              <Escudo equipo={rival(p, yo?.id)} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>
                  {yo?.nombre} vs {rival(p, yo?.id)?.nombre}
                </div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>{fechaCorta(p.inicio)}</div>
              </div>
              <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{mios}-{otros}</div>
            </Link>
          )
        })}
        {!recientes.length && <p className="sub">Todavía no han jugado.</p>}
      </div>

      {jugadores.length > 0 && (
        <>
          <h2 className="seccion">Jugadores que sigues</h2>
          <div className="lista">
            {jugadores.map((j) => (
              <Link key={j.id} to={urlJugador(j)} className="jugador-fila">
                <div className="dorsal">{j.dorsal}</div>
                <div style={{ flex: 1 }} className="nombre">{j.nombre}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="aviso" style={{ marginTop: 20 }}>
        <div>
          Cuando haya servidor, esto además avisa: «tu equipo juega mañana a las 7 en
          Don Bosco». Es el aviso que llena la cancha.
        </div>
      </div>
    </>
  )
}
