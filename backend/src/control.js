// Operaciones de control de un partido (credenciales y bloqueo). Cada una es una unidad
// sincrónica atómica y sube la versión que el motor compara al confirmar, de modo que una
// orden leída antes del cambio no puede confirmarse después. No hay traspaso a mitad del
// partido: otorgar una segunda credencial activa se rechaza.

export function otorgarCredencial(storage, { tokenHash, partidoId, deviceId, actorId = null }) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const partido = sql.exec('SELECT estado_json FROM partidos WHERE id = ? AND retirado_en IS NULL', partidoId).toArray()[0]
    if (!partido) throw new Error('partido-desconocido') // también un partido retirado
    if (sql.exec('SELECT 1 AS x FROM credenciales WHERE partido_id = ? AND revocada = 0', partidoId).toArray().length) {
      throw new Error('credencial-activa-existente')
    }
    // Solo antes del inicio: no hay traspaso del control a mitad del partido.
    if ((JSON.parse(partido.estado_json).partido?.estado ?? null) !== 'programado') throw new Error('partido-iniciado')
    sql.exec(
      'INSERT INTO credenciales (token_hash, partido_id, device_id, actor_id, revocada) VALUES (?, ?, ?, ?, 0)',
      tokenHash, partidoId, deviceId, actorId,
    )
    sql.exec('UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = ?', partidoId)
  })
}

export function revocarCredencial(storage, tokenHash) {
  return storage.transactionSync(() => {
    const sql = storage.sql
    const fila = sql.exec('SELECT partido_id FROM credenciales WHERE token_hash = ?', tokenHash).toArray()[0]
    if (!fila) throw new Error('credencial-desconocida')
    sql.exec('UPDATE credenciales SET revocada = 1 WHERE token_hash = ?', tokenHash)
    sql.exec('UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = ?', fila.partido_id)
  })
}

/** `bloqueo` = null para quitarlo, o un objeto que se guarda tal cual. */
export function fijarBloqueo(storage, partidoId, bloqueo) {
  return storage.transactionSync(() => {
    if (storage.sql.exec('SELECT 1 AS x FROM partidos WHERE id = ?', partidoId).toArray().length === 0) {
      throw new Error('partido-desconocido')
    }
    storage.sql.exec(
      'UPDATE partidos SET bloqueo_json = ?, version_bloqueo = version_bloqueo + 1 WHERE id = ?',
      bloqueo === null ? null : JSON.stringify(bloqueo), partidoId,
    )
  })
}
