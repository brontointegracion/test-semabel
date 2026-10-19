import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { frescura, useMono, useRecurso } from '../../lib/publico/hooks.js'
import { ID_PUBLICO, ligasConfiguradas } from '../../lib/publico/config.js'
import { fechaCortaPanama, horaCompletaPanama, horaPanama, textoSede } from '../../lib/publico/formato.js'
import { ahoraServidor } from '../../lib/publico/reloj-servidor.js'
import { recursoJuego, recursoLiga } from '../../lib/publico/recursos.js'
import { vistaReloj } from '../../lib/publico/vista-reloj.js'
import { urlCalendarioLiga } from '../../lib/publico/agrupar.js'
import { enlacesDePartidos, resolverJuego, resolverLiga } from '../../lib/publico/urls.js'
import { origenDe } from '../../lib/volver.js'
import { urlEquipoPublico } from '../../lib/publico/equipo.js'
import { Cargando, NoEncontrado, textoDeError, useDireccionCanonica } from './componentes.jsx'
import CompartirPartido from './CompartirPartido.jsx'
import './publico.css'

/** Cuántos dígitos debe caber en cada lado del marcador (el mayor de los dos, mínimo 2): el CSS dimensiona AMBOS números con él. */
export const digitosDelMarcador = (local, visita) => Math.max(2, String(local).length, String(visita).length)

/**
 * El marcador público de un partido: el mismo tablero grande del prototipo, alimentado SOLO por la lectura pública del
 * servidor (nada del prototipo local). Sirve igual para el teléfono en la mano y para el televisor.
 */
