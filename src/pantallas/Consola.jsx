import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useSesion } from '../datos'
import { esDuenoDe } from '../lib/sesion'
import { compararPorDorsal, textoDorsal } from '../lib/dorsal'
import { activoDe, nombreVisible } from '../lib/identidad'
import {
  PUNTOS_POR_DEPORTE, LIMITE_FALTAS,
  anotar, marcarFalta, deshacer, rehacer, anularEvento,
  marcadorEquipo, faltasEquipo, puntosJugador, faltasJugador,
  periodoVisible, marcaDePeriodo, hayQueRehacer,
} from '../lib/marcador'
import {
  PERIODOS, restanteMs, mmss, corriendo, nombrePeriodo,
  arrancarReloj, detenerReloj, siguientePeriodo, iniciarPartido, cerrarPartido,
  ultimoSeqAuditoria, observadoDe,
} from '../lib/reloj'
import { Topbar, Escudo } from '../ui'
import { reenviar } from '../lib/volver'
import {
  BarraDeshacer, BotonesPuntos, CabeceraConsola, FilaJugadorConsola, PANELES, PanelReloj, PanelesBarra, RegistroConsola, SelectorLados,
} from './publico/ConsolaPiezas.jsx'
import { codigoDe, urlPartido } from '../lib/enlaces'

// Panel global de acciones (solo baloncesto): los paneles están en ConsolaPiezas. Puntos es el panel real; los otros dos son un
// PROTOTIPO para probar el diseño en el teléfono: no guardan nada.
const ACCIONES_PROTOTIPO = {
  estadisticas: [
    ['AST', 'asistencia'],
    ['RD', 'rebote defensivo'],
    ['RO', 'rebote ofensivo'],
    ['TL-', 'tiro libre fallado'],
  ],
  defensa: [
    ['ROB', 'robo'],
    ['BLQ', 'bloqueo'],
  ],
}

const TEXTO_PROTOTIPO = 'Prototipo · no guardado'

// Valores de MUESTRA, no autoritativos: solo sirven para ver cómo cambia la
// pantalla al tocar "Reiniciar". No son configuración de producto: las
// duraciones por categoría u organizador son una decisión futura.
const VALORES_MUESTRA_PROTOTIPO = { posesion: 20, cruce: 8 }

const ACCION_RELOJ = 'El comando no se aplicó.'

// Mensajes cuando una acción se rechaza. Un rechazo no guarda nada y no se reintenta solo.
const DESACTUALIZADA = 'La pantalla estaba desactualizada: el periodo cambió.'

// Sin nombres de jugadores: solo el equipo, cuántos activos sin número y qué números se repiten.
function textoPlantillaIncompleta(detalle) {
  const partes = (detalle?.equipos ?? []).flatMap((e) => {
    const quien = e.nombre || 'Un equipo'
    const lista = []
    if (e.sinNumero) lista.push(`${quien} tiene ${e.sinNumero} ${e.sinNumero === 1 ? 'jugador activo' : 'jugadores activos'} sin número`)
    if (e.duplicados?.length) {
      lista.push(`${quien} repite ${e.duplicados.length === 1 ? 'el número' : 'los números'} ${e.duplicados.join(', ')}`)
    }
    return lista
  })
  return `No se puede comenzar: ${partes.join('; ') || 'hay jugadores activos sin número válido'}. Corrige la plantilla e inténtalo de nuevo.`
}

