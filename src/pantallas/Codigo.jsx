import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'

/**
 * El código corto para la tele. Escribir un URL largo con el control remoto
 * de un televisor es suficientemente incómodo como para que la gente no lo haga.
 */
export default function Codigo() {
  const { codigo } = useParams()
  const nav = useNavigate()
  const [estado, setEstado] = useState('buscando')

  useEffect(() => {
    let vivo = true
    db.partidos.where('codigo').equals(codigo).first().then((p) => {
      if (!vivo) return
      if (p) nav(`/partido/${p.id}`, { replace: true })
      else setEstado('no-existe')
    })
    return () => { vivo = false }
  }, [codigo, nav])

  const [entrada, setEntrada] = useState('')

  return (
    <div style={{ paddingTop: 60, textAlign: 'center' }}>
      {estado === 'buscando' && <p className="sub">Buscando el partido {codigo}…</p>}
      {estado === 'no-existe' && (
        <>
          <h2 className="seccion">No hay ningún partido con el código {codigo}</h2>
          <div className="campo" style={{ maxWidth: 240, margin: '18px auto' }}>
            <label>Prueba otro código</label>
            <input
              inputMode="numeric"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder="4821"
              style={{ textAlign: 'center', fontSize: '1.6rem', letterSpacing: '0.2em' }}
            />
          </div>
          <button className="btn" style={{ maxWidth: 240, margin: '0 auto' }}
            onClick={() => nav(`/b/${entrada}`, { replace: true })}>
            Abrir marcador
          </button>
        </>
      )}
    </div>
  )
}
