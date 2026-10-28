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
//                      retirar      POST /v1/admin/ligas/{liga}/partidos/retirar     RETIRA partidos programados sin actividad (reversible); idempotente por `cargaId` + contenido
//                      restaurar    POST /v1/admin/ligas/{liga}/partidos/restaurar   RESTAURA partidos retirados (operación aparte, nunca un interruptor); idempotente igual
//                      renombrar    POST /v1/admin/ligas/{liga}/nombre               cambia SOLO el nombre que se muestra de la liga; idempotente por `cargaId` + contenido; la reversión es OTRA operación con otro `cargaId`
//                      ramas        POST /v1/admin/ligas/{liga}/equipos/ramas       FIJA la rama de equipos YA existentes (solo NULL → valor; igual = sin cambio; distinta = rechazo 409); idempotente por `cargaId` + contenido
//                      asignar      POST /v1/admin/organizador/ligas         AÑADE ligas a un organizador existente (id EXPLÍCITO); idempotente por `operacionId` + contenido (200 reproducido)
//   verificar        Solo lecturas públicas (sin credenciales): compara la liga publicada con los archivos.
//   verificar-ramas  Solo lecturas públicas: cada equipo del archivo publica la rama indicada.
//   verificar-nombre Solo lecturas públicas: la liga publica el nombre del archivo (y sigue con su id, sus equipos y sus partidos).
//   verificar-retiro / verificar-restauracion   Solo lecturas públicas: los partidos del archivo ya NO / otra vez se publican (lista y lectura directa).
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
const RAMAS = ['masculino', 'femenino', 'mixta'] // REPORT_220; las mismas del servidor (ramas-equipos.js)
const LIMITES = { equipos: 100, partidosPorLote: 100, bytesEstructura: 32 * 1024, bytesPartidos: 48 * 1024, partidosRetiro: 50, bytesRetiro: 8 * 1024, bytesNombre: 2 * 1024, equiposRamas: 100, bytesRamas: 16 * 1024, partidosOrtografia: 50, bytesOrtografia: 8 * 1024 }

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
      if (Object.keys(q).some((k) => !['id', 'nombre', 'rama'].includes(k)) || (q.rama !== undefined && !RAMAS.includes(q.rama))) { e.push('equipo-invalido'); continue } // rama opcional (REPORT_220)
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
      if (!esObjeto(q) || Object.keys(q).some((k) => !['id', 'nombre', 'rama'].includes(k)) || (q.rama !== undefined && !RAMAS.includes(q.rama)) || !ID.test(q.id ?? '') || typeof q.nombre !== 'string' || q.nombre.trim() === '' || q.nombre.trim() !== q.nombre) { e.push('equipo-invalido'); continue }
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

// ---- Retiro / restauración de partidos (OFFLINE) --------------------------------------------------------------------------

function validarRetiro(p) {
  const e = []
  if (!esObjeto(p)) return ['retiro-no-es-objeto']
  if (Object.keys(p).some((k) => !['cargaId', 'partidos'].includes(k))) e.push('campos-no-permitidos')
  if (!ID_CARGA.test(p.cargaId ?? '')) e.push('cargaId')
  if (!Array.isArray(p.partidos) || p.partidos.length < 1 || p.partidos.length > LIMITES.partidosRetiro) e.push('partidos')
  else if (!p.partidos.every((id) => typeof id === 'string' && ID.test(id))) e.push('partido-id-invalido')
  else if (new Set(p.partidos).size !== p.partidos.length) e.push('partido-id-repetido')
  return e
}

/**
 * Plan de RETIRO (`tipo: 'retirar'`) o de RESTAURACIÓN (`'restaurar'`): `retiros` = [{ ligaId, texto }] con el cuerpo EXACTO
 * { cargaId, partidos: [id, …] }. El cuerpo que se envía es el contenido normalizado (ids ordenados): un reintento reenvía lo IDÉNTICO.
 * Nunca se inventa un cargaId ni se convierte un retiro en restauración: son dos comandos distintos.
 */
