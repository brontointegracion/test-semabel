import { etiquetaRama } from '../../lib/publico/ramas.js'
import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMono, useRecurso, useRefrescar } from '../../lib/publico/hooks.js'
import { ID_PUBLICO, ligasConfiguradas } from '../../lib/publico/config.js'
import { MOTIVOS, armarEquipo, etiquetaNombre, etiquetaNumero } from '../../lib/publico/equipo.js'
import { urlLigaPublica } from '../../lib/publico/agrupar.js'
import { enlacesDePartidos, resolverLiga } from '../../lib/publico/urls.js'
import { urlEquipoPublico } from '../../lib/publico/equipo.js'
import { PERIODO_EQUIPO_MS, recursoEquipo, recursoListaEquipos } from '../../lib/publico/recursos.js'
import { resolverEquipo } from '../../lib/publico/claves.js'
import { Cargando, NoEncontrado, PieFrescura, TopbarPublica, EnlaceInicio, textoDeError, useDireccionCanonica } from './componentes.jsx'
import { FilaFinal } from './tarjetas.jsx'

const celda = (n) => (n === null ? '—' : n)

/** Una fila de jugador: número actual y nombre completo, sin enlace (aún no hay perfiles públicos). */
function FilaJugador({ j, nota = null }) {
  return (
    <tr>
      <td>
        <span className="jugador-publico">
          <b className="num">{etiquetaNumero(j.dorsalActual)}</b>
          <span className={j.nombre === null ? 'falta-dato' : ''}>{etiquetaNombre(j.nombre)}</span>
          {nota && <span className="nota-ficha">{nota}</span>}
        </span>
      </td>
      <td>{celda(j.puntos)}</td>
      <td>{celda(j.faltas)}</td>
    </tr>
  )
}

function TablaJugadores({ filas, etiqueta, notaDe = () => null, extra = null }) {
  return (
    <div className="tabla-wrap" style={{ marginTop: 10 }}>
      <table aria-label={etiqueta}>
        <thead>
          <tr><th>Jugador</th><th>Pts</th><th>Faltas</th></tr>
        </thead>
        <tbody>
          {filas.map((j) => <FilaJugador key={j.id} j={j} nota={notaDe(j)} />)}
          {extra}
        </tbody>
      </table>
    </div>
  )
}

