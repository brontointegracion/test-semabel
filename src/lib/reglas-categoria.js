import { CATEGORIAS_BALONCESTO } from './categorias.js'

// ---------------------------------------------------------------------------
// Reglas de partido por categoría de baloncesto (REPORT_175). PURO: sin base de datos, sin pantallas, sin reloj.
//
// Son los PRESETS DE PRODUCTO pedidos por el usuario, no una afirmación sobre reglamentos universales. Se indexan por las
// MISMAS claves estables de `categorias.js` (no hay otra lista de categorías: una prueba comprueba que cada clave tiene
// su regla y que no sobra ninguna). Nunca se adivina una categoría por un nombre visible ni por el nombre de un equipo:
// solo una clave exacta de una liga de baloncesto produce reglas; lo demás (ligas anteriores como 'Libre' o '40+',
// categorías sin clave, otros deportes) devuelve null y el partido conserva su comportamiento de siempre.
//
//   reglas = {
//     version, categoria,
//     minutosPorPeriodo,          duración por defecto SOLO si el partido no trae una duración explícita
//     relojTiro  { activo, segundos },   configuración REGISTRADA; todavía no hay cuenta atrás (ver informe)
//     medioCampo { activo, segundos },   idem. No es un reinicio por rebote ofensivo: eso no está definido
//     faltasEquipo,               'periodo' | 'partido' | 'oculto'  (alcance de las faltas de equipo que se MUESTRAN)
//   }
//
// `faltasEquipo` solo cambia qué se muestra. Los eventos de falta, el historial de cada jugador y los totales de partido
// (tabla, estadísticas) no cambian nunca con él.
// ---------------------------------------------------------------------------

export const VERSION_REGLAS = 1
export const ALCANCES_FALTAS = Object.freeze(['periodo', 'partido', 'oculto'])
export const ALCANCE_FALTAS_PREDETERMINADO = 'partido'

const reloj = (segundos) => (segundos === null ? { activo: false, segundos: null } : { activo: true, segundos })

/** clave de categoría → { minutosPorPeriodo, relojTiro, medioCampo, faltasEquipo } */
export const REGLAS_POR_CATEGORIA = Object.freeze({
  baby: { minutosPorPeriodo: 8, relojTiro: reloj(null), medioCampo: reloj(null), faltasEquipo: 'oculto' },
  'mini-basketball': { minutosPorPeriodo: 8, relojTiro: reloj(30), medioCampo: reloj(20), faltasEquipo: 'periodo' },
  intermediate: { minutosPorPeriodo: 10, relojTiro: reloj(24), medioCampo: reloj(14), faltasEquipo: 'partido' },
  adult: { minutosPorPeriodo: 10, relojTiro: reloj(24), medioCampo: reloj(14), faltasEquipo: 'partido' },
  veterans: { minutosPorPeriodo: 10, relojTiro: reloj(24), medioCampo: reloj(14), faltasEquipo: 'partido' },
})

const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const entero = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max

/** Reglas de una categoría guardada, o null si no hay regla explícita. Solo clave exacta + baloncesto. */
export function reglasDeCategoria({ deporte, categoria } = {}) {
  if (deporte !== 'baloncesto' || typeof categoria !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(REGLAS_POR_CATEGORIA, categoria)) return null
  const r = REGLAS_POR_CATEGORIA[categoria]
  return {
    version: VERSION_REGLAS,
    categoria,
    minutosPorPeriodo: r.minutosPorPeriodo,
    relojTiro: { ...r.relojTiro },
    medioCampo: { ...r.medioCampo },
    faltasEquipo: r.faltasEquipo,
  }
}

const relojValido = (r) => objeto(r) && (r.activo === false
  ? r.segundos === null
  : r.activo === true && entero(r.segundos, 1, 600))

/**
 * Copia normalizada de unas reglas ya guardadas en `config.reglas`, o null si no son válidas o no están soportadas (de otra
 * versión, con una categoría que este código no conoce, con campos fuera de forma). NO distingue «ausentes» de «inválidas»:
 * para eso está `estadoDeReglas`, que es la ÚNICA interpretación que deben usar el reloj, las faltas y la consola.
 */
