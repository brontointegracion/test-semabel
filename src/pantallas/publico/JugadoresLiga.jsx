import { etiquetaNombre, etiquetaNumero } from '../../lib/publico/equipo.js'
import { Cargando, EscudoTexto, textoDeError } from './componentes.jsx'

// ---------------------------------------------------------------------------
// Pestaña «Jugadores» de la liga pública: Máximos anotadores y Más faltas, con la misma fila del prototipo (Liga.jsx → Jugadores). Lee
// SOLO el ranking que publica el servidor (GET /v1/ligas/{liga}/jugadores/publico): no suma ni reordena nada en el navegador y no
// muestra lo que el servidor no registra (partidos jugados, promedios, asistencias, rebotes).
// ---------------------------------------------------------------------------

function Fila({ e, valor, unidad }) {
  return (
    <div className="jugador-fila">
      <span className="pos" style={{ paddingLeft: 4 }} aria-label={`Puesto ${e.rango}`}>{e.rango}</span>
      <EscudoTexto nombre={e.equipo.nombre} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nombre" style={{ fontWeight: 600 }}>
          <span className={e.nombre === null ? 'falta-dato' : ''}>{etiquetaNombre(e.nombre)}</span>
          {!e.enPlantilla && <span className="nota-ficha" style={{ marginLeft: 6 }}>Fuera de la plantilla</span>}
        </div>
        <div className="sub" style={{ fontSize: '0.75rem' }}>{etiquetaNumero(e.dorsalActual)} · {e.equipo.nombre}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
        <div className="sub" style={{ fontSize: '0.68rem' }}>{unidad}</div>
      </div>
    </div>
  )
}

function Ranking({ titulo, filas, campo, unidad, vacio }) {
  return (
    <>
      <h2 className="seccion">{titulo}</h2>
      {filas.length === 0
        ? <div className="vacio">{vacio}</div>
        : <div className="lista" role="list" aria-label={titulo}>{filas.map((e) => <Fila key={`${e.id}|${e.equipo.id}`} e={e} valor={e[campo]} unidad={unidad} />)}</div>}
    </>
  )
}

/** `estado`: el estado del recurso de jugadores de la liga (useRecurso). */
export default function JugadoresLiga({ estado }) {
  const d = estado.datos
  if (!d) {
    return estado.fase === 'cargando'
      ? <Cargando>Cargando estadísticas…</Cargando>
      : <div className="aviso" role="status">{textoDeError(estado)}</div>
  }
  if (d.partidosFinales === 0) {
    return <div className="vacio">Las estadísticas aparecen cuando termine el primer partido. Los partidos programados o en juego no cuentan.</div>
  }
  const sin = d.sinJugador
  return (
    <>
      <p className="sub" style={{ marginTop: 12 }}>
        Solo cuentan los partidos terminados ({d.partidosFinales}). Los programados o en juego no suman. Cada jugador se agrupa por su inscripción
        en el equipo, no por su nombre: dos jugadores con el mismo nombre son dos filas, y quien tiene inscripciones en varios equipos aparece
        una vez por inscripción. Los empates comparten puesto. Los datos de quien ya no está en la plantilla se conservan.
      </p>
      <Ranking titulo="Máximos anotadores" filas={d.maximosAnotadores} campo="puntos" unidad="puntos totales" vacio="Todavía no hay puntos anotados en partidos terminados." />
      <Ranking titulo="Más faltas" filas={d.masFaltas} campo="faltas" unidad="faltas personales" vacio="Todavía no hay faltas registradas en partidos terminados." />
      {d.recortado && <p className="sub">Se muestran solo los primeros puestos.</p>}
      {(sin.puntos > 0 || sin.faltas > 0) && (
        <p className="sub">Hay {sin.puntos} puntos y {sin.faltas} faltas sin jugador asignado; no entran en estas listas.</p>
      )}
    </>
  )
}
