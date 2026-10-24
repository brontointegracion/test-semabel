// Respuestas SINTÉTICAS con la forma exacta de las lecturas públicas del servidor (REPORT_132/134), para las pruebas.
// Ningún nombre, liga ni dato es real.

export const SERVIDOR_MS = Date.parse('2026-11-01T22:00:00.000Z')

export const reloj = (estado = 'detenido', restanteMs = 600000, desdeMs = null) => ({ estado, restanteMs, desdeMs })
const lado = (id, puntos = 0, faltas = 0) => ({ id, puntos, faltas })

export function partidoLiga(sobre = {}) {
  return {
    gameId: 'G1', rev: 0, estado: 'programado', programadoPara: '2026-11-02T00:00:00.000Z', inicioReal: null, sede: 'Cancha A',
    periodo: 1, reloj: { estado: null, restanteMs: null, desdeMs: null }, local: lado('E1'), visita: lado('E2'), ...sobre,
  }
}

export function respuestaLiga({ id = 'LIGAPUB1', nombre = 'Liga sintética uno', partidos = [partidoLiga()], servidorAhoraMs = SERVIDOR_MS, ...resto } = {}) {
  return {
    liga: { id, nombre, deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } },
    equipos: [{ id: 'E1', nombre: 'Alfa Norte' }, { id: 'E2', nombre: 'Beta Sur' }, { id: 'E3', nombre: 'Gama Este' }, { id: 'E4', nombre: 'Delta Oeste' }],
    partidos, servidorAhoraMs, faltasAlcance: 'partido', ...resto,
  }
}

export function respuestaJuego({ ligaId = 'LIGAPUB1', gameId = 'G1', servidorAhoraMs = SERVIDOR_MS, ...sobre } = {}) {
  return {
    gameId, rev: 3, liga: { id: ligaId, nombre: 'Liga sintética uno', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } },
    estado: 'vivo', inicio: '2026-11-01T21:30:00.000Z', programadoPara: '2026-11-01T21:30:00.000Z', inicioReal: '2026-11-01T21:31:00.000Z',
    sede: 'Cancha A', periodo: 2, reloj: reloj('detenido', 420000), servidorAhoraMs, faltasAlcance: 'partido',
    local: { id: 'E1', nombre: 'Alfa Norte', puntos: 12, faltas: 3 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 9, faltas: 4 }, ...sobre,
  }
}

/** Respuesta sintética de la lectura pública de un equipo (plantilla con número 0, apellidos compuestos, datos faltantes e histórico). */
export function respuestaEquipo({ ligaId = 'LIGAPUB1', equipoId = 'E1', servidorAhoraMs = SERVIDOR_MS, ...sobre } = {}) {
  return {
    liga: { id: ligaId, nombre: 'Liga sintética uno' },
    equipo: { id: equipoId, nombre: 'Alfa Norte' },
    plantilla: [
      { id: 'J1', nombre: 'Ana Prueba', dorsalActual: 0 },
      { id: 'J2', nombre: 'Saúl Montero', dorsalActual: 2 },
      { id: 'J3', nombre: 'María José de la Cruz Pérez', dorsalActual: 7 },
      { id: 'J5', nombre: null, dorsalActual: null },
      { id: 'J6', nombre: 'Gemelo Igual', dorsalActual: 11 },
      { id: 'J7', nombre: 'Gemelo Igual', dorsalActual: 11 },
    ],
    historicos: [{ id: 'JX', nombre: 'Retirado Ya', dorsalActual: 20, motivo: 'inactivo' }],
    resultados: [{
      gameId: 'G1', programadoPara: '2026-11-01T19:00:00.000Z', inicioReal: '2026-11-01T19:05:00.000Z', sede: 'Cancha A',
      local: { id: 'E1', nombre: 'Alfa Norte', puntos: 30, faltas: 8 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 41, faltas: 9 },
    }],
    estadisticas: {
      alcance: 'partidos-finales-del-equipo', partidosFinales: 1,
      jugadores: [{ id: 'J1', puntos: 3, faltas: 0 }, { id: 'J2', puntos: 12, faltas: 4 }, { id: 'J6', puntos: 5, faltas: 1 }, { id: 'JX', puntos: 10, faltas: 2 }],
      sinJugador: { puntos: 0, faltas: 0 },
    },
    servidorAhoraMs, ...sobre,
  }
}

/**
 * Respuesta sintética de GET /v1/ligas/{liga}/jugadores/publico (REPORT_215). `anotadores`: [{ id, nombre, dorsalActual, equipo: {id, nombre}, puntos, faltas?, enPlantilla?, rango? }] YA en
 * el orden del servidor (valor descendente); el `rango` se calcula con empates compartidos («1, 2, 2, 4») salvo que se dé.
 */
export function respuestaJugadores({ id = 'LIGAPUB1', nombre = 'Liga sintética uno', partidosFinales = 1, anotadores = [], masFaltas = [], recortado = false, servidorAhoraMs = SERVIDOR_MS, sinJugador = { puntos: 0, faltas: 0 } } = {}) {
  let previo = null; let puesto = 0
  const fila = (e, i, campo) => {
    if (previo === null || e[campo] !== previo[campo]) puesto = i + 1
    previo = e
    return { rango: e.rango ?? puesto, id: e.id, nombre: e.nombre ?? null, dorsalActual: e.dorsalActual ?? null, equipo: e.equipo, enPlantilla: e.enPlantilla ?? true, puntos: e.puntos ?? 0, faltas: e.faltas ?? 0 }
  }
  const a = anotadores.map((e, i) => fila(e, i, 'puntos'))
  previo = null
  const f = masFaltas.map((e, i) => fila(e, i, 'faltas'))
  return {
    liga: { id, nombre }, alcance: 'partidos-finales-de-la-liga', agrupacion: 'ficha-y-equipo', partidosFinales,
    maximosAnotadores: a, masFaltas: f, recortado, sinJugador, servidorAhoraMs,
  }
}
