import { useEffect, useId, useRef, useState } from 'react'
import { copiarTexto, mensajeDePartido, urlPublicaDePartido, urlWhatsApp } from '../../lib/publico/compartir.js'
import './CompartirPartido.css'

// «Compartir partido»: un botón que abre una hoja con (1) «Compartir por WhatsApp» (un enlace que abre el redactor con el texto escrito;
// no envía nada), (2) «Copiar enlace» con un mensaje verdadero del resultado y (3) el enlace en un campo seleccionable, que sirve cuando
// el navegador no deja copiar. Solo comparte la dirección pública canónica del partido sobre el origen ACTUAL (nunca un host fijo).

export default function CompartirPartido({ ruta, partido, origen = null, clase = 'btn fantasma' }) {
  const [abierto, setAbierto] = useState(false)
  const [copia, setCopia] = useState(null) // null | 'ok' | 'fallo'
  const campo = useRef(null)
  const id = useId()
  const base = origen ?? (typeof window !== 'undefined' ? window.location.origin : '')
  const url = urlPublicaDePartido(base, ruta)

  useEffect(() => {
    if (!abierto) return undefined
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [abierto])

  if (!url) return null // sin dirección pública canónica no hay nada que compartir
  const texto = mensajeDePartido(partido, url)

  const copiar = async () => {
    if (await copiarTexto(url)) { setCopia('ok'); return }
    setCopia('fallo')
    campo.current?.focus()
    campo.current?.select()
  }

  return (
    <div className="compartir">
      <button type="button" className={clase} aria-expanded={abierto} aria-controls={`${id}-hoja`} onClick={() => { setCopia(null); setAbierto((a) => !a) }}>
        Compartir partido
      </button>
      {abierto && (
        <div className="compartir-hoja" id={`${id}-hoja`} role="group" aria-label="Compartir partido">
          <p className="compartir-titulo">Compartir este partido</p>
          <p className="compartir-sub">Se comparte solo el enlace público del marcador. No se envía nada hasta que elijas el chat y pulses enviar.</p>
          <a className="btn" href={urlWhatsApp(texto)} target="_blank" rel="noopener noreferrer" data-compartir="whatsapp">Compartir por WhatsApp</a>
          <button type="button" className="btn fantasma" onClick={copiar} data-compartir="copiar">Copiar enlace</button>
          <p className={`compartir-estado ${copia === 'fallo' ? 'fallo' : ''}`} role="status" data-compartir="estado">
            {copia === 'ok' ? 'Enlace copiado.' : copia === 'fallo' ? 'No se pudo copiar el enlace. Selecciónalo abajo y cópialo a mano.' : ''}
          </p>
          <label className="compartir-campo">
            <span>Enlace del partido</span>
            <input ref={campo} type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace del partido" />
          </label>
          <button type="button" className="btn sutil" onClick={() => setAbierto(false)}>Cerrar</button>
        </div>
      )}
    </div>
  )
}
