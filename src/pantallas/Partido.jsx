import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { usePartido } from '../datos'
import { marcadorEquipo, periodoActual } from '../lib/marcador'
import { fechaCorta, hora } from '../ui'

/**
 * El marcador. No es un tablero de resultados que además muestra el puntaje:
 * es el marcador de la cancha, servido por un link. El mismo URL sirve para
 * el teléfono en la mano y para el televisor en la pared.
 */
export default function Partido() {
  const { id } = useParams()
  const nav = useNavigate()
  const d = usePartido(id)
  const [tic, setTic] = useState(0)
  const contenedor = useRef(null)
  const [completa, setCompleta] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Mantener la pantalla encendida mientras el marcador está a la vista.
  useEffect(() => {
    let lock
    const pedir = async () => {
      try { lock = await navigator.wakeLock?.request('screen') } catch { /* no disponible */ }
    }
    pedir()
    return () => lock?.release?.()
  }, [])

  if (!d) return null
  const { partido, liga, cancha, local, visita, eventos } = d

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const vivo = partido.estado === 'vivo'
  const periodos = liga.deporte === 'baloncesto' ? 4 : 2
  const periodo = Math.min(periodoActual(eventos), periodos)

  const minutos = vivo
    ? Math.floor((Date.now() - new Date(partido.inicio).getTime()) / 60000)
    : null

  const ultimo = [...eventos].filter((e) => !e.anulado).sort((a, b) => b.seq - a.seq)[0]
  const desdeUltimo = ultimo?.creadoEn
    ? Math.floor((Date.now() - ultimo.creadoEn) / 60000)
    : null

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

  return (
    <div className={`board ${completa ? 'pantalla-completa' : ''}`} ref={contenedor}>
      <div className="board-top">
        <button className="cerrar" onClick={() => nav(-1)}>‹ Salir</button>
        <span className="liga">{liga.nombre}</span>
        {vivo && <span className="pill vivo"><i className="punto" />EN VIVO</span>}
      </div>

      <div className="cuerpo">
        <Lado equipo={local} puntos={gl} />
        <div className="medio">
          <div className="periodo">
            {partido.estado === 'final' ? 'Final' : vivo ? `${periodo}º ${liga.deporte === 'baloncesto' ? 'cuarto' : 'tiempo'}` : 'Por jugar'}
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
          <div style={{ opacity: 0.7 }}>{fechaCorta(partido.inicio)}</div>
          {vivo && desdeUltimo > 2 && (
            <div className="desfase">Última jugada hace {desdeUltimo} min</div>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ opacity: 0.7, fontSize: '0.68rem' }}>EN LA TELE</div>
          <div className="codigo">sebel.com/b/{partido.codigo}</div>
        </div>
      </div>

      <div className="btn-fila" style={{ marginTop: 12 }}>
        <button className="btn fantasma" style={{ color: '#B9C9C2', borderColor: '#253430' }} onClick={pantallaCompleta}>
          {completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
        </button>
        {partido.estado !== 'final' && (
          <Link to={`/partido/${partido.id}/consola`} className="btn" style={{ textDecoration: 'none' }}>
            Llevar el marcador
          </Link>
        )}
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