export async function construirPlanRetiro({ tipo, retiros = [] }) {
  const usadas = []
  for (const { ligaId, texto } of retiros) {
    let p
    try { p = JSON.parse(texto) } catch { usadas.push({ id: `${tipo}:${ligaId}:ilegible`, tipo, ligaId, ok: false, problemas: ['json-ilegible'], resumen: { tipo, ligaId } }); continue }
    const problemas = []
    if (!ID.test(ligaId ?? '')) problemas.push('liga-invalida')
    problemas.push(...validarRetiro(p))
    const normal = problemas.length === 0 ? { cargaId: p.cargaId, partidos: [...p.partidos].sort() } : null
    const cuerpo = normal ? JSON.stringify(normal) : ''
    if (cuerpo && bytes(cuerpo) > LIMITES.bytesRetiro) problemas.push('demasiado-grande')
    const huella = await sha256Hex(`${tipo}:${ligaId}:${cuerpo}`)
    usadas.push({
      id: `${tipo}:${ligaId}:${p?.cargaId}`, tipo, ligaId, ruta: `/v1/admin/ligas/${ligaId}/partidos/${tipo === 'retirar' ? 'retirar' : 'restaurar'}`, cuerpo, huella, normal,
      ok: problemas.length === 0, problemas,
      resumen: { tipo, ligaId: ligaId ?? null, cargaId: p?.cargaId ?? null, partidos: Array.isArray(p?.partidos) ? p.partidos.length : 0, huella: huella.slice(0, 12) },
    })
  }
  const problemas = []
  if (usadas.length === 0) problemas.push('sin-archivos')
  const ids = usadas.map((e) => e.id)
  if (new Set(ids).size !== ids.length) problemas.push('carga-repetida')
  for (const e of usadas) if (!e.ok) problemas.push(`${e.id}:${e.problemas.join('+')}`)
  const huella = await sha256Hex(JSON.stringify([tipo, usadas.map((e) => [e.id, e.huella])]))
  return { tipo, ok: problemas.length === 0, huella, usadas, problemas }
}

// ---- Renombrar una liga (OFFLINE) ------------------------------------------------------------------------------------------

// Misma regla que el servidor (`esNombre` de carga.js): sin espacios en los extremos, 1–80 caracteres, sin caracteres de control.
const NOMBRE_VALIDO = (v) => typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= 80 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v)

/** Plan de RENOMBRE: `nombres` = [{ ligaId, texto }] con el cuerpo EXACTO { cargaId, nombre }. El cuerpo enviado es el mismo del archivo (un reintento reenvía lo IDÉNTICO). */
export async function construirPlanNombre({ nombres = [] }) {
  const usadas = []
  for (const { ligaId, texto } of nombres) {
    let p
    try { p = JSON.parse(texto) } catch { usadas.push({ id: `renombrar:${ligaId}:ilegible`, tipo: 'renombrar', ligaId, ok: false, problemas: ['json-ilegible'], resumen: { tipo: 'renombrar', ligaId } }); continue }
    const problemas = []
    if (!ID.test(ligaId ?? '')) problemas.push('liga-invalida')
    if (!esObjeto(p)) problemas.push('renombre-no-es-objeto')
    else {
      if (Object.keys(p).some((k) => !['cargaId', 'nombre'].includes(k))) problemas.push('campos-no-permitidos')
      if (!ID_CARGA.test(p.cargaId ?? '')) problemas.push('cargaId')
      if (!NOMBRE_VALIDO(p.nombre)) problemas.push('nombre')
    }
    const cuerpo = problemas.length === 0 ? JSON.stringify({ cargaId: p.cargaId, nombre: p.nombre }) : ''
    if (cuerpo && bytes(cuerpo) > LIMITES.bytesNombre) problemas.push('demasiado-grande')
    const huella = await sha256Hex(`renombrar:${ligaId}:${cuerpo}`)
    usadas.push({
      id: `renombrar:${ligaId}:${p?.cargaId}`, tipo: 'renombrar', ligaId, ruta: `/v1/admin/ligas/${ligaId}/nombre`, cuerpo, huella, nombre: problemas.length === 0 ? p.nombre : null,
      ok: problemas.length === 0, problemas,
      resumen: { tipo: 'renombrar', ligaId: ligaId ?? null, cargaId: p?.cargaId ?? null, nombre: problemas.length === 0 ? p.nombre : null, huella: huella.slice(0, 12) },
    })
  }
  const problemas = []
  if (usadas.length === 0) problemas.push('sin-archivos')
  const ids = usadas.map((e) => e.id)
  if (new Set(ids).size !== ids.length) problemas.push('carga-repetida')
  if (new Set(usadas.map((e) => e.ligaId)).size !== usadas.length) problemas.push('liga-repetida') // un cambio de nombre por liga en cada ejecución
  for (const e of usadas) if (!e.ok) problemas.push(`${e.id}:${e.problemas.join('+')}`)
  const huella = await sha256Hex(JSON.stringify(['renombrar', usadas.map((e) => [e.id, e.huella])]))
  return { tipo: 'renombrar', ok: problemas.length === 0, huella, usadas, problemas }
}

// ---- Corregir la ORTOGRAFÍA de la sede de partidos programados o finales (OFFLINE) -------------------------------------------------
const SEDE_VALIDA = (v) => typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= 80 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v) && v === v.normalize('NFC')

