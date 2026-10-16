import { claveDiaPanama, diaRelativoPanama, fechaCortaPanama, horaPanama, textoSede } from '../../lib/publico/formato.js'
import { pendienteDeComenzar, textoPeriodo, urlPartidoPublico } from '../../lib/publico/agrupar.js'
import { vistaReloj } from '../../lib/publico/vista-reloj.js'
import { ahoraServidor } from '../../lib/publico/reloj-servidor.js'
import { EnlaceConOrigen, EscudoTexto } from './componentes.jsx'

const destino = (p) => p.urlPartido ?? urlPartidoPublico(p.ligaId, p.gameId)

// Tarjetas de partido de la lista (Inicio y Liga). Mismas clases visuales que el prototipo.

export function TarjetaVivo({ partido: p, mono, relojConfiable }) {
  const v = vistaReloj({ estado: p.estado, reloj: p.reloj, muestra: p.muestra, mono, relojConfiable })
  const arriba = p.local.puntos === p.visita.puntos ? null : p.local.puntos > p.visita.puntos ? p.local.id : p.visita.id
  return (
    <EnlaceConOrigen to={destino(p)} className="hm-marcador">
      <div className="hm-marcador-cabeza">
        <span className="hm-badge-vivo"><span className="hm-vivo-punto" aria-hidden="true" />En vivo</span>
        <span className="reloj-vivo">
          {textoPeriodo(p.deporte, p.periodo)}
          <b className={v.detenido ? '' : 'anda'}>{v.texto}</b>
        </span>
        <span className="hm-marcador-liga">{p.ligaNombre}</span>
      </div>
      <div className="hm-marcador-cuerpo">
        {[p.local, p.visita].map((eq) => (
          <div key={eq.id} className={`hm-lado ${arriba && eq.id !== arriba ? 'pierde' : ''}`}>
            <EscudoTexto nombre={eq.nombre} />
            <span className="hm-lado-nombre">{eq.nombre}</span>
            <span className="hm-tanteo">{eq.puntos}</span>
          </div>
        ))}
      </div>
      {(p.sede || v.nota) && (
        <div className="hm-marcador-pie">
          {[p.sede, v.nota].filter(Boolean).join(' · ')}
        </div>
      )}
    </EnlaceConOrigen>
  )
}

export function FilaProgramado({ partido: p, mono }) {
  const retrasado = pendienteDeComenzar(p, mono)
  return (
    <EnlaceConOrigen to={destino(p)} className="partido" style={{ marginBottom: 8 }}>
      <div className="cuando">
        <div className="hora">{p.programadoPara ? horaPanama(p.programadoPara) : '—'}</div>
        {textoSede(p) && <div className="dia">{textoSede(p)}</div>}
      </div>
      <div className="enfrenta">
        {[p.local, p.visita].map((eq) => (
          <div key={eq.id} className="lado">
            <EscudoTexto nombre={eq.nombre} />
            <span className="nombre">{eq.nombre}</span>
          </div>
        ))}
        {retrasado && <span className="pendiente-comenzar">Pendiente de comenzar</span>}
      </div>
    </EnlaceConOrigen>
  )
}

export function FilaFinal({ partido: p }) {
  const gana = p.local.puntos === p.visita.puntos ? null : p.local.puntos > p.visita.puntos ? p.local.id : p.visita.id
  const fecha = p.inicioReal ?? p.programadoPara
  return (
    <EnlaceConOrigen to={destino(p)} className="partido" style={{ marginBottom: 8 }}>
      <div className="cuando">
        <div className="hora" style={{ fontSize: '0.78rem' }}>Final</div>
        {fecha && <div className="dia">{fechaCortaPanama(fecha)}</div>}
      </div>
      <div className="enfrenta">
        {[p.local, p.visita].map((eq) => (
          <div key={eq.id} className={`lado ${gana && eq.id !== gana ? 'perdio' : ''}`}>
            <EscudoTexto nombre={eq.nombre} />
            <span className="nombre">{eq.nombre}</span>
            <span className="goles">{eq.puntos}</span>
          </div>
        ))}
      </div>
    </EnlaceConOrigen>
  )
}

/** Lista de próximos partidos agrupada por día de Panamá (los que no tienen hora van en «Fecha por confirmar»). */
export function ListaProgramados({ partidos, mono }) {
  const ahora = (p) => (p.muestra ? ahoraServidor(p.muestra, mono) : null)
  let ultimo = null
  return (
    <div style={{ marginTop: 6 }}>
      {partidos.map((p) => {
        const clave = p.programadoPara ? claveDiaPanama(p.programadoPara) : 'sin-fecha'
        const nuevo = clave !== ultimo
        ultimo = clave
        const relativo = p.programadoPara ? diaRelativoPanama(p.programadoPara, ahora(p) ?? Date.parse(p.programadoPara)) : null
        const absoluto = p.programadoPara ? fechaCortaPanama(p.programadoPara) : null
        const etiqueta = p.programadoPara ? (relativo === absoluto ? absoluto : `${relativo} · ${absoluto}`) : 'Fecha por confirmar'
        return (
          <div key={`${p.ligaId}:${p.gameId}`}>
            {nuevo && <div className="dia-sep">{etiqueta}</div>}
            <FilaProgramado partido={p} mono={mono} />
          </div>
        )
      })}
    </div>
  )
}