function textoRechazo(r, { accion = 'La acción no se guardó.' } = {}) {
  switch (r.motivo ?? r.resultado) {
    case 'plantilla-incompleta':
      return textoPlantillaIncompleta(r.detalle)
    case 'equipos-invalidos':
      return 'No se puede comenzar: el partido no tiene dos equipos válidos de esta liga.'
    case 'partido-no-disponible':
      if (accion === ACCION_RELOJ) {
        if (r.estado === 'final') return `El partido ya terminó. ${accion}`
        if (r.estado === 'programado') return `El partido todavía no ha comenzado. ${accion}`
        if (r.estado === 'vivo') return `El partido ya había comenzado. ${accion}`
        return `No se encontró el partido. ${accion}`
      }
      if (r.estado === 'programado') return `El partido todavía no ha comenzado: comiénzalo para anotar. ${accion}`
      if (r.estado === 'final') return `El partido ya terminó: no se pueden anotar acciones nuevas. ${accion}`
      return `No se encontró el partido. ${accion}`
    case 'periodo-desactualizado':
      return `${DESACTUALIZADA} ${accion} Revisa el marcador y vuelve a intentarlo.`
    case 'reloj-desactualizado':
      return `La pantalla estaba desactualizada: el reloj cambió desde otra pantalla. ${accion} Revisa el reloj y vuelve a intentarlo.`
    case 'ya-corriendo':
      return `El reloj ya estaba en marcha. ${accion}`
    case 'no-corre':
      return `El reloj ya estaba detenido. ${accion}`
    case 'sin-tiempo':
      return `No queda tiempo en este periodo. ${accion}`
    case 'aun-hay-tiempo':
      return accion
    case 'ultimo-periodo':
      return 'Ya es el último periodo: no hay otro al que pasar.'
    case 'periodo-invalido':
      return 'No se puede rehacer: esa acción pertenece a otro periodo.'
    default:
      return accion
  }
}

const MENSAJE_LIMITE_DESHACER =
  'El último movimiento fue un cambio de periodo y no se puede deshacer. ' +
  'Para corregir una acción anterior usa «anular» en la lista.'

const MS_RECHAZO = 4000

const porId = (filas) => Object.fromEntries(filas.map((f) => [f.id, f]))

/**
 * La misma lectura que usePartido (datos.js), pero dentro de una transacción
 * explícita. Dexie no sirve de su caché de consultas las lecturas hechas en una
 * transacción explícita, así que cada vez que se ejecuta lee lo que hay de
 * verdad en la base: eso permite volver a leer a la fuerza (ver `lectura`)
 * después de un rechazo por pantalla desactualizada, sin depender de que otra
 * pestaña haya avisado del cambio.
 *
 * Si usePartido cambia de forma, esta lectura debe cambiar con él.
 */
const leerPartido = (codigo) =>
  db.transaction('r', db.partidos, db.ligas, db.equipos, db.jugadores, db.eventos, db.canchas, db.auditoriaReloj, async () => {
    const partido = await db.partidos.where('codigo').equals(codigo).first()
    if (!partido) return null
    // El estado observado del reloj se lee junto con el partido, en esta misma transacción.
    const observado = observadoDe(partido, await ultimoSeqAuditoria(partido.id))
    // Sin un ligaId utilizable no hay liga, equipos ni jugadores que leer (y Dexie lanzaría).
    const ligaUtil = typeof partido.ligaId === 'string' && partido.ligaId !== ''
    const liga = ligaUtil ? await db.ligas.get(partido.ligaId) : undefined
    const [equipos, jugadores, eventos, cancha] = await Promise.all([
      ligaUtil ? db.equipos.where('ligaId').equals(partido.ligaId).toArray() : [],
      ligaUtil ? db.jugadores.where('ligaId').equals(partido.ligaId).toArray() : [],
      db.eventos.where('partidoId').equals(partido.id).toArray(),
      db.canchas.get(partido.canchaId),
    ])
    const equiposPorId = porId(equipos)
    return {
      partido,
      liga,
      cancha,
      local: equiposPorId[partido.localId],
      visita: equiposPorId[partido.visitaId],
      jugadores,
      jugadoresPorId: porId(jugadores),
      eventos: eventos.sort((a, b) => a.seq - b.seq),
      observado,
    }
  })

/**
 * La consola del árbitro. Se usa de pie, con una mano, mientras el partido sigue.
 * Por eso deshacer es un botón siempre visible y no una opción escondida.
 */