// Cuerpo { cargaId, sedeAnterior, sede, partidos: [id,…] }. Misma regla que el servidor (sede-ortografia.js): los dos
// textos solo pueden diferir en tildes/diéresis, mayúsculas y espacios.

/** Forma comparable de una sede: sin diacríticos, sin mayúsculas ni espacios (la misma clave que el servidor). */
export const claveOrtografica = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, '')

/** Plan de ORTOGRAFÍA: `ortografias` = [{ ligaId, texto }] con el cuerpo EXACTO { cargaId, sedeAnterior, sede, partidos: [id,…] }. El cuerpo enviado es el normalizado (ids ordenados); un reintento reenvía lo IDÉNTICO. */
export async function construirPlanOrtografia({ ortografias = [] }) {
  const usadas = []
  for (const { ligaId, texto } of ortografias) {
    let p
    try { p = JSON.parse(texto) } catch { usadas.push({ id: `corregir-ortografia-sede:${ligaId}:ilegible`, tipo: 'corregir-ortografia-sede', ligaId, ok: false, problemas: ['json-ilegible'], resumen: { tipo: 'corregir-ortografia-sede', ligaId } }); continue }
    const problemas = []
    if (!ID.test(ligaId ?? '')) problemas.push('liga-invalida')
    if (!esObjeto(p)) problemas.push('ortografia-no-es-objeto')
    else {
      if (Object.keys(p).some((k) => !['cargaId', 'sedeAnterior', 'sede', 'partidos'].includes(k))) problemas.push('campos-no-permitidos')
      if (!ID_CARGA.test(p.cargaId ?? '')) problemas.push('cargaId')
      if (!SEDE_VALIDA(p.sedeAnterior)) problemas.push('sedeAnterior')
      if (!SEDE_VALIDA(p.sede)) problemas.push('sede')
      if (SEDE_VALIDA(p.sedeAnterior) && SEDE_VALIDA(p.sede)) {
        if (p.sede === p.sedeAnterior) problemas.push('sede-igual')
        else if (claveOrtografica(p.sede) !== claveOrtografica(p.sedeAnterior)) problemas.push('sede-no-es-ortografia')
      }
      if (!Array.isArray(p.partidos) || p.partidos.length < 1 || p.partidos.length > LIMITES.partidosOrtografia) problemas.push('partidos')
      else if (!p.partidos.every((id) => typeof id === 'string' && ID.test(id))) problemas.push('partidos.id')
      else if (new Set(p.partidos).size !== p.partidos.length) problemas.push('partidos.id-repetido')
    }
    const normal = problemas.length === 0 ? { cargaId: p.cargaId, sedeAnterior: p.sedeAnterior, sede: p.sede, partidos: [...p.partidos].sort() } : null
    const cuerpo = normal ? JSON.stringify(normal) : ''
    if (cuerpo && bytes(cuerpo) > LIMITES.bytesOrtografia) problemas.push('demasiado-grande')
    const huella = await sha256Hex(`corregir-ortografia-sede:${ligaId}:${cuerpo}`)
    usadas.push({
      id: `corregir-ortografia-sede:${ligaId}:${p?.cargaId}`, tipo: 'corregir-ortografia-sede', ligaId, ruta: `/v1/admin/ligas/${ligaId}/partidos/sede-ortografia`, cuerpo, huella, normal,
      ok: problemas.length === 0, problemas,
      resumen: { tipo: 'corregir-ortografia-sede', ligaId: ligaId ?? null, cargaId: p?.cargaId ?? null, partidos: normal ? normal.partidos.length : 0, sedeAnterior: normal?.sedeAnterior ?? null, sede: normal?.sede ?? null, cambio: normal ? cambioDeTexto(normal.sedeAnterior, normal.sede) : null, huella: huella.slice(0, 12) },
    })
  }
  const problemas = []
  if (usadas.length === 0) problemas.push('sin-archivos')
  const ids = usadas.map((e) => e.id)
  if (new Set(ids).size !== ids.length) problemas.push('carga-repetida')
  if (new Set(usadas.map((e) => e.ligaId)).size !== usadas.length) problemas.push('liga-repetida') // una corrección por liga en cada ejecución
  for (const e of usadas) if (!e.ok) problemas.push(`${e.id}:${e.problemas.join('+')}`)
  const huella = await sha256Hex(JSON.stringify(['corregir-ortografia-sede', usadas.map((e) => [e.id, e.huella])]))
  return { tipo: 'corregir-ortografia-sede', ok: problemas.length === 0, huella, usadas, problemas }
}

