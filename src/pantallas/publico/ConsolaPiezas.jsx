// ---------------------------------------------------------------------------
// Las piezas visuales de la CONSOLA DEL ÁRBITRO ORIGINAL (pantallas/Consola.jsx), como presentación pura: cabecera con marcador y reloj,
// panel del reloj, selector de equipos, barra de paneles, fila de jugador con sus botones, registro de últimas acciones y barra de
// deshacer. No leen datos, no escriben nada y no importan ui.jsx, datos.js ni la base local: solo reciben textos y funciones.
// Las usan la consola del prototipo (Consola.jsx, con sus escrituras locales) y la pantalla de puntuación compartida
// (ControlPartido.jsx, que solo actúa a través del controlador del servidor). Las dos dibujan lo mismo; lo que hace cada botón
// lo decide quien las usa.
// ---------------------------------------------------------------------------

// Paneles de acciones del baloncesto (el orden y los nombres del original). Solo «Puntos» guarda algo en el prototipo; los otros dos son de prueba.
export const PANELES = [
  { id: 'puntos', nombre: 'Puntos' },
  { id: 'estadisticas', nombre: 'Estadísticas' },
  { id: 'defensa', nombre: 'Defensa' },
]

/**
 * Marcador y reloj. `local`/`visita`: { puntos, etiqueta, faltas, aria?, faltasTexto? }.
 * `faltas` null = no se muestran las faltas de equipo (categoría Baby); `faltasTexto` cambia la palabra (p. ej. «faltas del período»).
 */
export function CabeceraConsola({ local, visita, periodoTexto, relojTexto, anda, final, ariaReloj }) {
  return (
    <div className="cabecera">
      <div>
        <div className="puntos" aria-label={local.aria}>{local.puntos}</div>
        <div className="corto">{local.etiqueta}{local.faltas === null ? '' : ` · ${local.faltas} ${local.faltasTexto ?? 'faltas'}`}</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div className="periodo-etiqueta">{periodoTexto}</div>
        <div className={`reloj-consola ${anda ? 'anda' : ''}`} aria-label={ariaReloj}>{relojTexto}</div>
        {final && <div className="insignia-final">Partido finalizado</div>}
      </div>
      <div>
        <div className="puntos" aria-label={visita.aria}>{visita.puntos}</div>
        <div className="corto">{visita.etiqueta}{visita.faltas === null ? '' : ` · ${visita.faltas} ${visita.faltasTexto ?? 'faltas'}`}</div>
      </div>
    </div>
  )
}

/**
 * Panel del reloj. `extras`: nodo entre el botón y «siguiente periodo» (la corrección del reloj, solo en el modo compartido).
 * `siguiente`: { texto, destacado, alPulsar, deshabilitado } o null; `fin`: texto cuando se acabó el último periodo, o null.
 */
export function PanelReloj({ anda, deshabilitado, alAlternar, extras = null, siguiente = null, fin = null }) {
  return (
    <div className="reloj-panel">
      <div className="fila">
        <button type="button" className={`btn-reloj ${anda ? 'parar' : ''}`} onClick={alAlternar} disabled={deshabilitado}>
          {anda ? '❚❚  Detener' : '▶  Arrancar'}
        </button>
      </div>
      {extras}
      {siguiente && (
        <button type="button" className={siguiente.destacado ? 'btn' : 'btn fantasma'} onClick={siguiente.alPulsar} disabled={siguiente.deshabilitado}>
          {siguiente.texto}
        </button>
      )}
      {fin && <div className="aviso">{fin}</div>}
    </div>
  )
}

