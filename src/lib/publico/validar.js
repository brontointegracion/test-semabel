import { ID_PUBLICO } from './config.js'

// ---------------------------------------------------------------------------
// Validación ESTRICTA de lo que responde el servidor. Cada función devuelve una COPIA armada campo por campo (nada que el
// servidor añada llega a las pantallas) o `null` si algo no cuadra: tipos, rangos, enumeraciones, tamaños y que los
// identificadores sean los pedidos. Una respuesta inválida nunca se muestra, ni a medias.
// ---------------------------------------------------------------------------

const MAX_PARTIDOS = 300
const MAX_EQUIPOS = 100
const ESTADOS = ['programado', 'vivo', 'final']
const RELOJES = ['detenido', 'corriendo']
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const entero = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max
const texto = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max
const textoONulo = (v, max) => v === null || texto(v, max)
const instanteONulo = (v) => v === null || (typeof v === 'string' && v.length <= 40 && RE_ISO.test(v) && Number.isFinite(Date.parse(v)))
const idDeEntidad = (v) => texto(v, 200)

function clasificacion(liga) {
  const { categoria, subcategoria } = liga
  if (!textoONulo(categoria, 40)) return null
  let sub = null
  if (subcategoria !== null) {
    if (!objeto(subcategoria)) return null
    const claves = Object.keys(subcategoria)
    if (claves.length !== 1) return null
    if (claves[0] === 'clave' && texto(subcategoria.clave, 40)) sub = { clave: subcategoria.clave }
    else if (claves[0] === 'texto' && texto(subcategoria.texto, 60)) sub = { texto: subcategoria.texto }
    else return null
  }
  return { categoria, subcategoria: sub }
}

function reloj(r) {
  if (!objeto(r)) return null
  if (!(r.estado === null || RELOJES.includes(r.estado))) return null
  if (!(r.restanteMs === null || entero(r.restanteMs, 0, 86_400_000))) return null
  if (!(r.desdeMs === null || entero(r.desdeMs, 0, 8.64e15))) return null
  return { estado: r.estado, restanteMs: r.restanteMs, desdeMs: r.desdeMs }
}

const lado = (l, conNombre) => {
  if (!objeto(l) || !idDeEntidad(l.id) || !entero(l.puntos, 0, 9999) || !entero(l.faltas, 0, 9999)) return null
  if (conNombre && !texto(l.nombre, 200)) return null
  if (!conNombre) return { id: l.id, puntos: l.puntos, faltas: l.faltas }
  // `faltasPeriodo` (solo en la lectura de un partido): ausente = null (respuesta de un servidor anterior); si está, entero o null.
  const fp = l.faltasPeriodo === undefined ? null : l.faltasPeriodo
  if (!(fp === null || entero(fp, 0, 9999))) return null
  return { id: l.id, nombre: l.nombre, puntos: l.puntos, faltas: l.faltas, faltasPeriodo: fp }
}

/** Campos comunes a un partido de la liga y a la lectura de un partido. */
function comunes(x, conNombres) {
  if (!ESTADOS.includes(x.estado) || !entero(x.rev, 0, Number.MAX_SAFE_INTEGER) || !entero(x.periodo, 1, 20)) return null
  if (!instanteONulo(x.programadoPara) || !instanteONulo(x.inicioReal) || !textoONulo(x.sede, 80)) return null
  if (x.estado === 'programado' && x.inicioReal !== null) return null
  const r = reloj(x.reloj)
  const local = lado(x.local, conNombres)
  const visita = lado(x.visita, conNombres)
  if (!r || !local || !visita) return null
  return {
    estado: x.estado, rev: x.rev, periodo: x.periodo, programadoPara: x.programadoPara, inicioReal: x.inicioReal, sede: x.sede,
    reloj: r, local, visita,
  }
}

/** Respuesta de GET /v1/ligas/{liga}/publico → copia validada o null. */
export function validarLiga(x, ligaId) {
  if (!objeto(x) || !ID_PUBLICO.test(ligaId)) return null
  const { liga } = x
  if (!objeto(liga) || liga.id !== ligaId || !texto(liga.nombre, 200) || !texto(liga.deporte, 40)) return null
  const clas = clasificacion(liga)
  if (!clas) return null
  if (!entero(x.servidorAhoraMs, 1, 8.64e15) || x.faltasAlcance !== 'partido') return null
  if (!Array.isArray(x.equipos) || x.equipos.length > MAX_EQUIPOS || !Array.isArray(x.partidos) || x.partidos.length > MAX_PARTIDOS) return null
  const equipos = []
  const idsEquipo = new Set()
  for (const e of x.equipos) {
    if (!objeto(e) || !idDeEntidad(e.id) || !texto(e.nombre, 200) || idsEquipo.has(e.id)) return null
    idsEquipo.add(e.id)
    equipos.push({ id: e.id, nombre: e.nombre })
  }
  const partidos = []
  const idsPartido = new Set()
  for (const p of x.partidos) {
    if (!objeto(p) || !texto(p.gameId, 64) || !ID_PUBLICO.test(p.gameId) || idsPartido.has(p.gameId)) return null
    idsPartido.add(p.gameId)
    const c = comunes(p, false)
    if (!c) return null
    partidos.push({ gameId: p.gameId, ...c })
  }
  return {
    liga: { id: liga.id, nombre: liga.nombre, deporte: liga.deporte, ...clas },
    equipos, partidos, servidorAhoraMs: x.servidorAhoraMs,
  }
}

