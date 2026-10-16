import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { invalidar, refrescar, useSesionServidor } from '../lib/sesion-servidor'
import { SIN_CONEXION } from '../lib/roster-api'
import './PanelOrganizador.css'

// Piezas comunes del panel del organizador (modo compartido). NO importan Dexie, datos del prototipo, roles locales ni
// la plantilla local: todo lo que muestran viene del servidor.

export { SIN_CONEXION }

/** Solo deja pasar con sesión del servidor; si no, lleva a la entrada y recuerda a dónde volver. */
export function Protegida({ children }) {
  const { estado } = useSesionServidor()
  const ubicacion = useLocation()
  useEffect(() => {
    if (estado === 'cargando') refrescar({ conAviso: false })
  }, [estado])
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') refrescar() }
    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => { window.removeEventListener('focus', alVolver); document.removeEventListener('visibilitychange', alVolver) }
  }, [])
  if (estado === 'cargando') return <main className="panel"><p className="sub" role="status">Comprobando…</p></main>
  if (estado === 'sin-sesion') return <Navigate to="/anthony/access" replace state={{ desde: ubicacion.pathname }} />
  return children
}

/** Hoja modal (mismas clases que la del prototipo, sin importar su módulo). */
export function HojaOrganizador({ titulo, onCerrar, children }) {
  useEffect(() => {
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onTecla = (e) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', onTecla)
    return () => { document.body.style.overflow = antes; document.removeEventListener('keydown', onTecla) }
  }, [onCerrar])
  return (
    <div className="hoja-fondo" onClick={onCerrar}>
      <div className="hoja" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="hoja-cabecera">
          <h2>{titulo}</h2>
          <button type="button" className="hoja-cerrar" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </div>
        <div className="hoja-cuerpo">{children}</div>
      </div>
    </div>
  )
}

/**
 * Carga una lectura del servidor. Una sesión terminada (401) se comunica a la sesión compartida.
 * → [{ cargando, res }, recargar]
 */
export function useLectura(leer, claves) {
  const [estado, setEstado] = useState({ cargando: true, res: null })
  const contador = useRef(0)
  const recargar = useCallback(async () => {
    const mio = ++contador.current
    setEstado((e) => ({ ...e, cargando: true }))
    const res = await leer()
    if (mio !== contador.current) return
    if (res.tipo === 'no-autorizado') invalidar()
    setEstado({ cargando: false, res })
  }, claves) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { recargar() }, [recargar])
  return [estado, recargar]
}

export function ErrorDeLectura({ res, onReintentar }) {
  const texto = res.tipo === 'sin-conexion' ? SIN_CONEXION
    : res.tipo === 'no-encontrado' ? 'No encontramos eso, o no tienes acceso.'
      : 'No pudimos cargar esta información. Inténtalo de nuevo.'
  return (
    <div className="aviso-panel" role="alert">
      <p style={{ margin: '0 0 10px' }}>{texto}</p>
      <button type="button" className="btn fantasma" onClick={onReintentar}>Reintentar</button>
    </div>
  )
}

const TEXTOS_APLICADO = { creado: 'Jugador añadido', editado: 'Jugador actualizado', desactivado: 'Jugador desactivado', reactivado: 'Jugador reactivado' }
const TEXTOS_RECHAZO = {
  'equipo-bloqueado': 'No se aplicó: este equipo tiene un partido en curso. La plantilla se puede cambiar cuando termine',
  'ficha-desactualizada': 'No se aplicó: la ficha cambió desde que la abriste',
  'conflicto-numero': 'No se aplicó: ese número ya lo tiene otro jugador activo de este equipo',
  invalido: 'No se aplicó: había datos no válidos',
  candidatos: 'No se aplicó: había jugadores con el mismo nombre. Envíalo de nuevo eligiendo qué hacer',
  'ya-activo': 'No se aplicó: esa persona ya está activa en este equipo',
  'ya-activa': 'No se aplicó: la ficha ya estaba activa',
  'ya-inactiva': 'No se aplicó: la ficha ya estaba inactiva',
  'identidad-invalida': 'No se aplicó: no pudimos verificar la identidad elegida',
}
/** Texto fijo para un resultado DECIDIDO (nunca texto del servidor). Sin punto final: quien lo muestra lo añade. */
export function textoDeResultado(cuerpo, reproducido) {
  const base = cuerpo.resultado === 'aplicado'
    ? (TEXTOS_APLICADO[cuerpo.tipo] ?? 'Acción aplicada')
    : (TEXTOS_RECHAZO[cuerpo.tipo] ?? 'No se aplicó')
  return reproducido ? `${base}. Esta acción ya se había procesado antes` : base
}
