import { useEffect, useMemo, useState } from 'react'
import { frescura, useMono, useRecursos } from '../../lib/publico/hooks.js'
import { ligasConfiguradas, paisPiloto } from '../../lib/publico/config.js'
import { clasificar } from '../../lib/publico/agrupar.js'
import { construirDescubrir } from '../../lib/publico/descubrir.js'
import { urlEquipoPublico } from '../../lib/publico/equipo.js'
import { PERIODO_CATALOGO_MS, recursoLiga } from '../../lib/publico/recursos.js'
import { urlLigaPublica } from '../../lib/publico/agrupar.js'
import { Cargando, EscudoTexto, PieFrescura, textoDeError } from './componentes.jsx'
import { MarcaNav } from './Navegacion.jsx'
import PortadaInicio, { Buscador, LigasCercaDeTi, Podio } from './PortadaInicio.jsx'
import { ListaProgramados, TarjetaVivo } from './tarjetas.jsx'
import EnPreparacionPublica from './EnPreparacionPublica.jsx'

// ---------------------------------------------------------------------------
// La portada ORIGINAL sobre las lecturas públicas del servidor (REPORT_152). Es el mismo diseño y el mismo orden que Inicio.jsx
// (PortadaInicio); cambia solo de dónde salen los datos. Solo hay datos reales del servidor: ni siembra de demostración ni registros
// locales. Cada sección distingue «cargando», «no se pudo cargar», «vacío verificado» y «todavía no disponible».
// ---------------------------------------------------------------------------

const ETIQUETA_DEPORTE = { baloncesto: 'Baloncesto', futsal: 'Fútbol sala' }
// «.marca» también nombra una insignia de 22 px en styles.css: la marca de las pantallas compartidas usa su propia clase (ver publico.css).
const MARCA = <div className="marca-publica">semabel<span>.</span>com</div>

const UI = {
  Escudo: ({ equipo, size = 'sm' }) => <EscudoTexto nombre={equipo?.nombre ?? ''} size={size || 'sm'} />,
  Vacio: ({ children }) => <div className="vacio">{children}</div>,
  textoDorsal: () => '',
}

export default function InicioCompartido({ tabs }) {
  const config = useMemo(() => ligasConfiguradas(), [])
  if (!config.ok || config.ids.length === 0) return <EnPreparacionPublica />
  return <Portada ids={config.ids} tabs={tabs} />
}

