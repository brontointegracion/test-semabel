// Comprobación en un navegador REAL (Chrome con perfil desechable) del controlador de la sesión de puntuación (REPORT_125):
// propiedad por Web Lock entre dos pestañas, cierre ordenado, comando en vuelo con la pestaña cerrada, recarga sin conexión con
// compuertas del reloj, reconexión, paradas persistidas y cierre sin restos. Datos SINTÉTICOS, Worker local, sin Cloudflare.
//   - empaqueta cliente-controlador.js con esbuild en un directorio TEMPORAL y lo sirve como archivo estático (sin rutas de producción);
//   - levanta wrangler dev (HTTP en localhost: contexto seguro para Web Locks) con almacenamiento temporal y siembra una liga;
//   - maneja Chrome (perfil desechable, puerto de depuración propio) por DevTools;
//   - al terminar mata TODOS sus procesos y borra el perfil y el almacenamiento temporales. No toca otros Chrome.
// Uso (desde backend/):  node scripts/navegador-controlador.mjs
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const RAIZ = resolve(import.meta.dirname, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'controlador')
const PUERTO = 8798
const PUERTO_CDP = 9341
const ORIGEN = `http://localhost:${PUERTO}`
const SEMILLA = 'semilla-controlador-sintetica-01'
const LIGA = 'LIGACTL1'
const TOKEN = 'tok-sintetico-controlador-P-000001'
const DEVICE = 'tel-P'
const BD = `arnes-ctl-${Date.now().toString(36)}`
const CHROME = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync)
const NOMBRE_LOCK = `sebel-ctl-sesion:${LIGA}:P`
const NOMBRE_AVISO = `sebel-ctl-aviso:${LIGA}:P`

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(ESTADO, { recursive: true })
const DIST = join(ESTADO, 'dist')
const PERFIL = join(ESTADO, 'perfil-chrome')
mkdirSync(DIST, { recursive: true })
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const js = JSON.stringify

// --- 1. Empaquetado temporal ---
execFileSync(join(RAIZ, 'node_modules', '.bin', 'esbuild'), [join(RAIZ, 'scripts', 'cliente-controlador.js'), '--bundle', '--format=iife', '--platform=browser', `--outfile=${join(DIST, 'controlador.js')}`, '--log-level=error'], { stdio: 'inherit' })
writeFileSync(join(DIST, 'arnes.html'), '<!doctype html><meta charset="utf-8"><title>arnés del controlador</title><body>arnés temporal<script src="/controlador.js"></script></body>')

// --- 2. Procesos ---
const hijos = []
function lanzar(cmd, args, opciones = {}) {
  const p = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opciones })
  p.registro = ''
  p.stdout.on('data', (d) => { p.registro += d })
  p.stderr.on('data', (d) => { p.registro += d })
  hijos.push(p)
  return p
}
async function matar(p) {
  if (!p || p.exitCode !== null) return
  const fin = new Promise((r) => p.once('exit', r))
  try { process.kill(-p.pid, 'SIGTERM') } catch { /* ya terminó */ }
  await Promise.race([fin, espera(6000)])
  try { process.kill(-p.pid, 'SIGKILL') } catch { /* ya terminó */ }
}
const servidor = lanzar(join(RAIZ, 'node_modules', '.bin', 'wrangler'), [
  'dev', '--port', String(PUERTO), '--ip', '127.0.0.1', '--local-protocol', 'http', '--persist-to', join(ESTADO, 'persistencia'),
  '--assets', DIST, '--var', `LIGAS_ADMITIDAS:${LIGA}`, '--var', 'PERMITIR_SEMILLA:1', '--var', `SEMILLA_TOKEN:${SEMILLA}`,
], { cwd: RAIZ, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' } })

const api = (ruta, opciones = {}) => fetch(`${ORIGEN}${ruta}`, opciones)
const f = (id, equipoId, nombrePila, apellido1, dorsal, extra = {}) => ({ id, equipoId, nombrePila, apellido1, apellido2: '', dorsal, personaId: `persona-ctl-${id}`, ...extra })
const payload = {
  liga: { id: LIGA, nombre: 'Liga del controlador sintética', deporte: 'baloncesto', minutosPorPeriodo: 10 },
  equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }],
  jugadores: [f('J1', 'E1', 'Ana', 'Prueba', 5), f('J2', 'E1', 'Beto', 'Muestra', 7), f('J3', 'E2', 'Cora', 'Tres', 3), f('J4', 'E2', 'Hugo', 'Cuatro', 4)],
  partidos: [{ id: 'P', localId: 'E1', visitaId: 'E2', inicio: null }],
  credenciales: [{ token: TOKEN, partidoId: 'P', deviceId: DEVICE, actorId: 'actor-P' }],
}
/** Lo que el SERVIDOR tiene del partido (lectura protegida desde Node; credencial sintética). */
async function servidorEstado() {
  const r = await api(`/v1/ligas/${LIGA}/partidos/P/estado`, { headers: { authorization: `Bearer ${TOKEN}` } })
  assert.equal(r.status, 200, 'lectura de /estado del servidor')
  const c = await r.json()
  return { partido: c.estado.partido.estado, eventos: c.estado.eventos, puntos: c.estado.eventos.filter((e) => typeof e.puntos === 'number' && e.puntos > 0).length, cursor: c.cursor }
}

