import { resolverClasificacion } from '../../src/lib/categorias.js'
import { canonico } from '../../src/lib/motor/sobre.js'
import { sha256Hex } from './credenciales.js'
import { esSede, insertarPartidoProgramado, normalizarProgramado } from './semilla.js'

// ---------------------------------------------------------------------------
// Carga de ESTRUCTURA y de PARTIDOS por el operador (dos llamadas separadas; ninguna toca jugadores, credenciales ni
// organizadores). No es un marco de importación ni una API de edición: solo AÑADE.
//
//   estructura  { cargaId, liga:{ id, nombre, deporte, categoria?, subcategoria?, minutosPorPeriodo? }, equipos:[{ id, nombre }] }
//   partidos    { cargaId, minutosPorPeriodo, partidos:[{ id, localId, visitaId, programadoPara?, sede? }] }
//
// TODO se valida ANTES de escribir (validarEstructura / validarPartidos son puras). Cada petición es UNA transactionSync:
// o queda todo o no cambia nada. La identidad durable es `cargaId` (tabla `cargas`) con la huella del contenido NORMALIZADO
// (claves ordenadas, listas ordenadas por id, instantes en UTC): mismo id y mismo contenido → éxito sin escrituras (se
// devuelve el resultado original); mismo id y otro contenido → conflicto, sin escrituras. Nunca se sobrescribe una liga,
// un equipo, un partido, un evento ni un recibo existentes. Los errores son códigos fijos: nunca eco del contenido.
//
// La duración del periodo NO se exige a la estructura (la liga la guarda nula si no se da) pero es OBLIGATORIA y explícita
// para crear partidos: cada partido la copia en su configuración al crearse, y no hay valor por omisión.
// ---------------------------------------------------------------------------

export const LIMITES_CARGA = Object.freeze({
  equipos: 100, // el mismo tope que la lectura pública de la liga
  partidosPorLote: 100,
  partidosPorLiga: 300, // el mismo tope que la lectura pública de la liga
  bytesEstructura: 32 * 1024,
  bytesPartidos: 48 * 1024,
  maxErrores: 20,
})

const ID = /^[A-Za-z0-9_-]{1,64}$/
const ID_CARGA = /^[A-Za-z0-9_-]{16,64}$/
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const soloClaves = (o, permitidas) => Object.keys(o).every((k) => permitidas.includes(k))
const esNombre = (v) => typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= 80 && !CONTROL.test(v)
// La misma clave de unicidad que la creación de ligas de la aplicación (NuevaLiga.jsx): recortado y en minúsculas.
const claveNombre = (n) => n.trim().toLowerCase()
const minutosValidos = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 120

/** Instante programado: texto ISO con zona EXPLÍCITA, de calendario real → ISO UTC; si no, null. (Date.parse acepta "30 de febrero".) */
function instanteUtc(v) {
  const m = typeof v === 'string' ? RE_ISO.exec(v) : null
  if (!m) return null
  const [anio, mes, dia, hora, minuto] = [m[1], m[2], m[3], m[4], m[5]].map(Number)
  const segundo = m[6] === undefined ? 0 : Number(m[6])
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes || hora > 23 || minuto > 59 || segundo > 59) return null
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return null
  return normalizarProgramado(v)
}

function acotar(errores) {
  return [...new Set(errores)].slice(0, LIMITES_CARGA.maxErrores)
}

