import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Ligas from './pantallas/Ligas'
import Liga from './pantallas/Liga'
import NuevaLiga from './pantallas/NuevaLiga'
import EnVivo from './pantallas/EnVivo'
import Partido from './pantallas/Partido'
import Consola from './pantallas/Consola'
import Jugador from './pantallas/Jugador'
import Canchas from './pantallas/Canchas'
import Cancha from './pantallas/Cancha'
import Saldo from './pantallas/Saldo'
import Codigo from './pantallas/Codigo'

const SIN_TABS = [/^\/partido\/[^/]+$/, /^\/partido\/[^/]+\/consola$/, /^\/b\//]

const iconos = {
  ligas: 'M4 5h16M4 12h16M4 19h10',
  vivo: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 5v4l3 2',
  canchas: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zm0-8.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z',
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
          <Route path="/" element={<Ligas />} />
          <Route path="/nueva" element={<NuevaLiga />} />
          <Route path="/liga/:id" element={<Liga />} />
          <Route path="/vivo" element={<EnVivo />} />
          <Route path="/partido/:id" element={<Partido />} />
          <Route path="/partido/:id/consola" element={<Consola />} />
          <Route path="/jugador/:id" element={<Jugador />} />
          <Route path="/canchas" element={<Canchas />} />
          <Route path="/cancha/:id" element={<Cancha />} />
          <Route path="/saldo" element={<Saldo />} />
          <Route path="/b/:codigo" element={<Codigo />} />
        </Routes>
      </div>

      {conTabs && (
        <nav className="tabbar">
          <Tab to="/" id="ligas">Ligas</Tab>
          <Tab to="/vivo" id="vivo">En vivo</Tab>
          <Tab to="/canchas" id="canchas">Canchas</Tab>
          <Tab to="/saldo" id="saldo">Saldo</Tab>
        </nav>
      )}
    </div>
  )
}
