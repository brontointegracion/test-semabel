import { useEffect, useState } from 'react'
import { edadDe } from '../lib/roster-reglas'
import { leerLiga, leerPlantilla } from '../lib/roster-api'
import { invalidar } from '../lib/sesion-servidor'
import { SIN_CONEXION } from './ComunOrganizador'

// Identidad de una persona al añadir un jugador. Los nombres SOLO sugieren: nada se une ni se separa por coincidir el
// nombre. Cada unión es una elección explícita y confirmada, y el servidor verifica que la ficha elegida existe en una
// liga del propio organizador. El piloto no tiene operación para deshacer ni separar una unión.

const textoEdad = (edad) => (typeof edad === 'number' ? `${edad} años` : 'edad no registrada')
const textoNumero = (d) => (Number.isInteger(d) ? `#${d}` : 'sin número')

function Tarjeta({ c, ligaActualId, nombresLigas, children }) {
  const enEstaLiga = c.ligaId === ligaActualId
  return (
    <div className="card tarjeta-candidato">
      <div style={{ fontWeight: 700 }}>{c.nombreCompleto}</div>
      <div className="sub" style={{ fontSize: '0.82rem', marginTop: 2 }}>
        {enEstaLiga ? 'En esta liga' : `Otra liga: ${nombresLigas[c.ligaId] ?? c.ligaId}`} · {c.equipoNombre || 'Sin equipo'} · {textoNumero(c.dorsal)} · {textoEdad(c.edad)}
        {c.activo ? ' · Activo' : ' · Inactivo'}
      </div>
      {children}
    </div>
  )
}

