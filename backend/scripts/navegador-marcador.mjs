// Comprobación en un navegador REAL (Chrome con perfil desechable) de la pantalla de puntuación del modo compartido
// (/control/:ligaId/:partidoId/marcador), con la APLICACIÓN REAL compilada en modo compartido (con su service worker):
//   activación con un código de partido real → «Abrir control» → inicio confirmado → #2 Saúl Montero → falta → deshacer/rehacer →
//   sin conexión (puntos, faltas, periodo) → reconexión → reloj (arrancar, detener, corregir) → dos pestañas → recarga SIN conexión
//   con la PWA fría → cierre y resumen final; además: activación ausente, parada persistida, anchos de teléfono y que la API no se
//   sirva desde el caché del service worker.
//   - compila en un directorio TEMPORAL (no toca ../dist); wrangler dev por HTTP en localhost (contexto seguro para service worker y
//     Web Locks) con almacenamiento temporal; Chrome con perfil desechable y puerto de depuración propio;
//   - el organizador actúa desde este proceso por las API existentes; los datos son SINTÉTICOS; no usa Cloudflare.
//   - al terminar mata TODOS sus procesos y borra el perfil y el almacenamiento temporales (las capturas y el registro se conservan).
// Uso (desde backend/):  CAPTURAS=<carpeta> node scripts/navegador-marcador.mjs
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const RAIZ = resolve(import.meta.dirname, '..')
const REPO = resolve(RAIZ, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'marcador')
const CAPTURAS = process.env.CAPTURAS ?? join(RAIZ, '.wrangler-state', 'marcador-capturas')
const PUERTO = 8799
const PUERTO_CDP = 9342
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // solo este proceso, solo para el certificado autofirmado local
const ORIGEN = `https://localhost:${PUERTO}`
const OPERADOR = 'operador-marcador-sintetico-0000000001'
const SEMILLA = 'semilla-marcador-sintetica-000001'
const LIGA = 'LIGAMARC1'
const CHROME = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync)

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ESTADO, { recursive: true })
const DIST = join(ESTADO, 'dist')
const PERFIL = join(ESTADO, 'perfil-chrome')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const js = JSON.stringify

