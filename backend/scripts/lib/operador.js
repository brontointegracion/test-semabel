import { bloqueoDeEntorno, crearTransporte, tiempoValido, validarDestino } from './transporte.js'

// ---------------------------------------------------------------------------
// Herramienta del OPERADOR para la carga inicial (provisión del organizador, estructura de ligas, lotes de partidos y lectura de
// comprobación). Sin dependencias de Node: solo fetch (inyectado), crypto.subtle y el almacén que se le entrega; el envoltorio de línea
// de comandos es operador-carga.mjs. Usa EXACTAMENTE las rutas y contratos del servidor; no cambia ninguna autorización.
//
//   construirPlan…   OFFLINE. Valida los archivos y devuelve un resumen. Es lo que hace el modo por defecto (simulacro): cero peticiones.
//   aplicar          Mutaciones del operador (Bearer; nunca cookie), una a la vez, con diario ANTES de enviar:
//                      estructura   POST /v1/admin/ligas/{liga}/estructura   idempotente por `cargaId` + contenido (200 reproducido)
//                      partidos     POST /v1/admin/ligas/{liga}/partidos     idempotente por `cargaId` + contenido (lote aparte)
//                      equipos      POST /v1/admin/ligas/{liga}/equipos      AÑADE equipos a una liga ya cargada; `cargaId` NUEVO; idempotente por `cargaId` + contenido
//                      provisionar  POST /v1/admin/organizador               NO idempotente: solo puede haber UN organizador activo
//                      recuperar    POST /v1/admin/organizador/codigo/rotar  NO idempotente: cada llamada emite otro código y revoca el anterior
//                      asignar      POST /v1/admin/organizador/ligas         AÑADE ligas a un organizador existente (id EXPLÍCITO); idempotente por `operacionId` + contenido (200 reproducido)
//   verificar        Solo lecturas públicas (sin credenciales): compara la liga publicada con los archivos.
//
// REGLAS
//   - Una carga incierta (red, tiempo, redirección, 401/403/404/429/5xx, cuerpo inesperado) queda «incierta» en el diario y se detiene; la
//     siguiente ejecución reenvía lo IDÉNTICO (mismo cuerpo, mismo cargaId, guardados en el diario). Nunca se inventa otro identificador.
//   - Provisión con respuesta perdida: reenviar es seguro porque el servidor solo admite un organizador activo (si el primer envío sí
//     se aplicó, el reenvío da 409 y NO crea nada ni emite código). En ese caso la herramienta se DETIENE y no rota nada por su cuenta:
//     el código solo se recupera con el comando explícito `recuperar` y su confirmación (revoca el código vigente y cierra sesiones).
//   - El código emitido se escribe directamente en un archivo privado (0600, creado ANTES de enviar y sin sobrescribir). Nunca va a la
//     salida, al diario, a la dirección ni a los argumentos. El token del operador solo vive en memoria.
// ---------------------------------------------------------------------------

export const MAX_BYTES_DIARIO = 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const ID_CARGA = /^[A-Za-z0-9_-]{16,64}$/
const RE_ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
const LIMITES = { equipos: 100, partidosPorLote: 100, bytesEstructura: 32 * 1024, bytesPartidos: 48 * 1024 }

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (texto) => aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
const bytes = (t) => new TextEncoder().encode(t).length

// ---- Planes (offline) --------------------------------------------------------------------------------------------------

