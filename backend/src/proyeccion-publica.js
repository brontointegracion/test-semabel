import { resolverClasificacion } from '../../src/lib/categorias.js'
import { estadoDeReglas, reglasEfectivas } from '../../src/lib/reglas-categoria.js'

// ---------------------------------------------------------------------------
// Lo único que se publica. Son LISTAS BLANCAS armadas campo por campo: nunca se serializa una fila ni el estado
// del motor. No incluyen credenciales, hashes, dispositivos, recibos, plantillas, fichas de jugadores, atribución,
// preparación, bandeja ni diagnósticos.
//
// SEMÁNTICA DE LOS CAMPOS (los dos contratos)
//   estado            El estado AUTORITATIVO del motor: 'programado' | 'vivo' | 'final'. Nunca se deduce de la hora:
//                     un partido 'programado' cuya hora ya pasó sigue siendo 'programado'. 'vivo' incluye reloj en
//                     pausa, descanso entre periodos y 00:00. Solo 'final' significa terminado. No existen
//                     'cancelado' ni 'aplazado'.
//                     Un partido RETIRADO por el operador (partidos.retirado_en, ver retiro-partidos.js) NO es un estado: no se publica en
//                     ninguna lectura y su lectura directa es el 404 de un partido desconocido.
//   programadoPara    Instante programado (ISO UTC) o null si no se conoce. Es independiente del inicio real: iniciar
//                     el partido no lo cambia. Nunca se fabrica.
//   inicioReal        Instante (ISO UTC) en que se inició el partido, SOLO si ya no está 'programado'; si no, null.
//                     Lo reporta el teléfono que controla el partido (su hora de acción).
//   inicio            (solo en la lectura de un partido) El valor `partido.inicio` del motor, sin reinterpretar: en un
//                     partido iniciado es el inicio real; en uno programado es el valor heredado (normalmente null).
//                     Para saber cuándo estaba programado, usar `programadoPara`.
//   sede              Texto de la sede de ESTE partido o null. No hay sede por defecto de la liga.
//   faltas            Total de faltas del equipo en TODO el partido (no por periodo); ver `faltasAlcance`.
//   faltasAlcance     Siempre 'partido': es el alcance del campo `faltas` (total de partido completo; lo usan la tabla y las
//                     estadísticas, y NO cambia con la categoría).
//   faltasEquipo      (solo en la lectura de un partido) Alcance de las faltas de equipo que el tablero MUESTRA: 'periodo' (Mini),
//                     'partido' (Intermedia, Adulto, Veteranos y todo partido sin reglas), 'oculto' (Baby) o 'no-disponible'
//                     (reglas guardadas pero inválidas o no soportadas: no se inventa otro alcance). Sale de las reglas
//                     FIJADAS en el partido al iniciarlo; en uno 'programado' todavía sin fijar, de la categoría vigente de la liga.
//   faltasPeriodo     (solo en la lectura de un partido, por equipo) Faltas vivas del equipo en el periodo visible, o null si el
//                     alcance no es 'periodo'. Los eventos de falta no se tocan al cambiar de periodo.
//   periodo, reloj    Como en el motor. `reloj.desdeMs`/`restanteMs` se calculan con `servidorAhoraMs`.
//   servidorAhoraMs   Hora del servidor al responder, para alinear el reloj del visitante.
//   anotaciones       (solo en la lectura de un partido) Las últimas canastas CONFIRMADAS de un partido 'vivo', de la más nueva a la más
//                     antigua, con tope (ANOTACIONES_PUBLICAS): [{ seq, lado: 'local' | 'visita', puntos, jugador: { nombre, dorsalActual } }].
//                     `seq` es la identidad estable del evento dentro del partido (nunca el id interno ni el del comando). Solo eventos de
//                     punto NO anulados con ficha asignada y nombre público conocido; deshacer o anular un evento lo quita de la
//                     lista, rehacerlo lo devuelve con el mismo `seq`. En un partido programado o final es []. El nombre es el nombre
//                     público de la ficha (como en la página del equipo); nunca nombre en camiseta, personaId ni el cuerpo del evento.
//   rev               Revisión del partido (cambia con cada orden aceptada).
//   Marcador, faltas y periodo salen de `resumen_partido` (ver resumen-publico.js), derivado de los eventos en la misma
//   transacción de cada orden aceptada. Si el resumen falta o no corresponde a la revisión/equipos vigentes, la lectura
//   responde 503 { error: 'resumen-no-disponible' }: nunca un marcador viejo ni un partido omitido.
//   No se publica la hora de la última acción deportiva: la hora de un evento la informa el teléfono (no es de
//   confianza) y la del servidor vive en la bandeja, que es interna.
// ---------------------------------------------------------------------------

/** Cuántas canastas recientes se publican de un partido en juego. */
export const ANOTACIONES_PUBLICAS = 6

export const CAMPOS_PUBLICOS = Object.freeze({
  raiz: ['gameId', 'rev', 'liga', 'estado', 'inicio', 'programadoPara', 'inicioReal', 'sede', 'periodo', 'reloj', 'servidorAhoraMs', 'faltasAlcance', 'faltasEquipo', 'anotaciones', 'local', 'visita'],
  liga: ['id', 'nombre', 'categoria', 'subcategoria'],
  anotacion: ['seq', 'lado', 'puntos', 'jugador'],
  jugadorAnotacion: ['nombre', 'dorsalActual'],
  reloj: ['estado', 'restanteMs', 'desdeMs'],
  equipo: ['id', 'nombre', 'puntos', 'faltas', 'faltasPeriodo'],
})

