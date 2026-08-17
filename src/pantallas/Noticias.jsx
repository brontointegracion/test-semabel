import { Link } from 'react-router-dom'
import { useCronicas, useRegion } from '../datos'
import { Marca, Vacio, fechaCorta } from '../ui'
import { urlPartido, urlLiga } from '../lib/enlaces'
import { useMeta } from '../lib/meta'

/**
 * Noticias que se escriben solas.
 *
 * Antes esto eran notas de redacción: alguien tenía que escribir, cada semana,
 * en cada liga, en cada país y en dos idiomas. No escalaba y costaba dinero.
 *
 * Ahora salen de los eventos ya guardados, así que cada barrio tiene las suyas
 * y no cuestan nada. Los hechos vienen del registro; lo único que se elige es
 * la manera de decirlos.
 */
export default function Noticias() {
  const cronicas = useCronicas()
  const region = useRegion()

  useMeta({
    titulo: 'Lo que pasó en las canchas',
    descripcion:
      'Crónicas de cada jornada: quién ganó, por cuánto, quién anotó y qué rachas siguen vivas.',
  })

  if (!region) return null

  return (
    <>
      <Marca />
      <h2 className="seccion">Lo que pasó</h2>
      <p className="sub" style={{ marginTop: -4 }}>
        Se escriben solas, con lo que se anotó en cada partido.
      </p>

      <div style={{ marginTop: 8 }}>
        {cronicas.map((c, i) => {
          const dentro = (
            <>
              <div className="meta">
                <span className="pill acento">{c.etiqueta}</span>
                <span className="sub" style={{ fontSize: '0.78rem' }}>{fechaCorta(c.cuando)}</span>
              </div>
              <div className="titulo">{c.titular}</div>
              <div className="entrada">{c.entrada}</div>
              {i === 0 && c.cuerpo?.length > 0 && (
                <p className="sub" style={{ marginTop: 4, lineHeight: 1.5 }}>{c.cuerpo[0]}</p>
              )}
              {c.liga && <div className="sub" style={{ fontSize: '0.78rem' }}>{c.liga.nombre}</div>}
            </>
          )

          return c.partido ? (
            <Link
              key={c.id}
              to={urlPartido(c.partido, c.equipos[c.partido.localId], c.equipos[c.partido.visitaId])}
              className={`noticia ${i === 0 ? 'principal' : ''}`}
            >
              {dentro}
            </Link>
          ) : (
            <Link key={c.id} to={urlLiga(c.liga)} className="noticia">
              {dentro}
            </Link>
          )
        })}
        {!cronicas.length && (
          <Vacio>Todavía no se ha jugado nada por aquí. Cuando se juegue, aparece solo.</Vacio>
        )}
      </div>

      <div className="aviso" style={{ marginTop: 20 }}>
        <div>
          Ningún dato de aquí está inventado: sale de lo que el árbitro anotó. Un modelo puede
          después pulir la redacción, pero recibe los hechos ya hechos — son personas reales.
        </div>
      </div>
    </>
  )
}
