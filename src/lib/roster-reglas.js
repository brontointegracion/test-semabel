import { MENSAJES_DORSAL, dorsalDe, resolverEntradaDorsal } from './dorsal'
import { activoDe, nombreCompleto } from './identidad'

// ---------------------------------------------------------------------------
// Reglas PURAS de plantilla (sin base de datos, sin React, sin reloj propio).
//
// Salieron de roster.js para que la plantilla local (Dexie) y el backend compartido importen UNA sola
// definición. Se movieron tal cual: normalizadores, validadores, lectura del número y la forma canónica.
// Lo único que cambió es lo siguiente, sin alterar ningún resultado local:
//   - validarFechaNacimiento / validarCamposJugador / edadDe reciben el instante como parámetro opcional
//     (por defecto, el reloj de siempre);
//   - la decisión de una edición, de una reactivación y de un alta, que en roster.js estaba entrelazada con
//     lecturas de Dexie, se separó en funciones puras que reciben lo ya leído (`decidirEdicion`,
//     `planEdicion`, `planReactivacion`, `planAlta`, `numeroDisponibleEn`, `nuevaFichaDe`).
// El dominio de números es el aceptado: todo jugador registrado necesita un entero de 0 a 99; el parámetro
// heredado `numeroPendiente` solo se tolera si es `undefined` o `false`.
// ---------------------------------------------------------------------------

const TIENE_LETRA = /\p{L}/u
const TIENE_DIGITO = /[0-9]/

export const normalizarEntrada = (s) => (s ?? '').toString().trim().replace(/\s+/g, ' ')

// Solo para comparar candidatos duplicados (Decisiones 72–76): minúsculas y
// sin acentos, pero NUNCA se usa para lo que se guarda o se muestra — eso
// conserva mayúsculas/acentos/puntuación tal como los escribió el organizador.
export const normalizarParaComparar = (s) =>
  normalizarEntrada(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const MAX_NOMBRE_CAMISETA = 20

function validarNombreCamiseta(valor) {
  if (normalizarEntrada(valor).length > MAX_NOMBRE_CAMISETA) return `Máximo ${MAX_NOMBRE_CAMISETA} caracteres.`
  return null
}

function validarCampoNombre(valor, { requerido }) {
  const v = normalizarEntrada(valor)
  if (!v) return requerido ? 'Este campo es obligatorio.' : null
  if (v.length > 50) return 'Máximo 50 caracteres.'
  if (TIENE_DIGITO.test(v)) return 'No puede contener números.'
  if (!TIENE_LETRA.test(v)) return 'Debe contener al menos una letra.'
  return null
}

// El número de camiseta se lee con el analizador estricto de dorsal.js: un texto
// en blanco nunca es 0. Política del piloto: todo jugador registrado tiene un
// número entero de 0 a 99. El parámetro heredado `numeroPendiente` ya no autoriza
// nada: cualquier valor distinto de `undefined`/`false` se rechaza, sin importar
// qué más venga en la llamada. (dorsal.js conserva su analizador sin cambios.)
export const MENSAJE_PENDIENTE_NO_PERMITIDO = 'En el piloto cada jugador necesita un número del 0 al 99; no se puede dejar pendiente.'

export const pideNumeroPendiente = (intencion) => intencion !== undefined && intencion !== false
export const errorPendiente = () => ({ numeroPendiente: MENSAJE_PENDIENTE_NO_PERMITIDO })

export function errorDeNumero(r) {
  return r.tipo === 'error' ? { dorsal: r.mensaje } : null
}

/** Lee el número SIN intención de dejarlo pendiente: o es un entero válido, o es un error. */
export const leerNumeroObligatorio = (dorsal) => resolverEntradaDorsal({ dorsal })

export function validarFechaNacimiento(fecha, ahoraMs = Date.now()) {
  if (!fecha) return null
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return 'Fecha inválida.'
  if (d.getTime() > ahoraMs) return 'La fecha no puede ser futura.'
  return null
}

/** Todo lo de la ficha menos el número. Objeto vacío = válido. */
export function validarCamposSinNumero({ nombrePila, apellido1, apellido2, nombreCamiseta, fechaNacimiento }, ahoraMs = Date.now()) {
  const errores = {}
  const eNombre = validarCampoNombre(nombrePila, { requerido: true })
  if (eNombre) errores.nombrePila = eNombre
  const eApellido1 = validarCampoNombre(apellido1, { requerido: true })
  if (eApellido1) errores.apellido1 = eApellido1
  if (normalizarEntrada(apellido2)) {
    const eApellido2 = validarCampoNombre(apellido2, { requerido: false })
    if (eApellido2) errores.apellido2 = eApellido2
  }
  const eCamiseta = validarNombreCamiseta(nombreCamiseta)
  if (eCamiseta) errores.nombreCamiseta = eCamiseta
  const eFecha = validarFechaNacimiento(fechaNacimiento, ahoraMs)
  if (eFecha) errores.fechaNacimiento = eFecha
  return errores
}

/**
 * Decisiones 70–83. Objeto vacío = válido. El número es obligatorio (entero 0–99);
 * `numeroPendiente` ya no es una vía válida (política del piloto).
 */
export function validarCamposJugador(campos, ahoraMs = Date.now()) {
  const errores = validarCamposSinNumero(campos, ahoraMs)
  const eNumero = errorDeNumero(leerNumeroObligatorio(campos.dorsal))
  return {
    ...errores,
    ...(eNumero ?? {}),
    ...(pideNumeroPendiente(campos.numeroPendiente) ? errorPendiente() : {}),
  }
}

// Decisión 71 (trim) + Decisión 75 (colapsar espacios internos accidentales
// en el valor canónico). Mayúsculas/acentos/puntuación se conservan tal cual
// (Decisión 73/76).
export function camposCanonicos({ nombrePila, apellido1, apellido2 }) {
  return {
    nombrePila: normalizarEntrada(nombrePila),
    apellido1: normalizarEntrada(apellido1),
    apellido2: normalizarEntrada(apellido2),
  }
}

export function edadDe(fechaNacimiento, hoy = new Date()) {
  if (!fechaNacimiento) return undefined
  const nacio = new Date(fechaNacimiento)
  let edad = hoy.getFullYear() - nacio.getFullYear()
  const m = hoy.getMonth() - nacio.getMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < nacio.getDate())) edad--
  return edad
}

