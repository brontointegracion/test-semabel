import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSesion } from './datos'
import { entrar, salir, esOrganizador } from './lib/sesion'
import { periodoActual } from './lib/marcador'
import { PERIODOS, restanteMs, mmss, corriendo, nombrePeriodo } from './lib/reloj-calculo'

export const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export const hora = (iso) =>
  new Date(iso).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit', hour12: false })

export const fechaCorta = (iso) => {
  const d = new Date(iso)
  return `${DIAS_CORTO[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`
}

export const mismoDia = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString()

export function diaRelativo(iso) {
  const d = new Date(iso)
  const hoy = new Date()
  const manana = new Date(); manana.setDate(hoy.getDate() + 1)
  if (mismoDia(d, hoy)) return 'Hoy'
  if (mismoDia(d, manana)) return 'Mañana'
  return fechaCorta(iso)
}

export function Escudo({ equipo, size = '' }) {
  if (!equipo) return null
  return (
    <div className={`escudo ${size}`} style={{ background: equipo.color }} aria-hidden="true">
      {equipo.corto}
    </div>
  )
}

export function Topbar({ titulo, atras = true, accion = null }) {
  const nav = useNavigate()
  return (
    <div className="topbar">
      {atras && (
        <button className="volver" onClick={() => nav(-1)} aria-label="Volver">
          ‹ Atrás
        </button>
      )}
      <h1>{titulo}</h1>
      {accion}
    </div>
  )
}

export function Marca() {
  const sesion = useSesion()
  const dentro = esOrganizador(sesion)

  return (
    <div className="topbar">
      <div className="marca">sebel<span>.</span></div>
      <div style={{ flex: 1 }} />
      <button className="sesion" onClick={dentro ? salir : entrar}>
        {dentro ? 'Salir' : 'Soy organizador'}
      </button>
    </div>
  )
}

export function Chevron() {
  return (
    <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Vacio({ children }) {
  return <div className="vacio">{children}</div>
}

/**
 * Período y cuenta regresiva de un partido en curso.
 *
 * Se refresca solo, y únicamente mientras el reloj corre: si está detenido no
 * hay nada que animar y no tiene sentido despertar la pantalla cada medio
 * segundo. Al ir dentro de este componente, la lista que lo contiene no se
 * vuelve a dibujar entera con cada tic.
 */
export function RelojVivo({ partido, liga, eventos = [] }) {
  const [, setTic] = useState(0)
  const anda = corriendo(partido)

  useEffect(() => {
    if (!anda) return
    const t = setInterval(() => setTic((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [anda, partido?.relojDesde])

  const periodos = PERIODOS[liga?.deporte] || 2
  const periodo = Math.min(periodoActual(eventos), periodos)

  return (
    <span className="reloj-vivo">
      {periodo}º {nombrePeriodo(liga?.deporte)}
      <b className={anda ? 'anda' : ''}>{mmss(restanteMs(partido, liga))}</b>
    </span>
  )
}
