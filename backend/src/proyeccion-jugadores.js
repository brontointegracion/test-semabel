import { leerDorsal } from '../../src/lib/dorsal.js'
import { nombrePublico } from './proyeccion-equipo.js'

// ---------------------------------------------------------------------------
// Lectura PÚBLICA de los rankings de jugadores de una liga:  GET /v1/ligas/{liga}/jugadores/publico   (sin credenciales; la
// admisión de la liga se hace en el Worker ANTES de llegar al objeto).
//
// SEMÁNTICA
//   alcance          Siempre 'partidos-finales-de-la-liga'. Solo cuentan los eventos de punto y falta NO anulados de los partidos
//                    cuyo estado autoritativo es 'final' (la misma regla que la página pública de un equipo). Un partido
//                    programado o en vivo no suma nada. Deshacer, rehacer o anular tras el final cambian la siguiente lectura.
//   agrupacion       Siempre 'ficha-y-equipo': una entrada por FICHA (jugadores.id, el identificador estable de la inscripción) y
//                    por EQUIPO con el que anotó. Nunca por nombre, número ni personaId (persona_id es una referencia global que
//                    aquí no es única ni se publica). Dos fichas de la misma persona (p. ej. en dos equipos) son dos entradas; dos
//                    jugadores con el mismo nombre son dos entradas. Como cada entrada es la suma de una ficha en UN equipo, coincide
//                    con la fila de esa ficha en la página del equipo.
//   equipo           El equipo POR EL QUE se anotó el evento (no el equipo actual de la ficha). `enPlantilla`: la ficha sigue activa
//                    en ese equipo hoy. Una ficha inactiva o movida conserva su historia.
//   nombre/dorsalActual  Los de HOY (como en la página del equipo); null si no se conocen. Nunca se inventan.
//   maximosAnotadores / masFaltas   Entradas con valor > 0, ordenadas por valor descendente; el orden dentro de un empate es
//                    nombre, número, id (solo estable, no un criterio deportivo). `rango`: puesto con empates compartidos
//                    («1, 2, 2, 4»). Solo se publican los puestos hasta RANGO_MAXIMO, incluyendo todos los empatados en el último,
//                    con un tope de filas (`recortado` lo dice). No hay partidos jugados, promedios, asistencias ni rebotes.
//   sinJugador       Puntos y faltas anotados sin ficha asignada (no entran en ningún ranking).
//
// COSTE: la liga, los equipos y los partidos (sin eventos) se leen por clave y UNA consulta agrupada recorre los eventos de punto y
// falta no anulados de partidos finales. Con topes explícitos; al rebasarlos, 507 `liga-demasiado-grande`, nunca totales parciales.
// ---------------------------------------------------------------------------

export const LIMITES_JUGADORES_PUBLICO = Object.freeze({ partidos: 300, equipos: 100, jugadores: 3000 })
export const RANGO_MAXIMO = 10
export const FILAS_MAXIMAS = 50

export const CAMPOS_PUBLICOS_JUGADORES = Object.freeze({
  raiz: ['liga', 'alcance', 'agrupacion', 'partidosFinales', 'maximosAnotadores', 'masFaltas', 'recortado', 'sinJugador', 'servidorAhoraMs'],
  liga: ['id', 'nombre'],
  entrada: ['rango', 'id', 'nombre', 'dorsalActual', 'equipo', 'enPlantilla', 'puntos', 'faltas'],
  equipo: ['id', 'nombre'],
  sinJugador: ['puntos', 'faltas'],
})

export const SQL_ESTADISTICAS_DE_LA_LIGA = `
  SELECT json_extract(e.json, '$.jugadorId') AS jugador_id, json_extract(e.json, '$.equipoId') AS equipo_id,
         SUM(CASE WHEN json_extract(e.json, '$.tipo') = 'punto' THEN json_extract(e.json, '$.puntos') ELSE 0 END) AS puntos,
         SUM(CASE WHEN json_extract(e.json, '$.tipo') = 'falta' THEN 1 ELSE 0 END) AS faltas,
         SUM(CASE WHEN json_extract(e.json, '$.tipo') = 'punto'
                   AND (typeof(json_extract(e.json, '$.puntos')) != 'integer' OR json_extract(e.json, '$.puntos') < 0) THEN 1 ELSE 0 END) AS invalidos
    FROM partidos p JOIN eventos e ON e.partido_id = p.id
   WHERE p.retirado_en IS NULL AND json_extract(p.estado_json, '$.partido.estado') = 'final'
     AND json_extract(e.json, '$.equipoId') IN (p.local_id, p.visita_id)
     AND json_extract(e.json, '$.tipo') IN ('punto', 'falta')
     AND COALESCE(json_extract(e.json, '$.anulado'), 0) = 0
   GROUP BY json_extract(e.json, '$.jugadorId'), json_extract(e.json, '$.equipoId')
   LIMIT ?`

