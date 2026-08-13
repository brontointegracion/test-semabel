import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDescubrir } from '../datos'
import { marcadorEquipo } from '../lib/marcador'
import { Marca, Escudo, Vacio, diaRelativo, hora, transcurrido, fechaCorta, mismoDia } from '../ui'

const PAISES = { PA: 'Panamá', CO: 'Colombia' }

const DEPORTES = [
  ['todos', 'Todos'],
  ['baloncesto', 'Baloncesto'],
  ['futsal', 'Fútbol sala'],
]

export default function Inicio() {
  const d = useDescubrir()
  const [deporte, setDeporte] = useState('todos')
  const [cuando, setCuando] = useState('ahora')
  const [pais, setPais] = useState('todos')
  const [provincia, setProvincia] = useState('todas')

  const paises = useMemo(
    () => [...new Set((d?.ligas || []).map((l) => l.pais))].sort(),
    [d],
  )

  const provincias = useMemo(() => {
    if (pais === 'todos') return []
    return [...new Set((d?.ligas || []).filter((l) => l.pais === pais).map((l) => l.provincia))].sort()
  }, [d, pais])

  if (!d) return null

  const { ligas, ligasPorId, equipos, canchas, vivos, proximos, eventosPorPartido, totales } = d

  const pasaLiga = (liga) => {
    if (!liga) return false
    if (deporte !== 'todos' && liga.deporte !== deporte) return false
    if (pais !== 'todos' && liga.pais !== pais) return false
    if (provincia !== 'todas' && liga.provincia !== provincia) return false
    return true
  }

  const pasa = (p) => pasaLiga(ligasPorId[p.ligaId])

  const vivosF = vivos.filter(pasa)
  const proximosF = proximos.filter(pasa).slice(0, 20)
  const ligasF = ligas.filter(pasaLiga)

  const cambiarPais = (v) => { setPais(v); setProvincia('todas') }

  return (
    <>
      <Marca />

      <div className="hero">
        <h1>El barrio también tiene <em>estadísticas</em>.</h1>
        <p>
          Ligas de calle, canchas de tierra y torneos que nadie anotaba. Aquí se arma el
          calendario, se lleva el marcador desde el teléfono y todo se comparte con un link.
          Sin instalar nada, sin cuenta para mirar.
        </p>
        <div className="cifras">
          <div className="cifra">
            <div className="n">{totales.ligas}</div>
            <div className="q">Ligas</div>
          </div>
          <div className="cifra">
            <div className="n">{totales.jugados}</div>
            <div className="q">Partidos anotados</div>
          </div>
          <div className="cifra">
            <div className="n">{totales.canchas}</div>
            <div className="q">Canchas</div>
          </div>
        </div>
      </div>

      <div className="banner">
        <div className="marca-patro">TU<br />LOGO</div>
        <div className="texto">
          <span className="etiqueta">Espacio patrocinado</span>
          <strong>Un aviso pequeño, del negocio de la esquina.</strong>
          Nunca sobre el marcador ni encima del partido.
        </div>
      </div>

      <div className="filtros">
        <div className="carrete">
          <button className={`chip ${pais === 'todos' ? 'on' : ''}`} onClick={() => cambiarPais('todos')}>
            Todo el mundo
          </button>
          {paises.map((p) => (
            <button key={p} className={`chip ${pais === p ? 'on' : ''}`} onClick={() => cambiarPais(p)}>
              {PAISES[p] || p}
            </button>
          ))}
        </div>

        {provincias.length > 1 && (
          <div className="carrete">
            <button className={`chip ${provincia === 'todas' ? 'on' : ''}`} onClick={() => setProvincia('todas')}>
              Todas
            </button>
            {provincias.map((p) => (
              <button key={p} className={`chip ${provincia === p ? 'on' : ''}`} onClick={() => setProvincia(p)}>
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="segmento">
          {DEPORTES.map(([k, etiqueta]) => (
            <button key={k} className={deporte === k ? 'on' : ''} onClick={() => setDeporte(k)}>
              {etiqueta}
            </button>
          ))}
        </div>

        <div className="segmento">
          <button className={cuando === 'ahora' ? 'on' : ''} onClick={() => setCuando('ahora')}>
            Ahora mismo{vivosF.length ? ` (${vivosF.length})` : ''}
          </button>
          <button className={cuando === 'viene' ? 'on' : ''} onClick={() => setCuando('viene')}>
            Lo que viene
          </button>
        </div>
      </div>

      {cuando === 'ahora' ? (
        <Ahora partidos={vivosF} equipos={equipos} canchas={canchas} ligas={ligasPorId} eventos={eventosPorPartido} />
      ) : (
        <Viene partidos={proximosF} equipos={equipos} canchas={canchas} ligas={ligasPorId} />
      )}

      <h2 className="seccion">Ligas en esta zona</h2>
      <div className="lista">
        {ligasF.map((l) => (
          <Link key={l.id} to={`/liga/${l.id}`} className="card">
            <div className="fila-liga">
              <div className="info">
                <div className="nombre">{l.nombre}</div>
                <div className="sub" style={{ marginTop: 2 }}>
                  {l.provincia}, {PAISES[l.pais] || l.pais} · organiza {l.organizador}
                </div>
              </div>
            </div>
          </Link>
        ))}
        {!ligasF.length && <Vacio>Todavía no hay ligas con ese filtro.</Vacio>}
      </div>
    </>
  )
}

function Ahora({ partidos, equipos, canchas, ligas, eventos }) {
  if (!partidos.length) {
    return <Vacio>No hay partidos jugándose en este momento. Prueba «Lo que viene».</Vacio>
  }

  return (
    <div className="lista" style={{ marginTop: 14 }}>
      {partidos.map((p) => {
        const evs = eventos[p.id] || []
        return (
          <Link key={p.id} to={`/partido/${p.id}`} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="pill vivo"><i className="punto" />EN VIVO</span>
              <span className="sub">{transcurrido(p.inicio)}</span>
              <span className="sub" style={{ marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ligas[p.ligaId]?.nombre}
              </span>
            </div>
            {[equipos[p.localId], equipos[p.visitaId]].map((eq) => (
              <div key={eq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <Escudo equipo={eq} size="sm" />
                <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {eq.nombre}
                </span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {marcadorEquipo(evs, eq.id)}
                </span>
              </div>
            ))}
            <div className="sub" style={{ marginTop: 10 }}>{canchas[p.canchaId]?.nombre}</div>
          </Link>
        )
      })}
    </div>
  )
}

function Viene({ partidos, equipos, canchas, ligas }) {
  if (!partidos.length) return <Vacio>No hay partidos programados con ese filtro.</Vacio>

  let ultimo = null
  return (
    <div style={{ marginTop: 6 }}>
      {partidos.map((p) => {
        const nuevo = !ultimo || !mismoDia(ultimo, p.inicio)
        ultimo = p.inicio
        return (
          <div key={p.id}>
            {nuevo && <div className="dia-sep">{diaRelativo(p.inicio)} · {fechaCorta(p.inicio)}</div>}
            <Link to={`/partido/${p.id}`} className="partido" style={{ marginBottom: 8 }}>
              <div className="cuando">
                <div className="hora">{hora(p.inicio)}</div>
                <div className="dia">{canchas[p.canchaId]?.barrio}</div>
              </div>
              <div className="enfrenta">
                <div className="lado">
                  <Escudo equipo={equipos[p.localId]} size="sm" />
                  <span className="nombre">{equipos[p.localId]?.nombre}</span>
                </div>
                <div className="lado">
                  <Escudo equipo={equipos[p.visitaId]} size="sm" />
                  <span className="nombre">{equipos[p.visitaId]?.nombre}</span>
                </div>
              </div>
            </Link>
          </div>
        )
      })}
    </div>
  )
}
