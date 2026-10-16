import { DURACIONES } from './acceso/config.js'
import { ASERCION, evaluarAsercion } from './acceso/asercion.js'
import { aleatorioHex, esHashHex, hashesIguales } from './acceso/codigos.js'
import { despuesDeFalloDeCodigo, fuenteBloqueada, registrarFalloFuente } from './acceso/limites.js'

// ---------------------------------------------------------------------------
// Códigos de partido y activación del teléfono que lo controla (lado de la liga).
//
// Todo es SINCRÓNICO y corre dentro de una transactionSync del objeto de liga: se ordena con la mutación de
// partidos, credenciales y autorización.
//
// ACTIVACIÓN. El teléfono genera su propio token, lo guarda ANTES de enviar y manda solo su hash. El servidor
// no conoce el token y nunca lo devuelve; la credencial de scoring es ese hash (tabla credenciales).
//   - Código sin usar: se exige que no haya caducado (48 h desde su emisión), que el partido esté `programado` y
//     que no haya otra credencial activa. Es la ÚNICA vía para tener un controlador: no hay traspaso.
//   - Código ya usado: solo sirve para RECUPERAR la activación original, con el mismo hash. Devuelve el mismo
//     device_id y no cambia nada (ni filas ni versión de autorización), en cualquier estado del partido. Exige que
//     la credencial no esté revocada y siga dentro de su horizonte de recuperación. La caducidad del código
//     sin usar NO se aplica aquí: es otro plazo.
//   - Una credencial revocada nunca se reactiva: el hash es clave primaria y nada pone `revocada` a 0.
// Todos los fallos son el mismo resultado ('no-autorizado'): sin causa y sin recibos.
// ---------------------------------------------------------------------------

const FALLO = Object.freeze({ tipo: 'no-autorizado' })

export const estadoDePartido = (sql, partidoId) => {
  const f = sql.exec('SELECT estado_json FROM partidos WHERE id = ?', partidoId).toArray()[0]
  return f ? (JSON.parse(f.estado_json).partido?.estado ?? null) : undefined // undefined = no existe
}

function auditar(sql, ts, tipo, { partidoId = null, organizadorId = null, sesionId = null, detalle = null } = {}) {
  sql.exec(
    'INSERT INTO auditoria_acceso (ts, tipo, partido_id, organizador_id, sesion_id, detalle) VALUES (?, ?, ?, ?, ?, ?)',
    ts, tipo, partidoId, organizadorId, sesionId, detalle,
  )
}

/** Primera sentencia de cada operación del organizador: ¿sigue vigente su afirmación? */
function comprobarAsercion(asercion, ligaId, ahoraFn) {
  const ahora = ahoraFn()
  const e = evaluarAsercion(asercion, ligaId, ahora)
  return { ahora, estado: e }
}

// --- Organizador ---------------------------------------------------------------------------------------------------

/** Emite un código de partido (se muestra una vez) y revoca los códigos que siguen sin usar. */
export function crearCodigo(storage, { asercion, ligaId, partidoId, codigoId, secretoHash, ahoraFn }) {
  return storage.transactionSync(() => {
    const { ahora, estado } = comprobarAsercion(asercion, ligaId, ahoraFn)
    if (estado === ASERCION.VENCIDA) return { tipo: 'asercion-vencida' }
    if (estado !== ASERCION.OK) return FALLO
    const sql = storage.sql
    const est = estadoDePartido(sql, partidoId)
    if (est === undefined) return { tipo: 'partido-desconocido' }
    if (est !== 'programado') return { tipo: 'partido-iniciado' }
    sql.exec('UPDATE codigos_partido SET revocado_en = ? WHERE partido_id = ? AND consumido_en IS NULL AND revocado_en IS NULL', ahora, partidoId)
    const expiraEn = ahora + DURACIONES.codigoPartidoSinUsar
    sql.exec(
      'INSERT INTO codigos_partido (id, partido_id, secreto_hash, creado_en, expira_en, creado_por) VALUES (?, ?, ?, ?, ?, ?)',
      codigoId, partidoId, secretoHash, ahora, expiraEn, asercion.organizadorId,
    )
    auditar(sql, ahora, 'codigo-partido-emitido', { partidoId, organizadorId: asercion.organizadorId, sesionId: asercion.sesionId })
    return { tipo: 'ok', expiraEn }
  })
}

/** Revoca el control SOLO antes del inicio. Después del inicio no hay revocación de emergencia ni liberación. */
export function revocarControl(storage, { asercion, ligaId, partidoId, ahoraFn }) {
  return storage.transactionSync(() => {
    const { ahora, estado } = comprobarAsercion(asercion, ligaId, ahoraFn)
    if (estado === ASERCION.VENCIDA) return { tipo: 'asercion-vencida' }
    if (estado !== ASERCION.OK) return FALLO
    const sql = storage.sql
    const est = estadoDePartido(sql, partidoId)
    if (est === undefined) return { tipo: 'partido-desconocido' }
    if (est !== 'programado') return { tipo: 'partido-iniciado' }
    const activas = sql.exec('SELECT COUNT(*) AS n FROM credenciales WHERE partido_id = ? AND revocada = 0', partidoId).one().n
    sql.exec('UPDATE credenciales SET revocada = 1 WHERE partido_id = ? AND revocada = 0', partidoId)
    sql.exec('UPDATE codigos_partido SET revocado_en = ? WHERE partido_id = ? AND revocado_en IS NULL AND consumido_en IS NULL', ahora, partidoId)
    if (activas > 0) sql.exec('UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = ?', partidoId)
    auditar(sql, ahora, 'control-revocado', { partidoId, organizadorId: asercion.organizadorId, sesionId: asercion.sesionId, detalle: `credenciales:${activas}` })
    return { tipo: 'ok', credencialesRevocadas: activas }
  })
}

