import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AccesoOrganizador from './pantallas/AccesoOrganizador'
import ControlActivar from './pantallas/ControlActivar'
import ControlPartido from './pantallas/ControlPartido'
import EnPreparacion from './pantallas/EnPreparacion'
import LigaOrganizador from './pantallas/LigaOrganizador'
import PanelOrganizador from './pantallas/PanelOrganizador'
import PlantillaOrganizador from './pantallas/PlantillaOrganizador'
import EquipoPublico from './pantallas/publico/EquipoPublico'
import InicioCompartido from './pantallas/publico/InicioCompartido'
import LigaCompartida from './pantallas/publico/LigaCompartida'
import NoDisponible from './pantallas/publico/NoDisponible'
import { BarraTabs } from './pantallas/publico/Navegacion'
import PartidoPublico from './pantallas/publico/PartidoPublico'
import { RUTAS_NO_DISPONIBLES, SIN_TABS_COMPARTIDO, TABS } from './lib/publico/navegacion'
import { useSesionServidor } from './lib/sesion-servidor'

// La aplicación en modo compartido: el MISMO diseño y la MISMA navegación del original (portada, menú, barra de pestañas), con los datos
// del servidor. Rutas montadas (todas contra el servidor):
//   /                                  portada original (InicioCompartido → PortadaInicio)
//   /liga/:ligaId[/partido/:gameId]    lecturas públicas. Direcciones públicas en minúsculas (REPORT_158): `ligaId` es el id en minúsculas (o el original);
//                                      `gameId` es «nombre-sufijo» sin fecha (sufijo estable derivado del id interno) o, por compatibilidad, el id completo
//   /liga/:ligaId/equipo/:equipoId     equipo; `equipoId` es la clave pública del equipo en la liga o, por compatibilidad, su id completo
//   /anthony/…                         entrada y panel del organizador (la sesión la decide el servidor)
//   /control/:ligaId/:partidoId[/marcador]   activación del teléfono y pantalla de puntuación
// Las rutas ORIGINALES que aún no tienen servidor (lib/publico/navegacion.js) no montan su pantalla del prototipo: responden con un
// aviso explícito. «/ligas» (Mis ligas) lleva al panel del organizador, que exige sesión del servidor. Nada local concede permisos.
// Las pestañas del organizador solo se ven si la sesión del servidor YA está confirmada en esta carga (las pantallas públicas no
// preguntan por la sesión: un visitante solo pide lecturas públicas).
export default function AppCompartida() {
  const { pathname } = useLocation()
  const sesion = useSesionServidor()
  const organiza = sesion.estado === 'activa'
  const conTabs = !SIN_TABS_COMPARTIDO.some((r) => r.test(pathname))
  const tabs = TABS.filter((t) => !t.organizador || organiza)

  return (
    <div className={`app ${organiza ? 'con-cuatro' : 'con-dos'}`}>
      <div className={`contenido ${conTabs ? '' : 'sin-tab'}`}>
        <Routes>
          <Route path="/" element={<InicioCompartido tabs={tabs} />} />
          <Route path="/liga/:ligaId" element={<LigaCompartida />} />
          <Route path="/liga/:ligaId/partido/:gameId" element={<PartidoPublico />} />
          <Route path="/liga/:ligaId/equipo/:equipoId" element={<EquipoPublico />} />
          <Route path="/anthony/access" element={<AccesoOrganizador />} />
          <Route path="/anthony/ligas" element={<PanelOrganizador />} />
          <Route path="/anthony/ligas/:ligaId" element={<LigaOrganizador />} />
          <Route path="/anthony/ligas/:ligaId/equipos/:equipoId" element={<PlantillaOrganizador />} />
          <Route path="/anthony" element={<Navigate to="/anthony/access" replace />} />
          <Route path="/control/:ligaId/:partidoId" element={<ControlActivar />} />
          <Route path="/control/:ligaId/:partidoId/marcador" element={<ControlPartido />} />
          <Route path="/ligas" element={<Navigate to="/anthony/ligas" replace />} />
          {RUTAS_NO_DISPONIBLES.map((r) => (
            <Route key={r.ruta} path={r.ruta} element={<NoDisponible nombre={r.nombre} tabs={tabs} marca={<div className="marca-publica">semabel<span>.</span>com</div>} />} />
          ))}
          <Route path="*" element={<EnPreparacion />} />
        </Routes>
      </div>
      {conTabs && <BarraTabs tabs={tabs} />}
    </div>
  )
}
