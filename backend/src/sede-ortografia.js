import { huellaDeCarga } from './carga.js'
import { esSede } from './semilla.js'

// ---------------------------------------------------------------------------
// CORREGIR LA ORTOGRAFÍA DE LA SEDE de partidos programados Y TERMINADOS (REPORT_242): operación del OPERADOR. Misma puerta: puerta del operador + Bearer + liga admitida (ver rutas-carga.js).
//
//   POST /v1/admin/ligas/{liga}/partidos/sede-ortografia
//   { "cargaId": "<16–64>", "sedeAnterior": "<texto>", "sede": "<texto>", "partidos": ["<id>", …] }      cuerpo EXACTO, sin otros campos
//
// QUÉ SE PERMITE. `sedeAnterior` y `sede` deben ser el MISMO lugar escrito distinto: solo pueden diferir en tildes/diéresis, mayúsculas/minúsculas y espacios
// (comparación sin diacríticos, sin distinguir mayúsculas y sin espacios). Una sede realmente distinta se rechaza (422 `sede-no-es-ortografia`); una sede distinta no es ortografía y no se corrige aquí. Los dos textos son NFC y cumplen la validación de sede de siempre (1–80, sin espacios en los extremos, sin caracteres de control).
//
// QUÉ CAMBIA. SOLO `partidos.sede` de los partidos nombrados y solo si hoy valen EXACTAMENTE `sedeAnterior` (se compara el texto guardado, no su forma normalizada),
// más la auditoría de ESTA operación (`partido-sede-ortografia-corregida`) y su recibo (`cargas`, tipo `sede-ortografia`). No toca eventos, recibos de órdenes,
// marcadores, reloj, `rev`, fechas, ids, credenciales, códigos ni los recibos de las cargas originales.
//
// GUARDAS (todo el lote o nada, dentro de ESTA liga; no hay atomicidad entre ligas):
//   partidos-desconocidos (422)   algún id no es de esta liga
//   sede-no-segura (409)          retirado | no-corregible (solo se admiten partidos programados o finales; uno en juego u otro estado se rechaza)
//   sede-en-conflicto (409)       la sede guardada no es ni `sedeAnterior` ni `sede` (se informa la actual)
// Las guardas valen para TODO el lote, incluso los que ya tienen la sede nueva; cuando todos son seguros, uno que YA tiene `sede` cuenta como `yaCorregidos` (sin
// escritura ni auditoría). Una repetición EXACTA de una operación ya exitosa se resuelve antes con su recibo (sin mirar el estado actual): mismo cargaId con otro contenido
// o de otro tipo → 409 `carga-conflicto`. UNA transactionSync; un rechazo no guarda recibo. REVERSIÓN: operación NUEVA (otro cargaId) con los textos intercambiados.
// ---------------------------------------------------------------------------

// Límites propios: este módulo no depende de «corregir sede» (sede-partidos.js), que esta versión no incluye.
export const LIMITE_PARTIDOS_ORTOGRAFIA = 50
export const LIMITE_BYTES_ORTOGRAFIA = 8 * 1024
export const TIPO_ORTOGRAFIA = 'sede-ortografia'
const ID = /^[A-Za-z0-9_-]{1,64}$/
const ID_CARGA = /^[A-Za-z0-9_-]{16,64}$/
const ESTADOS_ADMITIDOS = ['programado', 'final']
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const textoSede = (v) => esSede(v) && v === v.normalize('NFC')

/** Forma comparable: sin diacríticos, sin mayúsculas ni espacios. Dos sedes con la misma clave son el mismo lugar escrito distinto. */
export const claveOrtografica = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, '')

/** Cuerpo EXACTO. → { ok: true, normalizado } | { ok: false, errores } */
export function validarOrtografia(p) {
  const e = []
  if (!esObjeto(p)) return { ok: false, errores: ['payload'] }
  if (Object.keys(p).some((k) => !['cargaId', 'sedeAnterior', 'sede', 'partidos'].includes(k))) e.push('payload.campos')
  if (typeof p.cargaId !== 'string' || !ID_CARGA.test(p.cargaId)) e.push('cargaId')
  if (!textoSede(p.sedeAnterior)) e.push('sedeAnterior')
  if (!textoSede(p.sede)) e.push('sede')
  if (textoSede(p.sedeAnterior) && textoSede(p.sede)) {
    if (p.sede === p.sedeAnterior) e.push('sede-igual')
    else if (claveOrtografica(p.sede) !== claveOrtografica(p.sedeAnterior)) e.push('sede-no-es-ortografia')
  }
  const lista = Array.isArray(p.partidos) && p.partidos.length >= 1 && p.partidos.length <= LIMITE_PARTIDOS_ORTOGRAFIA ? p.partidos : null
  if (!lista) e.push('partidos')
  else if (!lista.every((id) => typeof id === 'string' && ID.test(id))) e.push('partidos.id')
  else if (new Set(lista).size !== lista.length) e.push('partidos.id-duplicado')
  if (e.length) return { ok: false, errores: e }
  return { ok: true, normalizado: { cargaId: p.cargaId, sedeAnterior: p.sedeAnterior, sede: p.sede, partidos: [...lista].sort() } }
}

