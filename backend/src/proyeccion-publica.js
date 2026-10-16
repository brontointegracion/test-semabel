import { resolverClasificacion } from '../../src/lib/categorias.js'

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
//   programadoPara    Instante programado (ISO UTC) o null si no se conoce. Es independiente del inicio real: iniciar
//                     el partido no lo cambia. Nunca se fabrica.
//   inicioReal        Instante (ISO UTC) en que se inició el partido, SOLO si ya no está 'programado'; si no, null.
//                     Lo reporta el teléfono que controla el partido (su hora de acción).
//   inicio            (solo en la lectura de un partido) El valor `partido.inicio` del motor, sin reinterpretar: en un
//                     partido iniciado es el inicio real; en uno programado es el valor heredado (normalmente null).
//                     Para saber cuándo estaba programado, usar `programadoPara`.
//   sede              Texto de la sede de ESTE partido o null. No hay sede por defecto de la liga.
//   faltas            Total de faltas del equipo en TODO el partido (no por periodo); ver `faltasAlcance`.
//   faltasAlcance     Siempre 'partido'.
//   periodo, reloj    Como en el motor. `reloj.desdeMs`/`restanteMs` se calculan con `servidorAhoraMs`.
//   servidorAhoraMs   Hora del servidor al responder, para alinear el reloj del visitante.
//   rev               Revisión del partido (cambia con cada orden aceptada).
//   Marcador, faltas y periodo salen de `resumen_partido` (ver resumen-publico.js), derivado de los eventos en la misma
//   transacción de cada orden aceptada. Si el resumen falta o no corresponde a la revisión/equipos vigentes, la lectura
//   responde 503 { error: 'resumen-no-disponible' }: nunca un marcador viejo ni un partido omitido.
//   No se publica la hora de la última acción deportiva: la hora de un evento la informa el teléfono (no es de
//   confianza) y la del servidor vive en la bandeja, que es interna.
// ---------------------------------------------------------------------------

export const CAMPOS_PUBLICOS = Object.freeze({
  raiz: ['gameId', 'rev', 'liga', 'estado', 'inicio', 'programadoPara', 'inicioReal', 'sede', 'periodo', 'reloj', 'servidorAhoraMs', 'faltasAlcance', 'local', 'visita'],
  liga: ['id', 'nombre', 'categoria', 'subcategoria'],
  reloj: ['estado', 'restanteMs', 'desdeMs'],
  equipo: ['id', 'nombre', 'puntos', 'faltas'],
})

export const CAMPOS_PUBLICOS_LIGA = Object.freeze({
  raiz: ['liga', 'equipos', 'partidos', 'servidorAhoraMs', 'faltasAlcance'],
  liga: ['id', 'nombre', 'deporte', 'categoria', 'subcategoria'],
  equipo: ['id', 'nombre'],
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
export function proyectarPartidoPublico({ fila, resumen, liga, local, visita, servidorAhoraMs }) {
  const p = JSON.parse(fila.estado_json).partido ?? {}
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
    local: { id: local.id, nombre: local.nombre, puntos: resumen.local_puntos, faltas: resumen.local_faltas },
    visita: { id: visita.id, nombre: visita.nombre, puntos: resumen.visita_puntos, faltas: resumen.visita_faltas },
  }
}

/**
 * Lectura de toda la liga. `partidos`: [{ fila, resumen }] ya ordenados y con resumen válido (quien llama devuelve 503 si
 * alguno no lo es: nunca se omite un partido ni se publica un marcador viejo).
 */
export function proyectarLigaPublica({ liga, equipos, partidos, servidorAhoraMs }) {
  return {
    liga: { id: liga.id, nombre: liga.nombre, deporte: liga.deporte, ...clasificacionPublica(liga) },
    equipos: equipos.map((e) => ({ id: e.id, nombre: e.nombre })),
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
