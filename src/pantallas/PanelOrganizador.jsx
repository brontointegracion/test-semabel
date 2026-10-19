import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { leerLiga } from '../lib/roster-api'
import { rutaLiga } from '../lib/rutas-organizador'
import { invalidar, salir, useSesionServidor } from '../lib/sesion-servidor'
import { Protegida } from './ComunOrganizador'
import PendienteSinConfirmar from './PendienteSinConfirmar'

// Ligas del organizador. El servidor solo da los identificadores en la sesión; el nombre sale de leer cada liga. Una liga
// que no se pueda leer se muestra por su identificador con un aviso: no se inventa nada.

function Contenido() {
  const { datos, ocupado } = useSesionServidor()
  const [ligas, setLigas] = useState({}) // id → { tipo, datos? }
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const lecturas = await Promise.all(datos.ligas.map(async (id) => [id, await leerLiga(id)]))
      if (!vivo) return
      if (lecturas.some(([, r]) => r.tipo === 'no-autorizado')) { invalidar(); return }
      setLigas(Object.fromEntries(lecturas))
    })()
    return () => { vivo = false }
  }, [datos.ligas.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const nombres = Object.fromEntries(Object.entries(ligas).filter(([, r]) => r.tipo === 'ok').map(([id, r]) => [id, r.datos.liga.nombre]))
  return (
    <main className="panel">
      <h1>Mis ligas</h1>
      <PendienteSinConfirmar organizadorId={datos.organizadorId} nombresLigas={nombres} />
      <ul className="lista-panel" aria-label="Ligas">
        {datos.ligas.map((id) => {
          const r = ligas[id]
          const ok = r?.tipo === 'ok' ? r.datos : null
          return (
            <li key={id} className="fila-panel">
              <strong className="nombre-contexto">{ok ? ok.liga.nombre : id}</strong>
              <div className="sub">
                {!r ? 'Cargando…' : ok ? `${ok.liga.deporte} · ${ok.equipos.length} equipos` : 'No pudimos cargar esta liga. Abre la liga para reintentar.'}
              </div>
              <div className="acciones-fila">
                <Link className="btn" to={rutaLiga(id)} aria-label={`Administrar liga ${ok ? ok.liga.nombre : id}`}>Administrar liga</Link>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="sub" role="note">
        Si hay acciones sin confirmar, cerrar sesión no las borra: se conservan en este navegador hasta que el servidor confirme un resultado.
        No están cifradas; no uses un dispositivo compartido para esto.
      </p>
      <button type="button" className="btn fantasma" onClick={salir} disabled={ocupado}>Cerrar sesión</button>
    </main>
  )
}

export default function PanelOrganizador() {
  return <Protegida><Contenido /></Protegida>
}