// La ficha tal como queda: una propiedad con valor `undefined` significa borrada.
export function fichaResultante(base, cambios) {
  const ficha = { ...base, ...cambios }
  for (const k of Object.keys(ficha)) if (ficha[k] === undefined && k in cambios) delete ficha[k]
  return ficha
}

/**
 * Qué hacer con el número en una edición (política del piloto: el resultado siempre
 * tiene un número entero válido).
 *   - sin `dorsal`           → conservar el que hay, que debe ser válido (una ficha anterior sin
 *                              número válido no se puede editar hasta recibir uno)
 *   - `dorsal` real          → fijar ese número
 *   - `dorsal` en blanco, nulo o mal formado → error
 *   - `numeroPendiente` distinto de `undefined`/`false` → error, aunque venga un número válido
 * `undefined` cuenta como omitido; `null` y el texto en blanco son "vacío".
 */
export function decidirNumeroEnEdicion(campos) {
  if (pideNumeroPendiente(campos.numeroPendiente)) return { error: errorPendiente() }
  if (campos.dorsal === undefined) return { modo: 'conservar' }
  const r = leerNumeroObligatorio(campos.dorsal)
  if (r.tipo === 'error') return { error: errorDeNumero(r) }
  return { modo: 'fijar', valor: r.valor }
}

const errorNumeroObligatorio = () => errorDeNumero({ tipo: 'error', clave: 'obligatorio', mensaje: MENSAJES_DORSAL.obligatorio })

// --- Comparación de personas y candidatos --------------------------------------------------------------------------

/** Clave con la que se comparan nombres para SUGERIR candidatos. Nunca identifica a una persona por sí sola. */
export const claveDeComparacion = ({ nombrePila, apellido1, apellido2 }) =>
  normalizarParaComparar(`${nombrePila} ${apellido1} ${apellido2 || ''}`)

/** Candidato duplicado tal como se muestra: nunca la fecha de nacimiento exacta, solo la edad. */
export function proyectarCandidato(ficha, equipoNombre, hoy = new Date()) {
  return {
    fichaId: ficha.id,
    personaId: ficha.personaId,
    equipoId: ficha.equipoId,
    equipoNombre,
    nombreCompleto: nombreCompleto(ficha.nombrePila, ficha.apellido1, ficha.apellido2),
    dorsal: ficha.dorsal,
    activo: activoDe(ficha),
    edad: edadDe(ficha.fechaNacimiento, hoy),
  }
}

/** ¿Está libre el número entre los ACTIVOS del equipo? `fichasDelEquipo` = todas las fichas del equipo. */
export function numeroDisponibleEn(fichasDelEquipo, dorsal, excluirFichaId) {
  return !fichasDelEquipo.filter(activoDe).some((j) => j.id !== excluirFichaId && j.dorsal === dorsal)
}

// --- Alta ----------------------------------------------------------------------------------------------------------

/**
 * Valida y normaliza un alta. → { errores } | { canon, dorsal, fechaNacimiento, nombreCamiseta }
 */
export function planAlta(campos, ahoraMs = Date.now()) {
  const errores = validarCamposJugador(campos, ahoraMs)
  if (Object.keys(errores).length) return { errores }
  return {
    canon: camposCanonicos(campos),
    // Ya validado: es un entero real de 0 a 99.
    dorsal: leerNumeroObligatorio(campos.dorsal).valor,
    fechaNacimiento: campos.fechaNacimiento || undefined,
    // Solo presentación en la consola; nunca entra en la comparación de personas.
    nombreCamiseta: normalizarEntrada(campos.nombreCamiseta),
  }
}