/** Candidatos que devolvió el servidor + confirmación explícita. `onElegir(resolucion)` envía una operación NUEVA. */
export default function ResolucionIdentidad({ candidatos, seleccion = null, ligaActualId, nombresLigas, nombreNuevo, ocupado, puedeBuscarEnOtraLiga, onElegir, onVolver, onBuscarOtraLiga }) {
  const [confirmando, setConfirmando] = useState(seleccion ? { tipo: 'misma', c: seleccion } : null)
  useEffect(() => { if (seleccion) setConfirmando({ tipo: 'misma', c: seleccion }) }, [seleccion])

  if (confirmando?.tipo === 'misma') {
    const c = confirmando.c
    const enEstaLiga = c.ligaId === ligaActualId
    return (
      <div>
        <h3 style={{ margin: '0 0 8px' }}>Confirma que es la misma persona</h3>
        <Tarjeta c={c} ligaActualId={ligaActualId} nombresLigas={nombresLigas} />
        <p style={{ margin: '12px 0' }}>
          Vas a registrar a <strong>{nombreNuevo}</strong> con la misma identidad de jugador que <strong>{c.nombreCompleto}</strong>
          {enEstaLiga ? ' de esta liga' : ` de la liga «${nombresLigas[c.ligaId] ?? c.ligaId}»`}. Seguirán siendo fichas separadas, pero compartirán la misma persona.
        </p>
        <p className="sub" role="note" style={{ margin: '0 0 14px' }}>
          En este piloto no existe una operación para deshacer ni separar esta unión. Confirma solo si estás seguro.
        </p>
        <div className="btn-fila">
          <button type="button" className="btn fantasma" onClick={() => (seleccion ? onVolver() : setConfirmando(null))} disabled={ocupado}>Volver</button>
          <button
            type="button"
            className="btn"
            disabled={ocupado}
            onClick={() => onElegir(enEstaLiga
              ? { tipo: 'misma-persona', personaId: c.personaId }
              : { tipo: 'misma-persona-otra-liga', ligaOrigenId: c.ligaId, fichaOrigenId: c.fichaId, personaId: c.personaId })}
          >
            Sí, es la misma persona y entiendo que no se puede deshacer
          </button>
        </div>
      </div>
    )
  }

  if (confirmando?.tipo === 'otra') {
    return (
      <div>
        <h3 style={{ margin: '0 0 8px' }}>Confirma que es otra persona</h3>
        <p style={{ margin: '0 0 12px' }}>
          Se creará una identidad de jugador nueva para <strong>{nombreNuevo}</strong>, aunque haya {candidatos.length === 1 ? 'otro jugador' : 'otros jugadores'} con el mismo nombre.
        </p>
        <p className="sub" role="note" style={{ margin: '0 0 14px' }}>Después no se podrá unir con las otras fichas: en este piloto no existe esa operación.</p>
        <div className="btn-fila">
          <button type="button" className="btn fantasma" onClick={() => setConfirmando(null)} disabled={ocupado}>Volver</button>
          <button type="button" className="btn" disabled={ocupado} onClick={() => onElegir({ tipo: 'otra-persona' })}>Sí, es otra persona</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>¿Es alguien que ya está registrado?</h3>
      <p className="sub" style={{ marginBottom: 12 }}>
        Encontramos {candidatos.length === 1 ? 'un jugador' : 'jugadores'} con el mismo nombre. Coincidir en el nombre no basta para decidirlo: elige tú.
      </p>
      <div className="lista">
        {candidatos.map((c) => (
          <Tarjeta key={`${c.ligaId}:${c.fichaId}`} c={c} ligaActualId={ligaActualId} nombresLigas={nombresLigas}>
            <button type="button" className="btn fantasma" style={{ width: 'auto', marginTop: 10, padding: '8px 14px' }} disabled={ocupado} onClick={() => setConfirmando({ tipo: 'misma', c })}>
              Es la misma persona
            </button>
          </Tarjeta>
        ))}
      </div>
      <div className="btn-fila" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" className="btn fantasma" onClick={onVolver} disabled={ocupado}>Corregir datos</button>
        <button type="button" className="btn" onClick={() => setConfirmando({ tipo: 'otra' })} disabled={ocupado}>Es otra persona distinta</button>
      </div>
      {puedeBuscarEnOtraLiga && (
        <p style={{ marginTop: 14 }}>
          <button type="button" className="enlace-boton" onClick={onBuscarOtraLiga} disabled={ocupado}>¿Está registrado en otra liga con otra ortografía? Buscarlo allí</button>
        </p>
      )}
    </div>
  )
}

/** Elegir una ficha de OTRA liga propia con las lecturas que ya existen (liga → equipo → jugador). */
export function SelectorOtraLiga({ ligasPropias, onElegir, onVolver }) {
  const [liga, setLiga] = useState(null) // { id, nombre }
  const [equipo, setEquipo] = useState(null) // { id, nombre }
  const [datos, setDatos] = useState({ cargando: false, equipos: null, fichas: null, error: null })

  async function cargar(fn, alOk) {
    setDatos((d) => ({ ...d, cargando: true, error: null }))
    const r = await fn()
    if (r.tipo === 'no-autorizado') { invalidar(); return }
    if (r.tipo !== 'ok') {
      setDatos((d) => ({ ...d, cargando: false, error: r.tipo === 'sin-conexion' ? SIN_CONEXION : 'No pudimos cargar esta información. Inténtalo de nuevo.' }))
      return
    }
    alOk(r.datos)
  }
  const elegirLiga = (l) => {
    setLiga(l); setEquipo(null)
    cargar(() => leerLiga(l.id), (d) => setDatos({ cargando: false, equipos: d.equipos, fichas: null, error: null }))
  }
  const elegirEquipo = (e) => {
    setEquipo(e)
    cargar(() => leerPlantilla(liga.id, e.id), (d) => setDatos((x) => ({ ...x, cargando: false, fichas: [...d.activos, ...d.inactivos] })))
  }
  const volver = () => {
    if (equipo) { setEquipo(null); setDatos((d) => ({ ...d, fichas: null, error: null })) }
    else if (liga) { setLiga(null); setDatos({ cargando: false, equipos: null, fichas: null, error: null }) }
    else onVolver()
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>Buscar en otra liga</h3>
      <p className="sub" style={{ marginBottom: 12 }}>
        {!liga ? 'Elige la liga donde está registrado.' : !equipo ? `Liga ${liga.nombre}: elige el equipo.` : `Liga ${liga.nombre} · ${equipo.nombre}: elige al jugador.`}
      </p>
      {datos.error && <p className="campo-error" role="alert">{datos.error}</p>}
      {datos.cargando && <p className="sub" role="status">Cargando…</p>}
      <div className="lista">
        {!liga && ligasPropias.map((l) => (
          <button key={l.id} type="button" className="btn fantasma" onClick={() => elegirLiga(l)}>{l.nombre ?? l.id}</button>
        ))}
        {liga && !equipo && datos.equipos?.map((e) => (
          <button key={e.id} type="button" className="btn fantasma" onClick={() => elegirEquipo(e)}>{e.nombre}</button>
        ))}
        {equipo && datos.fichas?.map((f) => {
          const nombreCompleto = f.nombre ?? [f.nombrePila, f.apellido1, f.apellido2].filter(Boolean).join(' ')
          const edad = f.fechaNacimiento ? edadDe(f.fechaNacimiento) : undefined
          return (
            <div key={f.id} className="card tarjeta-candidato">
              <div style={{ fontWeight: 700 }}>{nombreCompleto}</div>
              <div className="sub" style={{ fontSize: '0.82rem', marginTop: 2 }}>
                {equipo.nombre} · {textoNumero(f.dorsal)} · {textoEdad(edad)} · {f.activo ? 'Activo' : 'Inactivo'}
              </div>
              <button
                type="button"
                className="btn fantasma"
                style={{ width: 'auto', marginTop: 10, padding: '8px 14px' }}
                disabled={!f.personaId}
                onClick={() => onElegir({ ligaId: liga.id, fichaId: f.id, personaId: f.personaId, equipoId: equipo.id, equipoNombre: equipo.nombre, nombreCompleto, dorsal: f.dorsal, activo: f.activo, edad })}
              >
                {f.personaId ? 'Elegir a este jugador' : 'Sin identidad registrada'}
              </button>
            </div>
          )
        })}
      </div>
      <div className="btn-fila" style={{ marginTop: 14 }}>
        <button type="button" className="btn fantasma" onClick={volver}>Volver</button>
      </div>
    </div>
  )
}
