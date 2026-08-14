import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { usePartido, useSesion } from '../datos'
import { marcadorEquipo, faltasEquipo, periodoActual, destacadosDeEquipo } from '../lib/marcador'
import { esDuenoDe } from '../lib/sesion'
import { PERIODOS, restanteMs, mmss, corriendo, nombrePeriodo } from '../lib/reloj'
import { Escudo, fechaCorta, hora } from '../ui'
import { codigoDe, urlPartido, urlJugador } from '../lib/enlaces'
import { useMeta, useDatosEstructurados, partidoComoEvento } from '../lib/meta'

/**
 * El marcador. No es un tablero de resultados que además muestra el puntaje:
 * es el marcador de la cancha, servido por un link. El mismo URL sirve para
 * el teléfono en la mano y para el televisor en la pared.
 *
 * El detalle (mejor anotador, más faltas) va debajo, fuera de la pantalla:
 * quien mira de lejos ve solo los números grandes.
 */
export default function Partido() {
  const { slug } = useParams()
  const nav = useNavigate()
  const d = usePartido(codigoDe(slug))
  const sesion = useSesion()
  const [, setTic] = useState(0)
  const contenedor = useRef(null)
  const [completa, setCompleta] = useState(false)

  // Medio segundo: con un tic de un segundo exacto, el reloj se ve saltar cifras.
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let lock
    ;(async () => {
      try { lock = await navigator.wakeLock?.request('screen') } catch { /* no disponible */ }
    })()
    return () => lock?.release?.()
  }, [])

  // Salir con Esc o con el gesto del sistema también tiene que apagar el modo.
  useEffect(() => {
    const alCambiar = () => setCompleta(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  // Lo que va al título, a la descripción y a la tarjeta que se comparte.
  // Un partido es la página que más se comparte del sitio: es la que tiene que
  // decir quién juega, contra quién, cuándo, dónde y —si ya terminó— cómo quedó.
  const gLocal = d ? marcadorEquipo(d.eventos, d.partido.localId) : 0
  const gVisita = d ? marcadorEquipo(d.eventos, d.partido.visitaId) : 0
  const cerrado = d?.partido.estado === 'final'

  useMeta({
    titulo: d && (
      cerrado
        ? `${d.local?.nombre} ${gLocal}-${gVisita} ${d.visita?.nombre}`
        : `${d.local?.nombre} vs ${d.visita?.nombre}`
    ),
    descripcion: d && (
      cerrado
        ? `Resultado: ${d.local?.nombre} ${gLocal}-${gVisita} ${d.visita?.nombre}. ` +
          `${d.liga?.nombre}, ${fechaCorta(d.partido.inicio)} en ${d.cancha?.nombre}.`
        : d.partido.estado === 'vivo'
          ? `En vivo: ${d.local?.nombre} ${gLocal}-${gVisita} ${d.visita?.nombre}. ` +
            `${d.liga?.nombre}, desde ${d.cancha?.nombre}.`
          : `${d.local?.nombre} contra ${d.visita?.nombre} el ${fechaCorta(d.partido.inicio)} ` +
            `a las ${hora(d.partido.inicio)} en ${d.cancha?.nombre}. ${d.liga?.nombre}.`
    ),
  })

  useDatosEstructurados(
    d ? partidoComoEvento({ ...d, golesLocal: gLocal, golesVisita: gVisita }) : null,
  )

  if (!d) return null
  const { partido, liga, cancha, local, visita, jugadores, eventos } = d

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const vivo = partido.estado === 'vivo'
  const periodos = PERIODOS[liga.deporte] || 2
  const periodo = Math.min(periodoActual(eventos), periodos)
  const falta = restanteMs(partido, liga)

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
                  ? `${periodo}º ${nombrePeriodo(liga.deporte)}`
                  : 'Por jugar'}
            </div>
            {vivo && (
              <>
                <div className={`reloj ${corriendo(partido) ? '' : 'detenido'}`}>{mmss(falta)}</div>
                {!corriendo(partido) && (
                  <div className="estado-reloj">{falta === 0 ? 'fin del período' : 'detenido'}</div>
                )}
              </>
            )}
            {partido.estado === 'programado' && (
              <div className="reloj" style={{ fontSize: '1rem' }}>{hora(partido.inicio)}</div>
            )}
          </div>
          <Lado equipo={visita} puntos={gv} />
        </div>

        {/* En pantalla completa las figuras van aquí: nadie hace scroll en un televisor. */}
        {completa && hayDetalle && (
          <div className="figuras-tv">
            {[local, visita].map((eq) => (
              <ColumnaFiguras key={eq.id} equipo={eq} eventos={eventos} jugadores={jugadores} />
            ))}
          </div>
        )}

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
            <Link to={`${urlPartido(partido, local, visita)}/consola`} className="btn">Llevar el marcador</Link>
          )}
        </div>

        {hayDetalle && !completa && <div className="bajar">Desliza para el detalle ↓</div>}
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

/** Las mismas figuras, en una tira que cabe en el marcador a pantalla completa. */
function ColumnaFiguras({ equipo, eventos, jugadores }) {
  const { mejor, masFaltas } = destacadosDeEquipo({ eventos, jugadores, equipoId: equipo.id })
  const corto = (j) => `#${j.dorsal} ${j.nombre.split(' ')[0]} ${j.nombre.split(' ')[1]?.[0] || ''}.`

  return (
    <div className="col">
      <div className="titulo">
        <span className="marca-eq" style={{ background: equipo.color }} />
        {equipo.corto}
      </div>
      <div className="fig">
        <span className="rol">Mejor</span>
        <span className="quien">{mejor ? corto(mejor.jugador) : '—'}</span>
        <span className="n">{mejor ? mejor.puntos : ''}</span>
      </div>
      <div className="fig">
        <span className="rol">Faltas</span>
        <span className="quien">{masFaltas ? corto(masFaltas.jugador) : '—'}</span>
        <span className="n faltas">{masFaltas ? masFaltas.faltas : ''}</span>
      </div>
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
            <Link to={urlJugador(mejor.jugador)} className="quien">
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
            <Link to={urlJugador(masFaltas.jugador)} className="quien">
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
