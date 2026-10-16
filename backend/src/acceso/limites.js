import {
  BLOQUEO_CODIGO_MAX_MS, BLOQUEO_CODIGO_MS, CLAVE_DESBORDAMIENTO, MAX_FALLOS_CODIGO, MAX_FALLOS_FUENTE, MAX_FUENTES_ACTIVAS,
  VENTANA_FUENTE_MS,
} from './config.js'

// Límites de intentos fallidos. Todo es SINCRÓNICO (se usa dentro de transactionSync).
//   - Por código: tras MAX_FALLOS_CODIGO fallos seguidos el código queda bloqueado un rato (que se duplica con cada
//     bloqueo repetido, con tope). Es temporal: no se puede usar para anular el acceso para siempre.
//   - Por fuente: un cubo por hash de la dirección del cliente. La dirección SOLO sirve para este cubo; nunca
//     autoriza nada. Si la cabecera falta o se falsifica, solo cambia el cubo.
//
// LÍMITE DE ALMACENAMIENTO de los contadores por fuente (temporales; se aplica en la MISMA transacción sincrónica):
//   1. Las filas cuya ventana ya terminó se borran (su asignación ya habría vuelto a cero por diseño).
//   2. Como mucho MAX_FUENTES_ACTIVAS fuentes con fila propia por objeto, más UNA fila compartida de desbordamiento
//      (total máximo MAX_FUENTES_ACTIVAS + 1).
//   3. Con el tope lleno, una fuente NUEVA no crea fila: cuenta en el cubo de desbordamiento, con el MISMO umbral.
//      No se expulsa ninguna fila activa (no se reinicia la cuenta de nadie) y la protección no se apaga: si muchas
//      fuentes nuevas fallan, el cubo compartido se llena y todas las fuentes nuevas reciben 429 hasta que termine su
//      ventana. Es un coste de disponibilidad aceptado a cambio de almacenamiento acotado.


export const TABLAS_LIMITES = [
  `CREATE TABLE IF NOT EXISTS limite_fuente (
    fuente TEXT PRIMARY KEY,
    inicio INTEGER NOT NULL,
    fallos INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS ix_limite_fuente_inicio ON limite_fuente(inicio)',
]

/**
 * Borra las filas vencidas y decide con qué clave se cuenta esta fuente: la suya si ya tiene fila vigente o aún cabe;
 * si no, la de desbordamiento. Sincrónica; sin servicio de limpieza aparte.
 */
function claveEfectiva(sql, fuente, ahora) {
  sql.exec('DELETE FROM limite_fuente WHERE ? - inicio >= ?', ahora, VENTANA_FUENTE_MS)
  if (fuente === CLAVE_DESBORDAMIENTO) return fuente
  if (sql.exec('SELECT 1 AS x FROM limite_fuente WHERE fuente = ?', fuente).toArray().length) return fuente
  const n = sql.exec('SELECT COUNT(*) AS n FROM limite_fuente WHERE fuente <> ?', CLAVE_DESBORDAMIENTO).one().n
  return n < MAX_FUENTES_ACTIVAS ? fuente : CLAVE_DESBORDAMIENTO
}

export function fuenteBloqueada(sql, fuente, ahora) {
  const clave = claveEfectiva(sql, fuente, ahora)
  const f = sql.exec('SELECT inicio, fallos FROM limite_fuente WHERE fuente = ?', clave).toArray()[0]
  return !!f && ahora - f.inicio < VENTANA_FUENTE_MS && f.fallos >= MAX_FALLOS_FUENTE
}

export function registrarFalloFuente(sql, fuente, ahora) {
  const clave = claveEfectiva(sql, fuente, ahora)
  const f = sql.exec('SELECT inicio, fallos FROM limite_fuente WHERE fuente = ?', clave).toArray()[0]
  if (!f) sql.exec('INSERT INTO limite_fuente (fuente, inicio, fallos) VALUES (?, ?, 1)', clave, ahora)
  else sql.exec('UPDATE limite_fuente SET fallos = fallos + 1 WHERE fuente = ?', clave)
}

/** Nueva fila de estado de bloqueo de un código tras un fallo: { fallos, bloqueos, bloqueadoHasta } */
export function despuesDeFalloDeCodigo({ fallos, bloqueos }, ahora) {
  const nuevos = fallos + 1
  if (nuevos < MAX_FALLOS_CODIGO) return { fallos: nuevos, bloqueos, bloqueadoHasta: null }
  const duracion = Math.min(BLOQUEO_CODIGO_MS * 2 ** bloqueos, BLOQUEO_CODIGO_MAX_MS)
  return { fallos: 0, bloqueos: bloqueos + 1, bloqueadoHasta: ahora + duracion }
}
