import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { estadoDeEntrada } from '../../lib/volver.js'
import { frescura } from '../../lib/publico/hooks.js'
import { horaCompletaPanama } from '../../lib/publico/formato.js'
import { iniciales } from '../../lib/publico/vista-reloj.js'
import './publico.css'

// Piezas de presentación de las pantallas públicas del modo compartido. No leen la base local, no conocen la sesión ni el
// prototipo (por eso no importan ui.jsx): solo reciben datos ya validados del servidor.

export function MarcaPublica() {
  return (
    <div className="topbar">
      <div className="marca-publica">semabel<span>.</span>com</div>
    </div>
  )
}

export function TopbarPublica({ titulo, hacia = '/', etiqueta = '‹ Inicio', accion = null }) {
  return (
    <div className="topbar">
      <Link className="volver" to={hacia}>{etiqueta}</Link>
      <h1>{titulo}</h1>
      {accion}
    </div>
  )
}

/** «Inicio» de la barra superior: SIEMPRE abre la portada («/»), a cualquier ancho; no depende del historial ni de la pantalla de origen. */
export function EnlaceInicio() {
  return <Link className="sesion" to="/">Inicio</Link>
}

/** Escudo de texto: el servidor aún no publica logos ni colores, así que se usan las iniciales del equipo. */
export function EscudoTexto({ nombre, size = 'sm' }) {
  return <div className={`escudo ${size} escudo-texto`} aria-hidden="true">{iniciales(nombre)}</div>
}

export function Cargando({ children = 'Cargando…' }) {
  return <div className="vacio" role="status">{children}</div>
}

/** Texto para un recurso que no se pudo cargar (sin datos previos). */
export function textoDeError(estado) {
  if (estado.fase === 'no-encontrado') return 'No encontramos esto. Revisa el link.'
  if (estado.fase === 'terminal') return 'Esta liga es demasiado grande para mostrarse por ahora.'
  if (estado.error?.tipo === 'no-disponible') return 'Los datos se están preparando. Volveremos a intentar en unos segundos.'
  return 'No se pudo cargar. Volveremos a intentar en unos segundos.'
}

export function NoEncontrado({ titulo = 'No encontramos esta página', hacia = '/', etiqueta = 'Ir al inicio' }) {
  return (
    <main className="en-preparacion publico">
      <h1>{titulo}</h1>
      <p className="sub">Revisa el link o vuelve al inicio.</p>
      <Link className="btn" to={hacia}>{etiqueta}</Link>
    </main>
  )
}

/**
 * Aviso de que los datos dejaron de actualizarse (con la hora del último dato confirmado, hora del SERVIDOR en Panamá). Con datos al día no muestra nada.
 * `periodoMs`: cada cuánto se espera un dato nuevo. Nunca se llama «Última jugada»: el servidor no publica esa hora.
 */
export function PieFrescura({ estado, mono, periodoMs, saltoMono, className = 'sub' }) {
  if (!estado.datos) return null
  const f = frescura(estado, mono, { periodoMs, saltoMono })
  if (f.sinActualizar) {
    const hora = horaCompletaPanama(estado.ultimoExito?.servidorMs)
    return (
      <p className={`${className} sin-actualizar`} role="status">
        Sin actualizar{hora ? ` · último dato confirmado a las ${hora}` : ''}
      </p>
    )
  }
  return null // la hora de la última actualización ya no se muestra de rutina: solo el aviso de «Sin actualizar»
}

/**
 * Enlace a un partido (o a otra pantalla pública) que guarda la pantalla actual, con su pestaña, como origen del «Salir» del partido.
 * El destino lo escribe la propia app en `state` y se vuelve a validar al usarlo (volver.js): nunca viene de la URL.
 */
export function EnlaceConOrigen(props) {
  const location = useLocation()
  return <Link {...props} state={estadoDeEntrada(location)} />
}

/**
 * Normaliza la dirección: si la ruta actual no es la canónica (mayúsculas, id completo, nombre antiguo) la reemplaza por la canónica
 * SIN perder la búsqueda (?pestana=…), el ancla ni el `state` (el origen de «Salir»). No agrega una entrada al historial.
 */
export function useDireccionCanonica(canonica) {
  const nav = useNavigate()
  const { pathname, search, hash, state } = useLocation()
  useEffect(() => {
    if (canonica && pathname !== canonica) nav({ pathname: canonica, search, hash }, { replace: true, state })
  }, [canonica, pathname, search, hash, state, nav])
}
