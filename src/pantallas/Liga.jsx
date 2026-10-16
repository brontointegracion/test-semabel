import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useLiga, useRetosDeLiga, useSesion } from '../datos'
import { etiquetaDorsal } from '../lib/dorsal'
import { esDuenoDe } from '../lib/sesion'
import { tablaPosiciones, estadisticaJugadores, marcadorEquipo } from '../lib/marcador'
import { Topbar, Escudo, Vacio, fechaCorta, hora, mismoDia, EnlacePartido } from '../ui'
import { codigoDe, urlLiga, urlPartido, urlJugador, urlEquipo, urlReto } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import { pestanaDe } from '../lib/volver'
import PaginaLiga, { CalendarioLista, TablaPosiciones } from './publico/PaginaLiga.jsx'
import { etiquetaCategoria, etiquetaSubcategoria } from '../lib/categorias'

// Lo que la página de liga compartida necesita del prototipo: sus piezas visuales (escudo, vacío, enlace a partido).
const UI = { Escudo, Vacio, Enlace: EnlacePartido }
const UI_LINK = { Escudo, Vacio, Enlace: Link }

export default function Liga() {
  const { slug } = useParams()
  const d = useLiga(codigoDe(slug))
  const retos = useRetosDeLiga(d?.liga?.id)
  const sesion = useSesion()
  // La pestaña vive en la URL (?pestana=): sobrevive a recargas y permite volver a ella.
  const [params, setParams] = useSearchParams()
  const pestana = pestanaDe(params.get('pestana'))
  const setPestana = (k) => setParams((prev) => {
    const n = new URLSearchParams(prev)
    if (k === 'tabla') n.delete('pestana')
    else n.set('pestana', k)
    return n
  }, { replace: true })
  const [copiado, setCopiado] = useState(false)

  useMeta({
    titulo: d && `${d.liga.nombre}: tabla, calendario y goleadores`,
    descripcion: d && (
      `Posiciones, calendario y estadísticas de ${d.liga.nombre}. ` +
      `${d.equipos.length} equipos de ${d.liga.deporte === 'baloncesto' ? 'baloncesto' : 'fútbol sala'} ` +
      `en ${d.liga.provincia}. Marcador en vivo y resultados de cada jornada.`
    ),
  })

  if (!d) return null
  const { liga, equipos, jugadores, partidos, equiposPorId, canchasPorId, eventosPorPartido } = d

  const compartir = async () => {
    const url = `${location.origin}${urlLiga(liga)}`
    try {
      if (navigator.share) await navigator.share({ title: liga.nombre, url })
      else await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch { /* el usuario canceló */ }
  }

  return (
    <PaginaLiga
      topbar={<Topbar titulo={liga.nombre} />}
      cabecera={{
        deporteTexto: liga.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala',
        detalle: liga.canchaIds.map((c) => canchasPorId[c]?.nombre).filter(Boolean).join(' y '),
        pills: [
          ...(liga.categoria && liga.categoria !== 'Libre' ? [{ acento: true, texto: `Categoría ${etiquetaCategoria(liga.categoria)}` }] : []),
          ...(etiquetaSubcategoria(liga.subcategoria) ? [{ acento: true, texto: etiquetaSubcategoria(liga.subcategoria) }] : []),
          ...(liga.internacional ? [{ acento: true, texto: 'Internacional' }] : []),
          ...(liga.esTorneo ? [{ acento: false, texto: 'Torneo' }] : []),
        ],
        compartir: { alPulsar: compartir, copiado },
        retar: esDuenoDe(sesion, liga) && liga.aceptaRetos && !liga.esTorneo
          ? <Link className="btn fantasma" to={`${urlLiga(liga)}/retar`}>Retar a otra liga</Link>
          : null,
      }}
      retos={retos.map((r) => {
        const ahora = Date.now()
        const abre = new Date(r.desde).getTime()
        const cierra = new Date(r.hasta).getTime()
        const estado = ahora < abre ? 'porEmpezar' : ahora > cierra ? 'terminado' : 'enCurso'
        const dias = Math.max(0, Math.ceil((abre - ahora) / 86400000))
        // Nadie acordó nada: una liga lo mandó y la otra lo recibió.
        const loMande = r.ligaAId === liga.id

        return (
          <Link key={r.id} to={urlReto(r)} className="card destacado-link">
            <div className="fila-liga">
              <div className="info">
                <div className="eyebrow">
                  {estado === 'porEmpezar'
                    ? (loMande ? 'Reto enviado' : 'Reto recibido')
                    : estado === 'enCurso' ? 'Reto en curso' : 'Reto terminado'}
                </div>
                <div className="nombre" style={{ marginTop: 3 }}>{r.nombre}</div>
                <div className="sub" style={{ marginTop: 2 }}>
                  {estado === 'porEmpezar'
                    ? `Arranca el ${fechaCorta(r.desde)}, en ${dias} día${dias === 1 ? '' : 's'}`
                    : estado === 'enCurso'
                      ? `Termina el ${fechaCorta(r.hasta)}`
                      : `Se jugó del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`}
                </div>
              </div>
              <span className="chev">→</span>
            </div>
          </Link>
        )
      })}
      pestana={pestana}
      alCambiarPestana={setPestana}
      contenido={{
        tabla: <Tabla liga={liga} equipos={equipos} partidos={partidos} eventosPorPartido={eventosPorPartido} />,
        calendario: (
          <Calendario
            partidos={partidos}
            equiposPorId={equiposPorId}
            canchasPorId={canchasPorId}
            eventosPorPartido={eventosPorPartido}
          />
        ),
        jugadores: (
          <Jugadores
            jugadores={jugadores}
            equiposPorId={equiposPorId}
            partidos={partidos}
            eventosPorPartido={eventosPorPartido}
          />
        ),
      }}
    />
  )
}

function Tabla({ liga, equipos, partidos, eventosPorPartido }) {
  const filas = tablaPosiciones({ equipos, partidos, eventosPorPartido, deporte: liga.deporte })
  const jugados = partidos.filter((p) => p.estado === 'final').length
  return (
    <TablaPosiciones
      filas={filas}
      jugados={jugados}
      deporte={liga.deporte}
      ui={UI_LINK}
      enlaceEquipo={urlEquipo}
      nota="La tabla sale de los eventos de cada partido, no de un marcador escrito a mano."
    />
  )
}

function Calendario({ partidos, equiposPorId, canchasPorId, eventosPorPartido }) {
  let ultimoDia = null
  const filas = partidos.map((p) => {
    const nuevoDia = !ultimoDia || !mismoDia(ultimoDia, p.inicio)
    ultimoDia = p.inicio
    const evs = eventosPorPartido[p.id] || []
    const gl = marcadorEquipo(evs, p.localId)
    const gv = marcadorEquipo(evs, p.visitaId)
    const jugado = p.estado === 'final'
    const muestra = jugado || p.estado === 'vivo'
    const lado = (id, goles, rival) => ({
      equipo: equiposPorId[id],
      nombre: equiposPorId[id]?.nombre,
      goles: muestra ? goles : null,
      perdio: jugado && goles < rival,
    })
    return {
      clave: p.id,
      separador: nuevoDia ? fechaCorta(p.inicio) : null,
      href: urlPartido(p, equiposPorId[p.localId], equiposPorId[p.visitaId]),
      vivo: p.estado === 'vivo',
      dia: canchasPorId[p.canchaId]?.barrio || 'Cancha',
      hora: hora(p.inicio),
      final: jugado,
      local: lado(p.localId, gl, gv),
      visita: lado(p.visitaId, gv, gl),
    }
  })
  return <CalendarioLista filas={filas} ui={UI} />
}

function Jugadores({ jugadores, equiposPorId, partidos, eventosPorPartido }) {
  const stats = estadisticaJugadores({ jugadores, partidos, eventosPorPartido })
    .filter((s) => s.partidos > 0)

  if (!stats.length) return <Vacio>Las estadísticas aparecen cuando se juegue el primer partido.</Vacio>

  return (
    <>
      <h2 className="seccion">Máximos anotadores</h2>
      <div className="lista">
        {stats.slice(0, 15).map((s, i) => (
          <Link key={s.jugador.id} to={urlJugador(s.jugador)} className="jugador-fila">
            <span className="pos" style={{ paddingLeft: 4 }}>{i + 1}</span>
            <Escudo equipo={equiposPorId[s.jugador.equipoId]} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nombre" style={{ fontWeight: 600 }}>{s.jugador.nombre}</div>
              <div className="sub" style={{ fontSize: '0.75rem' }}>
                {etiquetaDorsal(s.jugador)} · {equiposPorId[s.jugador.equipoId]?.nombre}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {s.promedio.toFixed(1)}
              </div>
              <div className="sub" style={{ fontSize: '0.68rem' }}>por juego</div>
            </div>
          </Link>
        ))}
      </div>

      <h2 className="seccion">Más faltas</h2>
      <div className="lista">
        {[...stats].sort((a, b) => b.faltas - a.faltas).slice(0, 8).map((s, i) => (
          <Link key={s.jugador.id} to={urlJugador(s.jugador)} className="jugador-fila">
            <span className="pos" style={{ paddingLeft: 4 }}>{i + 1}</span>
            <Escudo equipo={equiposPorId[s.jugador.equipoId]} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nombre" style={{ fontWeight: 600 }}>{s.jugador.nombre}</div>
              <div className="sub" style={{ fontSize: '0.75rem' }}>
                {equiposPorId[s.jugador.equipoId]?.nombre} · {s.faltasPorJuego.toFixed(1)} por juego
              </div>
            </div>
            <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--acento-ink)' }}>
              {s.faltas}
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
