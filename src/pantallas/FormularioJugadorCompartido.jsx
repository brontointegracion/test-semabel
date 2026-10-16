import { useRef, useState } from 'react'
import { validarCamposJugador } from '../lib/roster-reglas'
import { HojaOrganizador } from './ComunOrganizador'
import ResolucionIdentidad, { SelectorOtraLiga } from './ResolucionIdentidad'

// Añadir / editar un jugador contra el SERVIDOR (modo compartido). No guarda nada localmente, no importa la plantilla de
// Dexie y no decide reglas por su cuenta: valida con las mismas reglas puras solo para dar respuesta rápida; el servidor
// decide. Cada pulsación de «guardar» es UNA operación nueva (identificador y cuerpo congelados por el módulo de envío).

const CAMPOS_VACIOS = { nombrePila: '', apellido1: '', apellido2: '', dorsal: '', nombreCamiseta: '', fechaNacimiento: '' }
const ETIQUETAS = { nombrePila: 'Nombre', apellido1: 'Primer apellido', apellido2: 'Segundo apellido', dorsal: 'Número', nombreCamiseta: 'Nombre en camiseta', fechaNacimiento: 'Fecha de nacimiento' }
const hoyISO = () => new Date().toISOString().slice(0, 10)

/** Los campos de la ficha del SERVIDOR como texto del formulario. Lo que falta queda vacío: nunca se adivinan partes del nombre. */
export function camposDeFicha(ficha) {
  if (!ficha) return CAMPOS_VACIOS
  return {
    nombrePila: ficha.nombrePila ?? '',
    apellido1: ficha.apellido1 ?? '',
    apellido2: ficha.apellido2 ?? '',
    dorsal: Number.isInteger(ficha.dorsal) ? String(ficha.dorsal) : '',
    nombreCamiseta: ficha.nombreCamiseta ?? '',
    fechaNacimiento: ficha.fechaNacimiento ?? '',
  }
}

/** Qué cambió en otra parte entre lo que el organizador abrió y la ficha vigente. */
function diferencias(antes, ahora) {
  const a = camposDeFicha(antes)
  const b = camposDeFicha(ahora)
  const lista = Object.keys(CAMPOS_VACIOS).filter((k) => a[k] !== b[k]).map((k) => ({ campo: ETIQUETAS[k], antes: a[k] || '—', ahora: b[k] || '—' }))
  if (antes.activo !== ahora.activo) lista.push({ campo: 'Estado', antes: antes.activo ? 'Activo' : 'Inactivo', ahora: ahora.activo ? 'Activo' : 'Inactivo' })
  return lista
}

/** Los campos que el organizador NO tocó adoptan el valor vigente; los que sí tocó conservan su cambio. */
function rebasar(viejaBase, nuevaBase, campos) {
  const v = camposDeFicha(viejaBase)
  const n = camposDeFicha(nuevaBase)
  return Object.fromEntries(Object.keys(CAMPOS_VACIOS).map((k) => [k, campos[k] === v[k] ? n[k] : campos[k]]))
}