function validarEstructura(p) {
  const e = []
  if (!esObjeto(p)) return ['estructura-no-es-objeto']
  if (!ID_CARGA.test(p.cargaId ?? '')) e.push('cargaId')
  if (!esObjeto(p.liga) || !ID.test(p.liga.id ?? '')) e.push('liga.id')
  if (esObjeto(p.liga) && (typeof p.liga.nombre !== 'string' || p.liga.nombre.trim() === '')) e.push('liga.nombre')
  if (!Array.isArray(p.equipos) || p.equipos.length < 1 || p.equipos.length > LIMITES.equipos) e.push('equipos')
  else {
    const ids = new Set(); const nombres = new Set()
    for (const q of p.equipos) {
      if (!esObjeto(q) || !ID.test(q.id ?? '') || typeof q.nombre !== 'string' || q.nombre.trim() === '') { e.push('equipo-invalido'); continue }
      if (ids.has(q.id)) e.push('equipo-id-repetido')
      if (nombres.has(q.nombre.trim().toLowerCase())) e.push('equipo-nombre-repetido')
      ids.add(q.id); nombres.add(q.nombre.trim().toLowerCase())
    }
  }
  return [...new Set(e)]
}

const claveCorta = (ligaId, id) => (id.startsWith(`${ligaId}-`) && id.length > ligaId.length + 1 ? id.slice(ligaId.length + 1) : id).toLowerCase()
/** Mismo criterio que el servidor (carga.js `hayClavesAmbiguas`): dos equipos cuyas direcciones públicas serían ambiguas. */
function clavesAmbiguas(ligaId, ids) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const [a, b] = [ids[i], ids[j]]
      const [ka, kb] = [claveCorta(ligaId, a), claveCorta(ligaId, b)]
      if (a.toLowerCase() === b.toLowerCase() || ka === kb || ka === b.toLowerCase() || kb === a.toLowerCase()) return true
    }
  }
  return false
}

function validarEquiposAnexos(p, ligaId) {
  const e = []
  if (!esObjeto(p)) return ['equipos-no-es-objeto']
  if (Object.keys(p).some((k) => !['cargaId', 'equipos'].includes(k))) e.push('campos-no-permitidos')
  if (!ID_CARGA.test(p.cargaId ?? '')) e.push('cargaId')
  if (!Array.isArray(p.equipos) || p.equipos.length < 1 || p.equipos.length > LIMITES.equipos) e.push('equipos')
  else {
    const ids = new Set(); const nombres = new Set()
    for (const q of p.equipos) {
      if (!esObjeto(q) || Object.keys(q).some((k) => !['id', 'nombre'].includes(k)) || !ID.test(q.id ?? '') || typeof q.nombre !== 'string' || q.nombre.trim() === '' || q.nombre.trim() !== q.nombre) { e.push('equipo-invalido'); continue }
      if (ids.has(q.id)) e.push('equipo-id-repetido')
      if (nombres.has(q.nombre.toLowerCase())) e.push('equipo-nombre-repetido')
      ids.add(q.id); nombres.add(q.nombre.toLowerCase())
    }
    if (ID.test(ligaId ?? '') && clavesAmbiguas(ligaId, [...ids])) e.push('clave-publica-ambigua')
  }
  return [...new Set(e)]
}

function validarPartidos(p, equiposConocidos) {
  const e = []
  if (!esObjeto(p)) return ['partidos-no-es-objeto']
  if (!ID_CARGA.test(p.cargaId ?? '')) e.push('cargaId')
  if (!Number.isSafeInteger(p.minutosPorPeriodo) || p.minutosPorPeriodo < 1 || p.minutosPorPeriodo > 120) e.push('minutosPorPeriodo')
  if (!Array.isArray(p.partidos) || p.partidos.length < 1 || p.partidos.length > LIMITES.partidosPorLote) e.push('partidos')
  else {
    const ids = new Set()
    for (const g of p.partidos) {
      if (!esObjeto(g) || !ID.test(g.id ?? '') || !ID.test(g.localId ?? '') || !ID.test(g.visitaId ?? '') || g.localId === g.visitaId) { e.push('partido-invalido'); continue }
      if (ids.has(g.id)) e.push('partido-id-repetido')
      ids.add(g.id)
      if (g.programadoPara !== undefined && (typeof g.programadoPara !== 'string' || !RE_ISO_CON_ZONA.test(g.programadoPara) || Number.isNaN(Date.parse(g.programadoPara)))) e.push('programadoPara-sin-zona-o-invalido')
      if (equiposConocidos && (!equiposConocidos.has(g.localId) || !equiposConocidos.has(g.visitaId))) e.push('equipo-fuera-de-la-estructura')
    }
  }
  return [...new Set(e)]
}

