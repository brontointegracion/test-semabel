import { pedirJson, rutaEquipo, rutaJuego, rutaJugadores, rutaLiga } from './cliente.js'
import { validarEquipo, validarJuego, validarJugadores, validarLiga } from './validar.js'

// Definiciones de los dos recursos públicos y su cadencia.
//
//   Catálogo (la liga): como mucho una vez por 60 s mientras la pestaña se ve.
//   Partido en vivo: cada 5 s. Programado: lento (30 s; no es un reloj en marcha). Final: cada 5 min más un refresco por foco
//   acotado a 30 s entre peticiones, para que una corrección posterior al final aparezca.

export const PERIODO_CATALOGO_MS = 60_000
export const PERIODO_VIVO_MS = 5_000
export const PERIODO_PROGRAMADO_MS = 30_000
export const PERIODO_FINAL_MS = 300_000
export const INTERVALO_FOCO_FINAL_MS = 30_000
// Equipo (plantilla y estadísticas): bajo demanda al abrir la página, refresco manual y, a lo sumo, uno cada 5 min mientras se ve.
// Nada de sondeo de 5 s. Entre dos peticiones del equipo pasan al menos 15 s (también el botón «Actualizar» y el foco).
export const PERIODO_EQUIPO_MS = 300_000
export const INTERVALO_MIN_EQUIPO_MS = 15_000

export function recursoLiga(ligaId) {
  return {
    clave: `liga:${ligaId}`,
    async cargar(senal) {
      const r = await pedirJson(rutaLiga(ligaId), { senal })
      if (r.tipo !== 'ok') return r
      const datos = validarLiga(r.cuerpo, ligaId)
      return datos ? { ...r, datos } : { tipo: 'malformado' }
    },
    periodoDe: () => PERIODO_CATALOGO_MS,
    intervaloMinDe: () => PERIODO_CATALOGO_MS,
  }
}

// La lista de equipos de una liga, solo para RESOLVER la clave de un equipo (ver claves.js): una lectura al abrir y un refresco por hora,
// no el sondeo de cada minuto del catálogo. Tiene su propia clave: no comparte la entrada de `recursoLiga`.
export const PERIODO_RESOLUCION_MS = 3_600_000
export function recursoListaEquipos(ligaId) {
  const base = recursoLiga(ligaId)
  return { ...base, clave: `lista-equipos:${ligaId}`, periodoDe: () => PERIODO_RESOLUCION_MS, intervaloMinDe: () => PERIODO_RESOLUCION_MS }
}

const estadoDe = (datos) => datos?.estado ?? null

export function recursoJuego(ligaId, gameId) {
  return {
    clave: `juego:${ligaId}:${gameId}`,
    async cargar(senal) {
      const r = await pedirJson(rutaJuego(ligaId, gameId), { senal })
      if (r.tipo !== 'ok') return r
      const datos = validarJuego(r.cuerpo, ligaId, gameId)
      return datos ? { ...r, datos } : { tipo: 'malformado' }
    },
    periodoDe(datos) {
      const e = estadoDe(datos)
      return e === 'final' ? PERIODO_FINAL_MS : e === 'programado' ? PERIODO_PROGRAMADO_MS : PERIODO_VIVO_MS
    },
    intervaloMinDe(datos) {
      const e = estadoDe(datos)
      return e === 'final' ? INTERVALO_FOCO_FINAL_MS : e === 'programado' ? PERIODO_PROGRAMADO_MS : PERIODO_VIVO_MS
    },
  }
}

// Transmisión de televisión (REPORT_201): el partido INMEDIATAMENTE siguiente se lee cada 5 s (en lugar de 30 s) mientras la pantalla lo espera, para
// pasar a él pronto cuando el árbitro lo inicie. `esVigilado()` lo decide quien muestra la secuencia; los demás partidos futuros siguen a 30 s.
export const PERIODO_VIGILADO_MS = 5_000
export function recursoJuegoTv(ligaId, gameId, esVigilado) {
  const base = recursoJuego(ligaId, gameId)
  const rapido = (datos) => estadoDe(datos) === 'programado' && esVigilado()
  return {
    ...base,
    periodoDe: (datos) => (rapido(datos) ? PERIODO_VIGILADO_MS : base.periodoDe(datos)),
    intervaloMinDe: (datos) => (rapido(datos) ? PERIODO_VIGILADO_MS : base.intervaloMinDe(datos)),
  }
}

export function recursoEquipo(ligaId, equipoId) {
  return {
    clave: `equipo:${ligaId}:${equipoId}`,
    async cargar(senal) {
      const r = await pedirJson(rutaEquipo(ligaId, equipoId), { senal })
      if (r.tipo !== 'ok') return r
      const datos = validarEquipo(r.cuerpo, ligaId, equipoId)
      return datos ? { ...r, datos } : { tipo: 'malformado' }
    },
    periodoDe: () => PERIODO_EQUIPO_MS,
    intervaloMinDe: () => INTERVALO_MIN_EQUIPO_MS,
  }
}

// Rankings de jugadores de la liga (pestaña «Jugadores»): se piden SOLO mientras esa pestaña está abierta, con la cadencia del equipo
// (no hay sondeo de 5 s: solo cuentan partidos finales). Una lectura de liga, no una por equipo.
export function recursoJugadores(ligaId) {
  return {
    clave: `jugadores:${ligaId}`,
    async cargar(senal) {
      const r = await pedirJson(rutaJugadores(ligaId), { senal })
      if (r.tipo !== 'ok') return r
      const datos = validarJugadores(r.cuerpo, ligaId)
      return datos ? { ...r, datos } : { tipo: 'malformado' }
    },
    periodoDe: () => PERIODO_EQUIPO_MS,
    intervaloMinDe: () => INTERVALO_MIN_EQUIPO_MS,
  }
}
