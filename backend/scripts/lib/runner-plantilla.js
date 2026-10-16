// JSON con claves ordenadas, solo para huellas internas del ejecutor. Es propio (no se importa el del motor) porque este módulo
// debe correr tal cual en Node, y el motor usa importaciones sin extensión que solo resuelve el empaquetador.
function canonico(valor) {
  if (valor === null) return 'null'
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
  if (typeof valor === 'object') return `{${Object.keys(valor).filter((k) => valor[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`
  return JSON.stringify(valor)
}

// ---------------------------------------------------------------------------
// Ejecutor LOCAL de plantillas (operador): consume un paquete de preparación REVISADO más un mapeo explícito y llama a la
// API de plantilla del organizador que ya existe. Sin dependencias de Node (solo fetch y crypto.subtle), para poder
// probarlo dentro del runtime del backend; el envoltorio de línea de comandos es runner-plantilla.mjs.
//
//   construirPlan   OFFLINE. Valida TODO y contabiliza listas / retenidas / excluidas. Es lo que hace el modo por defecto
//                   (simulacro): cero peticiones, cero escrituras.
//   aplicar         Escribe, una operación a la vez, a través de POST …/equipos/{e}/jugadores (el contrato del organizador:
//                   sesión por cookie, Origin exacto y X-Sebel-Peticion). Diario ANTES de enviar; operaciones idempotentes.
//   verificar       Lecturas (organizador y público) contra el diario: fichas, números, alias y privacidad.
//
// REGLAS (ver README del backend):
//   - Solo filas `ready`. Cada fila retenida o excluida se contabiliza; el total debe cuadrar con el paquete.
//   - NINGUNA decisión de identidad se toma sola: cada fila exige en el mapeo su `resolucionIdentidad` explícita. No se
//     deduce "persona nueva" de que una búsqueda por nombre no encuentre candidatos. Sin decisión → no se aplica NADA.
//   - El identificador de operación sale del contenido estable (liga + equipo destino + referencia de origen), nunca de la
//     hora, del orden de ejecución ni del número. Un reintento reenvía el MISMO cuerpo con el MISMO identificador.
//   - Un resultado incierto sigue sin resolver: solo se reintenta lo idéntico. Nunca se crea un identificador de reemplazo.
//   - Nada de secretos en el diario, la salida ni el plan: el código del organizador y la cookie viven solo en memoria.
// ---------------------------------------------------------------------------

import { bloqueoDeEntorno, crearTransporte, tiempoValido, validarDestino, validarOrigenLocal } from './transporte.js'