/** Lee un archivo ya cargado como texto. → { ok, tipo, ligaId, cuerpo, resumen, problemas } (el resumen no lleva nombres). */
async function elemento(tipo, ligaIdDado, texto, equiposConocidos) {
  let p
  try { p = JSON.parse(texto) } catch { return { ok: false, tipo, ligaId: ligaIdDado ?? null, problemas: ['json-ilegible'], resumen: { tipo } } }
  const cuerpo = JSON.stringify(p)
  const limite = tipo === 'partidos' ? LIMITES.bytesPartidos : LIMITES.bytesEstructura
  const problemas = []
  if (bytes(cuerpo) > limite) problemas.push('demasiado-grande')
  const ligaId = tipo === 'estructura' ? p?.liga?.id : ligaIdDado
  if (!ID.test(ligaId ?? '')) problemas.push('liga-invalida')
  problemas.push(...(tipo === 'estructura' ? validarEstructura(p) : tipo === 'equipos' ? validarEquiposAnexos(p, ligaId) : validarPartidos(p, equiposConocidos)))
  const huella = await sha256Hex(cuerpo)
  const resumen = tipo === 'estructura' || tipo === 'equipos'
    ? { tipo, ligaId: ligaId ?? null, cargaId: p?.cargaId ?? null, equipos: Array.isArray(p?.equipos) ? p.equipos.length : 0, huella: huella.slice(0, 12) }
    : { tipo, ligaId: ligaId ?? null, cargaId: p?.cargaId ?? null, partidos: Array.isArray(p?.partidos) ? p.partidos.length : 0, minutosPorPeriodo: p?.minutosPorPeriodo ?? null, huella: huella.slice(0, 12) }
  const ruta = `/v1/admin/ligas/${ligaId}/${tipo === 'estructura' ? 'estructura' : tipo === 'equipos' ? 'equipos' : 'partidos'}`
  return { ok: problemas.length === 0, tipo, ligaId, id: `${tipo}:${ligaId}:${p?.cargaId}`, ruta, cuerpo, huella, parsed: p, resumen, problemas: [...new Set(problemas)] }
}

/**
 * entradas: { estructuras:[texto], partidos:[{ ligaId, texto }] } → plan { tipo, ok, huella, elementos, problemas }.
 * Los partidos se contrastan con las estructuras dadas en la MISMA ejecución (equipos existentes); sin estructuras no se contrasta.
 */
export async function construirPlanCarga({ tipo, estructuras = [], partidos = [], anexos = [] }) {
  const elementos = []
  const equiposPorLiga = new Map()
  for (const t of estructuras) {
    const el = await elemento('estructura', null, t)
    elementos.push(el)
    if (el.parsed?.equipos && el.ligaId) equiposPorLiga.set(el.ligaId, new Set(el.parsed.equipos.map((q) => q?.id)))
  }
  // Equipos añadidos (`anexos`: [{ ligaId, texto }]): cuentan como equipos conocidos de su liga para contrastar los partidos.
  for (const { ligaId, texto } of anexos) {
    const el = await elemento('equipos', ligaId, texto)
    elementos.push(el)
    if (el.parsed?.equipos && el.ligaId) equiposPorLiga.set(el.ligaId, new Set([...(equiposPorLiga.get(el.ligaId) ?? []), ...el.parsed.equipos.map((q) => q?.id)]))
  }
  for (const { ligaId, texto } of partidos) elementos.push(await elemento('partidos', ligaId, texto, equiposPorLiga.get(ligaId) ?? null))
  const usadas = elementos.filter((e) => e.tipo === (tipo === 'verificar' ? 'estructura' : tipo))
  const problemas = []
  if (usadas.length === 0) problemas.push('sin-archivos')
  const ids = usadas.map((e) => e.id)
  if (new Set(ids).size !== ids.length) problemas.push('carga-repetida')
  for (const e of usadas) if (!e.ok) problemas.push(`${e.id}:${e.problemas.join('+')}`)
  const huella = await sha256Hex(JSON.stringify([tipo, usadas.map((e) => [e.id, e.huella])]))
  return { tipo, ok: problemas.length === 0, huella, elementos, usadas, problemas }
}

