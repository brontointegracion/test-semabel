import { nombreVisible } from '../../src/lib/identidad.js'
import { estadoDeCredencial } from './adaptador-liga.js'
import { sha256Hex } from './credenciales.js'

// ---------------------------------------------------------------------------
// Lectura de preparación del teléfono que controla un partido (refresco antes del inicio o tras un rechazo
// definitivo del inicio). Devuelve SOLO lo que el cliente de puntuación necesita:
//
//   { preparacion, etiquetas, rev, ultimoClientSeq }
//
//   preparacion      el contexto de crearPreparacion, tal cual: el cliente lo verifica con preparacionIntegra
//   etiquetas        [{ id, etiqueta }] de los jugadores ACTIVOS; vive FUERA de `preparacion` para no romper su
//                    comprobación de integridad. Etiqueta = nombre en camiseta si lo hay; si no, el nombre completo
//   rev, ultimoClientSeq   el par con el que el cliente reanuda su cola (`crearCola`)
//
// El estado del partido y los nombres de los equipos NO se repiten aquí: ya los da la lectura pública.
// Nunca se envían fecha de nacimiento, persona, código, partes del nombre, revisiones, auditoría ni inactivos.
//
// AUTORIZACIÓN. El token se resume ANTES (único await). Después, en UN tramo sincrónico sin await, se relee la fila
// de la credencial y se exige que esté vigente (`activa`: una credencial en recuperación solo sirve para reintentos
// exactos de recibos, así que aquí es el 401 genérico), asignada a ESTE partido; solo entonces se lee algo más. La
// autorización y los campos devueltos salen del mismo tramo.
// ---------------------------------------------------------------------------

export async function leerPreparacionTelefono({ storage, adaptador, credencial, gameId, ahoraFn }) {
  const hash = await sha256Hex(typeof credencial === 'string' ? credencial : '')
  return storage.transactionSync(() => {
    const sql = storage.sql
    const c = sql.exec(
      'SELECT partido_id, revocada, expira_en, retorno_hasta FROM credenciales WHERE token_hash = ?', hash,
    ).toArray()[0]
    if (!c || c.revocada === 1 || c.partido_id !== gameId) return { tipo: 'no-autorizado' }
    if (estadoDeCredencial(c, ahoraFn()) !== 'activa') return { tipo: 'no-autorizado' }
    const p = sql.exec('SELECT rev, ultimo_client_seq FROM partidos WHERE id = ? AND retirado_en IS NULL', gameId).toArray()[0]
    if (!p) return { tipo: 'no-autorizado' } // desconocido o retirado
    const preparacion = adaptador.preparacionVigente(gameId)
    if (!preparacion) return { tipo: 'no-disponible' }
    const etiquetas = preparacion.jugadores
      .map((j) => {
        const r = sql.exec('SELECT nombre, nombre_camiseta FROM jugadores WHERE id = ?', j.id).toArray()[0]
        return { id: j.id, etiqueta: r ? (nombreVisible({ nombre: r.nombre ?? undefined, nombreCamiseta: r.nombre_camiseta ?? undefined }) ?? null) : null }
      })
    return { tipo: 'ok', preparacion, etiquetas, rev: p.rev, ultimoClientSeq: p.ultimo_client_seq }
  })
}