export const MAX_OPERACIONES = 500
export const MAX_BYTES_DIARIO = 2 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const REF = /^[A-Za-z0-9_#./-]{1,120}$/
const TIPOS_IDENTIDAD = ['otra-persona', 'misma-persona', 'misma-persona-otra-liga']

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (texto) => aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
const textoNoVacio = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 200

// --- Plan (offline) -------------------------------------------------------------------------------------------------

function validarResolucion(r) {
  if (!esObjeto(r) || !TIPOS_IDENTIDAD.includes(r.tipo)) return false
  const claves = Object.keys(r)
  if (r.tipo === 'otra-persona') return claves.length === 1
  if (r.tipo === 'misma-persona') return claves.length === 2 && ID.test(r.personaId ?? '')
  return claves.length === 4 && ID.test(r.personaId ?? '') && ID.test(r.ligaOrigenId ?? '') && ID.test(r.fichaOrigenId ?? '')
}

/**
 * paqueteTexto: el contenido EXACTO de paquete.json. mapeo: objeto (ver README). → un plan SIN secretos y SIN nombres en sus
 * resúmenes; `operaciones` lleva los cuerpos exactos (privados) que luego van al diario.
 */
export async function construirPlan({ paqueteTexto, mapeo }) {
  const problemas = []
  const problema = (codigo, ref = null) => { if (problemas.length < 200) problemas.push(ref ? { codigo, ref } : { codigo }) }
  let paquete = null
  try { paquete = JSON.parse(paqueteTexto) } catch { problema('paquete-ilegible') }
  const paqueteSha256 = await sha256Hex(paqueteTexto)
  if (!esObjeto(mapeo) || mapeo.version !== 1) problema('mapeo-invalido')
  else if (mapeo.paqueteSha256 !== paqueteSha256) problema('paquete-no-coincide-con-el-mapeo')
  if (!paquete || !esObjeto(mapeo) || !Array.isArray(paquete.teams)) return resultado()

  const ligas = esObjeto(mapeo.ligas) ? mapeo.ligas : (problema('mapeo-sin-ligas'), {})
  const identidades = esObjeto(mapeo.identidades) ? mapeo.identidades : (problema('mapeo-sin-identidades'), {})
  const contabilidad = { equipos: [], listas: 0, retenidas: 0, excluidas: 0, filasDelPaquete: 0 }
  const operaciones = []
  const referencias = new Set()
  const destinos = new Set()
  // Tope ANTES de mirar fila por fila: un paquete desmedido no se procesa.
  if (paquete.teams.reduce((n, t) => n + (Array.isArray(t.rows) ? t.rows.filter((r) => r?.status === 'ready').length : 0), 0) > MAX_OPERACIONES) {
    problema('demasiadas-operaciones')
    return resultado()
  }

  for (const t of paquete.teams) {
    const filas = Array.isArray(t.rows) ? t.rows : []
    const excluidas = Array.isArray(t.excluded_rows) ? t.excluded_rows : []
    const listas = filas.filter((r) => r.status === 'ready')
    const retenidas = filas.filter((r) => r.status === 'held')
    if (listas.length + retenidas.length !== filas.length) problema('estado-de-fila-desconocido', t.team_key)
    const declaradas = t.counts?.candidates ?? t.counts?.source_rows
    if (typeof declaradas === 'number' && declaradas !== filas.length) problema('conteo-del-equipo-no-cuadra', t.team_key)
    const resumen = { team_key: t.team_key, listas: listas.length, retenidas: retenidas.length, excluidas: excluidas.length, aplicables: 0 }
    contabilidad.equipos.push(resumen)
    contabilidad.listas += listas.length
    contabilidad.retenidas += retenidas.length
    contabilidad.excluidas += excluidas.length
    contabilidad.filasDelPaquete += filas.length + excluidas.length
    if (!listas.length) continue

    const liga = ligas[listas[0].league]
    const equipoId = liga?.equipos?.[t.team_key]
    if (!esObjeto(liga) || !ID.test(liga.ligaId ?? '')) { problema('liga-sin-mapeo', t.team_key); continue }
    if (typeof equipoId !== 'string' || !ID.test(equipoId)) { problema('equipo-sin-mapeo', t.team_key); continue }
    if (destinos.has(`${liga.ligaId}/${equipoId}`)) problema('equipo-destino-repetido', t.team_key)
    destinos.add(`${liga.ligaId}/${equipoId}`)
    const dorsales = new Set()
    for (const f of listas) {
      const ref = f.source_ref
      if (typeof ref !== 'string' || !REF.test(ref)) { problema('referencia-invalida', t.team_key); continue }
      if (referencias.has(ref)) { problema('referencia-duplicada', ref); continue }
      referencias.add(ref)
      if (f.league !== listas[0].league) problema('liga-mezclada-en-un-equipo', ref)
      if (!textoNoVacio(f.first_name) || !textoNoVacio(f.surname)) problema('nombre-o-apellido-ausente', ref)
      if (!Number.isInteger(f.jersey) || f.jersey < 0 || f.jersey > 99) problema('numero-invalido', ref)
      else if (dorsales.has(f.jersey)) problema('numero-repetido-en-el-equipo', ref)
      else dorsales.add(f.jersey)
      if (f.shirt_name !== undefined && f.shirt_name !== null && !textoNoVacio(f.shirt_name)) problema('alias-invalido', ref)
      const resolucion = identidades[ref]
      if (resolucion === undefined) { problema('falta-decision-de-identidad', ref); continue }
      if (!validarResolucion(resolucion)) { problema('decision-de-identidad-invalida', ref); continue }
      const campos = { nombrePila: f.first_name, apellido1: f.surname, dorsal: f.jersey }
      // El alias se guarda como nombre en camiseta, sin tocar nombre ni apellido (no se pierde ni se funde con ellos).
      if (typeof f.shirt_name === 'string') campos.nombreCamiseta = f.shirt_name
      const operacionId = `op-${(await sha256Hex(canonico({ v: 1, tipo: 'alta', ligaId: liga.ligaId, equipoId, ref }))).slice(0, 40)}`
      operaciones.push({
        operacionId, sourceRef: ref, ligaId: liga.ligaId, equipoId, equipoClave: t.team_key, equipoNombre: t.team_display_name,
        ruta: `/v1/organizador/ligas/${liga.ligaId}/equipos/${equipoId}/jugadores`,
        cuerpo: JSON.stringify({ operacionId, campos, resolucionIdentidad: resolucion }),
        alias: typeof f.shirt_name === 'string',
      })
      resumen.aplicables += 1
    }
  }
  // Decisiones sobrantes: una decisión que no corresponde a ninguna fila lista casi seguro es un error de mapeo.
  for (const ref of Object.keys(identidades)) if (!referencias.has(ref)) problema('decision-sin-fila-lista', ref)
  if (operaciones.length > MAX_OPERACIONES) problema('demasiadas-operaciones')
  if (esObjeto(paquete.totals) && paquete.totals.ready !== contabilidad.listas) problema('totales-del-paquete-no-cuadran')
  return resultado()

  async function resultado() {
    const ok = problemas.length === 0
    const huella = ok ? await sha256Hex(canonico({ paqueteSha256, ops: operaciones.map((o) => [o.operacionId, o.ruta, o.cuerpo]) })) : null
    return { ok, problemas, contabilidad, operaciones: ok ? operaciones : [], paqueteSha256, huella }
  }
}

/** Resumen SIN nombres, apto para pantalla e informes. */
export function resumenDelPlan(plan) {
  return {
    ok: plan.ok,
    paqueteSha256: plan.paqueteSha256,
    huellaDelPlan: plan.huella,
    listas: plan.contabilidad?.listas ?? 0,
    retenidas: plan.contabilidad?.retenidas ?? 0,
    excluidas: plan.contabilidad?.excluidas ?? 0,
    operaciones: plan.operaciones.length,
    conAlias: plan.operaciones.filter((o) => o.alias).length,
    equipos: plan.contabilidad?.equipos ?? [],
    problemas: plan.problemas,
  }
}

// --- Destino: loopback por omisión; remoto solo con opt-in y origen exacto -------------------------------------------------------------------------------

// El validador local vive en transporte.js (compartido con la herramienta del operador); aquí se reexporta con el mismo comportamiento.
export { validarOrigenLocal }

/** Destino de las operaciones: loopback por omisión; remoto solo con opt-in explícito y el origen exacto aprobado (ver transporte.js). */
function prepararDestino({ origen, accesoOrigen, remoto, entorno, tiempoMs, fetch: f }) {
  const destino = validarDestino(origen, { remoto: remoto === true })
  if (destino.error) return { estado: destino.error }
  const bloqueo = bloqueoDeEntorno(entorno, destino)
  if (bloqueo) return { estado: bloqueo }
  if (destino.remoto && accesoOrigen !== destino.origen) return { estado: 'acceso-origen-distinto-del-destino' }
  const t = tiempoValido(tiempoMs)
  if (t === null) return { estado: 'tiempo-invalido' }
  return { destino, fetch: crearTransporte({ fetch: f, destino, tiempoMs: t }) }
}

// --- Diario ---------------------------------------------------------------------------------------------------------------
// almacen: { leer(): Promise<string|null>, escribir(texto): Promise<void> }. El diario nunca contiene secretos.

export function diarioNuevo(plan, destino) {
  return {
    version: 1,
    huellaDelPlan: plan.huella,
    paqueteSha256: plan.paqueteSha256,
    destino: { origen: destino.origen, ligas: [...new Set(plan.operaciones.map((o) => o.ligaId))].sort() },
    ops: plan.operaciones.map((o) => ({
      operacionId: o.operacionId, sourceRef: o.sourceRef, ligaId: o.ligaId, equipoId: o.equipoId, equipoClave: o.equipoClave,
      equipoNombre: o.equipoNombre, ruta: o.ruta, cuerpo: o.cuerpo, estado: 'pendiente', resultado: null,
    })),
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
  if (!esObjeto(d) || d.version !== 1 || !Array.isArray(d.ops)) throw new Error('diario-invalido')
  return d
}

// --- HTTP ---------------------------------------------------------------------------------------------------------------

function cliente({ fetch: f, origen, accesoOrigen, cookie }) {
  const pedir = async (metodo, ruta, cuerpo) => {
    const cabeceras = { cookie: `__Host-sesion=${cookie}` }
    if (metodo !== 'GET') Object.assign(cabeceras, { origin: accesoOrigen, 'x-sebel-peticion': '1', 'content-type': 'application/json' })
    const r = await f(`${origen}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo })
    let json = null
    try { json = await r.json() } catch { /* sin cuerpo JSON */ }
    return { status: r.status, json }
  }
  return { pedir }
}

async function iniciarSesion({ fetch: f, origen, accesoOrigen, codigo }) {
  const r = await f(`${origen}/v1/acceso/organizador`, {
    method: 'POST', headers: { origin: accesoOrigen, 'x-sebel-peticion': '1', 'content-type': 'application/json' }, body: JSON.stringify({ codigo }),
  })
  const m = /^__Host-sesion=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')
  return r.status === 200 && m ? m[1] : null
}

// --- Aplicar --------------------------------------------------------------------------------------------------------------

/**
 * opciones: { plan, almacen, fetch, origen, accesoOrigen, codigo, alProgreso? }
 * Orden: (1) el plan debe ser válido; (2) el destino debe ser local (o el origen remoto aprobado con opt-in explícito, TLS normal, sin redirecciones y con tiempo máximo); (3) sesión y lecturas de comprobación (equipos y
 * posesión de las ligas); (4) el diario completo se guarda ANTES de enviar nada; (5) antes de CADA envío se guarda que está
 * "enviando" (si no se puede guardar, no se envía); (6) tras cada respuesta se guarda el resultado.
 * Se detiene en el primer rechazo, conflicto o resultado incierto. → { estado, ... } sin secretos ni nombres.
 */
export async function aplicar({ plan, almacen, fetch: fCrudo, origen: origenCrudo, accesoOrigen, codigo, alProgreso = () => {}, remoto = false, entorno = {}, tiempoMs }) {
  if (!plan.ok) return { estado: 'plan-invalido', problemas: plan.problemas }
  const prep = prepararDestino({ origen: origenCrudo, accesoOrigen, remoto, entorno, tiempoMs, fetch: fCrudo })
  if (prep.estado) return { estado: prep.estado }
  const { destino, fetch: f } = prep
  if (typeof accesoOrigen !== 'string' || !/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(accesoOrigen)) return { estado: 'acceso-origen-invalido' }
  if (typeof codigo !== 'string' || codigo.length < 8) return { estado: 'sin-credencial' }

  let diario
  try { diario = await leerDiario(almacen) } catch { return { estado: 'diario-ilegible' } }
  if (diario) {
    if (diario.huellaDelPlan !== plan.huella || diario.destino?.origen !== destino.origen) return { estado: 'diario-de-otro-plan' }
    // Un rechazo anterior no se rebasa solo: hay que resolverlo (a mano, con una decisión nueva) antes de seguir.
    if (diario.ops.some((o) => o.estado === 'rechazada')) return { estado: 'diario-con-rechazo', sourceRefs: diario.ops.filter((o) => o.estado === 'rechazada').map((o) => o.sourceRef) }
  }

  const cookie = await iniciarSesion({ fetch: f, origen: destino.origen, accesoOrigen, codigo }).catch(() => null)
  if (!cookie) return { estado: 'sesion-no-iniciada' }
  const http = cliente({ fetch: f, origen: destino.origen, accesoOrigen, cookie })

  // Comprobaciones de solo lectura antes de escribir: posesión de las ligas y existencia de los equipos destino.
  const yo = await http.pedir('GET', '/v1/organizador/yo').catch(() => ({ status: 0 }))
  if (yo.status !== 200) return { estado: 'sesion-no-valida' }
  for (const ligaId of new Set(plan.operaciones.map((o) => o.ligaId))) {
    if (!yo.json.ligas.includes(ligaId)) return { estado: 'liga-no-poseida', ligaId }
    const l = await http.pedir('GET', `/v1/organizador/ligas/${ligaId}`).catch(() => ({ status: 0 }))
    if (l.status !== 200) return { estado: 'liga-no-legible', ligaId }
    const ids = new Set(l.json.equipos.map((e) => e.id))
    for (const o of plan.operaciones.filter((x) => x.ligaId === ligaId)) if (!ids.has(o.equipoId)) return { estado: 'equipo-destino-inexistente', ligaId, equipoId: o.equipoId }
  }

  if (!diario) {
    diario = diarioNuevo(plan, destino)
    try { await guardar(almacen, diario) } catch { return { estado: 'diario-no-guardado' } } // sin diario recuperable, no se envía nada
  }

  // Lo que quedó sin resolver en una ejecución anterior se reintenta PRIMERO, idéntico, antes de cualquier operación nueva.
  const sinResolver = diario.ops.filter((o) => o.estado === 'enviando' || o.estado === 'incierta')
  const pendientes = diario.ops.filter((o) => o.estado === 'pendiente')
  const cuenta = { aplicadas: 0, reproducidas: 0 }
  for (const op of [...sinResolver, ...pendientes]) {
    const reintento = op.estado !== 'pendiente'
    op.estado = 'enviando'
    try { await guardar(almacen, diario) } catch { op.estado = reintento ? 'incierta' : 'pendiente'; return { estado: 'diario-no-guardado', ...cuenta } }
    let r
    try { r = await http.pedir('POST', op.ruta, op.cuerpo) } catch { r = { status: 0, json: null } }
    const j = r.json
    if (r.status === 200 && j?.operacionId === op.operacionId && j.resultado === 'aplicado') {
      op.estado = 'aplicada'
      op.resultado = { fichaId: j.ficha?.id ?? null, personaId: j.ficha?.personaId ?? null, rev: j.ficha?.rev ?? null, reproducido: j.reproducido === true }
      if (j.reproducido === true) cuenta.reproducidas += 1
      else cuenta.aplicadas += 1
    } else if (r.status === 200 && j?.operacionId === op.operacionId && j.resultado === 'rechazado') {
      op.estado = 'rechazada'
      op.resultado = { motivo: String(j.tipo ?? 'desconocido') }
    } else if (r.status === 409 || r.status === 422 || r.status === 404) {
      op.estado = 'rechazada'
      op.resultado = { motivo: `http-${r.status}` }
    } else {
      // 0 (red), 401, 403, 429, 5xx, cuerpo inesperado: no se sabe si se aplicó. Sigue sin resolver; se reintenta lo idéntico.
      op.estado = 'incierta'
      op.resultado = { motivo: `http-${r.status}` }
    }
    try { await guardar(almacen, diario) } catch { return { estado: 'diario-no-guardado', operacionId: op.operacionId, ...cuenta } }
    alProgreso({ operacionId: op.operacionId, estado: op.estado })
    if (op.estado === 'rechazada') return { estado: 'detenido-por-rechazo', operacionId: op.operacionId, sourceRef: op.sourceRef, motivo: op.resultado.motivo, ...cuenta }
    if (op.estado === 'incierta') return { estado: 'detenido-sin-resolver', operacionId: op.operacionId, sourceRef: op.sourceRef, motivo: op.resultado.motivo, ...cuenta }
  }
  return { estado: 'completo', total: diario.ops.length, ...cuenta }
}

// --- Verificar ------------------------------------------------------------------------------------------------------------

// Claves que NUNCA deben aparecer en una lectura pública (en ningún nivel).
const CLAVES_PRIVADAS = ['personaId', 'fechaNacimiento', 'codigo', 'nombreCamiseta', 'nombrePila', 'apellido1', 'apellido2', 'fichaId', 'documento', 'contacto', 'tokenHash', 'token', 'credenciales', 'operacionId', 'organizadorId']
const buscarClaves = (valor, prohibidas, ruta = '') => {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => buscarClaves(v, prohibidas, `${ruta}[${i}]`))
  if (!esObjeto(valor)) return []
  return Object.entries(valor).flatMap(([k, v]) => [...(prohibidas.includes(k) ? [`${ruta}.${k}`] : []), ...buscarClaves(v, prohibidas, `${ruta}.${k}`)])
}
const norm = (n) => String(n ?? '').trim().toLowerCase()

/**
 * Compara el diario con lo que el servidor muestra AHORA. No se limita a contar: cada ficha del diario (por el identificador
 * que el servidor acuñó, guardado en el diario) debe existir con el nombre, apellido, número y alias esperados.
 * → { ok, comprobaciones:[{ codigo, ok, detalle? }] } sin secretos ni nombres.
 */
export async function verificar({ plan, almacen, fetch: fCrudo, origen: origenCrudo, accesoOrigen, codigo, remoto = false, entorno = {}, tiempoMs }) {
  const prep = prepararDestino({ origen: origenCrudo, accesoOrigen, remoto, entorno, tiempoMs, fetch: fCrudo })
  if (prep.estado) return { ok: false, comprobaciones: [{ codigo: prep.estado, ok: false }] }
  const { destino, fetch: f } = prep
  const diario = await leerDiario(almacen).catch(() => null)
  if (!diario) return { ok: false, comprobaciones: [{ codigo: 'diario-ausente', ok: false }] }
  const cookie = await iniciarSesion({ fetch: f, origen: destino.origen, accesoOrigen, codigo }).catch(() => null)
  if (!cookie) return { ok: false, comprobaciones: [{ codigo: 'sesion-no-iniciada', ok: false }] }
  const http = cliente({ fetch: f, origen: destino.origen, accesoOrigen, cookie })
  const publico = async (ruta) => { const r = await f(`${destino.origen}${ruta}`).catch(() => null); return r ? { status: r.status, json: await r.json().catch(() => null) } : { status: 0, json: null } }
  const c = []
  const prueba = (codigoC, ok, detalle) => c.push(detalle === undefined ? { codigo: codigoC, ok } : { codigo: codigoC, ok, detalle })

  prueba('diario-coincide-con-el-plan', diario.huellaDelPlan === plan.huella)
  prueba('todas-las-operaciones-aplicadas', diario.ops.every((o) => o.estado === 'aplicada'), diario.ops.filter((o) => o.estado !== 'aplicada').map((o) => o.sourceRef))
  const aplicadas = diario.ops.filter((o) => o.estado === 'aplicada')
  prueba('identificadores-acunados-en-el-diario', aplicadas.every((o) => o.resultado?.fichaId && o.resultado?.personaId))

  const porEquipo = new Map()
  for (const o of plan.operaciones) {
    const k = `${o.ligaId}/${o.equipoId}`
    if (!porEquipo.has(k)) porEquipo.set(k, { ligaId: o.ligaId, equipoId: o.equipoId, equipoNombre: o.equipoNombre, ops: [] })
    porEquipo.get(k).ops.push(o)
  }
  const diarioDe = new Map(diario.ops.map((o) => [o.operacionId, o]))
  const ligasVistas = new Set()
  for (const { ligaId, equipoId, equipoNombre, ops } of porEquipo.values()) {
    const etiqueta = `${ligaId}/${equipoId}`
    if (!ligasVistas.has(ligaId)) {
      ligasVistas.add(ligaId)
      const l = await http.pedir('GET', `/v1/organizador/ligas/${ligaId}`)
      prueba(`liga-legible:${ligaId}`, l.status === 200)
      const e = l.json?.equipos?.find((x) => x.id === equipoId)
      prueba(`nombre-del-equipo:${etiqueta}`, !!e && norm(e.nombre) === norm(equipoNombre))
    }
    const r = await http.pedir('GET', `/v1/organizador/ligas/${ligaId}/equipos/${equipoId}/jugadores`)
    if (r.status !== 200) { prueba(`plantilla-legible:${etiqueta}`, false); continue }
    const activos = r.json.activos
    const porFicha = new Map(activos.map((a) => [a.id, a]))
    // Cuenta Y contenido: nunca solo el recuento.
    prueba(`cantidad-activos:${etiqueta}`, activos.length === ops.length, { esperado: ops.length, real: activos.length })
    const dorsales = activos.map((a) => a.dorsal)
    prueba(`numeros-unicos:${etiqueta}`, new Set(dorsales).size === dorsales.length)
    const defectos = []
    for (const o of ops) {
      const cuerpo = JSON.parse(o.cuerpo)
      const reg = diarioDe.get(o.operacionId)
      const ficha = reg?.resultado?.fichaId ? porFicha.get(reg.resultado.fichaId) : null
      const k = cuerpo.campos
      const bien = ficha && ficha.nombrePila === k.nombrePila && ficha.apellido1 === k.apellido1 && ficha.dorsal === k.dorsal
        && (ficha.nombreCamiseta || null) === (k.nombreCamiseta ?? null) && ficha.personaId === reg.resultado.personaId && ficha.activo === true
      if (!bien) defectos.push(o.sourceRef)
    }
    prueba(`fichas-del-diario-coinciden:${etiqueta}`, defectos.length === 0, defectos)
    prueba(`sin-fecha-de-nacimiento:${etiqueta}`, activos.every((a) => a.fechaNacimiento === null || a.fechaNacimiento === undefined))
  }

  for (const ligaId of ligasVistas) {
    const p = await publico(`/v1/ligas/${ligaId}/publico`)
    prueba(`publico-liga-200:${ligaId}`, p.status === 200)
    prueba(`publico-liga-sin-campos-privados:${ligaId}`, buscarClaves(p.json, CLAVES_PRIVADAS).length === 0)
    prueba(`publico-partidos-validos:${ligaId}`, p.status === 200 && Array.isArray(p.json?.partidos) && p.json.partidos.every((g) => Number.isInteger(g.local?.puntos) && Number.isInteger(g.visita?.puntos) && typeof g.estado === 'string'),
      p.json?.partidos ? { partidos: p.json.partidos.length, estados: [...new Set(p.json.partidos.map((g) => g.estado))] } : undefined)
  }
  for (const { ligaId, equipoId, ops } of porEquipo.values()) {
    const etiqueta = `${ligaId}/${equipoId}`
    const p = await publico(`/v1/ligas/${ligaId}/equipos/${equipoId}/publico`)
    prueba(`publico-equipo-200:${etiqueta}`, p.status === 200)
    if (p.status !== 200) continue
    prueba(`publico-equipo-sin-campos-privados:${etiqueta}`, buscarClaves(p.json, CLAVES_PRIVADAS).length === 0)
    const esperado = ops.map((o) => `${JSON.parse(o.cuerpo).campos.dorsal}`).sort()
    const real = p.json.plantilla.map((j) => `${j.dorsalActual}`).sort()
    prueba(`publico-plantilla-numeros:${etiqueta}`, JSON.stringify(esperado) === JSON.stringify(real))
  }
  return { ok: c.every((x) => x.ok), comprobaciones: c }
}
