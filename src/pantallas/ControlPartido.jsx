import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { idValido, leerRegistro } from '../lib/control/activacion-almacen'
import { abrirAlmacen } from '../lib/control/sesion-almacen'
import { crearControlador } from '../lib/control/sesion-controlador'
import {
  INTENCIONES, crearRegistroDeIntenciones, estadoDeEvento, mensajeDeResultado, restanteDeTexto, situacionDeControl,
} from '../lib/control/sesion-intencion'
import { compararPorDorsal } from '../lib/dorsal'
import {
  PUNTOS_POR_DEPORTE, LIMITE_FALTAS, marcadorEquipo, faltasEquipo, puntosJugador, faltasJugador, periodoVisible, hayQueRehacer,
} from '../lib/marcador-calculo'
import { PERIODOS, restanteMs, mmss, corriendo, nombrePeriodo, duracionMs } from '../lib/reloj-calculo'
import {
  BarraDeshacer, BotonesPuntos, CabeceraConsola, FilaJugadorConsola, PANELES, PanelReloj, PanelesBarra, RegistroConsola, SelectorLados,
} from './publico/ConsolaPiezas.jsx'
import { iniciales } from '../lib/publico/vista-reloj.js'
import './ControlPartido.css'

// ---------------------------------------------------------------------------
// Pantalla de puntuación del MODO COMPARTIDO (/control/:ligaId/:partidoId/marcador). Misma disposición y gestos que la consola del
// prototipo (Consola.jsx, que no se toca), pero TODO pasa por el controlador aceptado: ni Dexie, ni permisos del prototipo, ni
// escrituras locales de marcador. Solo se lee de aquí lo que el controlador expone (copias congeladas) y solo se actúa con sus
// operaciones. Las piezas visuales son LAS DE LA CONSOLA ORIGINAL (publico/ConsolaPiezas.jsx), las mismas que usa Consola.jsx. Lo que
// el original ofrece y el controlador no soporta (paneles Estadísticas y Defensa, reloj de posesión y reloj de cruce de medio campo,
// que en el prototipo son solo de prueba y no guardan nada) se muestra como NO DISPONIBLE, nunca simulado.
// ---------------------------------------------------------------------------

const MS_AVISO = 4000

// REPORT_130: textos de la recuperación explícita de una parada «no-autorizado» (la ÚNICA parada que la pantalla permite revisar).
const TEXTO_RECUPERACION = {
  'no-autorizado': 'El servidor sigue sin autorizar este teléfono. El envío sigue detenido y lo guardado aquí no se perdió. Avisa al organizador.',
  'resultado-desconocido': 'Todavía no se sabe si el servidor recibió la última acción enviada. El envío sigue detenido y todo sigue guardado aquí.',
  'rechazo-definitivo': 'El servidor rechazó la última acción enviada. El envío sigue detenido y todo sigue guardado aquí. Avisa al organizador.',
  divergencia: 'Los datos de este teléfono no coinciden con el servidor. El envío sigue detenido y todo sigue guardado aquí. Avisa al organizador.',
  'sesion-detenida-por-divergencia': 'Los datos de este teléfono no coinciden con el servidor. El envío sigue detenido y todo sigue guardado aquí. Avisa al organizador.',
  'sin-internet': 'Se necesita conexión a internet para comprobarlo. El envío sigue detenido.',
  'estado-no-disponible': 'No se pudo leer el partido en el servidor. El envío sigue detenido; inténtalo de nuevo en un momento.',
  'estado-demasiado-grande': 'No se pudo leer el partido en el servidor. El envío sigue detenido.',
  'revision-cambio': 'Algo cambió en este teléfono mientras se comprobaba. No se hizo nada; inténtalo de nuevo.',
  'propiedad-perdida': 'Se perdió el control de este partido en esta pestaña. No se hizo nada.',
  'solo-lectura': 'Este partido se está controlando en otra pestaña. Solo esa pestaña puede hacerlo.',
  ocupado: 'Ya se está comprobando. Espera a que termine.',
  'dispositivo-distinto': 'Los datos guardados son de otro teléfono. Este teléfono no puede controlar el partido.',
  'sin-identidad': 'Este teléfono no está activado para este partido.',
  'parada-solo-en-memoria': 'El envío se detuvo pero no quedó anotado: no se puede comprobar desde aquí.',
}
const textoDeRecuperacion = (r) => (r?.ok ? { tipo: 'ok', texto: 'El servidor confirmó la autorización de este teléfono. Lo guardado se enviará ahora, en su orden. El servidor puede volver a retirarla en cualquier momento.' }
  : { tipo: 'error', texto: TEXTO_RECUPERACION[r?.motivo] ?? 'No se pudo comprobar. El envío sigue detenido y todo sigue guardado aquí.' })

