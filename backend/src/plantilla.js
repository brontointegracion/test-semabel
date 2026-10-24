import { compararPorDorsal } from '../../src/lib/dorsal.js'
import { activoDe } from '../../src/lib/identidad.js'
import { canonico } from '../../src/lib/motor/sobre.js'
import {
  claveDeComparacion, decidirEdicion, numeroDisponibleEn, nuevaFichaDe, planAlta, planEdicion, planReactivacion, proyectarCandidato,
} from '../../src/lib/roster-reglas.js'
import { ASERCION, evaluarAsercion } from './acceso/asercion.js'
import { sha256Hex } from './credenciales.js'

// ---------------------------------------------------------------------------
// Plantilla compartida (lado de la liga). Todo lo que decide una operación de plantilla corre en UNA
// transactionSync del mismo objeto de liga que decide el inicio de un partido, de modo que ambos se ordenan.
//
// Las reglas de negocio NO están aquí: vienen de src/lib/roster-reglas.js, la misma definición que usa la
// plantilla local. Aquí solo hay lo propio del servidor: alcance, bloqueo, revisión esperada, recibos por
// organizador, auditoría e identidad entre ligas.
//
// ORDEN DE UNA OPERACIÓN (todo sincrónico, sin ningún await entre pasos):
//   1. la afirmación del organizador sigue vigente (PRIMERA sentencia)
//   2. recibo previo de (organizador, operación): si existe y es el mismo contenido, se devuelve TAL CUAL y no se
//      hace nada más (ni búsquedas de candidatos, ni lecturas de otras ligas, ni bloqueo, ni validación vigente);
//      si el contenido cambió, es un conflicto sin datos
//   3. alcance (equipo de la liga, ficha del equipo)
//   4. bloqueo del equipo mientras un partido suyo está en curso
//   5. revisión esperada de la ficha
//   6. reglas compartidas, identidad, número
//   7. cambio + auditoría + recibo, juntos
// Una excepción en cualquier punto deshace TODO (la plataforma garantiza la reversión de transactionSync).
// ---------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,64}$/
const ID_OPERACION = /^[A-Za-z0-9_-]{16,64}$/
const MAX_TEXTO = 200
const MAX_REVISION = 2147483647
const MAX_CANDIDATOS = 50

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const soloClaves = (o, permitidas) => Object.keys(o).every((k) => permitidas.includes(k))
const textoONulo = (v) => v === null || (typeof v === 'string' && v.length <= MAX_TEXTO)
const esId = (v) => typeof v === 'string' && ID.test(v)

// Profundidad de un valor JSON, con tope: los valores que se entregan sin tipar a una regla no pueden anidarse.
function profundidad(v, nivel = 0) {
  if (nivel > 3) return nivel
  if (Array.isArray(v)) return v.length ? Math.max(...v.map((x) => profundidad(x, nivel + 1))) : nivel + 1
  if (esObjeto(v)) { const vs = Object.values(v); return vs.length ? Math.max(...vs.map((x) => profundidad(x, nivel + 1))) : nivel + 1 }
  return nivel
}
// Un valor que la regla del número interpreta ella misma (cualquier valor JSON de poca profundidad y texto acotado).
const valorLibre = (v) => profundidad(v) <= 3 && (typeof v !== 'string' || v.length <= MAX_TEXTO)

const CAMPOS_TEXTO = ['nombrePila', 'apellido1', 'apellido2', 'nombreCamiseta', 'fechaNacimiento']
const CAMPOS_ALTA_EDICION = [...CAMPOS_TEXTO, 'dorsal', 'numeroPendiente']

function validarCampos(campos) {
  if (!esObjeto(campos) || !soloClaves(campos, CAMPOS_ALTA_EDICION)) return false
  // Campos de texto: solo texto o null. Un objeto, un arreglo o un número NO se deja llegar a la regla: se convertirían
  // a texto ("[object Object]") y podrían pasar por un nombre.
  if (!CAMPOS_TEXTO.every((k) => !(k in campos) || textoONulo(campos[k]))) return false
  // El número y la intención heredada de dejarlo pendiente los interpreta la regla aceptada, sin restricción de tipo.
  return ['dorsal', 'numeroPendiente'].every((k) => !(k in campos) || valorLibre(campos[k]))
}

