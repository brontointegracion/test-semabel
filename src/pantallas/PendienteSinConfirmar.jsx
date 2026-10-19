import { rutaEquipo } from '../lib/rutas-organizador'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MAX_LIGAS_PROPIAS, MENSAJES_BLOQUEO, leerRegistros, reintentar, suscribirRegistros } from '../lib/operacion-pendiente'
import { invalidar } from '../lib/sesion-servidor'
import { textoDeResultado } from './ComunOrganizador'

// Acciones enviadas cuyo resultado NO se conoce, y registros que no se pueden interpretar. Nada se reenvía solo.

/** Registros de recuperación de este organizador; se relee al cambiar el almacenamiento (otra pestaña) y al volver. */
export function useRegistros(organizadorId) {
  const [lectura, setLectura] = useState(() => leerRegistros(organizadorId))
  const releer = useCallback(() => setLectura(leerRegistros(organizadorId)), [organizadorId])
  useEffect(() => {
    releer()
    const alCambiar = () => releer()
    window.addEventListener('storage', alCambiar)
    window.addEventListener('focus', alCambiar)
    const baja = suscribirRegistros(alCambiar)
    return () => { baja(); window.removeEventListener('storage', alCambiar); window.removeEventListener('focus', alCambiar) }
  }, [releer])
  return [lectura, releer]
}

/**
 * ¿Está ahora mismo en vuelo (en esta u otra pestaña) el envío de un registro «enviando»? Se sabe porque quien envía
 * mantiene el candado de su liga hasta clasificar la respuesta. Sin Web Locks no se puede saber: se trata como no en vuelo.
 * → { [ligaId]: 'si' | 'no' } solo para los registros «enviando»; falta la clave mientras se consulta.
 */
function useEnVuelo(organizadorId, registros) {
  const [estado, setEstado] = useState({})
  const firma = JSON.stringify(registros.map((r) => [r.ligaId, r.registro?.ultimo, r.registro?.intentos]))
  useEffect(() => {
    let vivo = true
    const enviando = registros.filter((r) => r.valido && r.registro.ultimo === 'enviando')
    if (enviando.length === 0) { setEstado({}); return undefined }
    ;(async () => {
      let retenidos = null
      try { retenidos = (await navigator.locks.query()).held.map((c) => c.name) } catch { /* sin Web Locks */ }
      if (!vivo) return
      setEstado(Object.fromEntries(enviando.map((r) => [r.ligaId, retenidos?.includes(`sebel-op:${organizadorId}:${r.ligaId}`) ? 'si' : 'no'])))
    })()
    return () => { vivo = false }
  }, [firma, organizadorId]) // eslint-disable-line react-hooks/exhaustive-deps
  return estado
}

const NOMBRE_TIPO = { alta: 'Añadir jugador', editar: 'Editar jugador', desactivar: 'Desactivar jugador', reactivar: 'Reactivar jugador' }
const ULTIMO = {
  enviando: 'Se estaba enviando cuando la página se cerró o se recargó.',
  incierto: 'No recibimos respuesta del servidor.',
  sesion: 'La sesión terminó antes de poder confirmarlo.',
  'sin-escritura': 'El último intento no escribió nada, pero un intento anterior sigue sin confirmarse.',
  protocolo: 'El último intento fue rechazado antes de decidirse, pero un intento anterior sigue sin confirmarse.',
  conflicto: 'El servidor respondió con un conflicto de identificador. Se conserva la solicitud original.',
}

function nombreDeAccion(registro) {
  try {
    const campos = JSON.parse(registro.cuerpoJson).campos
    const nombre = [campos?.nombrePila, campos?.apellido1].filter((x) => typeof x === 'string' && x).join(' ')
    return nombre || null
  } catch {
    return null
  }
}

/**
 * Banner de lo que está sin confirmar. `ligaId` filtra a una liga. `onCambio` avisa de que algo se resolvió (recargar datos).
 */
