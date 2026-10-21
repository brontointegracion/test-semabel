import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ALIAS_PILOTO, RUTA_PANEL, rutaCanonicaDeLegado } from './lib/rutas-organizador'
import AccesoOrganizador from './pantallas/AccesoOrganizador'
import ControlActivar from './pantallas/ControlActivar'
import ControlPartido from './pantallas/ControlPartido'
import EnPreparacion from './pantallas/EnPreparacion'
import LigaOrganizador from './pantallas/LigaOrganizador'
import PanelOrganizador from './pantallas/PanelOrganizador'
import PartidoOrganizador from './pantallas/PartidoOrganizador'
import PlantillaOrganizador from './pantallas/PlantillaOrganizador'
import EquipoPublico from './pantallas/publico/EquipoPublico'
import InicioCompartido from './pantallas/publico/InicioCompartido'
import LigaCompartida from './pantallas/publico/LigaCompartida'
import NoDisponible from './pantallas/publico/NoDisponible'
import { BarraTabs } from './pantallas/publico/Navegacion'
import PartidoPublico from './pantallas/publico/PartidoPublico'
import TvCancha from './pantallas/publico/TvCancha'
import TvPiloto from './pantallas/publico/TvPiloto'
import { RUTA_TV } from './lib/publico/tv-piloto'
import { RUTA_TV_CANCHA } from './lib/publico/tv-secuencia'
import { RUTAS_NO_DISPONIBLES, SIN_TABS_COMPARTIDO, TABS } from './lib/publico/navegacion'
import { useSesionServidor } from './lib/sesion-servidor'

// La aplicación en modo compartido: el MISMO diseño y la MISMA navegación del original (portada, menú, barra de pestañas), con los datos
// del servidor. Rutas montadas (todas contra el servidor):
//   /                                  portada original (InicioCompartido → PortadaInicio)
//   /liga/:ligaId[/partido/:gameId]    lecturas públicas. Direcciones públicas en minúsculas (REPORT_158): `ligaId` es el id en minúsculas (o el original);
//                                      `gameId` es «nombre-sufijo» sin fecha (sufijo estable derivado del id interno) o, por compatibilidad, el id completo
//   /liga/:ligaId/equipo/:equipoId     equipo; `equipoId` es la clave pública del equipo en la liga o, por compatibilidad, su id completo
//   /organizador/acceso, /organizador, /organizador/ligas/:l[/equipos/:e | /partidos/:g]   entrada y panel del organizador (la sesión la decide
//                                      el servidor); …/partidos/:g prepara el acceso de puntuación. /anthony/…, /ligas y el alias de piloto /deportivo-vip/ligas redirigen aquí (REPORT_179/180)
//   /tv                                entrada corta TEMPORAL del piloto: lista de partidos de una liga configurada (lib/publico/tv-piloto.js)
//   /tv/cancha                         transmisión de UNA cancha: sigue una secuencia explícita de partidos (lib/publico/tv-secuencia.js)
//   /control/:ligaId/:partidoId[/marcador]   activación del teléfono y pantalla de puntuación
// Las rutas ORIGINALES que aún no tienen servidor (lib/publico/navegacion.js) no montan su pantalla del prototipo: responden con un
// aviso explícito. «/ligas» (Mis ligas) lleva al panel del organizador, que exige sesión del servidor. Nada local concede permisos.
// Las pestañas del organizador solo se ven si la sesión del servidor YA está confirmada en esta carga (las pantallas públicas no
// preguntan por la sesión: un visitante solo pide lecturas públicas).
/** Redirección de una dirección antigua a su canónica. La canónica nunca vuelve a redirigir (sin bucles). */
function RedirigirLegado() {
  const { pathname, search, hash, state } = useLocation()
  const hacia = rutaCanonicaDeLegado(pathname) ?? RUTA_PANEL
  return <Navigate to={{ pathname: hacia, search, hash }} state={state} replace />
}

export default function AppCompartida() {
  const { pathname } = useLocation()
  const sesion = useSesionServidor()
  const organiza = sesion.estado === 'activa'
  const conTabs = !SIN_TABS_COMPARTIDO.some((r) => r.test(pathname))
  // «Mis ligas» apunta a la dirección canónica del organizador (en el prototipo sigue siendo /ligas).
  const tabs = TABS.filter((t) => !t.organizador || organiza).map((t) => (t.id === 'ligas' ? { ...t, to: RUTA_PANEL } : t))

  return (
    <div className={`app ${organiza ? 'con-cuatro' : 'con-dos'}`}>
      <div className={`contenido ${conTabs ? '' : 'sin-tab'}`}>
        <Routes>
          <Route path="/" element={<InicioCompartido tabs={tabs} />} />
          <Route path="/liga/:ligaId" element={<LigaCompartida />} />
          <Route path="/liga/:ligaId/partido/:gameId" element={<PartidoPublico />} />
          <Route path="/liga/:ligaId/equipo/:equipoId" element={<EquipoPublico />} />
          {/* Entrada corta TEMPORAL del piloto (REPORT_186, ver lib/publico/tv-piloto.js): selector público de partidos; sin sesión ni permisos. */}
          <Route path={RUTA_TV} element={<TvPiloto />} />
          {/* Transmisión continua de UNA cancha (REPORT_199): una dirección estable que sigue la secuencia explícita de lib/publico/tv-secuencia.js. */}
          <Route path={RUTA_TV_CANCHA} element={<TvCancha />} />
          <Route path="/organizador/acceso" element={<AccesoOrganizador />} />
          <Route path="/organizador" element={<PanelOrganizador />} />
          <Route path="/organizador/ligas/:ligaId" element={<LigaOrganizador />} />
          <Route path="/organizador/ligas/:ligaId/equipos/:equipoId" element={<PlantillaOrganizador />} />
          <Route path="/organizador/ligas/:ligaId/partidos/:gameId" element={<PartidoOrganizador />} />
          {/* Compatibilidad: las direcciones de antes redirigen a la canónica, conservando la búsqueda, el fragmento y el estado de retorno. */}
          <Route path="/anthony/*" element={<RedirigirLegado />} />
          <Route path="/anthony" element={<RedirigirLegado />} />
          <Route path="/control/:ligaId/:partidoId" element={<ControlActivar />} />
          <Route path="/control/:ligaId/:partidoId/marcador" element={<ControlPartido />} />
          <Route path="/ligas" element={<RedirigirLegado />} />
          {/* Alias de entrada del piloto (documentado en rutas-organizador.js): la misma entrada autenticada, sin decidir permisos. */}
          {ALIAS_PILOTO.map((ruta) => <Route key={ruta} path={ruta} element={<RedirigirLegado />} />)}
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
