import { db, uid } from '../db'
import { activoDe, nombreCompleto } from './identidad'
import { esDuenoDe } from './sesion'

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

const TIENE_LETRA = /\p{L}/u
const TIENE_DIGITO = /[0-9]/

const normalizarEntrada = (s) => (s ?? '').toString().trim().replace(/\s+/g, ' ')

// Solo para comparar candidatos duplicados (Decisiones 72–76): minúsculas y
// sin acentos, pero NUNCA se usa para lo que se guarda o se muestra — eso
// conserva mayúsculas/acentos/puntuación tal como los escribió el organizador.
const normalizarParaComparar = (s) =>
  normalizarEntrada(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function validarCampoNombre(valor, { requerido }) {
  const v = normalizarEntrada(valor)
  if (!v) return requerido ? 'Este campo es obligatorio.' : null
  if (v.length > 50) return 'Máximo 50 caracteres.'
  if (TIENE_DIGITO.test(v)) return 'No puede contener números.'
  if (!TIENE_LETRA.test(v)) return 'Debe contener al menos una letra.'
  return null
}

function validarDorsal(dorsal) {
  if (dorsal === undefined || dorsal === null || dorsal === '') return 'El número es obligatorio.'
  const n = Number(dorsal)
  if (!Number.isInteger(n) || n < 0 || n > 99) return 'El número debe ser un entero entre 0 y 99.'
  return null
}

function validarFechaNacimiento(fecha) {
  if (!fecha) return null
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return 'Fecha inválida.'
  if (d.getTime() > Date.now()) return 'La fecha no puede ser futura.'
  return null
}

/** Decisiones 70–83. Objeto vacío = válido. */
export function validarCamposJugador({ nombrePila, apellido1, apellido2, dorsal, fechaNacimiento }) {
  const errores = {}
  const eNombre = validarCampoNombre(nombrePila, { requerido: true })
  if (eNombre) errores.nombrePila = eNombre
  const eApellido1 = validarCampoNombre(apellido1, { requerido: true })
  if (eApellido1) errores.apellido1 = eApellido1
  if (normalizarEntrada(apellido2)) {
    const eApellido2 = validarCampoNombre(apellido2, { requerido: false })
    if (eApellido2) errores.apellido2 = eApellido2
  }
  const eDorsal = validarDorsal(dorsal)
  if (eDorsal) errores.dorsal = eDorsal
  const eFecha = validarFechaNacimiento(fechaNacimiento)
  if (eFecha) errores.fechaNacimiento = eFecha
  return errores
}

// Decisión 71 (trim) + Decisión 75 (colapsar espacios internos accidentales
// en el valor canónico). Mayúsculas/acentos/puntuación se conservan tal cual
// (Decisión 73/76).
function camposCanonicos({ nombrePila, apellido1, apellido2 }) {
  return {
    nombrePila: normalizarEntrada(nombrePila),
    apellido1: normalizarEntrada(apellido1),
    apellido2: normalizarEntrada(apellido2),
  }
}

function edadDe(fechaNacimiento) {
  if (!fechaNacimiento) return undefined
  const hoy = new Date()
  const nacio = new Date(fechaNacimiento)
  let edad = hoy.getFullYear() - nacio.getFullYear()
  const m = hoy.getMonth() - nacio.getMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < nacio.getDate())) edad--
  return edad
}

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

