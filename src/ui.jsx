import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { estadoDeEntrada } from './lib/volver'
import { horaLocal } from './lib/publico/formato.js'
import { useSesion } from './datos'
import { entrar, salir, esOrganizador } from './lib/sesion'
import { modoCompartido } from './lib/modo'
import { TABS, iconosTab } from './lib/publico/navegacion.js'
import { MarcaNav, TopbarVolver } from './pantallas/publico/Navegacion.jsx'
import { periodoActual } from './lib/marcador'
import { PERIODOS, restanteMs, mmss, corriendo, nombrePeriodo } from './lib/reloj-calculo'

/**
 * La única lista de la navegación principal. La usan la barra inferior
 * (móvil, en App.jsx) y la navegación de la cabecera (escritorio, aquí
 * abajo en Marca) — así nunca hay dos sitios que puedan quedar
 * desincronizados en qué rutas o etiquetas existen.
 */
export { TABS, iconosTab }

export const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Hora local del dispositivo en 12 horas («7:05 p. m.»), con el formato único del sitio (REPORT_161).
export const hora = (iso) => horaLocal(iso) ?? ''

export const fechaCorta = (iso) => {
  const d = new Date(iso)
  return `${DIAS_CORTO[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`
}

// Fecha absoluta con año, para hechos que hay que poder ubicar en el tiempo
// mucho después de ocurridos (p. ej. cuándo se desactivó una ficha) — a
// diferencia de fechaCorta(), pensada para partidos recientes/cercanos.
export const fechaLarga = (iso) =>
  new Date(iso).toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' })

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

/**
 * Enlace a un partido. Guarda la pantalla actual (con su pestaña) como origen
 * para el "Salir" del partido. Todo enlace a /p/... debería usar este.
 */
export function EnlacePartido(props) {
  const location = useLocation()
  return <Link {...props} state={estadoDeEntrada(location)} />
}

// `alAtras` reemplaza el nav(-1) por defecto (la consola vuelve siempre al partido).
export function Topbar({ titulo, atras = true, accion = null, alAtras = null }) {
  const nav = useNavigate()
  return <TopbarVolver titulo={titulo} atras={atras} accion={accion} alAtras={alAtras || (() => nav(-1))} />
}

export function Marca() {
  const sesion = useSesion()
  const dentro = esOrganizador(sesion)
  const tabs = TABS.filter((t) => !t.organizador || dentro)

  // El atajo "Soy organizador" es solo del prototipo local: en modo compartido no existe.
  return (
    <MarcaNav
      tabs={tabs}
      accion={!modoCompartido() && (
        <button className="sesion" onClick={dentro ? salir : entrar}>
          {dentro ? 'Salir' : 'Soy organizador'}
        </button>
      )}
    />
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
 * Menú de acciones del organizador sobre una fila de Plantilla (Decisión 88).
 * Solo presenta y delega: quien lo usa conecta onEditar/onDesactivar/
 * onReactivar a las operaciones reales de plantilla.jsx/roster.js.
 *
 * Una fila inactiva (Stage 3B, Slice 7) ofrece Reactivar en vez de
 * Desactivar — nunca ambas — porque la acción activa no aplica a una ficha
 * que ya está inactiva.
 */
export function MenuJugador({ abierto, onAbrir, onCerrar, onEditar, onDesactivar, onReactivar, inactivo = false }) {
  const raiz = useRef(null)

  // El pointerdown de un clic en un ítem del menú también llega aquí (burbujea
  // hasta document antes de que React dispare el click): si no se descarta,
  // cierra el menú y desmonta el botón antes de que su propio onClick llegue
  // a ejecutarse. Por eso se ignora todo pointerdown que ocurra dentro del menú.
  useEffect(() => {
    if (!abierto) return
    const cerrarFuera = (e) => {
      if (raiz.current?.contains(e.target)) return
      onCerrar()
    }
    document.addEventListener('pointerdown', cerrarFuera)
    return () => document.removeEventListener('pointerdown', cerrarFuera)
  }, [abierto, onCerrar])

  return (
    <div className="menu-jugador" ref={raiz}>
      <button
        className="menu-jugador-boton"
        aria-label="Acciones del jugador"
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={abierto ? onCerrar : onAbrir}
      >
        ⋯
      </button>
      {abierto && (
        <div className="menu-jugador-lista" role="menu">
          <button role="menuitem" onClick={onEditar}>Editar jugador</button>
          {inactivo
            ? <button role="menuitem" onClick={onReactivar}>Reactivar jugador</button>
            : <button role="menuitem" onClick={onDesactivar}>Desactivar jugador</button>}
        </div>
      )}
    </div>
  )
}

/**
 * Contenedor responsivo compartido por Añadir/Editar jugador y las
 * confirmaciones de ciclo de vida (Decisiones 23, 104, 105): modal en
 * escritorio, hoja inferior en móvil, misma marcación en ambos casos.
 *
 * Solo presenta. Quien lo usa decide qué hacer con un intento de cierre
 * (cerrar de una vez, o preguntar primero) — por eso el callback se llama
 * onSolicitarCierre y no onCerrar.
 */
export function Hoja({ abierta, titulo, onSolicitarCierre, children }) {
  useEffect(() => {
    if (!abierta) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onTecla = (e) => { if (e.key === 'Escape') onSolicitarCierre() }
    document.addEventListener('keydown', onTecla)
    return () => {
      document.body.style.overflow = antes
      document.removeEventListener('keydown', onTecla)
    }
  }, [abierta, onSolicitarCierre])

  if (!abierta) return null

  return (
    <div className="hoja-fondo" onClick={onSolicitarCierre}>
      <div
        className="hoja"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hoja-cabecera">
          <h2>{titulo}</h2>
          <button type="button" className="hoja-cerrar" aria-label="Cerrar" onClick={onSolicitarCierre}>×</button>
        </div>
        <div className="hoja-cuerpo">{children}</div>
      </div>
    </div>
  )
}

/**
 * Confirmación breve y no bloqueante tras una mutación exitosa (Decisión 47).
 * Se retira sola; no requiere que el organizador la descarte.
 */
export function Toast({ mensaje, onFin }) {
  useEffect(() => {
    if (!mensaje) return
    const t = setTimeout(onFin, 2600)
    return () => clearTimeout(t)
  }, [mensaje, onFin])

  if (!mensaje) return null
  return <div className="toast" role="status">{mensaje}</div>
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