// --- 1. Compilar en modo compartido (con service worker), fuera de ../dist ---
execFileSync(join(REPO, 'node_modules', '.bin', 'vite'), ['build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: REPO, env: { ...process.env, VITE_MODO_COMPARTIDO: '1' }, stdio: 'inherit',
})
assert.ok(existsSync(join(DIST, 'sw.js')), 'la compilación no generó sw.js')

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
for (const senal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(senal, async () => {
    for (const p of hijos.slice().reverse()) await matar(p)
    rmSync(ESTADO, { recursive: true, force: true, maxRetries: 3 })
    process.exit(130)
  })
}
const servidor = lanzar(join(RAIZ, 'node_modules', '.bin', 'wrangler'), [
  'dev', '--port', String(PUERTO), '--ip', '127.0.0.1', '--local-protocol', 'https', '--persist-to', join(ESTADO, 'persistencia'),
  '--assets', DIST, '--var', `LIGAS_ADMITIDAS:${LIGA}`, '--var', `ACCESO_ORIGEN:${ORIGEN}`,
  '--var', 'ACCESO_ADMIN_HABILITADO:1', '--var', `ACCESO_ADMIN_TOKEN:${OPERADOR}`, '--var', 'PERMITIR_SEMILLA:1', '--var', `SEMILLA_TOKEN:${SEMILLA}`,
], { cwd: RAIZ, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' } })

const api = (ruta, opciones = {}) => fetch(`https://127.0.0.1:${PUERTO}${ruta}`, opciones)
const admin = (ruta, cuerpo) => api(ruta, { method: 'POST', headers: { authorization: `Bearer ${OPERADOR}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}) })
const f = (id, equipoId, nombrePila, apellido1, dorsal) => ({ id, equipoId, nombrePila, apellido1, apellido2: '', dorsal, personaId: `persona-marc-${id}` })
const payload = {
  liga: { id: LIGA, nombre: 'Liga del marcador sintética', deporte: 'baloncesto', minutosPorPeriodo: 10 },
  equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }],
  jugadores: [
    f('J1', 'E1', 'Ana', 'Prueba', 0), f('J2', 'E1', 'Saúl', 'Montero', 2), f('J3', 'E1', 'Beto', 'Muestra', 7),
    f('K1', 'E2', 'Eva', 'Visita', 1), f('K2', 'E2', 'Hugo', 'Cuatro', 4),
  ],
  partidos: ['P', 'Q', 'R'].map((id) => ({ id, localId: 'E1', visitaId: 'E2', inicio: null })),
  credenciales: [],
}

let chrome = null
const resultados = []
const pestanas = []
const limpiezas = []
const conTope = (promesa, ms, etiqueta) => Promise.race([promesa, new Promise((_, ko) => setTimeout(() => ko(new Error(`${etiqueta}: sin respuesta en ${ms} ms`)), ms))])

async function conectar(destino, nombre) {
  const ws = new WebSocket(destino.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pendientes = new Map()
  const oyentes = []
  const t = { nombre, viva: true, consola: [], peticiones: [], respuestas: [], destinoId: destino.id }
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && pendientes.has(m.id)) { const { ok, ko } = pendientes.get(m.id); pendientes.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') t.consola.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 220))
    if (m.method === 'Log.entryAdded') t.consola.push(`${m.params.entry.level}: ${m.params.entry.text}`.slice(0, 220))
    if (m.method === 'Network.requestWillBeSent') t.peticiones.push({ url: m.params.request.url, metodo: m.params.request.method, cuerpo: m.params.request.postData ?? null })
    if (m.method === 'Network.responseReceived') t.respuestas.push({ url: m.params.response.url, status: m.params.response.status, deCache: m.params.response.fromServiceWorker === true })
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
  const navegar = async (ruta) => { const c = cargada(); await enviar('Page.navigate', { url: `${ORIGEN}${ruta}` }); await conTope(c, 30000, `carga de ${ruta}`) }
  const recargar = async () => { const c = cargada(); await enviar('Page.reload'); await conTope(c, 30000, 'recarga') }
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await enviar(`${d}.enable`)
  await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const p = {
    ...t, ws, enviar, evalu, hasta, navegar, recargar, oyentes,
    v1: () => t.peticiones.filter((x) => x.url.includes('/v1/')),
    post: () => t.peticiones.filter((x) => x.metodo === 'POST' && x.url.endsWith('/comandos')),
    texto: () => evalu('document.body.innerText'),
    hayTexto: (tx, ms = 10000) => hasta(`document.body.innerText.includes(${js(tx)})`, ms, `texto «${tx}»`),
    sinTexto: (tx, ms = 10000) => hasta(`!document.body.innerText.includes(${js(tx)})`, ms, `sin texto «${tx}»`),
    clic: (nombreBoton) => evalu(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => ((x.getAttribute('aria-label') || x.textContent).trim() === ${js(nombreBoton)}) && !x.disabled); if (!b) throw new Error('no hay botón activo «${nombreBoton}»; botones: ' + [...document.querySelectorAll('button')].map((x) => (x.getAttribute('aria-label') || x.textContent).trim() + (x.disabled ? '(off)' : '')).join(' | ').slice(0, 400)); b.click(); return true })()`),
    clicContiene: (parte) => evalu(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => ((x.getAttribute('aria-label') || x.textContent).trim().includes(${js(parte)})) && !x.disabled); if (!b) throw new Error('no hay botón activo que contenga «${parte}»'); b.click(); return true })()`),
    botonActivo: (nombreBoton) => evalu(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.textContent).trim() === ${js(nombreBoton)}); return !!b && !b.disabled })()`),
    captura: async (archivo) => writeFileSync(join(CAPTURAS, archivo), Buffer.from((await enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64')),
    sinConexion: (off) => enviar('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    cerrarDestino: async () => { p.viva = false; try { ws.close() } catch { /* nada */ } await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${destino.id}`).catch(() => {}) },
  }
  Object.defineProperty(p, 'consola', { get: () => t.consola })
  pestanas.push(p)
  return p
}
const nuevaPestana = async (nombre) => conectar(await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json(), nombre)

async function paso(nombre, fn) {
  try {
    const nota = await conTope(fn(), 240_000, 'el paso')
    resultados.push({ nombre, ok: true, nota })
  } catch (e) {
    let diag = ''
    try { diag = ` ⏎ diagnóstico: ${pestanas.filter((p) => p.viva).map((p) => `${p.nombre}=${js({ consola: p.consola.slice(-2) })}`).join(' | ')}`.slice(0, 700) } catch { /* sin diagnóstico */ }
    for (const p of pestanas.filter((x) => x.viva).slice(0, 2)) { try { await p.captura(`FALLO-${nombre.slice(0, 3).trim()}-${p.nombre}.png`) } catch { /* la captura es auxiliar */ } }
    resultados.push({ nombre, ok: false, nota: `${String(e.message ?? e).split('\n').slice(0, 6).join(' ⏎ ')}${diag}` })
  } finally {
    for (const cerrar of limpiezas.splice(0)) { try { await conTope(cerrar(), 3000, 'cerrar interceptación') } catch { /* ya cerrada */ } }
  }
}

try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await api('/v1/organizador/yo')).status === 401) break } catch { /* aún no */ }
    await espera(500)
    if (i === 119) throw new Error(`wrangler no arrancó:\n${servidor.registro.slice(-1500)}`)
  }
  assert.equal((await api(`/v1/_semilla/ligas/${LIGA}`, { method: 'POST', headers: { authorization: `Bearer ${SEMILLA}`, 'content-type': 'application/json' }, body: js(payload) })).status, 201, 'siembra')
  const alta = await admin('/v1/admin/organizador', { nombre: 'Organizador sintético', ligas: [LIGA] })
  assert.equal(alta.status, 201, 'alta del organizador sintético')
  const login = await api('/v1/acceso/organizador', { method: 'POST', headers: { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' }, body: js({ codigo: (await alta.json()).codigo }) })
  assert.equal(login.status, 200, 'sesión del organizador')
  const COOKIE = /^__Host-sesion=([^;]+)/.exec(login.headers.get('set-cookie'))[1]
  const emitirCodigo = async (g) => {
    const r = await api(`/v1/organizador/ligas/${LIGA}/partidos/${g}/codigo`, { method: 'POST', headers: { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json', cookie: `__Host-sesion=${COOKIE}` }, body: '{}' })
    assert.equal(r.status, 200, `código de ${g}`)
    return (await r.json()).codigo
  }

  chrome = lanzar(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${PERFIL}`, '--ignore-certificate-errors',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ])
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break } catch { await espera(250) } }

  const claveAct = (g) => `sebel.ctl.act.v1:${LIGA}:${g}`
  const tokenDe = (p, g) => p.evalu(`JSON.parse(localStorage.getItem(${js(claveAct(g))})).token`)
  /** Lo que el SERVIDOR tiene (lectura protegida con la credencial ya activada; sintética). */
  const servidorDe = async (p, g) => {
    const r = await api(`/v1/ligas/${LIGA}/partidos/${g}/estado`, { headers: { authorization: `Bearer ${await tokenDe(p, g)}` } })
    assert.equal(r.status, 200, `/estado de ${g}`)
    const c = await r.json()
    const puntos = (eq) => c.estado.eventos.filter((e) => !e.anulado && e.tipo === 'punto' && e.equipoId === eq).reduce((n, e) => n + e.puntos, 0)
    return { partido: c.estado.partido, eventos: c.estado.eventos, alfa: puntos('E1'), beta: puntos('E2'), faltas: c.estado.eventos.filter((e) => !e.anulado && e.tipo === 'falta').length, periodo: 1 + c.estado.eventos.filter((e) => !e.anulado && e.tipo === 'periodo').length, cursor: c.cursor }
  }
  const activar = async (p, g) => {
    const codigo = await emitirCodigo(g)
    await p.navegar(`/control/${LIGA}/${g}`)
    await p.hayTexto('Código del partido')
    await p.evalu("document.getElementById('codigo-partido').focus()")
    await p.enviar('Input.insertText', { text: codigo })
    await p.hasta("!document.querySelector('form button[type=submit]').disabled", 5000)
    await p.clic('Activar este teléfono')
    await p.hayTexto('Abrir control', 20000)
  }
  const confirmadasDe = async (p) => Number(/Confirmado por el servidor: (\d+)/.exec(await p.evalu("document.querySelector('[data-sincro]')?.textContent ?? ''"))?.[1] ?? NaN)
  /** Hace algo y espera a que el servidor CONFIRME una orden más (no basta con «0 pendientes», que puede ser cierto antes de guardar). */
  const confirmandoUna = async (p, accion, etiqueta) => {
    const antes = await confirmadasDe(p)
    await accion()
    await p.hasta(`(() => { const m = /Confirmado por el servidor: (\\d+)/.exec(document.querySelector('[data-sincro]')?.textContent ?? ''); return m && Number(m[1]) >= ${antes + 1} })()`, 20000, `${etiqueta}: una orden más confirmada`)
  }
  const sincro = (p) => p.evalu("document.querySelector('[data-sincro]')?.textContent ?? ''")
  const medidas = (p) => p.evalu(`(() => {
    const barra = document.querySelector('.barra-deshacer')
    const b = barra?.getBoundingClientRect()
    const ultimo = [...document.querySelectorAll('.consola > *:not(.barra-deshacer)')].filter((e) => e.getBoundingClientRect().height > 0).pop()
    window.scrollTo(0, document.documentElement.scrollHeight)
    const u = ultimo?.getBoundingClientRect()
    return { ancho: innerWidth, scrollX: document.documentElement.scrollWidth, barraArriba: b ? Math.round(b.top) : null, barraAbajo: b ? Math.round(b.bottom) : null, altoVentana: innerHeight, ultimoAbajo: u ? Math.round(u.bottom) : null }
  })()`)

  let A = null
  let B = null
  let C = null
  let D = null
  const BASE = `/control/${LIGA}/P/marcador`
  let tokenP = null

  await paso('1. Código de partido real → activación → «Abrir control» (la PWA queda precacheada)', async () => {
    A = await nuevaPestana('A')
    await A.navegar(`/control/${LIGA}/P`)
    await A.hasta('navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)', 30000, 'service worker listo')
    await A.recargar()
    await A.hasta('navigator.serviceWorker.controller !== null', 20000, 'página controlada por el service worker')
    await activar(A, 'P')
    tokenP = await tokenDe(A, 'P')
    assert.match(tokenP, /^[0-9a-f]{64}$/)
    const enlace = await A.evalu("[...document.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Abrir control')?.getAttribute('href')")
    assert.equal(enlace, BASE)
    assert.ok(!enlace.includes(tokenP), 'el token está en el enlace')
    await A.captura('01-activacion-abrir-control.png')
    const precache = await A.evalu("(async () => { const ks = await caches.keys(); const urls = []; for (const k of ks) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname); return urls })()")
    assert.ok(precache.some((u) => u === '/index.html' || u === '/'), `index.html no está precacheado: ${precache.slice(0, 6)}`)
    return `service worker activo y controlando; ${precache.length} archivos precacheados; enlace «Abrir control» → ${enlace} (sin secretos)`
  })

  await paso('2. Inicio confirmado: nada se puede anotar antes; luego #2 Saúl Montero, #0 Ana Prueba y los equipos', async () => {
    await A.clic('Abrir control')
    await A.hayTexto('Comenzar el partido', 20000)
    assert.equal(await A.evalu("document.querySelectorAll('.anota button').length"), 0, 'hay botones de anotar antes del inicio')
    await A.clic('Comenzar el partido')
    await A.hayTexto('Confirmar inicio')
    await A.captura('02-confirmar-inicio.png')
    await A.clic('Confirmar inicio')
    await A.hasta("!!document.querySelector('[aria-label=\"#2 Saúl Montero más 2\"]')", 30000, 'botones de anotar tras el recibo del inicio')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 1')", 15000, 'inicio confirmado')
    assert.equal((await servidorDe(A, 'P')).partido.estado, 'vivo')
    assert.ok(await A.evalu("!!document.querySelector('[aria-label=\"#0 Ana Prueba más 1\"]')"), 'falta #0 Ana Prueba')
    assert.equal(await A.evalu("document.querySelector('[data-jugador=\"J1\"] .dorsal').textContent"), '0')
    const t = await A.texto()
    for (const s of ['Alfa', 'Beta', '1º cuarto']) assert.ok(t.includes(s), `falta «${s}»`)
    await A.captura('03-puntuacion.png')
    return 'sin recibo no hay botones de anotar; tras el recibo aceptado: #0 Ana Prueba (dorsal 0), #2 Saúl Montero, equipos Alfa/Beta'
  })

  await paso('3. Puntuar, falta, deshacer, rehacer y anular, con pendiente frente a confirmado', async () => {
    const antes = await servidorDe(A, 'P')
    await A.clic('#2 Saúl Montero más 2')
    await A.hayTexto('guardado en este teléfono, pendiente de enviar')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 2')", 15000, 'punto confirmado')
    assert.equal((await servidorDe(A, 'P')).alfa - antes.alfa, 2)
    await A.clic('Falta de #2 Saúl Montero')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 3')", 15000, 'falta confirmada')
    assert.equal((await servidorDe(A, 'P')).faltas - antes.faltas, 1)
    await A.clic('↺ Deshacer') // anula la falta
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 4')", 15000, 'deshacer confirmado')
    assert.equal((await servidorDe(A, 'P')).faltas, antes.faltas)
    await A.clic('↻ Rehacer')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 5')", 15000, 'rehacer confirmado')
    assert.equal((await servidorDe(A, 'P')).faltas - antes.faltas, 1)
    await A.clic('#0 Ana Prueba más 3')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 6')", 15000)
    await A.evalu("[...document.querySelectorAll('[data-evento]')].find((e) => e.textContent.includes('+3')).querySelector('button.pill').click()")
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 7')", 15000, 'anulación confirmada')
    const s = await servidorDe(A, 'P')
    assert.equal(s.alfa - antes.alfa, 2, 'la anulación no restó el +3')
    assert.ok(await A.evalu("document.querySelector('[data-evento] .cp-estado.confirmado') !== null"))
    await A.captura('04-puntuacion-confirmada.png')
    return `servidor: Alfa ${s.alfa}, faltas ${s.faltas}; deshacer/rehacer/anular confirmados (7 órdenes con recibo)`
  })

  await paso('4. Sin conexión: puntos, faltas y cambio de periodo se guardan aquí; al volver se confirman en orden', async () => {
    const antes = await servidorDe(A, 'P')
    await A.sinConexion(true)
    await A.hasta('navigator.onLine === false', 5000)
    const v1Antes = A.v1().length
    limpiezas.push(async () => { await A.sinConexion(false) }) // pase lo que pase, el siguiente paso arranca con red
    await A.clic('#2 Saúl Montero más 3')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 1')", 10000, 'primera acción guardada')
    await A.clic('Falta de #0 Ana Prueba')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 2')", 10000, 'segunda acción guardada')
    await A.clicContiene('Terminar el 1º cuarto antes de tiempo')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 3')", 10000, 'cambio de periodo guardado')
    await A.clic('#0 Ana Prueba más 1')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 4')", 10000, 'cuarta acción guardada')
    await A.hayTexto('Sin conexión.')
    const s1 = await sincro(A)
    assert.match(s1, /pendiente de enviar: 4/, s1)
    assert.equal(A.v1().length, v1Antes, 'se hicieron peticiones sin conexión')
    assert.ok((await A.texto()).includes('2º cuarto'), 'el periodo no cambió en pantalla')
    await A.captura('05-sin-conexion.png')
    const posts0 = A.post().length
    await A.sinConexion(false)
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 30000, 'cola vacía tras reconectar')
    const nuevos = A.post().slice(posts0).map((p) => JSON.parse(p.cuerpo))
    assert.deepEqual(nuevos.map((c) => c.tipo), ['anotar', 'falta', 'siguiente-periodo', 'anotar'])
    assert.deepEqual(nuevos.map((c) => c.clientSeq), [...nuevos.map((c) => c.clientSeq)].sort((a, b) => a - b))
    const s = await servidorDe(A, 'P')
    assert.equal(s.alfa - antes.alfa, 4)
    assert.equal(s.periodo, 2)
    assert.equal(s.faltas - antes.faltas, 1)
    return `4 órdenes guardadas sin red (0 peticiones), enviadas en orden al reconectar (clientSeq ${nuevos.map((c) => c.clientSeq).join(',')}); servidor: periodo 2, Alfa +4, falta +1`
  })

  await paso('5. Reloj: arrancar, detener y corregir (tiempo validado); correcciones inválidas se rechazan en pantalla', async () => {
    await A.hasta("document.querySelector('.reloj-consola') !== null")
    await confirmandoUna(A, () => A.clicContiene('Arrancar'), 'arrancar')
    await A.hasta("document.querySelector('.reloj-consola.anda') !== null", 15000, 'reloj corriendo en pantalla')
    assert.equal((await servidorDe(A, 'P')).partido.relojEstado, 'corriendo')
    assert.equal(await A.evalu("document.querySelector('.cp-corregir') === null"), true, 'la corrección está visible con el reloj corriendo')
    await espera(1500)
    await confirmandoUna(A, () => A.clicContiene('Detener'), 'detener')
    await A.hasta("document.querySelector('.reloj-consola.anda') === null && document.querySelector('.cp-corregir') !== null", 15000)
    assert.equal((await servidorDe(A, 'P')).partido.relojEstado, 'detenido')
    const poner = (v) => A.evalu(`(() => { const i = document.getElementById('cp-reloj'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(i, ${js(v)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const posts0 = A.post().length
    await poner('xx')
    await A.clic('Corregir')
    await A.hayTexto('Escribe el tiempo como mm:ss')
    await poner('11:00')
    await A.clic('Corregir')
    await A.hayTexto('no cabe en el periodo')
    assert.equal(A.post().length, posts0, 'una corrección inválida se envió')
    await poner('08:30')
    await confirmandoUna(A, () => A.clic('Corregir'), 'corregir')
    const s = await servidorDe(A, 'P')
    assert.equal(s.partido.relojRestante, 510000)
    assert.ok((await A.texto()).includes('08:30'))
    await A.captura('06-reloj-corregido.png')
    return `arrancó (corriendo en el servidor), detuvo y corrigió a 08:30 (servidor relojRestante ${s.partido.relojRestante}); «xx» y «11:00» se rechazaron en pantalla sin enviar nada`
  })

  await paso('6. Dos pestañas: la segunda es de solo lectura (sin peticiones) y se promueve al cerrar la primera', async () => {
    B = await nuevaPestana('B')
    await B.navegar(BASE)
    await B.hayTexto('otra pestaña', 20000)
    assert.equal(await B.botonActivo('#2 Saúl Montero más 2'), false)
    assert.equal(await B.botonActivo('↺ Deshacer'), false)
    assert.equal(B.v1().length, 0, `la pestaña de solo lectura hizo peticiones: ${js(B.v1().map((p) => `${p.metodo} ${p.url}`))}`)
    assert.ok((await B.texto()).includes('Saúl Montero'), 'la pestaña de solo lectura no muestra los nombres')
    await B.captura('07-solo-lectura.png')
    // la propietaria puntúa y la otra lo ve sin red
    await A.clic('#2 Saúl Montero más 1')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 15000)
    await B.hasta("document.querySelector('[data-sincro]')?.textContent.includes('Confirmado por el servidor')", 10000)
    assert.equal(B.v1().length, 0)
    // cierre ordenado: A sale de la pantalla (se desmonta el controlador y se suelta el candado)
    await A.navegar(`/control/${LIGA}/P`)
    await B.hasta("!document.body.innerText.includes('otra pestaña') && !document.querySelector('[aria-label=\"#2 Saúl Montero más 2\"]').disabled", 20000, 'B promovida')
    await B.clic('#2 Saúl Montero más 1')
    await B.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 15000)
    await A.cerrarDestino()
    return 'B mostró nombres y marcador sin ninguna petición /v1; al salir A (candado liberado) B pasó a propietaria y su +1 se confirmó'
  })

  await paso('7. PWA FRÍA sin conexión: se abre desde el service worker y conserva sesión, nombres y números; se sigue anotando; la API no sale del caché', async () => {
    await B.cerrarDestino()
    C = await nuevaPestana('C')
    await C.sinConexion(true)
    await C.navegar(BASE) // sin red: solo puede responder el service worker con la aplicación precacheada
    await C.hayTexto('Consola del árbitro', 30000)
    await C.hayTexto('Saúl Montero', 30000)
    // Chrome no siempre refleja la emulación en navigator.onLine de una página que carga YA sin red: se reaplica para que dispare «offline»
    await C.sinConexion(false); await C.sinConexion(true)
    await C.hasta('navigator.onLine === false', 5000, 'navigator.onLine=false en la carga fría')
    await C.hayTexto('Sin conexión', 10000)
    const t = await C.texto()
    for (const s of ['Alfa', 'Beta', 'Sin conexión']) assert.ok(t.includes(s), `falta «${s}» tras la carga fría sin conexión`)
    assert.equal(await C.evalu("document.querySelector('[data-jugador=\"J1\"] .dorsal').textContent"), '0')
    assert.ok(await C.evalu("!!document.querySelector('[aria-label=\"#2 Saúl Montero más 2\"]')"))
    assert.equal(await C.evalu("navigator.serviceWorker.controller !== null"), true)
    // reloj invalidado, pero puntos y faltas siguen
    await C.hayTexto('Sin hora del servidor')
    assert.equal(await C.botonActivo('Detener'), false)
    assert.equal(await C.botonActivo('Arrancar') || await C.botonActivo('▶  Arrancar'), false)
    const v1 = C.v1().filter((p) => !p.url.includes('ipwho.is')).length
    await C.clic('#2 Saúl Montero más 2')
    await C.clic('Falta de #0 Ana Prueba')
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 2')", 10000)
    await C.captura('08-pwa-fria-sin-conexion.png')
    // la API nunca viene del caché del service worker
    const enCache = await C.evalu("(async () => { const ks = await caches.keys(); const urls = []; for (const k of ks) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname); return urls })()")
    assert.deepEqual(enCache.filter((u) => u.startsWith('/v1/')), [], 'hay rutas de la API en el caché')
    const alApi = await C.evalu(`fetch('/v1/ligas/${LIGA}/partidos/P').then((r) => 'respondió ' + r.status, (e) => 'falló: ' + e.name)`)
    assert.match(alApi, /^falló/, `la API respondió sin red: ${alApi}`)
    assert.equal(C.v1().filter((p) => !p.url.includes('ipwho.is')).length >= v1, true)
    // reconexión: se confirma
    const antes = await servidorDe(C, 'P')
    await C.sinConexion(false)
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 30000, 'cola vacía tras reconectar')
    const despues = await servidorDe(C, 'P')
    assert.equal(despues.alfa - antes.alfa, 2)
    assert.equal(despues.faltas - antes.faltas, 1)
    return `carga fría sin red servida por el service worker; sesión y nombres/#0 intactos; 0 rutas /v1 en el caché; fetch a la API sin red falló; 2 acciones anotadas sin red y confirmadas al volver (Alfa +2, falta +1)`
  })

  await paso('8. Anchos de teléfono: sin desborde y la barra inferior no tapa el final', async () => {
    const m = await medidas(C)
    assert.ok(m.scrollX <= m.ancho, `desborda ${m.scrollX} > ${m.ancho}`)
    assert.ok(m.barraArriba !== null)
    assert.ok(m.ultimoAbajo <= m.barraArriba + 1, `la barra inferior tapa el final: último elemento termina en ${m.ultimoAbajo}, la barra empieza en ${m.barraArriba}`)
    await C.captura('09-final-de-pagina-barra-inferior.png')
    await C.enviar('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true })
    const m2 = await medidas(C)
    assert.ok(m2.scrollX <= m2.ancho, `desborda a 320 px: ${m2.scrollX}`)
    assert.ok(m2.ultimoAbajo <= m2.barraArriba + 1, `a 320 px la barra tapa el final (${m2.ultimoAbajo} > ${m2.barraArriba})`)
    await C.captura('10-ancho-320.png')
    await C.enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    return `390 px y 320 px: scrollWidth ${m.scrollX}/${m2.scrollX} ≤ ancho; último elemento termina en ${m.ultimoAbajo}/${m2.ultimoAbajo} y la barra empieza en ${m.barraArriba}/${m2.barraArriba}`
  })

  await paso('9. Cierre confirmado y resumen final', async () => {
    await C.sinConexion(false)
    await C.clic('Cerrar el partido')
    await C.hayTexto('¿Cerrar el partido?')
    await C.clic('Confirmar cierre')
    await C.hasta("/partido finalizado/i.test(document.body.innerText)", 20000, 'insignia «Partido finalizado» (el CSS la muestra en mayúsculas)')
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 20000, 'cierre confirmado')
    const s = await servidorDe(C, 'P')
    assert.equal(s.partido.estado, 'final')
    const resumen = await C.evalu("document.querySelector('[aria-label=\"Resumen final\"]').innerText")
    assert.ok(resumen.includes('Saúl Montero'), resumen)
    assert.ok(resumen.includes('Ana Prueba'), resumen)
    assert.match(resumen, /Todas las acciones están confirmadas por el servidor/)
    assert.equal(await C.evalu("document.querySelectorAll('.anota button, .barra-deshacer button').length"), 0, 'quedan controles tras el cierre')
    await C.captura('11-resumen-final.png')
    return `servidor: final, Alfa ${s.alfa} — Beta ${s.beta}; resumen: «${resumen.split('\n').slice(0, 3).join(' | ')}»`
  })

  await paso('10. Activación ausente: se explica, se enlaza a la activación y no se borra nada', async () => {
    const antes = await C.evalu("JSON.stringify(Object.keys(localStorage).sort())")
    await C.navegar(`/control/${LIGA}/R/marcador`)
    await C.hayTexto('todavía no está activado')
    assert.ok(await C.evalu(`!!document.querySelector('a[href="/control/${LIGA}/R"]')`))
    assert.equal(await C.evalu("JSON.stringify(Object.keys(localStorage).sort())"), antes, 'cambió lo guardado')
    assert.equal(await C.evalu("document.querySelectorAll('.anota button').length"), 0)
    await C.captura('12-sin-activacion.png')
    return 'mensaje + enlace a la activación; claves guardadas idénticas; ningún botón de puntuar'
  })

  await paso('11. Parada persistida (401 del servidor): se muestra, sobrevive a la recarga y no se envía nada', async () => {
    await activar(C, 'Q')
    await C.clic('Abrir control')
    await C.hayTexto('Comenzar el partido', 20000)
    await C.clic('Comenzar el partido')
    await C.clic('Confirmar inicio')
    await C.hasta("!!document.querySelector('[aria-label=\"#2 Saúl Montero más 2\"]')", 30000)
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 1')", 15000)
    // el siguiente POST recibe un 401 fabricado por DevTools
    await C.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/comandos', requestStage: 'Request' }] })
    const fn = (m) => {
      if (m.method !== 'Fetch.requestPaused') return
      C.enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 401, responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }], body: Buffer.from('{"error":"no-autorizado"}').toString('base64') }).catch(() => {})
    }
    C.oyentes.push(fn)
    limpiezas.push(async () => { C.oyentes.splice(C.oyentes.indexOf(fn), 1); await C.enviar('Fetch.disable') })
    const antes = await servidorDe(C, 'Q')
    await C.clic('#2 Saúl Montero más 2')
    await C.hayTexto('ya no está autorizado', 20000)
    assert.equal(await C.botonActivo('#2 Saúl Montero más 2'), false)
    assert.ok(!(await C.texto()).match(/detén el partido|parar el partido/i))
    assert.equal(await C.evalu("[...document.querySelectorAll('button')].some((b) => /reanudar|borrar|limpiar/i.test(b.textContent))"), false)
    await C.captura('13-parada-no-autorizado.png')
    assert.equal((await servidorDe(C, 'Q')).alfa, antes.alfa, 'el servidor no debía haber recibido el punto')
    // recarga: la parada sigue y no se envía nada
    C.oyentes.splice(C.oyentes.indexOf(fn), 1); await C.enviar('Fetch.disable')
    const posts = C.post().length
    await C.recargar()
    await C.hayTexto('ya no está autorizado', 20000)
    await espera(2500)
    assert.equal(C.post().length, posts, 'tras recargar se envió algo pese a la parada')
    assert.equal(await C.botonActivo('#2 Saúl Montero más 2'), false)
    assert.equal((await servidorDe(C, 'Q')).alfa, antes.alfa)
    return 'aviso «ya no está autorizado», botones desactivados, ninguna opción de reanudar; tras recargar sigue y se enviaron 0 POST más'
  })

  await paso('12. REPORT_129: reloj corto hasta cero → UNA parada automática confirmada → verificación al vaciarse la cola; puntos y faltas sin red', async () => {
    await C.sinConexion(false)
    await activar(C, 'R')
    await C.clic('Abrir control')
    await C.hayTexto('Comenzar el partido', 20000)
    await C.clic('Comenzar el partido')
    await C.clic('Confirmar inicio')
    await C.hasta("!!document.querySelector('[aria-label=\"#2 Saúl Montero más 2\"]')", 30000, 'botones tras el inicio de R')
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('Confirmado por el servidor: 1')", 15000)
    const estados = () => C.v1().filter((x) => x.metodo === 'GET' && x.url.endsWith(`/partidos/R/estado`)).length
    const paradas = () => C.post().map((x) => JSON.parse(x.cuerpo)).filter((c) => c.gameId === 'R' && c.tipo === 'parada-automatica')
    // reloj corto: se corrige a 00:04 y se arranca
    const poner = (v) => C.evalu(`(() => { const i = document.getElementById('cp-reloj'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(i, ${js(v)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await poner('00:04')
    await confirmandoUna(C, () => C.clic('Corregir'), 'corregir a 00:04')
    await confirmandoUna(C, () => C.clicContiene('Arrancar'), 'arrancar')
    assert.equal((await servidorDe(C, 'R')).partido.relojEstado, 'corriendo')
    assert.equal(paradas().length, 0, 'ya había una parada automática antes de llegar a cero')
    // llega a cero: UNA parada automática, confirmada por el servidor
    await C.hasta('document.querySelector(".reloj-consola.anda") === null', 20000, 'el reloj se detiene solo en pantalla')
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 20000, 'cola vacía tras la parada')
    const sv = await servidorDe(C, 'R')
    assert.equal(sv.partido.relojEstado, 'detenido')
    assert.equal(paradas().length, 1, `paradas automáticas enviadas: ${paradas().length}`)
    assert.match(paradas()[0].cmdId, /^auto:R:/)
    await espera(3000)
    assert.equal(paradas().length, 1, 'la parada se duplicó')
    assert.ok((await C.texto()).includes('00:00'), 'el reloj no marca 00:00')
    await C.captura('14-cero-parada-automatica.png')
    // verificación al vaciarse la cola: una sola lectura de /estado (a lo sumo una por minuto, sin sondeo)
    const l0 = estados()
    const t0 = Date.now()
    while (estados() === l0 && Date.now() - t0 < 75_000) await espera(500)
    assert.equal(estados(), l0 + 1, 'la verificación tras vaciar la cola no ocurrió dentro del minuto de espera')
    await espera(4000)
    assert.equal(estados(), l0 + 1, 'hubo más de una verificación')
    // puntos y faltas sin red
    await C.sinConexion(true)
    await C.hasta('navigator.onLine === false', 5000)
    const posts0 = C.post().length
    await C.clic('#2 Saúl Montero más 2')
    await C.clic('Falta de #0 Ana Prueba')
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 2')", 10000, 'dos acciones guardadas sin red')
    assert.equal(C.post().length, posts0)
    const antes = await servidorDe(C, 'R')
    await C.sinConexion(false)
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 30000, 'cola vacía tras reconectar')
    const despues = await servidorDe(C, 'R')
    assert.equal(despues.alfa - antes.alfa, 2)
    assert.equal(despues.faltas - antes.faltas, 1)
    assert.equal(paradas().length, 1, 'tras reconectar apareció otra parada')
    return `reloj 00:04 → 1 parada automática (${paradas()[0].cmdId}) confirmada; reloj detenido en el servidor; 1 verificación tras vaciar la cola; sin red +2 y falta guardados y confirmados al volver`
  })

  await paso('13. REPORT_130: parada 401 fabricada → solo la pestaña propietaria recupera, con confirmación en pantalla y la credencial real vigente', async () => {
    await C.sinConexion(false)
    await C.navegar(`/control/${LIGA}/Q/marcador`)
    await C.hayTexto('ya no está autorizado', 20000)
    const botonRec = 'Volver a comprobar la autorización'
    assert.equal(await C.botonActivo(botonRec), true, 'no se ofrece la comprobación')
    assert.equal(await C.evalu("[...document.querySelectorAll('button')].some((b) => /reanudar|borrar|limpiar/i.test(b.textContent))"), false)
    // otra pestaña: solo lectura; no ofrece nada y no hace ninguna petición
    D = await nuevaPestana('D')
    await D.navegar(`/control/${LIGA}/Q/marcador`)
    await D.hayTexto('otra pestaña', 20000)
    assert.equal(await D.evalu(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${js(botonRec)})`), false, 'la pestaña de solo lectura ofrece recuperar')
    assert.equal(D.v1().length, 0, 'la pestaña de solo lectura hizo peticiones')
    await D.cerrarDestino()
    // la recarga no recupera nada sola
    const posts0 = C.post().length
    const estados0 = C.v1().filter((x) => x.url.endsWith('/partidos/Q/estado')).length
    await C.recargar()
    await C.hayTexto('ya no está autorizado', 20000)
    await espera(2500)
    assert.equal(C.post().length, posts0, 'la recarga envió algo')
    assert.equal(C.v1().filter((x) => x.url.endsWith('/partidos/Q/estado')).length, estados0, 'la recarga pidió /estado')
    const antes = await servidorDe(C, 'Q')
    const incierta = C.post().map((x) => JSON.parse(x.cuerpo)).filter((c) => c.gameId === 'Q').at(-1) // la orden que recibió el 401 fabricado
    // pedir la comprobación no hace nada hasta confirmar en la página
    await C.clic(botonRec)
    await C.hayTexto('¿Volver a comprobar la autorización de este teléfono?')
    await C.captura('15-recuperar-confirmar.png')
    assert.equal(C.post().length, posts0, 'se envió algo antes de confirmar')
    await C.clic('Cancelar')
    assert.equal(C.post().length, posts0)
    await C.clic(botonRec)
    await C.clic('Sí, comprobar ahora')
    await C.hayTexto('El servidor confirmó la autorización', 30000)
    await C.hasta("!document.body.innerText.includes('ya no está autorizado')", 20000, 'la parada desapareció')
    await C.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 20000)
    const repeticion = C.post().slice(posts0).map((x) => JSON.parse(x.cuerpo))
    assert.equal(repeticion[0].cmdId, incierta.cmdId, 'la repetición no fue la orden incierta')
    assert.deepEqual(repeticion[0], incierta, 'el sobre cambió')
    const despues = await servidorDe(C, 'Q')
    assert.equal(despues.alfa - antes.alfa, 2, 'la orden incierta no llegó exactamente una vez')
    await C.captura('16-recuperada.png')
    // y se puede seguir puntuando con la misma credencial
    await confirmandoUna(C, () => C.clic('#2 Saúl Montero más 2'), 'punto tras recuperar')
    assert.equal((await servidorDe(C, 'Q')).alfa - antes.alfa, 4)
    return `parada 401 sin recargar ni reconectar: nada automático; la pestaña de solo lectura no ofrece la acción; tras confirmar en pantalla, la orden incierta se repitió idéntica (${incierta.cmdId}), /estado verificó la credencial real y el servidor tiene Alfa +4 (exactamente una vez cada punto)`
  })
  for (const p of pestanas.filter((x) => x.viva)) await p.cerrarDestino()
} catch (e) {
  resultados.push({ nombre: 'preparación', ok: false, nota: String(e.message ?? e) })
} finally {
  for (const p of hijos.reverse()) await matar(p)
  writeFileSync(join(CAPTURAS, 'registro.json'), js({ resultados, consola: pestanas.map((p) => ({ pestana: p.nombre, ultimas: p.consola.slice(-15) })) }, null, 1))
  rmSync(ESTADO, { recursive: true, force: true, maxRetries: 3 })
}

let fallos = 0
for (const r of resultados) { if (!r.ok) fallos += 1; console.log(`${r.ok ? 'OK ' : 'FALLA'}  ${r.nombre}${r.nota ? `  —  ${r.nota}` : ''}`) }
console.log(fallos === 0 ? 'NAVEGADOR DEL MARCADOR: OK' : `NAVEGADOR DEL MARCADOR: ${fallos} FALLO(S)`)
process.exit(fallos === 0 ? 0 : 1)
