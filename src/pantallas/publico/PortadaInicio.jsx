import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { etiquetaCategoria } from '../../lib/categorias.js'

// ---------------------------------------------------------------------------
// La portada ORIGINAL (Inicio) como presentación pura: encabezado, filtros, «Ahora mismo», «Próximos partidos», ligas, figuras,
// buscador y espacio patrocinado, en el orden de siempre y con las mismas clases. No lee datos: la usan DOS contenedores,
// el del prototipo (pantallas/Inicio.jsx, datos locales) y el compartido (InicioCompartido.jsx, lecturas públicas del
// servidor). Lo que depende del origen de los datos entra por propiedades: los enlaces (`enlaces`), las piezas visuales del
// prototipo (`ui`: Escudo, Vacio, textoDorsal) y los nodos de cada sección. No importa ui.jsx, datos.js ni la base local.
// ---------------------------------------------------------------------------

const DEPORTES = [
  ['todos', 'Todos'],
  ['baloncesto', 'Baloncesto'],
  ['futsal', 'Fútbol sala'],
]

const Banner = () => (
  <div className="banner">
    <div className="marca-patro">TU<br />LOGO</div>
    <div className="texto">
      <span className="etiqueta">Espacio patrocinado</span>
      <strong>Un aviso pequeño, del negocio de la esquina.</strong>
      Nunca sobre el marcador ni encima del partido.
    </div>
  </div>
)