function validarResolucion(r) {
  if (!esObjeto(r)) return false
  if (r.tipo === 'otra-persona') return soloClaves(r, ['tipo'])
  if (r.tipo === 'misma-persona') return soloClaves(r, ['tipo', 'personaId']) && esId(r.personaId)
  if (r.tipo === 'misma-persona-otra-liga') {
    return soloClaves(r, ['tipo', 'ligaOrigenId', 'fichaOrigenId', 'personaId'])
      && esId(r.ligaOrigenId) && esId(r.fichaOrigenId) && esId(r.personaId)
  }
  return false
}

const revisionValida = (v) => Number.isSafeInteger(v) && v >= 1 && v <= MAX_REVISION

/**
 * Validación ESTRUCTURAL de la solicitud (tipos y claves). Los fallos de reglas de plantilla no se deciden aquí:
 * los decide roster-reglas.js dentro de la transacción. Una solicitud estructuralmente inválida no se registra.
 * Los campos "de cola", de hora del cliente o de borrador no existen: cualquier clave no listada se rechaza.
 * → { ok: true, operacionId, contenido } | { ok: false }
 */
export function validarSolicitud(tipo, valor) {
  const no = { ok: false }
  if (!esObjeto(valor) || typeof valor.operacionId !== 'string' || !ID_OPERACION.test(valor.operacionId)) return no
  const { operacionId, ...contenido } = valor
  const claves = {
    alta: ['campos', 'resolucionIdentidad'],
    editar: ['revEsperada', 'campos', 'confirmaCandidatos'],
    desactivar: ['revEsperada'],
    reactivar: ['revEsperada', 'nuevoDorsal', 'numeroPendiente'],
  }[tipo]
  if (!claves || !soloClaves(contenido, claves)) return no
  if (tipo === 'alta') {
    if (!validarCampos(contenido.campos)) return no
    if ('resolucionIdentidad' in contenido && !validarResolucion(contenido.resolucionIdentidad)) return no
  } else {
    if (!revisionValida(contenido.revEsperada)) return no
    if (tipo === 'editar') {
      if (!validarCampos(contenido.campos)) return no
      if ('confirmaCandidatos' in contenido && typeof contenido.confirmaCandidatos !== 'boolean') return no
    }
    if (tipo === 'reactivar') {
      for (const k of ['nuevoDorsal', 'numeroPendiente']) if (k in contenido && !valorLibre(contenido[k])) return no
    }
  }
  return { ok: true, operacionId, contenido }
}

/** Huella del contenido EXACTO enviado, ligado al tipo y al objetivo. No incluye la verificación entre ligas. */
export const huellaDe = ({ ligaId, tipo, equipoId, fichaId, contenido }) =>
  sha256Hex(canonico({ ligaId, tipo, equipoId, fichaId: fichaId ?? null, contenido }))

// --- Filas y vistas ------------------------------------------------------------------------------------------------

const COLUMNAS = `id, liga_id, equipo_id, persona_id, codigo, nombre_pila, apellido1, apellido2, nombre, dorsal, nombre_camiseta,
  fecha_nacimiento, activo, desactivado_en, reclamado, rev`
const COLUMNAS_J = COLUMNAS.split(',').map((c) => `j.${c.trim()}`).join(', ')
const sinNulo = (v) => (v === null ? undefined : v)
const aIso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString())

/** La ficha con la forma que esperan las reglas compartidas: lo ausente es `undefined`. */
function fichaDeFila(r) {
  return {
    id: r.id,
    ligaId: sinNulo(r.liga_id),
    equipoId: r.equipo_id,
    personaId: sinNulo(r.persona_id),
    codigo: sinNulo(r.codigo),
    nombrePila: sinNulo(r.nombre_pila),
    apellido1: sinNulo(r.apellido1),
    apellido2: sinNulo(r.apellido2),
    nombre: sinNulo(r.nombre),
    dorsal: sinNulo(r.dorsal),
    nombreCamiseta: sinNulo(r.nombre_camiseta),
    fechaNacimiento: sinNulo(r.fecha_nacimiento),
    activo: r.activo === 1,
    desactivadoEn: sinNulo(r.desactivado_en),
    reclamado: r.reclamado === 1,
  }
}

