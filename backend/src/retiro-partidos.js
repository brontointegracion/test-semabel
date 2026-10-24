import { canonico } from '../../src/lib/motor/sobre.js'
import { sha256Hex } from './credenciales.js'

// ---------------------------------------------------------------------------
// RETIRO y RESTAURACIÓN de partidos programados (REPORT_208). Operaciones del OPERADOR (puerta del operador + Bearer; ver rutas-carga.js).
//
// QUÉ ES. «Retirado» NO es un estado del partido (programado | vivo | final no cambia): es una marca aparte, `partidos.retirado_en`
// (NULL = activo). El partido, su identificador, su resumen y todas sus filas siguen guardados; nada se borra ni se reutiliza (un
// identificador retirado nunca se puede volver a cargar: la carga sigue respondiendo `partido-existente`).
//
// FRONTERA DE CONSISTENCIA. Todo lo que decide si un partido puede retirarse vive en ESTE objeto de liga (LigaDO): `partidos`, `eventos`,
// `recibos`, `auditoria_reloj`, `bandeja`, `cuarentena`, `credenciales` y `codigos_partido`. El objeto de acceso (AccesoDO) solo guarda las
// sesiones y la propiedad de ligas del organizador: NO guarda códigos ni credenciales de teléfono, así que no interviene aquí y no se
// afirma ninguna atomicidad entre objetos. Las guardas y el cambio de marca van en UNA transactionSync, ordenada con la emisión de códigos,
// la activación y la confirmación de órdenes (todas son transactionSync de este mismo objeto).
//
// CARRERAS.
//   · orden en vuelo: confirmar compara `version_autorizacion`; retirar y restaurar la suben en la misma transacción, así que una orden
//     leída antes no puede confirmarse después (conflicto → se relee → el partido retirado responde 401). Si la orden confirma PRIMERO, el
//     retiro ve sus recibos/eventos y se REHÚSA.
//   · emisión de código y activación: lo comprueban dentro de su transacción (`estadoDePartido` trata un partido retirado como desconocido).
//
// IDEMPOTENCIA (convención de las cargas): mismo `cargaId` + mismo contenido → el resultado original (`reproducido: true`); mismo
// `cargaId` con otro contenido, o de otro tipo → 409 `carga-conflicto`. El recibo vive en `cargas` (tipo `retiro` / `restauracion`). Un
// partido que YA estaba retirado (o activo, al restaurar) cuenta como `yaRetirados` / `yaActivos` y no cambia nada: repetir con otro
// `cargaId` es seguro. Retirar y restaurar son operaciones DISTINTAS, nunca un interruptor.
//
// GUARDAS DEL RETIRO (todas, para TODO el lote; si alguna falla no se cambia nada y se responde 409 `retiro-no-seguro` con los motivos):
//   no-programado     el estado del motor no es `programado`
//   con-actividad     rev ≠ 0 o ultimo_client_seq ≠ 0
//   con-historial     hay filas en eventos, recibos, auditoria_reloj, bandeja o cuarentena
//   credencial-activa hay una credencial sin revocar (el organizador debe usar «retirar acceso» antes)
//   con-bloqueo       hay un bloqueo guardado en el partido
// Códigos sin usar o revocados NO impiden el retiro: quedan guardados, y mientras el partido esté retirado no sirven (no se activa un
// partido retirado). Al restaurar, un código que no haya caducado vuelve a servir; ninguno se revoca ni se emite aquí.
// ---------------------------------------------------------------------------

export const LIMITE_PARTIDOS_RETIRO = 50
export const LIMITE_BYTES_RETIRO = 8 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const ID_CARGA = /^[A-Za-z0-9_-]{16,64}$/
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Cuerpo EXACTO { cargaId, partidos: [id, …] }. → { ok: true, normalizado } | { ok: false, errores } */
export function validarRetiro(p) {
  const e = []
  if (!esObjeto(p)) return { ok: false, errores: ['payload'] }
  if (Object.keys(p).some((k) => !['cargaId', 'partidos'].includes(k))) e.push('payload.campos')
  if (typeof p.cargaId !== 'string' || !ID_CARGA.test(p.cargaId)) e.push('cargaId')
  const lista = Array.isArray(p.partidos) && p.partidos.length >= 1 && p.partidos.length <= LIMITE_PARTIDOS_RETIRO ? p.partidos : null
  if (!lista) e.push('partidos')
  else {
    if (!lista.every((id) => typeof id === 'string' && ID.test(id))) e.push('partidos.id')
    else if (new Set(lista).size !== lista.length) e.push('partidos.id-duplicado')
  }
  if (e.length) return { ok: false, errores: e }
  return { ok: true, normalizado: { cargaId: p.cargaId, partidos: [...lista].sort() } }
}

/** Huella del contenido normalizado, ligada al tipo (`retiro` | `restauracion`) y a la liga. */
export const huellaDeRetiro = (tipo, ligaId, normalizado) => sha256Hex(canonico({ tipo, ligaId, normalizado }))

const rechazo = (status, error, extra = {}) => ({ status, cuerpo: { error, ...extra } })
const CONFLICTO = Object.freeze({ status: 409, cuerpo: Object.freeze({ error: 'carga-conflicto' }) })

