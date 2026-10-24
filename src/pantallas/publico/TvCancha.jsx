import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecursos } from '../../lib/publico/hooks.js'
import { fechaLargaPanama, horaPanama } from '../../lib/publico/formato.js'
import { recursoJuegoTv, recursoLiga } from '../../lib/publico/recursos.js'
import { espiar, reprogramarRecurso } from '../../lib/publico/recurso.js'
import { elegirVistaTv, indiceVigilado, secuenciaTv } from '../../lib/publico/tv-secuencia.js'
import { ligasConfiguradas } from '../../lib/publico/config.js'
import { urlLigaPublica } from '../../lib/publico/agrupar.js'
import { salidaDeTvCancha } from '../../lib/publico/tv-piloto.js'
import { vistaDelMarcador } from '../../lib/publico/vista-marcador.js'
import { EnlaceConOrigen, textoDeError } from './componentes.jsx'
import { ContenidoPartido, MarcoPantalla } from './PantallaMarcador.jsx'
import './publico.css'

// ---------------------------------------------------------------------------
// /tv/cancha (REPORT_199): UNA dirección de televisión que sigue la secuencia explícita de partidos configurada en la compilación
// (lib/publico/tv-secuencia.js). Solo LEE: no inicia, termina, activa ni puntúa nada, y no hace ninguna otra petición que las lecturas
// públicas existentes (un recurso por partido de la secuencia y uno por liga: las mismas cadencias y la misma cola de siempre; el partido
// que se muestra recibe sus datos, no vuelve a pedirlos). Qué partido se ve lo decide elegirVistaTv con lo que el servidor confirmó.
// El marco (pantalla completa, pantalla encendida) es el MISMO en todos los estados: cambiar de partido no lo desmonta.
// ---------------------------------------------------------------------------

const VACIA = Object.freeze([])

function Mensaje({ titulo, children }) {
  return (
    <div className="sb-tv-mensaje" role="status">
      <p className="sb-brand"><span className="sb-brand__dot" aria-hidden="true" />semabel.com</p>
      <h1 className="sb-tv-mensaje__titulo">{titulo}</h1>
      {children}
    </div>
  )
}

// Fecha y hora del siguiente partido, separadas (la tarjeta pinta la hora grande y la fecha pequeña encima). Sin hora programada: «Por confirmar».
const cuandoDe = (d) => (d.programadoPara ? { fecha: fechaLargaPanama(d.programadoPara), hora: horaPanama(d.programadoPara) } : { fecha: 'Por confirmar', hora: '—' })

