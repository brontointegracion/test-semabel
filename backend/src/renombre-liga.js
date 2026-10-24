import { esNombre, huellaDeCarga } from './carga.js'

// ---------------------------------------------------------------------------
// RENOMBRAR una liga (REPORT_218): operación del OPERADOR (puerta del operador + Bearer + liga admitida; ver rutas-carga.js).
//
//   POST /v1/admin/ligas/{liga}/nombre      { "cargaId": "<16–64>", "nombre": "<texto>" }      (cuerpo EXACTO, sin otros campos)
//
// QUÉ CAMBIA. SOLO `ligas.nombre` (el nombre que se muestra). No toca ningún identificador (liga, equipos, partidos), ni propiedad, credenciales,
// códigos, plantillas, eventos, recibos, reloj, resúmenes ni estadísticas: todas las lecturas públicas y del organizador leen `ligas.nombre` en cada
// petición, así que no hay copias guardadas que actualizar. Las direcciones amigables salen de los IDs, no del nombre de la liga: no cambian.
//
// NOMBRE. La misma regla que el nombre de liga de la estructura (`esNombre` de carga.js): texto sin espacios en los extremos, 1–80 caracteres,
// sin caracteres de control.
//
// UNA transactionSync del objeto de liga: recibo previo (idempotencia) → la liga debe existir → (si el nombre cambia) UPDATE + auditoría → recibo.
// IDEMPOTENCIA (la convención de las cargas, tabla `cargas`, tipo `renombre`): mismo `cargaId` + mismo contenido → el resultado ORIGINAL (`reproducido: true`),
// aunque entre tanto el nombre haya cambiado otra vez; mismo `cargaId` con otro contenido o de otro tipo → 409 `carga-conflicto`. Un rechazo (409/422) no guarda
// recibo. Un nombre YA igual al actual es un éxito sin escritura en `ligas` (`cambiado: false`), con su recibo, y su repetición devuelve exactamente eso.
// REVERSIÓN: es una operación NUEVA (otro `cargaId`) con el nombre anterior; nunca un interruptor.
// ---------------------------------------------------------------------------

export const LIMITE_BYTES_RENOMBRE = 2 * 1024
const ID_CARGA = /^[A-Za-z0-9_-]{16,64}$/
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Cuerpo EXACTO { cargaId, nombre }. → { ok: true, normalizado } | { ok: false, errores } */
export function validarRenombre(p) {
  const e = []
  if (!esObjeto(p)) return { ok: false, errores: ['payload'] }
  if (Object.keys(p).some((k) => !['cargaId', 'nombre'].includes(k))) e.push('payload.campos')
  if (typeof p.cargaId !== 'string' || !ID_CARGA.test(p.cargaId)) e.push('cargaId')
  if (!esNombre(p.nombre)) e.push('nombre')
  if (e.length) return { ok: false, errores: e }
  return { ok: true, normalizado: { cargaId: p.cargaId, nombre: p.nombre } }
}

export const huellaDeRenombre = (ligaId, normalizado) => huellaDeCarga('renombre', ligaId, normalizado)

const CONFLICTO = Object.freeze({ status: 409, cuerpo: Object.freeze({ error: 'carga-conflicto' }) })

/** UNA transacción. → { status, cuerpo } */
export function renombrarLiga(storage, { ligaId, normalizado: n, huella, ahora }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const previo = sql.exec('SELECT tipo, huella, resultado_json FROM cargas WHERE carga_id = ?', n.cargaId).toArray()[0]
    if (previo) {
      if (previo.tipo !== 'renombre' || previo.huella !== huella) return CONFLICTO
      return { status: 200, cuerpo: { ...JSON.parse(previo.resultado_json), reproducido: true } }
    }
    const liga = sql.exec('SELECT id, nombre FROM ligas WHERE id = ?', ligaId).toArray()[0]
    if (!liga) return { status: 409, cuerpo: { error: 'liga-sin-estructura' } }
    const cambia = liga.nombre !== n.nombre
    if (cambia) {
      sql.exec('UPDATE ligas SET nombre = ? WHERE id = ?', n.nombre, ligaId)
      sql.exec('INSERT INTO auditoria_acceso (ts, tipo, partido_id, organizador_id, sesion_id, detalle) VALUES (?, ?, NULL, NULL, NULL, ?)', ahora, 'liga-renombrada', `carga:${n.cargaId}`)
    }
    const resultado = { ok: true, cargaId: n.cargaId, tipo: 'renombre', ligaId, nombreAnterior: liga.nombre, nombre: n.nombre, cambiado: cambia }
    sql.exec('INSERT INTO cargas (carga_id, tipo, huella, resultado_json, creado_en) VALUES (?, ?, ?, ?, ?)', n.cargaId, 'renombre', huella, JSON.stringify(resultado), ahora)
    return { status: 201, cuerpo: { ...resultado, reproducido: false } }
  })
}

