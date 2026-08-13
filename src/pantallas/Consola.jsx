import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { usePartido, useCuenta } from '../datos'
import {
  PUNTOS_POR_DEPORTE, anotar, deshacer, rehacer, anularEvento,
  marcadorEquipo, periodoActual, hayQueRehacer,
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
  const [ladoActivo, setLadoActivo] = useState('local')
  const [ultimoToque, setUltimoToque] = useState(null)

  if (!d || !cuenta) return null
  const { partido, liga, local, visita, jugadores, jugadoresPorId, eventos } = d

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const periodos = liga.deporte === 'baloncesto' ? 4 : 2
  const periodo = Math.min(periodoActual(eventos), periodos)
  const valores = PUNTOS_POR_DEPORTE[liga.deporte] || [1]

  const equipo = ladoActivo === 'local' ? local : visita
  const plantel = jugadores
    .filter((j) => j.equipoId === equipo.id)
    .sort((a, b) => a.dorsal - b.dorsal)

  const sumaDe = (jid) =>
    eventos.filter((e) => !e.anulado && e.jugadorId === jid).reduce((n, e) => n + e.puntos, 0)

  const puntear = async (jugador, puntos) => {
    await anotar({ partidoId: partido.id, equipoId: equipo.id, jugadorId: jugador.id, puntos, periodo })
    setUltimoToque(`${jugador.nombre} +${puntos}`)
    navigator.vibrate?.(12)
    setTimeout(() => setUltimoToque(null), 1200)
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

  const recientes = [...eventos]
    .filter((e) => e.tipo === 'punto')
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 8)

  return (
    <>
      <Topbar titulo="Consola del árbitro" />

      <div className="consola" style={{ marginTop: 14 }}>
        <div className="cabecera">
          <div>
            <div className="puntos">{gl}</div>
            <div className="corto">{local.corto}</div>
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
            <div className="corto">{visita.corto}</div>
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
          {plantel.map((j) => (
            <div key={j.id} className="jugador-fila">
              <div className="dorsal">{j.dorsal}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre">{j.nombre}</div>
                <div className="suma">{sumaDe(j.id)} pts</div>
              </div>
              <div className="anota">
                {valores.map((v) => (
                  <button key={v} onClick={() => puntear(j, v)} aria-label={`${j.nombre} más ${v}`}>
                    +{v}
                  </button>
                ))}
              </div>
            </div>
          ))}
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

        {ultimoToque && <div className="aviso">Anotado: {ultimoToque}</div>}

        <div>
          <h2 className="seccion" style={{ marginTop: 4 }}>Últimas acciones</h2>
          <div className="registro">
            {recientes.map((e) => (
              <div key={e.id} className={`ev ${e.anulado ? 'anulado' : ''}`}>
                <span className="mas">+{e.puntos}</span>
                <span className="quien">
                  {jugadoresPorId[e.jugadorId]?.nombre || 'Sin jugador'}
                </span>
                {e.anulado ? (
                  <span className="pill">anulado</span>
                ) : (
                  <button className="pill" onClick={() => anularEvento(e.id)}>anular</button>
                )}
              </div>
            ))}
            {!recientes.length && <div className="sub">Todavía no hay anotaciones.</div>}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            Nada se borra. Lo anulado queda registrado con su hora, y así el marcador puede
            explicarse después.
          </p>
        </div>

        {partido.estado === 'vivo' && (
          <button className="btn fantasma" onClick={finalizar}>
            Cerrar el partido
          </button>
        )}
      </div>
    </>
  )
}
