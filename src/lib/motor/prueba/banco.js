import { crearAtribucion } from '../atribucion'
import { camposDeReloj, crearEstado } from '../estado'
import { ejecutar } from '../orquestador'
import { construirSobre, ordenParadaAutomatica } from '../reglas'
import { crearAdaptadorMemoria } from './adaptador-memoria'
import { preparacionDePrueba } from './auxiliares-preparacion'

// Banco de pruebas: arma sobres desde el estado del servidor y los ejecuta
// contra el adaptador de memoria (solo pruebas).

export const T0 = 1_700_000_000_000

/** Plantilla de prueba: dos equipos, un jugador inactivo (JX) en E1. */
export const JUGADORES_DE_PRUEBA = [
  { id: 'J1', equipoId: 'E1', nombre: 'Ana Pérez' },
  { id: 'J2', equipoId: 'E1', nombre: 'Beto Gómez', activo: true },
  { id: 'JX', equipoId: 'E1', nombre: 'Dario Inactivo', activo: false },
  { id: 'J9', equipoId: 'E2', nombre: 'Eva Visita' },
  { id: 'J8', equipoId: 'E2', nombre: 'Fede Visita' },
]
export const ATRIBUCION_DE_PRUEBA = crearAtribucion({ equipos: ['E1', 'E2'], jugadores: JUGADORES_DE_PRUEBA })

/** `atribucion: null` deja el estado sin contexto de atribución (las órdenes de puntos se rechazan). */
export function estadoDePrueba({
  estado = 'vivo', deporte = 'baloncesto', minutosPorPeriodo = null, reloj = {}, eventos = [], extra = {},
  atribucion = ATRIBUCION_DE_PRUEBA, gameId = 'P',
} = {}) {
  return crearEstado({
    gameId,
    atribucion,
    config: { deporte, minutosPorPeriodo },
    partido: {
      estado, ...camposDeReloj('detenido', 600000, null), ...reloj,
    },
    eventos,
    ...extra,
  })
}

let contador = 0
export const nuevoId = (prefijo = 'c') => `${prefijo}${++contador}`

/** `ejecutar` con la credencial de prueba por defecto (el contexto de confianza del transporte). */
export const CREDENCIAL = 'cred-A'
export const ejecutarAutorizado = (adaptador, sobre, opciones = {}) =>
  ejecutar(adaptador, sobre, { credencial: CREDENCIAL, ...opciones })

export function crearBanco(opciones = {}) {
  const estadoInicial = opciones.estadoInicial ?? estadoDePrueba(opciones)
  // Contexto de preparación del partido real del banco (listo, con plantilla numerada); `preparacion: null` = ninguno.
  const preparacion = 'preparacion' in opciones ? opciones.preparacion : preparacionDePrueba(estadoInicial.gameId)
  const adaptador = crearAdaptadorMemoria({
    estado: estadoInicial, ultimoClientSeq: opciones.ultimoClientSeq ?? 0, preparacion,
  })
  const deviceId = 'tel-A'
  const banco = {
    adaptador,
    deviceId,
    credencial: CREDENCIAL,
    ahora: T0,

    /** Construye el sobre de una orden con el estado actual del servidor. */
    sobre(tipo, datos = {}, opts = {}) {
      const { t, seq, cmdId, tiempo, estado } = opts
      const base = estado ?? adaptador.estado()
      const ts = t ?? banco.ahora
      const orden = { cmdId: cmdId ?? nuevoId(), tipo, datos, tiempo: tiempo ?? { accionTs: ts } }
      // Solo el inicio del partido. `preparacionVersion` presente en las opciones se respeta tal cual y
      // null/undefined significa "sin campo": el banco no lo restaura. Ausente la opción, el banco captura la
      // versión del contexto vigente (lo que haría un teléfono que ya evaluó que el partido está listo).
      if (tipo === 'iniciar-partido') {
        if ('preparacionVersion' in opts) {
          if (opts.preparacionVersion != null) orden.preparacionVersion = opts.preparacionVersion
        } else if (typeof adaptador.preparacion()?.version === 'string') {
          orden.preparacionVersion = adaptador.preparacion().version
        }
      }
      return construirSobre(base, orden, { deviceId, clientSeq: seq ?? adaptador.ultimoClientSeq() + 1 })
    },

    async enviar(tipo, datos = {}, opts = {}) {
      const sobre = banco.sobre(tipo, datos, opts)
      const r = await ejecutar(adaptador, sobre, {
        recibidoEn: opts.recibidoEn ?? opts.t ?? banco.ahora,
        credencial: 'credencial' in opts ? opts.credencial : CREDENCIAL,
      })
      return { ...r, sobre }
    },

    /** Reenvía un sobre ya construido, tal cual. */
    reenviar(sobre, recibidoEn = banco.ahora, credencial = CREDENCIAL) {
      return ejecutar(adaptador, sobre, { recibidoEn, credencial })
    },

    async paradaAutomatica(t) {
      const orden = ordenParadaAutomatica(adaptador.estado(), { accionTs: t })
      if (!orden) return null
      const sobre = construirSobre(adaptador.estado(), orden, { deviceId, clientSeq: adaptador.ultimoClientSeq() + 1 })
      return { sobre, resultado: await ejecutar(adaptador, sobre, { recibidoEn: t, credencial: CREDENCIAL }) }
    },
  }
  return banco
}
