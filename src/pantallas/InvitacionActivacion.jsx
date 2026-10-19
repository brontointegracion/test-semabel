import { useId, useRef, useState } from 'react'
import { copiarTexto, esOrigenLoopback, mensajeInvitacion, urlActivacion, urlWhatsApp } from '../lib/publico/compartir.js'

// «Invitar al árbitro» (REPORT_182): el organizador copia o manda por WhatsApp la dirección de la pantalla de ACTIVACIÓN de este partido
// (/control/<liga>/<partido>) y, APARTE, copia el código. Esta pieza solo conoce la dirección y los equipos: nunca recibe el código, así que
// no puede ponerlo en el enlace ni en el mensaje. Abrirla no envía nada; copiar y compartir son acciones explícitas. No emite, revoca ni activa nada.
// No es «Compartir partido» (eso es para los espectadores y lleva el marcador público).

export default function InvitacionActivacion({ ligaId, gameId, partido, origen = null }) {
  const [copia, setCopia] = useState(null) // null | 'ok' | 'fallo'
  const campo = useRef(null)
  const id = useId()
  const base = origen ?? (typeof window !== 'undefined' ? window.location.origin : '')
  const url = urlActivacion(base, ligaId, gameId)
  if (!url) return null
  const mensaje = mensajeInvitacion(partido, url)

  const copiar = async () => {
    if (await copiarTexto(url)) { setCopia('ok'); return }
    setCopia('fallo')
    campo.current?.focus()
    campo.current?.select()
  }

  return (
    <section className="invitacion" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>Invitar al árbitro</h3>
      <p className="sub">
        Envía este enlace al árbitro. Comparte el código por separado. La persona debe abrirlo en el teléfono que usará para puntuar.
        Activar el teléfono no comienza el partido.
      </p>
      {esOrigenLoopback(base) && (
        <p className="sub nota-loopback" role="note">
          Este enlace usa una dirección de este computador ({new URL(base).host}): funciona aquí. Un teléfono físico necesita una dirección que pueda alcanzar.
        </p>
      )}
      <div className="acciones-fila">
        <button type="button" className="btn fantasma" onClick={copiar} data-invitacion="copiar">Copiar enlace de activación</button>
        <a className="btn fantasma" href={urlWhatsApp(mensaje)} target="_blank" rel="noopener noreferrer" data-invitacion="whatsapp">Compartir invitación por WhatsApp</a>
      </div>
      <p className={`invitacion-estado ${copia === 'fallo' ? 'fallo' : ''}`} role="status" data-invitacion="estado">
        {copia === 'ok' ? 'Enlace copiado.' : copia === 'fallo' ? 'No se pudo copiar el enlace. Selecciónalo abajo y cópialo a mano.' : ''}
      </p>
      <label className="invitacion-campo">
        <span>Enlace de activación</span>
        <input ref={campo} type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de activación" />
      </label>
    </section>
  )
}
