import { etiquetasDe, partidosDe } from './agrupar.js'

// ---------------------------------------------------------------------------
// Adaptador de datos de la portada compartida: de las lecturas públicas de las ligas configuradas a lo que necesita la portada
// ORIGINAL (ligas, equipos, partidos). Función pura: no pide nada, no lee almacenamiento y no usa datos de demostración.
//
// Solo hay lo que el servidor confirma. NO se inventa provincia, organizador, cancha ni cercanía: la liga pública no los tiene, así que
// esos campos no existen aquí (la portada los omite). El país es el del piloto, configurado explícitamente.
//
// `fase` distingue lo que la portada debe decir:
//   'cargando'  nada cargado todavía y alguna lectura en vuelo
//   'error'     nada cargado y todas las lecturas fallaron
//   'parcial'   alguna liga cargada y otra fallida o todavía en vuelo
//   'ok'        todas cargadas (si no hay partidos, el vacío está VERIFICADO)
// ---------------------------------------------------------------------------

/** @param {{ ids: string[], estados: object[], pais: string }} entrada */
export function construirDescubrir({ ids, estados, pais }) {
  const cargadas = estados.filter((e) => e.datos)
  const fallidas = ids.filter((_, i) => !estados[i].datos && estados[i].fase !== 'cargando')
  const enVuelo = estados.some((e) => !e.datos && e.fase === 'cargando')
  let fase = 'ok'
  if (cargadas.length === 0) fase = enVuelo ? 'cargando' : 'error'
  else if (fallidas.length > 0 || enVuelo) fase = 'parcial'

  const ligas = cargadas.map((e) => {
    const l = e.datos.liga
    const { categoria, subcategoria } = etiquetasDe(l)
    return {
      id: l.id, codigo: l.id, nombre: l.nombre, deporte: l.deporte, categoria: l.categoria, pais,
      clasificacion: [categoria, subcategoria].filter(Boolean).join(' · ') || null,
    }
  })
  const equipos = cargadas.flatMap((e) => e.datos.equipos.map((q) => ({ id: q.id, nombre: q.nombre, ligaId: e.datos.liga.id })))
  const idsPorLiga = Object.fromEntries(cargadas.map((e) => [e.datos.liga.id, e.datos.equipos.map((q) => q.id)]))

  return {
    fase,
    fallidas,
    ligas,
    ligasPorId: Object.fromEntries(ligas.map((l) => [l.id, l])),
    equipos,
    idsPorLiga,
    partidos: partidosDe(estados),
  }
}