/** La ficha que se guarda en un alta (el llamador pone los identificadores y el código). */
export function nuevaFichaDe({ id, codigo, ligaId, equipoId, personaId, plan }) {
  return {
    id,
    codigo,
    ligaId,
    equipoId,
    personaId,
    ...plan.canon,
    nombre: nombreCompleto(plan.canon.nombrePila, plan.canon.apellido1, plan.canon.apellido2),
    dorsal: plan.dorsal,
    nombreCamiseta: plan.nombreCamiseta,
    fechaNacimiento: plan.fechaNacimiento,
    reclamado: false,
    activo: true,
  }
}

// --- Edición -------------------------------------------------------------------------------------------------------

/**
 * Lo que se decide de una edición con la ficha `actual` ya leída (antes de la transacción).
 * → { errores } | { canon, fechaNacimiento, combinados, decision, nombreCambio }
 */
export function decidirEdicion({ actual, campos, ahoraMs = Date.now() }) {
  const combinados = {
    nombrePila: campos.nombrePila ?? actual.nombrePila,
    apellido1: campos.apellido1 ?? actual.apellido1,
    apellido2: campos.apellido2 ?? actual.apellido2,
    // Omitido = se conserva lo que había (incluso si la ficha es anterior al campo).
    nombreCamiseta: campos.nombreCamiseta ?? actual.nombreCamiseta,
    fechaNacimiento: 'fechaNacimiento' in campos ? campos.fechaNacimiento : actual.fechaNacimiento,
  }

  const errores = validarCamposSinNumero(combinados, ahoraMs)
  const decision = decidirNumeroEnEdicion(campos)
  if (decision.error) Object.assign(errores, decision.error)
  else if (decision.modo === 'conservar' && dorsalDe(actual) === null) Object.assign(errores, errorNumeroObligatorio())
  if (Object.keys(errores).length) return { errores }

  const canon = camposCanonicos(combinados)
  const fechaNacimiento = combinados.fechaNacimiento || undefined

  // Decisión 7: solo un cambio real en los campos de nombre reactiva el
  // chequeo de duplicados; número o fecha de nacimiento solos no lo hacen.
  const nombreCambio =
    canon.nombrePila !== normalizarEntrada(actual.nombrePila) ||
    canon.apellido1 !== normalizarEntrada(actual.apellido1) ||
    canon.apellido2 !== normalizarEntrada(actual.apellido2)

  return { canon, fechaNacimiento, combinados, decision, nombreCambio }
}

/**
 * La parte de la edición que se decide dentro de la transacción, con la ficha `vivo` RELEÍDA ahí.
 * → { tipo: 'invalido', errores } | { tipo: 'conflicto-numero' } | { tipo: 'ok', cambios }
 */
export function planEdicion({ vivo, decidida, fichasDelEquipo }) {
  const { canon, fechaNacimiento, combinados, decision } = decidida
  // Conservar se resuelve contra la ficha releída aquí, no contra la copia anterior.
  if (decision.modo === 'conservar' && dorsalDe(vivo) === null) return { tipo: 'invalido', errores: errorNumeroObligatorio() }
  if (decision.modo === 'fijar' && decision.valor !== vivo.dorsal
    && !numeroDisponibleEn(fichasDelEquipo, decision.valor, vivo.id)) {
    return { tipo: 'conflicto-numero' }
  }
  const cambios = {
    ...canon,
    nombre: nombreCompleto(canon.nombrePila, canon.apellido1, canon.apellido2),
    fechaNacimiento,
  }
  if (decision.modo === 'fijar') cambios.dorsal = decision.valor
  // Una ficha anterior al campo que no lo recibe se queda sin él, tal cual.
  if (combinados.nombreCamiseta !== undefined) cambios.nombreCamiseta = normalizarEntrada(combinados.nombreCamiseta)
  return { tipo: 'ok', cambios }
}

// --- Reactivación --------------------------------------------------------------------------------------------------

/**
 * Reactivar la ficha inactiva `actual` (Decisiones 31, 32, 40, 44). Sin `nuevoDorsal`, intenta recuperar el número
 * anterior; si la ficha no tiene un número válido hace falta uno nuevo. Nunca se reactiva sin número.
 * → { tipo: 'invalido', errores } | { tipo: 'conflicto-numero' } | { tipo: 'ok', cambios }
 */
export function planReactivacion({ actual, nuevoDorsal, numeroPendiente, fichasDelEquipo }) {
  // El parámetro heredado `numeroPendiente` ya no autoriza nada (política del piloto).
  if (pideNumeroPendiente(numeroPendiente)) return { tipo: 'invalido', errores: errorPendiente() }

  let numero
  if (nuevoDorsal !== undefined) {
    numero = leerNumeroObligatorio(nuevoDorsal)
  } else {
    const anterior = dorsalDe(actual)
    numero = anterior === null ? leerNumeroObligatorio(undefined) : { tipo: 'real', valor: anterior }
  }
  if (numero.tipo === 'error') return { tipo: 'invalido', errores: errorDeNumero(numero) }

  if (!numeroDisponibleEn(fichasDelEquipo, numero.valor, actual.id)) return { tipo: 'conflicto-numero' }
  return { tipo: 'ok', cambios: { activo: true, dorsal: numero.valor } }
}