async function numeroDisponible({ equipoId, dorsal, excluirFichaId }) {
  const activos = (await db.jugadores.where('equipoId').equals(equipoId).toArray()).filter(activoDe)
  return !activos.some((j) => j.id !== excluirFichaId && j.dorsal === dorsal)
}

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
  return jugadores.filter(activoDe).sort((a, b) => (a.dorsal ?? 0) - (b.dorsal ?? 0))
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
  const clave = normalizarParaComparar(`${nombrePila} ${apellido1} ${apellido2 || ''}`)
  const fichas = await db.jugadores.where('ligaId').equals(ligaId).toArray()
  const candidatas = fichas.filter((f) => {
    if (f.id === excluirFichaId) return false
    return normalizarParaComparar(`${f.nombrePila} ${f.apellido1} ${f.apellido2 || ''}`) === clave
  })
  if (!candidatas.length) return []

  const equipos = await db.equipos.where('ligaId').equals(ligaId).toArray()
  const equiposPorId = Object.fromEntries(equipos.map((e) => [e.id, e]))

  return candidatas.map((f) => ({
    fichaId: f.id,
    personaId: f.personaId,
    equipoId: f.equipoId,
    equipoNombre: equiposPorId[f.equipoId]?.nombre,
    nombreCompleto: nombreCompleto(f.nombrePila, f.apellido1, f.apellido2),
    dorsal: f.dorsal,
    activo: activoDe(f),
    edad: edadDe(f.fechaNacimiento),
  }))
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

  const errores = validarCamposJugador(campos)
  if (Object.keys(errores).length) return { tipo: 'invalido', errores }

  const canon = camposCanonicos(campos)
  const dorsal = Number(campos.dorsal)
  const fechaNacimiento = campos.fechaNacimiento || undefined

  if (!resolucionIdentidad) {
    const candidatos = await buscarCandidatosDuplicados({ ligaId: liga.id, ...canon })
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
    if (!(await numeroDisponible({ equipoId, dorsal }))) {
      return { tipo: 'conflicto-numero' }
    }
    const codigo = await generarCodigoJugador()
    const ficha = {
      id: uid(),
      codigo,
      ligaId: liga.id,
      equipoId,
      personaId,
      ...canon,
      nombre: nombreCompleto(canon.nombrePila, canon.apellido1, canon.apellido2),
      dorsal,
      fechaNacimiento,
      reclamado: false,
      activo: true,
    }
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

  const combinados = {
    nombrePila: campos.nombrePila ?? actual.nombrePila,
    apellido1: campos.apellido1 ?? actual.apellido1,
    apellido2: campos.apellido2 ?? actual.apellido2,
    dorsal: campos.dorsal ?? actual.dorsal,
    fechaNacimiento: 'fechaNacimiento' in campos ? campos.fechaNacimiento : actual.fechaNacimiento,
  }

  const errores = validarCamposJugador(combinados)
  if (Object.keys(errores).length) return { tipo: 'invalido', errores }

  const canon = camposCanonicos(combinados)
  const dorsal = Number(combinados.dorsal)
  const fechaNacimiento = combinados.fechaNacimiento || undefined

  // Decisión 7: solo un cambio real en los campos de nombre reactiva el
  // chequeo de duplicados; número o fecha de nacimiento solos no lo hacen.
  const nombreCambio =
    canon.nombrePila !== normalizarEntrada(actual.nombrePila) ||
    canon.apellido1 !== normalizarEntrada(actual.apellido1) ||
    canon.apellido2 !== normalizarEntrada(actual.apellido2)

  if (nombreCambio && !resolucionIdentidad) {
    const candidatos = await buscarCandidatosDuplicados({ ligaId: liga.id, ...canon, excluirFichaId: actual.id })
    if (candidatos.length) return { tipo: 'candidatos', candidatos }
  }

  return db.transaction('rw', db.jugadores, db.auditoria, async () => {
    const vivo = await db.jugadores.get(actual.id)
    if (!vivo) throw new Error('Esta ficha ya no existe.')
    if (dorsal !== vivo.dorsal && !(await numeroDisponible({ equipoId: vivo.equipoId, dorsal, excluirFichaId: vivo.id }))) {
      return { tipo: 'conflicto-numero' }
    }
    const cambios = {
      ...canon,
      nombre: nombreCompleto(canon.nombrePila, canon.apellido1, canon.apellido2),
      dorsal,
      fechaNacimiento,
    }
    await db.jugadores.update(vivo.id, cambios)
    await registrarAuditoria({ tipo: 'edited', fichaId: vivo.id, actorId: sesion.cuentaId })
    return { tipo: 'editado', ficha: { ...vivo, ...cambios } }
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
export async function reactivarJugador({ sesion, liga, ficha, nuevoDorsal }) {
  requerirPermiso(sesion, liga)

  return db.transaction('rw', db.jugadores, db.auditoria, async () => {
    const actual = await db.jugadores.get(ficha.id)
    if (!actual) throw new Error('Esta ficha ya no existe.')
    if (activoDe(actual)) throw new Error('Esta ficha ya está activa.')

    const dorsalObjetivo = nuevoDorsal !== undefined ? Number(nuevoDorsal) : actual.dorsal
    const eDorsal = validarDorsal(dorsalObjetivo)
    if (eDorsal) return { tipo: 'invalido', errores: { dorsal: eDorsal } }

    if (!(await numeroDisponible({ equipoId: actual.equipoId, dorsal: dorsalObjetivo, excluirFichaId: actual.id }))) {
      return { tipo: 'conflicto-numero' }
    }
    const cambios = { activo: true, dorsal: dorsalObjetivo }
    await db.jugadores.update(actual.id, cambios)
    await registrarAuditoria({ tipo: 'reactivated', fichaId: actual.id, actorId: sesion.cuentaId })
    return { tipo: 'reactivado', ficha: { ...actual, ...cambios } }
  })
}