/** El controlador REAL del navegador, con sus relojes, candados, canal y conectividad. El token lo lee del registro de activación. */
export async function controladorDelNavegador(ligaId, partidoId) {
  const almacen = await abrirAlmacen()
  const sesionId = `pagina-${globalThis.crypto.randomUUID()}`
  const oyentes = (objetivo, eventos, f) => {
    for (const ev of eventos) objetivo.addEventListener(ev, f)
    return () => { for (const ev of eventos) objetivo.removeEventListener(ev, f) }
  }
  const ctl = crearControlador({
    ligaId,
    partidoId,
    almacen,
    locks: globalThis.navigator?.locks,
    canal: typeof BroadcastChannel === 'function' ? (nombre) => new BroadcastChannel(nombre) : null,
    conexion: { enLinea: () => globalThis.navigator.onLine, alCambiar: (cb) => oyentes(window, ['online', 'offline'], (e) => cb(e.type === 'online')) },
    visibilidad: { visible: () => document.visibilityState === 'visible', alCambiar: (cb) => { const f = () => cb(document.visibilityState === 'visible'); const a = oyentes(document, ['visibilitychange'], f); const b = oyentes(window, ['focus'], f); return () => { a(); b() } } },
    lectura: () => ({ paredMs: Date.now(), monoMs: Math.round(performance.now()), sesionId }),
  })
  return { ctl, cerrar: async () => { try { await ctl.cerrar() } finally { almacen.cerrar() } } }
}

const etiquetaDe = (j) => {
  const nombre = [j.nombrePila, j.apellido1].filter((x) => x !== null).join(' ')
  const dorsal = j.dorsal === null ? null : `#${j.dorsal}`
  return { dorsal, nombre: nombre || null, texto: [dorsal, nombre || null].filter(Boolean).join(' ') || 'Jugador sin nombre ni número registrados' }
}

// Lo que el original ofrece y esta pantalla NO: se dice explícitamente.
const PANELES_NO_DISPONIBLES = ['estadisticas', 'defensa']
const MOTIVO_NO_DISPONIBLE = 'Todavía no disponible en el marcador compartido: esta acción aún no se guarda en el servidor.'
// Escudo de texto (iniciales): el servidor no publica logos ni colores. Esta pantalla no va dentro de «.publico», así que lleva su fondo en línea.
const EscudoDeEquipo = ({ equipo, size = 'sm' }) => <div className={`escudo ${size}`} style={{ background: 'var(--ink-soft)', color: '#fff', fontWeight: 800 }} aria-hidden="true">{iniciales(equipo.nombre)}</div>
const TITULO = 'Consola del árbitro'

const hacerPersonaNula = (j) => ({ id: j.id, dorsal: j.dorsal ?? undefined, nombrePila: j.nombrePila ?? undefined, apellido1: j.apellido1 ?? undefined })