/** La ficha tal como la ve el organizador (campos privados incluidos). Nunca va al teléfono. */
function vistaDeFila(r) {
  return {
    id: r.id,
    ligaId: r.liga_id,
    equipoId: r.equipo_id,
    personaId: r.persona_id,
    codigo: r.codigo,
    nombrePila: r.nombre_pila,
    apellido1: r.apellido1,
    apellido2: r.apellido2,
    nombre: r.nombre,
    dorsal: r.dorsal,
    nombreCamiseta: r.nombre_camiseta,
    fechaNacimiento: r.fecha_nacimiento,
    activo: r.activo === 1,
    desactivadoEn: aIso(r.desactivado_en),
    reclamado: r.reclamado === 1,
    rev: r.rev,
  }
}

const filasDeEquipo = (sql, equipoId) => sql.exec(`SELECT ${COLUMNAS} FROM jugadores WHERE equipo_id = ?`, equipoId).toArray()

// --- Afirmación y bloqueo ------------------------------------------------------------------------------------------

/** Primera sentencia de cada operación: ¿sigue vigente la afirmación del organizador sobre ESTA liga? */
function comprobar(asercion, ligaId, ahoraFn) {
  const ahora = ahoraFn()
  return { ahora, estado: evaluarAsercion(asercion, ligaId, ahora) }
}
const corte = (estado) => (estado === ASERCION.VENCIDA ? { tipo: 'asercion-vencida' } : { tipo: 'no-autorizado' })

/**
 * ¿Algún partido del equipo (como local o visitante) está en curso? Un partido en pausa o en descanso entre periodos
 * sigue `vivo`. `programado` y `final` no bloquean. Un estado desconocido BLOQUEA (falla cerrado); un JSON ilegible
 * lanza, y la transacción se deshace.
 */
export function equipoBloqueado(sql, equipoId) {
  const filas = sql.exec('SELECT estado_json FROM partidos WHERE local_id = ? OR visita_id = ?', equipoId, equipoId).toArray()
  for (const f of filas) {
    const estado = JSON.parse(f.estado_json)?.partido?.estado ?? null
    if (estado !== 'programado' && estado !== 'final') return true
  }
  return false
}

// --- Lecturas del organizador --------------------------------------------------------------------------------------

export function leerLiga(storage, { asercion, ligaId, ahoraFn }) {
  return storage.transactionSync(() => {
    const { estado } = comprobar(asercion, ligaId, ahoraFn)
    if (estado !== ASERCION.OK) return corte(estado)
    const sql = storage.sql
    const liga = sql.exec('SELECT id, nombre, deporte FROM ligas WHERE id = ?', ligaId).toArray()[0]
    if (!liga) return { tipo: 'no-encontrado' }
    const equipos = sql.exec('SELECT id, nombre FROM equipos WHERE liga_id = ? ORDER BY id', ligaId).toArray().map((e) => {
      const n = (activo) => sql.exec('SELECT COUNT(*) AS n FROM jugadores WHERE equipo_id = ? AND activo = ?', e.id, activo).one().n
      return { id: e.id, nombre: e.nombre, bloqueada: equipoBloqueado(sql, e.id), activos: n(1), inactivos: n(0) }
    })
    return { tipo: 'ok', liga, equipos }
  })
}

export function leerPlantilla(storage, { asercion, ligaId, equipoId, ahoraFn }) {
  return storage.transactionSync(() => {
    const { estado } = comprobar(asercion, ligaId, ahoraFn)
    if (estado !== ASERCION.OK) return corte(estado)
    const sql = storage.sql
    const equipo = sql.exec('SELECT id, nombre, rama FROM equipos WHERE id = ? AND liga_id = ?', equipoId, ligaId).toArray()[0] // `rama`: metadato nullable (REPORT_220)
    if (!equipo) return { tipo: 'no-encontrado' }
    const filas = filasDeEquipo(sql, equipoId)
    const par = (r) => ({ local: fichaDeFila(r), vista: vistaDeFila(r) })
    const todas = filas.map(par)
    const activos = todas.filter((p) => activoDe(p.local)).sort((a, b) => compararPorDorsal(a.local, b.local))
    const inactivos = todas.filter((p) => !activoDe(p.local)).sort((a, b) => (b.vista.desactivadoEn || '').localeCompare(a.vista.desactivadoEn || ''))
    return {
      tipo: 'ok',
      equipo,
      bloqueada: equipoBloqueado(sql, equipoId),
      activos: activos.map((p) => p.vista),
      inactivos: inactivos.map((p) => p.vista),
    }
  })
}