export const huellaDeOrtografia = (ligaId, normalizado) => huellaDeCarga(TIPO_ORTOGRAFIA, ligaId, normalizado)

const CONFLICTO = Object.freeze({ status: 409, cuerpo: Object.freeze({ error: 'carga-conflicto' }) })
const rechazo = (status, error, extra = {}) => ({ status, cuerpo: { error, ...extra } })

/** UNA transacción. → { status, cuerpo } */
export function corregirOrtografiaSede(storage, { ligaId, normalizado: n, huella, ahora }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const previo = sql.exec('SELECT tipo, huella, resultado_json FROM cargas WHERE carga_id = ?', n.cargaId).toArray()[0]
    if (previo) {
      if (previo.tipo !== TIPO_ORTOGRAFIA || previo.huella !== huella) return CONFLICTO
      return { status: 200, cuerpo: { ...JSON.parse(previo.resultado_json), reproducido: true } }
    }
    if (!sql.exec('SELECT id FROM ligas WHERE id = ?', ligaId).toArray()[0]) return rechazo(409, 'liga-sin-estructura')
    const filas = new Map()
    const desconocidos = []
    for (const id of n.partidos) {
      const f = sql.exec('SELECT id, sede, estado_json, retirado_en FROM partidos WHERE id = ? AND liga_id = ?', id, ligaId).toArray()[0]
      if (f) filas.set(id, f); else desconocidos.push(id)
    }
    if (desconocidos.length) return rechazo(422, 'partidos-desconocidos', { partidos: desconocidos })
    const conflictos = []
    const riesgos = []
    for (const [id, f] of filas) {
      if (f.retirado_en !== null) { riesgos.push({ id, motivos: ['retirado'] }); continue }
      let estado = null
      try { estado = JSON.parse(f.estado_json)?.partido?.estado ?? null } catch { /* ilegible: no se corrige */ }
      if (!ESTADOS_ADMITIDOS.includes(estado)) { riesgos.push({ id, motivos: ['no-corregible'] }); continue }
      if (f.sede !== n.sede && f.sede !== n.sedeAnterior) conflictos.push({ id, actual: f.sede })
    }
    if (riesgos.length) return rechazo(409, 'sede-no-segura', { partidos: riesgos })
    if (conflictos.length) return rechazo(409, 'sede-en-conflicto', { partidos: conflictos })
    const corregidos = []
    const yaCorregidos = []
    for (const [id, f] of filas) {
      if (f.sede === n.sede) { yaCorregidos.push(id); continue }
      sql.exec('UPDATE partidos SET sede = ? WHERE id = ? AND liga_id = ? AND sede = ? AND retirado_en IS NULL', n.sede, id, ligaId, n.sedeAnterior)
      if (sql.exec('SELECT sede FROM partidos WHERE id = ?', id).one().sede !== n.sede) throw new Error('sede-no-actualizada') // revierte TODA la transacción
      sql.exec('INSERT INTO auditoria_acceso (ts, tipo, partido_id, organizador_id, sesion_id, detalle) VALUES (?, ?, ?, NULL, NULL, ?)', ahora, 'partido-sede-ortografia-corregida', id, `carga:${n.cargaId}`)
      corregidos.push(id)
    }
    const resultado = { ok: true, cargaId: n.cargaId, tipo: TIPO_ORTOGRAFIA, ligaId, sedeAnterior: n.sedeAnterior, sede: n.sede, corregidos: corregidos.sort(), yaCorregidos: yaCorregidos.sort() }
    sql.exec('INSERT INTO cargas (carga_id, tipo, huella, resultado_json, creado_en) VALUES (?, ?, ?, ?, ?)', n.cargaId, TIPO_ORTOGRAFIA, huella, JSON.stringify(resultado), ahora)
    return { status: 201, cuerpo: { ...resultado, reproducido: false } }
  })
}