/** Respuesta de GET /v1/ligas/{liga}/partidos/{juego} → copia validada o null. */
export function validarJuego(x, ligaId, gameId) {
  if (!objeto(x) || !ID_PUBLICO.test(ligaId) || !ID_PUBLICO.test(gameId)) return null
  if (x.gameId !== gameId || !objeto(x.liga) || x.liga.id !== ligaId || !texto(x.liga.nombre, 200)) return null
  const clas = clasificacion(x.liga)
  if (!clas) return null
  if (!entero(x.servidorAhoraMs, 1, 8.64e15) || x.faltasAlcance !== 'partido') return null
  if (!(x.inicio === null || (typeof x.inicio === 'string' && x.inicio.length <= 40))) return null
  // Alcance de las faltas de equipo que se muestran: ausente = 'partido' (servidor anterior); un valor desconocido se rechaza.
  const faltasEquipo = x.faltasEquipo === undefined ? 'partido' : x.faltasEquipo
  if (!['periodo', 'partido', 'oculto', 'no-disponible'].includes(faltasEquipo)) return null
  const c = comunes(x, true)
  if (!c) return null
  if (faltasEquipo === 'periodo' && (c.local.faltasPeriodo === null || c.visita.faltasPeriodo === null)) return null
  return { gameId, faltasEquipo, liga: { id: x.liga.id, nombre: x.liga.nombre, ...clas }, servidorAhoraMs: x.servidorAhoraMs, anotaciones: anotacionesDe(x.anotaciones), ...c }
}

/**
 * Canastas confirmadas del partido en juego (REPORT_191). Un dato ausente (servidor anterior) o malo NO invalida el marcador: se entrega
 * `null` y el reconocimiento simplemente no actúa. Se copia solo lo aprobado, campo por campo.
 */
function anotacionesDe(x) {
  if (!Array.isArray(x) || x.length > 12) return null
  const salida = []
  const seqs = new Set()
  for (const a of x) {
    if (!objeto(a) || !entero(a.seq, 1, 1e9) || seqs.has(a.seq) || !['local', 'visita'].includes(a.lado) || !entero(a.puntos, 1, 9)) return null
    if (!objeto(a.jugador) || !texto(a.jugador.nombre, 200) || !dorsalONulo(a.jugador.dorsalActual)) return null
    seqs.add(a.seq)
    salida.push({ seq: a.seq, lado: a.lado, puntos: a.puntos, jugador: { nombre: a.jugador.nombre, dorsalActual: a.jugador.dorsalActual } })
  }
  return salida
}

const MOTIVOS = ['inactivo', 'otro-equipo', 'no-encontrado']
const dorsalONulo = (v) => v === null || entero(v, 0, 99)

function ladoDeResultado(l) {
  if (!objeto(l) || !idDeEntidad(l.id) || !texto(l.nombre, 200) || !entero(l.puntos, 0, 9999) || !entero(l.faltas, 0, 9999)) return null
  return { id: l.id, nombre: l.nombre, puntos: l.puntos, faltas: l.faltas }
}

