import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiga, useRetosDeLiga, useSesion } from '../datos'
import { esDuenoDe } from '../lib/sesion'
import { tablaPosiciones, estadisticaJugadores, marcadorEquipo } from '../lib/marcador'
import { Topbar, Escudo, Vacio, fechaCorta, hora, mismoDia } from '../ui'
import { codigoDe, urlLiga, urlPartido, urlJugador, urlEquipo, urlReto } from '../lib/enlaces'
import { useMeta } from '../lib/meta'

const PESTANAS = [
  ['tabla', 'Posiciones'],
  ['calendario', 'Calendario'],
  ['jugadores', 'Jugadores'],
]

export default function Liga() {
  const { slug } = useParams()
  const d = useLiga(codigoDe(slug))
  const retos = useRetosDeLiga(d?.liga?.id)
  const sesion = useSesion()
  const [pestana, setPestana] = useState('tabla')
  const [copiado, setCopiado] = useState(false)

  useMeta({
    titulo: d && `${d.liga.nombre}: tabla, calendario y goleadores`,
    descripcion: d && (
      `Posiciones, calendario y estadísticas de ${d.liga.nombre}. ` +
      `${d.equipos.length} equipos de ${d.liga.deporte === 'baloncesto' ? 'baloncesto' : 'fútbol sala'} ` +
      `en ${d.liga.provincia}. Marcador en vivo y resultados de cada jornada.`
    ),
  })

  if (!d) return null
  const { liga, equipos, jugadores, partidos, equiposPorId, canchasPorId, eventosPorPartido } = d

  const compartir = async () => {
    const url = `${location.origin}${urlLiga(liga)}`
    try {
      if (navigator.share) await navigator.share({ title: liga.nombre, url })
      else await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch { /* el usuario canceló */ }
  }

  return (
    <>
      <Topbar titulo={liga.nombre} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Página pública de la liga</div>
        <div className="sub" style={{ marginTop: 6 }}>
          {liga.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala'} ·{' '}
          {liga.canchaIds.map((c) => canchasPorId[c]?.nombre).filter(Boolean).join(' y ')}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {liga.categoria && liga.categoria !== 'Libre' && (
            <span className="pill acento">Categoría {liga.categoria}</span>
          )}
          {liga.internacional && <span className="pill acento">Internacional</span>}
          {liga.esTorneo && <span className="pill">Torneo</span>}
        </div>
        <div className="btn-fila" style={{ marginTop: 12 }}>
          <button className="btn" onClick={compartir}>
            {copiado ? 'Link copiado' : 'Compartir link'}
          </button>
          {esDuenoDe(sesion, liga) && liga.aceptaRetos && !liga.esTorneo && (
            <Link className="btn fantasma" to={`${urlLiga(liga)}/retar`}>Retar a otra liga</Link>
          )}
        </div>
        <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
          Quien abra el link ve la tabla, el calendario y el marcador en vivo. No necesita cuenta
          ni instalar nada.
        </p>
      </div>

      {retos.map((r) => {
        const ahora = Date.now()
        const abre = new Date(r.desde).getTime()
        const cierra = new Date(r.hasta).getTime()
        const estado = ahora < abre ? 'porEmpezar' : ahora > cierra ? 'terminado' : 'enCurso'
        const dias = Math.max(0, Math.ceil((abre - ahora) / 86400000))
        // Nadie acordó nada: una liga lo mandó y la otra lo recibió.
        const loMande = r.ligaAId === liga.id

        return (
          <Link key={r.id} to={urlReto(r)} className="card destacado-link">
            <div className="fila-liga">
              <div className="info">
                <div className="eyebrow">
                  {estado === 'porEmpezar'
                    ? (loMande ? 'Reto enviado' : 'Reto recibido')
                    : estado === 'enCurso' ? 'Reto en curso' : 'Reto terminado'}
                </div>
                <div className="nombre" style={{ marginTop: 3 }}>{r.nombre}</div>
                <div className="sub" style={{ marginTop: 2 }}>
                  {estado === 'porEmpezar'
                    ? `Arranca el ${fechaCorta(r.desde)}, en ${dias} día${dias === 1 ? '' : 's'}`
                    : estado === 'enCurso'
                      ? `Termina el ${fechaCorta(r.hasta)}`
                      : `Se jugó del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`}
                </div>
              </div>
              <span className="chev">→</span>
            </div>
          </Link>
        )
      })}

      <div className="selector" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 16 }}>
        {PESTANAS.map(([k, etiqueta]) => (
          <button
            key={k}
            className={pestana === k ? 'activo' : ''}
            style={pestana === k ? { background: 'var(--accent)' } : undefined}
            onClick={() => setPestana(k)}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'tabla' && (
        <Tabla liga={liga} equipos={equipos} partidos={partidos} eventosPorPartido={eventosPorPartido} />
      )}

      {pestana === 'calendario' && (
        <Calendario
          partidos={partidos}
          equiposPorId={equiposPorId}
          canchasPorId={canchasPorId}
          eventosPorPartido={eventosPorPartido}
        />
      )}

      {pestana === 'jugadores' && (
        <Jugadores
          jugadores={jugadores}
          equiposPorId={equiposPorId}
          partidos={partidos}
          eventosPorPartido={eventosPorPartido}
        />
      )}
    </>
  )
}

function Tabla({ liga, equipos, partidos, eventosPorPartido }) {
  const filas = tablaPosiciones({ equipos, partidos, eventosPorPartido, deporte: liga.deporte })
  const jugados = partidos.filter((p) => p.estado === 'final').length

  if (!jugados) return <Vacio>Todavía no se ha jugado ningún partido.</Vacio>

  return (
    <>
      <div className="tabla-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Equipo</th>
              <th>JJ</th>
              <th>G</th>
              <th>P</th>
              <th>{liga.deporte === 'baloncesto' ? 'PF' : 'GF'}</th>
              <th>Fal</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.equipo.id}>
                <td>
                  <Link to={urlEquipo(f.equipo)} className="equipo-celda">
                    <span className="pos">{i + 1}</span>
                    <Escudo equipo={f.equipo} size="sm" />
                    <span className="nombre">{f.equipo.nombre}</span>
                  </Link>
                </td>
                <td>{f.jj}</td>
                <td>{f.jg}</td>
                <td>{f.jp}</td>
                <td>{f.pf}</td>
                <td>{f.faltas}</td>
                <td className="pts">{f.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 10 }}>
        La tabla sale de los eventos de cada partido, no de un marcador escrito a mano.
      </p>
    </>
  )
}

