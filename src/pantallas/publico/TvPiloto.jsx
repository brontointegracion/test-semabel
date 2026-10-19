import { useEffect, useMemo, useRef } from 'react'
import { frescura, useMono, useRecurso } from '../../lib/publico/hooks.js'
import { ligasConfiguradas } from '../../lib/publico/config.js'
import { partidosDe, pendienteDeComenzar } from '../../lib/publico/agrupar.js'
import { claveDiaPanama, diaRelativoPanama, fechaCortaPanama, horaPanama } from '../../lib/publico/formato.js'
import { PERIODO_CATALOGO_MS, recursoLiga } from '../../lib/publico/recursos.js'
import { ahoraServidor } from '../../lib/publico/reloj-servidor.js'
import { TV_PILOTO } from '../../lib/publico/tv-piloto.js'
import { Cargando, EnlaceConOrigen, MarcaPublica, PieFrescura, textoDeError } from './componentes.jsx'
import './publico.css'

// ---------------------------------------------------------------------------
// /tv: entrada pública corta del piloto (REPORT_186; temporal, ver lib/publico/tv-piloto.js). Lista los partidos de UNA liga configurada,
// agrupados por día de Panamá, como enlaces grandes. Cada enlace abre el marcador público EXISTENTE por su dirección canónica
// (pantalla completa y pantalla encendida son los de PartidoPublico). Sin sesión, sin código, sin permisos y sin lecturas privadas.
// NO elige ni cambia de partido por la hora: el estado que se rotula sale del servidor y la hora solo ordena. Se actualiza con la misma
// cadencia del catálogo público (60 s mientras la pestaña se ve).
// ---------------------------------------------------------------------------

const ESTADOS = { programado: 'Por jugar', vivo: 'En vivo', final: 'Final' }
const instante = (p) => (p.programadoPara !== null ? Date.parse(p.programadoPara) : Infinity)

function Mensaje({ children, titulo }) {
  return (
    <div className="publico tv-pagina">
      <MarcaPublica />
      <main className="tv-contenido">
        <h1 className="tv-titulo">{titulo}</h1>
        {children}
      </main>
    </div>
  )
}

export default function TvPiloto() {
  const config = useMemo(() => ligasConfiguradas(), [])
  const ligaId = TV_PILOTO.ligaId
  // Solo se lee la liga del piloto y solo si la compilación la lista (la misma regla del resto de pantallas públicas).
  const configurada = config.ok && config.ids.includes(ligaId)
  const def = useMemo(() => (configurada ? recursoLiga(ligaId) : null), [configurada, ligaId])
  const estado = useRecurso(def)
  const { mono, saltoMono } = useMono({ activo: configurada })
  const primero = useRef(null)
  const hayDatos = estado.datos !== null

  useEffect(() => {
    const anterior = document.title
    document.title = 'Partidos en TV · semabel.com'
    return () => { document.title = anterior }
  }, [])

  // Con el mando a distancia, el foco debe empezar en un partido: se enfoca el primero cuando la lista aparece por primera vez.
  useEffect(() => { if (hayDatos) primero.current?.focus() }, [hayDatos])

  const partidos = useMemo(() => partidosDe([estado]), [estado])

  if (!configurada) {
    return (
      <Mensaje titulo="Partidos en TV">
        <div className="aviso" role="status">Esta entrada no está disponible en esta versión de Sebel.</div>
      </Mensaje>
    )
  }
  if (!estado.datos) {
    if (estado.fase === 'no-encontrado') {
      return <Mensaje titulo="Partidos en TV"><div className="aviso" role="status">Esta liga todavía no está cargada en el servidor.</div></Mensaje>
    }
    return (
      <Mensaje titulo="Partidos en TV">
        {estado.fase === 'cargando' ? <Cargando>Cargando los partidos…</Cargando> : <div className="aviso" role="status">{textoDeError(estado)}</div>}
      </Mensaje>
    )
  }

  const ordenados = [...partidos].sort((a, b) => (instante(a) === instante(b) ? (a.gameId < b.gameId ? -1 : 1) : instante(a) < instante(b) ? -1 : 1))
  const grupos = []
  for (const p of ordenados) {
    const clave = p.programadoPara ? claveDiaPanama(p.programadoPara) : 'sin-fecha'
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.clave === clave) ultimo.partidos.push(p)
    else grupos.push({ clave, partidos: [p] })
  }
  const ahora = (p) => (p.muestra ? ahoraServidor(p.muestra, mono) : null)
  const etiquetaDia = (g) => {
    const p = g.partidos[0]
    if (!p.programadoPara) return 'Fecha por confirmar'
    const relativo = diaRelativoPanama(p.programadoPara, ahora(p) ?? Date.parse(p.programadoPara))
    const absoluto = fechaCortaPanama(p.programadoPara)
    return relativo === absoluto ? absoluto : `${relativo} · ${absoluto}`
  }
  let n = 0

  return (
    <div className="publico tv-pagina">
      <MarcaPublica />
      <main className="tv-contenido">
        <h1 className="tv-titulo">Partidos en TV</h1>
        <p className="tv-sub">Elige un partido para verlo en pantalla grande.</p>
        {grupos.length === 0 && <div className="vacio" role="status">Esta liga no tiene partidos programados todavía.</div>}
        {grupos.map((g) => (
          <section key={g.clave} className="tv-grupo" aria-label={etiquetaDia(g)}>
            <h2 className="tv-dia">{etiquetaDia(g)}</h2>
            <ul className="tv-lista">
              {g.partidos.map((p) => {
                const ref = n === 0 ? primero : null
                n += 1
                return (
                  <li key={p.gameId}>
                    <EnlaceConOrigen ref={ref} to={p.urlPartido} className={`tv-juego ${p.estado}`}>
                      <span className="tv-liga">{p.ligaNombre}</span>
                      <span className="tv-equipos">{p.local.nombre}<i> vs </i>{p.visita.nombre}</span>
                      <span className="tv-hora">{p.programadoPara ? horaPanama(p.programadoPara) : '—'}</span>
                      <span className="tv-estado">
                        {ESTADOS[p.estado]}
                        {p.estado !== 'programado' && ` · ${p.local.puntos}–${p.visita.puntos}`}
                        {pendienteDeComenzar(p, mono) && ' · Pendiente de comenzar'}
                      </span>
                    </EnlaceConOrigen>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        <PieFrescura estado={estado} mono={mono} periodoMs={PERIODO_CATALOGO_MS} saltoMono={saltoMono} className="tv-sub" />
      </main>
    </div>
  )
}
