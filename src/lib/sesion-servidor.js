import { useSyncExternalStore } from 'react'
import { cerrarSesionEnServidor, consultarSesion, iniciarSesionConCodigo } from './acceso-api'

// ---------------------------------------------------------------------------
// Sesión del organizador según el SERVIDOR. Es lo único que vale en modo compartido: nada de IndexedDB.
//   estado: 'cargando' | 'sin-sesion' | 'activa'
//   datos : { organizadorId, ligas, expiraIdle, expiraAbs } cuando está activa
//   aviso : clave de MENSAJES para mostrar, o null
//   ocupado: hay una petición en curso (se ignoran las repetidas)
// El éxito de una entrada se confirma SIEMPRE con GET /v1/organizador/yo, no con la respuesta del inicio de sesión.
// ---------------------------------------------------------------------------

let estado = { estado: 'cargando', datos: null, aviso: null, ocupado: false }
const oyentes = new Set()
const fijar = (cambios) => { estado = { ...estado, ...cambios }; oyentes.forEach((f) => f()) }

const datosDe = (d) => ({
  organizadorId: String(d?.organizadorId ?? ''),
  ligas: Array.isArray(d?.ligas) ? d.ligas.filter((l) => typeof l === 'string') : [],
  expiraIdle: Number(d?.expiraIdle) || null,
  expiraAbs: Number(d?.expiraAbs) || null,
})

export const leerEstado = () => estado
export const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f) }
export const useSesionServidor = () => useSyncExternalStore(suscribir, leerEstado, leerEstado)

/** Vuelve a preguntar al servidor. Una sesión caducada o cerrada lleva a "sin sesión". */
export async function refrescar({ conAviso = true } = {}) {
  const r = await consultarSesion()
  if (r.tipo === 'ok') {
    fijar({ estado: 'activa', datos: datosDe(r.datos), aviso: null })
  } else if (r.tipo === 'no-autorizado' || r.tipo === 'cerrado') {
    const estabaDentro = estado.estado === 'activa'
    fijar({ estado: 'sin-sesion', datos: null, aviso: estabaDentro && conAviso ? 'sesion-terminada' : estado.aviso })
  } else if (estado.estado === 'cargando') {
    fijar({ estado: 'sin-sesion', datos: null }) // sin respuesta clara al abrir: se pide el código; no se afirma nada
  } // si ya había sesión y no hay respuesta, se conserva lo último confirmado sin inventar nada
  return r
}

/** Marca la sesión como terminada (por ejemplo tras un 401 de otra llamada protegida). */
export const invalidar = () => fijar({ estado: 'sin-sesion', datos: null, aviso: 'sesion-terminada' })

/** El código se recibe, se usa en UNA petición y no se guarda en ninguna parte. */
export async function entrar(codigo) {
  if (estado.ocupado) return
  fijar({ ocupado: true, aviso: null })
  try {
    const r = await iniciarSesionConCodigo(codigo)
    if (r.tipo === 'sin-conexion') return fijar({ aviso: 'sin-conexion' })
    if (r.tipo === 'no-autorizado') return fijar({ aviso: 'codigo-invalido' })
    if (r.tipo === 'limitado') return fijar({ aviso: 'demasiados' })
    if (r.tipo === 'cerrado') return fijar({ aviso: 'no-disponible' })
    if (r.tipo !== 'ok') return fijar({ aviso: 'incierto' })
    // Confirmación: la sesión existe solo si el servidor la reconoce ahora.
    const y = await consultarSesion()
    if (y.tipo === 'ok') return fijar({ estado: 'activa', datos: datosDe(y.datos), aviso: null })
    return fijar({ estado: 'sin-sesion', datos: null, aviso: y.tipo === 'no-autorizado' ? 'cookie' : 'incierto' })
  } finally {
    fijar({ ocupado: false })
  }
}

export async function salir() {
  if (estado.ocupado) return
  fijar({ ocupado: true, aviso: null })
  try {
    const r = await cerrarSesionEnServidor()
    if (r.tipo === 'ok' || r.tipo === 'no-autorizado') return fijar({ estado: 'sin-sesion', datos: null, aviso: null }) // confirmado
    if (r.tipo === 'sin-conexion') return fijar({ aviso: 'sin-conexion' })
    // Respuesta perdida o inesperada: no se afirma que se cerró. Se pregunta al servidor qué ve.
    const y = await consultarSesion()
    if (y.tipo === 'no-autorizado') return fijar({ estado: 'sin-sesion', datos: null, aviso: null }) // el servidor confirma que no hay sesión
    return fijar({ aviso: 'salida-incierta' })
  } finally {
    fijar({ ocupado: false })
  }
}

/** Solo para pruebas. */
export const __reiniciar = () => { estado = { estado: 'cargando', datos: null, aviso: null, ocupado: false } }
