import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { emitirCodigo, leerControl, revocarControl } from '../lib/control-organizador-api'
import { useRecurso } from '../lib/publico/hooks.js'
import { recursoLiga } from '../lib/publico/recursos.js'
import { enlacesDePartidos } from '../lib/publico/urls.js'
import { fechaCortaPanama, horaPanama, textoSede } from '../lib/publico/formato.js'
import { idValido, SIN_CONEXION } from '../lib/roster-api'
import { invalidar, useSesionServidor } from '../lib/sesion-servidor'
import { RUTA_PANEL, rutaActivacion, rutaLiga } from '../lib/rutas-organizador'
import { EnlaceVolver, Protegida } from './ComunOrganizador'
import CompartirPartido from './publico/CompartirPartido'
import InvitacionActivacion from './InvitacionActivacion'
import { copiarTexto } from '../lib/publico/compartir.js'

// Acceso de puntuación de UN partido, para el organizador (modo compartido): /organizador/ligas/:ligaId/partidos/:gameId.
//   - Al abrir y al refrescar solo se LEE (estado del control, sin secretos). Emitir un código es una acción explícita de la persona.
//   - El código se muestra una sola vez, solo en el estado de esta pantalla: no va en la dirección, ni en ningún almacenamiento, ni en
//     la consola. Se borra al ocultarlo, al salir de la pantalla y cuando la sesión termina.
//   - Emitir NO inicia el partido ni activa ningún teléfono: el teléfono se activa en /control/:ligaId/:gameId con ese código.
//   - Emitir otro código anula el que siga sin usar. Si la respuesta se pierde, no se repite sola: el código no se puede volver a ver y
//     la persona decide si emite uno nuevo.

export const ESTADO_TEXTO = { programado: 'Programado', vivo: 'En curso', final: 'Terminado' }
const CREDENCIAL_TEXTO = {
  ninguna: 'Ningún teléfono activado todavía.',
  activa: 'Ya hay un teléfono activado para este partido.',
  'solo-recibos': 'El teléfono activado ya no puede enviar acciones nuevas; solo repetir las ya enviadas.',
  vencida: 'La activación anterior venció.',
}
const MENSAJES = {
  'sin-conexion': SIN_CONEXION,
  'partido-iniciado': 'Este partido ya no está programado: no se puede emitir un código. No se creó nada.',
  'no-encontrado': 'No encontramos ese partido, o no tienes acceso.',
  protocolo: 'El servidor no aceptó la petición. No se emitió ningún código. Recarga la página e inténtalo de nuevo.',
  incierto: 'No pudimos confirmar si se emitió un código. Si se emitió, no se puede volver a mostrar. '
    + 'Comprueba el estado; si hace falta, emite un código nuevo (anula cualquier código sin usar).',
}

// Retiro del acceso del teléfono (REPORT_181). Texto por resultado; ninguno afirma más de lo que el servidor dijo.
const MENSAJES_RETIRO = {
  'sin-conexion': SIN_CONEXION,
  'partido-iniciado': 'El partido ya empezó: cambiar el teléfono que controla después del inicio no está disponible en este piloto. No se cambió nada.',
  'no-encontrado': 'No encontramos ese partido, o no tienes acceso.',
  protocolo: 'El servidor no aceptó la petición, así que no se cambió nada. Recarga la página e inténtalo de nuevo.',
  incierto: 'No sabemos si el servidor retiró el acceso. No se repite solo y no se genera ningún código. Pulsa «Comprobar estado» para leer el estado actual.',
  comprobado: 'Estado leído del servidor ahora. Esta lectura muestra cómo está el acceso; no indica qué petición produjo ese estado.',
}

export const fechaHora = (ms) => `${fechaCortaPanama(ms)}, ${horaPanama(ms)}`

