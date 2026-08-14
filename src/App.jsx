import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { useSesion } from './datos'
import { esOrganizador } from './lib/sesion'
import Inicio from './pantallas/Inicio'
import Ligas from './pantallas/Ligas'
import Liga from './pantallas/Liga'
import NuevaLiga from './pantallas/NuevaLiga'
import Partido from './pantallas/Partido'
import Consola from './pantallas/Consola'
import Jugador from './pantallas/Jugador'
import Canchas from './pantallas/Canchas'
import Cancha from './pantallas/Cancha'
import Saldo from './pantallas/Saldo'
import Noticias from './pantallas/Noticias'
import Noticia from './pantallas/Noticia'
import Codigo from './pantallas/Codigo'

const SIN_TABS = [/^\/partido\/[^/]+$/, /^\/partido\/[^/]+\/consola$/, /^\/b\//]

const iconos = {
  inicio: 'M4 11.5L12 4l8 7.5M6 10v10h12V10',
  ligas: 'M4 5h16M4 12h16M4 19h10',
  noticias: 'M4 5h13a1 1 0 011 1v13H6a2 2 0 01-2-2V5zm14 3h2v9a2 2 0 01-2 2M7 9h7M7 13h7',
  saldo: 'M3 8h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm0 0l2.4-4h13.2L21 8M7 14h4',
}

function Tab({ to, id, children }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'activo' : undefined)} end={to === '/'}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d={iconos[id]} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </NavLink>
  )
}

/** Lo que solo existe para quien organiza. Un invitado que llegue aquí vuelve a la portada. */
function SoloOrganizador({ sesion, children }) {
  return esOrganizador(sesion) ? children : <Navigate to="/" replace />
}

export default function App() {
  const { pathname } = useLocation()
  const sesion = useSesion()
  const conTabs = !SIN_TABS.some((r) => r.test(pathname))
  const organiza = esOrganizador(sesion)

  if (!sesion) return null

  return (
    <div className={`app ${organiza ? 'con-cuatro' : 'con-dos'}`}>
      <div className={`contenido ${conTabs ? '' : 'sin-tab'}`}>
        <Routes>
          {/* Público */}
          <Route path="/" element={<Inicio />} />
          <Route path="/liga/:id" element={<Liga />} />
          <Route path="/partido/:id" element={<Partido />} />
          <Route path="/jugador/:id" element={<Jugador />} />
          <Route path="/cancha/:id" element={<Cancha />} />
          <Route path="/noticias" element={<Noticias />} />
          <Route path="/noticia/:id" element={<Noticia />} />
          <Route path="/b/:codigo" element={<Codigo />} />

          {/* Solo el organizador */}
          <Route path="/ligas" element={<SoloOrganizador sesion={sesion}><Ligas /></SoloOrganizador>} />
          <Route path="/nueva" element={<SoloOrganizador sesion={sesion}><NuevaLiga /></SoloOrganizador>} />
          <Route path="/saldo" element={<SoloOrganizador sesion={sesion}><Saldo /></SoloOrganizador>} />
          <Route path="/canchas" element={<SoloOrganizador sesion={sesion}><Canchas /></SoloOrganizador>} />
          <Route path="/partido/:id/consola" element={<SoloOrganizador sesion={sesion}><Consola /></SoloOrganizador>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {conTabs && (
        <nav className="tabbar">
          <Tab to="/" id="inicio">Inicio</Tab>
          {organiza && <Tab to="/ligas" id="ligas">Mis ligas</Tab>}
          <Tab to="/noticias" id="noticias">Noticias</Tab>
          {organiza && <Tab to="/saldo" id="saldo">Saldo</Tab>}
        </nav>
      )}
    </div>
  )
}
