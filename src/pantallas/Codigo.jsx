import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { urlPartido } from '../lib/enlaces'

/**
 * El código corto para la tele. Escribir una dirección larga con el control
 * remoto de un televisor es suficientemente incómodo como para que la gente
 * no lo haga, así que /b/7531 lleva al mismo sitio y se puede dictar en voz alta.
 *
 * Desde aquí se salta a la dirección completa, que es la que queda en el
 * historial y la que se comparte.
 */
export default function Codigo() {
  const { codigo } = useParams()
  const nav = useNavigate()
  const [estado, setEstado] = useState('buscando')
  const [entrada, setEntrada] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const partido = await db.partidos.where('codigo').equals(codigo).first()
      if (!vivo) return
      if (!partido) return setEstado('no-existe')

      const equipos = await db.equipos.where('ligaId').equals(partido.ligaId).toArray()
      const local = equipos.find((e) => e.id === partido.localId)
      const visita = equipos.find((e) => e.id === partido.visitaId)
      nav(urlPartido(partido, local, visita), { replace: true })
    })()
    return () => { vivo = false }
  }, [codigo, nav])

  if (estado === 'buscando') {
    return <p className="sub" style={{ paddingTop: 60, textAlign: 'center' }}>Buscando el partido {codigo}…</p>
  }

  return (
    <div style={{ paddingTop: 60, textAlign: 'center' }}>
      <h2 className="seccion">No hay ningún partido con el código {codigo}</h2>
      <div className="campo" style={{ maxWidth: 240, margin: '18px auto' }}>
        <label htmlFor="cod">Prueba otro código</label>
        <input
          id="cod"
          inputMode="numeric"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          placeholder="7531"
          style={{ textAlign: 'center', fontSize: '1.6rem', letterSpacing: '0.2em' }}
        />
      </div>
      <button
        className="btn"
        style={{ maxWidth: 240, margin: '0 auto' }}
        onClick={() => { setEstado('buscando'); nav(`/b/${entrada}`, { replace: true }) }}
      >
        Abrir marcador
      </button>
    </div>
  )
}
