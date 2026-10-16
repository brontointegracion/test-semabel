import { Link, useParams } from 'react-router-dom'
import { leerLiga } from '../lib/roster-api'
import { useSesionServidor } from '../lib/sesion-servidor'
import { ErrorDeLectura, Protegida, useLectura } from './ComunOrganizador'
import PendienteSinConfirmar from './PendienteSinConfirmar'

// Equipos de una liga, del servidor. Un equipo con partido en curso (o en pausa) se marca: su plantilla no se puede cambiar.

function Contenido({ ligaId }) {
  const { datos: sesion } = useSesionServidor()
  const [lectura, recargar] = useLectura(() => leerLiga(ligaId), [ligaId])
  if (!sesion.ligas.includes(ligaId)) {
    return <main className="panel"><p className="aviso-panel" role="alert">No tienes acceso a esa liga.</p><Link to="/anthony/ligas">← Mis ligas</Link></main>
  }
  const ok = lectura.res?.tipo === 'ok' ? lectura.res.datos : null
  return (
    <main className="panel">
      <p className="nav-panel"><Link to="/anthony/ligas">← Mis ligas</Link></p>
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
                <Link to={`/anthony/ligas/${ligaId}/equipos/${e.id}`}>{e.nombre}</Link>
                <div className="sub">
                  {e.activos} activos · {e.inactivos} inactivos{e.bloqueada ? ' · Partido en curso: plantilla bloqueada' : ''}
                </div>
              </li>
            ))}
          </ul>
          {ok.equipos.length === 0 && <p className="nota-vacia">Esta liga todavía no tiene equipos.</p>}
        </>
      )}
    </main>
  )
}

export default function LigaOrganizador() {
  const { ligaId } = useParams()
  return <Protegida><Contenido key={ligaId} ligaId={ligaId} /></Protegida>
}
