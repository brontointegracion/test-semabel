import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDescubrir, useRegion, useFiguras, visibleEn } from '../datos'
import { marcadorEquipo } from '../lib/marcador'
import { cambiarProvincia, cambiarDeporte, cambiarCategoria } from '../lib/region'
import { Marca, Escudo, Vacio, RelojVivo, diaRelativo, hora, fechaCorta, mismoDia } from '../ui'
import { urlLiga, urlPartido, urlEquipo, urlJugador } from '../lib/enlaces'
import { useMeta } from '../lib/meta'

const DEPORTES = [
  ['todos', 'Todos'],
  ['baloncesto', 'Baloncesto'],
  ['futsal', 'Fútbol sala'],
]

export default function Inicio() {
  const d = useDescubrir()
  const region = useRegion()
  const [busca, setBusca] = useState('')
  const [verTodas, setVerTodas] = useState(false)
  const figuras = useFiguras()

  const categorias = useMemo(
    () => [...new Set((d?.ligas || []).filter((l) => !l.esTorneo).map((l) => l.categoria || 'Libre'))]
      .filter((c) => c !== 'Libre')
      .sort(),
    [d],
  )

  const provincias = useMemo(() => {
    if (!d || !region) return []
    return [...new Set(d.ligas.filter((l) => l.pais === region.pais).map((l) => l.provincia))].sort()
  }, [d, region])

  useMeta({
    titulo: 'Ligas de barrio: resultados en vivo y calendario',
    descripcion:
      'Sigue las ligas de baloncesto y fútbol sala de tu provincia: marcador en vivo, ' +
      'tabla de posiciones, calendario y estadísticas de cada jugador.',
  })

  if (!d || !region) return null

  const { ligas, ligasPorId, equipos, canchas, vivos, proximos, eventosPorPartido,
          listaEquipos, listaJugadores } = d
  // Provincia y deporte se recuerdan: quien viene por el baloncesto de Chiriquí
  // vuelve al baloncesto de Chiriquí sin tener que elegirlo otra vez.
  const provincia = region.provincia || 'todas'
  const deporte = region.deporte || 'todos'

  // El sitio está restringido al país de quien mira: nada de otro país entra aquí.
  const delPais = ligas.filter((l) => l.pais === region.pais)

  const categoria = region.categoria || 'todas'

  const pasaLiga = (liga) => {
    if (!liga) return false
    // Los torneos internacionales se ven desde los países que juegan en ellos.
    if (!visibleEn(liga, region.pais)) return false
    if (deporte !== 'todos' && liga.deporte !== deporte) return false
    if (provincia !== 'todas' && liga.provincia !== provincia && !liga.internacional) return false
    if (categoria !== 'todas' && liga.categoria !== categoria) return false
    return true
  }

  const pasa = (p) => pasaLiga(ligasPorId[p.ligaId])

  const vivosF = vivos.filter(pasa)
  const proximosF = proximos.filter(pasa).slice(0, 20)
  const ligasF = ligas.filter(pasaLiga)

  const totales = {
    ligas: delPais.length,
    canchas: new Set(delPais.flatMap((l) => l.canchaIds)).size,
    provincias: new Set(delPais.map((l) => l.provincia)).size,
  }

  return (
    <div className="home">
      <Marca />

      {/* Encabezado compacto: presenta el producto en una línea y una frase,
          no una portada de marketing. Los totales siguen siendo los reales
          de useDescubrir(), solo cambia cómo se muestran. */}
      <section className="hm-hero">
        <h1 className="hm-hero-titulo">El barrio también tiene <em>estadísticas</em>.</h1>
        <p className="hm-hero-sub">
          Ligas de calle, canchas de tierra y torneos que nadie anotaba. Aquí se arma el
          calendario, se lleva el marcador desde el teléfono y todo se comparte con un link.
          Sin instalar nada, sin cuenta para mirar.
        </p>
        <div className="hm-hero-cifras">
          <span className="hm-cifra">
            <b>{totales.ligas}</b> {totales.ligas === 1 ? 'liga' : 'ligas'}
          </span>
          <span className="hm-cifra-sep" aria-hidden="true">·</span>
          <span className="hm-cifra">
            <b>{totales.provincias}</b> {totales.provincias === 1 ? 'provincia' : 'provincias'}
          </span>
          <span className="hm-cifra-sep" aria-hidden="true">·</span>
          <span className="hm-cifra">
            <b>{totales.canchas}</b> {totales.canchas === 1 ? 'cancha' : 'canchas'}
          </span>
        </div>
      </section>

      <div className="banner">
        <div className="marca-patro">TU<br />LOGO</div>
        <div className="texto">
          <span className="etiqueta">Espacio patrocinado</span>
          <strong>Un aviso pequeño, del negocio de la esquina.</strong>
          Nunca sobre el marcador ni encima del partido.
        </div>
      </div>

      {!delPais.length ? (
        <Vacio>
          Todavía no hay ligas por aquí.<br />
          Si organizas una, puedes ser la primera.
        </Vacio>
      ) : (
        <>
          <div className="hm-filtros">
            {provincias.length > 1 && (
              <div className="hm-scroll">
                <button
                  className={`hm-chip ${provincia === 'todas' ? 'on' : ''}`}
                  onClick={() => cambiarProvincia('todas')}
                >
                  Todas las provincias
                </button>
                {provincias.map((p) => (
                  <button
                    key={p}
                    className={`hm-chip ${provincia === p ? 'on' : ''}`}
                    onClick={() => cambiarProvincia(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <div className="hm-segmento" role="tablist" aria-label="Deporte">
              {DEPORTES.map(([k, etiqueta]) => (
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

            {categorias.length > 1 && (
              <div className="hm-scroll">
                <button
                  className={`hm-chip ${categoria === 'todas' ? 'on' : ''}`}
                  onClick={() => cambiarCategoria('todas')}
                >
                  Toda edad
                </button>
                {categorias.map((c) => (
                  <button
                    key={c}
                    className={`hm-chip ${categoria === c ? 'on' : ''}`}
                    onClick={() => cambiarCategoria(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Escritorio: dos columnas. En móvil, hm-reja/hm-principal/hm-costado
              no llevan estilo propio, así que esto se apila exactamente igual
              que antes — el espaciado sigue viniendo de los márgenes de cada
              componente, no de este contenedor. */}
          <div className="hm-reja">
            <div className="hm-principal">
              {/* Las dos secciones se muestran siempre, una debajo de la otra.
                  Ahora mismo domina cuando hay partidos en vivo; si no hay
                  ninguno, Lo que viene pasa a ser la región dominante — su
                  título cambia de peso, el contenido es el mismo de siempre. */}
              <section className="hm-seccion-ahora">
                <h2 className="hm-titulo-vivo">
                  Ahora mismo
                  {vivosF.length > 0 && <span className="hm-cuenta-vivo">{vivosF.length}</span>}
                </h2>
                <Ahora partidos={vivosF} equipos={equipos} canchas={canchas} ligas={ligasPorId} eventos={eventosPorPartido} />
              </section>

              <section className={`hm-seccion-viene ${vivosF.length === 0 ? 'dominante' : ''}`}>
                <h2 className="hm-titulo-viene">Lo que viene</h2>
                <Viene partidos={proximosF} equipos={equipos} canchas={canchas} />
              </section>

              {categoria !== 'todas' && deporte !== 'todos' && (
                <Link to={`/cat/${deporte}/${encodeURIComponent(categoria)}`} className="card destacado-link">
                  <div className="fila-liga">
                    <div className="info">
                      <div className="nombre">{categoria} en otros países</div>
                      <div className="sub" style={{ marginTop: 2 }}>
                        Tu categoría no existe solo aquí. Mira quiénes juegan al otro lado.
                      </div>
                    </div>
                    <span className="chev">→</span>
                  </div>
                </Link>
              )}
            </div>

            <aside className="hm-costado">
              <Podio figuras={figuras} />

              <Buscador
                texto={busca}
                alEscribir={setBusca}
                ligas={ligasF}
                equipos={listaEquipos}
                jugadores={listaJugadores}
                ligasPorId={ligasPorId}
                verTodas={verTodas}
                alternarTodas={() => setVerTodas((v) => !v)}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

function Ahora({ partidos, equipos, canchas, ligas, eventos }) {
  if (!partidos.length) {
    return <Vacio>No hay partidos jugándose en este momento. Prueba «Lo que viene».</Vacio>
  }

  return (
    <div className={`hm-vivo-grid ${partidos.length > 1 ? 'varios' : ''}`}>
      {partidos.map((p) => {
        const evs = eventos[p.id] || []
        const local = equipos[p.localId]
        const visita = equipos[p.visitaId]
        // El marcador sigue siendo la suma de eventos reales, nunca un número
        // guardado. Solo se usa aquí para resaltar visualmente al que va
        // arriba — en un empate, ninguno de los dos se atenúa.
        const golesLocal = marcadorEquipo(evs, p.localId)
        const golesVisita = marcadorEquipo(evs, p.visitaId)
        const arriba = golesLocal === golesVisita ? null : golesLocal > golesVisita ? p.localId : p.visitaId

        return (
          <Link key={p.id} to={urlPartido(p, local, visita)} className="hm-marcador">
            <div className="hm-marcador-cabeza">
              <span className="hm-badge-vivo">
                <span className="hm-vivo-punto" aria-hidden="true" />
                En vivo
              </span>
              <RelojVivo partido={p} liga={ligas[p.ligaId]} eventos={evs} />
              <span className="hm-marcador-liga">{ligas[p.ligaId]?.nombre}</span>
            </div>

            <div className="hm-marcador-cuerpo">
              {[local, visita].map((eq) => {
                const goles = eq.id === p.localId ? golesLocal : golesVisita
                const pierde = arriba && eq.id !== arriba
                return (
                  <div key={eq.id} className={`hm-lado ${pierde ? 'pierde' : ''}`}>
                    <Escudo equipo={eq} size="sm" />
                    <span className="hm-lado-nombre">{eq.nombre}</span>
                    <span className="hm-tanteo">{goles}</span>
                  </div>
                )
              })}
            </div>

            <div className="hm-marcador-pie">{canchas[p.canchaId]?.nombre}</div>
          </Link>
        )
      })}
    </div>
  )
}

function Viene({ partidos, equipos, canchas }) {
  if (!partidos.length) return <Vacio>No hay partidos programados con ese filtro.</Vacio>

  let ultimo = null
  return (
    <div style={{ marginTop: 6 }}>
      {partidos.map((p) => {
        const nuevo = !ultimo || !mismoDia(ultimo, p.inicio)
        ultimo = p.inicio
        return (
          <div key={p.id}>
            {nuevo && <div className="dia-sep">{diaRelativo(p.inicio)} · {fechaCorta(p.inicio)}</div>}
            <Link to={urlPartido(p, equipos[p.localId], equipos[p.visitaId])} className="partido" style={{ marginBottom: 8 }}>
              <div className="cuando">
                <div className="hora">{hora(p.inicio)}</div>
                <div className="dia">{canchas[p.canchaId]?.barrio}</div>
              </div>
              <div className="enfrenta">
                <div className="lado">
                  <Escudo equipo={equipos[p.localId]} size="sm" />
                  <span className="nombre">{equipos[p.localId]?.nombre}</span>
                </div>
                <div className="lado">
                  <Escudo equipo={equipos[p.visitaId]} size="sm" />
                  <span className="nombre">{equipos[p.visitaId]?.nombre}</span>
                </div>
              </div>
            </Link>
          </div>
        )
      })}
    </div>
  )
}


/**
 * Las figuras, con los tres primeros a la vista.
 *
 * Antes esto era un link que prometía nombres. Ver tres nombres de verdad —con
 * su escudo y su promedio— es lo que hace que alguien toque: busca el suyo.
 */
function Podio({ figuras }) {
  if (!figuras?.anotadores?.length) return null
  const tres = figuras.anotadores.slice(0, 3)

  return (
    <>
      <h2 className="seccion">Figuras del barrio</h2>
      <p className="sub" style={{ marginTop: -6, marginBottom: 10 }}>
        Los que más anotan, cruzando todas las ligas de la zona.
      </p>

      <div className="podio">
        {tres.map((f, i) => (
          <Link key={f.jugador.id} to={urlJugador(f.jugador)} className={`escalon p${i + 1}`}>
            <span className="puesto">{i + 1}</span>
            <Escudo equipo={f.equipo} />
            <span className="quien">{f.jugador.nombre}</span>
            <span className="cifra">{f.promedio.toFixed(1)}</span>
            <span className="unidad">por juego</span>
          </Link>
        ))}
      </div>

      <Link to="/figuras" className="btn fantasma" style={{ marginTop: 10 }}>
        Ver la tabla completa
      </Link>
    </>
  )
}

/**
 * Buscar, en vez de una lista larga.
 *
 * La lista de ligas es navegación, no contenido: se usa una vez, para encontrar
 * la propia. Con seis ligas una lista funciona; con seiscientas, no. Buscar
 * escala y además encuentra equipos y jugadores, que es como la gente pregunta.
 */
function Buscador({ texto, alEscribir, ligas, equipos, jugadores, ligasPorId, verTodas, alternarTodas }) {
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
    <>
      <h2 className="seccion">Encuentra lo tuyo</h2>
      <div className="campo" style={{ marginBottom: 10 }}>
        <input
          type="search"
          value={texto}
          onChange={(e) => alEscribir(e.target.value)}
          placeholder="Tu liga, tu equipo o tu nombre"
          aria-label="Buscar liga, equipo o jugador"
        />
      </div>

      {hallazgos && (
        <div className="lista">
          {hallazgos.equipos.map((e) => (
            <Link key={e.id} to={urlEquipo(e)} className="jugador-fila">
              <Escudo equipo={e} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{e.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>Equipo · {ligasPorId[e.ligaId]?.nombre}</div>
              </div>
            </Link>
          ))}
          {hallazgos.jugadores.map((j) => (
            <Link key={j.id} to={urlJugador(j)} className="jugador-fila">
              <div className="dorsal">{j.dorsal}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{j.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>Jugador · {ligasPorId[j.ligaId]?.nombre}</div>
              </div>
            </Link>
          ))}
          {hallazgos.ligas.map((l) => (
            <Link key={l.id} to={urlLiga(l)} className="jugador-fila">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nombre" style={{ fontWeight: 600 }}>{l.nombre}</div>
                <div className="sub" style={{ fontSize: '0.74rem' }}>Liga · {l.provincia}</div>
              </div>
            </Link>
          ))}
          {nada && <Vacio>No encontramos nada con «{texto}».</Vacio>}
        </div>
      )}

      {!hallazgos && (
        <>
          <button className="btn fantasma" onClick={alternarTodas}>
            {verTodas ? 'Ocultar las ligas' : `Ver las ${ligas.length} ligas de la zona`}
          </button>
          {verTodas && (
            <div className="lista" style={{ marginTop: 10 }}>
              {ligas.map((l) => (
                <Link key={l.id} to={urlLiga(l)} className="jugador-fila">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nombre" style={{ fontWeight: 600 }}>{l.nombre}</div>
                    <div className="sub" style={{ fontSize: '0.74rem' }}>
                      {l.provincia} · {l.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala'} · organiza {l.organizador}
                    </div>
                  </div>
                </Link>
              ))}
              {!ligas.length && <Vacio>No hay ligas con ese filtro.</Vacio>}
            </div>
          )}
        </>
      )}
    </>
  )
}
