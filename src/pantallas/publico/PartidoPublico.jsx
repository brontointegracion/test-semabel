import { useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useRecurso } from '../../lib/publico/hooks.js'
import { ID_PUBLICO, ligasConfiguradas } from '../../lib/publico/config.js'
import { horaPanama } from '../../lib/publico/formato.js'
import { recursoJuego, recursoLiga } from '../../lib/publico/recursos.js'
import { urlCalendarioLiga } from '../../lib/publico/agrupar.js'
import { enlacesDePartidos, resolverJuego, resolverLiga } from '../../lib/publico/urls.js'
import { origenDe } from '../../lib/volver.js'
import { proximoPartido, vistaDelMarcador } from '../../lib/publico/vista-marcador.js'
import { Cargando, NoEncontrado, textoDeError, useDireccionCanonica } from './componentes.jsx'
import CompartirPartido from './CompartirPartido.jsx'
import { ContenidoPartido, MarcoPantalla } from './PantallaMarcador.jsx'
import './publico.css'

export { digitosDelMarcador } from './PantallaMarcador.jsx'

/**
 * El marcador público de un partido: el diseño v0 aprobado (REPORT_191) alimentado SOLO por la lectura pública del servidor (nada del
 * prototipo local). Sirve igual para el teléfono en la mano y para el televisor. La vista sale únicamente de lo que el servidor confirmó
 * (ver lib/publico/vista-marcador.js). `alcanceProximo`: alcance EXPLÍCITO para mostrar el próximo partido tras el final (por omisión
 * ninguno: la dirección de un partido fijo no elige sola el siguiente; ver proximoPartido). Las vistas viven en PantallaMarcador.jsx
 * (compartidas con la transmisión de televisión, REPORT_199).
 */
export default function PartidoPublico({ alcanceProximo = null }) {
  const { ligaId: parametroLiga, gameId: parametro } = useParams()
  const location = useLocation()
  const nav = useNavigate()
  const config = useMemo(() => ligasConfiguradas(), [])
  const resLiga = useMemo(() => (config.ok && ID_PUBLICO.test(parametroLiga ?? '') ? resolverLiga(config.ids, parametroLiga) : { ok: false }), [config, parametroLiga])
  const valido = resLiga.ok && ID_PUBLICO.test(parametro ?? '')
  const ligaId = resLiga.ok ? resLiga.ligaId : null
  // La dirección lleva «nombre-sufijo» (sin fecha) o, por compatibilidad, el id completo del partido: se resuelve contra los partidos
  // REALES de la liga admitida. Un identificador desconocido o ambiguo no llega a pedir ningún partido.
  const defLiga = useMemo(() => (valido ? recursoLiga(ligaId) : null), [valido, ligaId])
  const estadoLiga = useRecurso(defLiga)
  const resolucion = useMemo(() => (estadoLiga.datos ? resolverJuego(estadoLiga.datos.partidos, parametro) : null), [estadoLiga.datos, parametro])
  const gameId = resolucion?.ok ? resolucion.gameId : null
  const idsEquipos = useMemo(() => (estadoLiga.datos ? estadoLiga.datos.equipos.map((e) => e.id) : null), [estadoLiga.datos])
  useDireccionCanonica(gameId ? enlacesDePartidos(estadoLiga.datos).get(gameId) : null)
  const def = useMemo(() => (gameId ? recursoJuego(ligaId, gameId) : null), [ligaId, gameId])
  const estado = useRecurso(def)
  const d = estado.datos

  // «Salir»: con origen válido (guardado por el enlace de entrada, en el `state` del historial: sobrevive a recargar la página) vuelve a
  // él con su pestaña; en entrada directa o sin origen válido, a la liga en Calendario. Es la misma regla de Partido.jsx del original.
  const origen = origenDe(location)
  const salir = () => nav(origen || urlCalendarioLiga(ligaId), { replace: true })
  const botonSalir = <button className="cerrar" onClick={salir}>{origen ? '‹ Salir' : 'Ver liga'}</button>

  if (!valido || resolucion?.motivo === 'desconocido' || estado.fase === 'no-encontrado' || estadoLiga.fase === 'no-encontrado') {
    return <NoEncontrado titulo="No encontramos este partido" hacia={valido ? urlCalendarioLiga(ligaId) : '/'} etiqueta={valido ? 'Ver la liga' : 'Ir al inicio'} />
  }
  if (resolucion?.motivo === 'ambiguo') {
    return <NoEncontrado titulo="Este enlace de partido no es claro" hacia={urlCalendarioLiga(ligaId)} etiqueta="Ver la liga" />
  }
  if (!d) {
    const espera = gameId ? estado : estadoLiga // sin la lista de partidos todavía no hay partido que resolver
    return (
      <div className="board-pagina publico">
        <div className="board">
          <div className="board-top">{botonSalir}</div>
          {espera.fase === 'cargando' ? <Cargando /> : <div className="aviso" role="status">{textoDeError(espera)}</div>}
        </div>
      </div>
    )
  }

  const deporte = estadoLiga.datos?.liga.deporte ?? 'baloncesto'
  const vista = vistaDelMarcador({ estado: d.estado, periodo: d.periodo, reloj: d.reloj, deporte })
  const rutaPartido = enlacesDePartidos(estadoLiga.datos).get(gameId)

  let proximo = null
  if (vista === 'final' && alcanceProximo) {
    const actual = estadoLiga.datos.partidos.find((p) => p.gameId === gameId)
    const sig = proximoPartido(estadoLiga.datos.partidos, actual, alcanceProximo)
    if (sig) {
      const nombres = new Map(estadoLiga.datos.equipos.map((e) => [e.id, e.nombre]))
      proximo = { local: nombres.get(sig.local.id) ?? sig.local.id, visita: nombres.get(sig.visita.id) ?? sig.visita.id, hora: horaPanama(sig.programadoPara), aprox: true }
    }
  }

  return (
    <MarcoPantalla
      vista={vista} enVivo={d.estado === 'vivo'} liga={d.liga.nombre} botonSalir={botonSalir}
      /* La dirección es la canónica de ESTE partido (la misma a la que ya se corrige la barra de direcciones), sobre el origen actual. */
      compartir={(
        <CompartirPartido
          ruta={rutaPartido}
          partido={{ liga: d.liga.nombre, local: d.local.nombre, visita: d.visita.nombre, estado: d.estado, programadoPara: d.programadoPara, inicioReal: d.inicioReal, sede: d.sede, puntosLocal: d.local.puntos, puntosVisita: d.visita.puntos }}
        />
      )}
    >
      <ContenidoPartido ligaId={ligaId} gameId={gameId} def={def} estado={estado} deporte={deporte} idsEquipos={idsEquipos} proximo={proximo} />
    </MarcoPantalla>
  )
}