export function planProvision({ nombre, ligas }) {
  const problemas = []
  if (typeof nombre !== 'string' || nombre.trim() === '' || nombre.length > 100) problemas.push('nombre')
  if (!Array.isArray(ligas) || ligas.length < 1 || ligas.length > 10 || !ligas.every((l) => ID.test(l)) || new Set(ligas).size !== ligas.length) problemas.push('ligas')
  return { problemas, cuerpo: JSON.stringify({ nombre, ligas }) }
}

export async function construirPlanOrganizador({ tipo, nombre, ligas }) {
  const base = tipo === 'provisionar' ? planProvision({ nombre, ligas }) : { problemas: [], cuerpo: JSON.stringify({ cerrarSesiones: true }) }
  const ruta = tipo === 'provisionar' ? '/v1/admin/organizador' : '/v1/admin/organizador/codigo/rotar'
  const huella = await sha256Hex(`${tipo}:${base.cuerpo}`)
  return {
    tipo, ok: base.problemas.length === 0, huella, problemas: base.problemas,
    usadas: [{ id: tipo, tipo, ruta, cuerpo: base.cuerpo, huella, ok: base.problemas.length === 0, resumen: { tipo, ligas: tipo === 'provisionar' ? ligas : undefined } }],
  }
}

const ID_ORGANIZADOR = /^org-[A-Za-z0-9_-]{1,60}$/
const MAX_LIGAS_ASIGNAR = 10

/**
 * Plan de ASIGNACIÓN de ligas a un organizador existente (OFFLINE). Exige el id del organizador y la lista de ligas EXPLÍCITOS; el
 * identificador de la operación sale del CONTENIDO (organizador + ligas ordenadas), nunca de la hora ni del orden: un reintento reenvía
 * el MISMO cuerpo con el MISMO identificador, y la herramienta nunca crea otro por su cuenta.
 */
export async function construirPlanAsignacion({ organizadorId, ligas }) {
  const problemas = []
  if (typeof organizadorId !== 'string' || !ID_ORGANIZADOR.test(organizadorId)) problemas.push('organizador')
  const lista = Array.isArray(ligas) ? ligas : []
  if (lista.length < 1 || lista.length > MAX_LIGAS_ASIGNAR || !lista.every((l) => typeof l === 'string' && ID.test(l)) || new Set(lista).size !== lista.length) problemas.push('ligas')
  const ordenadas = problemas.length ? [] : [...lista].sort()
  const operacionId = problemas.length ? null : `asig-${(await sha256Hex(JSON.stringify(['asignar-ligas', organizadorId, ordenadas]))).slice(0, 40)}`
  const cuerpo = problemas.length ? '' : JSON.stringify({ operacionId, organizadorId, ligas: ordenadas })
  const huella = await sha256Hex(`asignar:${cuerpo}`)
  return {
    tipo: 'asignar', ok: problemas.length === 0, huella, problemas,
    usadas: [{ id: `asignar:${operacionId}`, tipo: 'asignar', ruta: '/v1/admin/organizador/ligas', cuerpo, huella, ok: problemas.length === 0, resumen: { tipo: 'asignar', organizadorId: problemas.length ? null : organizadorId, ligas: ordenadas, operacionId } }],
  }
}

export const resumenDelPlanCarga = (plan) => ({ tipo: plan.tipo, ok: plan.ok, huella: plan.huella.slice(0, 12), elementos: plan.usadas.map((e) => e.resumen), problemas: plan.problemas })

// ---- Diario -----------------------------------------------------------------------------------------------------------

