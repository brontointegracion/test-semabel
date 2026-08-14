import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { usePartido, useCuenta, useSesion } from '../datos'
import { esDuenoDe } from '../lib/sesion'
import {
  PUNTOS_POR_DEPORTE, LIMITE_FALTAS,
  anotar, marcarFalta, deshacer, rehacer, anularEvento,
  marcadorEquipo, faltasEquipo, puntosJugador, faltasJugador,
  periodoActual, hayQueRehacer,
} from '../lib/marcador'
import { Topbar, Escudo } from '../ui'

/**
 * La consola del árbitro. Se usa de pie, con una mano, mientras el partido sigue.
 * Por eso deshacer es un botón siempre visible y no una opción escondida.
 */
export default function Consola() {
  const { id } = useParams()
  const nav = useNavigate()
  const d = usePartido(id)
  const cuenta = useCuenta()
  const sesion = useSesion()
  const [ladoActivo, setLadoActivo] = useState('local')
  const [ultimoToque, setUltimoToque] = useState(null)

  if (!d || !cuenta || !sesion) return null
  const { partido, liga, local, visita, jugadores, jugadoresPorId, eventos } = d

  // Ser organizador no alcanza: hay que ser el organizador de esta liga.
  if (!esDuenoDe(sesion, liga)) return <Navigate to={`/partido/${id}`} replace />

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const periodos = liga.deporte === 'baloncesto' ? 4 : 2
  const periodo = Math.min(periodoActual(eventos), periodos)
  const valores = PUNTOS_POR_DEPORTE[liga.deporte] || [1]
  const limite = LIMITE_FALTAS[liga.deporte] || 5

  const equipo = ladoActivo === 'local' ? local : visita
  const plantel = jugadores
    .filter((j) => j.equipoId === equipo.id)
    .sort((a, b) => a.dorsal - b.dorsal)

  const avisar = (texto) => {
    setUltimoToque(texto)
    navigator.vibrate?.(12)
    setTimeout(() => setUltimoToque(null), 1200)
  }

  const puntear = async (jugador, puntos) => {
    await anotar({ partidoId: partido.id, equipoId: equipo.id, jugadorId: jugador.id, puntos, periodo })
    avisar(`${jugador.nombre} +${puntos}`)
  }

  const faltar = async (jugador) => {
    await marcarFalta({ partidoId: partido.id, equipoId: equipo.id, jugadorId: jugador.id, periodo })
    const total = faltasJugador(eventos, jugador.id) + 1
    avisar(total >= limite ? `${jugador.nombre}: ${total}ª falta, queda fuera` : `Falta de ${jugador.nombre} (${total})`)
  }

  const comenzar = async () => {
    await db.partidos.update(partido.id, { estado: 'vivo', inicio: new Date().toISOString() })
  }

  const finalizar = async () => {
    const ok = confirm(
      `Al cerrar el partido se descuenta 1 partido de tu saldo (te quedan ${cuenta.saldo}).\n\n` +
      'Después del cierre solo el organizador puede corregir, y la corrección queda a la vista.',
    )
    if (!ok) return
    await db.partidos.update(partido.id, { estado: 'final' })
    await db.cuenta.update('yo', { saldo: Math.max(0, cuenta.saldo - 1) })
    nav(`/partido/${partido.id}`, { replace: true })
  }

  const recientes = eventos
    .filter((e) => e.tipo === 'punto' || e.tipo === 'falta')
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 10)

  return (
    <>
      <Topbar titulo="Consola del árbitro" />

      <div className="consola" style={{ marginTop: 14 }}>
        <div className="cabecera">
          <div>
            <div className="puntos">{gl}</div>
            <div className="corto">{local.corto} · {faltasEquipo(eventos, local.id)} faltas</div>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--ink-mute)' }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.1em' }}>
              {liga.deporte === 'baloncesto' ? `${periodo}º CUARTO` : `${periodo}º TIEMPO`}
            </div>
            {partido.estado === 'vivo' && (
              <span className="pill vivo" style={{ marginTop: 6 }}><i className="punto" />VIVO</span>
            )}
          </div>
          <div>
            <div className="puntos">{gv}</div>
            <div className="corto">{visita.corto} · {faltasEquipo(eventos, visita.id)} faltas</div>
          </div>
        </div>

        {partido.estado === 'programado' && (
          <button className="btn" onClick={comenzar}>Comenzar el partido</button>
        )}

        <div className="selector">
          {[['local', local], ['visita', visita]].map(([k, eq]) => (
            <button
              key={k}
              className={ladoActivo === k ? 'activo' : ''}
              style={ladoActivo === k ? { background: eq.color } : undefined}
              onClick={() => setLadoActivo(k)}
            >
              <Escudo equipo={eq} size="sm" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{eq.nombre}</span>
            </button>
          ))}
        </div>

        <div className="plantel">
          {plantel.map((j) => {
            const faltas = faltasJugador(eventos, j.id)
            const fuera = faltas >= limite
            return (
              <div key={j.id} className={`jugador-fila ${fuera ? 'expulsado' : ''}`}>
                <div className="dorsal">{j.dorsal}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nombre">{j.nombre}</div>
                  <div className="suma">
                    {puntosJugador(eventos, j.id)} pts
                    {faltas > 0 && <> · <b>{faltas} {faltas === 1 ? 'falta' : 'faltas'}</b></>}
                    {fuera && ' · fuera'}
                  </div>
                </div>
                <div className="anota">
                  {valores.map((v) => (
                    <button key={v} onClick={() => puntear(j, v)} aria-label={`${j.nombre} más ${v}`}>
                      +{v}
                    </button>
                  ))}
                  <button className="falta" onClick={() => faltar(j)} aria-label={`Falta de ${j.nombre}`}>
                    F
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="barra-deshacer">
          <button className="btn sutil" onClick={() => deshacer(partido.id)}>↺ Deshacer</button>
          <button
            className="btn sutil"
            onClick={() => rehacer(partido.id)}
            disabled={!hayQueRehacer(eventos)}
          >
            ↻ Rehacer
          </button>
        </div>

        {ultimoToque && <div className="aviso">{ultimoToque}</div>}

        <div>
          <h2 className="seccion" style={{ marginTop: 4 }}>Últimas acciones</h2>
          <div className="registro">
            {recientes.map((e) => (
              <div key={e.id} className={`ev ${e.anulado ? 'anulado' : ''}`}>
                <span className={`mas ${e.tipo === 'falta' ? 'falta' : ''}`}>
                  {e.tipo === 'falta' ? 'F' : `+${e.puntos}`}
                </span>
                <span className="quien">{jugadoresPorId[e.jugadorId]?.nombre || 'Sin jugador'}</span>
                {e.anulado ? (
                  <span className="pill">anulado</span>
                ) : (
                  <button className="pill" onClick={() => anularEvento(e.id)}>anular</button>
                )}
              </div>
            ))}
            {!recientes.length && <div className="sub">Todavía no hay acciones.</div>}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            Puntos y faltas son la misma lista de eventos, así que se corrigen igual. Nada se
            borra: lo anulado queda con su hora.
          </p>
        </div>

        {partido.estado === 'vivo' && (
          <button className="btn fantasma" onClick={finalizar}>Cerrar el partido</button>
        )}
      </div>
    </>
  )
}