export function copiaReglas(r) {
  if (!objeto(r) || r.version !== VERSION_REGLAS) return null
  if (typeof r.categoria !== 'string' || !Object.prototype.hasOwnProperty.call(REGLAS_POR_CATEGORIA, r.categoria)) return null
  if (!entero(r.minutosPorPeriodo, 1, 120)) return null
  if (!relojValido(r.relojTiro) || !relojValido(r.medioCampo)) return null
  if (!ALCANCES_FALTAS.includes(r.faltasEquipo)) return null
  return {
    version: r.version,
    categoria: r.categoria,
    minutosPorPeriodo: r.minutosPorPeriodo,
    relojTiro: { activo: r.relojTiro.activo, segundos: r.relojTiro.segundos },
    medioCampo: { activo: r.medioCampo.activo, segundos: r.medioCampo.segundos },
    faltasEquipo: r.faltasEquipo,
  }
}

/**
 * LA interpretación de las reglas guardadas de un partido (REPORT_177). Tres casos que nunca se mezclan:
 *   'ausentes'  la clave `reglas` no existe: partido anterior a las reglas (o sin categoría con regla). Comportamiento de
 *               siempre (faltas de partido completo, duración del partido o del deporte). No es un error.
 *   'validas'   `reglas` es una copia soportada: se usan EXACTAMENTE esas reglas fijadas.
 *   'invalidas' `reglas` existe pero no es válida o no está soportada (también `reglasInvalidas: true`, la marca con que el
 *               servidor avisa al teléfono sin enviarle datos dudosos). NUNCA se trata como 'ausentes': ninguna operación que
 *               dependa de interpretarlas puede elegir en silencio otra semántica (ver motivo 'reglas-invalidas').
 * → { estado, reglas, motivo }   reglas = la copia normalizada solo si 'validas'.
 */
export function estadoDeReglas(config) {
  if (objeto(config) && config.reglasInvalidas === true) return { estado: 'invalidas', reglas: null, motivo: 'marcadas-invalidas' }
  if (!objeto(config) || config.reglas === undefined) return { estado: 'ausentes', reglas: null, motivo: null }
  const r = copiaReglas(config.reglas)
  return r ? { estado: 'validas', reglas: r, motivo: null } : { estado: 'invalidas', reglas: null, motivo: 'no-soportadas' }
}

/** Fragmento para copiar una config: las reglas válidas, la marca `reglasInvalidas` si no lo son, o nada (forma anterior intacta). */
export const reglasDeConfig = (config) => {
  const e = estadoDeReglas(config)
  return e.estado === 'validas' ? { reglas: e.reglas } : e.estado === 'invalidas' ? { reglasInvalidas: true } : {}
}

/**
 * Alcance de las faltas de equipo que se muestran: el de las reglas válidas; 'partido' sin reglas (comportamiento de
 * siempre); 'no-disponible' si están inválidas (se dice, no se inventa otro alcance).
 */
export const alcanceFaltasDe = (config) => {
  const e = estadoDeReglas(config)
  return e.estado === 'validas' ? e.reglas.faltasEquipo : e.estado === 'invalidas' ? 'no-disponible' : ALCANCE_FALTAS_PREDETERMINADO
}

/**
 * Firma corta y estable de las reglas que una persona confirma al iniciar: 'ninguna' (partido sin reglas), la firma de unas
 * reglas válidas o 'invalidas'. Sirve para comprobar que lo que se ve es lo que el servidor fija (no es secreta ni autentica).
 */
export function firmaDeReglas(config) {
  const e = estadoDeReglas(config)
  if (e.estado === 'ausentes') return 'ninguna'
  if (e.estado === 'invalidas') return 'invalidas'
  const r = e.reglas
  const t = (x) => (x.activo ? String(x.segundos) : 'x')
  return `${r.version}|${r.categoria}|${r.faltasEquipo}|${r.minutosPorPeriodo}|${t(r.relojTiro)}|${t(r.medioCampo)}`
}

/**
 * Reglas EFECTIVAS de un partido:
 *   - ya fijadas en su config (válidas) → esas, SIEMPRE, aunque la liga cambie después;
 *   - presentes pero inválidas → null y `estadoDeReglas` lo dirá: nunca se reemplazan por las de la categoría;
 *   - partido todavía 'programado' y sin reglas → las de la categoría VIGENTE de su liga (se fijan al iniciar);
 *   - cualquier otro caso (partido iniciado sin reglas = anterior a esta función, categoría sin regla) → null.
 */
export function reglasEfectivas({ config, estadoPartido, deporte, categoria }) {
  const e = estadoDeReglas(config)
  if (e.estado === 'validas') return e.reglas
  if (e.estado === 'invalidas') return null
  if (estadoPartido === 'programado') return reglasDeCategoria({ deporte: deporte ?? config?.deporte, categoria })
  return null
}
