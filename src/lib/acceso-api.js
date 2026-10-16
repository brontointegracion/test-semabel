import { modoCompartido } from './modo'

// ---------------------------------------------------------------------------
// Cliente de las rutas de acceso del organizador (mismo origen). Reglas:
//   - la cookie de sesión es HttpOnly: este código nunca la ve ni la guarda;
//   - el código del organizador solo viaja en el cuerpo de UNA petición POST: no se guarda, no se registra y no va
//     en ninguna URL;
//   - nada del servidor se muestra tal cual: cada resultado se reduce a un tipo fijo;
//   - una respuesta que no sea JSON (por ejemplo la página de la aplicación) es una respuesta inesperada, nunca un éxito;
//   - sin conexión no se envía nada.
// ---------------------------------------------------------------------------

export const MENSAJES = Object.freeze({
  'sin-conexion': 'Se requiere conexión a internet para esta acción.',
  'codigo-invalido': 'Ese código no es válido. Revísalo y vuelve a escribirlo.',
  demasiados: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  'no-disponible': 'El acceso no está disponible ahora.',
  incierto: 'No pudimos confirmar el acceso. Vuelve a escribir el código.',
  cookie: 'No se pudo mantener la sesión. Revisa que las cookies estén permitidas e inténtalo de nuevo.',
  'salida-incierta': 'No pudimos confirmar el cierre de sesión. Tu sesión sigue abierta; vuelve a intentarlo.',
  'sesion-terminada': 'Tu sesión terminó. Escribe el código otra vez para entrar.',
})

const RUTAS = Object.freeze({
  entrar: '/v1/acceso/organizador',
  yo: '/v1/organizador/yo',
  salir: '/v1/organizador/salir',
})

const esJson = (respuesta) => /^application\/json\b/i.test(respuesta.headers.get('content-type') ?? '')

/**
 * → { tipo: 'ok', datos } | 'no-autorizado' | 'limitado' | 'cerrado' | 'incierto' | 'red' | 'sin-conexion'
 * (siempre como { tipo }). No lanza.
 */
async function llamar(metodo, ruta, cuerpo) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { tipo: 'sin-conexion' }
  const escribe = metodo !== 'GET'
  let respuesta
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      headers: escribe
        ? { accept: 'application/json', 'content-type': 'application/json', 'x-sebel-peticion': '1' }
        : { accept: 'application/json' },
      body: escribe ? JSON.stringify(cuerpo ?? {}) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
  } catch {
    return { tipo: 'red' } // sin respuesta: puede que la petición sí llegara
  }
  if (respuesta.status === 401) return { tipo: 'no-autorizado' }
  if (respuesta.status === 429) return { tipo: 'limitado' }
  if (respuesta.status === 404 || respuesta.status === 403) return { tipo: 'cerrado' }
  if (respuesta.status === 200 && esJson(respuesta)) {
    try {
      return { tipo: 'ok', datos: await respuesta.json() }
    } catch {
      return { tipo: 'incierto' }
    }
  }
  return { tipo: 'incierto' } // 5xx, 503 de resultado desconocido, HTML inesperado, etc.
}

export const consultarSesion = () => llamar('GET', RUTAS.yo)
export const iniciarSesionConCodigo = (codigo) => llamar('POST', RUTAS.entrar, { codigo })
export const cerrarSesionEnServidor = () => llamar('POST', RUTAS.salir, {})
export { modoCompartido }
