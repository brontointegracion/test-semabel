import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFiguras } from '../datos'
import { urlJugador, urlEquipo } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import { Topbar, Escudo, Vacio } from '../ui'

/**
 * Las figuras de la provincia, cruzando todas sus ligas.
 *
 * Es la promesa original del producto: sin esto, los números de un jugador
 * quedan encerrados en su liga y no lo compara nadie. Aquí un chico de Darién
 * y uno de Chiriquí aparecen en la misma lista.
 */
export default function Figuras() {
  const d = useFiguras()
  const [orden, setOrden] = useState('promedio')

  useMeta({
    titulo: 'Máximos anotadores del barrio',
    descripcion:
      'Los que más anotan en las ligas de la provincia, cruzando todos los torneos: ' +
      'promedio por partido, puntos totales y faltas.',
  })

  if (!d) return null
  const { anotadores, faltas, ligas, totalJugadores, region } = d

  if (!anotadores.length) {
    return (
      <>
        <Topbar titulo="Figuras" />
        <Vacio>Todavía no hay partidos jugados por aquí.</Vacio>
      </>
    )
  }

  const lista = orden === 'faltas'
    ? faltas
    : orden === 'total'
      ? [...anotadores].sort((a, b) => b.puntos - a.puntos)
      : anotadores

  return (
    <>
      <Topbar titulo="Figuras" />

      <p className="sub" style={{ marginTop: 14 }}>
        {totalJugadores} jugadores de {ligas.length} liga{ligas.length === 1 ? '' : 's'}
        {region.provincia && region.provincia !== 'todas' ? ` en ${region.provincia}` : ''}, en
        una sola lista. Un jugador ya no queda encerrado en su torneo.
      </p>

      <div className="segmento" style={{ marginTop: 14 }}>
        <button className={orden === 'promedio' ? 'on' : ''} onClick={() => setOrden('promedio')}>
          Por juego
        </button>
        <button className={orden === 'total' ? 'on' : ''} onClick={() => setOrden('total')}>
          Totales
        </button>
        <button className={orden === 'faltas' ? 'on' : ''} onClick={() => setOrden('faltas')}>
          Faltas
        </button>
      </div>

      <div className="lista" style={{ marginTop: 14 }}>
        {lista.map((f, i) => (
          <Link key={f.jugador.id} to={urlJugador(f.jugador)} className="jugador-fila">
            <span className={`puesto ${i < 3 ? 'podio' : ''}`}>{i + 1}</span>
            <Escudo equipo={f.equipo} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nombre" style={{ fontWeight: 600 }}>{f.jugador.nombre}</div>
              <div className="sub" style={{ fontSize: '0.74rem' }}>
                {f.equipo?.nombre} · {f.liga?.nombre}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: orden === 'faltas' ? 'var(--acento-ink)' : undefined }}>
                {orden === 'faltas' ? f.faltas : orden === 'total' ? f.puntos : f.promedio.toFixed(1)}
              </div>
              <div className="sub" style={{ fontSize: '0.66rem' }}>
                {orden === 'faltas' ? 'faltas' : orden === 'total' ? 'puntos' : 'por juego'}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
