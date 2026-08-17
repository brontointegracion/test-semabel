import { useState } from 'react'
import { useNavigate, useParams, Navigate, Link } from 'react-router-dom'
import { db, uid } from '../db'
import { useLiga, useSesion, useRivalesPosibles } from '../datos'
import { esDuenoDe } from '../lib/sesion'
import { codigoDe, urlLiga, urlReto } from '../lib/enlaces'
import { useMeta } from '../lib/meta'
import { Topbar, Vacio, fechaCorta } from '../ui'

const PAISES = { PA: 'Panamá', CO: 'Colombia' }

/**
 * Retar a otra liga.
 *
 * Tres decisiones y ya: a quién, qué semana, y listo. Se envía, no se negocia:
 * si las dos ligas dejaron abierta la puerta ("acepto retos"), queda enviado y
 * las dos lo ven. La fricción aquí mataría la idea:
 * esto tiene que poder pasar un martes por la noche, entre dos organizadores
 * que se conocen de un grupo de WhatsApp.
 */
export default function Retar() {
  const { slug } = useParams()
  const nav = useNavigate()
  const d = useLiga(codigoDe(slug))
  const sesion = useSesion()
  const rivales = useRivalesPosibles(d?.liga)
  const [elegida, setElegida] = useState(null)
  const [semana, setSemana] = useState('esta')
  const [creando, setCreando] = useState(false)

  useMeta({ titulo: d && `Retar desde ${d.liga.nombre}` })

  if (!d || !sesion) return null
  if (!esDuenoDe(sesion, d.liga)) return <Navigate to={urlLiga(d.liga)} replace />

  const { liga } = d

  const ventana = () => {
    const desde = new Date()
    desde.setHours(0, 0, 0, 0)
    if (semana === 'proxima') desde.setDate(desde.getDate() + 7)
    const hasta = new Date(desde)
    hasta.setDate(desde.getDate() + 7)
    hasta.setHours(23, 59, 59, 0)
    return { desde, hasta }
  }

  const crear = async () => {
    if (!elegida) return
    setCreando(true)
    const { desde, hasta } = ventana()
    const codigo = String(1000 + Math.floor(Math.random() * 8999))
    const reto = {
      id: uid(),
      codigo,
      nombre: `Reto ${liga.provincia} – ${elegida.provincia} ${liga.categoria}`,
      deporte: liga.deporte,
      categoria: liga.categoria,
      ligaAId: liga.id,
      ligaBId: elegida.id,
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      estado: 'abierto',
    }
    await db.retos.add(reto)
    nav(urlReto(reto), { replace: true })
  }

  if (!liga.aceptaRetos) {
    return (
      <>
        <Topbar titulo="Retar a otra liga" />
        <Vacio>
          Esta liga no acepta retos.<br />
          Actívalo en los datos de la liga para poder retar y ser retada.
        </Vacio>
      </>
    )
  }

  const { desde, hasta } = ventana()

  return (
    <>
      <Topbar titulo="Retar a otra liga" />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Cómo funciona</div>
        <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Nadie viaja. Cada liga juega su semana normal, en su cancha, con su gente. Al final se
          comparan los <strong>promedios de puntos por partido</strong> — no el total, porque
          entonces ganaría siempre la que juega más veces.
        </p>
      </div>

      <h2 className="seccion">1. ¿A quién retas?</h2>
      <p className="sub" style={{ marginTop: -6, marginBottom: 10 }}>
        Solo ligas de {liga.deporte === 'baloncesto' ? 'baloncesto' : 'fútbol sala'} categoría{' '}
        {liga.categoria} que también aceptan retos.
      </p>

      <div className="lista">
        {rivales.map((r) => (
          <button
            key={r.id}
            className={`opcion ${elegida?.id === r.id ? 'elegida' : ''}`}
            onClick={() => setElegida(r)}
          >
            <span className="marcador-radio" aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="nombre">{r.nombre}</span>
              <span className="sub">
                {r.provincia}, {PAISES[r.pais] || r.pais} · organiza {r.organizador}
              </span>
            </span>
          </button>
        ))}
        {!rivales.length && (
          <Vacio>
            Todavía no hay otra liga de tu categoría que acepte retos.<br />
            Cuando la haya, aparece aquí.
          </Vacio>
        )}
      </div>

      {rivales.length > 0 && (
        <>
          <h2 className="seccion">2. ¿Qué semana?</h2>
          <div className="segmento">
            <button className={semana === 'esta' ? 'on' : ''} onClick={() => setSemana('esta')}>
              Esta semana
            </button>
            <button className={semana === 'proxima' ? 'on' : ''} onClick={() => setSemana('proxima')}>
              La próxima
            </button>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            Cuentan los partidos jugados entre el {fechaCorta(desde)} y el {fechaCorta(hasta)}.
          </p>

          <button className="btn" style={{ marginTop: 18 }} disabled={!elegida || creando} onClick={crear}>
            {elegida ? `Enviar reto a ${elegida.nombre}` : 'Elige una liga'}
          </button>
          <p className="sub" style={{ marginTop: 10, textAlign: 'center' }}>
            Se envía al instante y las dos ligas lo ven. No hay que esperar a que nadie acepte.
          </p>
        </>
      )}

      <Link to={urlLiga(liga)} className="btn fantasma" style={{ marginTop: 12 }}>
        Volver a la liga
      </Link>
    </>
  )
}