export default function TvCancha() {
  const nav = useNavigate()
  const cfg = useMemo(() => secuenciaTv(), [])
  const pares = cfg.ok ? cfg.pares : VACIA
  // El partido que la pantalla espera se lee cada 5 s; se decide con lo último confirmado de TODOS (lectura síncrona del registro, sin otra suscripción).
  const defsJuego = useMemo(() => {
    const claves = pares.map((p) => `juego:${p.ligaId}:${p.gameId}`)
    return pares.map((p, i) => recursoJuegoTv(p.ligaId, p.gameId, () => indiceVigilado(claves.map((c) => espiar(c))) === i))
  }, [pares])
  const ligas = useMemo(() => [...new Set(pares.map((p) => p.ligaId))], [pares])
  const defsLiga = useMemo(() => ligas.map((l) => recursoLiga(l)), [ligas])
  // Una suscripción por partido y una por liga, TODAS aquí: ningún componente de abajo se suscribe otra vez.
  const estados = useRecursos(defsJuego)
  const estadosLiga = useRecursos(defsLiga)
  const sel = useMemo(() => (cfg.ok ? elegirVistaTv(pares, estados) : null), [cfg, pares, estados])
  const partido = sel?.tipo === 'partido' ? sel : null
  // Cuando cambia cuál es el partido esperado, su temporizador (quizá de 30 s) se recalcula con la cadencia nueva; no se pide nada extra.
  const vigilado = cfg.ok ? indiceVigilado(estados) : null
  useEffect(() => { if (vigilado !== null) reprogramarRecurso(defsJuego[vigilado].clave) }, [vigilado, defsJuego])

  useEffect(() => {
    if (partido) return undefined // el partido que se muestra pone su propio título
    const anterior = document.title
    document.title = 'Transmisión en TV · semabel.com'
    return () => { document.title = anterior }
  }, [partido === null]) // eslint-disable-line react-hooks/exhaustive-deps

  // REPORT_221: «Partidos en TV» solo si /tv existe en esta compilación; con el alcance del evento real (sin la liga ficticia) la salida es la portada, nunca una página «no disponible».
  const salida = useMemo(() => salidaDeTvCancha(ligasConfiguradas().ids), [])
  const botonSalir = <button className="cerrar" onClick={() => nav(salida.to)}>{salida.etiqueta}</button>
  let contenido
  let vista = 'mensaje'
  let enVivo = false
  let liga = 'Transmisión en TV'
  let enlaceLiga = null // solo con UN partido en pantalla (también su último resultado con el próximo en vista previa, o la sesión completada)

  if (!cfg.ok) {
    contenido = cfg.error === 'sin-configurar'
      ? <Mensaje titulo="Transmisión no configurada"><p className="sb-tv-mensaje__texto">Esta transmisión no está configurada en esta versión de Sebel.</p></Mensaje>
      : <Mensaje titulo="Configuración no válida"><p className="sb-tv-mensaje__texto">La secuencia de partidos de esta transmisión no es válida. Avisa al organizador.</p></Mensaje>
  } else if (sel.tipo === 'cargando') {
    contenido = <Mensaje titulo="Cargando la transmisión…" />
  } else if (sel.tipo === 'sin-conexion') {
    const conError = estados.find((e) => e.error !== null || e.fase !== 'cargando') ?? estados[0]
    contenido = <Mensaje titulo="Sin conexión con el servidor"><p className="sb-tv-mensaje__texto">{textoDeError(conError)}</p></Mensaje>
  } else if (sel.tipo === 'falta') {
    contenido = (
      <Mensaje titulo="Partido no encontrado">
        <p className="sb-tv-mensaje__texto">El servidor no encuentra {sel.indices.length === 1 ? 'un partido' : 'partidos'} de la secuencia. Revisa la configuración de la transmisión.</p>
        <ul className="sb-tv-mensaje__lista">{sel.indices.map((i) => <li key={i}>{`Partido ${i + 1}: ${pares[i].gameId}`}</li>)}</ul>
      </Mensaje>
    )
  } else if (sel.tipo === 'conflicto') {
    contenido = (
      <Mensaje titulo="Más de un partido en vivo">
        <p className="sb-tv-mensaje__texto">No se elige ninguno automáticamente. Abre el marcador que quieras mostrar:</p>
        <ul className="sb-tv-mensaje__lista">
          {sel.indices.map((i) => {
            const d = estados[i].datos
            return (
              <li key={i}>
                <EnlaceConOrigen to={`/liga/${pares[i].ligaId}/partido/${pares[i].gameId}`}>
                  {`Partido ${i + 1}: ${d.local.nombre} vs ${d.visita.nombre} · ${d.local.puntos}–${d.visita.puntos}`}
                </EnlaceConOrigen>
              </li>
            )
          })}
        </ul>
      </Mensaje>
    )
  } else {
    const { indice } = sel
    const estado = estados[indice]
    const d = estado.datos
    const deporte = estadosLiga[ligas.indexOf(pares[indice].ligaId)]?.datos?.liga.deporte ?? 'baloncesto'
    vista = vistaDelMarcador({ estado: d.estado, periodo: d.periodo, reloj: d.reloj, deporte })
    enVivo = d.estado === 'vivo'
    liga = d.liga.nombre
    enlaceLiga = urlLigaPublica(pares[indice].ligaId)
    const sig = sel.proximo !== null ? estados[sel.proximo].datos : null
    const proximo = sig ? { local: sig.local.nombre, visita: sig.visita.nombre, ...cuandoDe(sig) } : null
    let sinProximo = null
    if (sel.completa) sinProximo = { etiqueta: 'Sesión completada', nota: 'Este fue el último partido de esta transmisión.' }
    else if (sel.proximo !== null && !sig) sinProximo = { etiqueta: 'Próximo partido', nota: 'La información del próximo partido no está disponible por ahora.' }
    // Una lectura fallida de OTRO partido de la secuencia (por ejemplo, la del siguiente) no avanza nada, pero se dice.
    const avisoExtra = estados.some((e, i) => i !== indice && e.error !== null) ? 'Sin actualizar · sin conexión con otro partido de la secuencia' : null
    contenido = (
      <ContenidoPartido
        ligaId={pares[indice].ligaId} gameId={pares[indice].gameId} def={defsJuego[indice]} estado={estado} deporte={deporte}
        proximo={proximo} sinProximo={sinProximo} avisoExtra={avisoExtra} conEnlaces={false}
      />
    )
  }

  return <MarcoPantalla vista={vista} enVivo={enVivo} liga={liga} botonSalir={botonSalir} enlaceLiga={enlaceLiga}>{contenido}</MarcoPantalla>
}
