import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { useSesion } from './datos'
import { esOrganizador } from './lib/sesion'
import { TABS, iconosTab } from './ui'
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
import Equipo from './pantallas/Equipo'
import Siguiendo from './pantallas/Siguiendo'
import Figuras from './pantallas/Figuras'
import Categoria from './pantallas/Categoria'
import Reto from './pantallas/Reto'
import Retar from './pantallas/Retar'
import Noticia from './pantallas/Noticia'
import Codigo from './pantallas/Codigo'

const SIN_TABS = [/^\/p\/[^/]+$/, /^\/p\/[^/]+\/consola$/, /^\/b\//]

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
          <Route path="/l/:slug" element={<Liga />} />
          <Route path="/p/:slug" element={<Partido />} />
          <Route path="/e/:slug" element={<Equipo />} />
          <Route path="/j/:slug" element={<Jugador />} />
          <Route path="/c/:slug" element={<Cancha />} />
          <Route path="/siguiendo" element={<Siguiendo />} />
          <Route path="/figuras" element={<Figuras />} />
          <Route path="/cat/:deporte/:categoria" element={<Categoria />} />
          <Route path="/r/:slug" element={<Reto />} />
          <Route path="/l/:slug/retar" element={<SoloOrganizador sesion={sesion}><Retar /></SoloOrganizador>} />
          <Route path="/noticias" element={<Noticias />} />
          <Route path="/n/:slug" element={<Noticia />} />
          <Route path="/b/:codigo" element={<Codigo />} />

          {/* Solo el organizador */}
          <Route path="/ligas" element={<SoloOrganizador sesion={sesion}><Ligas /></SoloOrganizador>} />
          <Route path="/nueva" element={<SoloOrganizador sesion={sesion}><NuevaLiga /></SoloOrganizador>} />
          <Route path="/saldo" element={<SoloOrganizador sesion={sesion}><Saldo /></SoloOrganizador>} />
          <Route path="/canchas" element={<SoloOrganizador sesion={sesion}><Canchas /></SoloOrganizador>} />
          <Route path="/p/:slug/consola" element={<SoloOrganizador sesion={sesion}><Consola /></SoloOrganizador>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {conTabs && (
        <nav className="tabbar">
          {TABS.filter((t) => !t.organizador || organiza).map((t) => (
            <Tab key={t.id} to={t.to} id={t.id}>{t.label}</Tab>
          ))}
        </nav>
      )}
    </div>
  )
}
