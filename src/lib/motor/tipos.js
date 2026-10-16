// ---------------------------------------------------------------------------
// Constantes compartidas del motor de marcador y reloj (Slice 1).
//
// El motor no sabe de bases de datos, de pantallas ni de ningún servicio: solo
// decide, con funciones puras, qué pasa cuando llega una orden. Quien guarda,
// autentica o publica es un adaptador (ver contrato-adaptador.js).
// ---------------------------------------------------------------------------

export const VERSION_MOTOR = 1

/** Cuánto en el futuro (respecto a la recepción) se tolera una hora de acción. */
export const TOLERANCIA_FUTURO_MS = 2000

export const TIPOS = Object.freeze({
  'iniciar-partido': 'reloj',
  'arrancar-reloj': 'reloj',
  'detener-reloj': 'reloj',
  'parada-automatica': 'reloj',
  'corregir-reloj': 'reloj',
  'siguiente-periodo': 'reloj',
  'cerrar-partido': 'reloj',
  anotar: 'marcador',
  falta: 'marcador',
  deshacer: 'marcador',
  rehacer: 'marcador',
  'anular-evento': 'marcador',
})

const RELOJ = ['rev', 'seq', 'estado', 'relojEstado', 'relojRestante', 'relojDesde']

/** Qué campos debe traer `observado` para cada orden. */
export const OBSERVADO_REQUERIDO = Object.freeze({
  anotar: ['rev', 'periodo', 'marcaPeriodo'],
  falta: ['rev', 'periodo', 'marcaPeriodo'],
  deshacer: ['rev'],
  rehacer: ['rev'],
  'anular-evento': ['rev'],
  'iniciar-partido': RELOJ,
  'arrancar-reloj': RELOJ,
  'detener-reloj': RELOJ,
  'parada-automatica': RELOJ,
  'corregir-reloj': RELOJ,
  'cerrar-partido': RELOJ,
  'siguiente-periodo': [...RELOJ, 'periodo', 'marcaPeriodo'],
})

/** Órdenes que traen el tiempo restante que la persona veía. */
export const REQUIERE_RESTANTE_VISTO = new Set([
  'arrancar-reloj',
  'detener-reloj',
  'parada-automatica',
  'cerrar-partido',
  'corregir-reloj',
])

/**
 * Órdenes cuyo resultado depende del tiempo transcurrido entre dos horas de
 * acción. Solo estas leen y avanzan el cursor de tiempo de reloj de confianza
 * (y solo estas rechazan una hora fuera de límites). El resto la registra
 * como advertencia y nunca la usa en una cuenta.
 */
export const USA_TIEMPO_TRANSCURRIDO = new Set([
  'arrancar-reloj',
  'detener-reloj',
  'parada-automatica',
  'cerrar-partido',
])
