import { Link } from 'react-router-dom'
import { useNoticias, useRegion } from '../datos'
import { Marca, Vacio, fechaCorta } from '../ui'

export default function Noticias() {
  const noticias = useNoticias()
  const region = useRegion()

  if (!region) return null

  // Mismo criterio que la portada: solo lo del país de quien mira.
  const delPais = (noticias || []).filter((n) => n.pais === region.pais)

  return (
    <>
      <Marca />
      <h2 className="seccion">Últimas noticias</h2>
      <p className="sub" style={{ marginTop: -4 }}>
        Lo que pasa en las canchas, contado por quienes las llenan.
      </p>

      <div style={{ marginTop: 8 }}>
        {delPais.map((n, i) => (
          <Link key={n.id} to={`/noticia/${n.id}`} className={`noticia ${i === 0 ? 'principal' : ''}`}>
            <div className="meta">
              <span className="pill acento">{n.etiqueta}</span>
              <span className="sub" style={{ fontSize: '0.78rem' }}>{fechaCorta(n.publicada)}</span>
              {n.premium && <span className="pill">Para suscriptores</span>}
            </div>
            <div className="titulo">{n.titulo}</div>
            <div className="entrada">{n.entrada}</div>
            {n.liga && <div className="sub" style={{ fontSize: '0.78rem' }}>{n.liga.nombre}</div>}
          </Link>
        ))}
        {!delPais.length && <Vacio>Todavía no hay noticias de tu país.</Vacio>}
      </div>
    </>
  )
}
