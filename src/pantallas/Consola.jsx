import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { pausarMantenimiento } from '../seed'
import { usePartido, useCuenta, useSesion } from '../datos'
import { esDuenoDe } from '../lib/sesion'
import {
  PUNTOS_POR_DEPORTE, LIMITE_FALTAS,
  anotar, marcarFalta, deshacer, rehacer, anularEvento,
  marcadorEquipo, faltasEquipo, puntosJugador, faltasJugador,
  periodoActual, hayQueRehacer,
} from '../lib/marcador'
import {
  PERIODOS, restanteMs, mmss, corriendo, nombrePeriodo,
  arrancarReloj, detenerReloj, siguientePeriodo, ajustarReloj, duracionMs,
} from '../lib/reloj'
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
  const [tic, setTic] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  // Con la consola abierta manda el árbitro: el prototipo deja de mover el reloj.
  useEffect(() => {
    pausarMantenimiento(true)
    return () => pausarMantenimiento(false)
  }, [])

  // Al llegar a cero el reloj se detiene solo y queda guardado así.
  // Depende del tic porque el cero llega por el paso del tiempo, no por un cambio en la base.
  useEffect(() => {
    if (!d) return
    if (corriendo(d.partido) && restanteMs(d.partido, d.liga) === 0) {
      detenerReloj(d.partido, d.liga)
    }
  }, [d, tic])

  if (!d || !cuenta || !sesion) return null
  const { partido, liga, local, visita, jugadores, jugadoresPorId, eventos } = d

  // Ser organizador no alcanza: hay que ser el organizador de esta liga.
  if (!esDuenoDe(sesion, liga)) return <Navigate to={`/partido/${id}`} replace />

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const periodos = PERIODOS[liga.deporte] || 2
  const periodo = Math.min(periodoActual(eventos), periodos)
  const falta = restanteMs(partido, liga)
  const anda = corriendo(partido)
  const ultimoPeriodo = periodo >= periodos
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

  // El reloj queda cargado pero detenido: arranca cuando el árbitro lo diga.
  const comenzar = async () => {
    await db.partidos.update(partido.id, {
      estado: 'vivo',
      inicio: new Date().toISOString(),
      relojEstado: 'detenido',
      relojRestante: duracionMs(liga),
      relojDesde: null,
    })
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
          <div style={{ textAlign: 'center' }}>
            <div className="periodo-etiqueta">
              {periodo}º {nombrePeriodo(liga.deporte)}
            </div>
            <div className={`reloj-consola ${anda ? 'anda' : ''}`}>{mmss(falta)}</div>
          </div>
          <div>
            <div className="puntos">{gv}</div>
            <div className="corto">{visita.corto} · {faltasEquipo(eventos, visita.id)} faltas</div>
          </div>
        </div>

        {partido.estado === 'programado' && (
          <button className="btn" onClick={comenzar}>Comenzar el partido</button>
        )}

        {partido.estado === 'vivo' && (
          <div className="reloj-panel">
            <div className="fila">
              <button
                className={`btn-reloj ${anda ? 'parar' : ''}`}
                onClick={() => (anda ? detenerReloj(partido, liga) : arrancarReloj(partido, liga))}
                disabled={!anda && falta === 0}
              >
                {anda ? '❚❚  Detener' : '▶  Arrancar'}
              </button>
              <button className="ajuste" onClick={() => ajustarReloj(partido, liga, -10)}>−10s</button>
              <button className="ajuste" onClick={() => ajustarReloj(partido, liga, 10)}>+10s</button>
            </div>

            {!ultimoPeriodo && (
              <button
                className={falta === 0 ? 'btn' : 'btn fantasma'}
                onClick={() => siguientePeriodo(partido, liga, periodo)}
              >
                {falta === 0
                  ? `Empezar el ${periodo + 1}º ${nombrePeriodo(liga.deporte)}`
                  : `Terminar el ${periodo}º ${nombrePeriodo(liga.deporte)} antes de tiempo`}
              </button>
            )}

            {ultimoPeriodo && falta === 0 && (
              <div className="aviso">
                Se acabó el {periodo}º {nombrePeriodo(liga.deporte)}. Cierra el partido cuando
                el marcador esté bien.
              </div>
            )}
          </div>
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
