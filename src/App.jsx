import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
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

export default function App() {
  const { pathname } = useLocation()
  const conTabs = !SIN_TABS.some((r) => r.test(pathname))

  return (
    <div className="app">
      <div className={`contenido ${conTabs ? '' : 'sin-tab'}`}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/ligas" element={<Ligas />} />
          <Route path="/nueva" element={<NuevaLiga />} />
          <Route path="/liga/:id" element={<Liga />} />
          <Route path="/partido/:id" element={<Partido />} />
          <Route path="/partido/:id/consola" element={<Consola />} />
          <Route path="/jugador/:id" element={<Jugador />} />
          <Route path="/canchas" element={<Canchas />} />
          <Route path="/cancha/:id" element={<Cancha />} />
          <Route path="/saldo" element={<Saldo />} />
          <Route path="/noticias" element={<Noticias />} />
          <Route path="/noticia/:id" element={<Noticia />} />
          <Route path="/b/:codigo" element={<Codigo />} />
        </Routes>
      </div>

      {conTabs && (
        <nav className="tabbar">
          <Tab to="/" id="inicio">Inicio</Tab>
          <Tab to="/ligas" id="ligas">Mis ligas</Tab>
          <Tab to="/noticias" id="noticias">Noticias</Tab>
          <Tab to="/saldo" id="saldo">Saldo</Tab>
        </nav>
      )}
    </div>
  )
}
