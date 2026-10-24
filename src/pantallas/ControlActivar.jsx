import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { leerPartidoPublico } from '../lib/control/activacion-api'
import { idValido, leerRegistro } from '../lib/control/activacion-almacen'
import { MENSAJES, activarTelefono, comprobarActivacion, intentoEnVuelo, suscribir } from '../lib/control/activacion'
import { horaLocal } from '../lib/publico/formato.js'
import { GuiaEnLinea } from './GuiaArbitro'
import './ControlActivar.css'

// Activación del teléfono de control (/control/:ligaId/:partidoId). La dirección lleva SOLO identificadores públicos: el
// código se teclea aparte, vive únicamente en el estado del campo, se borra ANTES de enviar y nunca se guarda ni se vuelve
// a mostrar. El token del teléfono nunca se muestra. Esta pantalla no inicia el partido ni puntúa: no hay botón de inicio,
// ni controles de marcador, y nunca llama a /comandos. Tampoco hay forma de borrar o reemplazar un registro.

const ESTADO_PARTIDO = { programado: 'Todavía no ha comenzado', vivo: 'En curso', final: 'Terminado' }
const FECHA = { day: '2-digit', month: 'short', year: 'numeric' }

/** Fecha y hora locales (sin día de la semana); nunca se calcula a partir de una regla propia: solo se muestra lo que dijo el servidor. */
export const fechaHora = (ms) => `${new Date(ms).toLocaleDateString('es', FECHA)}, ${horaLocal(ms)}` // la hora en 12 horas (REPORT_161)

function Fechas({ servidor, actual }) {
  if (!servidor) return null
  const { expiraEn, retornoHasta, leidoEn } = servidor
  return (
    <p className="fechas">
      {expiraEn === null
        ? 'El servidor no registró un vencimiento para procesar acciones.'
        : `Puede procesar acciones hasta: ${fechaHora(expiraEn)}.`}
      {' '}
      {retornoHasta === null
        ? 'El servidor no registró un plazo para repetir recibos.'
        : `Después, solo podrá repetir recibos exactos hasta: ${fechaHora(retornoHasta)}.`}
      {' '}
      {actual ? `Leído del servidor: ${fechaHora(leidoEn)}.` : `Último dato leído del servidor: ${fechaHora(leidoEn)}.`}
    </p>
  )
}