/** Selector de equipo. `lados`: [{ clave, equipo (para el escudo), nombre, activo, color, deshabilitado }]. */
export function SelectorLados({ lados, alElegir, Escudo }) {
  return (
    <div className="selector">
      {lados.map((l) => (
        <button
          type="button"
          key={l.clave}
          className={l.activo ? 'activo' : ''}
          style={l.activo && l.color ? { background: l.color } : undefined}
          aria-pressed={l.activo}
          disabled={l.deshabilitado}
          onClick={() => alElegir(l.clave)}
        >
          {l.equipo && <Escudo equipo={l.equipo} size="sm" />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.nombre}</span>
          {l.activo && <span aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * Barra de paneles de acciones. `noDisponibles`: ids de paneles que esta pantalla NO ofrece: se ven (el diseño es el mismo), están
 * desactivados y dicen por qué en `motivoNoDisponible`; nunca simulan guardar nada.
 */
export function PanelesBarra({ paneles, activo, alElegir, textoPrototipo = null, noDisponibles = [], motivoNoDisponible = null }) {
  return (
    <div className="paneles-barra">
      <div className="paneles" role="tablist" aria-label="Panel de acciones">
        {paneles.map((p) => {
          const no = noDisponibles.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`panel-tab-${p.id}`}
              aria-selected={activo === p.id}
              aria-controls="panel-plantel"
              aria-disabled={no || undefined}
              disabled={no}
              title={no ? motivoNoDisponible ?? undefined : undefined}
              className={activo === p.id ? 'activo' : ''}
              onClick={() => alElegir(p.id)}
            >
              {activo === p.id && <span aria-hidden="true">✓ </span>}
              {p.nombre}
            </button>
          )
        })}
      </div>
      {textoPrototipo && activo !== 'puntos' && <div className="paneles-proto">{textoPrototipo}</div>}
    </div>
  )
}

/** Botones de puntos y falta de una fila. */
export function BotonesPuntos({ valores, alAnotar, alFaltar, deshabilitadoPunto, deshabilitadoFalta, ariaPunto, ariaFalta }) {
  return (
    <div className="anota" style={{ '--cols': valores.length + 1 }}>
      {valores.map((v) => (
        <button type="button" key={v} onClick={() => alAnotar(v)} disabled={deshabilitadoPunto?.(v)} aria-label={ariaPunto(v)}>
          +{v}
        </button>
      ))}
      <button type="button" className="falta" onClick={alFaltar} disabled={deshabilitadoFalta} aria-label={ariaFalta}>
        F
      </button>
    </div>
  )
}

/** Fila de un jugador: dorsal, nombre, suma de puntos y faltas, y sus botones (`hijos`). */
export function FilaJugadorConsola({ dorsal, nombre, suma, expulsado, hijos, datos }) {
  return (
    <div className={`jugador-fila ${expulsado ? 'expulsado' : ''}`} {...datos}>
      <div className="identidad">
        <div className="dorsal">{dorsal}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nombre">{nombre}</div>
          <div className="suma">{suma}</div>
        </div>
      </div>
      {hijos}
    </div>
  )
}

/** Últimas acciones. `recientes`: [{ id, tipo, puntos, anulado, quien, estado (nodo opcional), alAnular, deshabilitado }]. */
export function RegistroConsola({ recientes, nota }) {
  return (
    <div>
      <h2 className="seccion" style={{ marginTop: 4 }}>Últimas acciones</h2>
      <div className="registro">
        {recientes.map((e) => (
          <div key={e.id} className={`ev ${e.anulado ? 'anulado' : ''}`} data-evento={e.id}>
            <span className={`mas ${e.tipo === 'falta' ? 'falta' : ''}`}>
              {e.tipo === 'falta' ? 'F' : `+${e.puntos}`}
            </span>
            <span className="quien">{e.quien}</span>
            {e.estado}
            {e.anulado ? (
              <span className="pill">anulado</span>
            ) : (
              <button type="button" className="pill" disabled={e.deshabilitado} onClick={e.alAnular}>anular</button>
            )}
          </div>
        ))}
        {!recientes.length && <div className="sub">Todavía no hay acciones.</div>}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{nota}</p>
    </div>
  )
}

/** Barra de deshacer y rehacer, pegada abajo. */
export function BarraDeshacer({ alDeshacer, alRehacer, puedeRehacer, deshabilitado = false }) {
  return (
    <div className="barra-deshacer">
      <button type="button" className="btn sutil" disabled={deshabilitado} onClick={alDeshacer}>↺ Deshacer</button>
      <button type="button" className="btn sutil" disabled={deshabilitado || !puedeRehacer} onClick={alRehacer}>↻ Rehacer</button>
    </div>
  )
}
