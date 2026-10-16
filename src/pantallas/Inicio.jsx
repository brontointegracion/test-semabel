import { useMemo, useState } from 'react'
import { useDescubrir, useRegion, useFiguras, visibleEn } from '../datos'
import { textoDorsal } from '../lib/dorsal'
import { marcadorEquipo } from '../lib/marcador'
import { cambiarProvincia, cambiarDeporte, cambiarCategoria } from '../lib/region'
import { Marca, Escudo, Vacio, RelojVivo, diaRelativo, hora, fechaCorta, mismoDia, EnlacePartido } from '../ui'
import { urlLiga, urlPartido, urlEquipo, urlJugador } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import PortadaInicio, { Buscador, LigasCercaDeTi, Podio } from './publico/PortadaInicio.jsx'

// Lo que la portada compartida necesita del prototipo: sus enlaces y sus piezas visuales (el escudo, el vacío, el dorsal).
const ENLACES = { liga: urlLiga, equipo: urlEquipo, jugador: urlJugador }
const UI = { Escudo, Vacio, textoDorsal }

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
    <PortadaInicio
      marca={<Marca />}
      hayLigas={delPais.length > 0}
      totales={totales}
      filtros={{ provincias, categorias, region, cambiarProvincia, cambiarDeporte, cambiarCategoria }}
      ahora={{
        cuenta: vivosF.length,
        nodo: <Ahora partidos={vivosF} equipos={equipos} canchas={canchas} ligas={ligasPorId} eventos={eventosPorPartido} />,
      }}
      viene={{ dominante: vivosF.length === 0, nodo: <Viene partidos={proximosF} equipos={equipos} canchas={canchas} /> }}
      categoriaLink={categoria !== 'todas' && deporte !== 'todos' ? { deporte, categoria } : null}
      ligas={<LigasCercaDeTi ligas={ligasF} verTodas={verTodas} alternarTodas={() => setVerTodas((v) => !v)} enlaces={ENLACES} />}
      figuras={<Podio figuras={figuras} enlaces={ENLACES} ui={UI} />}
      buscador={(
        <Buscador
          texto={busca}
          alEscribir={setBusca}
          ligas={ligasF}
          equipos={listaEquipos}
          jugadores={listaJugadores}
          ligasPorId={ligasPorId}
          enlaces={ENLACES}
          ui={UI}
        />
      )}
    />
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
          <EnlacePartido key={p.id} to={urlPartido(p, local, visita)} className="hm-marcador">
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
          </EnlacePartido>
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
            <EnlacePartido to={urlPartido(p, equipos[p.localId], equipos[p.visitaId])} className="partido" style={{ marginBottom: 8 }}>
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
            </EnlacePartido>
          </div>
        )
      })}
    </div>
  )
}
