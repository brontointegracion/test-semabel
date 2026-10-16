import { Link, NavLink } from 'react-router-dom'
import { iconosTab } from '../../lib/publico/navegacion.js'

// Piezas de navegación del ORIGINAL (barra superior con menú de escritorio y barra de pestañas inferior), sin base local ni sesión:
// reciben las pestañas ya decididas. Las usan el prototipo (ui.jsx, App.jsx) y el modo compartido: un solo marcado.

/** Marca + menú de escritorio. `marca` es el nodo de la marca; `accion`, lo que va a la derecha (solo el prototipo lo usa). */
export function MarcaNav({ marca = <div className="marca">sebel<span>.</span></div>, tabs, accion = null }) {
  return (
    <div className="topbar">
      {marca}

      {/* Solo visible a partir de cierto ancho (ver styles.css): en móvil la navegación sigue siendo la barra inferior de siempre. */}
      <nav className="nav-escritorio" aria-label="Navegación principal">
        {tabs.map((t) => (
          <NavLink key={t.id} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'activo' : undefined)}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />
      {accion}
    </div>
  )
}

function Tab({ to, id, children }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'activo' : undefined)} end={to === '/'}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d={iconosTab[id]} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </NavLink>
  )
}

export function BarraTabs({ tabs }) {
  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <Tab key={t.id} to={t.to} id={t.id}>{t.label}</Tab>
      ))}
    </nav>
  )
}

/** Barra superior con «‹ Atrás» y el título: el marcado del original (Topbar de ui.jsx). `alAtras` decide a dónde vuelve (o `hacia`, un enlace con `etiqueta`); `accion` va a la derecha. */
export function TopbarVolver({ titulo, atras = true, accion = null, alAtras, hacia = null, etiqueta = '‹ Atrás' }) {
  return (
    <div className="topbar">
      {/* Con `hacia` el retorno es un enlace al destino lógico (no depende del historial); sin él, el «Atrás» del original. */}
      {atras && hacia && <Link className="volver" to={hacia}>{etiqueta}</Link>}
      {atras && !hacia && (
        <button className="volver" onClick={alAtras} aria-label="Volver">
          ‹ Atrás
        </button>
      )}
      <h1>{titulo}</h1>
      {accion}
    </div>
  )
}