function reciboPrevio(sql, cargaId, tipo, huella) {
  const previo = sql.exec('SELECT tipo, huella, resultado_json FROM cargas WHERE carga_id = ?', cargaId).toArray()[0]
  if (!previo) return undefined
  if (previo.tipo !== tipo || previo.huella !== huella) return CONFLICTO
  return { status: 200, cuerpo: { ...JSON.parse(previo.resultado_json), reproducido: true } }
}

/** ¿Está retirado? undefined = no existe. */
export const estaRetirado = (sql, partidoId) => {
  const f = sql.exec('SELECT retirado_en FROM partidos WHERE id = ?', partidoId).toArray()[0]
  return f ? f.retirado_en !== null : undefined
}

const cuenta = (sql, tabla, id) => sql.exec(`SELECT COUNT(*) AS n FROM ${tabla} WHERE partido_id = ?`, id).one().n

/** Motivos por los que un partido NO puede retirarse (vacío = puede). Solo lectura. */
export function motivosDeRiesgo(sql, fila) {
  const m = []
  let estado = null
  try { estado = JSON.parse(fila.estado_json)?.partido?.estado ?? null } catch { /* ilegible: no es programado */ }
  if (estado !== 'programado') m.push('no-programado')
  if (fila.rev !== 0 || fila.ultimo_client_seq !== 0) m.push('con-actividad')
  if (['eventos', 'recibos', 'auditoria_reloj', 'bandeja', 'cuarentena'].some((t) => cuenta(sql, t, fila.id) > 0)) m.push('con-historial')
  if (sql.exec('SELECT 1 AS x FROM credenciales WHERE partido_id = ? AND revocada = 0', fila.id).toArray().length) m.push('credencial-activa')
  if (fila.bloqueo_json !== null) m.push('con-bloqueo')
  return m
}

function auditar(sql, ts, tipo, partidoId, cargaId) {
  sql.exec('INSERT INTO auditoria_acceso (ts, tipo, partido_id, organizador_id, sesion_id, detalle) VALUES (?, ?, ?, NULL, NULL, ?)', ts, tipo, partidoId, `carga:${cargaId}`)
}

const COLS = 'id, estado_json, rev, ultimo_client_seq, bloqueo_json, retirado_en'

function aplicar(storage, { tipo, ligaId, normalizado: n, huella, ahora }) {
  const retirando = tipo === 'retiro'
  return storage.transactionSync(() => {
    const sql = storage.sql
    const previo = reciboPrevio(sql, n.cargaId, tipo, huella)
    if (previo) return previo
    const filas = new Map()
    const desconocidos = []
    for (const id of n.partidos) {
      const f = sql.exec(`SELECT ${COLS} FROM partidos WHERE id = ? AND liga_id = ?`, id, ligaId).toArray()[0]
      if (f) filas.set(id, f); else desconocidos.push(id)
    }
    if (desconocidos.length) return rechazo(422, 'partidos-desconocidos', { partidos: desconocidos })
    const riesgos = []
    for (const [id, f] of filas) {
      if (retirando ? f.retirado_en !== null : f.retirado_en === null) continue // ya estaba así: no cambia nada
      const motivos = retirando ? motivosDeRiesgo(sql, f) : motivosDeRiesgo(sql, { ...f, bloqueo_json: null }).filter((x) => x !== 'credencial-activa')
      if (motivos.length) riesgos.push({ id, motivos })
    }
    if (riesgos.length) return rechazo(409, retirando ? 'retiro-no-seguro' : 'restauracion-no-segura', { partidos: riesgos })
    const cambiados = []
    const yaEstaban = []
    for (const [id, f] of filas) {
      if (retirando ? f.retirado_en !== null : f.retirado_en === null) { yaEstaban.push(id); continue }
      sql.exec('UPDATE partidos SET retirado_en = ?, version_autorizacion = version_autorizacion + 1 WHERE id = ?', retirando ? ahora : null, id)
      auditar(sql, ahora, retirando ? 'partido-retirado' : 'partido-restaurado', id, n.cargaId)
      cambiados.push(id)
    }
    const resultado = {
      ok: true, cargaId: n.cargaId, tipo, ligaId,
      [retirando ? 'retirados' : 'restaurados']: cambiados.sort(),
      [retirando ? 'yaRetirados' : 'yaActivos']: yaEstaban.sort(),
    }
    sql.exec('INSERT INTO cargas (carga_id, tipo, huella, resultado_json, creado_en) VALUES (?, ?, ?, ?, ?)', n.cargaId, tipo, huella, JSON.stringify(resultado), ahora)
    return { status: 201, cuerpo: { ...resultado, reproducido: false } }
  })
}

/** UNA transacción: guardas + marca + auditoría + recibo. → { status, cuerpo } */
export const retirarPartidos = (storage, args) => aplicar(storage, { ...args, tipo: 'retiro' })
/** UNA transacción. Solo vuelve a activar partidos que SIGUEN siendo seguros (programados, sin historial). → { status, cuerpo } */
export const restaurarPartidos = (storage, args) => aplicar(storage, { ...args, tipo: 'restauracion' })
