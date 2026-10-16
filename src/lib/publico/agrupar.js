import { etiquetaCategoria, etiquetaSubcategoria } from '../categorias.js'
import { ligasConfiguradas } from './config.js'
import { ahoraServidor } from './reloj-servidor.js'
import { claveLiga, enlacesDePartidos } from './urls.js'

// ---------------------------------------------------------------------------
// Agrupa los partidos de las ligas leídas del servidor. Solo usa lo que el servidor confirma:
//   vivo       → "Ahora mismo". Incluye reloj en pausa, descanso entre periodos y 00:00.
//   programado → "Próximos partidos", también si su hora ya pasó (nunca cambia solo por la hora).
//   final      → resultados. Solo el estado `final` del servidor significa terminado.
// ---------------------------------------------------------------------------

/** Aplana los estados de las ligas ya cargadas en una lista de partidos con los datos de su liga. */
export function partidosDe(estadosLigas) {
  const lista = []
  for (const est of estadosLigas) {
    const d = est.datos
    if (!d) continue
    const nombres = new Map(d.equipos.map((e) => [e.id, e.nombre]))
    const clasificacion = etiquetasDe(d.liga)
    const enlaces = enlacesDePartidos(d)
    for (const p of d.partidos) {
      lista.push({
        ...p,
        ligaId: d.liga.id,
        urlPartido: enlaces.get(p.gameId),
        ligaNombre: d.liga.nombre,
        deporte: d.liga.deporte,
        etiquetaCategoria: clasificacion.categoria,
        etiquetaSubcategoria: clasificacion.subcategoria,
        local: { ...p.local, nombre: nombres.get(p.local.id) ?? p.local.id },
        visita: { ...p.visita, nombre: nombres.get(p.visita.id) ?? p.visita.id },
        muestra: est.muestra,
      })
    }
  }
  return lista
}

/** Etiquetas legibles de la categoría y la subcategoría de una liga, o null si no se conocen. */
export function etiquetasDe(liga) {
  const categoria = liga.categoria === null ? null : etiquetaCategoria(liga.categoria) || null
  return { categoria, subcategoria: etiquetaSubcategoria(liga.subcategoria) }
}

const porTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const instante = (p) => (p.programadoPara === null ? Infinity : Date.parse(p.programadoPara))

export function clasificar(partidos) {
  const vivos = partidos.filter((p) => p.estado === 'vivo')
    .sort((a, b) => porTexto(a.ligaNombre, b.ligaNombre) || instante(a) - instante(b) || porTexto(a.gameId, b.gameId))
  const proximos = partidos.filter((p) => p.estado === 'programado')
    .sort((a, b) => (instante(a) === instante(b) ? 0 : instante(a) < instante(b) ? -1 : 1) || porTexto(a.ligaNombre, b.ligaNombre) || porTexto(a.gameId, b.gameId))
  const reciente = (p) => (p.inicioReal ? Date.parse(p.inicioReal) : p.programadoPara ? Date.parse(p.programadoPara) : 0)
  const finales = partidos.filter((p) => p.estado === 'final')
    .sort((a, b) => reciente(b) - reciente(a) || porTexto(a.gameId, b.gameId))
  return { vivos, proximos, finales }
}

/** ¿Un partido programado cuya hora ya pasó (según la hora del SERVIDOR estimada)? Sigue programado: solo se rotula. */
export function pendienteDeComenzar(partido, mono) {
  if (partido.estado !== 'programado' || partido.programadoPara === null || !partido.muestra) return false
  return Date.parse(partido.programadoPara) < ahoraServidor(partido.muestra, mono)
}

/** "2º cuarto" / "2º tiempo" / "Periodo 2" (el deporte solo se conoce en la lectura de la liga). */
export function textoPeriodo(deporte, n) {
  if (deporte === 'baloncesto') return `${n}º cuarto`
  if (deporte === 'futsal') return `${n}º tiempo`
  return `Periodo ${n}`
}

// Direcciones públicas amigables (ver urls.js): la liga va en minúsculas; el partido, con su nombre y sufijo estable (lo calcula
// `partidosDe`, que conoce toda la liga). Sin esa información, `urlPartidoPublico` usa el id completo, que siempre se resuelve.
export const urlLigaPublica = (ligaId) => `/liga/${claveLiga(ligaId, ligasConfiguradas().ids)}`
export const urlPartidoPublico = (ligaId, gameId) => `${urlLigaPublica(ligaId)}/partido/${gameId}`
/** La dirección del calendario de la liga: el destino por omisión de «Salir» en un partido. */
export const urlCalendarioLiga = (ligaId) => `${urlLigaPublica(ligaId)}?pestana=calendario`