// --- Candidatos y vínculos (lecturas de solo lectura, también para otras ligas del mismo organizador) -----------------

function candidatosDe(sql, ligaId, clave, excluirFichaId, ahora) {
  const filas = sql.exec(
    `SELECT ${COLUMNAS_J}, e.nombre AS equipo_nombre
       FROM jugadores j JOIN equipos e ON e.id = j.equipo_id
      WHERE j.liga_id = ? AND j.nombre_pila IS NOT NULL AND j.apellido1 IS NOT NULL ORDER BY j.id`,
    ligaId,
  ).toArray()
  const hoy = new Date(ahora)
  const encontrados = []
  for (const r of filas) {
    if (r.id === excluirFichaId) continue
    const f = fichaDeFila(r)
    if (claveDeComparacion(f) !== clave) continue
    encontrados.push({ ligaId, ...proyectarCandidato(f, r.equipo_nombre, hoy) })
    if (encontrados.length >= MAX_CANDIDATOS) break
  }
  return encontrados
}

/** Lectura de otra liga del organizador: candidatos por clave de nombre. Solo sugiere; no prueba unicidad global. */
export function candidatosExternos(storage, { asercion, ligaId, clave, ahoraFn }) {
  return storage.transactionSync(() => {
    const { ahora, estado } = comprobar(asercion, ligaId, ahoraFn)
    if (estado !== ASERCION.OK) return corte(estado)
    if (typeof clave !== 'string' || clave.length === 0 || clave.length > 400) return { tipo: 'no-autorizado' }
    return { tipo: 'ok', candidatos: candidatosDe(storage.sql, ligaId, clave, null, ahora) }
  })
}

/** Lectura de otra liga del organizador: ¿existe esa ficha y qué persona tiene? */
export function resolverFichaParaVinculo(storage, { asercion, ligaId, fichaId, ahoraFn }) {
  return storage.transactionSync(() => {
    const { ahora, estado } = comprobar(asercion, ligaId, ahoraFn)
    if (estado !== ASERCION.OK) return corte(estado)
    if (!esId(fichaId)) return { tipo: 'ok', vinculo: null }
    const r = storage.sql.exec(
      `SELECT j.id, j.equipo_id, j.persona_id, j.nombre_pila, j.apellido1, j.apellido2, j.fecha_nacimiento, j.dorsal, j.activo, e.nombre AS equipo_nombre
         FROM jugadores j JOIN equipos e ON e.id = j.equipo_id WHERE j.id = ? AND j.liga_id = ?`,
      fichaId, ligaId,
    ).toArray()[0]
    if (!r || r.persona_id === null) return { tipo: 'ok', vinculo: null }
    const c = proyectarCandidato({
      id: r.id, personaId: r.persona_id, equipoId: r.equipo_id, nombrePila: r.nombre_pila ?? undefined, apellido1: r.apellido1 ?? undefined,
      apellido2: r.apellido2 ?? undefined, fechaNacimiento: r.fecha_nacimiento ?? undefined, dorsal: r.dorsal ?? undefined, activo: r.activo === 1,
    }, r.equipo_nombre, new Date(ahora))
    return { tipo: 'ok', vinculo: { ligaId, ...c } }
  })
}

// --- Evidencia entre ligas (la arma el Worker; el cliente nunca la envía) -------------------------------------------

const mismosElementos = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

function candidatoLimpio(c, ligasPermitidas) {
  if (!esObjeto(c) || !ligasPermitidas.includes(c.ligaId) || !esId(c.fichaId)) return null
  return {
    ligaId: c.ligaId, fichaId: c.fichaId, personaId: c.personaId ?? null, equipoId: c.equipoId ?? null, equipoNombre: c.equipoNombre ?? null,
    nombreCompleto: c.nombreCompleto ?? null, dorsal: c.dorsal ?? null, activo: c.activo === true, edad: c.edad ?? null,
  }
}

// --- Identificadores y códigos --------------------------------------------------------------------------------------

const nuevoId = (prefijo) => `${prefijo}-${crypto.randomUUID()}`