/** Qué caracteres cambian entre dos textos (para que quien revisa el simulacro vea que solo cambian los acentos): ['u→ü@17', 'o→ó@38'] */
function cambioDeTexto(a, b) {
  const x = [...a]
  const y = [...b]
  if (x.length !== y.length) return [`longitud ${x.length}→${y.length}`]
  return x.flatMap((c, i) => (c === y[i] ? [] : [`${c}→${y[i]}@${i} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}→U+${y[i].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`]))
}

// ---- Ramas de equipos ya existentes (OFFLINE) -------------------------------------------------------------------------------

/** Plan de RAMAS: `ramas` = [{ ligaId, texto }] con el cuerpo EXACTO { cargaId, ramas: [{ equipoId, rama }] }. El cuerpo enviado es el contenido NORMALIZADO (equipos ordenados). */
export async function construirPlanRamas({ ramas = [] }) {
  const usadas = []
  for (const { ligaId, texto } of ramas) {
    let p
    try { p = JSON.parse(texto) } catch { usadas.push({ id: `ramas:${ligaId}:ilegible`, tipo: 'ramas', ligaId, ok: false, problemas: ['json-ilegible'], resumen: { tipo: 'ramas', ligaId } }); continue }
    const problemas = []
    if (!ID.test(ligaId ?? '')) problemas.push('liga-invalida')
    if (!esObjeto(p)) problemas.push('ramas-no-es-objeto')
    else {
      if (Object.keys(p).some((k) => !['cargaId', 'ramas'].includes(k))) problemas.push('campos-no-permitidos')
      if (!ID_CARGA.test(p.cargaId ?? '')) problemas.push('cargaId')
      if (!Array.isArray(p.ramas) || p.ramas.length < 1 || p.ramas.length > LIMITES.equiposRamas) problemas.push('ramas')
      else {
        const ids = new Set()
        for (const r of p.ramas) {
          if (!esObjeto(r) || Object.keys(r).length !== 2 || !('equipoId' in r) || !('rama' in r)) { problemas.push('rama-forma'); continue }
          if (typeof r.equipoId !== 'string' || !ID.test(r.equipoId)) problemas.push('equipoId')
          else if (ids.has(r.equipoId)) problemas.push('equipoId-repetido')
          else ids.add(r.equipoId)
          if (!RAMAS.includes(r.rama)) problemas.push('rama')
        }
      }
    }
    const normal = problemas.length === 0 ? { cargaId: p.cargaId, ramas: p.ramas.map((r) => ({ equipoId: r.equipoId, rama: r.rama })).sort((a, b) => (a.equipoId < b.equipoId ? -1 : 1)) } : null
    const cuerpo = normal ? JSON.stringify(normal) : ''
    if (cuerpo && bytes(cuerpo) > LIMITES.bytesRamas) problemas.push('demasiado-grande')
    const huella = await sha256Hex(`ramas:${ligaId}:${cuerpo}`)
    const porRama = normal ? normal.ramas.reduce((m, r) => ({ ...m, [r.rama]: (m[r.rama] ?? 0) + 1 }), {}) : null
    usadas.push({
      id: `ramas:${ligaId}:${p?.cargaId}`, tipo: 'ramas', ligaId, ruta: `/v1/admin/ligas/${ligaId}/equipos/ramas`, cuerpo, huella, normal,
      ok: problemas.length === 0, problemas: [...new Set(problemas)],
      resumen: { tipo: 'ramas', ligaId: ligaId ?? null, cargaId: p?.cargaId ?? null, equipos: normal ? normal.ramas.length : 0, porRama, huella: huella.slice(0, 12) },
    })
  }
  const problemas = []
  if (usadas.length === 0) problemas.push('sin-archivos')
  const ids = usadas.map((e) => e.id)
  if (new Set(ids).size !== ids.length) problemas.push('carga-repetida')
  for (const e of usadas) if (!e.ok) problemas.push(`${e.id}:${e.problemas.join('+')}`)
  const huella = await sha256Hex(JSON.stringify(['ramas', usadas.map((e) => [e.id, e.huella])]))
  return { tipo: 'ramas', ok: problemas.length === 0, huella, usadas, problemas }
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
    } else if (op.tipo === 'estructura' || op.tipo === 'partidos' || op.tipo === 'equipos' || op.tipo === 'retirar' || op.tipo === 'restaurar' || op.tipo === 'renombrar' || op.tipo === 'ramas' || op.tipo === 'corregir-ortografia-sede') {
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

/**
 * Verificación de un RETIRO (`tipo: 'retirar'`: los partidos del archivo ya no se publican) o de una RESTAURACIÓN (`'restaurar'`: se publican otra
 * vez, programados). Solo GET públicos, sin credenciales. Comprueba la lista de la liga Y la lectura directa de cada partido (404 = retirado).
 */
export async function verificarRetiro({ tipo, retiros = [], fetch: fCrudo, origen: origenCrudo, remoto = false, entorno = {}, tiempoMs }) {
  const destino = validarDestino(origenCrudo, { remoto: remoto === true })
  if (destino.error) return { ok: false, comprobaciones: [{ codigo: destino.error, ok: false }] }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { ok: false, comprobaciones: [{ codigo: bloqueo, ok: false }] }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { ok: false, comprobaciones: [{ codigo: 'tiempo-invalido', ok: false }] }
  const plan = await construirPlanRetiro({ tipo, retiros })
  if (!plan.ok) return { ok: false, comprobaciones: [{ codigo: 'archivos-invalidos', ok: false, detalle: plan.problemas }] }
  const f = crearTransporte({ fetch: fCrudo, destino, tiempoMs: t })
  const c = []
  const prueba = (codigo, ok, detalle) => c.push(detalle === undefined ? { codigo, ok } : { codigo, ok, detalle })
  const retirados = tipo === 'retirar'
  for (const e of plan.usadas) {
    let lista
    try { const r = await f(`${destino.origen}/v1/ligas/${e.ligaId}/publico`); lista = { status: r.status, json: await r.json().catch(() => null) } } catch { lista = { status: 0, json: null } }
    prueba(`lectura-publica:${e.ligaId}`, lista.status === 200 && esObjeto(lista.json), lista.status)
    if (lista.status !== 200 || !esObjeto(lista.json)) continue
    const publicados = new Map((Array.isArray(lista.json.partidos) ? lista.json.partidos : []).map((p) => [p.gameId, p]))
    const defectos = []
    for (const id of e.normal.partidos) {
      let d
      try { const r = await f(`${destino.origen}/v1/ligas/${e.ligaId}/partidos/${id}`); d = r.status } catch { d = 0 }
      if (retirados) {
        if (publicados.has(id)) defectos.push(`${id}:sigue-en-la-lista`)
        if (d !== 404) defectos.push(`${id}:lectura-directa-${d}`)
      } else {
        if (!publicados.has(id)) defectos.push(`${id}:ausente-de-la-lista`)
        else if (publicados.get(id).estado !== 'programado' || publicados.get(id).rev !== 0) defectos.push(`${id}:estado`)
        if (d !== 200) defectos.push(`${id}:lectura-directa-${d}`)
      }
    }
    prueba(`${retirados ? 'retirados' : 'restaurados'}:${e.ligaId}`, defectos.length === 0, defectos)
  }
  return { ok: c.every((x) => x.ok), comprobaciones: c }
}

/**
 * Verificación de un RENOMBRE: solo GET públicos, sin credenciales. La lectura pública de cada liga debe traer el nombre del archivo, su mismo id y sus
 * listas de equipos y partidos (no se afirma nada más: el renombre no toca nada más). → { ok, comprobaciones:[{ codigo, ok, detalle? }] }
 */
export async function verificarNombre({ nombres = [], fetch: fCrudo, origen: origenCrudo, remoto = false, entorno = {}, tiempoMs }) {
  const destino = validarDestino(origenCrudo, { remoto: remoto === true })
  if (destino.error) return { ok: false, comprobaciones: [{ codigo: destino.error, ok: false }] }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { ok: false, comprobaciones: [{ codigo: bloqueo, ok: false }] }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { ok: false, comprobaciones: [{ codigo: 'tiempo-invalido', ok: false }] }
  const plan = await construirPlanNombre({ nombres })
  if (!plan.ok) return { ok: false, comprobaciones: [{ codigo: 'archivos-invalidos', ok: false, detalle: plan.problemas }] }
  const f = crearTransporte({ fetch: fCrudo, destino, tiempoMs: t })
  const c = []
  const prueba = (codigo, ok, detalle) => c.push(detalle === undefined ? { codigo, ok } : { codigo, ok, detalle })
  for (const e of plan.usadas) {
    let r
    try { const resp = await f(`${destino.origen}/v1/ligas/${e.ligaId}/publico`); r = { status: resp.status, json: await resp.json().catch(() => null) } } catch { r = { status: 0, json: null } }
    prueba(`lectura-publica:${e.ligaId}`, r.status === 200 && esObjeto(r.json), r.status)
    if (r.status !== 200 || !esObjeto(r.json)) continue
    prueba(`nombre:${e.ligaId}`, r.json.liga?.nombre === e.nombre, r.json.liga?.nombre === e.nombre ? undefined : { esperado: e.nombre, publicado: r.json.liga?.nombre ?? null })
    prueba(`id-sin-cambios:${e.ligaId}`, r.json.liga?.id === e.ligaId)
    prueba(`equipos-y-partidos-presentes:${e.ligaId}`, Array.isArray(r.json.equipos) && r.json.equipos.length > 0 && Array.isArray(r.json.partidos))
  }
  return { ok: c.every((x) => x.ok), comprobaciones: c }
}

/**
 * Verificación de RAMAS: solo GET públicos, sin credenciales. La lectura pública de cada liga debe traer, para cada equipo del archivo, exactamente la rama indicada
 * (los demás equipos de la liga no se tocan ni se afirma nada de ellos). → { ok, comprobaciones:[{ codigo, ok, detalle? }] }
 */
export async function verificarRamas({ ramas = [], fetch: fCrudo, origen: origenCrudo, remoto = false, entorno = {}, tiempoMs }) {
  const destino = validarDestino(origenCrudo, { remoto: remoto === true })
  if (destino.error) return { ok: false, comprobaciones: [{ codigo: destino.error, ok: false }] }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { ok: false, comprobaciones: [{ codigo: bloqueo, ok: false }] }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { ok: false, comprobaciones: [{ codigo: 'tiempo-invalido', ok: false }] }
  const plan = await construirPlanRamas({ ramas })
  if (!plan.ok) return { ok: false, comprobaciones: [{ codigo: 'archivos-invalidos', ok: false, detalle: plan.problemas }] }
  const f = crearTransporte({ fetch: fCrudo, destino, tiempoMs: t })
  const c = []
  const prueba = (codigo, ok, detalle) => c.push(detalle === undefined ? { codigo, ok } : { codigo, ok, detalle })
  for (const e of plan.usadas) {
    let r
    try { const resp = await f(`${destino.origen}/v1/ligas/${e.ligaId}/publico`); r = { status: resp.status, json: await resp.json().catch(() => null) } } catch { r = { status: 0, json: null } }
    prueba(`lectura-publica:${e.ligaId}`, r.status === 200 && esObjeto(r.json), r.status)
    if (r.status !== 200 || !esObjeto(r.json) || !Array.isArray(r.json.equipos)) continue
    const publicadas = new Map(r.json.equipos.map((q) => [q.id, q.rama ?? null]))
    const defectos = e.normal.ramas.filter((x) => !publicadas.has(x.equipoId) || publicadas.get(x.equipoId) !== x.rama).map((x) => `${x.equipoId}:${publicadas.has(x.equipoId) ? publicadas.get(x.equipoId) : 'ausente'}≠${x.rama}`)
    prueba(`ramas:${e.ligaId}`, defectos.length === 0, defectos)
  }
  return { ok: c.every((x) => x.ok), comprobaciones: c }
}

// ---- Capturar la BASE y verificar la ORTOGRAFÍA de la sede (solo GET públicos) ---------------------------------------------------------------
// Los partidos corregidos pueden estar terminados: no se presume `programado`, `rev 0` ni 0-0. ANTES de aplicar, `capturarBaseOrtografia` guarda la lectura pública de la liga entera
// (la lista completa) y la lectura directa de cada partido nombrado; DESPUÉS, `verificarOrtografia` exige que lo ÚNICO que cambió sea `sede` en los partidos nombrados.
// Se compara TODO el contenido público (estado, rev, marcador, faltas, anotaciones, horarios, periodo, reloj, equipos, liga…); el único campo que se ignora es `servidorAhoraMs`
// (la hora del servidor que cada respuesta lleva). LÍMITE: si un partido de la liga cambia entre la captura y la verificación (p. ej. se juega), la comparación falla.
// SI LA VERIFICACIÓN CONTRA LA BASE ORIGINAL (anterior a la operación) FALLA: se CONSERVAN esa base, el cuerpo enviado y el diario; se INVESTIGA y se EXPLICA cada diferencia
// (el informe nombra los campos y partidos); NO se recaptura una base para presentar un «pasa» posterior como prueba de que la operación original cambió solo la sede. Una base
// nueva puede respaldar una comprobación POSTERIOR documentada aparte, pero no sustituye la evidencia original.
export const CAMPOS_VOLATILES_BASE = Object.freeze(['servidorAhoraMs'])
const MAX_BASE_BYTES = 240 * 1024 // cabe en el tope de lectura de archivos del CLI (256 KiB)
const sinVolatiles = (v) => (Array.isArray(v) ? v.map(sinVolatiles) : esObjeto(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !CAMPOS_VOLATILES_BASE.includes(k)).map(([k, x]) => [k, sinVolatiles(x)])) : v)
// Comparación independiente del orden de las claves.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : esObjeto(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)
const iguales = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
// Las claves de nivel superior (o de un partido) que difieren, para que el informe diga QUÉ cambió sin volcar contenido.
const clavesDistintas = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !iguales(a?.[k], b?.[k])).sort()
const conSede = (partido, sede) => ({ ...partido, sede })