/** Página pública de un equipo: plantilla actual, estadísticas básicas de partidos finales y resultados. */
export default function EquipoPublico() {
  const { ligaId: parametroLiga, equipoId: parametro } = useParams()
  const config = useMemo(() => ligasConfiguradas(), [])
  const resLiga = useMemo(() => (config.ok && ID_PUBLICO.test(parametroLiga ?? '') ? resolverLiga(config.ids, parametroLiga) : { ok: false }), [config, parametroLiga])
  const valido = resLiga.ok && ID_PUBLICO.test(parametro ?? '')
  const ligaId = resLiga.ok ? resLiga.ligaId : null
  // La dirección lleva la clave del equipo DENTRO de la liga (o, por compatibilidad, su id completo): se resuelve contra la lista real
  // de equipos de la liga admitida. Una clave desconocida o ambigua no llega a pedir ningún equipo.
  const defLiga = useMemo(() => (valido ? recursoListaEquipos(ligaId) : null), [valido, ligaId])
  const estadoLiga = useRecurso(defLiga)
  const resolucion = useMemo(() => (estadoLiga.datos ? resolverEquipo(ligaId, estadoLiga.datos.equipos, parametro) : null), [estadoLiga.datos, ligaId, parametro])
  const equipoId = resolucion?.ok ? resolucion.equipoId : null
  // Dirección canónica (minúsculas): se corrige la mayúscula, el id completo o la clave antigua sin perder la búsqueda ni el origen.
  useDireccionCanonica(equipoId ? urlEquipoPublico(ligaId, equipoId, estadoLiga.datos.equipos.map((e) => e.id)) : null)
  const enlacesPartidos = useMemo(() => (estadoLiga.datos ? enlacesDePartidos(estadoLiga.datos) : new Map()), [estadoLiga.datos])
  const def = useMemo(() => (equipoId ? recursoEquipo(ligaId, equipoId) : null), [equipoId, ligaId])
  const estado = useRecurso(def)
  const refrescar = useRefrescar(def?.clave ?? null)
  const { mono, saltoMono } = useMono({ activo: valido })
  const d = estado.datos

  useEffect(() => {
    if (!d) return undefined
    const anterior = document.title
    document.title = `${d.equipo.nombre} · ${d.liga.nombre} · semabel.com`
    return () => { document.title = anterior }
  }, [d?.equipo.nombre, d?.liga.nombre]) // eslint-disable-line react-hooks/exhaustive-deps

  const v = useMemo(() => (d ? armarEquipo(d) : null), [d])
  if (!valido || estadoLiga.fase === 'no-encontrado' || estado.fase === 'no-encontrado' || resolucion?.motivo === 'desconocido') {
    return <NoEncontrado titulo="No encontramos este equipo" hacia={valido ? urlLigaPublica(ligaId) : '/'} etiqueta={valido ? 'Ver la liga' : 'Ir al inicio'} />
  }
  if (resolucion?.motivo === 'ambiguo') {
    return <NoEncontrado titulo="Este enlace de equipo no es claro" hacia={urlLigaPublica(ligaId)} etiqueta="Ver la liga" />
  }
  if (!d) {
    const espera = equipoId ? estado : estadoLiga // sin la lista de equipos todavía no hay clave que resolver
    return (
      <div className="publico">
        <TopbarPublica titulo="Equipo" hacia={urlLigaPublica(ligaId)} etiqueta="‹ Liga" accion={<EnlaceInicio />} />
        {espera.fase === 'cargando' ? <Cargando /> : <div className="aviso" role="status">{textoDeError(espera)}</div>}
      </div>
    )
  }

  return (
    <div className="publico">
      <TopbarPublica titulo={d.equipo.nombre} hacia={urlLigaPublica(ligaId)} etiqueta="‹ Liga" accion={<EnlaceInicio />} />
      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Equipo</div>
        <div className="sub" style={{ marginTop: 6 }}>{d.equipo.nombre}</div>
        {etiquetaRama(d.equipo.rama) && <div className="sub" data-rama={d.equipo.rama} style={{ marginTop: 2 }}>Rama: {etiquetaRama(d.equipo.rama)}</div>}
        <div className="eyebrow" style={{ marginTop: 12 }}>Liga</div>
        <div className="sub" style={{ marginTop: 6 }}>
          <Link to={urlLigaPublica(ligaId)}>{d.liga.nombre}</Link>
        </div>
      </div>

      <h2 className="seccion">Plantilla</h2>
      {v.plantilla.length === 0 ? (
        <div className="vacio">Todavía no hay jugadores en la plantilla.</div>
      ) : (
        <TablaJugadores
          filas={v.plantilla}
          etiqueta="Plantilla actual"
          extra={v.sinJugador && (
            <tr>
              <td><span className="jugador-publico"><span className="falta-dato">Sin jugador asignado</span></span></td>
              <td>{v.sinJugador.puntos}</td>
              <td>{v.sinJugador.faltas}</td>
            </tr>
          )}
        />
      )}
      <p className="nota-seccion">
        {v.hayFinales
          ? 'Puntos y faltas de jugador en los partidos finales de este equipo, según lo anotado por el árbitro. No incluye partidos en juego. No se muestran partidos jugados: el marcador no registra quién estuvo en cancha. El número es el actual de la ficha.'
          : 'Todavía no hay partidos finales: las estadísticas aparecerán cuando termine el primero.'}
      </p>

      {v.historicos.length > 0 && (
        <>
          <h2 className="seccion">Jugadores que ya no están en la plantilla</h2>
          <TablaJugadores filas={v.historicos} etiqueta="Jugadores históricos" notaDe={(j) => MOTIVOS[j.motivo]} />
          <p className="nota-seccion">Siguen en las estadísticas porque anotaron en partidos finales. El número mostrado es el actual de la ficha, no necesariamente el de esos partidos.</p>
        </>
      )}

      <h2 className="seccion">Resultados</h2>
      {v.resultados.length === 0
        ? <div className="vacio">Todavía no hay resultados.</div>
        : <div style={{ marginTop: 6 }}>{v.resultados.map((r) => <FilaFinal key={r.gameId} partido={{ ...r, ligaId, urlPartido: enlacesPartidos.get(r.gameId) }} />)}</div>}

      <div className="btn-fila" style={{ marginTop: 12 }}>
        <button className="btn fantasma" onClick={refrescar} disabled={estado.enVuelo}>{estado.enVuelo ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <PieFrescura estado={estado} mono={mono} periodoMs={PERIODO_EQUIPO_MS} saltoMono={saltoMono} />
    </div>
  )
}
