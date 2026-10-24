import { useEffect, useMemo, useRef, useState } from 'react'
import { frescura, useMono } from '../../lib/publico/hooks.js'
import { ID_PUBLICO } from '../../lib/publico/config.js'
import { fechaLargaPanama, horaCompletaPanama, horaPanama, textoSede } from '../../lib/publico/formato.js'
import { ahoraServidor } from '../../lib/publico/reloj-servidor.js'
import { vistaReloj } from '../../lib/publico/vista-reloj.js'
import { etiquetasDe } from '../../lib/publico/agrupar.js'
import { urlEquipoPublico } from '../../lib/publico/equipo.js'
import { leerMedios, mediosDeLiga } from '../../lib/publico/medios.js'
import { etiquetaPeriodo, vistaDelMarcador } from '../../lib/publico/vista-marcador.js'
import { useReconocimiento } from '../../lib/publico/hook-reconocimiento.js'
import { VistaDescanso, VistaEntrePartidos, VistaJuego } from './MarcadorTv.jsx'
import './publico.css'

// ---------------------------------------------------------------------------
// El marcador grande, repartido en dos piezas para que lo usen el partido de dirección fija (PartidoPublico) y la transmisión de
// televisión (TvCancha, REPORT_199) SIN duplicar nada:
//   MarcoPantalla      el contenedor que entra en pantalla completa, mantiene la pantalla encendida y lleva la barra de herramientas.
//                      Debe seguir montado mientras el televisor cambia de partido o de mensaje, o la pantalla completa se perdería.
//   ContenidoPartido   las vistas del partido (juego, descanso, final) a partir de UNA lectura ya hecha: no pide nada por su cuenta.
// ---------------------------------------------------------------------------

/** Cuántos dígitos debe caber en cada lado del marcador (el mayor de los dos, mínimo 2): el CSS dimensiona AMBOS números con él. */
export const digitosDelMarcador = (local, visita) => Math.max(2, String(local).length, String(visita).length)

// Colores de los dos lados cuando el piloto no configura uno por equipo (medios/manifest.json): fijos por lado, nunca inventados por equipo.
const COLOR_LADO = Object.freeze({ local: '#1F4FA3', visita: '#1E7A4C' })

const IconoPausa = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
)

/**
 * Fecha del encabezado (REPORT_201): «Miércoles 21 de octubre» en Panamá. La hora programada acompaña SOLO antes de empezar y en el resultado final;
 * con el partido en juego (también en pausas y descansos) no se repite. Sin fecha: «Fecha por confirmar» antes de empezar; en los demás estados, nada.
 */
export function fechaDeEncabezado(d) {
  if (d.programadoPara) {
    const dia = fechaLargaPanama(d.programadoPara)
    return d.estado === 'vivo' ? dia : `${dia} · ${horaPanama(d.programadoPara)}`
  }
  if (d.inicioReal) return fechaLargaPanama(d.inicioReal)
  return d.estado === 'programado' ? 'Fecha por confirmar' : null
}

/**
 * `enlaceLiga` (REPORT_226): dirección pública de la liga del partido que se muestra, o null (por omisión: ningún otro consumidor cambia). Solo la usa la TV:
 * «Ver estadísticas de la liga» junto a «Inicio», en otra pestaña (la TV no se mueve de su pantalla).
 */
