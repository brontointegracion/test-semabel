import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { frescura, useMono, useRecurso } from '../../lib/publico/hooks.js'
import { ID_PUBLICO, ligasConfiguradas } from '../../lib/publico/config.js'
import { etiquetasDe, partidosDe, urlLigaPublica } from '../../lib/publico/agrupar.js'
import { resolverLiga } from '../../lib/publico/urls.js'
import { urlEquipoPublico } from '../../lib/publico/equipo.js'
import { fechaCortaPanama, horaPanama, textoSede } from '../../lib/publico/formato.js'
import { PERIODO_CATALOGO_MS, recursoLiga } from '../../lib/publico/recursos.js'
import { tablaDeResultados } from '../../lib/tabla-posiciones.js'
import { Cargando, EnlaceConOrigen, EscudoTexto, NoEncontrado, PieFrescura, textoDeError, useDireccionCanonica } from './componentes.jsx'
import { TopbarVolver } from './Navegacion.jsx'
import PaginaLiga, { CalendarioLista, PESTANAS, TablaPosiciones } from './PaginaLiga.jsx'

// ---------------------------------------------------------------------------
// La página de LIGA original sobre las lecturas públicas del servidor (REPORT_156): la misma tarjeta, las mismas pestañas en el mismo
// orden (Posiciones, Calendario, Jugadores) y el mismo marcado que Liga.jsx (PaginaLiga); cambia solo de dónde salen los datos. Todo sale
// de la lectura pública de la liga (equipos y resumen de cada partido): sin base local, sin datos de demostración. Lo que el servidor aún
// no publica se explica dentro de su pestaña; un vacío solo se afirma cuando está verificado.
// ---------------------------------------------------------------------------

const UI = {
  Escudo: ({ equipo, size = 'sm' }) => <EscudoTexto nombre={equipo?.nombre ?? ''} size={size || 'sm'} />,
  Vacio: ({ children }) => <div className="vacio">{children}</div>,
  Enlace: EnlaceConOrigen,
}
const PESTANAS_VALIDAS = PESTANAS.map(([k]) => k)

const instante = (p) => (p.programadoPara !== null ? Date.parse(p.programadoPara) : (p.inicioReal ? Date.parse(p.inicioReal) : Infinity))

