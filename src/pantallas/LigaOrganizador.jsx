import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useRecurso } from '../lib/publico/hooks.js'
import { fechaCortaPanama, horaPanama, textoSede } from '../lib/publico/formato.js'
import { recursoLiga } from '../lib/publico/recursos.js'
import { leerLiga } from '../lib/roster-api'
import { enlacesDePartidos } from '../lib/publico/urls.js'
import { RUTA_PANEL, rutaEquipo, rutaPartido } from '../lib/rutas-organizador'
import { useSesionServidor } from '../lib/sesion-servidor'
import { EnlaceVolver, ErrorDeLectura, Protegida, useLectura } from './ComunOrganizador'
import PendienteSinConfirmar from './PendienteSinConfirmar'
import { ESTADO_TEXTO } from './PartidoOrganizador'

// Equipos de una liga, del servidor. Un equipo con partido en curso (o en pausa) se marca: su plantilla no se puede cambiar.

const instante = (p) => (p.programadoPara === null ? Infinity : Date.parse(p.programadoPara))

const ordenar = (lista) => [...lista].sort((a, b) => (instante(a) === instante(b) ? (a.gameId < b.gameId ? -1 : 1) : instante(a) < instante(b) ? -1 : 1))

// Una tarjeta de partido. El partido terminado muestra la insignia «Finalizado» en lugar del texto de estado.
function FilaPartido({ p, ligaId, nombres, enlaces }) {
  const local = nombres.get(p.local.id) ?? p.local.id
  const visita = nombres.get(p.visita.id) ?? p.visita.id
  const final = p.estado === 'final'
  return (
    <li className="fila-panel">
      <strong className="nombre-contexto">{local} — {visita}</strong>
      <div className="sub">
        {p.programadoPara ? `${fechaCortaPanama(p.programadoPara)}, ${horaPanama(p.programadoPara)}` : 'Fecha por confirmar'}
        {final ? ' · ' : ` · ${ESTADO_TEXTO[p.estado]}`}
        {final && <span className="insignia-finalizado">Finalizado</span>}
        {textoSede(p) ? ` · ${textoSede(p)}` : ''}
        {p.estado !== 'programado' ? ` · ${p.local.puntos}–${p.visita.puntos}` : ''}
      </div>
      <div className="acciones-fila">
        <Link className="btn" to={rutaPartido(ligaId, p.gameId)} aria-label={`Preparar acceso de puntuación de ${local} contra ${visita}`}>Preparar acceso de puntuación</Link>
        {enlaces.get(p.gameId) && <Link className="btn fantasma" to={enlaces.get(p.gameId)} aria-label={`Ver marcador público de ${local} contra ${visita}`}>Ver marcador público</Link>}
      </div>
    </li>
  )
}

// Partidos de la liga (lectura pública del servidor, solo lectura): por hora programada, los sin hora al final. Programados y en curso primero;
// los terminados van agrupados y plegados debajo. Cada uno lleva a su acceso de puntuación.
function Partidos({ ligaId }) {
  const def = useMemo(() => recursoLiga(ligaId), [ligaId])
  const { datos, fase } = useRecurso(def)
  const nombres = new Map((datos?.equipos ?? []).map((e) => [e.id, e.nombre]))
  const enlaces = datos ? enlacesDePartidos(datos) : new Map()
  const lista = ordenar(datos?.partidos ?? [])
  const abiertos = lista.filter((p) => p.estado !== 'final')
  const finalizados = lista.filter((p) => p.estado === 'final')
  const fila = (p) => <FilaPartido key={p.gameId} p={p} ligaId={ligaId} nombres={nombres} enlaces={enlaces} />
  return (
    <>
      <h2>Partidos</h2>
      {!datos && <p className="sub" role="status">{fase === 'cargando' ? 'Cargando…' : 'No pudimos cargar los partidos. Se reintenta solo.'}</p>}
      {datos && lista.length === 0 && <p className="nota-vacia">Esta liga todavía no tiene partidos.</p>}
      {datos && abiertos.length > 0 && <ul className="lista-panel" aria-label="Partidos">{abiertos.map(fila)}</ul>}
      {datos && lista.length > 0 && abiertos.length === 0 && <p className="nota-vacia">No hay partidos programados ni en curso. Todos los partidos de esta liga están finalizados.</p>}
      {datos && finalizados.length > 0 && (
        <details className="finalizados">
          <summary>Finalizados ({finalizados.length})</summary>
          <ul className="lista-panel" aria-label="Partidos finalizados">{finalizados.map(fila)}</ul>
        </details>
      )}
    </>
  )
}

function Contenido({ ligaId }) {
  const { datos: sesion } = useSesionServidor()
  const [lectura, recargar] = useLectura(() => leerLiga(ligaId), [ligaId])
  if (!sesion.ligas.includes(ligaId)) {
    return <main className="panel"><p className="aviso-panel" role="alert">No tienes acceso a esa liga.</p><EnlaceVolver to={RUTA_PANEL}>Mis ligas</EnlaceVolver></main>
  }
  const ok = lectura.res?.tipo === 'ok' ? lectura.res.datos : null
  return (
    <main className="panel">
      <p className="nav-panel"><EnlaceVolver to={RUTA_PANEL}>Mis ligas</EnlaceVolver></p>
      <h1>{ok ? ok.liga.nombre : ligaId}</h1>
      {ok && <p className="sub">{ok.liga.deporte}</p>}
      <PendienteSinConfirmar organizadorId={sesion.organizadorId} ligaId={ligaId} nombresLigas={ok ? { [ligaId]: ok.liga.nombre } : {}} onCambio={recargar} />
      {lectura.res && lectura.res.tipo !== 'ok' && <ErrorDeLectura res={lectura.res} onReintentar={recargar} />}
      {!ok && lectura.cargando && <p className="sub" role="status">Cargando…</p>}
      {ok && (
        <>
          <h2>Equipos</h2>
          <ul className="lista-panel" aria-label="Equipos">
            {ok.equipos.map((e) => (
              <li key={e.id} className="fila-panel">
                <strong className="nombre-contexto">{e.nombre}</strong>
                <div className="sub">
                  {e.activos} activos · {e.inactivos} inactivos{e.bloqueada ? ' · Partido en curso: plantilla bloqueada' : ''}
                </div>
                <div className="acciones-fila">
                  <Link className="btn" to={rutaEquipo(ligaId, e.id)} aria-label={`Gestionar jugadores de ${e.nombre}`}>Gestionar jugadores</Link>
                </div>
              </li>
            ))}
          </ul>
          {ok.equipos.length === 0 && <p className="nota-vacia">Esta liga todavía no tiene equipos.</p>}
          <Partidos key={ligaId} ligaId={ligaId} />
        </>
      )}
    </main>
  )
}

export default function LigaOrganizador() {
  const { ligaId } = useParams()
  return <Protegida><Contenido key={ligaId} ligaId={ligaId} /></Protegida>
}