function Portada({ ids, tabs }) {
  const clave = ids.join(',')
  const defs = useMemo(() => ids.map(recursoLiga), [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  const estados = useRecursos(defs)
  const { mono, saltoMono } = useMono()
  const pais = useMemo(() => paisPiloto(), [])
  const [filtro, setFiltro] = useState({ provincia: 'todas', deporte: 'todos', categoria: 'todas' })
  const [busca, setBusca] = useState('')
  const [verTodas, setVerTodas] = useState(false)

  useEffect(() => {
    const anterior = document.title
    document.title = 'semabel.com · Resultados en vivo'
    return () => { document.title = anterior }
  }, [])

  const d = useMemo(() => construirDescubrir({ ids, estados, pais }), [clave, estados, pais]) // eslint-disable-line react-hooks/exhaustive-deps
  const cargadas = estados.filter((e) => e.datos)
  const confiables = new Map(cargadas.map((e) => [e.datos.liga.id, frescura(e, mono, { periodoMs: PERIODO_CATALOGO_MS, saltoMono }).relojConfiable]))

  const deportesPresentes = [...new Set(d.ligas.map((l) => l.deporte))].sort()
  const categorias = [...new Set(d.ligas.map((l) => l.categoria).filter(Boolean))].sort()
  const region = { pais, ...filtro }
  const pasaLiga = (l) => !!l && l.pais === pais
    && (filtro.deporte === 'todos' || l.deporte === filtro.deporte)
    && (filtro.categoria === 'todas' || l.categoria === filtro.categoria)
  const ligasF = d.ligas.filter(pasaLiga)
  const { vivos, proximos } = clasificar(d.partidos.filter((p) => pasaLiga(d.ligasPorId[p.ligaId])))
  const proximosF = proximos.slice(0, 20)

  const enlaces = {
    liga: (l) => urlLigaPublica(l.id),
    equipo: (e) => urlEquipoPublico(e.ligaId, e.id, d.idsPorLiga[e.ligaId]),
    jugador: () => '/', // no hay jugadores en la portada compartida
  }

  const hayLigas = d.ligas.length > 0
  const cargando = d.fase === 'cargando'
  const error = d.fase === 'error'
  const nombres = d.fallidas.join(', ')
  const primerError = estados.find((e) => !e.datos && e.fase !== 'cargando')
  const textoError = primerError ? textoDeError(primerError) : ''

  // Qué decir en cada sección según el estado real de las lecturas (nunca un vacío que no esté verificado).
  const parcial = d.fase === 'parcial'
  const aviso = (parcial && d.fallidas.length > 0)
    ? <div className="aviso" role="status">{`No se pudieron cargar todas las ligas (${nombres}). ${textoError}`}</div>
    : null
  const sinVerificar = parcial && !error // con una liga sin cargar, «no hay partidos» podría no ser cierto
  const nodoAhora = vivos.length > 0
    ? (
      <>
        <p className="nota-seccion">Los marcadores y relojes de esta lista se actualizan cada minuto; abre un partido para verlo al segundo.</p>
        <div className={`hm-vivo-grid ${vivos.length > 1 ? 'varios' : ''}`}>
          {vivos.map((p) => <TarjetaVivo key={`${p.ligaId}:${p.gameId}`} partido={p} mono={mono} relojConfiable={confiables.get(p.ligaId) === true} />)}
        </div>
      </>
    )
    : (sinVerificar
      ? <div className="vacio">Faltan ligas por cargar: todavía no sabemos si hay partidos jugándose.</div>
      : <div className="vacio">No hay partidos jugándose en este momento. Prueba «Lo que viene».</div>)
  const nodoViene = proximosF.length > 0
    ? <ListaProgramados partidos={proximosF} mono={mono} />
    : (sinVerificar
      ? <div className="vacio">Faltan ligas por cargar: todavía no sabemos qué partidos vienen.</div>
      : <div className="vacio">No hay partidos programados con ese filtro.</div>)

  const vacioLigas = cargando
    ? <Cargando />
    : (error ? <div className="aviso" role="status">{textoError}</div> : null)

  const masAntiguo = cargadas.length
    ? cargadas.reduce((peor, e) => ((e.ultimoExito?.mono ?? Infinity) < (peor.ultimoExito?.mono ?? Infinity) ? e : peor))
    : null

  return (
    <PortadaInicio
      claseRaiz="publico"
      marca={<MarcaNav marca={MARCA} tabs={tabs} />}
      hayLigas={hayLigas}
      vacioLigas={vacioLigas}
      totales={{ ligas: hayLigas ? d.ligas.length : null, provincias: null, canchas: null }} // la liga pública no tiene provincia ni cancha
      filtros={{
        provincias: [],
        categorias,
        deportes: deportesPresentes.length > 1 ? [['todos', 'Todos'], ...deportesPresentes.map((k) => [k, ETIQUETA_DEPORTE[k] ?? k])] : [['todos', 'Todos']], // solo los deportes que los datos respaldan
        region,
        cambiarProvincia: (provincia) => setFiltro((f) => ({ ...f, provincia })),
        cambiarDeporte: (deporte) => setFiltro((f) => ({ ...f, deporte })),
        cambiarCategoria: (categoria) => setFiltro((f) => ({ ...f, categoria })),
      }}
      aviso={aviso}
      ahora={{ cuenta: vivos.length, nodo: cargando ? <Cargando /> : nodoAhora }}
      viene={{ dominante: vivos.length === 0, nodo: cargando ? <Cargando /> : nodoViene }}
      categoriaLink={filtro.categoria !== 'todas' && filtro.deporte !== 'todos' ? { deporte: filtro.deporte, categoria: filtro.categoria } : null}
      ligas={<LigasCercaDeTi ligas={ligasF} verTodas={verTodas} alternarTodas={() => setVerTodas((v) => !v)} enlaces={enlaces} nota="Las ligas del piloto en Panamá. Todavía no se filtran por zona." />}
      figuras={<Podio pendiente="Todavía no disponible: las figuras se calcularán con las estadísticas de los partidos finales." enlaces={enlaces} ui={UI} />}
      buscador={(
        <Buscador
          texto={busca}
          alEscribir={setBusca}
          ligas={ligasF}
          equipos={d.equipos}
          jugadores={[]}
          ligasPorId={d.ligasPorId}
          enlaces={enlaces}
          ui={UI}
          alcance="Busca ligas y equipos. La búsqueda de jugadores todavía no está disponible."
          placeholder="Tu liga o tu equipo"
          aria="Buscar liga o equipo"
        />
      )}
      pie={masAntiguo ? <PieFrescura estado={masAntiguo} mono={mono} periodoMs={PERIODO_CATALOGO_MS} saltoMono={saltoMono} /> : null}
    />
  )
}
