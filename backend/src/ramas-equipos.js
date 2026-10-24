import { huellaDeCarga } from './carga.js'

// ---------------------------------------------------------------------------
// RAMA de un equipo (REPORT_220): metadato del EQUIPO (no de la liga ni de la clasificación por categoría), nullable y NUNCA inferido.
//
//   Valores guardados (clave estable):  'masculino' | 'femenino' | 'mixta'     (se muestran «Masculino», «Femenino», «Mixta»)
//   NULL = no se ha fijado: no se muestra nada, no hay valor por omisión y nada la deduce del nombre, la edad, el número ni la categoría.
//   La rama NO entra en puntuación, elegibilidad, plantillas, estadísticas ni en la clasificación de la liga (categoría/subcategoría).
//
// DÓNDE SE FIJA
//   · al CREAR el equipo, con `rama` opcional por equipo en las cargas `estructura` y `equipos` (ver carga.js; sin `rama` el equipo queda en NULL);
//   · en equipos YA existentes, con ESTA operación del operador (puerta del operador + Bearer + liga admitida; ver rutas-carga.js):
//       POST /v1/admin/ligas/{liga}/equipos/ramas     { "cargaId": "<16–64>", "ramas": [ { "equipoId": "…", "rama": "mixta" }, … ] }   (1–100, cuerpo EXACTO)
//
// SEMÁNTICA DE LA OPERACIÓN (UNA transactionSync del objeto de liga; todo o nada dentro de la liga)
//   · equipo desconocido en la liga → 422 `equipos-desconocidos` (con los ids), nada cambia;
//   · equipo con una rama DISTINTA ya guardada → 409 `rama-en-conflicto` (con { equipoId, actual }), nada cambia: CORREGIR UN VALOR NO VACÍO queda FUERA de esta operación;
//   · equipo con la MISMA rama → se acepta y no se modifica (`yaTenian`); equipo con NULL → se fija (`asignados`) y queda auditado (`equipo-rama-asignada`).
//   Idempotencia = la de las cargas (tabla `cargas`, tipo `ramas`): mismo `cargaId` + mismo contenido → el resultado ORIGINAL (`reproducido: true`); otro contenido u otro tipo
//   → 409 `carga-conflicto`; un rechazo no guarda recibo. Un resultado perdido se resuelve repitiendo el MISMO comando (el Worker contesta 503 `resultado-desconocido`).
// Solo cambia `equipos.rama`: ningún identificador, plantilla, evento, recibo, acceso ni estadística.
// ---------------------------------------------------------------------------

export const RAMAS = Object.freeze(['masculino', 'femenino', 'mixta'])
export const ETIQUETA_RAMA = Object.freeze({ masculino: 'Masculino', femenino: 'Femenino', mixta: 'Mixta' })
export const LIMITE_EQUIPOS_RAMAS = 100
export const LIMITE_BYTES_RAMAS = 16 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const ID_CARGA = /^[A-Za-z0-9_-]{16,64}$/
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export const ramaValida = (v) => typeof v === 'string' && RAMAS.includes(v)

/** Cuerpo EXACTO { cargaId, ramas:[{ equipoId, rama }] }. → { ok: true, normalizado } | { ok: false, errores } */
export function validarRamas(p) {
  const e = []
  if (!esObjeto(p)) return { ok: false, errores: ['payload'] }
  if (Object.keys(p).some((k) => !['cargaId', 'ramas'].includes(k))) e.push('payload.campos')
  if (typeof p.cargaId !== 'string' || !ID_CARGA.test(p.cargaId)) e.push('cargaId')
  const lista = Array.isArray(p.ramas) && p.ramas.length >= 1 && p.ramas.length <= LIMITE_EQUIPOS_RAMAS ? p.ramas : null
  if (!lista) e.push('ramas')
  else {
    const ids = new Set()
    for (const r of lista) {
      if (!esObjeto(r) || Object.keys(r).some((k) => !['equipoId', 'rama'].includes(k)) || Object.keys(r).length !== 2) { e.push('ramas.forma'); continue }
      if (typeof r.equipoId !== 'string' || !ID.test(r.equipoId)) e.push('ramas.equipoId')
      else if (ids.has(r.equipoId)) e.push('ramas.equipoId-duplicado')
      else ids.add(r.equipoId)
      if (!ramaValida(r.rama)) e.push('ramas.rama')
    }
  }
  if (e.length) return { ok: false, errores: [...new Set(e)] }
  return { ok: true, normalizado: { cargaId: p.cargaId, ramas: lista.map((r) => ({ equipoId: r.equipoId, rama: r.rama })).sort((a, b) => (a.equipoId < b.equipoId ? -1 : 1)) } }
}

export const huellaDeRamas = (ligaId, normalizado) => huellaDeCarga('ramas', ligaId, normalizado)

const CONFLICTO = Object.freeze({ status: 409, cuerpo: Object.freeze({ error: 'carga-conflicto' }) })

/** UNA transacción. → { status, cuerpo } */
export function fijarRamas(storage, { ligaId, normalizado: n, huella, ahora }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const previo = sql.exec('SELECT tipo, huella, resultado_json FROM cargas WHERE carga_id = ?', n.cargaId).toArray()[0]
    if (previo) {
      if (previo.tipo !== 'ramas' || previo.huella !== huella) return CONFLICTO
      return { status: 200, cuerpo: { ...JSON.parse(previo.resultado_json), reproducido: true } }
    }
    const filas = new Map()
    const desconocidos = []
    for (const r of n.ramas) {
      const f = sql.exec('SELECT id, rama FROM equipos WHERE id = ? AND liga_id = ?', r.equipoId, ligaId).toArray()[0]
      if (f) filas.set(r.equipoId, f); else desconocidos.push(r.equipoId)
    }
    if (desconocidos.length) return { status: 422, cuerpo: { error: 'equipos-desconocidos', equipos: desconocidos } }
    const conflictos = n.ramas.filter((r) => filas.get(r.equipoId).rama !== null && filas.get(r.equipoId).rama !== r.rama)
      .map((r) => ({ equipoId: r.equipoId, actual: filas.get(r.equipoId).rama }))
    if (conflictos.length) return { status: 409, cuerpo: { error: 'rama-en-conflicto', equipos: conflictos } }
    const asignados = []
    const yaTenian = []
    for (const r of n.ramas) {
      if (filas.get(r.equipoId).rama === r.rama) { yaTenian.push(r.equipoId); continue }
      sql.exec('UPDATE equipos SET rama = ? WHERE id = ? AND rama IS NULL', r.rama, r.equipoId)
      sql.exec('INSERT INTO auditoria_acceso (ts, tipo, partido_id, organizador_id, sesion_id, detalle) VALUES (?, ?, NULL, NULL, NULL, ?)', ahora, 'equipo-rama-asignada', `carga:${n.cargaId} equipo:${r.equipoId} rama:${r.rama}`)
      asignados.push(r.equipoId)
    }
    const resultado = { ok: true, cargaId: n.cargaId, tipo: 'ramas', ligaId, asignados, yaTenian }
    sql.exec('INSERT INTO cargas (carga_id, tipo, huella, resultado_json, creado_en) VALUES (?, ?, ?, ?, ?)', n.cargaId, 'ramas', huella, JSON.stringify(resultado), ahora)
    return { status: 201, cuerpo: { ...resultado, reproducido: false } }
  })
}