export default function FormularioJugadorCompartido({
  modo, ficha = null, ligaId, nombresLigas, ligasPropias, deshabilitadoPor = null, onEnviar, onExito, onRefrescar, onCerrar,
}) {
  const [base, setBase] = useState(ficha)
  const [campos, setCampos] = useState(camposDeFicha(ficha))
  const [tocados, setTocados] = useState({})
  const [errores, setErrores] = useState({})
  const [paso, setPaso] = useState('formulario') // formulario | candidatos | ya-activo | desactualizada | selector | seleccion | bloqueada | info
  const [candidatos, setCandidatos] = useState([])
  const [seleccion, setSeleccion] = useState(null)
  const [yaActivo, setYaActivo] = useState(null)
  const [actual, setActual] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const guardia = useRef(false) // doble pulsación: se cierra de forma síncrona, antes de cualquier espera

  const nombreNuevo = `${campos.nombrePila} ${campos.apellido1}`.trim()
  const otrasLigas = ligasPropias
  const cambiar = (campo, valor) => {
    const siguientes = { ...campos, [campo]: valor }
    setCampos(siguientes)
    setErrores(validarCamposJugador(siguientes))
  }

  function construir(resolucion, confirma) {
    if (modo === 'alta') {
      const c = { nombrePila: campos.nombrePila, apellido1: campos.apellido1, dorsal: campos.dorsal.trim() }
      if (campos.apellido2.trim()) c.apellido2 = campos.apellido2
      if (campos.nombreCamiseta.trim()) c.nombreCamiseta = campos.nombreCamiseta
      if (campos.fechaNacimiento) c.fechaNacimiento = campos.fechaNacimiento
      return { campos: c, ...(resolucion ? { resolucionIdentidad: resolucion } : {}) }
    }
    const b = camposDeFicha(base)
    const cambios = {}
    for (const k of ['nombrePila', 'apellido1', 'apellido2', 'nombreCamiseta']) if (campos[k] !== b[k]) cambios[k] = campos[k]
    if (campos.dorsal !== b.dorsal) cambios.dorsal = campos.dorsal.trim()
    if (campos.fechaNacimiento !== b.fechaNacimiento) cambios.fechaNacimiento = campos.fechaNacimiento || null
    if (Object.keys(cambios).length === 0) return null
    return { revEsperada: base.rev, campos: cambios, ...(confirma ? { confirmaCandidatos: true } : {}) }
  }

  async function enviar(resolucion = null, confirma = false) {
    if (guardia.current) return
    guardia.current = true
    setOcupado(true)
    setAviso(null)
    try {
      const locales = validarCamposJugador(campos)
      if (Object.keys(locales).length) {
        setTocados({ nombrePila: true, apellido1: true, apellido2: true, dorsal: true, nombreCamiseta: true, fechaNacimiento: true })
        setErrores(locales)
        setPaso('formulario')
        return
      }
      const contenido = construir(resolucion, confirma)
      if (!contenido) { setAviso('No hay cambios que guardar.'); return }
      const r = await onEnviar(contenido)
      if (r.k === 'sin-resolver') return onCerrar() // queda el aviso de «sin confirmar»; la hoja no puede seguir enviando
      if (r.k === 'bloqueado' || r.k === 'no-aplicada') return setAviso(r.texto)
      const { cuerpo, reproducido } = r
      if (cuerpo.resultado === 'aplicado') { onExito(cuerpo, reproducido); return onCerrar() }
      switch (cuerpo.tipo) {
        case 'invalido':
          setTocados({ nombrePila: true, apellido1: true, apellido2: true, dorsal: true, nombreCamiseta: true, fechaNacimiento: true })
          setErrores(cuerpo.errores && typeof cuerpo.errores === 'object' ? cuerpo.errores : {})
          setPaso('formulario')
          break
        case 'conflicto-numero':
          setTocados((t) => ({ ...t, dorsal: true }))
          setErrores((e) => ({ ...e, dorsal: 'Ese número ya lo tiene otro jugador activo de este equipo.' }))
          setPaso('formulario')
          break
        case 'candidatos':
          setCandidatos(Array.isArray(cuerpo.candidatos) ? cuerpo.candidatos : [])
          setPaso('candidatos')
          break
        case 'ya-activo':
          setYaActivo(cuerpo.ficha ?? null)
          setPaso('ya-activo')
          break
        case 'ficha-desactualizada':
          onRefrescar()
          setActual(cuerpo.ficha)
          setPaso('desactualizada')
          break
        case 'equipo-bloqueado':
          onRefrescar()
          setPaso('bloqueada')
          break
        default: // identidad-invalida, ya-activa, ya-inactiva…
          onRefrescar()
          setAviso(`${cuerpo.tipo === 'identidad-invalida' ? 'No pudimos verificar la identidad elegida.' : 'La plantilla cambió.'} Revisa los datos y vuelve a intentarlo.`)
          setPaso('formulario')
      }
    } finally {
      guardia.current = false
      setOcupado(false)
    }
  }

  function enSubmit(e) {
    e.preventDefault()
    enviar(null, false)
  }
  const tocar = (k) => setTocados((t) => ({ ...t, [k]: true }))
  const campo = (k, extra = {}) => (
    <div className="campo">
      <label htmlFor={`jf-${k}`}>{ETIQUETAS[k]}{['nombrePila', 'apellido1', 'dorsal'].includes(k) ? ' *' : ''}</label>
      <input
        id={`jf-${k}`}
        value={campos[k]}
        onChange={(e) => cambiar(k, e.target.value)}
        onBlur={() => tocar(k)}
        aria-invalid={tocados[k] && errores[k] ? true : undefined}
        {...extra}
      />
      {tocados[k] && errores[k] && <span className="campo-error">{errores[k]}</span>}
    </div>
  )

  const titulo = modo === 'alta' ? 'Añadir jugador' : 'Editar jugador'
  return (
    <HojaOrganizador titulo={titulo} onCerrar={onCerrar}>
      {aviso && <p className="aviso-panel" role="alert">{aviso}</p>}
      {deshabilitadoPor && paso === 'formulario' && <p className="aviso-panel" role="note">{deshabilitadoPor}</p>}

      {paso === 'formulario' && (
        <form onSubmit={enSubmit} noValidate>
          {modo === 'editar' && base && !Number.isInteger(base.dorsal) && (
            <p className="sub" role="note" style={{ margin: '0 0 12px' }}>
              Este registro es anterior y no tiene un número válido. Para guardarlo hay que darle uno (de 0 a 99, sin repetir entre los activos del equipo).
            </p>
          )}
          {modo === 'editar' && base && !base.nombrePila && base.nombre && (
            <p className="sub" role="note" style={{ margin: '0 0 12px' }}>
              Nombre registrado: «{base.nombre}». Escribe el nombre y los apellidos por separado; no los adivinamos.
            </p>
          )}
          {campo('nombrePila', { maxLength: 80 })}
          {campo('apellido1', { maxLength: 80 })}
          {campo('apellido2', { maxLength: 80 })}
          {campo('dorsal', { type: 'number', inputMode: 'numeric', min: 0, max: 99, step: 1 })}
          {campo('nombreCamiseta', { maxLength: 20 })}
          <p className="sub" style={{ fontSize: '0.74rem', margin: '-8px 0 16px' }}>Opcional. Se usa en la consola del árbitro; si queda vacío se usa el nombre.</p>
          {campo('fechaNacimiento', { type: 'date', max: hoyISO() })}
          <button className="btn" type="submit" disabled={ocupado || Boolean(deshabilitadoPor)}>
            {ocupado ? 'Guardando…' : modo === 'alta' ? 'Añadir jugador' : 'Guardar cambios'}
          </button>
          {modo === 'alta' && otrasLigas.length > 0 && (
            <p style={{ marginTop: 14 }}>
              <button type="button" className="enlace-boton" onClick={() => setPaso('selector')} disabled={ocupado}>
                ¿Ya está registrado en otra liga? Buscarlo allí
              </button>
            </p>
          )}
        </form>
      )}

      {paso === 'candidatos' && modo === 'alta' && (
        <ResolucionIdentidad
          candidatos={candidatos}
          ligaActualId={ligaId}
          nombresLigas={nombresLigas}
          nombreNuevo={nombreNuevo}
          ocupado={ocupado}
          puedeBuscarEnOtraLiga={otrasLigas.length > 0}
          onBuscarOtraLiga={() => setPaso('selector')}
          onVolver={() => setPaso('formulario')}
          onElegir={(resolucion) => enviar(resolucion)}
        />
      )}

      {paso === 'candidatos' && modo === 'editar' && (
        <div>
          <p style={{ margin: '0 0 8px' }}>Hay {candidatos.length === 1 ? 'otro jugador' : 'otros jugadores'} con ese nombre:</p>
          <ul className="sub">{candidatos.map((c) => <li key={`${c.ligaId}:${c.fichaId}`}>{c.nombreCompleto} · {c.equipoNombre}</li>)}</ul>
          <p className="sub">Editar un nombre no cambia la identidad de este jugador ni lo une con nadie.</p>
          <div className="btn-fila">
            <button type="button" className="btn fantasma" onClick={() => setPaso('formulario')} disabled={ocupado}>Corregir datos</button>
            <button type="button" className="btn" onClick={() => enviar(null, true)} disabled={ocupado}>Guardar de todos modos</button>
          </div>
        </div>
      )}

      {paso === 'selector' && (
        <SelectorOtraLiga
          ligasPropias={otrasLigas}
          onVolver={() => setPaso('formulario')}
          onElegir={(s) => { setSeleccion(s); setPaso('seleccion') }}
        />
      )}

      {paso === 'seleccion' && seleccion && (
        <ResolucionIdentidad
          candidatos={[seleccion]}
          seleccion={seleccion}
          ligaActualId={ligaId}
          nombresLigas={{ ...nombresLigas, [seleccion.ligaId]: nombresLigas[seleccion.ligaId] ?? ligasPropias.find((l) => l.id === seleccion.ligaId)?.nombre }}
          nombreNuevo={nombreNuevo}
          ocupado={ocupado}
          onVolver={() => setPaso('selector')}
          onElegir={(resolucion) => enviar(resolucion)}
        />
      )}

      {paso === 'ya-activo' && (
        <div>
          <p style={{ margin: '0 0 12px' }}>Esta persona ya está activa en la plantilla de este equipo{yaActivo?.nombre ? `: ${yaActivo.nombre}` : ''}. No se creó nada.</p>
          <div className="btn-fila">
            <button type="button" className="btn fantasma" onClick={() => setPaso('formulario')}>Corregir datos</button>
            <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
          </div>
        </div>
      )}

      {paso === 'desactualizada' && actual && (
        <div>
          <h3 style={{ margin: '0 0 8px' }}>Esta ficha cambió mientras la editabas</h3>
          <p className="sub" style={{ margin: '0 0 8px' }}>No se guardó nada. Esto es lo que cambió desde que la abriste:</p>
          <ul>
            {diferencias(base, actual).map((d) => <li key={d.campo}><strong>{d.campo}:</strong> {d.antes} → {d.ahora}</li>)}
            {diferencias(base, actual).length === 0 && <li>Cambió algo que no se muestra aquí (por ejemplo, otra edición que dejó los mismos valores).</li>}
          </ul>
          <p className="sub">Tus cambios siguen en el formulario. Revísalos contra la ficha vigente antes de guardar de nuevo.</p>
          <div className="btn-fila">
            <button type="button" className="btn fantasma" onClick={onCerrar}>Cerrar sin guardar</button>
            <button
              type="button"
              className="btn"
              onClick={() => { setCampos(rebasar(base, actual, campos)); setBase(actual); setErrores({}); setTocados({}); setPaso('formulario') }}
            >
              Revisar y guardar de nuevo
            </button>
          </div>
        </div>
      )}

      {paso === 'bloqueada' && (
        <div>
          <p style={{ margin: '0 0 12px' }}>
            Un partido de este equipo está en curso (o en pausa), así que la plantilla no se puede cambiar ahora. No se guardó nada. Se podrá cuando el partido termine.
          </p>
          <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
        </div>
      )}
    </HojaOrganizador>
  )
}