export const CAMPOS_PUBLICOS_LIGA = Object.freeze({
  raiz: ['liga', 'equipos', 'partidos', 'servidorAhoraMs', 'faltasAlcance'],
  liga: ['id', 'nombre', 'deporte', 'categoria', 'subcategoria'],
  equipo: ['id', 'nombre', 'rama'], // `rama`: 'masculino' | 'femenino' | 'mixta' | null (REPORT_220; nunca inferida)
  partido: ['gameId', 'rev', 'estado', 'programadoPara', 'inicioReal', 'sede', 'periodo', 'reloj', 'local', 'visita'],
  reloj: ['estado', 'restanteMs', 'desdeMs'],
  lado: ['id', 'puntos', 'faltas'],
})

/** Categoría y subcategoría guardadas → forma pública. Un valor guardado que no valida se publica como null. */
export function clasificacionPublica({ deporte, categoria, subcategoria_json: subJson }) {
  if (typeof categoria !== 'string') return { categoria: null, subcategoria: null }
  let sub
  try { sub = subJson === null || subJson === undefined ? undefined : JSON.parse(subJson) } catch { return { categoria: null, subcategoria: null } }
  const r = resolverClasificacion({ deporte, categoria, subcategoria: sub })
  return r.ok ? { categoria: r.categoria, subcategoria: r.subcategoria ?? null } : { categoria: null, subcategoria: null }
}

const textoONulo = (v) => (typeof v === 'string' && v !== '' ? v : null)
const relojDe = (p) => ({ estado: p.relojEstado ?? null, restanteMs: p.relojRestante ?? null, desdeMs: p.relojDesde ?? null })
const inicioRealDe = (p) => (p.estado !== 'programado' ? textoONulo(p.inicio) : null)

/**
 * Lectura de UN partido. `fila`: la fila de `partidos`; `resumen`: la fila VÁLIDA de `resumen_partido` (ya comprobada por
 * quien llama); estado y reloj salen de `estado_json` (no tiene eventos), nombres de `liga`, `local` y `visita`.
 */
export function proyectarPartidoPublico({ fila, resumen, liga, local, visita, servidorAhoraMs, anotaciones = [] }) {
  const estadoJson = JSON.parse(fila.estado_json)
  const p = estadoJson.partido ?? {}
  const reglas = reglasEfectivas({ config: estadoJson.config, estadoPartido: p.estado, deporte: liga.deporte, categoria: liga.categoria })
  // Reglas fijadas pero inválidas: se dice 'no-disponible' (nunca se reinterpretan como un partido sin reglas).
  const faltasEquipo = estadoDeReglas(estadoJson.config).estado === 'invalidas' ? 'no-disponible' : (reglas?.faltasEquipo ?? 'partido')
  const periodo = (n) => (faltasEquipo === 'periodo' ? n : null)
  return {
    gameId: fila.id,
    rev: fila.rev,
    liga: { id: liga.id, nombre: liga.nombre, ...clasificacionPublica(liga) },
    estado: p.estado ?? null,
    inicio: p.inicio ?? null,
    programadoPara: textoONulo(fila.programado_para),
    inicioReal: inicioRealDe(p),
    sede: textoONulo(fila.sede),
    periodo: resumen.periodo,
    reloj: relojDe(p),
    servidorAhoraMs,
    faltasAlcance: 'partido',
    faltasEquipo,
    anotaciones,
    local: { id: local.id, nombre: local.nombre, puntos: resumen.local_puntos, faltas: resumen.local_faltas, faltasPeriodo: periodo(resumen.local_faltas_periodo) },
    visita: { id: visita.id, nombre: visita.nombre, puntos: resumen.visita_puntos, faltas: resumen.visita_faltas, faltasPeriodo: periodo(resumen.visita_faltas_periodo) },
  }
}

/**
 * Lectura de toda la liga. `partidos`: [{ fila, resumen }] ya ordenados y con resumen válido (quien llama devuelve 503 si
 * alguno no lo es: nunca se omite un partido ni se publica un marcador viejo).
 */
export function proyectarLigaPublica({ liga, equipos, partidos, servidorAhoraMs }) {
  return {
    liga: { id: liga.id, nombre: liga.nombre, deporte: liga.deporte, ...clasificacionPublica(liga) },
    equipos: equipos.map((e) => ({ id: e.id, nombre: e.nombre, rama: e.rama ?? null })),
    partidos: partidos.map(({ fila: f, resumen: r }) => {
      const p = JSON.parse(f.estado_json).partido ?? {}
      return {
        gameId: f.id,
        rev: f.rev,
        estado: p.estado ?? null,
        programadoPara: textoONulo(f.programado_para),
        inicioReal: inicioRealDe(p),
        sede: textoONulo(f.sede),
        periodo: r.periodo,
        reloj: relojDe(p),
        local: { id: f.local_id, puntos: r.local_puntos, faltas: r.local_faltas },
        visita: { id: f.visita_id, puntos: r.visita_puntos, faltas: r.visita_faltas },
      }
    }),
    servidorAhoraMs,
    faltasAlcance: 'partido',
  }
}