export default function PendienteSinConfirmar({ organizadorId, ligaId = null, nombresLigas = {}, onCambio = () => {} }) {
  const [lectura, releer] = useRegistros(organizadorId)
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState(null)
  const [aviso, setAviso] = useState(null) // «hay un envío en curso»: se retira solo cuando el registro cambia
  const firma = JSON.stringify(lectura.registros.map((r) => [r.ligaId, r.valido, r.registro?.ultimo, r.registro?.intentos]))
  useEffect(() => { setAviso(null) }, [firma])
  const filas = lectura.registros.filter((r) => ligaId === null || r.ligaId === ligaId)
  const enVuelo = useEnVuelo(organizadorId, lectura.registros)

  async function repetir(liga) {
    if (ocupado) return
    setOcupado(true)
    setMensaje(null)
    let ocupadoPorOtro = false
    try {
      const r = await reintentar({ organizadorId, ligaId: liga })
      if (r.tipo === 'bloqueado' && r.motivo === 'ocupado') { ocupadoPorOtro = true; setAviso(MENSAJES_BLOQUEO.ocupado) }
      else if (r.tipo === 'bloqueado') setMensaje(MENSAJES_BLOQUEO[r.motivo] ?? MENSAJES_BLOQUEO['cuerpo-invalido'])
      else if (r.tipo === 'decidido') {
        setMensaje(`${textoDeResultado(r.cuerpo, r.reproducido)}.`)
        if (r.limpiezaFallida) setMensaje((m) => `${m} No pudimos borrar el registro de recuperación; repetirlo solo devolverá este mismo resultado.`)
        onCambio()
      } else if (r.tipo === 'sesion') { invalidar() }
      else if (r.tipo === 'incierto') setMensaje('Seguimos sin recibir una respuesta. La acción sigue sin confirmarse; puedes volver a repetir la misma solicitud.')
      else if (r.tipo === 'conflicto') setMensaje('El servidor respondió con un conflicto. La solicitud original se conserva sin cambios; no la reemplazamos.')
      else if (r.resuelta) { setMensaje('El servidor no aplicó esta acción. Puedes volver a intentarlo desde la plantilla.'); onCambio() }
      else setMensaje('Este intento no se pudo completar, pero un intento anterior sigue sin confirmarse. Puedes repetir la misma solicitud.')
    } finally {
      if (!ocupadoPorOtro) releer()
      setOcupado(false)
    }
  }

  if (!lectura.disponible) {
    return (
      <div className="aviso-panel" role="alert">
        <p style={{ margin: 0 }}>{MENSAJES_BLOQUEO.almacenamiento}</p>
      </div>
    )
  }
  if (filas.length === 0 && !mensaje && !aviso) return null
  return (
    <section className="pendiente-panel" aria-label="Acciones sin confirmar">
      {filas.map((f) => (f.valido && f.registro.ultimo === 'enviando' && enVuelo[f.ligaId] !== 'no' ? (
        <div key={f.ligaId} className="pendiente-fila" role="status" aria-label={`Enviando en ${nombresLigas[f.ligaId] ?? f.ligaId}`}>
          <p style={{ margin: 0 }}>Enviando una acción… espera la respuesta. Mientras tanto no se puede enviar otra en esta liga.</p>
        </div>
      ) : (
        <div key={f.ligaId} className="pendiente-fila" role="group" aria-label={`Acción sin confirmar en ${nombresLigas[f.ligaId] ?? f.ligaId}`}>
          {f.valido ? (
            <>
              <h3>Acción sin confirmar</h3>
              <p style={{ margin: '0 0 6px' }}>
                {NOMBRE_TIPO[f.registro.tipo]}{nombreDeAccion(f.registro) ? `: ${nombreDeAccion(f.registro)}` : ''} · {nombresLigas[f.ligaId] ?? f.ligaId}
              </p>
              <p className="sub" style={{ margin: '0 0 6px' }}>
                No sabemos si el servidor aplicó esta acción. {ULTIMO[f.registro.ultimo]} No la damos por guardada ni por perdida, y mientras tanto no se puede enviar otra acción en esta liga.
                Repetir envía exactamente la misma solicitud: si ya se había aplicado, verás el resultado original y no se duplica.
                La plantilla se puede consultar, pero no cambiar.
              </p>
              <div className="btn-fila" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn" onClick={() => repetir(f.ligaId)} disabled={ocupado}>
                  {ocupado ? 'Repitiendo…' : 'Repetir la misma solicitud'}
                </button>
                <Link className="btn fantasma" to={rutaEquipo(f.ligaId, f.registro.equipoId)}>Ver la plantilla</Link>
              </div>
              <details style={{ marginTop: 10 }}>
                <summary>Cómo se conserva esto</summary>
                <p className="sub">
                  Se guarda solo este registro (la solicitud enviada y su identificador) en este navegador, hasta que el servidor confirme un resultado. Cerrar sesión no lo borra.
                  No está cifrado: quien inspeccione este dispositivo puede leerlo. Si se borran los datos del navegador, se cierra una ventana privada, el navegador lo elimina o se pierde el dispositivo,
                  puede desaparecer y ya no se podrá repetir exactamente. Entonces revisa la plantilla antes de enviar nada. (Máximo {MAX_LIGAS_PROPIAS} acciones sin confirmar.)
                </p>
              </details>
            </>
          ) : (
            <>
              <h3>Registro de recuperación ilegible</h3>
              <p className="sub" style={{ margin: 0 }}>
                Hay un registro guardado para la liga «{nombresLigas[f.ligaId] ?? f.ligaId}» que no podemos interpretar. Se conserva sin tocar y no se enviará ni se borrará.
                Mientras exista no se pueden enviar acciones en esa liga. Revisa la plantilla para ver su estado real.
              </p>
            </>
          )}
        </div>
      )))}
      {mensaje && <p role="status" className="sub" style={{ margin: '8px 0 0' }}>{mensaje}</p>}
      {aviso && <p role="status" className="sub" style={{ margin: '8px 0 0' }}>{aviso}</p>}
    </section>
  )
}