function diarioNuevo(plan, destino) {
  return {
    version: 1, herramienta: 'operador', tipo: plan.tipo, huellaDelPlan: plan.huella, destino: { origen: destino.origen },
    ops: plan.usadas.map((e) => ({ id: e.id, tipo: e.tipo, ruta: e.ruta, cuerpo: e.cuerpo, huella: e.huella, estado: 'pendiente', resultado: null })),
  }
}
async function guardar(almacen, diario) {
  const texto = JSON.stringify(diario)
  if (texto.length > MAX_BYTES_DIARIO) throw new Error('diario-demasiado-grande')
  await almacen.escribir(texto)
}
async function leerDiario(almacen) {
  const texto = await almacen.leer()
  if (texto === null) return null
  const d = JSON.parse(texto)
  if (!esObjeto(d) || d.version !== 1 || d.herramienta !== 'operador' || !Array.isArray(d.ops)) throw new Error('diario-invalido')
  return d
}

// ---- Aplicar ----------------------------------------------------------------------------------------------------------

/**
 * opciones: { plan, almacen, fetch, origen, remoto, entorno, tiempoMs, token, salidaDeCodigo?, confirmaciones? }
 *   salidaDeCodigo: { preparar(): Promise<void>, guardar(codigo): Promise<void> }  (provisionar / recuperar)
 *   confirmaciones: Set de { 'rotacion', 'rotacion-repetida' }
 * → { estado, ... } sin secretos. Se detiene en el primer rechazo o resultado incierto.
 */
