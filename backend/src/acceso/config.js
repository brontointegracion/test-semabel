// ---------------------------------------------------------------------------
// Parámetros de acceso del piloto (aprobados) y lectura segura de la configuración.
// Las duraciones NO dependen de un día de la semana, de la medianoche, de la hora de inicio programada ni del
// final del partido: siempre se cuentan desde la emisión o la activación.
// ---------------------------------------------------------------------------

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

export const DURACIONES = Object.freeze({
  codigoOrganizador: 15 * DIA, // código del organizador: 15 días desde su emisión (solo códigos nuevos o de reemplazo; las caducidades ya guardadas no cambian)
  sesionIdle: 12 * HORA, // sesión: 12 h sin uso
  sesionAbsoluta: 24 * HORA, // sesión: 24 h desde el inicio
  codigoPartidoSinUsar: 48 * HORA, // código de partido que no se ha usado: 48 h desde su emisión
  credencialActiva: 72 * HORA, // credencial: 72 h desde la activación para procesar comandos
  credencialSoloRecibos: 7 * DIA, // y 7 días más solo para reintentos exactos de recibos guardados
})

export const VENTANA_ASERCION_MS = 5000 // un organizador validado puede mutar hasta 5 s después
export const TOLERANCIA_RELOJ_MS = 1000 // y una validación "del futuro" se tolera hasta 1 s
export const MAX_SESIONES = 2
export const MAX_FALLOS_CODIGO = 5
export const BLOQUEO_CODIGO_MS = 10 * 60 * 1000
export const BLOQUEO_CODIGO_MAX_MS = 6 * HORA
export const VENTANA_FUENTE_MS = 10 * 60 * 1000
export const MAX_FALLOS_FUENTE = 20
// Contadores temporales por fuente: como mucho este número de fuentes ACTIVAS por objeto (más una fila compartida de
// desbordamiento). Pasado el tope, las fuentes nuevas comparten el cubo de desbordamiento, con el mismo umbral.
export const MAX_FUENTES_ACTIVAS = 500
export const CLAVE_DESBORDAMIENTO = 'desbordamiento'
export const MAX_CUERPO_ACCESO_BYTES = 4 * 1024
export const REFRESCO_USO_SESION_MS = 60 * 1000 // el último uso de la sesión se escribe como mucho una vez por minuto

const ORIGEN = /^https:\/\/[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?$/

/**
 * Configuración de las rutas con cookie del organizador. Devuelve null (todo CERRADO) si falta o está mal formada:
 *   ACCESO_ORIGEN  origen exacto de la página, p. ej. https://ejemplo.com (sin ruta, sin barra final).
 */
export function configuracionOrganizador(env) {
  const origen = env?.ACCESO_ORIGEN
  if (typeof origen !== 'string' || !ORIGEN.test(origen)) return null
  return { origen }
}

/** Provisión por el operador: desactivada salvo bandera explícita Y secreto largo. */
export function administracionHabilitada(env) {
  return env?.ACCESO_ADMIN_HABILITADO === '1'
    && typeof env?.ACCESO_ADMIN_TOKEN === 'string'
    && env.ACCESO_ADMIN_TOKEN.length >= 32
}
