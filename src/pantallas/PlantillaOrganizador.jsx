import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MENSAJES_BLOQUEO, enviarNueva } from '../lib/operacion-pendiente'
import { leerLiga, leerPlantilla } from '../lib/roster-api'
import { invalidar, useSesionServidor } from '../lib/sesion-servidor'
import { RUTA_PANEL, rutaLiga } from '../lib/rutas-organizador'
import { EnlaceVolver, ErrorDeLectura, HojaOrganizador, Protegida, textoDeResultado, useLectura } from './ComunOrganizador'
import FormularioJugadorCompartido from './FormularioJugadorCompartido'
import PendienteSinConfirmar, { useRegistros } from './PendienteSinConfirmar'

// Plantilla de un equipo, del SERVIDOR. Lo que se ve es lo que el servidor devolvió en la última lectura: nada local,
// ningún dato de demostración, ningún rol guardado en el navegador.

const MENSAJE_BLOQUEO = 'Hay un partido de este equipo en curso o en pausa. La plantilla se puede consultar, pero no cambiar hasta que termine. Una hora programada, por sí sola, no la bloquea.'
const etiquetaNumero = (d) => (Number.isInteger(d) ? `#${d}` : '—')

function ConfirmarCambio({ tipo, ficha, deshabilitadoPor, onEnviar, onExito, onRefrescar, onCerrar }) {
  const [numero, setNumero] = useState(Number.isInteger(ficha.dorsal) ? String(ficha.dorsal) : '')
  const [aviso, setAviso] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const guardia = useRef(false)
  const sinNumero = !Number.isInteger(ficha.dorsal)
  const nombre = ficha.nombre ?? [ficha.nombrePila, ficha.apellido1].filter(Boolean).join(' ')

  async function confirmar() {
    if (guardia.current) return
    if (tipo === 'reactivar' && sinNumero && numero.trim() === '') { setAviso('Este registro no tiene número. Escribe uno de 0 a 99 para reactivarlo.'); return }
    guardia.current = true
    setOcupado(true)
    setAviso(null)
    try {
      const contenido = { revEsperada: ficha.rev }
      if (tipo === 'reactivar' && numero.trim() !== '' && (sinNumero || numero.trim() !== String(ficha.dorsal))) contenido.nuevoDorsal = numero.trim()
      const r = await onEnviar(contenido)
      if (r.k === 'sin-resolver') return onCerrar()
      if (r.k === 'bloqueado' || r.k === 'no-aplicada') return setAviso(r.texto)
      if (r.cuerpo.resultado === 'aplicado') { onExito(r.cuerpo, r.reproducido); return onCerrar() }
      onRefrescar()
      if (r.cuerpo.tipo === 'conflicto-numero') setAviso('Ese número ya lo tiene otro jugador activo de este equipo. Escribe otro.')
      else if (r.cuerpo.tipo === 'invalido') setAviso(r.cuerpo.errores?.dorsal ?? r.cuerpo.errores?.numeroPendiente ?? 'Hay datos no válidos.')
      else setAviso(`${textoDeResultado(r.cuerpo, false)}. Revisa la plantilla actualizada y vuelve a intentarlo.`)
    } finally {
      guardia.current = false
      setOcupado(false)
    }
  }

  return (
    <HojaOrganizador titulo={tipo === 'desactivar' ? 'Desactivar jugador' : 'Reactivar jugador'} onCerrar={onCerrar}>
      {aviso && <p className="aviso-panel" role="alert">{aviso}</p>}
      {deshabilitadoPor && <p className="aviso-panel" role="note">{deshabilitadoPor}</p>}
      {tipo === 'desactivar' ? (
        <p style={{ margin: '0 0 14px' }}>
          <strong>{nombre}</strong> pasará a Inactivos. Se conserva su ficha y su historial, y su número queda libre. No se elimina a nadie.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 12px' }}><strong>{nombre}</strong> volverá a la plantilla activa con su ficha e historial.</p>
          <div className="campo">
            <label htmlFor="rj-numero">Número{sinNumero ? ' *' : ''}</label>
            <input id="rj-numero" type="number" inputMode="numeric" min={0} max={99} step={1} value={numero} onChange={(e) => setNumero(e.target.value)} />
            <span className="sub" style={{ fontSize: '0.78rem' }}>
              {sinNumero ? 'Este registro es anterior y no tiene número: hace falta uno (0 a 99, sin repetir).' : 'Se recupera su número anterior si sigue libre; si otro jugador lo tiene, escribe uno nuevo.'}
            </span>
          </div>
        </>
      )}
      <div className="btn-fila">
        <button type="button" className="btn fantasma" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
        <button type="button" className="btn" onClick={confirmar} disabled={ocupado || Boolean(deshabilitadoPor)}>
          {ocupado ? 'Enviando…' : tipo === 'desactivar' ? 'Desactivar' : 'Reactivar'}
        </button>
      </div>
    </HojaOrganizador>
  )
}