/** → { ok: true, normalizado } | { ok: false, errores } */
export function validarEstructura(p, ligaIdDeLaRuta) {
  const e = []
  if (!esObjeto(p)) return { ok: false, errores: ['payload'] }
  if (!soloClaves(p, ['cargaId', 'liga', 'equipos'])) e.push('payload.campos')
  if (typeof p.cargaId !== 'string' || !ID_CARGA.test(p.cargaId)) e.push('cargaId')
  const liga = p.liga
  if (!esObjeto(liga)) e.push('liga')
  else {
    if (!soloClaves(liga, ['id', 'nombre', 'deporte', 'categoria', 'subcategoria', 'minutosPorPeriodo'])) e.push('liga.campos')
    if (typeof liga.id !== 'string' || !ID.test(liga.id) || liga.id !== ligaIdDeLaRuta) e.push('liga.id')
    if (!esNombre(liga.nombre)) e.push('liga.nombre')
    if (liga.deporte !== 'baloncesto') e.push('liga.deporte')
    if (liga.minutosPorPeriodo !== undefined && liga.minutosPorPeriodo !== null && !minutosValidos(liga.minutosPorPeriodo)) e.push('liga.minutosPorPeriodo')
    if (liga.categoria !== undefined || liga.subcategoria !== undefined) {
      if (!resolverClasificacion({ deporte: liga.deporte, categoria: liga.categoria, subcategoria: liga.subcategoria }).ok) e.push('liga.clasificacion')
    }
  }
  const equipos = Array.isArray(p.equipos) && p.equipos.length >= 1 && p.equipos.length <= LIMITES_CARGA.equipos ? p.equipos : null
  if (!equipos) e.push('equipos')
  else {
    const ids = new Set()
    const nombres = new Set()
    for (const q of equipos) {
      if (!esObjeto(q) || !soloClaves(q, ['id', 'nombre'])) { e.push('equipos.forma'); continue }
      if (typeof q.id !== 'string' || !ID.test(q.id)) e.push('equipos.id')
      else if (ids.has(q.id)) e.push('equipos.id-duplicado')
      else ids.add(q.id)
      if (!esNombre(q.nombre)) e.push('equipos.nombre')
      else if (nombres.has(claveNombre(q.nombre))) e.push('equipos.nombre-duplicado')
      else nombres.add(claveNombre(q.nombre))
    }
  }
  if (e.length) return { ok: false, errores: acotar(e) }

  const clasificacion = liga.categoria === undefined && liga.subcategoria === undefined
    ? null
    : resolverClasificacion({ deporte: liga.deporte, categoria: liga.categoria, subcategoria: liga.subcategoria })
  return {
    ok: true,
    normalizado: {
      cargaId: p.cargaId,
      liga: {
        id: liga.id, nombre: liga.nombre, deporte: liga.deporte, minutosPorPeriodo: liga.minutosPorPeriodo ?? null,
        categoria: clasificacion?.categoria ?? null, subcategoria: clasificacion?.subcategoria ?? null,
      },
      equipos: equipos.map((q) => ({ id: q.id, nombre: q.nombre })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    },
  }
}

/** → { ok: true, normalizado } | { ok: false, errores }. Los equipos se comprueban contra la liga guardada, dentro de la transacción. */
export function validarPartidos(p) {
  const e = []
  if (!esObjeto(p)) return { ok: false, errores: ['payload'] }
  if (!soloClaves(p, ['cargaId', 'minutosPorPeriodo', 'partidos'])) e.push('payload.campos')
  if (typeof p.cargaId !== 'string' || !ID_CARGA.test(p.cargaId)) e.push('cargaId')
  if (!minutosValidos(p.minutosPorPeriodo)) e.push('minutosPorPeriodo')
  const lista = Array.isArray(p.partidos) && p.partidos.length >= 1 && p.partidos.length <= LIMITES_CARGA.partidosPorLote ? p.partidos : null
  if (!lista) e.push('partidos')
  else {
    const ids = new Set()
    for (const g of lista) {
      if (!esObjeto(g) || !soloClaves(g, ['id', 'localId', 'visitaId', 'programadoPara', 'sede'])) { e.push('partidos.forma'); continue }
      if (typeof g.id !== 'string' || !ID.test(g.id)) e.push('partidos.id')
      else if (ids.has(g.id)) e.push('partidos.id-duplicado')
      else ids.add(g.id)
      if (typeof g.localId !== 'string' || !ID.test(g.localId) || typeof g.visitaId !== 'string' || !ID.test(g.visitaId)) e.push('partidos.equipos')
      else if (g.localId === g.visitaId) e.push('partidos.rivales-iguales')
      if (g.programadoPara !== undefined && g.programadoPara !== null && instanteUtc(g.programadoPara) === null) e.push('partidos.programadoPara')
      if (g.sede !== undefined && g.sede !== null && !esSede(g.sede)) e.push('partidos.sede')
    }
  }
  if (e.length) return { ok: false, errores: acotar(e) }
  return {
    ok: true,
    normalizado: {
      cargaId: p.cargaId,
      minutosPorPeriodo: p.minutosPorPeriodo,
      partidos: lista.map((g) => ({
        id: g.id, localId: g.localId, visitaId: g.visitaId,
        programadoPara: g.programadoPara == null ? null : instanteUtc(g.programadoPara),
        sede: g.sede ?? null,
      })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    },
  }
}

/** Huella del contenido normalizado, ligada al tipo de carga y a la liga. */
export const huellaDeCarga = (tipo, ligaId, normalizado) => sha256Hex(canonico({ tipo, ligaId, normalizado }))

const CONFLICTO_CARGA = Object.freeze({ status: 409, cuerpo: Object.freeze({ error: 'carga-conflicto' }) })
const rechazo = (status, error) => ({ status, cuerpo: { error } })

/** Recibo previo de la carga: undefined si no existe; si existe, el resultado original o el conflicto. */
function reciboPrevio(sql, cargaId, tipo, huella) {
  const previo = sql.exec('SELECT tipo, huella, resultado_json FROM cargas WHERE carga_id = ?', cargaId).toArray()[0]
  if (!previo) return undefined
  if (previo.tipo !== tipo || previo.huella !== huella) return CONFLICTO_CARGA
  return { status: 200, cuerpo: { ...JSON.parse(previo.resultado_json), reproducido: true } }
}

function guardarCarga(sql, cargaId, tipo, huella, resultado, ahora) {
  sql.exec('INSERT INTO cargas (carga_id, tipo, huella, resultado_json, creado_en) VALUES (?, ?, ?, ?, ?)', cargaId, tipo, huella, JSON.stringify(resultado), ahora)
  return { status: 201, cuerpo: { ...resultado, reproducido: false } }
}

/** UNA transacción: liga + equipos + recibo. → { status, cuerpo } */
export function cargarEstructura(storage, { normalizado: n, huella, ahora }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const previo = reciboPrevio(sql, n.cargaId, 'estructura', huella)
    if (previo) return previo
    // Nunca se sobrescribe ni se amplía una liga existente (tampoco una sembrada o con plantillas o partidos).
    const hayAlgo = ['ligas', 'equipos', 'jugadores', 'partidos'].some((t) => sql.exec(`SELECT 1 AS x FROM ${t} LIMIT 1`).toArray().length > 0)
    if (hayAlgo) return rechazo(409, 'liga-ya-cargada')
    const { liga } = n
    sql.exec(
      'INSERT INTO ligas (id, nombre, deporte, minutos_por_periodo, categoria, subcategoria_json) VALUES (?, ?, ?, ?, ?, ?)',
      liga.id, liga.nombre, liga.deporte, liga.minutosPorPeriodo, liga.categoria, liga.subcategoria === null ? null : JSON.stringify(liga.subcategoria),
    )
    for (const q of n.equipos) sql.exec('INSERT INTO equipos (id, liga_id, nombre) VALUES (?, ?, ?)', q.id, liga.id, q.nombre)
    return guardarCarga(sql, n.cargaId, 'estructura', huella, { ok: true, cargaId: n.cargaId, tipo: 'estructura', ligaId: liga.id, equipos: n.equipos.length }, ahora)
  })
}

