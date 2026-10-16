import { Fragment } from 'react'

// ---------------------------------------------------------------------------
// La página de LIGA ORIGINAL (pantallas/Liga.jsx) como presentación pura: tarjeta de cabecera, selector de pestañas (Posiciones,
// Calendario, Jugadores, en ese orden) y el marcado de la tabla y del calendario. No lee datos: la usan el prototipo (Liga.jsx, datos
// locales) y el modo compartido (LigaCompartida.jsx, lecturas públicas del servidor). Lo que depende del origen entra por propiedades:
// las piezas visuales del prototipo (`ui`: Escudo, Vacio, Enlace), los enlaces y los textos. No importa ui.jsx, datos.js ni la base local.
// ---------------------------------------------------------------------------

export const PESTANAS = [
  ['tabla', 'Posiciones'],
  ['calendario', 'Calendario'],
  ['jugadores', 'Jugadores'],
]

/**
 * Props:
 *   topbar       nodo de la barra superior
 *   cabecera     { nombre (opcional), deporteTexto, detalle (texto tras « · » o null para no ponerlo), pills: [{ acento, texto }],
 *                  compartir: { alPulsar, copiado }, retar (nodo o null) }
 *   retos        nodo opcional entre la tarjeta y las pestañas
 *   pestana, alCambiarPestana
 *   contenido    { tabla, calendario, jugadores }: el nodo de cada pestaña
 *   claseRaiz    si se da, la página va envuelta en un div con esa clase (el modo compartido usa «publico»); pie: nodo final
 */
export default function PaginaLiga({ topbar, cabecera, retos = null, pestana, alCambiarPestana, contenido, claseRaiz = null, pie = null }) {
  const Raiz = claseRaiz ? 'div' : Fragment
  const propsRaiz = claseRaiz ? { className: claseRaiz } : {}
  return (
    <Raiz {...propsRaiz}>
      {topbar}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Página pública de la liga</div>
        {/* El nombre real de la liga (solo el modo compartido lo pasa; el prototipo ya lo muestra en su barra superior). */}
        {cabecera.nombre && <h2 className="liga-nombre">{cabecera.nombre}</h2>}
        <div className="sub" style={{ marginTop: 6 }}>
          {cabecera.deporteTexto}
          {cabecera.detalle !== null && <>{' '}·{' '}{cabecera.detalle}</>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {cabecera.pills.map((p, i) => (
            <Fragment key={p.texto}>
              {i > 0 && ' '}
              <span className={`pill${p.acento ? ' acento' : ''}`}>{p.texto}</span>
            </Fragment>
          ))}
        </div>
        <div className="btn-fila" style={{ marginTop: 12 }}>
          <button className="btn" onClick={cabecera.compartir.alPulsar}>
            {cabecera.compartir.copiado ? 'Link copiado' : 'Compartir link'}
          </button>
          {cabecera.retar}
        </div>
        <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
          Quien abra el link ve la tabla, el calendario y el marcador en vivo. No necesita cuenta
          ni instalar nada.
        </p>
      </div>

      {retos}

      <div className="selector" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 16 }}>
        {PESTANAS.map(([k, etiqueta]) => (
          <button
            key={k}
            className={pestana === k ? 'activo' : ''}
            style={pestana === k ? { background: 'var(--acento)' } : undefined}
            onClick={() => alCambiarPestana(k)}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {contenido[pestana]}
      {pie}
    </Raiz>
  )
}

/**
 * Pestaña Posiciones. `filas`: salida de tablaDeResultados/tablaPosiciones; `jugados`: partidos finales; `enlaceEquipo(equipo)` → ruta;
 * `nota`: la explicación de dónde sale la tabla (depende del origen de los datos).
 */
export function TablaPosiciones({ filas, jugados, deporte, ui, enlaceEquipo, nota, vacioTexto = 'Todavía no se ha jugado ningún partido.', despuesDelVacio = null }) {
  const { Escudo, Vacio, Enlace } = ui
  if (!jugados) return <><Vacio>{vacioTexto}</Vacio>{despuesDelVacio}</>

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
              <th>{deporte === 'baloncesto' ? 'PF' : 'GF'}</th>
              <th>Fal</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.equipo.id}>
                <td>
                  <Enlace to={enlaceEquipo(f.equipo)} className="equipo-celda">
                    <span className="pos">{i + 1}</span>
                    <Escudo equipo={f.equipo} size="sm" />
                    <span className="nombre">{f.equipo.nombre}</span>
                  </Enlace>
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
      <p className="sub" style={{ marginTop: 10 }}>{nota}</p>
    </>
  )
}

/**
 * Pestaña Calendario. `filas`: [{ clave, separador (texto o null), href, vivo, dia, hora, final,
 *   local: { equipo, nombre, goles (o null), perdio }, visita: { … } }].
 */
export function CalendarioLista({ filas, ui }) {
  const { Escudo, Enlace } = ui
  return (
    <div style={{ marginTop: 8 }}>
      {filas.map((f) => (
        <div key={f.clave}>
          {f.separador && <div className="dia-sep">{f.separador}</div>}
          <Enlace to={f.href} className="partido" style={{ marginBottom: 8 }}>
            <div className="cuando">
              {f.vivo ? (
                <span className="pill vivo" style={{ fontSize: '0.58rem' }}>VIVO</span>
              ) : (
                <>
                  <div className="dia">{f.dia}</div>
                  <div className="hora">{f.hora}</div>
                </>
              )}
            </div>
            <div className="enfrenta">
              {[f.local, f.visita].map((l, i) => (
                <div key={i} className={`lado ${l.perdio ? 'perdio' : ''}`}>
                  <Escudo equipo={l.equipo} size="sm" />
                  <span className="nombre">{l.nombre}</span>
                  {l.goles !== null && <span className="goles">{l.goles}</span>}
                </div>
              ))}
              {f.final && <span className="insignia-final en-fila">Partido finalizado</span>}
            </div>
          </Enlace>
        </div>
      ))}
    </div>
  )
}