const etiquetaDeporte = (d) => (d === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala')

/**
 * Props:
 *   marca            nodo de la barra superior
 *   hayLigas         ¿hay ligas del contexto? Si no, `vacioLigas` (o el texto original) ocupa el lugar del cuerpo
 *   totales          { ligas, provincias, canchas }; un total `null` no se muestra (nunca se inventa lo que no se sabe)
 *   filtros          { provincias, categorias, deportes?, region: { provincia, deporte, categoria }, cambiarProvincia, cambiarDeporte, cambiarCategoria }
 *   aviso            nodo opcional sobre las secciones (por ejemplo, una lectura que falló)
 *   ahora, viene     { nodo } (+ `cuenta` en `ahora`, `dominante` en `viene`)
 *   categoriaLink    { deporte, categoria } o null
 *   ligas            nodo de «Ligas cerca de ti»;  figuras, buscador: nodos
 *   claseRaiz        clase extra de la raíz (el modo compartido usa «publico»);  pie: nodo al final (frescura de los datos)
 */
export default function PortadaInicio({ claseRaiz = '', pie = null, marca, hayLigas, vacioLigas = null, totales, filtros, aviso = null, ahora, viene, categoriaLink = null, ligas, figuras, buscador }) {
  const { provincias, categorias, region, cambiarProvincia, cambiarDeporte, cambiarCategoria } = filtros
  const deportes = filtros.deportes ?? DEPORTES
  const provincia = region.provincia || 'todas'
  const deporte = region.deporte || 'todos'
  const categoria = region.categoria || 'todas'

  return (
    <div className={`home ${claseRaiz}`.trim()}>
      {marca}

      {/* Encabezado compacto: presenta el producto en una línea y una frase, no una portada de marketing. */}
      <section className="hm-hero">
        <h1 className="hm-hero-titulo">El barrio también tiene <em>estadísticas</em>.</h1>
        <p className="hm-hero-sub">
          Ligas de calle, canchas de tierra y torneos que nadie anotaba. Aquí se arma el
          calendario, se lleva el marcador desde el teléfono y todo se comparte con un link.
          Sin instalar nada, sin cuenta para mirar.
        </p>
        <div className="hm-hero-cifras">
          {[
            [totales.ligas, 'liga', 'ligas'],
            [totales.provincias, 'provincia', 'provincias'],
            [totales.canchas, 'cancha', 'canchas'],
          ].filter(([n]) => n !== null && n !== undefined).map(([n, uno, varios], i) => (
            <Fragment key={uno}>
              {i > 0 && <span className="hm-cifra-sep" aria-hidden="true">·</span>}
              <span className="hm-cifra"><b>{n}</b> {n === 1 ? uno : varios}</span>
            </Fragment>
          ))}
        </div>
      </section>

      {aviso}

      {!hayLigas ? (
        <>
          {/* Sin ligas, esto es lo único que hay que leer: va primero, con su propia tarjeta. */}
          {vacioLigas ?? (
            <div className="hm-vacio-liga">
              <p className="hm-vacio-liga-titulo">Todavía no hay ligas por aquí.</p>
              <p className="hm-vacio-liga-sub">Si organizas una, puedes ser la primera.</p>
            </div>
          )}
          <Banner />
        </>
      ) : (
        <>
          <div className="hm-filtros">
            {provincias.length > 1 && (
              <div className="hm-scroll">
                <button className={`hm-chip ${provincia === 'todas' ? 'on' : ''}`} onClick={() => cambiarProvincia('todas')}>
                  Todas las provincias
                </button>
                {provincias.map((p) => (
                  <button key={p} className={`hm-chip ${provincia === p ? 'on' : ''}`} onClick={() => cambiarProvincia(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}

            {deportes.length > 1 && (
              <div className="hm-segmento" role="tablist" aria-label="Deporte">
                {deportes.map(([k, etiqueta]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={deporte === k}
                    className={`hm-segmento-btn ${deporte === k ? 'on' : ''}`}
                    onClick={() => cambiarDeporte(k)}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            )}

            {categorias.length > 1 && (
              <div className="hm-scroll">
                <button className={`hm-chip ${categoria === 'todas' ? 'on' : ''}`} onClick={() => cambiarCategoria('todas')}>
                  Toda edad
                </button>
                {categorias.map((c) => (
                  <button key={c} className={`hm-chip ${categoria === c ? 'on' : ''}`} onClick={() => cambiarCategoria(c)}>
                    {etiquetaCategoria(c)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Un solo flujo vertical, igual en escritorio que en móvil. hm-reja/hm-principal/hm-costado son solo ganchos de agrupación. */}
          <div className="hm-reja">
            <div className="hm-principal">
              {/* Las dos secciones se muestran siempre, una debajo de la otra. Ahora mismo domina cuando hay partidos en vivo; si no
                  hay ninguno, Próximos partidos pasa a ser la región dominante. */}
              <section className="hm-seccion-ahora">
                <h2 className="hm-titulo-vivo">
                  Ahora mismo
                  {ahora.cuenta > 0 && <span className="hm-cuenta-vivo">{ahora.cuenta}</span>}
                </h2>
                {ahora.nodo}
              </section>

              <section className={`hm-seccion-viene ${viene.dominante ? 'dominante' : ''}`}>
                <h2 className="hm-titulo-viene">Próximos partidos</h2>
                {viene.nodo}
              </section>

              {categoriaLink && (
                <Link to={`/cat/${categoriaLink.deporte}/${encodeURIComponent(categoriaLink.categoria)}`} className="card destacado-link">
                  <div className="fila-liga">
                    <div className="info">
                      <div className="nombre">{etiquetaCategoria(categoriaLink.categoria)} en otros países</div>
                      <div className="sub" style={{ marginTop: 2 }}>
                        Tu categoría no existe solo aquí. Mira quiénes juegan al otro lado.
                      </div>
                    </div>
                    <span className="chev">→</span>
                  </div>
                </Link>
              )}

              {ligas}
            </div>

            <aside className="hm-costado">
              {figuras}
              {buscador}
              {/* Después de Ahora mismo, Próximos partidos y el descubrimiento: nunca antes. */}
              <Banner />
            </aside>
          </div>
        </>
      )}
      {pie}
    </div>
  )
}

/**
 * Las ligas del contexto actual, sueltas de Buscador. `nota` (opcional) aclara de dónde salen; el detalle de cada fila solo
 * incluye lo que se sabe (provincia, deporte, quién organiza, clasificación): nada se inventa.
 */
export function LigasCercaDeTi({ ligas, verTodas, alternarTodas, enlaces, nota = null }) {
  if (!ligas.length) return null
  const visibles = verTodas ? ligas : ligas.slice(0, 5)

  return (
    <section className="hm-ligas-cerca">
      <div className="hm-ligas-cerca-cabeza">
        <h2 className="seccion">Ligas cerca de ti</h2>
        <span className="sub">{ligas.length} {ligas.length === 1 ? 'liga' : 'ligas'}</span>
      </div>
      {nota && <p className="sub" style={{ marginTop: -6, marginBottom: 10 }}>{nota}</p>}

      <div className="lista">
        {visibles.map((l) => (
          <Link key={l.id} to={enlaces.liga(l)} className="jugador-fila">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nombre" style={{ fontWeight: 600 }}>{l.nombre}</div>
              <div className="sub" style={{ fontSize: '0.74rem' }}>
                {[l.provincia, etiquetaDeporte(l.deporte), l.clasificacion, l.organizador ? `organiza ${l.organizador}` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {ligas.length > 5 && (
        <button className="btn fantasma" style={{ marginTop: 10 }} onClick={alternarTodas}>
          {verTodas ? 'Ocultar ligas' : `Ver ${ligas.length - 5} ${ligas.length - 5 === 1 ? 'liga' : 'ligas'} más`}
        </button>
      )}
    </section>
  )
}

/**
 * Las figuras, con los tres primeros a la vista. `pendiente` (texto) sustituye a la lista cuando esta sección todavía no tiene
 * datos reales detrás: se ve el título y el motivo, nunca una clasificación inventada.
 */
export function Podio({ figuras, pendiente = null, enlaces, ui }) {
  if (pendiente) {
    return (
      <section className="hm-figuras">
        <h2 className="seccion">Figuras del barrio</h2>
        <div className="vacio">{pendiente}</div>
      </section>
    )
  }
  if (!figuras?.anotadores?.length) return null
  const tres = figuras.anotadores.slice(0, 3)
  const { Escudo } = ui

  return (
    <section className="hm-figuras">
      <h2 className="seccion">Figuras del barrio</h2>
      <p className="sub" style={{ marginTop: -6, marginBottom: 10 }}>
        Los que más anotan, cruzando todas las ligas de la zona.
      </p>

      <div className="podio">
        {tres.map((f, i) => (
          <Link key={f.jugador.id} to={enlaces.jugador(f.jugador)} className={`escalon p${i + 1}`}>
            <span className="puesto">{i + 1}</span>
            <Escudo equipo={f.equipo} />
            <span className="quien">
              {f.jugador.nombre}
              <span className="equipo-nombre">{f.equipo.nombre}</span>
            </span>
            <span className="escalon-valor">
              <span className="cifra">{f.promedio.toFixed(1)}</span>
              <span className="unidad">por juego</span>
            </span>
          </Link>
        ))}
      </div>

      <Link to="/figuras" className="btn fantasma" style={{ marginTop: 10 }}>
        Ver la tabla completa
      </Link>
    </section>
  )
}

/**
 * Buscar, en vez de una lista larga. `alcance` (opcional) dice qué se puede buscar cuando no es todo; `placeholder` y `aria`
 * se ajustan a eso. Los jugadores solo se buscan si el contenedor los entrega.
 */
export function Buscador({ texto, alEscribir, ligas, equipos, jugadores, ligasPorId, enlaces, ui, alcance = null, placeholder = 'Tu liga, tu equipo o tu nombre', aria = 'Buscar liga, equipo o jugador' }) {
  const { Escudo, Vacio, textoDorsal } = ui
  const q = texto.trim().toLowerCase()
  const coincide = (n) => n?.toLowerCase().includes(q)
  const ligaIds = new Set(ligas.map((l) => l.id))

  const hallazgos = q.length >= 2
    ? {
        ligas: ligas.filter((l) => coincide(l.nombre)).slice(0, 5),
        equipos: equipos.filter((e) => ligaIds.has(e.ligaId) && coincide(e.nombre)).slice(0, 6),
        jugadores: jugadores.filter((j) => ligaIds.has(j.ligaId) && coincide(j.nombre)).slice(0, 6),
      }
    : null

  const nada = hallazgos && !hallazgos.ligas.length && !hallazgos.equipos.length && !hallazgos.jugadores.length

  return (
    <section className="hm-buscador">
      <h2 className="seccion">Encuentra lo tuyo</h2>
      <div className="campo" style={{ marginBottom: 10 }}>
        <input type="search" value={texto} onChange={(e) => alEscribir(e.target.value)} placeholder={placeholder} aria-label={aria} />
      </div>
      {alcance && <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>{alcance}</p>}

      {hallazgos && (
        <div className="lista">
          {hallazgos.equipos.map((e) => (
            <Link key={`${e.ligaId}:${e.id}`} to={enlaces.equipo(e)} className="jugador-fila">
              <Escudo equipo={e} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{e.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>Equipo · {ligasPorId[e.ligaId]?.nombre}</div>
              </div>
            </Link>
          ))}
          {hallazgos.jugadores.map((j) => (
            <Link key={j.id} to={enlaces.jugador(j)} className="jugador-fila">
              <div className="dorsal">{textoDorsal(j)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{j.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>Jugador · {ligasPorId[j.ligaId]?.nombre}</div>
              </div>
            </Link>
          ))}
          {hallazgos.ligas.map((l) => (
            <Link key={l.id} to={enlaces.liga(l)} className="jugador-fila">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{l.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>{['Liga', l.provincia].filter(Boolean).join(' · ')}</div>
              </div>
            </Link>
          ))}
          {nada && <Vacio>No encontramos nada con «{texto}».</Vacio>}
        </div>
      )}
    </section>
  )
}