async function leerJsonPublico(f, url) {
  try { const r = await f(url); return { status: r.status, json: await r.json().catch(() => null) } } catch { return { status: 0, json: null } }
}

function destinoYTransporte({ fetch: fCrudo, origen, remoto, entorno, tiempoMs }) {
  const destino = validarDestino(origen, { remoto: remoto === true })
  if (destino.error) return { error: destino.error }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { error: bloqueo }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { error: 'tiempo-invalido' }
  return { destino, f: crearTransporte({ fetch: fCrudo, destino, tiempoMs: t }) }
}

/**
 * Captura la BASE de cada liga del plan: la lista pública completa y la lectura directa de los partidos nombrados. Solo GET, sin credenciales.
 * Acepta la sede anterior O la nueva (una corrección ya aplicada a medias o repetida); rechaza un partido en juego o con otra sede.
 * → { ok, comprobaciones, bases: { [ligaId]: { version: 1, ligaId, lista, directos: { [id]: {...} } } } }. Solo contenido que ya es público.
 */
export async function capturarBaseOrtografia({ ortografias = [], fetch: fCrudo, origen, remoto = false, entorno = {}, tiempoMs }) {
  const t = destinoYTransporte({ fetch: fCrudo, origen, remoto, entorno, tiempoMs })
  if (t.error) return { ok: false, comprobaciones: [{ codigo: t.error, ok: false }], bases: {} }
  const plan = await construirPlanOrtografia({ ortografias })
  if (!plan.ok) return { ok: false, comprobaciones: [{ codigo: 'archivos-invalidos', ok: false, detalle: plan.problemas }], bases: {} }
  const c = []
  const bases = {}
  for (const e of plan.usadas) {
    const r = await leerJsonPublico(t.f, `${t.destino.origen}/v1/ligas/${e.ligaId}/publico`)
    const partidos = Array.isArray(r.json?.partidos) ? r.json.partidos : null
    c.push({ codigo: `lectura-publica:${e.ligaId}`, ok: r.status === 200 && partidos !== null, detalle: r.status })
    if (r.status !== 200 || partidos === null) continue
    const porId = new Map(partidos.map((p) => [p.gameId, p]))
    const directos = {}
    const defectos = []
    for (const id of e.normal.partidos) {
      if (!porId.has(id)) { defectos.push(`${id}:ausente-de-la-lista`); continue }
      const d = await leerJsonPublico(t.f, `${t.destino.origen}/v1/ligas/${e.ligaId}/partidos/${id}`)
      if (d.status !== 200 || !esObjeto(d.json)) { defectos.push(`${id}:lectura-directa`); continue }
      directos[id] = sinVolatiles(d.json)
      const estado = porId.get(id).estado
      if (estado !== 'programado' && estado !== 'final') defectos.push(`${id}:estado-${estado}`) // un partido en juego (u otro) no se corrige
      if (![e.normal.sedeAnterior, e.normal.sede].includes(porId.get(id).sede)) defectos.push(`${id}:sede-no-es-la-anterior-ni-la-nueva`)
      if (![e.normal.sedeAnterior, e.normal.sede].includes(d.json.sede)) defectos.push(`${id}:lectura-directa-con-otra-sede`)
    }
    c.push({ codigo: `partidos-corregibles:${e.ligaId}`, ok: defectos.length === 0, detalle: defectos })
    c.push({ codigo: `sin-campos-privados:${e.ligaId}`, ok: hallar(r.json).length === 0 && Object.values(directos).every((d) => hallar(d).length === 0) })
    const base = { version: 1, ligaId: e.ligaId, lista: sinVolatiles(r.json), directos }
    const cabe = bytes(JSON.stringify(base, null, 2)) <= MAX_BASE_BYTES
    c.push({ codigo: `base-cabe-en-un-archivo:${e.ligaId}`, ok: cabe })
    if (cabe) bases[e.ligaId] = base
  }
  const ok = c.length > 0 && c.every((x) => x.ok)
  return { ok, comprobaciones: c, bases: ok ? bases : {} }
}