const SQL_FICHAS = 'SELECT id, equipo_id, activo, nombre, nombre_pila, apellido1, apellido2, dorsal FROM jugadores ORDER BY id LIMIT ?'

const NO_ENCONTRADO = { status: 404, cuerpo: { error: 'no-encontrado' } }
const demasiado = () => ({ status: 507, cuerpo: { error: 'liga-demasiado-grande' } })

const estadoDe = (estadoJson) => {
  try { return JSON.parse(estadoJson).partido?.estado ?? null } catch { return null }
}
const textoCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Ranking determinista. `entradas`: [{ id, equipo:{id}, nombre, dorsalActual, … }] con el campo numérico `campo`. Excluye valores 0,
 * ordena por valor ↓ y luego nombre (sin nombre al final), número (sin número al final), id y equipo; puestos con empates compartidos;
 * corta en `rangoMaximo` completando el último empate y en `filasMaximas`. → { filas, recortado }.
 */
export function rankear(entradas, campo, rangoMaximo = RANGO_MAXIMO, filasMaximas = FILAS_MAXIMAS) {
  const orden = entradas.filter((x) => x[campo] > 0).sort((a, b) =>
    b[campo] - a[campo]
    || (a.nombre === null) - (b.nombre === null) || textoCmp(a.nombre ?? '', b.nombre ?? '')
    || (a.dorsalActual === null) - (b.dorsalActual === null) || (a.dorsalActual ?? 0) - (b.dorsalActual ?? 0)
    || textoCmp(a.id, b.id) || textoCmp(a.equipo.id, b.equipo.id))
  const filas = []
  let rango = 0
  let recortado = false
  for (let i = 0; i < orden.length; i++) {
    if (i === 0 || orden[i][campo] !== orden[i - 1][campo]) rango = i + 1
    if (rango > rangoMaximo) break
    if (filas.length >= filasMaximas) { recortado = true; break }
    filas.push({ rango, ...orden[i] })
  }
  return { filas, recortado }
}

/** → { status, cuerpo }. `sql`: el SQL del objeto de la liga. Sincrónica: lee todo en un mismo tramo. */
export function leerJugadoresPublico(sql, limites, servidorAhoraMs) {
  const liga = sql.exec('SELECT id, nombre FROM ligas').toArray()[0] ?? null
  if (!liga) return NO_ENCONTRADO
  const equipos = sql.exec('SELECT id, nombre FROM equipos ORDER BY id LIMIT ?', limites.equipos + 1).toArray()
  if (equipos.length > limites.equipos) return demasiado()
  const nombres = new Map(equipos.map((e) => [e.id, e.nombre]))

  const partidos = sql.exec('SELECT estado_json FROM partidos WHERE retirado_en IS NULL LIMIT ?', limites.partidos + 1).toArray()
  if (partidos.length > limites.partidos) return demasiado()
  const partidosFinales = partidos.filter((p) => estadoDe(p.estado_json) === 'final').length

  let sinJugador = { puntos: 0, faltas: 0 }
  const entradas = []
  if (partidosFinales > 0) {
    const grupos = sql.exec(SQL_ESTADISTICAS_DE_LA_LIGA, limites.jugadores + 1).toArray()
    if (grupos.length > limites.jugadores) return demasiado()
    const fichas = sql.exec(SQL_FICHAS, limites.jugadores + 1).toArray()
    if (fichas.length > limites.jugadores) return demasiado()
    const porId = new Map(fichas.map((f) => [f.id, f]))
    for (const g of grupos) {
      if (g.invalidos > 0 || !Number.isSafeInteger(g.puntos) || g.puntos < 0) throw new Error('evento-invalido')
      if (g.jugador_id === null || typeof g.jugador_id !== 'string') {
        sinJugador = { puntos: sinJugador.puntos + g.puntos, faltas: sinJugador.faltas + g.faltas }
        continue
      }
      const f = porId.get(g.jugador_id)
      const d = f ? leerDorsal(f.dorsal) : null
      entradas.push({
        id: g.jugador_id,
        nombre: f ? nombrePublico(f) : null,
        dorsalActual: d && d.tipo === 'real' ? d.valor : null,
        equipo: { id: g.equipo_id, nombre: nombres.get(g.equipo_id) ?? g.equipo_id },
        enPlantilla: Boolean(f && f.activo === 1 && f.equipo_id === g.equipo_id),
        puntos: g.puntos,
        faltas: g.faltas,
      })
    }
  }
  const anotadores = rankear(entradas, 'puntos')
  const faltosos = rankear(entradas, 'faltas')
  return {
    status: 200,
    cuerpo: {
      liga: { id: liga.id, nombre: liga.nombre },
      alcance: 'partidos-finales-de-la-liga',
      agrupacion: 'ficha-y-equipo',
      partidosFinales,
      maximosAnotadores: anotadores.filas,
      masFaltas: faltosos.filas,
      recortado: anotadores.recortado || faltosos.recortado,
      sinJugador,
      servidorAhoraMs,
    },
  }
}
