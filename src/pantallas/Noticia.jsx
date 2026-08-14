import { Link, useParams } from 'react-router-dom'
import { useNoticia } from '../datos'
import { Topbar, fechaCorta } from '../ui'
import { codigoDe, urlLiga } from '../lib/enlaces'
import { useMeta } from '../lib/meta'

export default function Noticia() {
  const { slug } = useParams()
  const d = useNoticia(codigoDe(slug))
  useMeta({
    titulo: d && d.noticia.titulo,
    descripcion: d && d.noticia.entrada,
    tipo: 'article',
  })

  if (!d) return null

  const { noticia, liga } = d
  // Las notas de pago muestran la entrada y el primer párrafo; el resto se cobra.
  const visibles = noticia.premium ? noticia.cuerpo.slice(0, 1) : noticia.cuerpo

  return (
    <>
      <Topbar titulo={noticia.etiqueta} />

      <div style={{ marginTop: 16 }}>
        <div className="meta" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill acento">{noticia.etiqueta}</span>
          <span className="sub" style={{ fontSize: '0.8rem' }}>{fechaCorta(noticia.publicada)}</span>
        </div>

        <h1 style={{ fontSize: '1.7rem', fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.15, margin: '12px 0 10px', textWrap: 'balance' }}>
          {noticia.titulo}
        </h1>

        <p className="sub" style={{ fontSize: '1rem', lineHeight: 1.5, marginTop: 0 }}>
          {noticia.entrada}
        </p>

        <div className="cuerpo-noticia" style={{ marginTop: 18 }}>
          {visibles.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        {noticia.premium && (
          <div className="muro">
            <div className="card">
              <div style={{ fontWeight: 700 }}>El resto de la nota es para suscriptores</div>
              <p className="sub" style={{ marginTop: 6 }}>
                Parte se lee gratis y parte se paga. Es el mismo trato que con los perfiles de
                jugador: lo básico abierto, lo completo por suscripción.
              </p>
              <button className="btn" style={{ marginTop: 12 }}>Suscribirme</button>
            </div>
          </div>
        )}

        {liga && (
          <Link to={urlLiga(liga)} className="card" style={{ marginTop: 22 }}>
            <div className="eyebrow">Liga mencionada</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{liga.nombre}</div>
            <div className="sub">{liga.provincia} · organiza {liga.organizador}</div>
          </Link>
        )}
      </div>
    </>
  )
}