/** Respuesta de GET /v1/ligas/{liga}/equipos/{equipo}/publico → copia validada o null. */
export function validarEquipo(x, ligaId, equipoId) {
  if (!objeto(x) || !ID_PUBLICO.test(ligaId) || !ID_PUBLICO.test(equipoId)) return null
  if (!objeto(x.liga) || x.liga.id !== ligaId || !texto(x.liga.nombre, 200)) return null
  if (!objeto(x.equipo) || x.equipo.id !== equipoId || !texto(x.equipo.nombre, 200)) return null
  if (!entero(x.servidorAhoraMs, 1, 8.64e15)) return null
  if (!Array.isArray(x.plantilla) || x.plantilla.length > 300 || !Array.isArray(x.historicos) || x.historicos.length > 300) return null
  if (!Array.isArray(x.resultados) || x.resultados.length > 100) return null
  const vistos = new Set()
  const ficha = (j, conMotivo) => {
    if (!objeto(j) || !idDeEntidad(j.id) || vistos.has(j.id) || !textoONulo(j.nombre, 200) || !dorsalONulo(j.dorsalActual)) return null
    if (conMotivo && !MOTIVOS.includes(j.motivo)) return null
    vistos.add(j.id)
    return conMotivo
      ? { id: j.id, nombre: j.nombre, dorsalActual: j.dorsalActual, motivo: j.motivo }
      : { id: j.id, nombre: j.nombre, dorsalActual: j.dorsalActual }
  }
  const plantilla = []
  for (const j of x.plantilla) { const v = ficha(j, false); if (!v) return null; plantilla.push(v) }
  const historicos = []
  for (const j of x.historicos) { const v = ficha(j, true); if (!v) return null; historicos.push(v) }
  const resultados = []
  const idsPartido = new Set()
  for (const r of x.resultados) {
    if (!objeto(r) || !texto(r.gameId, 64) || !ID_PUBLICO.test(r.gameId) || idsPartido.has(r.gameId)) return null
    idsPartido.add(r.gameId)
    if (!instanteONulo(r.programadoPara) || !instanteONulo(r.inicioReal) || !textoONulo(r.sede, 80)) return null
    const local = ladoDeResultado(r.local)
    const visita = ladoDeResultado(r.visita)
    if (!local || !visita) return null
    resultados.push({ gameId: r.gameId, programadoPara: r.programadoPara, inicioReal: r.inicioReal, sede: r.sede, local, visita })
  }
  const e = x.estadisticas
  if (!objeto(e) || e.alcance !== 'partidos-finales-del-equipo' || !entero(e.partidosFinales, 0, 1000) || !Array.isArray(e.jugadores) || e.jugadores.length > 300) return null
  if (!objeto(e.sinJugador) || !entero(e.sinJugador.puntos, 0, 1e9) || !entero(e.sinJugador.faltas, 0, 1e9)) return null
  const jugadores = []
  const idsEst = new Set()
  for (const s of e.jugadores) {
    if (!objeto(s) || !idDeEntidad(s.id) || idsEst.has(s.id) || !entero(s.puntos, 0, 1e9) || !entero(s.faltas, 0, 1e9)) return null
    idsEst.add(s.id)
    jugadores.push({ id: s.id, puntos: s.puntos, faltas: s.faltas })
  }
  // Toda ficha con estadísticas está en la plantilla o en los históricos: nada queda sin nombre ni lugar.
  for (const id of idsEst) if (!vistos.has(id)) return null
  return {
    liga: { id: x.liga.id, nombre: x.liga.nombre }, equipo: { id: x.equipo.id, nombre: x.equipo.nombre }, plantilla, historicos, resultados,
    estadisticas: { alcance: e.alcance, partidosFinales: e.partidosFinales, jugadores, sinJugador: { puntos: e.sinJugador.puntos, faltas: e.sinJugador.faltas } },
    servidorAhoraMs: x.servidorAhoraMs,
  }
}

/** Respuesta de GET /v1/ligas/{liga}/jugadores/publico → copia validada o null (campo por campo; nada extra pasa). */
export function validarJugadores(x, ligaId) {
  if (!objeto(x) || !ID_PUBLICO.test(ligaId)) return null
  if (!objeto(x.liga) || x.liga.id !== ligaId || !texto(x.liga.nombre, 200)) return null
  if (x.alcance !== 'partidos-finales-de-la-liga' || x.agrupacion !== 'ficha-y-equipo') return null
  if (!entero(x.partidosFinales, 0, 1000) || !entero(x.servidorAhoraMs, 1, 8.64e15) || typeof x.recortado !== 'boolean') return null
  if (!objeto(x.sinJugador) || !entero(x.sinJugador.puntos, 0, 1e9) || !entero(x.sinJugador.faltas, 0, 1e9)) return null
  const lista = (xs, campo) => {
    if (!Array.isArray(xs) || xs.length > 50) return null
    const salida = []
    let previo = null
    for (const e of xs) {
      if (!objeto(e) || !entero(e.rango, 1, 1000) || !idDeEntidad(e.id) || !textoONulo(e.nombre, 200) || !dorsalONulo(e.dorsalActual)) return null
      if (!objeto(e.equipo) || !idDeEntidad(e.equipo.id) || !texto(e.equipo.nombre, 200) || typeof e.enPlantilla !== 'boolean') return null
      if (!entero(e.puntos, 0, 1e9) || !entero(e.faltas, 0, 1e9) || e[campo] < 1) return null
      if (previo !== null && (e[campo] > previo[campo] || e.rango < previo.rango)) return null
      previo = e
      salida.push({ rango: e.rango, id: e.id, nombre: e.nombre, dorsalActual: e.dorsalActual, equipo: { id: e.equipo.id, nombre: e.equipo.nombre }, enPlantilla: e.enPlantilla, puntos: e.puntos, faltas: e.faltas })
    }
    return salida
  }
  const maximosAnotadores = lista(x.maximosAnotadores, 'puntos')
  const masFaltas = lista(x.masFaltas, 'faltas')
  if (!maximosAnotadores || !masFaltas) return null
  return {
    liga: { id: x.liga.id, nombre: x.liga.nombre }, alcance: x.alcance, agrupacion: x.agrupacion, partidosFinales: x.partidosFinales,
    maximosAnotadores, masFaltas, recortado: x.recortado, sinJugador: { puntos: x.sinJugador.puntos, faltas: x.sinJugador.faltas },
    servidorAhoraMs: x.servidorAhoraMs,
  }
}