let chrome = null
const resultados = []
const pestanas = []
async function paso(nombre, fn) {
  try { const nota = await fn(); resultados.push({ nombre, ok: true, nota }) } catch (e) {
    let diag = ''
    try {
      diag = ` ⏎ diagnóstico: ${pestanas.filter((p) => p.viva).map((p) => `${p.nombre}=${js({ modo: p.ultimo?.modo, emisor: p.ultimo?.emisor?.fase, sesion: p.ultimo?.sesion?.inicio, consola: p.consola.slice(-2) })}`).join(' | ')}`.slice(0, 700)
    } catch { /* sin diagnóstico */ }
    resultados.push({ nombre, ok: false, nota: `${String(e.message ?? e).split('\n').slice(0, 5).join(' ⏎ ')}${diag}` })
  }
}

/** Una pestaña de Chrome manejada por DevTools (mismo perfil desechable = mismo navegador). */
async function conectar(destino, nombre) {
  const ws = new WebSocket(destino.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pendientes = new Map()
  const oyentes = []
  const t = { nombre, viva: true, ultimo: null, consola: [], peticiones: [], respuestas: [], destinoId: destino.id }
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && pendientes.has(m.id)) { const { ok, ko } = pendientes.get(m.id); pendientes.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') t.consola.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 200))
    if (m.method === 'Log.entryAdded') t.consola.push(`${m.params.entry.level}: ${m.params.entry.text}`.slice(0, 200))
    if (m.method === 'Network.requestWillBeSent') t.peticiones.push({ url: m.params.request.url, metodo: m.params.request.method, cuerpo: m.params.request.postData ?? null })
    if (m.method === 'Network.responseReceived') t.respuestas.push({ url: m.params.response.url, status: m.params.response.status })
    oyentes.slice().forEach((fn) => fn(m))
  }
  const enviar = (metodo, params = {}) => new Promise((ok, ko) => { id += 1; pendientes.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method: metodo, params })) })
  const evalu = async (expresion) => {
    const r = await enviar('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error de evaluación')
    return r.result.value
  }
  const hasta = async (expresion, ms = 10000, etiqueta = expresion) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { try { if (await evalu(expresion)) return true } catch { /* la página cambia */ } await espera(100) }
    throw new Error(`no se cumplió (${nombre}): ${etiqueta}`)
  }
  const cargada = () => new Promise((r) => { const fn = (m) => { if (m.method === 'Page.loadEventFired') { oyentes.splice(oyentes.indexOf(fn), 1); r() } }; oyentes.push(fn) })
  const navegar = async (ruta) => { const c = cargada(); await enviar('Page.navigate', { url: `${ORIGEN}${ruta}` }); await c }
  const recargar = async () => { const c = cargada(); await enviar('Page.reload'); await c }
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await enviar(`${d}.enable`)
  const h = (expr) => evalu(`(async () => { const r = await ${expr}; return r })()`)
  const api_ = {
    ...t, ws, enviar, evalu, hasta, navegar, recargar, oyentes, h,
    v1: () => t.peticiones.filter((p) => p.url.includes('/v1/')),
    post: () => t.peticiones.filter((p) => p.metodo === 'POST' && p.url.endsWith('/comandos')),
    estado: async () => { const e = await evalu('window.__h.estado()'); t.ultimo = e; return e },
    cerrarDestino: async () => { t.viva = false; try { ws.close() } catch { /* nada */ } await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${destino.id}`).catch(() => {}) },
  }
  Object.defineProperty(api_, 'consola', { get: () => t.consola })
  Object.defineProperty(api_, 'viva', { get: () => t.viva })
  Object.defineProperty(api_, 'ultimo', { get: () => t.ultimo })
  pestanas.push(api_)
  return api_
}

const abrirOpciones = (extra = {}) => ({ ligaId: LIGA, partidoId: 'P', token: TOKEN, deviceId: DEVICE, nombreBD: BD, ...extra })
async function nuevaPestana(nombre) {
  const p = await conectar(await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json(), nombre)
  await p.navegar('/arnes.html')
  await p.hasta('!!window.__h')
  const e = await p.evalu('window.__h.entorno()')
  assert.deepEqual([e.locks, e.canal, e.seguro], [true, true, true], `${nombre}: el navegador no ofrece Web Locks / BroadcastChannel en contexto seguro`)
  await p.enviar('Page.bringToFront')
  return p
}
const abrirCtl = (p, extra) => p.evalu(`window.__h.abrir(${js(abrirOpciones(extra))})`)
const esListo = "(() => { const e = window.__h.estado(); return e.listo })()"
const fueraDeLinea = (p, offline) => p.enviar('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
const orden = (tipo, datos, cmdId) => ({ tipo, datos, cmdId })
const sinToken = (texto) => !String(texto).includes(TOKEN)
let seq = 0
const cmdId = (p) => `${p}-ctl-${Date.now().toString(36)}-${++seq}`
const PUNTO = (jugadorId = 'J1', equipoId = 'E1') => orden('anotar', { equipoId, jugadorId, puntos: 2 }, cmdId('pto'))

try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await api(`/v1/ligas/${LIGA}/partidos/P`)).status < 500) break } catch { /* aún no */ }
    await espera(500)
    if (i === 119) throw new Error(`wrangler no arrancó:\n${servidor.registro.slice(-1500)}`)
  }
  const sembrada = await api(`/v1/_semilla/ligas/${LIGA}`, { method: 'POST', headers: { authorization: `Bearer ${SEMILLA}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  assert.equal(sembrada.status, 201, 'siembra de la liga sintética')

  chrome = lanzar(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${PERFIL}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ])
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break } catch { await espera(250) } }

  let A = null
  let B = null
  let C = null
  let D = null
  let eventosAntes = 0

  await paso('1. Dos pestañas, un partido: exactamente un propietario y un emisor', async () => {
    A = await nuevaPestana('A')
    B = await nuevaPestana('B')
    await abrirCtl(A)
    await A.hasta(esListo)
    await abrirCtl(B)
    const ea = await A.estado()
    const eb = await B.estado()
    assert.deepEqual([ea.modo, ea.propietario], ['propietario', true])
    assert.deepEqual([eb.modo, eb.propietario], ['solo-lectura', false])
    assert.ok(ea.emisor, 'el propietario no tiene emisor')
    assert.equal(eb.emisor, null, 'la pestaña de solo lectura creó un emisor')
    const locks = await B.evalu('window.__h.locks()')
    assert.deepEqual(locks, { held: [{ name: NOMBRE_LOCK, mode: 'exclusive' }], pending: [{ name: NOMBRE_LOCK, mode: 'exclusive' }] })
    return `Web Lock ${NOMBRE_LOCK}: 1 retenido (exclusive) y 1 en cola; A=${ea.modo}/emisor ${ea.emisor.fase}, B=${eb.modo}/emisor ${eb.emisor}`
  })

  await paso('2. La pestaña de solo lectura no puede encolar ni transmitir', async () => {
    const antes = await B.evalu('window.__h.volcar()')
    for (const [nombre, expr] of [
      ['registrar', `window.__h.registrar(${js(PUNTO())})`],
      ['iniciarPartido', `window.__h.iniciarPartido(${js({ cmdId: cmdId('x'), confirmadoPorOperador: true })})`],
      ['verificar', 'window.__h.verificar()'],
      ['reintentarConConfirmacion', `window.__h.reintentarConConfirmacion(${js({ confirmadoPorOperador: true })})`],
      ['remuestrear', 'window.__h.remuestrear()'],
    ]) {
      const r = await B.evalu(expr)
      assert.equal(r.ok, false, `${nombre}: la pestaña de solo lectura actuó`)
      assert.equal(r.motivo, 'solo-lectura', nombre)
    }
    await B.evalu('window.__h.reintentarAhora()')
    await espera(1200)
    assert.equal(B.v1().length, 0, `la pestaña de solo lectura hizo peticiones: ${js(B.v1().map((p) => `${p.metodo} ${p.url}`))}`)
    assert.equal(await B.evalu('window.__h.volcar()'), antes, 'la pestaña de solo lectura escribió en lo durable')
    return 'registrar/iniciar/verificar/reintentar/remuestrear → «solo-lectura»; 0 peticiones /v1 de B; almacén idéntico'
  })

  await paso('3. El propietario inicia, envía en orden y la otra pestaña relee lo durable', async () => {
    const ini = await A.evalu(`window.__h.iniciarPartido(${js({ cmdId: cmdId('ini'), confirmadoPorOperador: true })})`)
    assert.equal(ini.ok, true, js(ini))
    await A.hasta("window.__h.estado().sesion?.inicio === 'confirmado'", 15000, 'inicio confirmado en A')
    assert.equal((await A.estado()).sesion.puntuacion.habilitada, true)
    const antesPuntos = (await servidorEstado()).puntos
    for (const j of ['J1', 'J2']) { const r = await A.evalu(`window.__h.registrar(${js(PUNTO(j))})`); assert.equal(r.ok, true, js(r)) }
    await A.hasta("window.__h.estado().sesion?.confirmadas === 3", 15000, 'tres órdenes confirmadas')
    const s = await servidorEstado()
    assert.equal(s.puntos - antesPuntos, 2)
    assert.equal(s.partido, 'vivo')
    // el orden de los POST es el de la cola
    const dur = await A.evalu('window.__h.leer()')
    assert.deepEqual(A.post().map((p) => JSON.parse(p.cuerpo).clientSeq), dur.entradas.map((e) => e.clientSeq))
    await B.hasta("window.__h.estado().sesion?.inicio === 'confirmado' && window.__h.estado().sesion.confirmadas === 3", 10000, 'B relee lo durable tras el aviso')
    assert.equal(B.v1().length, 0, 'B hizo peticiones')
    eventosAntes = s.eventos.length
    return `inicio aceptado → puntuación habilitada; 2 puntos en el servidor (clientSeq ${A.post().map((p) => JSON.parse(p.cuerpo).clientSeq).join(',')}); B leyó lo durable sin red`
  })

  await paso('4. Cierre limpio del propietario: la otra pestaña adquiere y relee lo durable', async () => {
    const cierre = await A.evalu('window.__h.cerrar()')
    assert.deepEqual([cierre.cerrado, cierre.temporizadores, cierre.oyentes, cierre.solicitudes, cierre.tareas], [true, 0, 0, 0, 0])
    await B.hasta("window.__h.estado().modo === 'propietario' && window.__h.estado().listo === true", 10000, 'B promovida')
    const eb = await B.estado()
    assert.ok(eb.emisor, 'B no creó su emisor')
    assert.equal(eb.sesion.inicio, 'confirmado')
    assert.equal(eb.sesion.confirmadas, 3)
    assert.equal((await A.estado()).modo, 'cerrado')
    const locks = await B.evalu('window.__h.locks()')
    assert.deepEqual(locks, { held: [{ name: NOMBRE_LOCK, mode: 'exclusive' }], pending: [] })
    assert.ok(B.v1().some((p) => p.metodo === 'GET' && p.url.endsWith('/partidos/P')), 'B no muestreó la hora al adquirir')
    await A.cerrarDestino()
    return 'A cerró (0 temporizadores/oyentes/peticiones/tareas) → B propietaria, releyó 3 órdenes confirmadas y muestreó la hora; candado: 1 retenido, 0 en cola'
  })

  let sobreOriginal = null
  await paso('5. Pestaña propietaria cerrada con un comando EN VUELO: la nueva propietaria reenvía el mismo sobre y resuelve el recibo original', async () => {
    C = await nuevaPestana('C')
    await abrirCtl(C)
    assert.equal((await C.estado()).modo, 'solo-lectura')
    const antes = await servidorEstado()
    // B está sola con el candado: se retiene la RESPUESTA (el servidor ya procesó) y se cierra la pestaña
    await B.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/comandos', requestStage: 'Response' }] })
    const pausado = new Promise((r) => { const fn = (m) => { if (m.method === 'Fetch.requestPaused') { B.oyentes.splice(B.oyentes.indexOf(fn), 1); r(m.params) } }; B.oyentes.push(fn) })
    const reg = await B.evalu(`window.__h.registrar(${js(PUNTO('J2'))})`)
    assert.equal(reg.ok, true, js(reg))
    const p = await Promise.race([pausado, espera(15000).then(() => { throw new Error('la petición no llegó al servidor') })])
    assert.equal(p.responseStatusCode, 200, 'el servidor no había respondido')
    sobreOriginal = B.post().at(-1).cuerpo
    const mid = await servidorEstado()
    assert.equal(mid.puntos - antes.puntos, 1, 'el servidor debía haber confirmado el punto antes de cerrar la pestaña')
    await B.cerrarDestino() // la respuesta nunca llega a la página
    await C.hasta("window.__h.estado().modo === 'propietario' && window.__h.estado().listo === true", 15000, 'C promovida')
    await C.hasta("window.__h.estado().sesion?.confirmadas === 4", 15000, 'C resuelve la orden en vuelo')
    const reenvio = C.post()
    assert.equal(reenvio.length, 1, `C hizo ${reenvio.length} POST`)
    assert.equal(reenvio[0].cuerpo, sobreOriginal, 'C no reenvió el MISMO sobre byte a byte')
    assert.equal(C.respuestas.filter((r) => r.url.endsWith('/comandos')).at(-1).status, 200)
    const despues = await servidorEstado()
    assert.equal(despues.puntos - antes.puntos, 1, 'se duplicó el punto')
    const dur = await C.evalu('window.__h.leer()')
    assert.equal(dur.entradas.at(-1).cuerpoJson, sobreOriginal)
    assert.equal(dur.entradas.at(-1).estado, 'confirmada')
    return `servidor confirmó 1 punto con B viva; B cerrada; C reenvió ${sobreOriginal.length} B idénticos → 200 (recibo original); puntos del servidor +1 (sin duplicado)`
  })

  await paso('6. Recarga SIN conexión: reloj invalidado; puntos, faltas y periodo siguen; la orden de reloj se rechaza sin consumir número', async () => {
    await fueraDeLinea(C, false)
    await C.recargar() // nueva carga de página: el ancla del reloj (en memoria) no sobrevive
    await C.hasta('!!window.__h')
    await fueraDeLinea(C, true) // el navegador queda sin conexión ANTES de abrir el controlador
    await C.hasta('navigator.onLine === false', 5000, 'navigator.onLine=false')
    await abrirCtl(C)
    await C.hasta(esListo)
    const e = await C.estado()
    assert.equal(e.modo, 'propietario')
    assert.equal(e.reloj.nivel, 'sin-estimacion')
    assert.equal(e.conexion.enLinea, false)
    const v1Antes = C.v1().length
    const dur0 = await C.evalu('window.__h.leer()')
    const dump0 = await C.evalu('window.__h.volcar()')
    // 1) acciones de reloj: rechazadas ANTES de encolar
    for (const tipo of ['arrancar-reloj', 'detener-reloj']) {
      const r = await C.evalu(`window.__h.registrar(${js(orden(tipo, {}, cmdId('rel')))})`)
      assert.equal(r.ok, false, `${tipo} se aceptó sin estimación`)
      assert.equal(r.motivo, 'sin-tiempo-confiable', js(r))
      assert.equal(r.escrito, false)
    }
    assert.equal(await C.evalu('window.__h.volcar()'), dump0, 'una orden de reloj rechazada escribió en lo durable')
    const dur1 = await C.evalu('window.__h.leer()')
    assert.equal(dur1.siguienteSeq, dur0.siguienteSeq, 'se consumió un clientSeq')
    // 2) puntos, falta y periodo: entran con los números siguientes
    const sigs = []
    for (const o of [PUNTO('J1'), orden('falta', { equipoId: 'E2', jugadorId: 'J3' }, cmdId('fal')), orden('siguiente-periodo', {}, cmdId('per')), PUNTO('J2')]) {
      const r = await C.evalu(`window.__h.registrar(${js(o)})`)
      assert.equal(r.ok, true, `${o.tipo}: ${js(r)}`)
      sigs.push(o.tipo)
    }
    const dur2 = await C.evalu('window.__h.leer()')
    assert.deepEqual(dur2.entradas.slice(dur0.entradas.length).map((x) => x.clientSeq), [dur0.siguienteSeq, dur0.siguienteSeq + 1, dur0.siguienteSeq + 2, dur0.siguienteSeq + 3])
    assert.equal(C.v1().length, v1Antes, `sin conexión se hicieron peticiones: ${js(C.v1().slice(v1Antes).map((p) => `${p.metodo} ${p.url}`))}`)
    assert.equal((await C.estado()).emisor.fase, 'sin-conexion')
    assert.equal((await servidorEstado()).partido, 'vivo')
    return `sin conexión y sin ancla: reloj ${e.reloj.nivel}; arrancar/detener rechazados (nada escrito, siguienteSeq ${dur0.siguienteSeq} intacto); ${sigs.join(', ')} encolados con clientSeq ${dur0.siguienteSeq}-${dur0.siguienteSeq + 3}; 0 peticiones /v1`
  })

  await paso('7. Reconexión: remuestrea la hora y vacía la cola EN ORDEN; ya con estimación una orden de reloj se acepta', async () => {
    const durAntes = await C.evalu('window.__h.leer()')
    const pendientes = durAntes.entradas.filter((e) => e.estado === 'pendiente')
    assert.equal(pendientes.length, 4)
    const antes = await servidorEstado()
    const v1Antes = C.v1().length
    await fueraDeLinea(C, false)
    await C.hasta("window.__h.estado().reloj.nivel === 'confiable'", 15000, 'reloj confiable tras la reconexión')
    await C.hasta("window.__h.estado().sesion.pendientes === 0 && window.__h.estado().sesion.enviando === 0", 20000, 'cola vacía')
    const nuevos = C.v1().slice(v1Antes)
    assert.ok(nuevos.some((p) => p.metodo === 'GET' && p.url.endsWith('/partidos/P')), 'no remuestreó la hora')
    const posts = nuevos.filter((p) => p.metodo === 'POST').map((p) => JSON.parse(p.cuerpo))
    assert.deepEqual(posts.map((p) => p.cmdId), pendientes.map((p) => p.cmdId), 'el orden de envío no es el de la cola')
    assert.deepEqual(posts.map((p) => p.clientSeq), pendientes.map((p) => p.clientSeq))
    const despues = await servidorEstado()
    assert.equal(despues.puntos - antes.puntos, 2)
    const arr = await C.evalu(`window.__h.registrar(${js(orden('arrancar-reloj', {}, cmdId('arr')))})`)
    assert.equal(arr.ok, true, js(arr))
    await C.hasta("window.__h.estado().sesion.pendientes === 0 && window.__h.estado().sesion.enviando === 0", 15000, 'orden de reloj enviada')
    const fin = await C.evalu('window.__h.leer()')
    assert.equal(fin.entradas.at(-1).tipo, 'arrancar-reloj')
    assert.equal(fin.entradas.at(-1).estado, 'confirmada')
    assert.equal((await servidorEstado()).partido, 'vivo')
    return `reconectó: hora remuestreada (confiable); ${posts.length} POST en orden clientSeq ${posts.map((p) => p.clientSeq).join(',')}; puntos del servidor +2; arrancar-reloj aceptado con estimación`
  })

  await paso('8. Una parada persistida sobrevive al cambio de pestaña y no se borra sola', async () => {
    D = await nuevaPestana('D')
    await abrirCtl(D)
    assert.equal((await D.estado()).modo, 'solo-lectura')
    // el siguiente POST de C recibe un 401 (respuesta fabricada por DevTools): parada de transporte
    await C.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/comandos', requestStage: 'Request' }] })
    const fn = (m) => {
      if (m.method !== 'Fetch.requestPaused') return
      C.enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 401, responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }], body: Buffer.from('{"error":"no-autorizado"}').toString('base64') }).catch(() => {})
    }
    C.oyentes.push(fn)
    const antes = await servidorEstado()
    const r = await C.evalu(`window.__h.registrar(${js(PUNTO('J1'))})`)
    assert.equal(r.ok, true, js(r))
    await C.hasta("window.__h.estado().estados.includes('parada-persistida')", 15000, 'parada persistida')
    C.oyentes.splice(C.oyentes.indexOf(fn), 1)
    await C.enviar('Fetch.disable')
    const orden401 = (await C.evalu('window.__h.leer()')).entradas.at(-1)
    assert.equal(orden401.estado, 'enviando')
    assert.equal((await servidorEstado()).puntos, antes.puntos, 'el servidor no debía haber recibido el punto')
    const eC = await C.estado()
    assert.deepEqual([eC.emisor.fase, eC.emisor.clase, eC.emisor.http, eC.emisor.persistida], ['detenida', 'no-autorizado', 401, true])
    // cambio de pestaña: C cierra y D adquiere
    await C.evalu('window.__h.cerrar()')
    await D.hasta("window.__h.estado().modo === 'propietario' && window.__h.estado().listo === true", 15000, 'D promovida')
    await D.hasta("window.__h.estado().estados.includes('parada-persistida')", 10000, 'D ve la parada')
    await espera(1500)
    assert.equal(D.post().length, 0, 'D envió pese a la parada')
    // ni reintentar, ni reconexión, ni visibilidad la borran
    await D.evalu('window.__h.reintentarAhora()')
    await D.evalu("window.__h.evento('online')")
    await D.evalu("document.dispatchEvent(new Event('visibilitychange'))")
    await espera(1500)
    assert.equal(D.post().length, 0, 'D envió tras reintentar/eventos')
    assert.equal((await D.evalu('window.__h.leer()')).detenida.causa, 'transporte')
    // la vía explícita CON confirmación obtiene el recibo del sobre original y no borra la parada
    const sin = await D.evalu('window.__h.reintentarConConfirmacion({})')
    assert.equal(sin.motivo, 'falta-confirmacion')
    assert.equal(D.post().length, 0)
    const ok = await D.evalu(`window.__h.reintentarConConfirmacion(${js({ confirmadoPorOperador: true })})`)
    assert.equal(ok.ok, true, js(ok))
    assert.equal(D.post().length, 1)
    assert.equal(D.post()[0].cuerpo, orden401.cuerpoJson, 'no reenvió el sobre original')
    const dur = await D.evalu('window.__h.leer()')
    assert.equal(dur.entradas.at(-1).estado, 'confirmada')
    assert.equal(dur.detenida.causa, 'transporte', 'la parada se borró')
    assert.equal((await servidorEstado()).puntos - antes.puntos, 1)
    await C.cerrarDestino()
    return 'POST fabricado 401 → parada de transporte persistida; C cierra, D adquiere y NO envía (ni con reintentar, online ni visibilidad); con confirmación explícita: 1 POST idéntico → 200; la parada sigue; +1 punto en el servidor'
  })

  await paso('9. El cierre del controlador no deja temporizadores, oyentes, canales ni peticiones capaces de modificar la sesión', async () => {
    const antes = await D.evalu('window.__h.volcar()')
    const c0 = await D.evalu('window.__h.cuentas()')
    assert.ok(c0.temporizadoresVivos > 0 && c0.oyentesVivos > 0 && c0.canalesAbiertos > 0, `el controlador abierto debía tener recursos: ${js(c0)}`)
    const cierre = await D.evalu('window.__h.cerrar()')
    assert.deepEqual([cierre.cerrado, cierre.eraPropietario, cierre.temporizadores, cierre.oyentes, cierre.solicitudes, cierre.tareas], [true, true, 0, 0, 0, 0])
    const c1 = await D.evalu('window.__h.cuentas()')
    assert.deepEqual([c1.temporizadoresVivos, c1.oyentesVivos, c1.canalesAbiertos], [0, 0, 0], js(c1))
    const v1 = D.v1().length
    // eventos tardíos: nada reacciona
    await D.evalu("window.__h.evento('online')")
    await D.evalu("window.__h.evento('offline')")
    await D.evalu("window.__h.evento('focus')")
    await D.evalu("document.dispatchEvent(new Event('visibilitychange'))")
    await D.evalu(`window.__h.avisoExterno(${js(NOMBRE_AVISO)}, ${js({ v: 1, tipo: 'cambio' })})`)
    await espera(2500)
    assert.equal(D.v1().length, v1, 'peticiones tras el cierre')
    assert.equal(await D.evalu('window.__h.volcar()'), antes, 'lo durable cambió tras el cierre')
    const locks = await D.evalu('window.__h.locks()')
    assert.deepEqual(locks, { held: [], pending: [] })
    assert.equal((await D.estado()).modo, 'cerrado')
    // diagnósticos acotados y sin credenciales
    for (const p of pestanas) {
      assert.ok(sinToken(js(p.consola)), `${p.nombre}: la consola contiene el token`)
      assert.ok(sinToken(js(p.peticiones)), `${p.nombre}: un cuerpo o URL contiene el token`)
    }
    assert.ok(sinToken(await D.evalu('window.__h.volcar()')), 'el almacén contiene el token')
    assert.ok(sinToken(js(c1)), 'las cuentas contienen el token')
    const errores = (await D.evalu('window.__h.cuentas()')).errores
    assert.deepEqual(errores, [], `errores de página: ${js(errores)}`)
    return 'temporizadores/oyentes/canales vivos del arnés: 0/0/0; eventos online/offline/focus/visibilitychange y un aviso externo → 0 peticiones, almacén idéntico, 0 locks; token ausente de consola, peticiones, almacén y avisos'
  })

  await paso('10. Sin Web Locks no hay control', async () => {
    const E = await nuevaPestana('E')
    const e = await E.evalu(`window.__h.abrir(${js(abrirOpciones({ sinWebLocks: true }))})`)
    assert.equal(e.modo, 'sin-web-locks')
    for (const expr of [`window.__h.registrar(${js(PUNTO())})`, `window.__h.iniciarPartido(${js({ cmdId: cmdId('x'), confirmadoPorOperador: true })})`]) {
      const r = await E.evalu(expr)
      assert.deepEqual([r.ok, r.motivo], [false, 'sin-web-locks'])
    }
    assert.equal(E.v1().length, 0)
    await E.evalu('window.__h.cerrar()')
    await E.cerrarDestino()
    return 'modo «sin-web-locks»: registrar e iniciar rechazados, 0 peticiones'
  })
  const sobrante = pestanas.filter((p) => p.viva)
  for (const p of sobrante) await p.cerrarDestino()
} catch (e) {
  resultados.push({ nombre: 'preparación', ok: false, nota: String(e.message ?? e) })
} finally {
  for (const p of hijos.reverse()) await matar(p)
  rmSync(ESTADO, { recursive: true, force: true, maxRetries: 3 })
}

let fallos = 0
for (const r of resultados) { if (!r.ok) fallos += 1; console.log(`${r.ok ? 'OK ' : 'FALLA'}  ${r.nombre}${r.nota ? `  —  ${r.nota}` : ''}`) }
console.log(fallos === 0 ? 'NAVEGADOR DEL CONTROLADOR: OK' : `NAVEGADOR DEL CONTROLADOR: ${fallos} FALLO(S)`)
process.exit(fallos === 0 ? 0 : 1)