function nuevoCodigo(sql) {
  for (let intento = 0; intento < 25; intento += 1) {
    const codigo = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000))
    if (sql.exec('SELECT 1 AS x FROM jugadores WHERE codigo = ?', codigo).toArray().length === 0) return codigo
  }
  throw new Error('codigo-no-disponible')
}

// --- Operaciones ---------------------------------------------------------------------------------------------------

const COLUMNAS_EDITABLES = [['nombrePila', 'nombre_pila'], ['apellido1', 'apellido1'], ['apellido2', 'apellido2'], ['nombreCamiseta', 'nombre_camiseta'], ['fechaNacimiento', 'fecha_nacimiento'], ['dorsal', 'dorsal']]

/**
 * Ejecuta UNA operación de plantilla de forma atómica. Devuelve valores simples; el Worker los traduce a HTTP.
 *   { tipo: 'decidido', cuerpo, reproducido }        resultado (aplicado o rechazado); `reproducido` = recibo previo
 *   { tipo: 'requiere-verificacion', accion, … }     el alta necesita lectura de otras ligas; NO se escribió nada
 *   { tipo: 'operacion-conflicto' }                  misma operación con otro contenido; sin datos
 *   { tipo: 'no-encontrado' | 'no-autorizado' | 'asercion-vencida' }
 */