/**
 * Verifica la ORTOGRAFÍA aplicada contra la BASE capturada antes: los partidos nombrados muestran exactamente la sede nueva en la lista Y en su lectura directa; todo lo demás
 * (cada otro dato público de la liga y de esos partidos, incluida la sede de los NO nombrados) es idéntico a la base. `servidorAhoraMs` es lo único que no se compara.
 * `bases`: [{ ligaId, texto }] (el archivo de la base de cada liga). → { ok, comprobaciones }
 */
export async function verificarOrtografia({ ortografias = [], bases = [], fetch: fCrudo, origen, remoto = false, entorno = {}, tiempoMs }) {
  const t = destinoYTransporte({ fetch: fCrudo, origen, remoto, entorno, tiempoMs })
  if (t.error) return { ok: false, comprobaciones: [{ codigo: t.error, ok: false }] }
  const plan = await construirPlanOrtografia({ ortografias })
  if (!plan.ok) return { ok: false, comprobaciones: [{ codigo: 'archivos-invalidos', ok: false, detalle: plan.problemas }] }
  const c = []
  const prueba = (codigo, ok, detalle) => c.push(detalle === undefined ? { codigo, ok } : { codigo, ok, detalle })
  for (const e of plan.usadas) {
    const archivo = bases.find((b) => b.ligaId === e.ligaId)
    let base = null
    try { base = archivo ? JSON.parse(archivo.texto) : null } catch { base = null }
    const baseValida = esObjeto(base) && base.version === 1 && base.ligaId === e.ligaId && esObjeto(base.lista) && Array.isArray(base.lista.partidos) && esObjeto(base.directos)
    prueba(`base-valida:${e.ligaId}`, baseValida)
    if (!baseValida) continue
    const r = await leerJsonPublico(t.f, `${t.destino.origen}/v1/ligas/${e.ligaId}/publico`)
    prueba(`lectura-publica:${e.ligaId}`, r.status === 200 && Array.isArray(r.json?.partidos), r.status)
    if (r.status !== 200 || !Array.isArray(r.json?.partidos)) continue
    const nombrados = new Set(e.normal.partidos)
    const ahora = sinVolatiles(r.json)
    const defectos = []
    const idsBase = new Set(base.lista.partidos.map((p) => p.gameId))
    for (const id of nombrados) if (!idsBase.has(id)) defectos.push(`${id}:no-estaba-en-la-base`)
    for (const p of base.lista.partidos) if (nombrados.has(p.gameId) && ![e.normal.sedeAnterior, e.normal.sede].includes(p.sede)) defectos.push(`${p.gameId}:base-con-otra-sede`)
    const esperada = { ...base.lista, partidos: base.lista.partidos.map((p) => (nombrados.has(p.gameId) ? conSede(p, e.normal.sede) : p)) }
    if (!iguales(ahora, esperada)) {
      defectos.push(`liga:${clavesDistintas(ahora, esperada).join('+') || 'distinta'}`)
      if (Array.isArray(ahora.partidos)) {
        const antes = new Map(esperada.partidos.map((p) => [p.gameId, p]))
        if (ahora.partidos.length !== esperada.partidos.length) defectos.push(`cantidad:${esperada.partidos.length}→${ahora.partidos.length}`)
        for (const p of ahora.partidos) {
          const q = antes.get(p.gameId)
          if (!q) defectos.push(`${p.gameId}:no-estaba-en-la-base`)
          else if (!iguales(p, q)) defectos.push(`${p.gameId}:${clavesDistintas(p, q).join('+')}`)
        }
        for (const id of antes.keys()) if (!ahora.partidos.some((p) => p.gameId === id)) defectos.push(`${id}:ausente`)
      }
    }
    prueba(`lista-contra-base:${e.ligaId}`, defectos.length === 0, defectos)
    const directos = []
    for (const id of e.normal.partidos) {
      if (!esObjeto(base.directos[id])) { directos.push(`${id}:sin-base-directa`); continue }
      const d = await leerJsonPublico(t.f, `${t.destino.origen}/v1/ligas/${e.ligaId}/partidos/${id}`)
      if (d.status !== 200 || !esObjeto(d.json)) { directos.push(`${id}:lectura-directa`); continue }
      const dahora = sinVolatiles(d.json)
      const desperado = conSede(base.directos[id], e.normal.sede)
      if (!iguales(dahora, desperado)) directos.push(`${id}:${clavesDistintas(dahora, desperado).join('+') || 'distinto'}`)
      if (hallar(d.json).length) directos.push(`${id}:campos-privados`)
    }
    prueba(`lectura-directa-contra-base:${e.ligaId}`, directos.length === 0, directos)
    prueba(`sin-campos-privados:${e.ligaId}`, hallar(r.json).length === 0)
  }
  return { ok: c.length > 0 && c.every((x) => x.ok), comprobaciones: c }
}