export function MarcoPantalla({ vista, enVivo, liga, botonSalir, compartir = null, enlaceLiga = null, children }) {
  const contenedor = useRef(null)
  const [completa, setCompleta] = useState(false)

  useEffect(() => {
    const alCambiar = () => setCompleta(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  // Mantener la pantalla encendida (televisor): se pide de nuevo al volver a verse la pestaña.
  useEffect(() => {
    let candado = null
    let vivo = true
    const pedir = async () => {
      try { candado = await navigator.wakeLock?.request('screen') } catch { /* no disponible */ }
      if (!vivo) candado?.release?.()
    }
    const alVer = () => { if (document.visibilityState === 'visible') pedir() }
    pedir()
    document.addEventListener('visibilitychange', alVer)
    return () => { vivo = false; document.removeEventListener('visibilitychange', alVer); candado?.release?.() }
  }, [])

  const pantallaCompleta = async () => {
    try {
      if (!document.fullscreenElement) await contenedor.current?.requestFullscreen()
      else await document.exitFullscreen()
    } catch { /* el navegador puede negarlo */ }
  }

  return (
    <div className="board-pagina publico sb-app" ref={contenedor} data-presenting={completa} data-vista={vista}>
      <div className="sb-toolbar">
        {botonSalir}
        {enlaceLiga && (
          <a className="btn fantasma sb-enlace-estadisticas" href={enlaceLiga} target="_blank" rel="noopener noreferrer" aria-label="Ver estadísticas de la liga (se abre en otra pestaña)" data-enlace="estadisticas-liga">
            Ver estadísticas de la liga <span aria-hidden="true">↗</span>
          </a>
        )}
        <span className="sb-toolbar__liga">{liga}</span>
        {enVivo && <span className="pill vivo"><i className="punto" />EN VIVO</span>}
        <button className="btn fantasma" onClick={pantallaCompleta}>Pantalla completa</button>
        {compartir}
      </div>
      {completa && <button className="sb-exit" onClick={pantallaCompleta}>Salir de pantalla completa</button>}
      <div className="sb-stage-area">
        <div className="sb-tv" aria-label="Pantalla del marcador">{children}</div>
      </div>
    </div>
  )
}

/**
 * Las vistas de UN partido a partir de su lectura pública (`estado`: el recurso, con `datos`).
 *   deporte        el de la liga (lectura de la liga); sin él, baloncesto, como siempre.
 *   proximo        { local, visita, hora, categoria? } ya resuelto por quien muestra el marcador, o null.
 *   sinProximo     { etiqueta, nota } que sustituye a «Calendario» cuando no hay próximo partido y conviene decir por qué.
 *   avisoExtra     texto de «Sin actualizar» que añade quien muestra el marcador (p. ej., otra lectura de su secuencia que falló).
 *   conEnlaces     enlaces de equipo (false en el televisor: no hay a dónde ir con el mando).
 * El aviso de canasta se reinicia con cada partido nuevo (la primera lectura de un partido solo fija la línea base).
 */
export function ContenidoPartido({ ligaId, gameId, def, estado, deporte, idsEquipos = null, proximo = null, sinProximo = null, avisoExtra = null, conEnlaces = true }) {
  const d = estado.datos
  const { mono, saltoMono } = useMono({ activo: true })
  const [manifiesto, setManifiesto] = useState(null)
  useEffect(() => {
    let vivo = true
    leerMedios().then((m) => { if (vivo) setManifiesto(m) })
    return () => { vivo = false }
  }, [])
  const medios = useMemo(() => mediosDeLiga(manifiesto, ligaId), [manifiesto, ligaId])
  const aviso = useReconocimiento({ gameId, datos: d, error: estado.error, activo: d?.estado === 'vivo' })

  useEffect(() => {
    const anterior = document.title
    const marcador = d.estado === 'programado' ? 'vs' : `${d.local.puntos}-${d.visita.puntos}`
    document.title = `${d.local.nombre} ${marcador} ${d.visita.nombre} · semabel.com`
    return () => { document.title = anterior }
  }, [d.local.nombre, d.visita.nombre, d.local.puntos, d.visita.puntos, d.estado]) // eslint-disable-line react-hooks/exhaustive-deps

  const periodoMs = def.periodoDe(d)
  const f = frescura(estado, mono, { periodoMs, saltoMono })
  const v = vistaReloj({ estado: d.estado, reloj: d.reloj, muestra: estado.muestra, mono, relojConfiable: f.relojConfiable })
  const vista = vistaDelMarcador({ estado: d.estado, periodo: d.periodo, reloj: d.reloj, deporte })
  const retrasado = d.estado === 'programado' && d.programadoPara !== null && estado.muestra !== null
    && Date.parse(d.programadoPara) < ahoraServidor(estado.muestra, mono)
  const ultimoDato = horaCompletaPanama(estado.ultimoExito?.servidorMs)
  const etiquetas = etiquetasDe(d.liga)
  const categoria = [etiquetas.categoria && `Categoría ${etiquetas.categoria}`, etiquetas.subcategoria].filter(Boolean).join(' · ') || null

  const cab = {
    marca: d.liga.nombre,
    categoria,
    fecha: fechaDeEncabezado(d),
    sede: textoSede(d),
    logo: medios.organizador.logo,
    sinActualizar: f.sinActualizar ? `Sin actualizar${ultimoDato ? ` · último dato confirmado a las ${ultimoDato}` : ''}` : avisoExtra,
  }
  const ctx = {
    vista, medios, color: COLOR_LADO, digitos: digitosDelMarcador(d.local.puntos, d.visita.puntos),
    enlaceEquipo: (eq) => (conEnlaces && ID_PUBLICO.test(eq.id) ? urlEquipoPublico(ligaId, eq.id, idsEquipos) : null),
  }

  // Centro del partido en juego (y por jugar): el periodo, el reloj del servidor y su estado. Un 00:00 que solo vio el dispositivo no es un fin de período.
  const enJuego = d.estado === 'vivo'
  const notaReloj = !enJuego ? null : (v.nota === 'Fin del período' ? 'Esperando confirmación' : v.nota)
  const centro = enJuego ? (
    <>
      <p className="sb-period">{etiquetaPeriodo(deporte, d.periodo)}</p>
      <p className={`sb-clock ${v.detenido ? 'detenido' : ''}`} aria-label="Reloj del partido">{v.texto}</p>
      <p className="sb-clock-status" data-visible={notaReloj !== null} data-tone={v.nota === 'Sin actualizar' ? 'alerta' : undefined}>
        <IconoPausa />{notaReloj ?? 'Reloj detenido'}
      </p>
    </>
  ) : (
    <>
      <p className="sb-period">Por jugar</p>
      <p className="sb-sched">{d.programadoPara ? horaPanama(d.programadoPara) : '—'}</p>
      {retrasado && <p className="sb-clock-note">Pendiente de comenzar</p>}
    </>
  )

  return (
    <>
      {(vista === 'juego' || vista === 'programado') && <VistaJuego cab={cab} d={d} ctx={ctx} centro={centro} aviso={enJuego ? aviso : null} />}
      {(vista === 'fin-periodo' || vista === 'fin-tiempo') && <VistaDescanso cab={cab} d={d} ctx={ctx} deporte={deporte} />}
      {vista === 'final' && <VistaEntrePartidos cab={cab} d={d} ctx={ctx} categoria={categoria} proximo={proximo ? { ...proximo, categoria: proximo.categoria ?? categoria } : null} sinProximo={sinProximo} />}
    </>
  )
}