/** UNA transacción: todos los partidos del lote + sus resúmenes + recibo. Solo añade. → { status, cuerpo } */
export function cargarPartidos(storage, { ligaId, normalizado: n, huella, ahora }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const previo = reciboPrevio(sql, n.cargaId, 'partidos', huella)
    if (previo) return previo
    const liga = sql.exec('SELECT id, deporte, minutos_por_periodo FROM ligas WHERE id = ?', ligaId).toArray()[0]
    if (!liga) return rechazo(409, 'liga-sin-estructura')
    // Sin valor por omisión: la duración explícita del lote no puede contradecir la que la liga ya declara.
    if (liga.minutos_por_periodo !== null && liga.minutos_por_periodo !== n.minutosPorPeriodo) return rechazo(409, 'duracion-distinta')
    // Todos los partidos de una liga comparten duración: un lote posterior no puede introducir otra.
    for (const f of sql.exec('SELECT estado_json FROM partidos').toArray()) {
      const m = JSON.parse(f.estado_json)?.config?.minutosPorPeriodo ?? null
      if (m !== null && m !== n.minutosPorPeriodo) return rechazo(409, 'duracion-distinta')
    }
    const equipos = new Set(sql.exec('SELECT id FROM equipos WHERE liga_id = ?', ligaId).toArray().map((f) => f.id))
    if (!n.partidos.every((g) => equipos.has(g.localId) && equipos.has(g.visitaId))) return rechazo(422, 'equipos-desconocidos')
    for (const g of n.partidos) {
      if (sql.exec('SELECT 1 AS x FROM partidos WHERE id = ?', g.id).toArray().length) return rechazo(409, 'partido-existente')
    }
    const existentes = sql.exec('SELECT COUNT(*) AS n FROM partidos').one().n
    if (existentes + n.partidos.length > LIMITES_CARGA.partidosPorLiga) return rechazo(409, 'liga-demasiado-grande')
    for (const g of n.partidos) {
      insertarPartidoProgramado(sql, {
        ligaId, deporte: liga.deporte, minutosPorPeriodo: n.minutosPorPeriodo,
        id: g.id, localId: g.localId, visitaId: g.visitaId, programadoPara: g.programadoPara, sede: g.sede,
      })
    }
    // El estado que se informa es el GUARDADO, no una afirmación: se relee de cada fila recién creada.
    const partidos = n.partidos.map((g) => {
      const f = sql.exec('SELECT estado_json, programado_para, sede FROM partidos WHERE id = ?', g.id).one()
      return { id: g.id, estado: JSON.parse(f.estado_json).partido.estado, programadoPara: f.programado_para, sede: f.sede }
    })
    return guardarCarga(sql, n.cargaId, 'partidos', huella, { ok: true, cargaId: n.cargaId, tipo: 'partidos', ligaId, minutosPorPeriodo: n.minutosPorPeriodo, partidos }, ahora)
  })
}