function ContenidoPlantilla({ ligaId, equipoId, organizadorId, ligas }) {
  const [liga, recargarLiga] = useLectura(() => leerLiga(ligaId), [ligaId])
  const [plantilla, recargar] = useLectura(() => leerPlantilla(ligaId, equipoId), [ligaId, equipoId])
  const [registros, releerRegistros] = useRegistros(organizadorId)
  const [nombresLigas, setNombresLigas] = useState({})
  const [formulario, setFormulario] = useState(null) // { modo, ficha }
  const [cambio, setCambio] = useState(null) // { tipo, ficha }
  const [aviso, setAviso] = useState(null)
  const enVuelo = useRef(false)

  const otrasLigas = ligas.filter((l) => l !== ligaId)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const lecturas = await Promise.all(otrasLigas.map(async (id) => [id, await leerLiga(id)]))
      if (!vivo) return
      const nombres = {}
      for (const [id, r] of lecturas) {
        if (r.tipo === 'no-autorizado') { invalidar(); return }
        nombres[id] = r.tipo === 'ok' ? r.datos.liga.nombre : null
      }
      setNombresLigas(nombres)
    })()
    return () => { vivo = false }
  }, [ligaId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aviso) return undefined
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  const nombreLiga = liga.res?.tipo === 'ok' ? liga.res.datos.liga.nombre : ligaId
  const nombres = { [ligaId]: nombreLiga, ...Object.fromEntries(Object.entries(nombresLigas).filter(([, v]) => v)) }
  const ligasPropias = otrasLigas.map((id) => ({ id, nombre: nombresLigas[id] ?? id }))
  const datos = plantilla.res?.tipo === 'ok' ? plantilla.res.datos : null
  const pendienteEnLiga = registros.registros.some((r) => r.ligaId === ligaId)
  const bloqueada = datos?.bloqueada === true
  const deshabilitadoPor = !registros.disponible ? MENSAJES_BLOQUEO.almacenamiento
    : pendienteEnLiga ? 'Hay una acción sin confirmar en esta liga. Confírmala antes de enviar otra.'
      : bloqueada ? MENSAJE_BLOQUEO : null

  function refrescarTodo() { recargar(); recargarLiga(); releerRegistros() }

  /** Un envío nuevo; devuelve algo que las hojas saben interpretar. Nunca reenvía por su cuenta. */
  async function enviar(tipo, fichaId, contenido) {
    if (enVuelo.current) return { k: 'bloqueado', texto: MENSAJES_BLOQUEO.ocupado }
    enVuelo.current = true
    try {
      const r = await enviarNueva({ organizadorId, ligaId, tipo, equipoId, fichaId, contenido })
      releerRegistros()
      if (r.tipo === 'bloqueado') return { k: 'bloqueado', texto: MENSAJES_BLOQUEO[r.motivo] ?? MENSAJES_BLOQUEO['cuerpo-invalido'] }
      if (r.tipo === 'decidido') return { k: 'decidido', cuerpo: r.cuerpo, reproducido: r.reproducido }
      if (r.tipo === 'sesion') { invalidar(); return { k: 'sin-resolver' } }
      if (r.tipo === 'incierto' || r.tipo === 'conflicto') return { k: 'sin-resolver' }
      if (r.resuelta) {
        return {
          k: 'no-aplicada',
          texto: r.motivo === 'identidad-no-verificable'
            ? 'No pudimos leer la otra liga para verificar la identidad, así que no se creó nada. Inténtalo de nuevo.'
            : r.tipo === 'sin-escritura' ? 'El servidor no pudo guardar el cambio; no se aplicó nada. Inténtalo de nuevo.'
              : 'No pudimos enviar esa acción; no se aplicó nada.',
        }
      }
      return { k: 'sin-resolver' }
    } finally {
      enVuelo.current = false
    }
  }

  const exito = (cuerpo, reproducido) => { setAviso(`${textoDeResultado(cuerpo, reproducido)}.`); recargar(); recargarLiga() }

  const fila = (j) => {
    const nombre = j.nombre ?? [j.nombrePila, j.apellido1, j.apellido2].filter(Boolean).join(' ')
    return (
      <li key={j.id} className="fila-jugador">
        <div className="cabeza">
          <span className="numero">{etiquetaNumero(j.dorsal)}</span>
          <span>
            <strong>{nombre}</strong>
            {j.nombreCamiseta ? <span className="sub"> · En camiseta: {j.nombreCamiseta}</span> : null}
          </span>
        </div>
        {!Number.isInteger(j.dorsal) && (
          <p className="sub" role="note" style={{ margin: 0 }}>Sin número: es un registro anterior. Hay que darle un número (de 0 a 99) para poder editarlo o reactivarlo, y antes de empezar un partido.</p>
        )}
        <div className="acciones">
          {j.activo ? (
            <>
              <button type="button" className="btn fantasma" disabled={Boolean(deshabilitadoPor)} onClick={() => setFormulario({ modo: 'editar', ficha: j })}>Editar</button>
              <button type="button" className="btn fantasma" disabled={Boolean(deshabilitadoPor)} onClick={() => setCambio({ tipo: 'desactivar', ficha: j })}>Desactivar</button>
            </>
          ) : (
            <>
              <button type="button" className="btn fantasma" disabled={Boolean(deshabilitadoPor)} onClick={() => setFormulario({ modo: 'editar', ficha: j })}>Editar</button>
              <button type="button" className="btn fantasma" disabled={Boolean(deshabilitadoPor)} onClick={() => setCambio({ tipo: 'reactivar', ficha: j })}>Reactivar</button>
            </>
          )}
        </div>
      </li>
    )
  }

  return (
    <main className="panel">
      <p className="nav-panel"><EnlaceVolver to={rutaLiga(ligaId)}>{nombreLiga}</EnlaceVolver></p>
      <h1>{datos?.equipo?.nombre ?? 'Plantilla'}</h1>
      <PendienteSinConfirmar organizadorId={organizadorId} ligaId={ligaId} nombresLigas={nombres} onCambio={refrescarTodo} />
      {aviso && <p className="aviso-panel" role="status">{aviso}</p>}
      {plantilla.res && plantilla.res.tipo !== 'ok' && <ErrorDeLectura res={plantilla.res} onReintentar={recargar} />}
      {bloqueada && <p className="aviso-panel" role="status">{MENSAJE_BLOQUEO}</p>}
      {datos && (
        <>
          <div className="btn-fila" style={{ marginBottom: 8 }}>
            <button type="button" className="btn" disabled={Boolean(deshabilitadoPor)} onClick={() => setFormulario({ modo: 'alta', ficha: null })}>Añadir jugador</button>
            <button type="button" className="btn fantasma" onClick={refrescarTodo} disabled={plantilla.cargando}>{plantilla.cargando ? 'Actualizando…' : 'Actualizar'}</button>
          </div>
          <h2>Plantilla activa</h2>
          <ul className="lista-panel" aria-label="Plantilla activa">{datos.activos.map(fila)}</ul>
          {datos.activos.length === 0 && <p className="nota-vacia">No hay jugadores activos.</p>}
          <h2>Inactivos</h2>
          <ul className="lista-panel" aria-label="Jugadores inactivos">{datos.inactivos.map(fila)}</ul>
          {datos.inactivos.length === 0 && <p className="nota-vacia">No hay jugadores inactivos.</p>}
        </>
      )}
      {!datos && plantilla.cargando && <p className="sub" role="status">Cargando…</p>}

      {formulario && (
        <FormularioJugadorCompartido
          key={formulario.ficha?.id ?? 'alta'}
          modo={formulario.modo}
          ficha={formulario.ficha}
          ligaId={ligaId}
          nombresLigas={nombres}
          ligasPropias={ligasPropias}
          deshabilitadoPor={deshabilitadoPor}
          onEnviar={(contenido) => enviar(formulario.modo === 'alta' ? 'alta' : 'editar', formulario.ficha?.id ?? null, contenido)}
          onExito={exito}
          onRefrescar={refrescarTodo}
          onCerrar={() => setFormulario(null)}
        />
      )}
      {cambio && (
        <ConfirmarCambio
          key={`${cambio.tipo}:${cambio.ficha.id}`}
          tipo={cambio.tipo}
          ficha={cambio.ficha}
          deshabilitadoPor={deshabilitadoPor}
          onEnviar={(contenido) => enviar(cambio.tipo, cambio.ficha.id, contenido)}
          onExito={exito}
          onRefrescar={refrescarTodo}
          onCerrar={() => setCambio(null)}
        />
      )}
    </main>
  )
}

export default function PlantillaOrganizador() {
  const { ligaId, equipoId } = useParams()
  return (
    <Protegida>
      <ConPermiso ligaId={ligaId} equipoId={equipoId} />
    </Protegida>
  )
}

function ConPermiso({ ligaId, equipoId }) {
  const { datos } = useSesionServidor()
  if (!datos.ligas.includes(ligaId)) {
    return <main className="panel"><p className="aviso-panel" role="alert">No tienes acceso a esa liga.</p><EnlaceVolver to={RUTA_PANEL}>Mis ligas</EnlaceVolver></main>
  }
  return <ContenidoPlantilla key={`${ligaId}/${equipoId}`} ligaId={ligaId} equipoId={equipoId} organizadorId={datos.organizadorId} ligas={datos.ligas} />
}