function Contenido({ ligaId, gameId }) {
  const { datos: sesion } = useSesionServidor()
  const permitido = sesion.ligas.includes(ligaId)
  const def = useMemo(() => (permitido ? recursoLiga(ligaId) : null), [permitido, ligaId])
  const liga = useRecurso(def)
  const [control, setControl] = useState({ cargando: true, res: null })
  const [ocupado, setOcupado] = useState(false)
  const [emitido, setEmitido] = useState(null) // { codigo, expiraEn } solo en memoria de esta pantalla
  const [aviso, setAviso] = useState(null)
  const [confirmandoRetiro, setConfirmandoRetiro] = useState(false)
  const [copiaCodigo, setCopiaCodigo] = useState(null) // null | 'ok' | 'fallo': solo mientras el código esté a la vista
  const campoCodigo = useRef(null)
  const [retirando, setRetirando] = useState(false) // distingue el texto de los botones: ocupado es de cualquiera de las dos mutaciones
  const [retiro, setRetiro] = useState(null) // null | { tipo: 'ok' | 'sin-nada' | clave de MENSAJES_RETIRO }
  const enVuelo = useRef(false)
  const vivo = useRef(true)
  const lecturas = useRef(0)

  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  // El aviso de «copiado» pertenece a ESTE código: al ocultarlo, emitir otro o salir de la pantalla no queda nada.
  useEffect(() => { setCopiaCodigo(null) }, [emitido])
  useEffect(() => { if (copiaCodigo === 'fallo') { campoCodigo.current?.focus(); campoCodigo.current?.select() } }, [copiaCodigo])

  const releer = useCallback(async () => {
    const mio = ++lecturas.current
    setControl((c) => ({ ...c, cargando: true }))
    const res = await leerControl(ligaId, gameId)
    if (!vivo.current || mio !== lecturas.current) return
    if (res.tipo === 'no-autorizado') { invalidar(); return }
    setControl({ cargando: false, res })
  }, [ligaId, gameId])
  useEffect(() => { if (permitido && idValido(gameId)) releer() }, [permitido, gameId, releer])

  // El panel de confirmación solo existe mientras la última lectura siga mostrando un acceso que retirar: si el estado cambia, se cierra (nunca queda abierto de otra vez).
  const lecturaControl = control.res?.tipo === 'ok' ? control.res.datos : null
  useEffect(() => {
    if (!(lecturaControl && lecturaControl.partido === 'programado' && lecturaControl.credencial !== 'ninguna')) setConfirmandoRetiro(false)
  }, [lecturaControl?.partido, lecturaControl?.credencial]) // eslint-disable-line react-hooks/exhaustive-deps

  // Copia EXACTAMENTE el código que está a la vista en el estado de esta pantalla: no pide ni emite nada, y no lo guarda en ninguna parte.
  async function copiarCodigo() {
    if (!emitido) return
    if (await copiarTexto(emitido.codigo)) { setCopiaCodigo('ok'); return }
    setCopiaCodigo('fallo') // el campo de respaldo se pinta con este estado; el efecto de abajo lo enfoca y lo selecciona
  }

  async function emitir() {
    if (enVuelo.current) return // una sola petición a la vez, aunque se pulse dos veces antes de que se pinte el estado
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    setRetiro(null)
    setConfirmandoRetiro(false)
    setEmitido(null)
    try {
      const r = await emitirCodigo(ligaId, gameId)
      if (!vivo.current) return
      if (r.tipo === 'sesion') { invalidar(); return }
      if (r.tipo === 'emitido') setEmitido({ codigo: r.codigo, expiraEn: r.expiraEn })
      else setAviso(r.tipo)
    } finally {
      enVuelo.current = false
      if (vivo.current) { setOcupado(false); releer() }
    }
  }

  // Retirar el acceso: una mutación a la vez (comparte el cerrojo con la emisión de códigos), solo tras una confirmación explícita. Abrir el
  // panel no envía nada. Tras la respuesta se vuelve a LEER el estado; nunca se emite un código solo.
  async function retirar() {
    if (enVuelo.current) return
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    setRetiro(null)
    setConfirmandoRetiro(false)
    setRetirando(true)
    try {
      const r = await revocarControl(ligaId, gameId)
      if (!vivo.current) return
      if (r.tipo === 'sesion') { invalidar(); return }
      setEmitido(null) // un código mostrado pudo quedar revocado: no se deja a la vista
      if (r.tipo === 'revocado') setRetiro({ tipo: r.credencialesRevocadas > 0 ? 'ok' : 'sin-nada' })
      else setRetiro({ tipo: r.tipo })
    } finally {
      enVuelo.current = false
      if (vivo.current) { setRetirando(false); setOcupado(false); releer() }
    }
  }
  const comprobarEstado = async () => { await releer(); if (vivo.current) setRetiro({ tipo: 'comprobado' }) }

  if (!permitido || !idValido(gameId)) {
    return <main className="panel"><p className="aviso-panel" role="alert">No tienes acceso a esa liga.</p><EnlaceVolver to={RUTA_PANEL}>Mis ligas</EnlaceVolver></main>
  }

  const d = liga.datos
  const partido = d?.partidos.find((p) => p.gameId === gameId) ?? null
  const nombre = (id) => d?.equipos.find((e) => e.id === id)?.nombre ?? id
  const publico = d && partido ? enlacesDePartidos(d).get(gameId) : null
  const c = control.res?.tipo === 'ok' ? control.res.datos : null
  const puedeEmitir = Boolean(c && c.partido === 'programado' && c.credencial === 'ninguna')
  const urlActivacion = rutaActivacion(ligaId, gameId)

  return (
    <main className="panel">
      <p className="nav-panel"><EnlaceVolver to={rutaLiga(ligaId)}>{d ? d.liga.nombre : 'Liga'}</EnlaceVolver></p>
      <h1>{partido ? `${nombre(partido.local.id)} — ${nombre(partido.visita.id)}` : 'Partido'}</h1>
      {partido ? (
        <p className="sub">
          {ESTADO_TEXTO[partido.estado]}
          {partido.programadoPara ? ` · ${fechaCortaPanama(partido.programadoPara)}, ${horaPanama(partido.programadoPara)}` : ' · Fecha por confirmar'}
          {textoSede(partido) ? ` · ${textoSede(partido)}` : ''}
        </p>
      ) : (
        <p className="sub">{liga.fase === 'cargando' ? 'Cargando…' : 'No pudimos cargar los datos del partido.'}</p>
      )}
      {publico && (
        <section aria-label="Marcador público" className="bloque-acciones">
          <p className="sub">El marcador público es solo para mirar y compartir: no sirve para puntuar.</p>
          <div className="acciones-fila">
            <Link className="btn fantasma" to={publico}>Ver marcador público</Link>
            <CompartirPartido
              ruta={publico}
              partido={{ liga: d.liga.nombre, local: nombre(partido.local.id), visita: nombre(partido.visita.id), estado: partido.estado, programadoPara: partido.programadoPara, inicioReal: partido.inicioReal, sede: partido.sede, puntosLocal: partido.local.puntos, puntosVisita: partido.visita.puntos }}
            />
          </div>
        </section>
      )}

      <h2>Acceso de puntuación</h2>
      <p className="sub">
        Para puntuar, el teléfono del árbitro se activa con un código de este partido. Desde aquí no se abre la consola de un teléfono ya activado:
        la consola solo la usa el teléfono que tiene el control.
      </p>
      <div className="acciones-fila">
        <Link className="btn fantasma" to={urlActivacion}>Abrir pantalla de activación</Link>
      </div>
      {partido?.estado === 'programado' && (
        <InvitacionActivacion ligaId={ligaId} gameId={gameId} partido={{ local: nombre(partido.local.id), visita: nombre(partido.visita.id) }} />
      )}
      {control.cargando && !c && <p className="sub" role="status">Comprobando…</p>}
      {control.res && !c && (
        <div className="aviso-panel" role="alert">
          <p style={{ margin: '0 0 10px' }}>
            {control.res.tipo === 'sin-conexion' ? SIN_CONEXION
              : control.res.tipo === 'no-encontrado' ? MENSAJES['no-encontrado']
                : 'No pudimos comprobar el estado del control. Inténtalo de nuevo.'}
          </p>
          <button type="button" className="btn fantasma" onClick={releer} disabled={control.cargando}>Reintentar</button>
        </div>
      )}
      {c && (
        <>
          <p className="sub" role="status">
            {CREDENCIAL_TEXTO[c.credencial]}
            {c.codigoPendiente ? ` Hay un código sin usar${c.codigoExpiraEn ? ` que vence el ${fechaHora(c.codigoExpiraEn)}` : ''}.` : ''}
          </p>
          {c.partido !== 'programado' && (
            <p className="aviso-panel" role="note">
              Este partido ya {c.partido === 'final' ? 'terminó' : 'está en curso'}: no se puede emitir un código nuevo. Cambiar el teléfono que controla después del inicio no está disponible en este piloto.
            </p>
          )}
          {c.partido === 'programado' && c.credencial !== 'ninguna' && (
            <>
              <p className="aviso-panel" role="note">
                {c.credencial === 'activa'
                  ? 'Hay un teléfono con acceso. Un código nuevo no lo reemplaza: para usar otro teléfono, retira primero el acceso de este y luego genera un código nuevo.'
                  : 'Este partido todavía tiene una activación anterior sin retirar (ya no procesa acciones nuevas), y eso impide activar otro teléfono. Retira su acceso para poder generar un código nuevo.'}
              </p>
              {confirmandoRetiro ? (
                <div className="cp-confirmar confirmar-retiro" role="group" aria-label="Confirmar el retiro del acceso del teléfono">
                  <p>
                    El teléfono que está activado ahora perderá el permiso para iniciar el partido y puntuar. Esto NO inicia el partido. Después tendrás que generar un
                    código nuevo, aparte y a propósito, para el teléfono correcto. Cualquier código sin usar también queda anulado.
                  </p>
                  <div className="acciones-fila">
                    <button type="button" className="btn fantasma" onClick={() => setConfirmandoRetiro(false)} disabled={ocupado}>Cancelar</button>
                    <button type="button" className="btn" onClick={retirar} disabled={ocupado}>{retirando ? 'Retirando…' : 'Sí, retirar el acceso'}</button>
                  </div>
                </div>
              ) : (
                <div className="acciones-fila">
                  <button type="button" className="btn fantasma" onClick={() => setConfirmandoRetiro(true)} disabled={ocupado || control.cargando}>Retirar acceso del teléfono</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {aviso && <p className="aviso-panel" role="alert">{MENSAJES[aviso] ?? MENSAJES.incierto}</p>}
      {retiro && (
        <p className="aviso-panel" role={retiro.tipo === 'ok' || retiro.tipo === 'sin-nada' || retiro.tipo === 'comprobado' ? 'status' : 'alert'} data-retiro={retiro.tipo}>
          {retiro.tipo === 'ok'
            ? 'Acceso retirado. El teléfono que estaba activado ya no puede iniciar el partido ni puntuar. El partido NO se ha iniciado y no se generó ningún código: genera uno nuevo cuando quieras, para el teléfono correcto.'
            : retiro.tipo === 'sin-nada'
              ? 'El servidor no encontró ningún teléfono con acceso que retirar (ya estaba retirado o nunca se activó). No se generó ningún código.'
              : MENSAJES_RETIRO[retiro.tipo]}
        </p>
      )}
      {retiro?.tipo === 'incierto' && (
        <p><button type="button" className="btn fantasma" onClick={comprobarEstado} disabled={control.cargando || ocupado}>Comprobar estado</button></p>
      )}

      {emitido ? (
        <section className="codigo-emitido" aria-label="Código del partido">
          <p className="sub">Código del partido (se muestra una sola vez):</p>
          <output className="codigo-valor" aria-live="polite">{emitido.codigo}</output>
          <p className="sub">Vence el {fechaHora(emitido.expiraEn)}. Anota o dicta el código ahora; no se puede volver a ver.</p>
          <p className="sub">
            Emitir el código no inicia el partido. Abre la pantalla de activación en el teléfono que va a puntuar y escribe el código allí:
          </p>
          <p className="sub">Usa «Abrir pantalla de activación» en ese teléfono ({urlActivacion}) y escribe el código allí. El código se comparte aparte del enlace.</p>
          <div className="acciones-fila">
            <button type="button" className="btn fantasma" onClick={copiarCodigo} data-codigo="copiar">Copiar código</button>
            <button type="button" className="btn fantasma" onClick={() => setEmitido(null)}>Ocultar código</button>
          </div>
          <p className={`invitacion-estado ${copiaCodigo === 'fallo' ? 'fallo' : ''}`} role="status" data-codigo="estado">
            {copiaCodigo === 'ok' ? 'Código copiado.' : copiaCodigo === 'fallo' ? 'No se pudo copiar el código. Selecciónalo abajo y cópialo a mano.' : ''}
          </p>
          {copiaCodigo === 'fallo' && (
            <label className="invitacion-campo">
              <span>Código para copiar a mano</span>
              <input ref={campoCodigo} type="text" readOnly value={emitido.codigo} onFocus={(e) => e.currentTarget.select()} aria-label="Código para copiar a mano" autoComplete="off" />
            </label>
          )}
        </section>
      ) : (
        <>
          <button type="button" className="btn" onClick={emitir} disabled={ocupado || !puedeEmitir}>
            {ocupado && !retirando ? 'Emitiendo…' : c?.codigoPendiente || aviso === 'incierto' ? 'Emitir un código nuevo' : 'Obtener código de acceso'}
          </button>
          {c?.codigoPendiente && puedeEmitir && <p className="sub">Un código nuevo anula el que está sin usar.</p>}
          {aviso === 'incierto' && (
            <p><button type="button" className="btn fantasma" onClick={releer} disabled={control.cargando || ocupado}>Comprobar estado</button></p>
          )}
        </>
      )}
    </main>
  )
}

export default function PartidoOrganizador() {
  const { ligaId, gameId } = useParams()
  return <Protegida><Contenido key={`${ligaId}/${gameId}`} ligaId={ligaId} gameId={gameId} /></Protegida>
}
