import { Link } from 'react-router-dom'
import { MarcaNav } from './Navegacion.jsx'
import './publico.css'

/**
 * Fallback EXPLÍCITO de una ruta original que todavía no tiene servidor detrás (ver lib/publico/navegacion.js). No monta la pantalla
 * del prototipo (usa la base local) ni redirige a un flujo local: dice qué es y deja volver al inicio.
 */
export default function NoDisponible({ nombre, tabs, marca }) {
  return (
    <div className="home publico">
      <MarcaNav marca={marca} tabs={tabs} />
      <section className="hm-vacio-liga" role="status">
        <p className="hm-vacio-liga-titulo">{nombre}: todavía no está disponible aquí.</p>
        <p className="hm-vacio-liga-sub">Esta parte de Sebel aún no está conectada a los datos compartidos. Mientras tanto puedes ver las ligas, los equipos y los partidos desde el inicio.</p>
      </section>
      <Link className="btn" to="/" style={{ marginTop: 14 }}>Ir al inicio</Link>
    </div>
  )
}