export default function ControlActivar() {
  const { ligaId, partidoId } = useParams()
  const valido = idValido(ligaId) && idValido(partidoId)
  const [codigo, setCodigo] = useState('')
  const [local, setLocal] = useState(() => (valido ? leerRegistro(ligaId, partidoId) : { tipo: 'ninguno' }))
  const [enVuelo, setEnVuelo] = useState(false)
  const [vista, setVista] = useState({ clase: 'cargando' })
  const [ocupado, setOcupado] = useState(false)
  const [enEnvio, setEnEnvio] = useState(false) // esta pantalla está activando (el formulario sigue visible, desactivado)
  const [mensaje, setMensaje] = useState(null)
  const [sonda, setSonda] = useState(null) // resultado de la última comprobación EN ESTA PANTALLA (no es lo guardado)
  const sondeoInicial = useRef(false)

  // Sin buscadores: la página no se indexa (el encabezado de respuesta lo refuerza).
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const releer = useCallback(() => {
    if (!valido) return
    setLocal(leerRegistro(ligaId, partidoId))
    intentoEnVuelo(ligaId, partidoId).then(setEnVuelo)
  }, [valido, ligaId, partidoId])

  useEffect(() => {
    releer()
    const baja = suscribir(releer)
    window.addEventListener('storage', releer)
    window.addEventListener('focus', releer)
    return () => { baja(); window.removeEventListener('storage', releer); window.removeEventListener('focus', releer) }
  }, [releer])

  const cargarVista = useCallback(async () => {
    if (!valido) return
    setVista({ clase: 'cargando' })
    setVista(await leerPartidoPublico({ ligaId, partidoId }))
  }, [valido, ligaId, partidoId])
  useEffect(() => { cargarVista() }, [cargarVista])

  const comprobar = useCallback(async () => {
    if (ocupado) return
    sondeoInicial.current = true // una comprobación hecha aquí cuenta: no se repite sola al cambiar el registro
    setOcupado(true)
    setMensaje(null)
    try {
      const r = await comprobarActivacion({ ligaId, partidoId })
      if (r.tipo === 'bloqueado') setMensaje(MENSAJES[r.motivo] ?? MENSAJES['sin-resultado'])
      else if (r.tipo === 'sin-registro') setMensaje(null)
      else {
        setSonda(r)
        if ((r.tipo === 'vigente' || r.tipo === 'acceso-confirmado-sin-estado') && r.persistido === false) setMensaje(MENSAJES['no-guardada'])
      }
    } finally {
      setOcupado(false)
      releer()
    }
  }, [ocupado, ligaId, partidoId, releer])

  // Un registro de una activación ya confirmada se vuelve a comprobar UNA vez al abrir (solo lectura): lo guardado no es prueba
  // de que siga vigente. Nunca se reenvía una activación sola.
  useEffect(() => {
    if (!valido || sondeoInicial.current) return
    if (local.tipo === 'valido' && local.registro.estado === 'activada') {
      sondeoInicial.current = true
      comprobar()
    }
  }, [valido, local, comprobar])

  async function enviar(evento) {
    evento.preventDefault()
    if (ocupado) return
    const usado = codigo
    setCodigo('') // se borra del campo ANTES de enviar: no queda en pantalla ni en el estado
    if (usado.trim() === '') return
    sondeoInicial.current = true // lo que pase en esta pantalla ya no se «recomprueba» solo
    setOcupado(true)
    setEnEnvio(true)
    setMensaje(null)
    setSonda(null)
    try {
      const r = await activarTelefono({ ligaId, partidoId, codigo: usado })
      if (r.tipo === 'bloqueado') setMensaje(MENSAJES[r.motivo] ?? MENSAJES.almacenamiento)
      else if (r.persistido === false) setMensaje(MENSAJES['no-guardada'])
      else if (r.tipo === 'activada') {
        setMensaje(null)
        comprobar() // lee la vigencia que dice el servidor; la activación ya está confirmada y guardada
      } else if (r.tipo !== 'ya-activada' && r.tipo !== 'incierta') setMensaje(MENSAJES[r.tipo] ?? MENSAJES.incierta) // «incierta» ya la muestra el registro guardado
    } finally {
      setOcupado(false)
      setEnEnvio(false)
      releer()
    }
  }

  if (!valido) {
    return <main className="control-act"><h1>Control del partido</h1><p className="aviso-control" role="alert">{MENSAJES['enlace-invalido']}</p></main>
  }

  const preview = vista.clase === 'ok' ? vista.datos : null
  const registro = local.tipo === 'valido' ? local.registro : null
  const interrumpido = registro?.estado === 'activando' && !enVuelo
  const iniciado = preview && preview.estado !== 'programado' && preview.estado !== null
  const puedeEscribirCodigo = enEnvio || (local.tipo === 'ninguno' ? (preview && !iniciado) : (local.tipo === 'valido' && registro.estado !== 'activada' && !(registro.estado === 'activando' && enVuelo)))

  return (
    <main className="control-act">
      <h1>Control del partido</h1>
      <p className="sub">Activa este teléfono con el código que te dio el organizador.</p>

      <GuiaEnLinea />

      <section className="partido-vista" aria-label="Partido">
        {vista.clase === 'cargando' && <p className="sub" role="status">Buscando el partido…</p>}
        {preview && (
          <>
            <div className="equipos">{preview.local} — {preview.visita}</div>
            <div className="sub">{preview.liga}{preview.estado ? ` · ${ESTADO_PARTIDO[preview.estado]}` : ''}</div>
          </>
        )}
        {vista.clase === 'no-encontrada' && <p role="alert">{MENSAJES['no-encontrada']}</p>}
        {(vista.clase === 'incierta' || vista.clase === 'sin-conexion') && (
          <p role="alert">
            No pudimos cargar los datos del partido.{' '}
            <button type="button" className="btn fantasma" onClick={cargarVista}>Reintentar</button>
          </p>
        )}
      </section>

      <p className="no-puntua">
        Activar este teléfono no inicia el partido ni permite puntuar todavía. Cuando el teléfono esté activado, abre el control para comenzar el partido.
      </p>

      {local.tipo === 'no-disponible' && <p className="aviso-control" role="alert">{MENSAJES.almacenamiento}</p>}
      {local.tipo === 'corrupto' && <p className="aviso-control" role="alert">{MENSAJES.corrupto}</p>}

      {registro?.estado === 'activada' && (
        <section className="estado-guardado" aria-label="Activación">
          <h2>{sonda?.tipo === 'vigente' ? 'Teléfono activado' : sonda?.tipo === 'acceso-confirmado-sin-estado' ? 'Acceso confirmado' : 'Activación guardada'}</h2>
          {sonda?.tipo === 'vigente' ? (
            <p role="status">
              Comprobado ahora: el servidor reconoce este teléfono como controlador activo de este partido.
              {' '}El partido: {ESTADO_PARTIDO[sonda.datos.estadoPartido]}.
            </p>
          ) : sonda?.tipo === 'acceso-confirmado-sin-estado' ? (
            <>
              <p role="status">{MENSAJES['acceso-confirmado-sin-estado']}</p>
              <p className="sub">Esto no indica que el partido esté listo para puntuar.</p>
            </>
          ) : sonda?.tipo === 'no-activa' ? (
            <p role="alert">{MENSAJES['no-activa']}</p>
          ) : sonda?.tipo === 'sin-resultado' ? (
            <p role="status">{MENSAJES['sin-resultado']}</p>
          ) : (
            <p role="status">Activación guardada en este teléfono. No se ha comprobado ahora.</p>
          )}
          <Fechas servidor={registro.servidor} actual={sonda?.tipo === 'vigente'} />
          <p className="sub">Si el control se retira, el organizador debe revisarlo. Después de empezar el partido no hay traspaso ni toma de control.</p>
          <Link className="btn" to={`/control/${ligaId}/${partidoId}/marcador`}>Abrir control</Link>
          <button type="button" className="btn fantasma" onClick={comprobar} disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Comprobar ahora'}</button>
        </section>
      )}

      {registro && registro.estado !== 'activada' && (
        <section className="estado-guardado" aria-label="Activación">
          {registro.estado === 'activando' && enVuelo && <p role="status">Activando… hay un intento en curso en otra pestaña.</p>}
          {(registro.estado === 'incierta' || interrumpido) && (
            <>
              <h2>Activación sin confirmar</h2>
              <p role="alert">
                {interrumpido ? 'La página se cerró o se recargó mientras se activaba. ' : ''}{MENSAJES.incierta}
              </p>
            </>
          )}
          {registro.estado === 'denegada' && <><h2>Teléfono sin activar</h2><p role="status">Hay una identidad guardada para este partido, pero el servidor todavía no la activó.</p></>}
          {sonda?.tipo === 'no-activa' && <p role="alert">{MENSAJES['no-activa']}</p>}
          {sonda?.tipo === 'sin-resultado' && <p role="status">{MENSAJES['sin-resultado']}</p>}
          {(registro.estado === 'incierta' || interrumpido) && (
            <button type="button" className="btn fantasma" onClick={comprobar} disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Comprobar ahora'}</button>
          )}
        </section>
      )}

      {mensaje && <p className="aviso-control" role="alert">{mensaje}</p>}

      {iniciado && local.tipo === 'ninguno' && (
        <p className="aviso-control" role="note">Este partido ya {preview.estado === 'final' ? 'terminó' : 'está en curso'}: no se puede activar un teléfono nuevo.</p>
      )}

      {puedeEscribirCodigo && (
        <form onSubmit={enviar} method="post" autoComplete="off" noValidate>
          <div className="campo">
            <label htmlFor="codigo-partido">Código del partido</label>
            <input
              id="codigo-partido"
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              maxLength={64}
              data-lpignore="true"
              data-1p-ignore="true"
              enterKeyHint="go"
              disabled={ocupado}
            />
          </div>
          <button type="submit" className="btn" disabled={ocupado || codigo.trim() === ''}>{ocupado ? 'Activando…' : 'Activar este teléfono'}</button>
        </form>
      )}
    </main>
  )
}
