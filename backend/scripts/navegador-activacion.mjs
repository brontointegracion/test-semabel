// Comprobación en un navegador REAL (Chrome con perfil desechable), aislada y con datos SINTÉTICOS, de la ACTIVACIÓN del
// teléfono de control (/control/:ligaId/:partidoId) a ancho de teléfono (390 px).
//   - compila la aplicación en modo compartido en una carpeta temporal (no toca ../dist);
//   - levanta wrangler dev por HTTPS local con almacenamiento temporal, siembra una liga sintética con varios partidos
//     (sin credenciales) y da de alta un organizador sintético por la ruta del operador;
//   - el organizador (desde este proceso, por las API existentes) emite códigos de partido, consulta el control y lo revoca;
//   - maneja Chrome por el protocolo DevTools: activación, respuesta perdida, cierre de la pestaña con la petición en vuelo,
//     recarga, pestañas que compiten, DOS «teléfonos» (contextos de navegador con almacenamiento aislado) que compiten por
//     un mismo código, revocación y código nuevo antes del inicio, lecturas protegidas con 401/507/malformadas, sin conexión,
//     cuota/ilegible/verificación, bytes exactos y capacidad, secretos y aislamiento del prototipo y del organizador.
// Esto NO inicia ningún partido, no puntúa y nunca llama a /comandos.
// Uso (desde backend/):  node scripts/navegador-activacion.mjs     Variables: CAPTURAS=<carpeta para capturas y diagnósticos>
// No usa Cloudflare ni datos reales. Al terminar mata todos sus procesos y borra el perfil y el almacenamiento temporales.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // solo este proceso, solo para el certificado autofirmado local
const RAIZ = resolve(import.meta.dirname, '..')
const REPO = resolve(RAIZ, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'activacion')
const CAPTURAS = process.env.CAPTURAS ?? join(ESTADO, 'capturas')
const PUERTO = 8798
const PUERTO_CDP = 9337
const ORIGEN = `https://localhost:${PUERTO}`
const OPERADOR = 'operador-activacion-sintetico-000000001'
const SEMILLA = 'semilla-activacion-sintetica-00001'
const LIGA = 'LIGAACT1'
const PREFIJO = 'sebel.ctl.act.v1:'
const MAX_TOTAL_BYTES = 512 * 1024
const MAX_REGISTRO_BYTES = 2 * 1024
const CHROME = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync)
const FRASE = 'Se requiere conexión a internet para esta acción.'
const PARTIDOS = Array.from({ length: 14 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`)

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ESTADO, { recursive: true })
const DIST = join(ESTADO, 'dist')
const PERFIL = join(ESTADO, 'perfil-chrome')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// --- 1. Compilar en modo compartido, fuera de ../dist ---
execFileSync(join(REPO, 'node_modules', '.bin', 'vite'), ['build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: REPO, env: { ...process.env, VITE_MODO_COMPARTIDO: '1' }, stdio: 'inherit',
})

// --- 2. Servidor local HTTPS ---
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
// Si algo (un tope de tiempo externo, Ctrl+C) interrumpe este proceso, no deja wrangler ni Chrome vivos ni almacenamiento temporal.
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

const payload = {
  liga: { id: LIGA, nombre: 'Liga de activación sintética', deporte: 'baloncesto', minutosPorPeriodo: 10 },
  equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }],
  jugadores: [],
  partidos: PARTIDOS.map((id) => ({ id, localId: 'E1', visitaId: 'E2', inicio: null })),
  credenciales: [],
}

let chrome = null
const resultados = []
let alFrente = async () => {}
let alFallar = async () => {}
const limpiezas = [] // interceptaciones de red abiertas: se cierran al terminar CADA paso, también si falla
const conTope = (promesa, ms, etiqueta) => Promise.race([promesa, new Promise((_, ko) => setTimeout(() => ko(new Error(`${etiqueta}: sin respuesta en ${ms} ms`)), ms))])
async function paso(nombre, fn) {
  try { await alFrente(); const nota = await conTope(fn(), 150_000, 'el paso'); resultados.push({ nombre, ok: true, nota }) } catch (e) {
    let archivo = ''
    try { archivo = await alFallar(nombre, e) } catch { /* el diagnóstico es auxiliar */ }
    resultados.push({ nombre, ok: false, nota: `${String(e.message ?? e).split('\n').slice(0, 6).join(' ⏎ ')}${archivo ? ` [diagnóstico: ${archivo}]` : ''}` })
  } finally {
    for (const cerrar of limpiezas.splice(0)) { try { await conTope(cerrar(), 3000, 'cerrar interceptación') } catch { /* ya cerrada */ } }
  }
}

/** Una pestaña de Chrome manejada por DevTools. */
async function conectar(destino) {
  const ws = new WebSocket(destino.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pendientes = new Map()
  const oyentes = []
  const t = { consola: [], peticiones: [], respuestas: [] }
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && pendientes.has(m.id)) { const { ok, ko } = pendientes.get(m.id); pendientes.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') t.consola.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
    if (m.method === 'Log.entryAdded') t.consola.push(`${m.params.entry.level}: ${m.params.entry.text}`)
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
  const hasta = async (expresion, ms = 8000, etiqueta = expresion) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { try { if (await evalu(expresion)) return true } catch { /* la página cambia */ } await espera(100) }
    throw new Error(`no se cumplió: ${etiqueta}`)
  }
  const navegar = async (ruta) => {
    const cargada = new Promise((r) => { const fn = (m) => { if (m.method === 'Page.loadEventFired') { oyentes.splice(oyentes.indexOf(fn), 1); r() } }; oyentes.push(fn) })
    await enviar('Page.navigate', { url: `${ORIGEN}${ruta}` })
    await cargada
  }
  const recargar = async () => {
    const cargada = new Promise((r) => { const fn = (m) => { if (m.method === 'Page.loadEventFired') { oyentes.splice(oyentes.indexOf(fn), 1); r() } }; oyentes.push(fn) })
    await enviar('Page.reload')
    await cargada
  }
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await enviar(`${d}.enable`)
  await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  return { ws, enviar, evalu, hasta, navegar, recargar, oyentes, destinoId: destino.id, ...t }
}


const js = JSON.stringify
const diagnosticos = []
try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await api('/v1/organizador/yo')).status === 401) break } catch { /* aún no */ }
    await espera(500)
    if (i === 119) throw new Error(`wrangler no arrancó:\n${servidor.registro.slice(-1500)}`)
  }
  assert.equal((await api(`/v1/_semilla/ligas/${LIGA}`, { method: 'POST', headers: { authorization: `Bearer ${SEMILLA}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 201, 'siembra')
  const alta = await admin('/v1/admin/organizador', { nombre: 'Organizador sintético', ligas: [LIGA] })
  assert.equal(alta.status, 201, 'alta del organizador sintético')
  const CODIGO_ORGANIZADOR = (await alta.json()).codigo

  // --- El organizador, desde este proceso, por las API existentes (cookie de sesión + CSRF) ---
  const login = await api('/v1/acceso/organizador', { method: 'POST', headers: { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' }, body: JSON.stringify({ codigo: CODIGO_ORGANIZADOR }) })
  assert.equal(login.status, 200, 'sesión del organizador')
  const COOKIE = /^__Host-sesion=([^;]+)/.exec(login.headers.get('set-cookie'))[1]
  const org = (metodo, ruta) => api(ruta, { method: metodo, headers: { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json', cookie: `__Host-sesion=${COOKIE}` }, body: metodo === 'GET' ? undefined : '{}' })
  const emitirCodigo = async (g) => { const r = await org('POST', `/v1/organizador/ligas/${LIGA}/partidos/${g}/codigo`); assert.equal(r.status, 200, `código de ${g}`); return (await r.json()).codigo }
  const controlDe = async (g) => (await (await org('GET', `/v1/organizador/ligas/${LIGA}/partidos/${g}/control`)).json())
  const revocar = async (g) => { const r = await org('POST', `/v1/organizador/ligas/${LIGA}/partidos/${g}/control/revocar`); assert.equal(r.status, 200, `revocar ${g}`); return r.json() }
  const publicoDe = async (g) => (await (await api(`/v1/ligas/${LIGA}/partidos/${g}`)).json())
  const estadoConToken = (g, token) => api(`/v1/ligas/${LIGA}/partidos/${g}/estado`, { headers: { authorization: `Bearer ${token}` } })

  chrome = lanzar(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${PERFIL}`, '--ignore-certificate-errors',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ])
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break } catch { await espera(250) } }


  // --- Contextos de navegador aislados: cada uno es un «teléfono» con su propio almacenamiento ---
  const version = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).json()
  const bws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j })
  let bid = 0
  const bpend = new Map()
  bws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && bpend.has(m.id)) { const { ok, ko } = bpend.get(m.id); bpend.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result) } }
  const enviarNavegador = (metodo, params = {}) => new Promise((ok, ko) => { bid += 1; bpend.set(bid, { ok, ko }); bws.send(JSON.stringify({ id: bid, method: metodo, params })) })
  const nuevoTelefono = async () => (await enviarNavegador('Target.createBrowserContext')).browserContextId
  const pestanaEn = async (contexto) => {
    const { targetId } = await enviarNavegador('Target.createTarget', { url: 'about:blank', browserContextId: contexto })
    let destino = null
    for (let i = 0; i < 50 && !destino; i += 1) { destino = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()).find((t) => t.id === targetId); if (!destino) await espera(100) }
    return conectar(destino)
  }
  const nuevaPestana = async () => conectar(await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json())
  const cerrarPestana = async (p) => {
    // OJO: primero se cierra la PESTAÑA y después la sesión de DevTools; al revés, Chrome reanudaría la respuesta retenida y la página la clasificaría.
    await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${p.destinoId}`).catch(() => {})
    for (let i = 0; i < 50; i += 1) { const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json(); if (!lista.some((t) => t.id === p.destinoId)) break; await espera(100) }
    try { p.ws.close() } catch { /* ya cerrada */ }
  }

  const A = await nuevaPestana()
  alFrente = () => A.enviar('Page.bringToFront')

  // ---------- Ayudas de página ----------
  const texto = (p = A) => p.evalu('document.body.innerText')
  const captura = async (nombre, p = A) => writeFileSync(join(CAPTURAS, nombre), Buffer.from((await p.enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  const fijar = (p, selector, valor) => p.evalu(`(() => { const el = document.querySelector(${js(selector)}); if (!el) throw new Error('no existe ${selector}'); const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, ${js(valor)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const clic = (p, nombre) => p.evalu(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${js(nombre)} && !x.disabled); if (!b) throw new Error('no hay botón ${nombre}; botones: ' + [...document.querySelectorAll('button')].map((x) => x.textContent.trim() + (x.disabled ? '(desactivado)' : '')).join(' | ') + '; página: ' + document.body.innerText.replaceAll('\\n', ' / ').slice(0, 300)); b.click(); return true })()`)
  const hayTexto = (p, t, ms = 10000) => p.hasta(`document.body.innerText.includes(${js(t)})`, ms, `texto «${t}»`)
  const sinTexto = async (p, t) => assert.equal(await p.evalu(`document.body.innerText.includes(${js(t)})`), false, `no debería verse «${t}»`)
  const sinDesborde = async (p = A) => { const m = await p.evalu('({ ancho: innerWidth, scroll: document.documentElement.scrollWidth })'); assert.ok(m.scroll <= m.ancho, `desborda ${m.scroll} > ${m.ancho}`) }
  const clave = (g) => `${PREFIJO}${LIGA}:${g}`
  const crudo = (p, g) => p.evalu(`localStorage.getItem(${js(clave(g))})`)
  const registro = async (p, g) => { const t = await crudo(p, g); return t === null ? null : JSON.parse(t) }
  const clavesLocales = (p) => p.evalu('Object.keys(localStorage).sort()')
  const abrir = async (p, g) => { await p.navegar(`/control/${LIGA}/${g}`); await hayTexto(p, 'Alfa — Beta') }
  const posts = (p, sufijo = '/activar') => p.peticiones.filter((x) => x.metodo === 'POST' && x.url.endsWith(sufijo))
  const gets = (p, sufijo) => p.peticiones.filter((x) => x.metodo === 'GET' && x.url.endsWith(sufijo))
  const sinComandos = (...ps) => { for (const p of ps) assert.equal(p.peticiones.filter((x) => x.url.includes('/comandos')).length, 0, 'se llamó a /comandos') }
  const escribirCodigo = async (p, codigo) => { await fijar(p, '#codigo-partido', codigo); await clic(p, 'Activar este teléfono') }
  // Intercepta peticiones: manejador(params) decide qué hacer. Devuelve la función que lo quita.
  const interceptar = async (p, patron, etapa, manejador) => {
    await p.enviar('Fetch.enable', { patterns: [{ urlPattern: patron, requestStage: etapa }] })
    const fn = (m) => { if (m.method === 'Fetch.requestPaused') manejador(m.params) }
    p.oyentes.push(fn)
    let cerrada = false
    const quitar = async () => { if (cerrada) return; cerrada = true; const i = p.oyentes.indexOf(fn); if (i >= 0) p.oyentes.splice(i, 1); await p.enviar('Fetch.disable') }
    limpiezas.push(quitar)
    return quitar
  }
  const responderFalso = (p, params, estado, cuerpo, tipo = 'application/json') => p.enviar('Fetch.fulfillRequest', {
    requestId: params.requestId, responseCode: estado, responseHeaders: [{ name: 'content-type', value: tipo }], body: Buffer.from(cuerpo).toString('base64'),
  }).catch(() => {})
  const esperarRetenida = async (retenidas, n = 1, ms = 8000) => { const t0 = Date.now(); while (retenidas.length < n) { if (Date.now() - t0 > ms) throw new Error(`no llegaron ${n} peticiones retenidas`); await espera(50) } }
  /** Nada de lo que se guardó, mostró o pidió contiene el código ni el token (salvo el cuerpo del POST de activación, que es donde el código viaja). */
  const sinSecretos = async (p, codigos, tokens) => {
    const dom = await p.evalu('document.documentElement.outerHTML')
    const local = await p.evalu('JSON.stringify({ ...localStorage })')
    const url = await p.evalu('location.href')
    const estadoHistoria = await p.evalu('JSON.stringify(history.state)')
    for (const c of codigos) for (const forma of [c, c.replaceAll('-', '')]) {
      for (const [donde, valor] of [['DOM', dom], ['almacenamiento', local], ['URL', url], ['history.state', estadoHistoria], ['consola', p.consola.join('\n')]]) assert.ok(!valor.includes(forma), `el código aparece en ${donde}`)
      for (const x of p.peticiones) assert.ok(!x.url.includes(forma), 'el código aparece en una URL pedida')
    }
    for (const t of tokens) {
      for (const [donde, valor] of [['DOM', dom], ['URL', url], ['history.state', estadoHistoria], ['consola', p.consola.join('\n')]]) assert.ok(!valor.includes(t), `el token aparece en ${donde}`)
      for (const x of p.peticiones) { assert.ok(!x.url.includes(t), 'el token aparece en una URL pedida'); assert.ok(!(x.cuerpo ?? '').includes(t), 'el token aparece en un cuerpo enviado') }
    }
  }
  const volcadoIDB = (p) => p.evalu(`(async () => {
    const salida = {}
    for (const { name } of (await indexedDB.databases())) {
      salida[name] = await new Promise((ok) => { const r = indexedDB.open(name); r.onsuccess = async () => { const db = r.result; const o = {}
        for (const s of db.objectStoreNames) o[s] = await new Promise((k) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => k(q.result); q.onerror = () => k(null) })
        db.close(); ok(o) }; r.onerror = () => ok(null) })
    }
    return JSON.stringify(salida)
  })()`)

  // Diagnóstico de un paso que falla: aserción y pila, texto de la página, registros guardados (SIN el token), últimas peticiones
  // (método y ruta, sin cuerpos), consola y captura. Nunca cookies, cabeceras, códigos ni tokens.
  alFallar = async (nombre, e) => {
    const n = nombre.split('.')[0]
    const partes = [`PASO: ${nombre}`, `ERROR: ${e.message}`, `PILA:\n${e.stack ?? ''}`]
    const seguro = async (titulo, g) => { try { partes.push(`${titulo}:\n${await g()}`) } catch (e2) { partes.push(`${titulo}: no disponible (${String(e2.message ?? e2).slice(0, 100)})`) } }
    await seguro('RUTA', () => A.evalu('location.pathname'))
    await seguro('TEXTO', async () => (await texto()).slice(0, 1500))
    await seguro('REGISTROS (sin token)', () => A.evalu(`JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith(${js(PREFIJO)})).map((k) => { try { const r = JSON.parse(localStorage.getItem(k)); return [k, { ...r, token: r.token ? '[oculto]' : r.token }] } catch { return [k, 'ilegible'] } }), null, 1)`))
    await seguro('PETICIONES', async () => A.peticiones.slice(-14).map((x) => `${x.metodo} ${x.url.replace(ORIGEN, '')}`).join('\n'))
    await seguro('CONSOLA', async () => A.consola.slice(-8).join('\n'))
    await seguro('CAPTURA', async () => { await captura(`fallo-${n}.png`); return `fallo-${n}.png` })
    const archivo = join(CAPTURAS, `diagnostico-${n}.txt`)
    writeFileSync(archivo, `${partes.join('\n\n')}\n`)
    return archivo
  }

  const TODOS_CODIGOS = []
  const TODOS_TOKENS = []
  const recordarCodigo = (c) => { TODOS_CODIGOS.push(c); return c }
  const recordarToken = (r) => { if (r) TODOS_TOKENS.push(r.token); return r }
  await A.navegar('/control/' + LIGA + '/G01')
  await hayTexto(A, 'Alfa — Beta')
  const IDB_ANTES = await volcadoIDB(A)
  await A.evalu(`localStorage.setItem('sebel.op.v1:org-sintetico:${LIGA}', '{"sentinela":1}')`) // un registro del panel del organizador que NO debe tocarse
  const SENTINELA = await A.evalu(`localStorage.getItem('sebel.op.v1:org-sintetico:${LIGA}')`)

  // ---------- Pasos ----------
  await paso('1. Camino feliz: vista previa del partido, activación, comprobación actual; sin inicio, sin puntuación y sin /comandos', async () => {
    await abrir(A, 'G01')
    await sinDesborde(); await captura('01-vista-previa.png')
    const t = await texto()
    assert.ok(t.includes('Liga de activación sintética') && t.includes('Todavía no ha comenzado'))
    assert.deepEqual(await clavesLocales(A), [`sebel.op.v1:org-sintetico:${LIGA}`], 'mirar guardó algo')
    const codigo = recordarCodigo(await emitirCodigo('G01'))
    const url0 = await A.evalu('location.href')
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'Comprobado ahora: el servidor reconoce este teléfono como controlador activo de este partido.')
    await hayTexto(A, 'Teléfono activado')
    assert.equal(await A.evalu('location.href'), url0, 'cambió la URL')
    const r = recordarToken(await registro(A, 'G01'))
    assert.deepEqual([r.estado, r.conIncierto, r.intentos], ['activada', false, 1])
    assert.match(r.token, /^[0-9a-f]{64}$/); assert.match(r.deviceId, /^dev-/)
    assert.ok(r.servidor.expiraEn > r.servidor.ahoraMs && r.servidor.retornoHasta > r.servidor.expiraEn)
    assert.equal(r.servidor.retornoHasta - r.servidor.expiraEn, 7 * 24 * 3600 * 1000, 'los siete días extra')
    assert.equal(r.servidor.expiraEn - r.servidor.ahoraMs <= 72 * 3600 * 1000 && r.servidor.expiraEn - r.servidor.ahoraMs > 72 * 3600 * 1000 - 60_000, true, 'las 72 h desde la activación')
    const t2 = await texto()
    assert.ok(/Puede procesar acciones hasta: .*\d{4}.*\d{2}:\d{2}/.test(t2), 'falta la fecha y la hora de vencimiento')
    assert.ok(/solo podrá repetir recibos exactos hasta: .*\d{4}.*\d{2}:\d{2}/.test(t2))
    await sinTexto(A, 'dev-'); await sinTexto(A, r.token)
    assert.equal(await A.evalu("document.getElementById('codigo-partido')"), null, 'sigue pidiendo código')
    assert.equal(await A.evalu("[...document.querySelectorAll('button')].some((b) => /inici|comenz|punt|anot|falta|marcador|finaliz|borrar|eliminar|reemplaz|descartar|quitar|limpiar/i.test(b.textContent))"), false)
    await sinDesborde(); await captura('02-activada.png')
    // en el servidor: un controlador activo, el partido sigue programado y no se envió ninguna orden
    assert.equal((await controlDe('G01')).credencial, 'activa')
    assert.equal((await publicoDe('G01')).estado, 'programado')
    const est = await (await estadoConToken('G01', r.token)).json()
    assert.deepEqual([est.cursor, est.estado.partido.estado, est.estado.eventos.length], [{ rev: 0, ultimoClientSeq: 0 }, 'programado', 0])
    assert.equal(est.deviceId, r.deviceId)
    sinComandos(A)
    assert.equal(posts(A).length, 1)
    assert.equal(JSON.stringify(Object.keys(JSON.parse(posts(A)[0].cuerpo)).sort()), JSON.stringify(['codigo', 'tokenHash']))
    await sinSecretos(A, TODOS_CODIGOS, TODOS_TOKENS)
    return `dispositivo ${r.deviceId.slice(0, 8)}…; 72 h + 7 d leídos del servidor`
  })

  await paso('2. Respuesta perdida DESPUÉS de que el servidor activó: «sin confirmar», recarga sin enviar nada y «Comprobar ahora» con el mismo token', async () => {
    await abrir(A, 'G02')
    const quitar = await interceptar(A, '*/activar', 'Response', (m) => A.enviar('Fetch.failRequest', { requestId: m.requestId, errorReason: 'ConnectionReset' }).catch(() => {}))
    const codigo = recordarCodigo(await emitirCodigo('G02'))
    const antes = posts(A).length
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'No sabemos si el servidor activó este teléfono')
    await quitar()
    assert.equal(posts(A).length, antes + 1)
    const r = recordarToken(await registro(A, 'G02'))
    assert.deepEqual([r.estado, r.conIncierto, r.intentos, r.deviceId], ['incierta', true, 1, null])
    assert.equal((await controlDe('G02')).credencial, 'activa', 'el servidor SÍ activó')
    await captura('03-sin-confirmar.png')
    await A.recargar(); await hayTexto(A, 'Alfa — Beta'); await hayTexto(A, 'No sabemos si el servidor activó este teléfono')
    await espera(1200)
    assert.equal(posts(A).filter((x) => x.url.includes('/G02/')).length, 1, 'la recarga reenvió algo sola')
    assert.equal(gets(A, '/G02/estado').length, 0, 'la recarga leyó el estado sola')
    assert.equal(await crudo(A, 'G02'), JSON.stringify(r), 'cambió el registro al recargar')
    await clic(A, 'Comprobar ahora')
    await hayTexto(A, 'Comprobado ahora')
    const d = await registro(A, 'G02')
    assert.deepEqual([d.estado, d.conIncierto, d.token, d.tokenHash], ['activada', false, r.token, r.tokenHash])
    assert.equal(posts(A).filter((x) => x.url.includes('/G02/')).length, 1, 'comprobar no debe enviar activaciones')
    assert.equal(gets(A, '/G02/estado')[0].cuerpo ?? null, null)
    await sinSecretos(A, TODOS_CODIGOS, TODOS_TOKENS)
  })

  await paso('3. Misma identidad con el código otra vez: el servidor devuelve el MISMO dispositivo (un solo controlador) y otro teléfono no puede entrar', async () => {
    await abrir(A, 'G03')
    const quitar = await interceptar(A, '*/activar', 'Response', (m) => A.enviar('Fetch.failRequest', { requestId: m.requestId, errorReason: 'ConnectionReset' }).catch(() => {}))
    const codigo = recordarCodigo(await emitirCodigo('G03'))
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'No sabemos si el servidor activó este teléfono')
    await quitar()
    const r1 = recordarToken(await registro(A, 'G03'))
    await escribirCodigo(A, codigo) // el MISMO código, el mismo token
    await hayTexto(A, 'Comprobado ahora')
    const r2 = await registro(A, 'G03')
    const cuerpos = posts(A).filter((x) => x.url.includes('/G03/')).map((x) => JSON.parse(x.cuerpo))
    assert.equal(cuerpos.length, 2)
    assert.equal(cuerpos[0].tokenHash, cuerpos[1].tokenHash, 'se cambió de identidad')
    assert.equal(cuerpos[0].tokenHash, r1.tokenHash)
    assert.deepEqual([r2.estado, r2.token, r2.intentos], ['activada', r1.token, 2])
    const est = await (await estadoConToken('G03', r1.token)).json()
    assert.equal(est.deviceId, r2.deviceId, 'otro dispositivo')
    assert.equal((await controlDe('G03')).credencial, 'activa')
    // otro «teléfono» (almacenamiento aislado) con ese mismo código no puede activarse: ya hay un controlador
    const ctx = await nuevoTelefono()
    const otro = await pestanaEn(ctx)
    try {
      await abrir(otro, 'G03')
      await escribirCodigo(otro, codigo)
      await hayTexto(otro, 'El servidor no activó este teléfono con ese código')
      assert.equal((await registro(otro, 'G03')).estado, 'denegada')
      assert.notEqual((await registro(otro, 'G03')).tokenHash, r1.tokenHash)
    } finally { await cerrarPestana(otro); await enviarNavegador('Target.disposeBrowserContext', { browserContextId: ctx }) }
  })

  await paso('4. Pestaña cerrada con la petición en vuelo: el registro queda «activando» tal cual, se reabre sin enviar nada y la recuperación es explícita', async () => {
    const C = await nuevaPestana()
    let D = null
    try {
      await abrir(C, 'G04')
      const codigo = recordarCodigo(await emitirCodigo('G04'))
      const retenidas = []
      await interceptar(C, '*/activar', 'Response', (m) => retenidas.push(m.requestId)) // el servidor YA respondió; la página no lo recibe
      await escribirCodigo(C, codigo)
      await esperarRetenida(retenidas)
      assert.equal((await controlDe('G04')).credencial, 'activa', 'el servidor SÍ activó')
      await espera(1000)
      const textoC = await crudo(C, 'G04')
      const enC = JSON.parse(textoC)
      assert.deepEqual([enC.estado, enC.conIncierto, enC.intentos], ['activando', false, 1], `el registro vivo no era «activando»: ${textoC.replace(enC.token, '…')}`)
      recordarToken(enC)
      assert.equal(await C.evalu("navigator.locks.query().then((q) => q.held.some((c) => c.name === 'sebel-ctl:" + LIGA + ":G04'))"), true, 'la pestaña viva no retenía el candado')
      await cerrarPestana(C)
      for (let i = 0; i < 100 && await A.evalu("navigator.locks.query().then((q) => q.held.some((c) => c.name === 'sebel-ctl:" + LIGA + ":G04'))"); i += 1) await espera(100)
      D = await nuevaPestana()
      await abrir(D, 'G04')
      await hayTexto(D, 'La página se cerró o se recargó mientras se activaba')
      assert.equal(await crudo(D, 'G04'), textoC, 'el registro tras reabrir no es idéntico al que tenía la pestaña al morir')
      await espera(1200)
      assert.equal(posts(D).length, 0, 'al reabrir se envió algo solo')
      assert.equal(gets(D, '/G04/estado').length, 0)
      await captura('04-pestana-cerrada.png', D)
      await clic(D, 'Comprobar ahora')
      await hayTexto(D, 'Comprobado ahora')
      const fin = await registro(D, 'G04')
      assert.deepEqual([fin.estado, fin.conIncierto, fin.token], ['activada', false, enC.token])
      assert.equal(posts(D).length, 0, 'comprobar no debe enviar activaciones')
      sinComandos(D)
    } finally {
      for (const p of [C, D]) { if (p) { try { p.ws.close() } catch { /* ya */ } await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${p.destinoId}`).catch(() => {}) } }
      await A.enviar('Page.bringToFront')
    }
  })

  await paso('5. Recarga con la activación guardada: se muestra como «guardada», se comprueba UNA vez (solo lectura) y nunca se reenvía nada', async () => {
    const antesPosts = posts(A).length
    await A.navegar(`/control/${LIGA}/G01`)
    await hayTexto(A, 'Comprobado ahora')
    assert.equal(gets(A, '/G01/estado').length >= 1, true)
    assert.equal(posts(A).length, antesPosts, 'la recarga envió una activación')
    const lecturas = gets(A, '/G01/estado').length
    await espera(1500)
    assert.equal(gets(A, '/G01/estado').length, lecturas, 'se sondea sola más de una vez')
    sinComandos(A)
  })

  await paso('6. Dos pestañas del mismo teléfono compiten: la segunda ve «en curso en otra pestaña», no envía nada y se actualiza cuando la primera termina', async () => {
    await abrir(A, 'G05')
    const codigo = recordarCodigo(await emitirCodigo('G05'))
    const retenidas = []
    const quitar = await interceptar(A, '*/activar', 'Request', (m) => retenidas.push(m.requestId))
    await escribirCodigo(A, codigo)
    await esperarRetenida(retenidas)
    const B = await nuevaPestana()
    try {
      await abrir(B, 'G05')
      await hayTexto(B, 'Activando… hay un intento en curso en otra pestaña')
      assert.equal(await B.evalu("document.getElementById('codigo-partido')"), null, 'la segunda pestaña ofrece enviar')
      assert.equal(await B.evalu("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Comprobar ahora')"), false)
      await espera(800)
      assert.equal(posts(B).length, 0, 'la segunda pestaña envió')
      await captura('05-pestana-competidora.png', B)
      await A.enviar('Fetch.continueRequest', { requestId: retenidas[0] })
      await quitar()
      await hayTexto(A, 'Comprobado ahora')
      await B.hasta("document.body.innerText.includes('Activación guardada') || document.body.innerText.includes('Teléfono activado')", 10000, 'la segunda pestaña ve el resultado')
      assert.equal(posts(B).length, 0)
      recordarToken(await registro(A, 'G05'))
      assert.deepEqual(await B.evalu(`localStorage.getItem(${js(clave('G05'))})`), await crudo(A, 'G05'))
    } finally { await cerrarPestana(B); await A.enviar('Page.bringToFront') }
  })

  await paso('7. Dos teléfonos (almacenamiento aislado) compiten por UN código: exactamente uno se activa; el otro conserva su identidad sin activar', async () => {
    const ctxX = await nuevoTelefono(); const ctxY = await nuevoTelefono()
    const X = await pestanaEn(ctxX); const Y = await pestanaEn(ctxY)
    try {
      await abrir(X, 'G06'); await abrir(Y, 'G06')
      const codigo = recordarCodigo(await emitirCodigo('G06'))
      const reten = { X: [], Y: [] }
      const qx = await interceptar(X, '*/activar', 'Request', (m) => reten.X.push(m.requestId))
      const qy = await interceptar(Y, '*/activar', 'Request', (m) => reten.Y.push(m.requestId))
      await escribirCodigo(X, codigo); await escribirCodigo(Y, codigo)
      await esperarRetenida(reten.X); await esperarRetenida(reten.Y)
      await Promise.all([X.enviar('Fetch.continueRequest', { requestId: reten.X[0] }), Y.enviar('Fetch.continueRequest', { requestId: reten.Y[0] })])
      await qx(); await qy()
      for (const p of [X, Y]) await p.hasta("document.body.innerText.includes('Comprobado ahora') || document.body.innerText.includes('El servidor no activó este teléfono con ese código')", 10000, 'resultado de la carrera')
      const rx = await registro(X, 'G06'); const ry = await registro(Y, 'G06')
      const estados = [rx.estado, ry.estado].sort()
      assert.deepEqual(estados, ['activada', 'denegada'], `carrera: ${estados}`)
      const [ganador, perdedor, pg, pp] = rx.estado === 'activada' ? [rx, ry, X, Y] : [ry, rx, Y, X]
      recordarToken(ganador); recordarToken(perdedor)
      assert.equal(perdedor.conIncierto, false); assert.equal(perdedor.deviceId, null)
      assert.notEqual(ganador.tokenHash, perdedor.tokenHash)
      assert.equal((await controlDe('G06')).credencial, 'activa')
      await captura('06-perdedor.png', pp)
      await sinTexto(pp, 'Comprobado ahora')
      // el perdedor nunca fue controlador: su token no sirve para leer el estado
      assert.equal((await estadoConToken('G06', perdedor.token)).status, 401)
      assert.equal((await estadoConToken('G06', ganador.token)).status, 200)
      globalThis.__carrera = { ganador, perdedor, pg, pp, ctxX, ctxY, X, Y, codigo }
    } catch (e) {
      for (const p of [X, Y]) { try { await cerrarPestana(p) } catch { /* ya */ } }
      throw e
    }
  })

  await paso('8. Revocación del organizador ANTES del inicio y código nuevo: el teléfono antiguo conserva su registro tras el 401; el otro se activa con SU identidad', async () => {
    const { ganador, perdedor, pg, pp, ctxX, ctxY, X, Y } = globalThis.__carrera
    try {
      const antes = await crudo(pg, 'G06')
      const r = await revocar('G06')
      assert.equal(r.credencialesRevocadas, 1)
      assert.equal((await controlDe('G06')).credencial, 'ninguna')
      await clic(pg, 'Comprobar ahora')
      await hayTexto(pg, 'no está activa ahora. Puede estar revocada, vencida o solo admitir reintentos de recibos; no sabemos cuál')
      await hayTexto(pg, 'El organizador puede revisar el control de este partido')
      assert.equal(await crudo(pg, 'G06'), antes, 'el 401 cambió el registro del teléfono antiguo')
      assert.equal(await pg.evalu("[...document.querySelectorAll('button')].some((b) => /borrar|eliminar|reemplaz|descartar|olvidar|quitar|limpiar|empezar de nuevo|nueva identidad/i.test(b.textContent))"), false)
      await captura('07-antiguo-tras-revocacion.png', pg)
      // código nuevo para el otro teléfono, que usa su identidad ya guardada
      const nuevo = recordarCodigo(await emitirCodigo('G06'))
      await escribirCodigo(pp, nuevo)
      await hayTexto(pp, 'Comprobado ahora')
      const despues = await registro(pp, 'G06')
      assert.deepEqual([despues.estado, despues.token, despues.tokenHash, despues.intentos], ['activada', perdedor.token, perdedor.tokenHash, 2])
      assert.equal((await controlDe('G06')).credencial, 'activa')
      assert.equal((await estadoConToken('G06', perdedor.token)).status, 200)
      assert.equal((await estadoConToken('G06', ganador.token)).status, 401)
      assert.equal(await crudo(pg, 'G06'), antes, 'el teléfono antiguo cambió')
      sinComandos(X, Y)
      await sinSecretos(pg, TODOS_CODIGOS, TODOS_TOKENS); await sinSecretos(pp, TODOS_CODIGOS, TODOS_TOKENS)
    } finally {
      for (const p of [X, Y]) { await cerrarPestana(p) }
      await enviarNavegador('Target.disposeBrowserContext', { browserContextId: ctxX }); await enviarNavegador('Target.disposeBrowserContext', { browserContextId: ctxY })
      delete globalThis.__carrera
      await A.enviar('Page.bringToFront')
    }
  })

  await paso('9. 401 de la lectura protegida (credencial no activa, p. ej. solo reintentos de recibos): el registro NO se toca. Aquí se inyecta el 401; que el servidor lo dé en recuperación lo prueba el test del backend', async () => {
    const antes = await crudo(A, 'G01')
    const quitar = await interceptar(A, '*/estado', 'Request', (m) => responderFalso(A, m, 401, '{"error":"no-autorizado"}'))
    await abrir(A, 'G01')
    await hayTexto(A, 'no está activa ahora. Puede estar revocada, vencida o solo admitir reintentos de recibos; no sabemos cuál')
    await hayTexto(A, 'Activación guardada')
    await sinTexto(A, 'Comprobado ahora')
    assert.equal(await crudo(A, 'G01'), antes)
    await quitar()
    await abrir(A, 'G01'); await hayTexto(A, 'Comprobado ahora') // al volver a valer, se ve
  })

  await paso('10. Lectura 507: solo el JSON exacto confirma el acceso (sin inventar dispositivo, fechas ni estado); lo malformado queda sin resolver', async () => {
    const antes = await crudo(A, 'G01')
    let modo = null
    const quitar = await interceptar(A, '*/estado', 'Request', (m) => {
      if (modo === 'exacto') responderFalso(A, m, 507, '{"error":"estado-demasiado-grande"}')
      else if (modo === 'otro-error') responderFalso(A, m, 507, '{"error":"otra-cosa"}')
      else if (modo === 'extra') responderFalso(A, m, 507, '{"error":"estado-demasiado-grande","x":1}')
      else if (modo === 'html') responderFalso(A, m, 507, '<html>estado-demasiado-grande</html>', 'text/html')
      else if (modo === 'vacio') responderFalso(A, m, 200, '{"hola":1}')
      else if (modo === 'pagina') responderFalso(A, m, 200, '<html></html>', 'text/html')
      else A.enviar('Fetch.continueRequest', { requestId: m.requestId }).catch(() => {})
    })
    modo = 'exacto'
    await abrir(A, 'G01')
    await hayTexto(A, 'Acceso confirmado; no se pudo cargar el estado.')
    await hayTexto(A, 'no indica que el partido esté listo para puntuar')
    // lo que se vea de fechas es lo YA guardado y así se rotula; nada es «comprobado ahora»
    await hayTexto(A, 'Último dato leído del servidor'); await sinTexto(A, 'Leído del servidor:'); await sinTexto(A, 'Comprobado ahora'); await sinTexto(A, 'dev-')
    assert.equal(await crudo(A, 'G01'), antes, 'el 507 modificó un registro ya confirmado')
    for (const m of ['otro-error', 'extra', 'html', 'vacio', 'pagina']) {
      modo = m
      await abrir(A, 'G01')
      await hayTexto(A, 'No pudimos comprobarlo ahora')
      await sinTexto(A, 'Acceso confirmado; no se pudo cargar el estado.')
      assert.equal(await crudo(A, 'G01'), antes, `${m} modificó el registro`)
    }
    await quitar()
    // un registro SIN resolver (incierto) + 507 exacto: pasa a «activada» sin dispositivo ni fechas inventados
    await abrir(A, 'G07')
    const q2 = await interceptar(A, '*/activar', 'Response', (m) => A.enviar('Fetch.failRequest', { requestId: m.requestId, errorReason: 'ConnectionReset' }).catch(() => {}))
    await escribirCodigo(A, recordarCodigo(await emitirCodigo('G07')))
    await hayTexto(A, 'No sabemos si el servidor activó este teléfono')
    await q2()
    recordarToken(await registro(A, 'G07'))
    const q3 = await interceptar(A, '*/estado', 'Request', (m) => responderFalso(A, m, 507, '{"error":"estado-demasiado-grande"}'))
    await clic(A, 'Comprobar ahora')
    await hayTexto(A, 'Acceso confirmado; no se pudo cargar el estado.')
    await sinTexto(A, 'Puede procesar acciones hasta'); await sinTexto(A, 'dev-')
    const r = await registro(A, 'G07')
    assert.deepEqual([r.estado, r.conIncierto, r.deviceId, r.servidor], ['activada', false, null, null])
    await q3()
    await captura('08-acceso-confirmado.png')
  })

  await paso('11. Sin conexión: se dice con la frase aprobada y no sale NADA (ni petición, ni identidad, ni registro)', async () => {
    await abrir(A, 'G08')
    const codigo = recordarCodigo(await emitirCodigo('G08'))
    const claves0 = await clavesLocales(A)
    const antes = posts(A).length
    await A.enviar('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    try {
      await A.hasta('navigator.onLine === false', 3000)
      await escribirCodigo(A, codigo)
      await hayTexto(A, FRASE)
      assert.equal(posts(A).length, antes)
      assert.deepEqual(await clavesLocales(A), claves0, 'se guardó algo sin conexión')
    } finally { await A.enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }) }
    await A.hasta('navigator.onLine === true', 3000)
    // con un registro ya confirmado, «Comprobar ahora» sin conexión tampoco sale
    await abrir(A, 'G02'); await hayTexto(A, 'Comprobado ahora')
    const lecturas = gets(A, '/G02/estado').length
    await A.enviar('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    try {
      await A.hasta('navigator.onLine === false', 3000)
      await clic(A, 'Comprobar ahora')
      await hayTexto(A, FRASE)
      assert.equal(gets(A, '/G02/estado').length, lecturas)
    } finally { await A.enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }) }
    await A.hasta('navigator.onLine === true', 3000)
    await abrir(A, 'G08')
    assert.equal(await registro(A, 'G08'), null)
  })

  await paso('12. Almacenamiento: cuota, verificación de lectura y registro ilegible → no se envía nada y nada queda a medias', async () => {
    await abrir(A, 'G09')
    const codigo = recordarCodigo(await emitirCodigo('G09'))
    const antes = posts(A).length
    await A.evalu("Storage.prototype.setItem = function () { throw new DOMException('cuota', 'QuotaExceededError') }")
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'No pudimos guardar en este teléfono el registro necesario')
    await hayTexto(A, 'No se envió nada.')
    assert.equal(posts(A).length, antes)
    await A.recargar(); await hayTexto(A, 'Alfa — Beta') // restaura Storage
    assert.equal(await registro(A, 'G09'), null)
    // lectura de verificación que no coincide
    await A.evalu(`(() => { const g = Storage.prototype.getItem; const s = Storage.prototype.setItem; let w = false
      Storage.prototype.setItem = function (k, v) { if (k.startsWith(${js(PREFIJO)})) w = true; return s.call(this, k, v) }
      Storage.prototype.getItem = function (k) { return w && k === ${js(clave('G09'))} ? '{"x":1}' : g.call(this, k) } })()`)
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'No pudimos guardar en este teléfono el registro necesario')
    assert.equal(posts(A).length, antes, 'se envió con el registro sin verificar')
    await A.recargar(); await hayTexto(A, 'Alfa — Beta')
    assert.equal(await registro(A, 'G09'), null, 'quedó un registro a medias')
    // registro ilegible: se conserva sin tocar y bloquea ese partido
    await abrir(A, 'G10')
    await A.evalu(`localStorage.setItem(${js(clave('G10'))}, '{"basura":true}')`)
    await A.recargar(); await hayTexto(A, 'registro de control ilegible o inesperado')
    assert.equal(await crudo(A, 'G10'), '{"basura":true}')
    assert.equal(await A.evalu("document.getElementById('codigo-partido')"), null)
    assert.equal(posts(A).filter((x) => x.url.includes('/G10/')).length, 0)
    await captura('09-registro-ilegible.png')
  })

  await paso('13. Bytes exactos y capacidad: con un byte menos del hueco necesario se rechaza (sin enviar ni borrar); con el hueco exacto se activa y termina de guardarse', async () => {
    await abrir(A, 'G11')
    const codigo = recordarCodigo(await emitirCodigo('G11'))
    const llenar = (extra) => A.evalu(`(() => {
      const bytes = (t) => new TextEncoder().encode(t).length
      const k = ${js(PREFIJO)} + 'relleno:1'
      localStorage.removeItem(k)
      let total = 0
      for (let i = 0; i < localStorage.length; i += 1) { const c = localStorage.key(i); if (c.startsWith(${js(PREFIJO)})) total += bytes(c) + bytes(localStorage.getItem(c)) }
      const reserva = bytes(${js(clave('G11'))}) + ${MAX_REGISTRO_BYTES}
      const objetivo = ${MAX_TOTAL_BYTES} - reserva + ${extra}
      const resto = objetivo - total - bytes(k)
      if (resto < 0) throw new Error('el almacenamiento ya pasa del objetivo: ' + total)
      localStorage.setItem(k, 'é'.repeat(Math.floor(resto / 2)) + (resto % 2 ? 'x' : ''))
      let t2 = 0
      for (let i = 0; i < localStorage.length; i += 1) { const c = localStorage.key(i); if (c.startsWith(${js(PREFIJO)})) t2 += bytes(c) + bytes(localStorage.getItem(c)) }
      return { total: t2, objetivo, reserva }
    })()`)
    const l1 = await llenar(1) // un byte MENOS de hueco del necesario
    assert.equal(l1.total, l1.objetivo)
    const relleno = await A.evalu(`localStorage.getItem(${js(PREFIJO + 'relleno:1')})`)
    const antes = posts(A).length
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'Hay demasiados registros de control guardados en este teléfono')
    assert.equal(await A.evalu("document.body.innerText.match(/Hay demasiados registros[^\\n]*/)?.[0].match(/borrar (todos )?los datos|datos del sitio/i)"), null, 'recomienda borrar los datos del sitio')
    assert.equal(posts(A).length, antes, 'se envió con el almacenamiento lleno')
    assert.equal(await registro(A, 'G11'), null)
    assert.equal(await A.evalu(`localStorage.getItem(${js(PREFIJO + 'relleno:1')})`), relleno, 'se expulsó algo')
    await captura('10-capacidad.png')
    const l2 = await llenar(0) // hueco EXACTO
    assert.equal(l2.total, l2.objetivo)
    await escribirCodigo(A, codigo)
    await hayTexto(A, 'Comprobado ahora')
    const r = recordarToken(await registro(A, 'G11'))
    assert.equal(r.estado, 'activada')
    const total = await A.evalu(`(() => { const b = (t) => new TextEncoder().encode(t).length; let t = 0; for (let i = 0; i < localStorage.length; i += 1) { const c = localStorage.key(i); if (c.startsWith(${js(PREFIJO)})) t += b(c) + b(localStorage.getItem(c)) } return t })()`)
    assert.ok(total <= MAX_TOTAL_BYTES, `pasa del tope: ${total}`)
    await A.evalu(`localStorage.removeItem(${js(PREFIJO + 'relleno:1')})`) // limpieza del escenario de prueba
  })

  await paso('14. Encabezados de /control/*: sin caché y sin indexar (si el entorno local los aplica a los archivos estáticos)', async () => {
    const r = await api(`/control/${LIGA}/G01`)
    assert.equal(r.status, 200)
    const cc = r.headers.get('cache-control') ?? ''; const robots = r.headers.get('x-robots-tag') ?? ''
    assert.match(cc, /no-store/, `cache-control: ${cc}`)
    assert.match(robots, /noindex/, `x-robots-tag: ${robots}`)
    assert.equal(await A.evalu("document.querySelector('meta[name=robots]')?.content"), 'noindex')
  })

  await paso('15. Secretos, aislamiento del prototipo y del panel del organizador, y consola limpia', async () => {
    await abrir(A, 'G01')
    await sinSecretos(A, TODOS_CODIGOS, TODOS_TOKENS)
    // ningún código ni token en el almacenamiento de NINGUNA pestaña de este teléfono; solo claves propias y el registro del panel (intacto)
    const claves = await clavesLocales(A)
    for (const k of claves) assert.ok(k.startsWith(PREFIJO) || k === `sebel.op.v1:org-sintetico:${LIGA}`, `clave inesperada ${k}`)
    assert.equal(await A.evalu(`localStorage.getItem('sebel.op.v1:org-sintetico:${LIGA}')`), SENTINELA, 'se tocó el registro del panel del organizador')
    // la base del prototipo (Dexie) no cambió
    assert.equal(await volcadoIDB(A), IDB_ANTES, 'cambió la base local del prototipo')
    // ninguna petición con cookies del organizador ni a /comandos
    sinComandos(A)
    const errores = A.consola.filter((l) => /^(error|warning)/i.test(l) && !/Failed to load resource|ERR_|net::/i.test(l))
    assert.deepEqual(errores, [])
    for (const l of A.consola) { for (const c of TODOS_CODIGOS) assert.ok(!l.includes(c)); for (const t of TODOS_TOKENS) assert.ok(!l.includes(t)) }
    return `códigos usados: ${TODOS_CODIGOS.length}; tokens guardados: ${TODOS_TOKENS.length}; ninguno aparece fuera de su lugar`
  })
} catch (e) {
  resultados.push({ nombre: 'preparación', ok: false, nota: String(e.stack ?? e).split('\n').slice(0, 8).join(' ⏎ ') })
} finally {
  for (const p of hijos.reverse()) await matar(p)
  rmSync(ESTADO, { recursive: true, force: true, maxRetries: 3 })
}

let fallos = 0
for (const r of resultados) { if (!r.ok) fallos += 1; console.log(`${r.ok ? 'OK ' : 'FALLA'}  ${r.nombre}${r.nota ? `  —  ${r.nota}` : ''}`) }
console.log(fallos === 0 ? 'NAVEGADOR DE ACTIVACIÓN: OK' : `NAVEGADOR DE ACTIVACIÓN: ${fallos} FALLO(S)`)
