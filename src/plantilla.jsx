import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Hoja } from './ui'
import { agregarJugador, validarCamposJugador } from './lib/roster'
import { urlJugador } from './lib/enlaces'

const CAMPOS_VACIOS = { nombrePila: '', apellido1: '', apellido2: '', dorsal: '', fechaNacimiento: '' }

const hoyISO = () => new Date().toISOString().slice(0, 10)

/**
 * Añadir jugador, de punta a punta (Stage 3B, Slice 4).
 *
 * Toda la regla de negocio vive en agregarJugador() (Decisiones 29/30/63):
 * este componente solo junta los campos, llama la operación, y muestra el
 * resultado que ella devuelve — nunca decide por su cuenta si un duplicado
 * es la misma persona, si un número está libre, o si el organizador tiene
 * permiso para modificar la plantilla. La validación de campo en vivo
 * (Decisión 83) reusa validarCamposJugador tal cual la usa la operación,
 * en vez de reimplementar las reglas aquí.
 */
export function FormularioJugador({ sesion, liga, equipoId, onCerrar, onExito }) {
  const [campos, setCampos] = useState(CAMPOS_VACIOS)
  const [tocados, setTocados] = useState({})
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  // formulario | candidatos | ya-activo | exito | confirmar-cierre
  const [paso, setPaso] = useState('formulario')
  const [pasoPrevio, setPasoPrevio] = useState('formulario')
  const [candidatos, setCandidatos] = useState([])
  const [yaActivo, setYaActivo] = useState(null)
  const [resolucion, setResolucion] = useState(null)

  const sucio = Object.values(campos).some((v) => v !== '')

  const cambiarCampo = (campo, valor) => {
    const siguientes = { ...campos, [campo]: valor }
    setCampos(siguientes)
    setErrores(validarCamposJugador(siguientes))
  }

  const marcarTocado = (campo) => setTocados((t) => ({ ...t, [campo]: true }))

  const reiniciar = () => {
    setCampos(CAMPOS_VACIOS)
    setTocados({})
    setErrores({})
    setCandidatos([])
    setYaActivo(null)
    setResolucion(null)
    setPaso('formulario')
  }

  // Decisión 68/69: solo interrumpe el cierre si hay algo que se perdería.
  // "exito" ya quedó guardado — cerrar desde ahí no arriesga nada.
  const pedirCerrar = () => {
    if (paso === 'confirmar-cierre') return
    if (paso === 'exito' || !sucio) { onCerrar(); return }
    setPasoPrevio(paso)
    setPaso('confirmar-cierre')
  }

  async function enviar(resolucionIdentidad) {
    if (guardando) return
    setGuardando(true)
    try {
      const resultado = await agregarJugador({ sesion, liga, equipoId, campos, resolucionIdentidad })
      if (resultado.tipo === 'invalido') {
        setTocados({ nombrePila: true, apellido1: true, apellido2: true, dorsal: true, fechaNacimiento: true })
        setErrores(resultado.errores)
        setPaso('formulario')
      } else if (resultado.tipo === 'candidatos') {
        setCandidatos(resultado.candidatos)
        setPaso('candidatos')
      } else if (resultado.tipo === 'ya-activo') {
        setYaActivo(resultado.ficha)
        setPaso('ya-activo')
      } else if (resultado.tipo === 'conflicto-numero') {
        setResolucion(resolucionIdentidad ?? null)
        setTocados((t) => ({ ...t, dorsal: true }))
        setErrores((e) => ({ ...e, dorsal: 'Ese número ya lo tiene otro jugador activo de este equipo.' }))
        setPaso('formulario')
      } else if (resultado.tipo === 'creado') {
        onExito('Jugador añadido')
        setPaso('exito')
      }
    } finally {
      setGuardando(false)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    enviar(resolucion ?? undefined)
  }

  const elegirCandidato = (personaId) => {
    setResolucion({ tipo: 'misma-persona', personaId })
    enviar({ tipo: 'misma-persona', personaId })
  }

  const esOtraPersona = () => {
    setResolucion({ tipo: 'otra-persona' })
    enviar({ tipo: 'otra-persona' })
  }

  return (
    <Hoja abierta titulo="Añadir jugador" onSolicitarCierre={pedirCerrar}>
      {paso === 'confirmar-cierre' && (
        <div className="aviso alerta">
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 12px' }}>Tienes cambios sin guardar. ¿Qué deseas hacer?</p>
            <div className="btn-fila">
              <button type="button" className="btn fantasma" onClick={() => setPaso(pasoPrevio)}>
                Seguir editando
              </button>
              <button type="button" className="btn" onClick={onCerrar}>Descartar cambios</button>
            </div>
          </div>
        </div>
      )}

      {paso === 'formulario' && (
        <form onSubmit={onSubmit} noValidate>
          <div className="campo">
            <label htmlFor="jf-nombre">Nombre *</label>
            <input
              id="jf-nombre"
              value={campos.nombrePila}
              onChange={(e) => cambiarCampo('nombrePila', e.target.value)}
              onBlur={() => marcarTocado('nombrePila')}
              maxLength={80}
            />
            {tocados.nombrePila && errores.nombrePila && <span className="campo-error">{errores.nombrePila}</span>}
          </div>

          <div className="campo">
            <label htmlFor="jf-apellido1">Primer apellido *</label>
            <input
              id="jf-apellido1"
              value={campos.apellido1}
              onChange={(e) => cambiarCampo('apellido1', e.target.value)}
              onBlur={() => marcarTocado('apellido1')}
              maxLength={80}
            />
            {tocados.apellido1 && errores.apellido1 && <span className="campo-error">{errores.apellido1}</span>}
          </div>

          <div className="campo">
            <label htmlFor="jf-apellido2">Segundo apellido</label>
            <input
              id="jf-apellido2"
              value={campos.apellido2}
              onChange={(e) => cambiarCampo('apellido2', e.target.value)}
              onBlur={() => marcarTocado('apellido2')}
              maxLength={80}
            />
            {tocados.apellido2 && errores.apellido2 && <span className="campo-error">{errores.apellido2}</span>}
          </div>

          <div className="campo">
            <label htmlFor="jf-dorsal">Número *</label>
            <input
              id="jf-dorsal"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              step={1}
              value={campos.dorsal}
              onChange={(e) => cambiarCampo('dorsal', e.target.value)}
              onBlur={() => marcarTocado('dorsal')}
            />
            {tocados.dorsal && errores.dorsal && <span className="campo-error">{errores.dorsal}</span>}
          </div>

          <div className="campo">
            <label htmlFor="jf-fecha">Fecha de nacimiento</label>
            <input
              id="jf-fecha"
              type="date"
              max={hoyISO()}
              value={campos.fechaNacimiento}
              onChange={(e) => cambiarCampo('fechaNacimiento', e.target.value)}
              onBlur={() => marcarTocado('fechaNacimiento')}
            />
            {tocados.fechaNacimiento && errores.fechaNacimiento && (
              <span className="campo-error">{errores.fechaNacimiento}</span>
            )}
          </div>

          <button className="btn" type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Añadir jugador'}
          </button>
        </form>
      )}

      {paso === 'candidatos' && (
        <div>
          <p className="sub" style={{ marginBottom: 12 }}>Encontramos un jugador con el mismo nombre.</p>
          <div className="lista">
            {candidatos.map((c) => (
              <div key={c.fichaId} className="card">
                <div style={{ fontWeight: 700 }}>{c.nombreCompleto}</div>
                <div className="sub" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                  {c.equipoNombre || 'Sin equipo'} · #{c.dorsal ?? '—'}
                  {c.edad !== undefined && <> · {c.edad} años</>}
                  {!c.activo && ' · Inactivo'}
                </div>
                <button
                  type="button"
                  className="btn fantasma"
                  style={{ width: 'auto', marginTop: 10, padding: '8px 14px' }}
                  onClick={() => elegirCandidato(c.personaId)}
                  disabled={guardando}
                >
                  Es la misma persona
                </button>
              </div>
            ))}
          </div>
          <div className="btn-fila" style={{ marginTop: 14 }}>
            <button type="button" className="btn fantasma" onClick={() => setPaso('formulario')} disabled={guardando}>
              Corregir datos
            </button>
            <button type="button" className="btn" onClick={esOtraPersona} disabled={guardando}>
              Es otra persona
            </button>
          </div>
        </div>
      )}

      {paso === 'ya-activo' && yaActivo && (
        <div className="aviso">
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 12px' }}>Este jugador ya está en la plantilla de este equipo.</p>
            <div className="btn-fila">
              <button type="button" className="btn fantasma" onClick={() => setPaso('formulario')}>
                Corregir datos
              </button>
              <Link to={urlJugador(yaActivo)} className="btn" onClick={onCerrar}>
                Ver jugador
              </Link>
            </div>
          </div>
        </div>
      )}

      {paso === 'exito' && (
        <div>
          <p className="sub" style={{ marginBottom: 14 }}>Jugador añadido a la plantilla.</p>
          <div className="btn-fila">
            <button type="button" className="btn fantasma" onClick={onCerrar}>Volver a Plantilla</button>
            <button type="button" className="btn" onClick={reiniciar}>Añadir otro jugador</button>
          </div>
        </div>
      )}
    </Hoja>
  )
}
