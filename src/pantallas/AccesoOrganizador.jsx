import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { MENSAJES } from '../lib/acceso-api'
import { leerRegistros } from '../lib/operacion-pendiente'
import { entrar, refrescar, salir, useSesionServidor } from '../lib/sesion-servidor'
import { horaLocal as horaLocalDe12 } from '../lib/publico/formato.js'
import './AccesoOrganizador.css'

// Entrada del organizador (/anthony/access). La dirección es solo navegación: no da ni pide nada.
// El código vive únicamente en el estado del campo, se limpia al enviar y nunca se guarda ni se muestra de nuevo.

const horaLocal = (ms) => (ms ? horaLocalDe12(ms) : null)

export default function AccesoOrganizador() {
  const { estado, datos, aviso, ocupado } = useSesionServidor()
  const [codigo, setCodigo] = useState('')
  const ubicacion = useLocation()

  // Sin buscadores: la página no se indexa (el encabezado de respuesta lo refuerza).
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  // Al abrir y al volver a la pestaña se pregunta al servidor; no hay sondeo.
  useEffect(() => {
    refrescar({ conAviso: false })
    const alVolver = () => { if (document.visibilityState === 'visible') refrescar() }
    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => { window.removeEventListener('focus', alVolver); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  function enviar(evento) {
    evento.preventDefault()
    if (ocupado) return
    const usado = codigo
    setCodigo('') // se borra del campo ANTES de enviar: no queda en pantalla ni en el estado
    if (usado.trim() === '') return
    entrar(usado)
  }

  if (estado === 'cargando') {
    return <main className="acceso"><p className="sub" role="status">Comprobando…</p></main>
  }

  if (estado === 'activa') {
    // Si una pantalla protegida nos mandó aquí por una sesión terminada, se vuelve a donde estaba.
    const desde = ubicacion.state?.desde
    if (typeof desde === 'string' && desde.startsWith('/anthony/') && desde !== '/anthony/access') return <Navigate to={desde} replace />
    const hasta = horaLocal(datos.expiraAbs)
    const sinConfirmar = leerRegistros(datos.organizadorId).registros.length
    return (
      <main className="acceso">
        <h1>Acceso autorizado</h1>
        <p className="sub">Tienes acceso a {datos.ligas.length} {datos.ligas.length === 1 ? 'liga' : 'ligas'}.</p>
        <p><Link className="btn" to="/anthony/ligas">Ver mis ligas y plantillas</Link></p>
        {sinConfirmar > 0 && (
          <p className="aviso-acceso" role="note">
            Tienes {sinConfirmar} {sinConfirmar === 1 ? 'acción sin confirmar' : 'acciones sin confirmar'}. Cerrar sesión no {sinConfirmar === 1 ? 'la borra' : 'las borra'}:
            se conserva en este navegador (sin cifrar) hasta que el servidor confirme un resultado, y solo se podrá repetir cuando vuelvas a entrar con el mismo código.
          </p>
        )}
        <p className="pendiente">
          El control de partidos todavía no está disponible desde aquí.
          {hasta && ` Tu sesión termina, como máximo, a las ${hasta}.`}
        </p>
        {aviso && <p className="aviso-acceso" role="alert">{MENSAJES[aviso]}</p>}
        <button type="button" className="btn fantasma" onClick={salir} disabled={ocupado}>Cerrar sesión</button>
      </main>
    )
  }

  return (
    <main className="acceso">
      <h1>Acceso del organizador</h1>
      <p className="sub">Escribe tu código de acceso.</p>
      {aviso && <p className="aviso-acceso" role="alert">{MENSAJES[aviso]}</p>}
      <form onSubmit={enviar} method="post" autoComplete="off" noValidate>
        <div className="campo">
          <label htmlFor="codigo-acceso">Código de acceso</label>
          <input
            id="codigo-acceso"
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={64}
            data-lpignore="true"
            data-1p-ignore="true"
            enterKeyHint="go"
            disabled={ocupado}
          />
        </div>
        <button type="submit" className="btn" disabled={ocupado || codigo.trim() === ''}>{ocupado ? 'Comprobando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}