export default function LigaCompartida() {
  const { ligaId: parametro } = useParams()
  const config = useMemo(() => ligasConfiguradas(), [])
  // Solo las ligas de la configuración de la compilación se leen: cualquier otro ID no genera ninguna petición. La dirección lleva la
  // liga en minúsculas (o, por compatibilidad, su id original): se resuelve al id interno, que es el que se lee.
  const resolucion = useMemo(() => (config.ok && ID_PUBLICO.test(parametro ?? '') ? resolverLiga(config.ids, parametro) : { ok: false }), [config, parametro])
  const valida = resolucion.ok
  const ligaId = valida ? resolucion.ligaId : null
  useDireccionCanonica(valida ? urlLigaPublica(ligaId) : null)
  const def = useMemo(() => (valida ? recursoLiga(ligaId) : null), [valida, ligaId])
  const estado = useRecurso(def)
  const { mono, saltoMono } = useMono({ activo: valida })
  // La pestaña vive en la URL (?pestana=): sobrevive a recargas, como en el original.
  const [params, setParams] = useSearchParams()
  const pedida = params.get('pestana')
  const pestana = PESTANAS_VALIDAS.includes(pedida) ? pedida : 'tabla'
  const setPestana = (k) => setParams((prev) => {
    const n = new URLSearchParams(prev)
    if (k === 'tabla') n.delete('pestana')
    else n.set('pestana', k)
    return n
  }, { replace: true })
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!estado.datos) return undefined
    const anterior = document.title
    document.title = `${estado.datos.liga.nombre} · semabel.com`
    return () => { document.title = anterior }
  }, [estado.datos?.liga.nombre]) // eslint-disable-line react-hooks/exhaustive-deps

  const partidos = useMemo(() => partidosDe([estado]), [estado])
  if (!valida || estado.fase === 'no-encontrado') return <NoEncontrado titulo="No encontramos esta liga" />
  const d = estado.datos
  if (!d) {
    return (
      <div className="publico">
        <TopbarVolver titulo="Liga" hacia="/" etiqueta="‹ Inicio" />
        {estado.fase === 'cargando' ? <Cargando /> : <div className="aviso" role="status">{textoDeError(estado)}</div>}
      </div>
    )
  }

  const { liga, equipos } = d
  const f = frescura(estado, mono, { periodoMs: PERIODO_CATALOGO_MS, saltoMono })
  const idsEquipos = equipos.map((e) => e.id)
  const enlaceEquipo = (e) => urlEquipoPublico(liga.id, e.id, idsEquipos)
  const { categoria, subcategoria } = etiquetasDe(liga)
  const finales = partidos.filter((p) => p.estado === 'final')

  const compartir = async () => {
    const url = `${location.origin}${urlLigaPublica(liga.id)}`
    try {
      if (navigator.share) await navigator.share({ title: liga.nombre, url })
      else await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch { /* el usuario canceló */ }
  }

  // Posiciones: de los resultados FINALES guardados en el servidor (puntos y faltas del partido). Sin finales, el vacío está verificado.
  const filas = tablaDeResultados({
    equipos,
    deporte: liga.deporte,
    resultados: finales.map((p) => ({ localId: p.local.id, visitaId: p.visita.id, local: p.local.puntos, visita: p.visita.puntos, faltasLocal: p.local.faltas, faltasVisita: p.visita.faltas })),
  })
  const listaEquipos = (
    <>
      <h2 className="seccion">Equipos</h2>
      <div className="lista-equipos">
        {equipos.map((e) => <EnlaceConOrigen key={e.id} to={enlaceEquipo(e)} className="pill">{e.nombre}</EnlaceConOrigen>)}
      </div>
    </>
  )

  // Calendario: todos los partidos por hora programada (los sin hora al final), con la sede o «Por avisar».
  let ultimo = null
  const ordenados = [...partidos].sort((a, b) => (instante(a) === instante(b) ? (a.gameId < b.gameId ? -1 : 1) : instante(a) < instante(b) ? -1 : 1))
  const filasCalendario = ordenados.map((p) => {
    const cuando = p.programadoPara ?? p.inicioReal
    const clave = cuando ? fechaCortaPanama(cuando) : 'Fecha por confirmar'
    const nuevo = clave !== ultimo
    ultimo = clave
    const vivoOFinal = p.estado === 'vivo' || p.estado === 'final'
    const lado = (l, rival) => ({ equipo: { nombre: l.nombre }, nombre: l.nombre, goles: vivoOFinal ? l.puntos : null, perdio: p.estado === 'final' && l.puntos < rival.puntos })
    return {
      clave: p.gameId,
      separador: nuevo ? clave : null,
      href: p.urlPartido,
      vivo: p.estado === 'vivo',
      dia: textoSede(p),
      hora: p.programadoPara ? horaPanama(p.programadoPara) : '—',
      final: p.estado === 'final',
      local: lado(p.local, p.visita),
      visita: lado(p.visita, p.local),
    }
  })

  // Jugadores: el servidor publica puntos y faltas por ficha en la página de cada EQUIPO, no un resumen de toda la liga.
  const jugadores = finales.length === 0
    ? <div className="vacio">Las estadísticas aparecen cuando se juegue el primer partido.</div>
    : (
      <>
        <div className="aviso" role="status">
          Las estadísticas de jugadores de toda la liga todavía no están disponibles aquí. Los puntos y las faltas de cada jugador están en la página de su equipo.
        </div>
        {listaEquipos}
      </>
    )

  return (
    <PaginaLiga
      claseRaiz="publico"
      topbar={<TopbarVolver titulo={liga.nombre} hacia="/" etiqueta="‹ Inicio" />}
      cabecera={{
        nombre: liga.nombre,
        deporteTexto: liga.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala',
        detalle: null, // la liga pública no tiene canchas
        pills: [
          ...(categoria ? [{ acento: true, texto: `Categoría ${categoria}` }] : []),
          ...(subcategoria ? [{ acento: true, texto: subcategoria }] : []),
        ],
        compartir: { alPulsar: compartir, copiado },
        retar: null, // los retos no existen en modo compartido
      }}
      pestana={pestana}
      alCambiarPestana={setPestana}
      contenido={{
        tabla: (
          <TablaPosiciones
            filas={filas}
            jugados={finales.length}
            deporte={liga.deporte}
            ui={UI}
            enlaceEquipo={enlaceEquipo}
            nota="La tabla sale de los resultados finales guardados en el servidor, no de un marcador escrito a mano."
            despuesDelVacio={listaEquipos}
          />
        ),
        calendario: partidos.length === 0
          ? <div className="vacio">Todavía no hay partidos programados.</div>
          : <CalendarioLista filas={filasCalendario} ui={UI} />,
        jugadores,
      }}
      pie={<PieFrescura estado={estado} mono={mono} periodoMs={PERIODO_CATALOGO_MS} saltoMono={saltoMono} />}
    />
  )
}
