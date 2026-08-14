import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { usePartido, useSesion } from '../datos'
import { marcadorEquipo, faltasEquipo, periodoActual, destacadosDeEquipo } from '../lib/marcador'
import { esDuenoDe } from '../lib/sesion'
import { Escudo, fechaCorta, hora } from '../ui'

/**
 * El marcador. No es un tablero de resultados que además muestra el puntaje:
 * es el marcador de la cancha, servido por un link. El mismo URL sirve para
 * el teléfono en la mano y para el televisor en la pared.
 *
 * El detalle (mejor anotador, más faltas) va debajo, fuera de la pantalla:
 * quien mira de lejos ve solo los números grandes.
 */
export default function Partido() {
  const { id } = useParams()
  const nav = useNavigate()
  const d = usePartido(id)
  const sesion = useSesion()
  const [, setTic] = useState(0)
  const contenedor = useRef(null)
  const [completa, setCompleta] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let lock
    ;(async () => {
      try { lock = await navigator.wakeLock?.request('screen') } catch { /* no disponible */ }
    })()
    return () => lock?.release?.()
  }, [])

  if (!d) return null
  const { partido, liga, cancha, local, visita, jugadores, eventos } = d

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const vivo = partido.estado === 'vivo'
  const periodos = liga.deporte === 'baloncesto' ? 4 : 2
  const periodo = Math.min(periodoActual(eventos), periodos)

  const minutos = vivo ? Math.floor((Date.now() - new Date(partido.inicio).getTime()) / 60000) : null

  const ultimo = eventos.filter((e) => !e.anulado).sort((a, b) => b.seq - a.seq)[0]
  const desdeUltimo = ultimo?.creadoEn ? Math.floor((Date.now() - ultimo.creadoEn) / 60000) : null

  const pantallaCompleta = async () => {
    try {
      if (!document.fullscreenElement) {
        await contenedor.current?.requestFullscreen()
        setCompleta(true)
      } else {
        await document.exitFullscreen()
        setCompleta(false)
      }
    } catch { /* el navegador puede negarlo */ }
  }

  const hayDetalle = eventos.some((e) => !e.anulado)

  return (
    <div className="board-pagina" ref={contenedor}>
      <div className={`board ${completa ? 'pantalla-completa' : ''}`}>
        <div className="board-top">
          <button className="cerrar" onClick={() => nav(-1)}>‹ Salir</button>
          <span className="liga">{liga.nombre}</span>
          {vivo && <span className="pill vivo"><i className="punto" />EN VIVO</span>}
        </div>

        <div className="cuerpo">
          <Lado equipo={local} puntos={gl} />
          <div className="medio">
            <div className="periodo">
              {partido.estado === 'final'
                ? 'Final'
                : vivo
                  ? `${periodo}º ${liga.deporte === 'baloncesto' ? 'cuarto' : 'tiempo'}`
                  : 'Por jugar'}
            </div>
            {vivo && <div className="reloj">{minutos}′</div>}
            {partido.estado === 'programado' && (
              <div className="reloj" style={{ fontSize: '1rem' }}>{hora(partido.inicio)}</div>
            )}
          </div>
          <Lado equipo={visita} puntos={gv} />
        </div>

        <div className="pie">
          <div>
            <div>{cancha?.nombre}</div>
            <div style={{ opacity: 0.75 }}>{fechaCorta(partido.inicio)}</div>
            {vivo && desdeUltimo > 2 && (
              <div className="desfase">Última jugada hace {desdeUltimo} min</div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ opacity: 0.75, fontSize: '0.68rem' }}>EN LA TELE</div>
            <div className="codigo">sebel.com/b/{partido.codigo}</div>
          </div>
        </div>

        <div className="btn-fila" style={{ marginTop: 12 }}>
          <button className="btn fantasma" onClick={pantallaCompleta}>
            {completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
          </button>
          {/* Llevar el marcador es cosa del dueño de la liga. Nadie más lo ve. */}
          {partido.estado !== 'final' && esDuenoDe(sesion, liga) && (
            <Link to={`/partido/${partido.id}/consola`} className="btn">Llevar el marcador</Link>
          )}
        </div>

        {hayDetalle && <div className="bajar">Desliza para el detalle ↓</div>}
      </div>

      {hayDetalle && (
        <div className="detalle">
          <h2 className="seccion" style={{ marginTop: 0 }}>Figuras del partido</h2>
          <div className="destacados">
            {[local, visita].map((eq) => (
              <TarjetaEquipo
                key={eq.id}
                equipo={eq}
                eventos={eventos}
                jugadores={jugadores}
                puntos={eq.id === partido.localId ? gl : gv}
              />
            ))}
          </div>
          <p className="sub" style={{ marginTop: 14 }}>
            Todo esto sale de los mismos eventos que arman el marcador. Si el árbitro anula una
            falta, estas tarjetas cambian solas.
          </p>
        </div>
      )}
    </div>
  )
}

function Lado({ equipo, puntos }) {
  return (
    <div className="equipo">
      <div className="barra" style={{ background: equipo?.color }} />
      <div className="corto">{equipo?.corto}</div>
      <div className="puntos">{puntos}</div>
    </div>
  )
}

function TarjetaEquipo({ equipo, eventos, jugadores, puntos }) {
  const { mejor, masFaltas } = destacadosDeEquipo({ eventos, jugadores, equipoId: equipo.id })
  const faltas = faltasEquipo(eventos, equipo.id)

  return (
    <div className="destacado">
      <div className="encabezado">
        <Escudo equipo={equipo} size="sm" />
        <span className="nombre">{equipo.nombre}</span>
        <span className="pill" style={{ marginLeft: 'auto' }}>{puntos} pts</span>
      </div>

      <div className="renglon">
        <span className="q">Mejor</span>
        {mejor ? (
          <>
            <Link to={`/jugador/${mejor.jugador.id}`} className="quien">
              #{mejor.jugador.dorsal} {mejor.jugador.nombre}
            </Link>
            <span className="n">{mejor.puntos}</span>
          </>
        ) : (
          <span className="quien sub">Nadie ha anotado</span>
        )}
      </div>

      <div className="renglon">
        <span className="q">Más faltas</span>
        {masFaltas ? (
          <>
            <Link to={`/jugador/${masFaltas.jugador.id}`} className="quien">
              #{masFaltas.jugador.dorsal} {masFaltas.jugador.nombre}
            </Link>
            <span className="n faltas">{masFaltas.faltas}</span>
          </>
        ) : (
          <span className="quien sub">Sin faltas</span>
        )}
      </div>

      <div className="renglon">
        <span className="q">Equipo</span>
        <span className="quien sub">Faltas en total</span>
        <span className="n faltas">{faltas}</span>
      </div>
    </div>
  )
}