export function ejecutarOperacion(storage, p) {
  const { asercion, ligaId, tipo, equipoId, fichaId = null, operacionId, huella, contenido, verificacion = null, ahoraFn } = p
  return storage.transactionSync(() => {
    const { ahora, estado } = comprobar(asercion, ligaId, ahoraFn) // 1. PRIMERA sentencia
    if (estado !== ASERCION.OK) return corte(estado)
    const sql = storage.sql

    // 2. Recibo previo del MISMO organizador y la misma operación. Un organizador distinto nunca llega a esta fila.
    const previo = sql.exec(
      'SELECT liga_id, tipo, equipo_id, ficha_id, huella, resultado_json FROM operaciones_plantilla WHERE organizador_id = ? AND operacion_id = ?',
      asercion.organizadorId, operacionId,
    ).toArray()[0]
    if (previo) {
      if (previo.huella !== huella || previo.liga_id !== ligaId || previo.tipo !== tipo || previo.equipo_id !== equipoId || previo.ficha_id !== fichaId) {
        return { tipo: 'operacion-conflicto' }
      }
      return { tipo: 'decidido', cuerpo: JSON.parse(previo.resultado_json), reproducido: true }
    }

    // 3. Alcance
    const equipo = sql.exec('SELECT id, nombre FROM equipos WHERE id = ? AND liga_id = ?', equipoId, ligaId).toArray()[0]
    if (!equipo) return { tipo: 'no-encontrado' }
    let fila = null
    if (tipo !== 'alta') {
      fila = sql.exec(`SELECT ${COLUMNAS} FROM jugadores WHERE id = ? AND equipo_id = ?`, fichaId, equipoId).toArray()[0]
      if (!fila) return { tipo: 'no-encontrado' }
    }

    const registrar = (resultado, cuerpo) => {
      sql.exec(
        `INSERT INTO operaciones_plantilla (organizador_id, operacion_id, liga_id, tipo, equipo_id, ficha_id, huella, resultado, resultado_json, sesion_id, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        asercion.organizadorId, operacionId, ligaId, tipo, equipoId, fichaId, huella, resultado, JSON.stringify(cuerpo), asercion.sesionId, ahora,
      )
      return { tipo: 'decidido', cuerpo, reproducido: false }
    }
    const rechazar = (motivo, extra = {}) => registrar('rechazado', { resultado: 'rechazado', tipo: motivo, operacionId, ...extra })
    const aplicar = (motivo, fichaId2, revAntes, detalle) => {
      const nueva = sql.exec(`SELECT ${COLUMNAS} FROM jugadores WHERE id = ?`, fichaId2).one()
      sql.exec(
        `INSERT INTO auditoria_plantilla (ts, tipo, ficha_id, equipo_id, liga_id, organizador_id, sesion_id, operacion_id, rev_antes, rev_despues, detalle_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ahora, { creado: 'created', editado: 'edited', desactivado: 'deactivated', reactivado: 'reactivated' }[motivo], fichaId2, equipoId, ligaId,
        asercion.organizadorId, asercion.sesionId, operacionId, revAntes, nueva.rev, JSON.stringify(detalle),
      )
      return registrar('aplicado', { resultado: 'aplicado', tipo: motivo, operacionId, ficha: vistaDeFila(nueva) })
    }

    // 4. Bloqueo
    if (equipoBloqueado(sql, equipoId)) return rechazar('equipo-bloqueado')

    const fichasEquipo = () => filasDeEquipo(sql, equipoId).map(fichaDeFila)

    if (tipo === 'alta') {
      // 6. Reglas compartidas
      const plan = planAlta(contenido.campos, ahora)
      if (plan.errores) return rechazar('invalido', { errores: plan.errores })
      const resolucion = contenido.resolucionIdentidad
      const otras = asercion.ligas.filter((l) => l !== ligaId)
      let personaId
      let identidad
      if (!resolucion) {
        const clave = claveDeComparacion(plan.canon)
        const enLiga = candidatosDe(sql, ligaId, clave, null, ahora)
        let externos = []
        if (otras.length) {
          // Sin lectura de las demás ligas del organizador NO se puede afirmar que no haya coincidencias.
          if (!verificacion || !mismosElementos(verificacion.ligasConsultadas, otras) || !Array.isArray(verificacion.candidatos)) {
            return { tipo: 'requiere-verificacion', accion: 'candidatos', ligasOtras: otras, clave }
          }
          externos = verificacion.candidatos.map((c) => candidatoLimpio(c, otras)).filter(Boolean).slice(0, MAX_CANDIDATOS)
        }
        if (enLiga.length || externos.length) return rechazar('candidatos', { candidatos: [...enLiga, ...externos] })
        personaId = nuevoId('pr')
        identidad = { tipo: 'nueva-sin-coincidencias', ligasConsultadas: [...otras].sort() }
      } else if (resolucion.tipo === 'otra-persona') {
        personaId = nuevoId('pr')
        identidad = { tipo: 'otra-persona' }
      } else if (resolucion.tipo === 'misma-persona') {
        // Solo una persona que ya tiene ficha EN ESTA LIGA: un identificador cualquiera del cliente no sirve.
        const existe = sql.exec('SELECT 1 AS x FROM jugadores WHERE liga_id = ? AND persona_id = ?', ligaId, resolucion.personaId).toArray().length > 0
        if (!existe) return rechazar('identidad-invalida')
        const activa = fichasEquipo().find((j) => j.personaId === resolucion.personaId && activoDe(j))
        if (activa) return rechazar('ya-activo', { ficha: vistaDeFila(sql.exec(`SELECT ${COLUMNAS} FROM jugadores WHERE id = ?`, activa.id).one()) })
        personaId = resolucion.personaId
        identidad = { tipo: 'misma-persona' }
      } else {
        // misma-persona-otra-liga: solo con evidencia que armó el Worker leyendo la liga de origen.
        if (!otras.includes(resolucion.ligaOrigenId)) return rechazar('identidad-invalida')
        if (!verificacion || !('vinculo' in verificacion)) {
          return { tipo: 'requiere-verificacion', accion: 'vinculo', ligasOtras: otras, ligaOrigenId: resolucion.ligaOrigenId, fichaOrigenId: resolucion.fichaOrigenId }
        }
        const v = verificacion.vinculo
        if (!esObjeto(v) || v.ligaId !== resolucion.ligaOrigenId || v.fichaId !== resolucion.fichaOrigenId || v.personaId !== resolucion.personaId) {
          return rechazar('identidad-invalida')
        }
        const activa = fichasEquipo().find((j) => j.personaId === resolucion.personaId && activoDe(j))
        if (activa) return rechazar('ya-activo', { ficha: vistaDeFila(sql.exec(`SELECT ${COLUMNAS} FROM jugadores WHERE id = ?`, activa.id).one()) })
        personaId = resolucion.personaId
        identidad = { tipo: 'misma-persona-otra-liga', ligaOrigenId: v.ligaId, fichaOrigenId: v.fichaId }
      }
      if (!numeroDisponibleEn(fichasEquipo(), plan.dorsal)) return rechazar('conflicto-numero')

      // 7. Cambio + auditoría + recibo
      const ficha = nuevaFichaDe({ id: nuevoId('f'), codigo: nuevoCodigo(sql), ligaId, equipoId, personaId, plan })
      sql.exec(
        `INSERT INTO jugadores (id, liga_id, equipo_id, persona_id, codigo, nombre_pila, apellido1, apellido2, nombre, dorsal, nombre_camiseta,
           fecha_nacimiento, activo, desactivado_en, reclamado, rev, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, 1, ?, ?)`,
        ficha.id, ligaId, equipoId, personaId, ficha.codigo, ficha.nombrePila, ficha.apellido1, ficha.apellido2, ficha.nombre, ficha.dorsal,
        ficha.nombreCamiseta, ficha.fechaNacimiento ?? null, ahora, ahora,
      )
      return aplicar('creado', ficha.id, null, { identidad, dorsalDespues: ficha.dorsal })
    }

    // 5. Revisión esperada (edición, desactivación, reactivación)
    if (contenido.revEsperada !== fila.rev) return rechazar('ficha-desactualizada', { ficha: vistaDeFila(fila) })
    const actual = fichaDeFila(fila)

    if (tipo === 'editar') {
      const decidida = decidirEdicion({ actual, campos: contenido.campos, ahoraMs: ahora })
      if (decidida.errores) return rechazar('invalido', { errores: decidida.errores })
      if (decidida.nombreCambio && contenido.confirmaCandidatos !== true) {
        const candidatos = candidatosDe(sql, ligaId, claveDeComparacion(decidida.canon), actual.id, ahora)
        if (candidatos.length) return rechazar('candidatos', { candidatos })
      }
      const plan = planEdicion({ vivo: actual, decidida, fichasDelEquipo: fichasEquipo() })
      if (plan.tipo === 'invalido') return rechazar('invalido', { errores: plan.errores })
      if (plan.tipo === 'conflicto-numero') return rechazar('conflicto-numero')
      const { cambios } = plan
      const cambiados = COLUMNAS_EDITABLES.map(([k]) => k).filter((k) => k in cambios && (cambios[k] ?? null) !== (actual[k] ?? null))
      sql.exec(
        `UPDATE jugadores SET nombre_pila = ?, apellido1 = ?, apellido2 = ?, nombre = ?, fecha_nacimiento = ?, dorsal = ?, nombre_camiseta = ?,
           rev = rev + 1, actualizado_en = ? WHERE id = ?`,
        cambios.nombrePila, cambios.apellido1, cambios.apellido2, cambios.nombre, cambios.fechaNacimiento ?? null,
        'dorsal' in cambios ? cambios.dorsal : fila.dorsal,
        cambios.nombreCamiseta !== undefined ? cambios.nombreCamiseta : fila.nombre_camiseta,
        ahora, fila.id,
      )
      return aplicar('editado', fila.id, fila.rev, { campos: cambiados, dorsalAntes: fila.dorsal, dorsalDespues: 'dorsal' in cambios ? cambios.dorsal : fila.dorsal })
    }

    if (tipo === 'desactivar') {
      if (!activoDe(actual)) return rechazar('ya-inactiva', { ficha: vistaDeFila(fila) })
      sql.exec('UPDATE jugadores SET activo = 0, desactivado_en = ?, rev = rev + 1, actualizado_en = ? WHERE id = ?', ahora, ahora, fila.id)
      return aplicar('desactivado', fila.id, fila.rev, { activoAntes: true, activoDespues: false, dorsalAntes: fila.dorsal })
    }

    // reactivar
    if (activoDe(actual)) return rechazar('ya-activa', { ficha: vistaDeFila(fila) })
    const plan = planReactivacion({ actual, nuevoDorsal: contenido.nuevoDorsal, numeroPendiente: contenido.numeroPendiente, fichasDelEquipo: fichasEquipo() })
    if (plan.tipo === 'invalido') return rechazar('invalido', { errores: plan.errores })
    if (plan.tipo === 'conflicto-numero') return rechazar('conflicto-numero')
    sql.exec('UPDATE jugadores SET activo = 1, dorsal = ?, rev = rev + 1, actualizado_en = ? WHERE id = ?', plan.cambios.dorsal, ahora, fila.id)
    return aplicar('reactivado', fila.id, fila.rev, { activoAntes: false, activoDespues: true, dorsalAntes: fila.dorsal, dorsalDespues: plan.cambios.dorsal })
  })
}