export default function Consola() {
  const { slug } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  // `lectura` sube cuando una acción se rechaza por pantalla desactualizada: la
  // consulta se vuelve a suscribir y lee la base de nuevo. El componente sigue
  // montado, así que el equipo, el panel y los relojes de prueba no cambian, y
  // mientras llega la lectura nueva se sigue mostrando la anterior.
  const [lectura, setLectura] = useState(0)
  const d = useLiveQuery(() => leerPartido(codigoDe(slug)), [slug, lectura])
  const sesion = useSesion()
  const [ladoActivo, setLadoActivo] = useState('local')
  const [ultimoToque, setUltimoToque] = useState(null)
  const [tic, setTic] = useState(0)
  // Un único panel para toda la consola: no depende del equipo ni del jugador.
  const [panel, setPanel] = useState('puntos')
  const [avisoPrototipo, setAvisoPrototipo] = useState(null)
  // Relojes de posesión y de cruce: estado local y efímero, nunca se guarda.
  const [relojPosesion, setRelojPosesion] = useState(null)
  const [relojCruce, setRelojCruce] = useState(null)
  const temporizadorPrototipo = useRef(null)
  // Rechazos de acciones: mensaje propio, separado de los toasts de éxito.
  const [rechazo, setRechazo] = useState(null)
  const temporizadorRechazo = useRef(null)
  const consolaRef = useRef(null)
  const listo = !!d && !!sesion
  // Un comando del reloj a la vez: mientras uno está en curso los botones quedan inactivos.
  const [ejecutando, setEjecutando] = useState(false)
  const enCurso = useRef(false)
  const paradaAutomatica = useRef(null)

  // La barra de abajo se ancla sin pestañas (la consola no las muestra) y la
  // barra de paneles se pega justo bajo la barra superior real: se mide en vez
  // de suponer 60px, porque su alto cambia con la fuente y el área segura.
  useEffect(() => {
    const raiz = consolaRef.current
    const barra = document.querySelector('.topbar')
    if (!raiz || !barra) return undefined
    const medir = () => {
      const alto = Math.round(barra.getBoundingClientRect().height)
      if (alto > 0) raiz.style.setProperty('--consola-topbar-h', `${alto}px`)
    }
    medir()
    window.addEventListener('resize', medir)
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null
    obs?.observe(barra)
    return () => {
      window.removeEventListener('resize', medir)
      obs?.disconnect()
    }
  }, [listo])

  useEffect(() => () => clearTimeout(temporizadorPrototipo.current), [])

  useEffect(() => () => clearTimeout(temporizadorRechazo.current), [])

  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  // Al llegar a cero el reloj se detiene solo y queda guardado así (y auditado como parada
  // automática). Solo en partidos vivos con el reloj corriendo y sin tiempo; una corrida se
  // intenta una sola vez, y el comando valida que siga siendo esa misma corrida.
  // Depende del tic porque el cero llega por el paso del tiempo, no por un cambio en la base.
  useEffect(() => {
    if (!d) return
    const p = d.partido
    if (p.estado !== 'vivo' || !corriendo(p) || restanteMs(p, d.liga) !== 0) return
    const corrida = `${p.id}:${p.relojDesde}:${d.observado.seq}`
    if (paradaAutomatica.current === corrida) return
    paradaAutomatica.current = corrida
    detenerReloj(p.id, d.observado, { origen: 'sistema' }).then((r) => {
      // Si la lectura estaba vieja, se relee y el efecto decide de nuevo con lo actual.
      if (!r.ok && r.motivo === 'reloj-desactualizado') {
        paradaAutomatica.current = null
        setLectura((n) => n + 1)
      }
    })
  }, [d, tic])

  if (!d || !sesion) return null
  const { partido, liga, local, visita, jugadores, jugadoresPorId, eventos, observado } = d

  // Ser organizador no alcanza: hay que ser el organizador de esta liga.
  if (!esDuenoDe(sesion, liga)) return <Navigate to={urlPartido(partido, local, visita)} replace state={reenviar(location)} />

  // Si falta uno de los equipos (desde el inicio o porque desapareció con la pantalla abierta) no hay
  // marcador ni plantel que mostrar: nada de controles de anotación. El inicio sigue protegido por
  // iniciarPartido, que revisa los equipos por su cuenta.
  if (!local || !visita) {
    return (
      <>
        <Topbar
          titulo="Consola del árbitro"
          alAtras={() => nav(urlPartido(partido, local, visita), { replace: true, state: reenviar(location) })}
        />
        <div className="consola" style={{ marginTop: 14 }}>
          <div className="aviso alerta" role="alert">
            Este partido no se puede arbitrar: falta uno de sus equipos. Revisa los equipos del partido.
          </div>
        </div>
      </>
    )
  }

  const gl = marcadorEquipo(eventos, partido.localId)
  const gv = marcadorEquipo(eventos, partido.visitaId)
  const periodos = PERIODOS[liga.deporte] || 2
  const periodo = periodoVisible(eventos, liga.deporte)
  const marcaPeriodo = marcaDePeriodo(eventos)
  const falta = restanteMs(partido, liga)
  const anda = corriendo(partido)
  const ultimoPeriodo = periodo >= periodos
  const valores = PUNTOS_POR_DEPORTE[liga.deporte] || [1]
  const limite = LIMITE_FALTAS[liga.deporte] || 5

  const equipo = ladoActivo === 'local' ? local : visita
  // Solo las fichas activas se pueden anotar. El historial no se toca:
  // jugadoresPorId sigue resolviendo a todos, también a los inactivos.
  const plantel = jugadores
    .filter((j) => j.equipoId === equipo.id && activoDe(j))
    .sort(compararPorDorsal)

  // Panel de acciones solo en baloncesto; en futsal la consola queda como estaba.
  const esBaloncesto = liga.deporte === 'baloncesto'
  const panelActivo = esBaloncesto ? panel : 'puntos'
  const accionesPrototipo = ACCIONES_PROTOTIPO[panelActivo] || []

  const avisar = (texto) => {
    setUltimoToque(texto)
    navigator.vibrate?.(12)
    setTimeout(() => setUltimoToque(null), 1200)
  }

  // Un rechazo no lleva toast de éxito ni vibración. Si la pantalla estaba
  // desactualizada, además se vuelve a leer la base para mostrar lo actual.
  const rechazar = (r, opciones) => {
    const texto = textoRechazo(r, opciones)
    if (r.motivo === 'periodo-desactualizado' || r.motivo === 'reloj-desactualizado') setLectura((n) => n + 1)
    clearTimeout(temporizadorRechazo.current)
    setRechazo(texto)
    temporizadorRechazo.current = setTimeout(() => setRechazo(null), MS_RECHAZO)
  }

  // Mensaje aparte del toast funcional: un prototipo nunca se confunde con algo guardado.
  const avisarPrototipo = (texto) => {
    clearTimeout(temporizadorPrototipo.current)
    setAvisoPrototipo(texto)
    navigator.vibrate?.(8)
    temporizadorPrototipo.current = setTimeout(() => setAvisoPrototipo(null), 1200)
  }

  // No escribe en la base ni toca el marcador: solo muestra el aviso y vuelve a Puntos.
  const prototipar = (jugador, codigo) => {
    setPanel('puntos')
    avisarPrototipo(`${TEXTO_PROTOTIPO}: ${nombreVisible(jugador)} ${codigo}`)
  }

  const puntear = async (jugador, puntos) => {
    setPanel('puntos')
    const r = await anotar({
      partidoId: partido.id, equipoId: equipo.id, jugadorId: jugador.id, puntos, periodo, marcaPeriodo,
    })
    if (!r.ok) return rechazar(r)
    avisar(`${nombreVisible(jugador)} +${puntos}`)
  }

  const faltar = async (jugador) => {
    setPanel('puntos')
    const r = await marcarFalta({
      partidoId: partido.id, equipoId: equipo.id, jugadorId: jugador.id, periodo, marcaPeriodo,
    })
    if (!r.ok) return rechazar(r)
    const total = faltasJugador(eventos, jugador.id) + 1
    avisar(total >= limite ? `${nombreVisible(jugador)}: ${total}ª falta, queda fuera` : `Falta de ${nombreVisible(jugador)} (${total})`)
  }

  const deshacerUltimo = async () => {
    const r = await deshacer(partido.id)
    if (r.resultado === 'limite-periodo') {
      clearTimeout(temporizadorRechazo.current)
      setRechazo(MENSAJE_LIMITE_DESHACER)
      temporizadorRechazo.current = setTimeout(() => setRechazo(null), MS_RECHAZO)
    }
  }

  const rehacerUltimo = async () => {
    const r = await rehacer(partido.id)
    if (r.resultado === 'periodo-invalido') rechazar(r)
  }

  const anular = async (id) => {
    const r = await anularEvento(id)
    if (r.resultado === 'limite-periodo') rechazar(r, { accion: 'Un cambio de periodo no se puede anular.' })
  }

  // Ejecuta un comando del reloj o del partido. Un rechazo no escribió nada: se avisa y,
  // si la pantalla estaba desactualizada, se vuelve a leer. Nunca se reintenta solo.
  const ejecutar = async (comando, opciones = { accion: ACCION_RELOJ }) => {
    if (enCurso.current) return null
    enCurso.current = true
    setEjecutando(true)
    try {
      const r = await comando()
      if (!r.ok) rechazar(r, opciones)
      return r
    } finally {
      enCurso.current = false
      setEjecutando(false)
    }
  }

  // El reloj queda cargado pero detenido: arranca cuando el árbitro lo diga.
  const comenzar = () => ejecutar(() => iniciarPartido(partido.id, observado))

  const alternarReloj = () =>
    ejecutar(() => (anda ? detenerReloj(partido.id, observado) : arrancarReloj(partido.id, observado)))

  const siguiente = () =>
    ejecutar(
      () => siguientePeriodo(partido, liga, periodo, marcaPeriodo, observado),
      { accion: 'No se cambió de periodo.' },
    )

  // La confirmación va fuera de la transacción: solo si se acepta se ejecuta el cierre.
  const finalizar = async () => {
    if (!confirm('¿Cerrar el partido? El reloj se detendrá.')) return
    const r = await ejecutar(() => cerrarPartido(partido.id, observado))
    if (r?.ok) nav(urlPartido(partido, local, visita), { replace: true, state: reenviar(location) })
  }

  const recientes = eventos
    .filter((e) => e.tipo === 'punto' || e.tipo === 'falta')
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 10)

  return (
    <>
      <Topbar
        titulo="Consola del árbitro"
        alAtras={() => nav(urlPartido(partido, local, visita), { replace: true, state: reenviar(location) })}
      />

      <div className="consola" ref={consolaRef} style={{ marginTop: 14 }}>
        {rechazo && (
          <div className="rechazo-ancla">
            <div className="aviso alerta" role="alert">{rechazo}</div>
          </div>
        )}

        <CabeceraConsola
          local={{ puntos: gl, etiqueta: local.corto, faltas: faltasEquipo(eventos, local.id) }}
          visita={{ puntos: gv, etiqueta: visita.corto, faltas: faltasEquipo(eventos, visita.id) }}
          periodoTexto={`${periodo}º ${nombrePeriodo(liga.deporte)}`}
          relojTexto={mmss(falta)}
          anda={anda}
          final={partido.estado === 'final'}
        />

        {partido.estado === 'programado' && (
          <button className="btn" onClick={comenzar} disabled={ejecutando}>Comenzar el partido</button>
        )}

        {partido.estado === 'vivo' && (
          <PanelReloj
            anda={anda}
            deshabilitado={ejecutando || (!anda && falta === 0)}
            alAlternar={alternarReloj}
            siguiente={!ultimoPeriodo ? {
              destacado: falta === 0,
              alPulsar: siguiente,
              deshabilitado: ejecutando,
              texto: falta === 0
                ? `Empezar el ${periodo + 1}º ${nombrePeriodo(liga.deporte)}`
                : `Terminar el ${periodo}º ${nombrePeriodo(liga.deporte)} antes de tiempo`,
            } : null}
            fin={ultimoPeriodo && falta === 0
              ? `Se acabó el ${periodo}º ${nombrePeriodo(liga.deporte)}. Cierra el partido cuando el marcador esté bien.`
              : null}
          />
        )}

        {esBaloncesto && (
          <>
            <div className="aviso alerta proto-aviso" role="note">
              Prueba de diseño: estadísticas avanzadas, reloj de posesión y reloj de cruce de
              medio campo son prototipos. No se guardan.
            </div>

            <div className="proto-relojes">
              <div className="proto-reloj" role="group" aria-label="Reloj de posesión">
                <div className="proto-reloj-titulo">Reloj de posesión</div>
                <div className="proto-reloj-valor">
                  <b>{relojPosesion ?? '--'}</b>
                  <span>muestra</span>
                </div>
                <button
                  type="button"
                  className="proto-reloj-reset"
                  aria-label="Reiniciar reloj de posesión (prototipo, no guardado)"
                  onClick={() => setRelojPosesion(VALORES_MUESTRA_PROTOTIPO.posesion)}
                >
                  Reiniciar
                </button>
                <div className="proto-reloj-estado">{TEXTO_PROTOTIPO}</div>
              </div>
              <div className="proto-reloj" role="group" aria-label="Reloj de cruce de medio campo">
                <div className="proto-reloj-titulo">Reloj de cruce de medio campo</div>
                <div className="proto-reloj-valor">
                  <b>{relojCruce ?? '--'}</b>
                  <span>muestra</span>
                </div>
                <button
                  type="button"
                  className="proto-reloj-reset"
                  aria-label="Reiniciar reloj de cruce de medio campo (prototipo, no guardado)"
                  onClick={() => setRelojCruce(VALORES_MUESTRA_PROTOTIPO.cruce)}
                >
                  Reiniciar
                </button>
                <div className="proto-reloj-estado">{TEXTO_PROTOTIPO}</div>
              </div>
            </div>
          </>
        )}

        <SelectorLados
          Escudo={Escudo}
          alElegir={setLadoActivo}
          lados={[['local', local], ['visita', visita]].map(([k, eq]) => ({ clave: k, equipo: eq, nombre: eq.nombre, activo: ladoActivo === k, color: eq.color }))}
        />

        {esBaloncesto && (
          <PanelesBarra
            paneles={PANELES}
            activo={panelActivo}
            alElegir={setPanel}
            textoPrototipo={`PROTOTIPO · ${TEXTO_PROTOTIPO.toLowerCase()}`}
          />
        )}

        <div
          className="plantel"
          id="panel-plantel"
          {...(esBaloncesto
            ? { role: 'tabpanel', 'aria-labelledby': `panel-tab-${panelActivo}` }
            : {})}
        >
          {plantel.map((j) => {
            const faltas = faltasJugador(eventos, j.id)
            const fuera = faltas >= limite
            return (
              <FilaJugadorConsola
                key={j.id}
                expulsado={fuera}
                dorsal={textoDorsal(j)}
                nombre={nombreVisible(j)}
                suma={(
                  <>
                    {puntosJugador(eventos, j.id)} pts
                    {faltas > 0 && <> · <b>{faltas} {faltas === 1 ? 'falta' : 'faltas'}</b></>}
                    {fuera && ' · fuera'}
                  </>
                )}
                hijos={panelActivo === 'puntos' ? (
                  <BotonesPuntos
                    valores={valores}
                    alAnotar={(v) => puntear(j, v)}
                    alFaltar={() => faltar(j)}
                    ariaPunto={(v) => `${nombreVisible(j)} más ${v}`}
                    ariaFalta={`Falta de ${nombreVisible(j)}`}
                  />
                ) : (
                  <div className="anota proto" style={{ '--cols': accionesPrototipo.length }}>
                    {accionesPrototipo.map(([codigo, nombreAccion]) => (
                      <button
                        key={codigo}
                        onClick={() => prototipar(j, codigo)}
                        aria-label={`${nombreVisible(j)}: ${nombreAccion} (prototipo, no guardado)`}
                      >
                        {codigo}
                      </button>
                    ))}
                  </div>
                )}
              />
            )
          })}
        </div>

        {ultimoToque && <div className="aviso" role="status">{ultimoToque}</div>}
        {avisoPrototipo && <div className="aviso alerta proto-toque" role="status">{avisoPrototipo}</div>}

        <RegistroConsola
          nota="Puntos y faltas son la misma lista de eventos, así que se corrigen igual. Nada se borra: lo anulado queda con su hora."
          recientes={recientes.map((e) => ({
            id: e.id,
            tipo: e.tipo,
            puntos: e.puntos,
            anulado: e.anulado,
            quien: nombreVisible(jugadoresPorId[e.jugadorId]) || 'Sin jugador',
            alAnular: () => anular(e.id),
          }))}
        />

        {partido.estado === 'vivo' && (
          <button className="btn fantasma" onClick={finalizar} disabled={ejecutando}>Cerrar el partido</button>
        )}

        {/* Último hijo de .consola: así queda pegado abajo durante todo el desplazamiento
            (roster e historial) y al final queda debajo de todo, sin tapar nada. */}
        <BarraDeshacer alDeshacer={deshacerUltimo} alRehacer={rehacerUltimo} puedeRehacer={hayQueRehacer(eventos)} />
      </div>
    </>
  )
}
