import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDescubrir, useRegion } from '../datos'
import { marcadorEquipo } from '../lib/marcador'
import { PAISES, cambiarPais, cambiarProvincia } from '../lib/region'
import { Marca, Escudo, Vacio, diaRelativo, hora, transcurrido, fechaCorta, mismoDia } from '../ui'

const DEPORTES = [
  ['todos', 'Todos'],
  ['baloncesto', 'Baloncesto'],
  ['futsal', 'Fútbol sala'],
]

const COMO = {
  ip: 'según tu conexión',
  'zona horaria': 'según la hora de tu teléfono',
  manual: 'lo elegiste tú',
  predeterminado: 'por defecto',
}

export default function Inicio() {
  const d = useDescubrir()
  const region = useRegion()
  const [deporte, setDeporte] = useState('todos')
  const [cuando, setCuando] = useState('ahora')
  const [abrirPaises, setAbrirPaises] = useState(false)

  const provincias = useMemo(() => {
    if (!d || !region) return []
    return [...new Set(d.ligas.filter((l) => l.pais === region.pais).map((l) => l.provincia))].sort()
  }, [d, region])

  const paisesConLigas = useMemo(
    () => [...new Set((d?.ligas || []).map((l) => l.pais))].sort(),
    [d],
  )

  if (!d || !region) return null

  const { ligas, ligasPorId, equipos, canchas, vivos, proximos, eventosPorPartido } = d
  const provincia = region.provincia || 'todas'

  // El sitio está restringido al país de quien mira: nada de otro país entra aquí.
  const delPais = ligas.filter((l) => l.pais === region.pais)

  const pasaLiga = (liga) => {
    if (!liga || liga.pais !== region.pais) return false
    if (deporte !== 'todos' && liga.deporte !== deporte) return false
    if (provincia !== 'todas' && liga.provincia !== provincia) return false
    return true
  }

  const pasa = (p) => pasaLiga(ligasPorId[p.ligaId])

  const vivosF = vivos.filter(pasa)
  const proximosF = proximos.filter(pasa).slice(0, 20)
  const ligasF = ligas.filter(pasaLiga)

  const totales = {
    ligas: delPais.length,
    canchas: new Set(delPais.flatMap((l) => l.canchaIds)).size,
    provincias: new Set(delPais.map((l) => l.provincia)).size,
  }

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
            <div className="n">{totales.provincias}</div>
            <div className="q">Provincias</div>
          </div>
          <div className="cifra">
            <div className="n">{totales.canchas}</div>
            <div className="q">Canchas</div>
          </div>
        </div>
      </div>

      <div className="region">
        <div className="region-linea">
          <span className="bandera" aria-hidden="true">◉</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pais">{PAISES[region.pais] || region.pais}</div>
            <div className="sub" style={{ fontSize: '0.74rem' }}>
              Estás viendo las ligas de tu país, {COMO[region.detectadoPor] || 'detectado'}
            </div>
          </div>
          <button className="cambiar" onClick={() => setAbrirPaises((v) => !v)}>
            {abrirPaises ? 'Cerrar' : 'Cambiar'}
          </button>
        </div>

        {abrirPaises && (
          <div className="carrete" style={{ marginTop: 10 }}>
            {paisesConLigas.map((p) => (
              <button
                key={p}
                className={`chip ${region.pais === p ? 'on' : ''}`}
                onClick={() => { cambiarPais(p); setAbrirPaises(false) }}
              >
                {PAISES[p] || p}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="banner">
        <div className="marca-patro">TU<br />LOGO</div>
        <div className="texto">
          <span className="etiqueta">Espacio patrocinado</span>
          <strong>Un aviso pequeño, del negocio de la esquina.</strong>
          Nunca sobre el marcador ni encima del partido.
        </div>
      </div>

      {!delPais.length ? (
        <Vacio>
          Todavía no hay ligas en {PAISES[region.pais] || region.pais}.<br />
          Si organizas una, puedes ser la primera.
        </Vacio>
      ) : (
        <>
          <div className="filtros">
            {provincias.length > 1 && (
              <div className="carrete">
                <button
                  className={`chip ${provincia === 'todas' ? 'on' : ''}`}
                  onClick={() => cambiarProvincia('todas')}
                >
                  Todas las provincias
                </button>
                {provincias.map((p) => (
                  <button
                    key={p}
                    className={`chip ${provincia === p ? 'on' : ''}`}
                    onClick={() => cambiarProvincia(p)}
                  >
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
            <Viene partidos={proximosF} equipos={equipos} canchas={canchas} />
          )}

          <h2 className="seccion">
            Ligas {provincia === 'todas' ? `en ${PAISES[region.pais] || region.pais}` : `en ${provincia}`}
          </h2>
          <div className="lista">
            {ligasF.map((l) => (
              <Link key={l.id} to={`/liga/${l.id}`} className="card">
                <div className="fila-liga">
                  <div className="info">
                    <div className="nombre">{l.nombre}</div>
                    <div className="sub" style={{ marginTop: 2 }}>
                      {l.provincia} · {l.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala'} ·
                      {' '}organiza {l.organizador}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {!ligasF.length && <Vacio>No hay ligas con ese filtro.</Vacio>}
          </div>
        </>
      )}
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

function Viene({ partidos, equipos, canchas }) {
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
