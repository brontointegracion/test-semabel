import { db, uid } from '../db'
import { compararPorDorsal } from './dorsal'
import { activoDe } from './identidad'
import {
  claveDeComparacion, decidirEdicion, fichaResultante, nuevaFichaDe, numeroDisponibleEn, planAlta, planEdicion, planReactivacion,
  proyectarCandidato, validarCamposJugador,
} from './roster-reglas'
import { esDuenoDe } from './sesion'

// Las reglas puras (validación, forma canónica, decisiones de alta/edición/reactivación) viven en roster-reglas.js,
// que también importa el backend compartido. Aquí queda solo lo que toca Dexie.
export { validarCamposJugador }

// ---------------------------------------------------------------------------
// Operaciones de plantilla/identidad — Stage 3B, Slice 1.
//
// Vive fuera de React a propósito (Decisión 29): estas funciones son la
// autoridad de negocio, reusable por la UI de hoy y por cualquier llamador
// futuro no-UI (incluyendo un agente de IA — Decisión 28), y revalidan sus
// propias reglas en cada llamada en vez de confiar en que quien llama ya
// validó (Decisión 63).
//
// jugador.nombre es un campo derivado/compatibilidad, no autoritativo — ver
// Decisión 114. Cada operación que toca nombrePila/apellido1/apellido2 lo
// recompone; nunca se edita directamente como fuente propia.
// ---------------------------------------------------------------------------

function requerirPermiso(sesion, liga) {
  if (!esDuenoDe(sesion, liga)) {
    throw new Error('No autorizado para modificar la plantilla de este equipo.')
  }
}

async function generarCodigoJugador() {
  let codigo
  do {
    codigo = String(1000 + Math.floor(Math.random() * 8999))
  } while (await db.jugadores.where('codigo').equals(codigo).count())
  return codigo
}

const fichasDelEquipo = (equipoId) => db.jugadores.where('equipoId').equals(equipoId).toArray()

// ts alcanza para "cuándo" (Decisión 94), pero dos acciones en el mismo
// milisegundo tendrían el mismo valor — seq desempata el orden real dentro
// de esta sesión, igual que ya hace eventos.seq para los partidos.
let secuenciaAuditoria = 0

async function registrarAuditoria({ tipo, fichaId, actorId }) {
  await db.auditoria.add({
    id: uid(),
    fichaId,
    tipo,
    ts: new Date().toISOString(),
    seq: secuenciaAuditoria++,
    actorId: actorId ?? null,
  })
}

/**
 * Lectura activa de plantilla — intencionalmente separada de useEquipo()
 * (Decisión 30): useEquipo() sigue sirviendo estadísticas/resultados con
 * todas las fichas, activas e inactivas, tal como hoy. Esta función es la
 * autoridad para "quién está en la plantilla activa".
 */
export async function rosterActivo(equipoId) {
  const jugadores = await db.jugadores.where('equipoId').equals(equipoId).toArray()
  return jugadores.filter(activoDe).sort(compararPorDorsal)
}

/** Decisión 91: más recientemente desactivado primero. */
export async function rosterInactivo(equipoId) {
  const jugadores = await db.jugadores.where('equipoId').equals(equipoId).toArray()
  return jugadores
    .filter((j) => !activoDe(j))
    .sort((a, b) => (b.desactivadoEn || '').localeCompare(a.desactivadoEn || ''))
}

/**
 * Candidatos duplicados dentro de la misma liga (Decisión 14), activos o
 * inactivos (Decisión 36 — lo inactivo no exime de integridad de identidad).
 * Nunca expone fecha de nacimiento exacta (Decisión 27), solo edad.
 */
export async function buscarCandidatosDuplicados({ ligaId, nombrePila, apellido1, apellido2, excluirFichaId }) {
  const clave = claveDeComparacion({ nombrePila, apellido1, apellido2 })
  const fichas = await db.jugadores.where('ligaId').equals(ligaId).toArray()
  const candidatas = fichas.filter((f) => {
    if (f.id === excluirFichaId) return false
    return claveDeComparacion(f) === clave
  })
  if (!candidatas.length) return []

  const equipos = await db.equipos.where('ligaId').equals(ligaId).toArray()
  const equiposPorId = Object.fromEntries(equipos.map((e) => [e.id, e]))

  return candidatas.map((f) => proyectarCandidato(f, equiposPorId[f.equipoId]?.nombre))
}

/**
 * Añadir jugador (Decisiones 1, 5–7, 12, 14, 18, 23, 26, 61, 63).
 *
 * Sin resolucionIdentidad: valida y, si hay candidatos duplicados en la
 * liga, los devuelve sin mutar nada — el llamador debe resolver y volver a
 * llamar con resolucionIdentidad. Con resolucionIdentidad:
 *   { tipo: 'misma-persona', personaId } — reusa personaId (Decisión 6/26),
 *     salvo que esa persona ya tenga ficha activa en este equipo
 *     (Decisión 61), en cuyo caso no crea nada.
 *   { tipo: 'otra-persona' } — personaId nuevo pese al nombre igual
 *     (Decisión 26).
 */
