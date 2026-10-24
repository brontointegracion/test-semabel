import { useId, useState } from 'react'
import { claveDiaPanama, diaRelativoPanama, fechaCortaPanama, horaPanama, textoSede } from '../../lib/publico/formato.js'
import { pendienteDeComenzar, textoPeriodo, urlPartidoPublico } from '../../lib/publico/agrupar.js'
import { vistaReloj } from '../../lib/publico/vista-reloj.js'
import { ahoraServidor } from '../../lib/publico/reloj-servidor.js'
import { EnlaceConOrigen, EscudoTexto } from './componentes.jsx'

const destino = (p) => p.urlPartido ?? urlPartidoPublico(p.ligaId, p.gameId)

// Tarjetas de partido de la lista (Inicio y Liga). Mismas clases visuales que el prototipo. Las filas de próximos y finales llevan el nombre de
// su liga (REPORT_186): en la portada se mezclan ligas, y así un partido de la liga ficticia «Simulacro — datos ficticios» no se confunde con uno real.

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
        {p.ligaNombre && <span className="fila-liga-partido">{p.ligaNombre}</span>}
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
        {p.ligaNombre && <span className="fila-liga-partido">{p.ligaNombre}</span>}
      </div>
    </EnlaceConOrigen>
  )
}

/** Cuántos «Próximos partidos» se ven al inicio (REPORT_213). Limita lo que se PINTA; la lectura de las ligas no cambia (ver README/informe). */
export const PROXIMOS_INICIALES = 3

/**
 * «Próximos partidos» con a lo sumo PROXIMOS_INICIALES a la vista y una acción EXPLÍCITA para ver el resto (sin carga automática al desplazarse). Los datos ya están
 * en la página: abrir o cerrar no pide nada al servidor. `partidos` ya viene en orden cronológico.
 */
export function ProximosPartidos({ partidos, mono, iniciales = PROXIMOS_INICIALES }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  const hay = partidos.length > iniciales
  const visibles = hay && !abierta ? partidos.slice(0, iniciales) : partidos
  return (
    <>
      <div id={id}><ListaProgramados partidos={visibles} mono={mono} /></div>
      {hay && (
        <div className="proximos-mas">
          <p className="sub" role="status">{abierta ? `Mostrando los ${partidos.length} partidos` : `Mostrando ${iniciales} de ${partidos.length} partidos`}</p>
          <button type="button" className="btn fantasma" aria-expanded={abierta} aria-controls={id} onClick={() => setAbierta((a) => !a)}>
            {abierta ? 'Ver menos partidos' : 'Ver más partidos'}
          </button>
        </div>
      )}
    </>
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