export async function aplicarCarga({ plan, almacen, fetch: fCrudo, origen: origenCrudo, remoto = false, entorno = {}, tiempoMs, token, salidaDeCodigo, confirmaciones = new Set() }) {
  if (!plan.ok) return { estado: 'plan-invalido', problemas: plan.problemas }
  const destino = validarDestino(origenCrudo, { remoto: remoto === true })
  if (destino.error) return { estado: destino.error }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { estado: bloqueo }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { estado: 'tiempo-invalido' }
  if (typeof token !== 'string' || token.length < 32) return { estado: 'sin-credencial' }
  const esOrganizador = plan.tipo === 'provisionar' || plan.tipo === 'recuperar'
  if (esOrganizador && !salidaDeCodigo) return { estado: 'sin-salida-de-codigo' }
  if (plan.tipo === 'recuperar' && !confirmaciones.has('rotacion')) return { estado: 'rotacion-sin-confirmar' }
  const f = crearTransporte({ fetch: fCrudo, destino, tiempoMs: t })

  let diario
  try { diario = await leerDiario(almacen) } catch { return { estado: 'diario-ilegible' } }
  if (diario) {
    if (diario.huellaDelPlan !== plan.huella || diario.destino?.origen !== destino.origen) return { estado: 'diario-de-otro-plan' }
    if (diario.ops.some((o) => o.estado === 'rechazada')) return { estado: 'diario-con-rechazo', ids: diario.ops.filter((o) => o.estado === 'rechazada').map((o) => o.id) }
    // El cuerpo del diario es el que se envía; el de los archivos actuales debe ser idéntico.
    for (const o of diario.ops) {
      const e = plan.usadas.find((x) => x.id === o.id)
      if (!e || e.huella !== o.huella || e.cuerpo !== o.cuerpo) return { estado: 'payload-distinto-del-diario', id: o.id }
    }
  }
  // Un archivo de salida del código se prepara ANTES de cualquier envío: si no se puede, no se envía.
  if (esOrganizador) { try { await salidaDeCodigo.preparar() } catch { return { estado: 'salida-de-codigo-no-disponible' } } }
  if (!diario) {
    diario = diarioNuevo(plan, destino)
    try { await guardar(almacen, diario) } catch { return { estado: 'diario-no-guardado' } }
  }

  const sinResolver = diario.ops.filter((o) => o.estado === 'enviando' || o.estado === 'incierta')
  const pendientes = diario.ops.filter((o) => o.estado === 'pendiente')
  const cuenta = { aplicadas: 0, reproducidas: 0 }
  for (const op of [...sinResolver, ...pendientes]) {
    const reintento = op.estado !== 'pendiente'
    if (reintento && op.tipo === 'recuperar' && !confirmaciones.has('rotacion-repetida')) return { estado: 'rotacion-incierta-requiere-confirmacion', id: op.id }
    op.estado = 'enviando'
    try { await guardar(almacen, diario) } catch { op.estado = reintento ? 'incierta' : 'pendiente'; return { estado: 'diario-no-guardado', ...cuenta } }
    let r
    try {
      const respuesta = await f(`${destino.origen}${op.ruta}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: op.cuerpo })
      let json = null
      try { json = await respuesta.json() } catch { /* sin cuerpo JSON */ }
      r = { status: respuesta.status, json }
    } catch { r = { status: 0, json: null } }
    const j = r.json
    let aviso = null
    if (op.tipo === 'asignar') {
      if ((r.status === 200 || r.status === 201) && esObjeto(j) && j.ok === true && typeof j.reproducido === 'boolean' && Array.isArray(j.ligas)) {
        op.estado = 'aplicada'
        op.resultado = { status: r.status, reproducido: j.reproducido, agregadas: j.agregadas ?? [], yaExistian: j.yaExistian ?? [], ligas: j.ligas }
        if (j.reproducido) cuenta.reproducidas += 1; else cuenta.aplicadas += 1
      } else if (r.status === 409 || r.status === 422) {
        // Conflicto de propiedad / de operación / organizador no activo / ligas no admitidas: el servidor NO escribió nada. No se reintenta solo.
        op.estado = 'rechazada'; op.resultado = { status: r.status, error: String(j?.error ?? 'desconocido').slice(0, 40), ...(Array.isArray(j?.ligas) ? { ligas: j.ligas.filter((x) => typeof x === 'string').slice(0, 10) } : {}) }
      } else { op.estado = 'incierta'; op.resultado = { status: r.status } }
    } else if (op.tipo === 'estructura' || op.tipo === 'partidos' || op.tipo === 'equipos') {
      if ((r.status === 200 || r.status === 201) && esObjeto(j) && typeof j.reproducido === 'boolean') {
        op.estado = 'aplicada'; op.resultado = { status: r.status, reproducido: j.reproducido }
        if (j.reproducido) cuenta.reproducidas += 1; else cuenta.aplicadas += 1
      } else if (r.status === 409 || r.status === 422) {
        op.estado = 'rechazada'; op.resultado = { status: r.status, error: String(j?.error ?? 'desconocido').slice(0, 40) }
      } else { op.estado = 'incierta'; op.resultado = { status: r.status } }
    } else if (op.tipo === 'provisionar' || op.tipo === 'recuperar') {
      const codigoOk = r.status === (op.tipo === 'provisionar' ? 201 : 200) && esObjeto(j) && typeof j.codigo === 'string' && j.codigo.length >= 8
      if (codigoOk) {
        try { await salidaDeCodigo.guardar(j.codigo); op.estado = 'aplicada'; op.resultado = { status: r.status, organizadorId: typeof j.organizadorId === 'string' ? j.organizadorId : null, expiraEn: j.expiraEn ?? null }; cuenta.aplicadas += 1 } catch {
          // La respuesta llegó (el organizador/código existe) pero no se pudo guardar: se anota, SIN el código, y se detiene.
          op.estado = 'codigo-no-guardado'; op.resultado = { status: r.status }; aviso = 'codigo-no-guardado'
        }
      } else if (op.tipo === 'provisionar' && r.status === 409 && j?.error === 'organizador-existente') {
        // Tras un envío incierto significa «el primero sí se aplicó y se perdió la respuesta»; sin envío previo, ya existía.
        op.estado = 'rechazada'; op.resultado = { status: 409, error: 'organizador-existente', trasEnvioIncierto: reintento }
        aviso = reintento ? 'organizador-existente-tras-respuesta-incierta' : 'organizador-existente'
      } else if (r.status === 422 || (op.tipo === 'recuperar' && r.status === 404 && j?.error === 'sin-organizador')) {
        op.estado = 'rechazada'; op.resultado = { status: r.status, error: String(j?.error ?? 'desconocido').slice(0, 40) }
      } else { op.estado = 'incierta'; op.resultado = { status: r.status } }
    }
    try { await guardar(almacen, diario) } catch { return { estado: 'diario-no-guardado', id: op.id, ...cuenta } }
    if (aviso === 'codigo-no-guardado') return { estado: 'codigo-no-guardado', id: op.id, recuperacion: 'comando recuperar con confirmacion', ...cuenta }
    if (op.estado === 'rechazada') return { estado: 'detenido-por-rechazo', id: op.id, motivo: op.resultado.error ?? `http-${op.resultado.status}`, ...(op.resultado.ligas ? { ligas: op.resultado.ligas } : {}), ...(aviso ? { aviso } : {}), ...cuenta }
    if (op.estado === 'incierta') return { estado: 'detenido-sin-resolver', id: op.id, motivo: `http-${op.resultado.status}`, ...cuenta }
  }
  return { estado: 'completo', total: diario.ops.length, ...cuenta }
}

// ---- Verificar (solo lecturas públicas) ---------------------------------------------------------------------------------

const CLAVES_PRIVADAS = ['personaId', 'fechaNacimiento', 'codigo', 'nombreCamiseta', 'nombrePila', 'apellido1', 'apellido2', 'fichaId', 'documento', 'contacto', 'tokenHash', 'token', 'credenciales', 'operacionId', 'organizadorId']
const hallar = (valor, ruta = '') => {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => hallar(v, `${ruta}[${i}]`))
  if (!esObjeto(valor)) return []
  return Object.entries(valor).flatMap(([k, v]) => [...(CLAVES_PRIVADAS.includes(k) ? [`${ruta}.${k}`] : []), ...hallar(v, `${ruta}.${k}`)])
}

/**
 * Compara la lectura pública de cada liga con los archivos. Sin credenciales, solo GET. → { ok, comprobaciones:[{ codigo, ok, detalle? }] }.
 * opciones: { estructuras:[texto], partidos:[{ ligaId, texto }], fetch, origen, remoto, entorno, tiempoMs, diario? (almacén; opcional) }
 */
export async function verificarCarga({ estructuras = [], partidos = [], anexos = [], fetch: fCrudo, origen: origenCrudo, remoto = false, entorno = {}, tiempoMs, almacen }) {
  const destino = validarDestino(origenCrudo, { remoto: remoto === true })
  if (destino.error) return { ok: false, comprobaciones: [{ codigo: destino.error, ok: false }] }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { ok: false, comprobaciones: [{ codigo: bloqueo, ok: false }] }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { ok: false, comprobaciones: [{ codigo: 'tiempo-invalido', ok: false }] }
  const plan = await construirPlanCarga({ tipo: 'estructura', estructuras, partidos, anexos })
  const todos = plan.elementos
  if (todos.some((e) => !e.ok)) return { ok: false, comprobaciones: [{ codigo: 'archivos-invalidos', ok: false, detalle: todos.filter((e) => !e.ok).map((e) => `${e.id}:${e.problemas.join('+')}`) }] }
  const f = crearTransporte({ fetch: fCrudo, destino, tiempoMs: t })
  const c = []
  const prueba = (codigo, ok, detalle) => c.push(detalle === undefined ? { codigo, ok } : { codigo, ok, detalle })
  const ligas = [...new Set(todos.map((e) => e.ligaId))].sort()
  for (const ligaId of ligas) {
    let r
    try { const resp = await f(`${destino.origen}/v1/ligas/${ligaId}/publico`); r = { status: resp.status, json: await resp.json().catch(() => null) } } catch { r = { status: 0, json: null } }
    prueba(`lectura-publica:${ligaId}`, r.status === 200 && esObjeto(r.json), r.status)
    if (r.status !== 200 || !esObjeto(r.json)) continue
    const lectura = r.json
    const est = todos.find((e) => e.tipo === 'estructura' && e.ligaId === ligaId)
    if (est) {
      prueba(`liga-id-y-nombre:${ligaId}`, lectura.liga?.id === ligaId && lectura.liga?.nombre === est.parsed.liga.nombre)
      // El conjunto esperado es EXACTO: la estructura inicial más los equipos añadidos que se den en esta misma comprobación. Sin
      // `anexos`, un equipo añadido en el servidor es un equipo inesperado y la comprobación falla (no se relaja).
      const anx = todos.filter((e) => e.tipo === 'equipos' && e.ligaId === ligaId)
      const esperados = [...est.parsed.equipos, ...anx.flatMap((a) => a.parsed.equipos)].map((q) => `${q.id}|${q.nombre}`).sort()
      const reales = (lectura.equipos ?? []).map((q) => `${q.id}|${q.nombre}`).sort()
      prueba(`equipos-exactos:${ligaId}`, JSON.stringify(esperados) === JSON.stringify(reales), { esperados: esperados.length, reales: reales.length })
    } else {
      // Solo equipos añadidos, sin la estructura inicial: se comprueba que estén presentes con su nombre exacto; NO se afirma que la liga
      // esté completa (para eso hay que dar también la estructura inicial).
      const anx = todos.filter((e) => e.tipo === 'equipos' && e.ligaId === ligaId)
      if (anx.length) {
        const reales = new Map((lectura.equipos ?? []).map((q) => [q.id, q.nombre]))
        const faltan = anx.flatMap((a) => a.parsed.equipos).filter((q) => reales.get(q.id) !== q.nombre).map((q) => q.id)
        prueba(`equipos-anadidos-presentes:${ligaId}`, faltan.length === 0, faltan)
      }
    }
    const lotes = todos.filter((e) => e.tipo === 'partidos' && e.ligaId === ligaId)
    if (lotes.length) {
      const esperados = lotes.flatMap((l) => l.parsed.partidos)
      const reales = Array.isArray(lectura.partidos) ? lectura.partidos : []
      prueba(`partidos-cantidad:${ligaId}`, reales.length === esperados.length, { esperados: esperados.length, reales: reales.length })
      const defectos = []
      for (const g of esperados) {
        const p = reales.find((x) => x.gameId === g.id)
        if (!p) { defectos.push(`${g.id}:ausente`); continue }
        if (p.estado !== 'programado' || p.rev !== 0) defectos.push(`${g.id}:estado`)
        if (p.local?.id !== g.localId || p.visita?.id !== g.visitaId) defectos.push(`${g.id}:equipos`)
        if (p.local?.puntos !== 0 || p.visita?.puntos !== 0) defectos.push(`${g.id}:marcador`)
        const esperadoMs = g.programadoPara === undefined ? null : Date.parse(g.programadoPara)
        const realMs = typeof p.programadoPara === 'string' ? Date.parse(p.programadoPara) : null
        if (esperadoMs !== realMs) defectos.push(`${g.id}:hora`)
        if ((g.sede ?? null) !== (p.sede ?? null)) defectos.push(`${g.id}:sede`)
      }
      prueba(`partidos-exactos:${ligaId}`, defectos.length === 0, defectos)
    }
    const privadas = hallar(lectura)
    prueba(`sin-campos-privados:${ligaId}`, privadas.length === 0, privadas)
  }
  if (almacen) {
    const d = await leerDiario(almacen).catch(() => null)
    prueba('diario-todo-aplicado', Boolean(d) && d.ops.every((o) => o.estado === 'aplicada'), d ? d.ops.filter((o) => o.estado !== 'aplicada').map((o) => o.id) : ['ausente'])
  }
  return { ok: c.every((x) => x.ok), comprobaciones: c }
}