function Calendario({ partidos, equiposPorId, canchasPorId, eventosPorPartido }) {
  let ultimoDia = null

  return (
    <div style={{ marginTop: 8 }}>
      {partidos.map((p) => {
        const nuevoDia = !ultimoDia || !mismoDia(ultimoDia, p.inicio)
        ultimoDia = p.inicio
        const evs = eventosPorPartido[p.id] || []
        const gl = marcadorEquipo(evs, p.localId)
        const gv = marcadorEquipo(evs, p.visitaId)
        const jugado = p.estado === 'final'

        return (
          <div key={p.id}>
            {nuevoDia && <div className="dia-sep">{fechaCorta(p.inicio)}</div>}
            <Link to={urlPartido(p, equiposPorId[p.localId], equiposPorId[p.visitaId])} className="partido" style={{ marginBottom: 8 }}>
              <div className="cuando">
                {p.estado === 'vivo' ? (
                  <span className="pill vivo" style={{ fontSize: '0.58rem' }}>VIVO</span>
                ) : (
                  <>
                    <div className="dia">{canchasPorId[p.canchaId]?.barrio || 'Cancha'}</div>
                    <div className="hora">{hora(p.inicio)}</div>
                  </>
                )}
              </div>
              <div className="enfrenta">
                <div className={`lado ${jugado && gl < gv ? 'perdio' : ''}`}>
                  <Escudo equipo={equiposPorId[p.localId]} size="sm" />
                  <span className="nombre">{equiposPorId[p.localId]?.nombre}</span>
                  {(jugado || p.estado === 'vivo') && <span className="goles">{gl}</span>}
                </div>
                <div className={`lado ${jugado && gv < gl ? 'perdio' : ''}`}>
                  <Escudo equipo={equiposPorId[p.visitaId]} size="sm" />
                  <span className="nombre">{equiposPorId[p.visitaId]?.nombre}</span>
                  {(jugado || p.estado === 'vivo') && <span className="goles">{gv}</span>}
                </div>
              </div>
            </Link>
          </div>
        )
      })}
    </div>
  )
}

function Jugadores({ jugadores, equiposPorId, partidos, eventosPorPartido }) {
  const stats = estadisticaJugadores({ jugadores, partidos, eventosPorPartido })
    .filter((s) => s.partidos > 0)

  if (!stats.length) return <Vacio>Las estadísticas aparecen cuando se juegue el primer partido.</Vacio>

  return (
    <>
      <h2 className="seccion">Máximos anotadores</h2>
      <div className="lista">
        {stats.slice(0, 15).map((s, i) => (
          <Link key={s.jugador.id} to={urlJugador(s.jugador)} className="jugador-fila">
            <span className="pos" style={{ paddingLeft: 4 }}>{i + 1}</span>
            <Escudo equipo={equiposPorId[s.jugador.equipoId]} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nombre" style={{ fontWeight: 600 }}>{s.jugador.nombre}</div>
              <div className="sub" style={{ fontSize: '0.75rem' }}>
                #{s.jugador.dorsal} · {equiposPorId[s.jugador.equipoId]?.nombre}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {s.promedio.toFixed(1)}
              </div>
              <div className="sub" style={{ fontSize: '0.68rem' }}>por juego</div>
            </div>
          </Link>
        ))}
      </div>

      <h2 className="seccion">Más faltas</h2>
      <div className="lista">
        {[...stats].sort((a, b) => b.faltas - a.faltas).slice(0, 8).map((s, i) => (
          <Link key={s.jugador.id} to={urlJugador(s.jugador)} className="jugador-fila">
            <span className="pos" style={{ paddingLeft: 4 }}>{i + 1}</span>
            <Escudo equipo={equiposPorId[s.jugador.equipoId]} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nombre" style={{ fontWeight: 600 }}>{s.jugador.nombre}</div>
              <div className="sub" style={{ fontSize: '0.75rem' }}>
                {equiposPorId[s.jugador.equipoId]?.nombre} · {s.faltasPorJuego.toFixed(1)} por juego
              </div>
            </div>
            <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--acento-ink)' }}>
              {s.faltas}
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