export default function PartidoPublico() {
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
  const { mono, saltoMono } = useMono({ activo: valido })
  const contenedor = useRef(null)
  const [completa, setCompleta] = useState(false)
  const d = estado.datos

  useEffect(() => {
    const alCambiar = () => setCompleta(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  // Mantener la pantalla encendida (televisor): se pide de nuevo al volver a verse la pestaña.
  useEffect(() => {
    let candado = null
    let vivo = true
    const pedir = async () => {
      try { candado = await navigator.wakeLock?.request('screen') } catch { /* no disponible */ }
      if (!vivo) candado?.release?.()
    }
    const alVer = () => { if (document.visibilityState === 'visible') pedir() }
    pedir()
    document.addEventListener('visibilitychange', alVer)
    return () => { vivo = false; document.removeEventListener('visibilitychange', alVer); candado?.release?.() }
  }, [])

  useEffect(() => {
    if (!d) return undefined
    const anterior = document.title
    const marcador = d.estado === 'programado' ? 'vs' : `${d.local.puntos}-${d.visita.puntos}`
    document.title = `${d.local.nombre} ${marcador} ${d.visita.nombre} · semabel.com`
    return () => { document.title = anterior }
  }, [d?.local.nombre, d?.visita.nombre, d?.local.puntos, d?.visita.puntos, d?.estado]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const periodoMs = def.periodoDe(d)
  const f = frescura(estado, mono, { periodoMs, saltoMono })
  const v = vistaReloj({ estado: d.estado, reloj: d.reloj, muestra: estado.muestra, mono, relojConfiable: f.relojConfiable })
  const vivo = d.estado === 'vivo'
  const retrasado = d.estado === 'programado' && d.programadoPara !== null && estado.muestra !== null
    && Date.parse(d.programadoPara) < ahoraServidor(estado.muestra, mono)
  const cuando = d.programadoPara ?? d.inicioReal
  const ultimoDato = horaCompletaPanama(estado.ultimoExito?.servidorMs)

  const pantallaCompleta = async () => {
    try {
      if (!document.fullscreenElement) await contenedor.current?.requestFullscreen()
      else await document.exitFullscreen()
    } catch { /* el navegador puede negarlo */ }
  }

  return (
    <div className="board-pagina publico" ref={contenedor}>
      <div className={`board ${completa ? 'pantalla-completa' : ''}`}>
        <div className="board-top">
          {botonSalir}
          <span className="liga">{d.liga.nombre}</span>
          {vivo && <span className="pill vivo"><i className="punto" />EN VIVO</span>}
        </div>

        <div className="cuerpo" style={{ '--d': digitosDelMarcador(d.local.puntos, d.visita.puntos) }}>
          <Lado equipo={d.local} ligaId={ligaId} ids={idsEquipos} />
          <div className="medio">
            <div className="periodo">
              {d.estado === 'final' ? 'Final' : vivo ? `Periodo ${d.periodo}` : 'Por jugar'}
            </div>
            {vivo && (
              <>
                <div className={`reloj ${v.detenido ? 'detenido' : ''}`} aria-label="Reloj del partido">{v.texto}</div>
                {v.nota && <div className={`nota-estado ${v.nota === 'Sin actualizar' ? '' : 'apagada'}`}>{v.nota}</div>}
              </>
            )}
            {d.estado === 'programado' && (
              <>
                <div className="fecha-programada">{d.programadoPara ? horaPanama(d.programadoPara) : '—'}</div>
                {retrasado && <div className="nota-estado apagada">Pendiente de comenzar</div>}
              </>
            )}
          </div>
          <Lado equipo={d.visita} ligaId={ligaId} ids={idsEquipos} />
        </div>

        {d.faltasEquipo === 'no-disponible' && <div className="nota-estado apagada" data-alcance="no-disponible">Faltas de equipo no disponibles</div>}
        {d.faltasEquipo !== 'oculto' && d.faltasEquipo !== 'no-disponible' && (
          <div className="faltas-partido" data-alcance={d.faltasEquipo}>
            <div className="lado"><b>{d.faltasEquipo === 'periodo' ? d.local.faltasPeriodo : d.local.faltas}</b><span>{d.local.nombre}</span></div>
            <div className="titulo">{d.faltasEquipo === 'periodo' ? 'Faltas del período' : 'Faltas del partido'}</div>
            <div className="lado"><span>{d.visita.nombre}</span><b>{d.faltasEquipo === 'periodo' ? d.visita.faltasPeriodo : d.visita.faltas}</b></div>
          </div>
        )}

        <div className="pie">
          <div>
            {textoSede(d) && <div>{textoSede(d)}</div>}
            {cuando && <div style={{ opacity: 0.75 }}>{fechaCortaPanama(cuando)}{d.programadoPara ? ` · ${horaPanama(d.programadoPara)}` : ''}</div>}
            {f.sinActualizar && <div className="desfase" role="status">Sin actualizar{ultimoDato ? ` · último dato confirmado a las ${ultimoDato}` : ''}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="codigo">semabel.com</div>
          </div>
        </div>

        <div className="btn-fila" style={{ marginTop: 12 }}>
          <button className="btn fantasma" onClick={pantallaCompleta}>
            {completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
          </button>
          {/* La dirección es la canónica de ESTE partido (la misma a la que ya se corrige la barra de direcciones), sobre el origen actual. */}
          <CompartirPartido
            ruta={enlacesDePartidos(estadoLiga.datos).get(gameId)}
            partido={{ liga: d.liga.nombre, local: d.local.nombre, visita: d.visita.nombre, estado: d.estado, programadoPara: d.programadoPara, inicioReal: d.inicioReal, sede: d.sede, puntosLocal: d.local.puntos, puntosVisita: d.visita.puntos }}
          />
        </div>
      </div>
    </div>
  )
}

function Lado({ equipo, ligaId, ids }) {
  return (
    <div className="equipo">
      <div className="barra neutra" />
      {ID_PUBLICO.test(equipo.id)
        ? <Link className="corto nombre-equipo" to={urlEquipoPublico(ligaId, equipo.id, ids)}>{equipo.nombre}</Link>
        : <div className="corto nombre-equipo">{equipo.nombre}</div>}
      <div className="puntos" aria-label={`Puntos de ${equipo.nombre}`}>{equipo.puntos}</div>
    </div>
  )
}