/** Estado del control de un partido, sin ningún secreto. */
export function estadoControl(storage, { asercion, ligaId, partidoId, ahoraFn }) {
  return storage.transactionSync(() => {
    const { ahora, estado } = comprobarAsercion(asercion, ligaId, ahoraFn)
    if (estado === ASERCION.VENCIDA) return { tipo: 'asercion-vencida' }
    if (estado !== ASERCION.OK) return FALLO
    const sql = storage.sql
    const est = estadoDePartido(sql, partidoId)
    if (est === undefined) return { tipo: 'partido-desconocido' }
    const codigo = sql.exec(
      'SELECT expira_en FROM codigos_partido WHERE partido_id = ? AND consumido_en IS NULL AND revocado_en IS NULL AND ? < expira_en ORDER BY creado_en DESC LIMIT 1',
      partidoId, ahora,
    ).toArray()[0]
    const cred = sql.exec('SELECT expira_en, retorno_hasta FROM credenciales WHERE partido_id = ? AND revocada = 0', partidoId).toArray()[0]
    let credencial = 'ninguna'
    if (cred) {
      if (cred.expira_en === null || ahora < cred.expira_en) credencial = 'activa'
      else if (cred.retorno_hasta !== null && ahora < cred.retorno_hasta) credencial = 'solo-recibos'
      else credencial = 'vencida'
    }
    return { tipo: 'ok', partido: est, codigoPendiente: !!codigo, codigoExpiraEn: codigo?.expira_en ?? null, credencial }
  })
}

// --- Teléfono ------------------------------------------------------------------------------------------------------

export function activar(storage, { partidoId, codigoId, secretoHash, tokenHash, fuente, ahoraFn }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const ahora = ahoraFn()
    if (fuenteBloqueada(sql, fuente, ahora)) return { tipo: 'limitado' }
    const fallo = () => { registrarFalloFuente(sql, fuente, ahora); return FALLO }

    if (!esHashHex(tokenHash)) return fallo()
    const c = sql.exec('SELECT * FROM codigos_partido WHERE partido_id = ? AND id = ?', partidoId, codigoId).toArray()[0]
    if (!c) return fallo()
    if (c.bloqueado_hasta !== null && ahora < c.bloqueado_hasta) return fallo()

    if (!hashesIguales(secretoHash, c.secreto_hash)) {
      const n = despuesDeFalloDeCodigo({ fallos: c.fallos, bloqueos: c.bloqueos }, ahora)
      sql.exec('UPDATE codigos_partido SET fallos = ?, bloqueos = ?, bloqueado_hasta = ? WHERE partido_id = ? AND id = ?', n.fallos, n.bloqueos, n.bloqueadoHasta, partidoId, codigoId)
      return fallo()
    }
    if (c.revocado_en !== null) return FALLO

    // Código YA USADO: solo recuperación de la activación original (mismo hash, mismo dispositivo).
    if (c.consumido_en !== null) {
      if (!hashesIguales(tokenHash, c.token_hash)) return FALLO
      const cred = sql.exec('SELECT revocada, retorno_hasta FROM credenciales WHERE token_hash = ? AND partido_id = ?', c.token_hash, partidoId).toArray()[0]
      if (!cred || cred.revocada !== 0) return FALLO
      if (cred.retorno_hasta !== null && ahora >= cred.retorno_hasta) return FALLO
      return { tipo: 'ok', deviceId: c.device_id, repetido: true }
    }

    // Código SIN USAR: activación nueva. Solo antes del inicio.
    if (ahora >= c.expira_en) return FALLO
    if (estadoDePartido(sql, partidoId) !== 'programado') return FALLO
    if (sql.exec('SELECT 1 AS x FROM credenciales WHERE partido_id = ? AND revocada = 0', partidoId).toArray().length) return FALLO
    if (sql.exec('SELECT 1 AS x FROM credenciales WHERE token_hash = ?', tokenHash).toArray().length) return FALLO // nunca se reutiliza un hash

    const deviceId = `dev-${aleatorioHex(12)}`
    const expiraEn = ahora + DURACIONES.credencialActiva
    const retornoHasta = expiraEn + DURACIONES.credencialSoloRecibos
    sql.exec(
      `INSERT INTO credenciales (token_hash, partido_id, device_id, actor_id, revocada, expira_en, retorno_hasta, codigo_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      tokenHash, partidoId, deviceId, `control:${codigoId}`, expiraEn, retornoHasta, codigoId,
    )
    sql.exec('UPDATE codigos_partido SET consumido_en = ?, token_hash = ?, device_id = ?, fallos = 0, bloqueos = 0, bloqueado_hasta = NULL WHERE partido_id = ? AND id = ?', ahora, tokenHash, deviceId, partidoId, codigoId)
    sql.exec('UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = ?', partidoId)
    auditar(sql, ahora, 'control-activado', { partidoId, detalle: `codigo:${codigoId}` })
    return { tipo: 'ok', deviceId, repetido: false }
  })
}