export default function ControlPartido({ fabrica = controladorDelNavegador }) {
  const { ligaId, partidoId } = useParams()
  const valido = idValido(ligaId) && idValido(partidoId)
  const registro = useMemo(() => (valido ? leerRegistro(ligaId, partidoId) : { tipo: 'ninguno' }), [valido, ligaId, partidoId])
  const activada = registro.tipo === 'valido' && registro.registro.estado === 'activada' && !!registro.registro.deviceId
  const [est, setEst] = useState(null)
  const [fallo, setFallo] = useState(null)
  const [lado, setLado] = useState('local')
  const [aviso, setAviso] = useState(null)
  const [confirmando, setConfirmando] = useState(null)
  const [textoReloj, setTextoReloj] = useState('')
  const [, setTic] = useState(0)
  const ctlRef = useRef(null)
  const intenciones = useRef(crearRegistroDeIntenciones())
  const temporizadorAviso = useRef(null)
  const pidioDatos = useRef(false)
  const [ocupados, setOcupados] = useState(0)

  // --- el controlador vive mientras vive la pantalla ---
  useEffect(() => {
    if (!valido || !activada) return undefined
    let vivo = true
    let cierre = null
    let baja = null
    fabrica(ligaId, partidoId).then(async (h) => {
      if (!vivo) { await h.cerrar(); return }
      ctlRef.current = h.ctl
      cierre = h.cerrar
      baja = h.ctl.suscribir((s) => { if (vivo) setEst(s) })
      setEst(h.ctl.estado())
      try { const s = await h.ctl.abrir(); if (vivo) setEst(s) } catch { if (vivo) setFallo('abrir') }
    }).catch(() => { if (vivo) setFallo('crear') })
    return () => {
      vivo = false
      if (baja) baja()
      ctlRef.current = null
      if (cierre) cierre().catch(() => {})
      clearTimeout(temporizadorAviso.current)
    }
  }, [valido, activada, ligaId, partidoId, fabrica])

  // --- el reloj de la pantalla (solo repinta; no escribe nada) ---
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  // --- nombres y números ausentes (sesión anterior): UNA petición acotada del controlador, sin sondeo ---
  const sinDatos = est?.propietario && est.sesion?.ok && est.sesion.visualizacion?.disponible === false
  useEffect(() => {
    if (est?.sesion?.visualizacion?.disponible) pidioDatos.current = false
    if (!sinDatos || pidioDatos.current || !ctlRef.current) return
    pidioDatos.current = true
    ctlRef.current.asegurarDatosParaMostrar().catch(() => {})
  }, [est, sinDatos])

  const avisar = useCallback((r, opciones) => {
    const m = mensajeDeResultado(r, opciones)
    clearTimeout(temporizadorAviso.current)
    setAviso(m)
    if (m.tipo !== 'error') temporizadorAviso.current = setTimeout(() => setAviso(null), MS_AVISO)
  }, [])

  /** Una intención = un cmdId, retenido mientras dura el registro; la misma intención pendiente no se duplica. */
  const intentar = useCallback(async (intencion, accion, opciones) => {
    const ctl = ctlRef.current
    if (!ctl) return
    setOcupados((n) => n + 1)
    try {
      const r = await intenciones.current.ejecutar(intencion, (cmdId) => accion(ctl, cmdId))
      avisar(r, opciones)
      return r
    } finally { setOcupados((n) => n - 1) }
  }, [avisar])

  if (!valido) return <main className="control-partido"><h1>{TITULO}</h1><p className="cp-aviso error" role="alert">La dirección del partido no es válida.</p></main>

  const volver = <Link className="volver" to={`/control/${ligaId}/${partidoId}`}>‹ Activación</Link>
  if (!activada) {
    return (
      <main className="control-partido">
        <div className="topbar">{volver}<h1>{TITULO}</h1></div>
        <p className="cp-aviso error" role="alert">
          {registro.tipo === 'corrupto' || registro.tipo === 'no-disponible'
            ? 'No se pudo leer la activación guardada en este teléfono. No se borró nada.'
            : 'Este teléfono todavía no está activado para este partido.'}
        </p>
        <p className="sub">Activa el teléfono con el código del organizador. Lo ya guardado no se borra.</p>
        <Link className="btn" to={`/control/${ligaId}/${partidoId}`}>Ir a la activación</Link>
      </main>
    )
  }
  if (fallo) return <main className="control-partido"><div className="topbar">{volver}<h1>{TITULO}</h1></div><p className="cp-aviso error" role="alert">No se pudo abrir el control en este navegador.</p></main>
  if (!est) return <main className="control-partido"><div className="topbar">{volver}<h1>{TITULO}</h1></div><p className="sub" role="status">Abriendo el control…</p></main>

  const sit = situacionDeControl(est)
  const ses = est.sesion?.ok ? est.sesion : null
  const prov = ses?.provisional ?? null
  const viz = ses?.visualizacion ?? null
  const eventos = prov?.eventos ?? []
  const deporte = prov?.config?.deporte ?? 'baloncesto'
  const liga = { deporte, minutosPorPeriodo: prov?.config?.minutosPorPeriodo ?? null }
  const partido = prov?.partido ?? null
  const estadoJuego = partido?.estado ?? null
  const relojAhora = ctlRef.current?.relojAhora?.() ?? { estimadoMs: null, nivel: 'sin-estimacion' }
  const falta = partido ? restanteMs(partido, liga, relojAhora.estimadoMs ?? Date.now()) : duracionMs(liga)
  const anda = partido ? corriendo(partido) : false
  const periodos = PERIODOS[deporte] || 2
  const periodo = periodoVisible(eventos, deporte)
  const ultimoPeriodo = periodo >= periodos
  const valores = PUNTOS_POR_DEPORTE[deporte] || [1]
  const limite = LIMITE_FALTAS[deporte] || 5
  const final = estadoJuego === 'final'
  const vivas = ses?.cmdIdsVivos ?? []
  const equipos = viz?.disponible ? viz.equipos : (prov?.equipos ?? []).map((id, i) => ({ id, nombre: `Equipo ${i + 1}` }))
  const equipoActivo = equipos[lado === 'local' ? 0 : 1] ?? null
  const jugadoresDe = (equipoId) => (viz?.disponible ? viz.jugadores.filter((j) => j.equipoId === equipoId && j.activo).sort((a, b) => compararPorDorsal(hacerPersonaNula(a), hacerPersonaNula(b))) : [])
  const porId = Object.fromEntries((viz?.jugadores ?? []).map((j) => [j.id, j]))
  const textoDe = (id) => (porId[id] ? etiquetaDe(porId[id]).texto : 'Jugador sin datos de pantalla')
  const bloqueoUI = ocupados > 0 // solo para el estado visual; el control de duplicados es por intención

  const puedeRecuperar = est.propietario === true && ses?.detenida?.causa === 'transporte' && ses.detenida.clase === 'no-autorizado' && !ses.divergencia
    && !est.estados?.includes('parada-solo-en-memoria') && est.conexion?.enLinea !== false
  const recuperando = est.recuperacion?.enCurso === true
  const recuperar = async () => {
    setConfirmando(null)
    const ctl = ctlRef.current
    if (!ctl?.recuperarDeNoAutorizado) return
    setOcupados((n) => n + 1)
    try {
      const r = await ctl.recuperarDeNoAutorizado({ confirmadoPorOperador: true })
      const m = textoDeRecuperacion(r)
      clearTimeout(temporizadorAviso.current)
      setAviso(m)
      if (m.tipo !== 'error') temporizadorAviso.current = setTimeout(() => setAviso(null), MS_AVISO * 2)
    } catch { setAviso({ tipo: 'error', texto: 'No se pudo comprobar. El envío sigue detenido y todo sigue guardado aquí.' }) } finally { setOcupados((n) => n - 1) }
  }

  const registrar = (intencion, opciones) => intentar(intencion, (ctl, cmdId) => ctl.registrar({ tipo: intencion.tipo, datos: intencion.datos, cmdId }), opciones)

  const comenzar = async () => {
    setConfirmando(null)
    await intentar(INTENCIONES.iniciar(), (ctl, cmdId) => ctl.iniciarPartido({ cmdId, confirmadoPorOperador: true }), { acepta: 'Inicio guardado en este teléfono. Esperando que el servidor lo confirme: hasta entonces no se puede puntuar.' })
  }
  const cerrarPartido = async () => {
    setConfirmando(null)
    await registrar(INTENCIONES.cerrar(), { acepta: 'Cierre guardado en este teléfono. Pendiente de enviar.' })
  }
  const corregir = async (e) => {
    e.preventDefault()
    const v = restanteDeTexto(textoReloj, duracionMs(liga))
    if (!v.ok) { setAviso({ tipo: 'error', texto: v.motivo === 'formato' ? 'Escribe el tiempo como mm:ss, por ejemplo 08:30.' : 'Ese tiempo no cabe en el periodo.' }); return }
    const r = await registrar(INTENCIONES.corregir(v.restanteMs), { acepta: 'Corrección guardada en este teléfono. Pendiente de enviar.' })
    if (r?.resultado?.ok) setTextoReloj('')
  }

  const recientes = eventos.filter((e) => e.tipo === 'punto' || e.tipo === 'falta').slice().sort((a, b) => b.seq - a.seq).slice(0, 10)
  const resumenJugadores = (equipoId) => jugadoresDe(equipoId).map((j) => ({ j, pts: puntosJugador(eventos, j.id), fal: faltasJugador(eventos, j.id) }))
  const pendientesTotal = vivas.length

  return (
    <div className="control-partido">
      <div className="topbar">{volver}<h1>{TITULO}</h1></div>
      <div className="consola" style={{ marginTop: 14 }} aria-busy={bloqueoUI}>
        <div className="cp-avisos" aria-live="polite">
          {sit.avisos.map((a) => (
            <div key={a.id} className={`cp-aviso ${a.nivel}`} role={a.nivel === 'error' ? 'alert' : 'status'} data-aviso={a.id}>
              <span>{a.texto}</span>
              {a.accion === 'reintentar' && sit.puedeActuar && <button type="button" className="btn fantasma" onClick={() => ctlRef.current?.reintentarAhora()}>Reintentar ahora</button>}
              {a.id === 'no-autorizado' && puedeRecuperar && (confirmando === 'recuperar' ? (
                <div className="cp-confirmar" role="group" aria-label="Confirmar la comprobación de la autorización">
                  <p>¿Volver a comprobar la autorización de este teléfono? Se le pregunta al servidor con la misma autorización de siempre (no se renueva ni se cambia nada). Si la acepta, lo guardado aquí se enviará en su orden; si no, el envío sigue detenido y no se pierde nada. El servidor puede retirarla de nuevo en cualquier momento.</p>
                  <div className="fila"><button type="button" className="btn" disabled={recuperando} onClick={recuperar}>Sí, comprobar ahora</button><button type="button" className="btn fantasma" onClick={() => setConfirmando(null)}>Cancelar</button></div>
                </div>
              ) : (
                <button type="button" className="btn fantasma" disabled={recuperando} onClick={() => setConfirmando('recuperar')}>Volver a comprobar la autorización</button>
              ))}
            </div>
          ))}
          {aviso && <div className={`cp-aviso ${aviso.tipo === 'error' ? 'error' : aviso.tipo === 'ok' ? 'ok' : 'info'}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} data-aviso="resultado">{aviso.texto}</div>}
        </div>

        {ses && viz && !viz.disponible && est.propietario && (
          <div className="cp-aviso aviso" role="status" data-aviso="sin-datos-de-pantalla">
            Faltan los nombres y números de los jugadores en este teléfono. Se piden al servidor cuando hay conexión; mientras tanto no se puede anotar a jugadores. El reloj y el periodo siguen disponibles.
          </div>
        )}
        {ses && viz?.disponible && viz.desactualizada && (
          <div className="cp-aviso info" role="status" data-aviso="datos-desactualizados">Los nombres y números guardados podrían estar desactualizados.</div>
        )}

        <CabeceraConsola
          local={{ aria: `Puntos de ${equipos[0]?.nombre ?? 'local'}`, puntos: equipos[0] ? marcadorEquipo(eventos, equipos[0].id) : '—', etiqueta: equipos[0]?.nombre ?? '—', faltas: equipos[0] ? faltasEquipo(eventos, equipos[0].id) : 0 }}
          visita={{ aria: `Puntos de ${equipos[1]?.nombre ?? 'visita'}`, puntos: equipos[1] ? marcadorEquipo(eventos, equipos[1].id) : '—', etiqueta: equipos[1]?.nombre ?? '—', faltas: equipos[1] ? faltasEquipo(eventos, equipos[1].id) : 0 }}
          periodoTexto={`${periodo}º ${nombrePeriodo(deporte)}`}
          relojTexto={mmss(falta)}
          ariaReloj="Reloj del periodo"
          anda={anda}
          final={final}
        />

        <p className="cp-sincro" data-sincro>
          {ses ? <>Guardado aquí, pendiente de enviar: <b>{pendientesTotal}</b> · Confirmado por el servidor: <b>{ses.confirmadas}</b></> : 'Todavía no hay datos de este partido en este teléfono.'}
        </p>

        {(!ses || ses.inicio === 'sin-iniciar') && !ses?.enviando && !ses?.pendientes && sit.puedeActuar && (
          confirmando === 'inicio' ? (
            <div className="cp-confirmar" role="group" aria-label="Confirmar el inicio">
              <p>¿Comenzar el partido? Hace falta conexión: el servidor tiene que confirmar el inicio antes de poder anotar.</p>
              <div className="fila"><button type="button" className="btn" onClick={comenzar}>Confirmar inicio</button><button type="button" className="btn fantasma" onClick={() => setConfirmando(null)}>Cancelar</button></div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmando('inicio')} disabled={est.conexion?.enLinea === false || intenciones.current.pendiente('iniciar-partido')}>Comenzar el partido</button>
          )
        )}
        {ses?.inicio === 'sin-resolver' && <div className="cp-aviso aviso" role="status" data-aviso="inicio-sin-resolver">{'Este partido ya estaba en marcha o terminado antes de abrir este control. No se puede puntuar desde aquí.'}</div>}
        {ses?.inicio === 'sin-iniciar' && !ses.enviando && !ses.pendientes && est.conexion?.enLinea === false && <p className="sub" data-aviso="inicio-sin-internet">Para comenzar el partido se necesita conexión a internet.</p>}

        {ses?.inicio === 'confirmado' && estadoJuego === 'vivo' && (
          <PanelReloj
            anda={anda}
            deshabilitado={!sit.puedeReloj || relojAhora.nivel !== 'confiable' || (!anda && falta === 0)}
            alAlternar={() => registrar(anda ? INTENCIONES.detener() : INTENCIONES.arrancar(), { acepta: 'Reloj guardado en este teléfono. Pendiente de enviar.' })}
            extras={!anda && (
              <form className="cp-corregir" onSubmit={corregir}>
                <label htmlFor="cp-reloj">Corregir reloj (mm:ss)</label>
                <input id="cp-reloj" inputMode="numeric" autoComplete="off" placeholder="08:30" value={textoReloj} onChange={(e) => setTextoReloj(e.target.value)} disabled={!sit.puedeReloj} />
                <button type="submit" className="btn fantasma" disabled={!sit.puedeReloj || textoReloj.trim() === ''}>Corregir</button>
              </form>
            )}
            siguiente={!ultimoPeriodo ? {
              destacado: falta === 0,
              deshabilitado: !sit.puedeReloj,
              alPulsar: () => registrar(INTENCIONES.siguientePeriodo(), { acepta: 'Cambio de periodo guardado en este teléfono. Pendiente de enviar.' }),
              texto: falta === 0 ? `Empezar el ${periodo + 1}º ${nombrePeriodo(deporte)}` : `Terminar el ${periodo}º ${nombrePeriodo(deporte)} antes de tiempo`,
            } : null}
            fin={ultimoPeriodo && falta === 0 ? `Se acabó el ${periodo}º ${nombrePeriodo(deporte)}. Cierra el partido cuando el marcador esté bien.` : null}
          />
        )}

        {ses?.inicio === 'confirmado' && !final && (
          <>
            {deporte === 'baloncesto' && (
              <div className="cp-aviso info" role="note" data-aviso="no-disponible-original">
                No disponibles todavía en el marcador compartido: estadísticas avanzadas, defensa, reloj de posesión y reloj de cruce de medio campo. En el prototipo son solo de prueba y no se guardan; aquí no se simulan.
              </div>
            )}
            <SelectorLados
              Escudo={EscudoDeEquipo}
              alElegir={setLado}
              lados={[['local', equipos[0]], ['visita', equipos[1]]].map(([k, eq]) => ({ clave: k, equipo: eq ?? null, nombre: eq?.nombre ?? '—', activo: lado === k, color: 'var(--ink)', deshabilitado: !eq }))} // el servidor no publica colores de equipo: el activo se rellena con el color de tinta, como la pestaña «Puntos»
            />

            {deporte === 'baloncesto' && (
              <PanelesBarra paneles={PANELES} activo="puntos" alElegir={() => {}} noDisponibles={PANELES_NO_DISPONIBLES} motivoNoDisponible={MOTIVO_NO_DISPONIBLE} />
            )}

            <div className="plantel" id="panel-plantel">
              {viz?.disponible && equipoActivo && jugadoresDe(equipoActivo.id).map((j) => {
                const e = etiquetaDe(j)
                const faltas = faltasJugador(eventos, j.id)
                const fuera = faltas >= limite
                return (
                  <FilaJugadorConsola
                    key={j.id}
                    datos={{ 'data-jugador': j.id }}
                    expulsado={fuera}
                    dorsal={j.dorsal === null ? '—' : String(j.dorsal)}
                    nombre={e.nombre ?? 'Sin nombre registrado'}
                    suma={<>{puntosJugador(eventos, j.id)} pts{faltas > 0 && <> · <b>{faltas} {faltas === 1 ? 'falta' : 'faltas'}</b></>}{fuera && ' · fuera'}</>}
                    hijos={(
                      <BotonesPuntos
                        valores={valores}
                        deshabilitadoPunto={(v) => !sit.puedePuntuar || intenciones.current.pendiente(`anotar:${j.id}:${v}`)}
                        deshabilitadoFalta={!sit.puedePuntuar || intenciones.current.pendiente(`falta:${j.id}`)}
                        ariaPunto={(v) => `${e.texto} más ${v}`}
                        ariaFalta={`Falta de ${e.texto}`}
                        alAnotar={(v) => registrar(INTENCIONES.anotar(equipoActivo.id, j.id, v), { acepta: `${e.texto} +${v}: guardado en este teléfono, pendiente de enviar.` })}
                        alFaltar={() => registrar(INTENCIONES.falta(equipoActivo.id, j.id), { acepta: `Falta de ${e.texto}: guardada en este teléfono, pendiente de enviar.` })}
                      />
                    )}
                  />
                )
              })}
            </div>
          </>
        )}

        {ses && (
          <RegistroConsola
            nota="Nada se borra: lo anulado queda registrado."
            recientes={recientes.map((e) => {
              const estadoEv = estadoDeEvento(e, vivas)
              return {
                id: e.id,
                tipo: e.tipo,
                puntos: e.puntos,
                anulado: e.anulado,
                quien: textoDe(e.jugadorId),
                estado: <span className={`cp-estado ${estadoEv}`}>{estadoEv === 'pendiente' ? 'Pendiente' : 'Confirmado'}</span>,
                deshabilitado: !sit.puedeActuar,
                alAnular: () => registrar(INTENCIONES.anular(e.id), { acepta: 'Anulación guardada en este teléfono. Pendiente de enviar.' }),
              }
            })}
          />
        )}

        {final && ses && (
          <section className="cp-resumen" aria-label="Resumen final">
            <h2 className="seccion">Resumen final</h2>
            <p className="cp-final">{equipos[0]?.nombre} {marcadorEquipo(eventos, equipos[0]?.id)} — {marcadorEquipo(eventos, equipos[1]?.id)} {equipos[1]?.nombre}</p>
            {equipos.map((eq) => (
              <div key={eq.id} className="cp-resumen-equipo">
                <h3>{eq.nombre}</h3>
                <ul>
                  {resumenJugadores(eq.id).map(({ j, pts, fal }) => <li key={j.id}>{etiquetaDe(j).texto}: {pts} pts · {fal} {fal === 1 ? 'falta' : 'faltas'}</li>)}
                </ul>
              </div>
            ))}
            <p className="sub">{pendientesTotal > 0 ? `Quedan ${pendientesTotal} acciones guardadas aquí por confirmar con el servidor.` : 'Todas las acciones están confirmadas por el servidor.'}</p>
          </section>
        )}

        {ses?.inicio === 'confirmado' && estadoJuego === 'vivo' && (
          confirmando === 'cierre' ? (
            <div className="cp-confirmar" role="group" aria-label="Confirmar el cierre">
              <p>¿Cerrar el partido? El reloj se detendrá.</p>
              <div className="fila"><button type="button" className="btn" onClick={cerrarPartido}>Confirmar cierre</button><button type="button" className="btn fantasma" onClick={() => setConfirmando(null)}>Cancelar</button></div>
            </div>
          ) : (
            <button type="button" className="btn fantasma" disabled={!sit.puedeReloj} onClick={() => setConfirmando('cierre')}>Cerrar el partido</button>
          )
        )}

        {ses?.inicio === 'confirmado' && !final && (
          <BarraDeshacer
            deshabilitado={!sit.puedeActuar}
            puedeRehacer={hayQueRehacer(eventos)}
            alDeshacer={() => registrar(INTENCIONES.deshacer(), { acepta: 'Deshacer guardado en este teléfono. Pendiente de enviar.' })}
            alRehacer={() => registrar(INTENCIONES.rehacer(), { acepta: 'Rehacer guardado en este teléfono. Pendiente de enviar.' })}
          />
        )}
      </div>
    </div>
  )
}
