import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MarcaNav } from './Navegacion.jsx'
import './publico.css'

// ---------------------------------------------------------------------------
// /contacto (REPORT_214): página pública y ESTÁTICA. Sin formulario, sin envío automático, sin peticiones, sin credenciales y sin escribir nada guardado.
// El correo es un enlace `mailto:` normal y la dirección también se muestra como texto seleccionable. No se afirma que el buzón esté verificado,
// ni se prometen precios ni funciones.
// ---------------------------------------------------------------------------

export const CORREO_CONTACTO = 'ventas@semabel.com'
export const RUTA_CONTACTO = '/contacto'

export default function Contacto({ tabs, marca }) {
  useEffect(() => {
    const anterior = document.title
    document.title = 'Contacto · semabel.com'
    return () => { document.title = anterior }
  }, [])
  return (
    <div className="home publico contacto">
      <MarcaNav marca={marca} tabs={tabs} />
      <main className="contacto-cuerpo">
        <p className="contacto-volver"><Link to="/" className="btn fantasma">‹ Volver al inicio</Link></p>
        <h1 className="hm-hero-titulo">Tu torneo merece que lo sigan.</h1>
        <p className="contacto-texto">Lleva el marcador desde el teléfono y comparte partidos, resultados y estadísticas con tu comunidad.</p>
        <p className="contacto-texto">Cuéntanos sobre tu liga, dónde juegan y cuándo comienza. Te ayudamos a encontrar una forma sencilla de llevarla con Semabel.</p>
        <p className="contacto-accion">
          <a className="btn" href={`mailto:${CORREO_CONTACTO}`}>Escríbenos a {CORREO_CONTACTO}</a>
        </p>
        <p className="contacto-direccion sub">Dirección de correo: <span className="contacto-correo">{CORREO_CONTACTO}</span></p>
      </main>
    </div>
  )
}