export async function agregarJugador({ sesion, liga, equipoId, campos, resolucionIdentidad }) {
  requerirPermiso(sesion, liga)

  const plan = planAlta(campos)
  if (plan.errores) return { tipo: 'invalido', errores: plan.errores }

  if (!resolucionIdentidad) {
    const candidatos = await buscarCandidatosDuplicados({ ligaId: liga.id, ...plan.canon })
    if (candidatos.length) return { tipo: 'candidatos', candidatos }
  }

  let personaId
  if (resolucionIdentidad?.tipo === 'misma-persona') {
    const activaEnEquipo = (await db.jugadores.where('equipoId').equals(equipoId).toArray())
      .find((j) => j.personaId === resolucionIdentidad.personaId && activoDe(j))
    if (activaEnEquipo) return { tipo: 'ya-activo', ficha: activaEnEquipo }
    personaId = resolucionIdentidad.personaId
  } else {
    personaId = uid()
  }

  return db.transaction('rw', db.jugadores, db.auditoria, async () => {
    if (!numeroDisponibleEn(await fichasDelEquipo(equipoId), plan.dorsal)) {
      return { tipo: 'conflicto-numero' }
    }
    const codigo = await generarCodigoJugador()
    const ficha = nuevaFichaDe({ id: uid(), codigo, ligaId: liga.id, equipoId, personaId, plan })
    await db.jugadores.add(ficha)
    await registrarAuditoria({ tipo: 'created', fichaId: ficha.id, actorId: sesion.cuentaId })
    return { tipo: 'creado', ficha }
  })
}

/**
 * Editar jugador (Decisiones 7, 24, 35, 36, 55–57, 63).
 *
 * Nunca cambia personaId: Decisión 57 prohíbe que una edición cambie la
 * identidad establecida, y Decisión 58 deja el split/unlink fuera de Stage 3.
 * Si el nombre editado ahora coincide con otra persona, resolucionIdentidad
 * es solo una confirmación explícita del organizador antes de guardar — no
 * reasigna personaId en ninguna dirección.
 *
 * `ficha` solo aporta el id: todo lo demás se relee de la base antes de
 * validar y de nuevo dentro de la transacción, para no decidir sobre una
 * copia que el llamador tenía desde antes (Decisión 63).
 */
export async function editarJugador({ sesion, liga, ficha, campos, resolucionIdentidad }) {
  requerirPermiso(sesion, liga)

  const actual = await db.jugadores.get(ficha.id)
  if (!actual) throw new Error('Esta ficha ya no existe.')

  const decidida = decidirEdicion({ actual, campos })
  if (decidida.errores) return { tipo: 'invalido', errores: decidida.errores }

  if (decidida.nombreCambio && !resolucionIdentidad) {
    const candidatos = await buscarCandidatosDuplicados({ ligaId: liga.id, ...decidida.canon, excluirFichaId: actual.id })
    if (candidatos.length) return { tipo: 'candidatos', candidatos }
  }

  return db.transaction('rw', db.jugadores, db.auditoria, async () => {
    const vivo = await db.jugadores.get(actual.id)
    if (!vivo) throw new Error('Esta ficha ya no existe.')
    const plan = planEdicion({ vivo, decidida, fichasDelEquipo: await fichasDelEquipo(vivo.equipoId) })
    if (plan.tipo !== 'ok') return plan.tipo === 'invalido' ? { tipo: 'invalido', errores: plan.errores } : { tipo: 'conflicto-numero' }
    const { cambios } = plan
    await db.jugadores.update(vivo.id, cambios)
    await registrarAuditoria({ tipo: 'edited', fichaId: vivo.id, actorId: sesion.cuentaId })
    return { tipo: 'editado', ficha: fichaResultante(vivo, cambios) }
  })
}

/**
 * Desactivar (Decisiones 8, 25, 37–39, 63): preserva la ficha, libera el
 * número. Relee el estado activo/inactivo dentro de la transacción, en vez
 * de confiar en la copia que trae `ficha`.
 */
export async function desactivarJugador({ sesion, liga, ficha }) {
  requerirPermiso(sesion, liga)

  return db.transaction('rw', db.jugadores, db.auditoria, async () => {
    const actual = await db.jugadores.get(ficha.id)
    if (!actual) throw new Error('Esta ficha ya no existe.')
    if (!activoDe(actual)) throw new Error('Esta ficha ya está inactiva.')
    const cambios = { activo: false, desactivadoEn: new Date().toISOString() }
    await db.jugadores.update(actual.id, cambios)
    await registrarAuditoria({ tipo: 'deactivated', fichaId: actual.id, actorId: sesion.cuentaId })
    return { tipo: 'desactivado', ficha: { ...actual, ...cambios } }
  })
}

/**
 * Reactivar (Decisiones 31, 32, 40, 44, 63). Sin nuevoDorsal, intenta
 * recuperar el número anterior; si está tomado por otro activo del mismo
 * equipo, o si la ficha no tiene número (Decisión 44), exige uno explícito.
 * Igual que desactivar, relee el estado y el número dentro de la transacción.
 */
export async function reactivarJugador({ sesion, liga, ficha, nuevoDorsal, numeroPendiente }) {
  requerirPermiso(sesion, liga)

  return db.transaction('rw', db.jugadores, db.auditoria, async () => {
    const actual = await db.jugadores.get(ficha.id)
    if (!actual) throw new Error('Esta ficha ya no existe.')
    if (activoDe(actual)) throw new Error('Esta ficha ya está activa.')

    const plan = planReactivacion({ actual, nuevoDorsal, numeroPendiente, fichasDelEquipo: await fichasDelEquipo(actual.equipoId) })
    if (plan.tipo === 'invalido') return { tipo: 'invalido', errores: plan.errores }
    if (plan.tipo === 'conflicto-numero') return { tipo: 'conflicto-numero' }
    const { cambios } = plan
    await db.jugadores.update(actual.id, cambios)
    await registrarAuditoria({ tipo: 'reactivated', fichaId: actual.id, actorId: sesion.cuentaId })
    return { tipo: 'reactivado', ficha: fichaResultante(actual, cambios) }
  })
}
