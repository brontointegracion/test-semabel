// Comprobación en un navegador REAL (Chrome con perfil desechable) de las pantallas PÚBLICAS del modo compartido
// (Inicio «/», liga «/liga/:ligaId» y marcador «/liga/:ligaId/partido/:gameId»), con la APLICACIÓN REAL compilada en modo compartido:
//   una pestaña hace de TELÉFONO DE CONTROL (activación con código real y la pantalla de puntuación real) y otra de VISITANTE, sin
//   credenciales. Se comprueba: antes de empezar (programado atrasado), puntos y faltas, reloj (arrancar, detener, 00:00, corregir),
//   Inicio y Liga, sin red («Sin actualizar»), cierre (pasa a resultados), corrección POSTERIOR al final que aparece en el refresco
//   acotado, ancho de teléfono, pantalla completa y que el visitante solo pide las lecturas públicas. REPORT_136: liga → equipo →
//   plantilla con número y nombre completo (el 0 incluido) → resultado → marcador, estadísticas de partidos finales y su cambio tras
//   una corrección posterior al final con el botón «Actualizar» (sin sondeo de 5 s), enlaces sin romper y 390 px.
//   - compila en un directorio TEMPORAL (no toca ../dist) con VITE_LIGAS_PUBLICAS=LIGAPUBH1; wrangler dev local con almacenamiento
//     temporal; Chrome con perfil desechable y puerto de depuración propio; datos SINTÉTICOS; no usa Cloudflare.
//   - al terminar mata TODOS sus procesos y borra el perfil y el almacenamiento temporales (las capturas y el registro se conservan).
// Uso (desde backend/):  CAPTURAS=<carpeta> node scripts/navegador-publico.mjs
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const RAIZ = resolve(import.meta.dirname, '..')
const REPO = resolve(RAIZ, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'publico')
const CAPTURAS = process.env.CAPTURAS ?? join(RAIZ, '.wrangler-state', 'publico-capturas')
const PUERTO = 8797
const PUERTO_CDP = 9343
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // solo este proceso, solo para el certificado autofirmado local
const ORIGEN = `https://localhost:${PUERTO}`
const OPERADOR = 'operador-publico-sintetico-0000000001'
const SEMILLA = 'semilla-publica-sintetica-0000001'
const LIGA = 'LIGAPUBH1'
const CHROME = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync)

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ESTADO, { recursive: true })
const DIST = join(ESTADO, 'dist')
const PERFIL = join(ESTADO, 'perfil-chrome')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const js = JSON.stringify
const tiene = (texto, s) => texto.toLowerCase().includes(s.toLowerCase()) // el texto visible respeta text-transform (MAYÚSCULAS)

execFileSync(join(REPO, 'node_modules', '.bin', 'vite'), ['build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: REPO, env: { ...process.env, VITE_MODO_COMPARTIDO: '1', VITE_LIGAS_PUBLICAS: LIGA }, stdio: 'inherit',
})
assert.ok(existsSync(join(DIST, 'sw.js')), 'la compilación no generó sw.js')
const salidaCliente = join(ESTADO, 'cliente-publico.mjs')
execFileSync(join(RAIZ, 'node_modules', '.bin', 'esbuild'), [
  join(RAIZ, 'scripts', 'cliente-publico.js'), '--bundle', '--format=esm', '--platform=node', `--outfile=${salidaCliente}`, '--log-level=error',
], { stdio: 'inherit' })
const { sobreAnular } = await import(pathToFileURL(salidaCliente).href)

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
const admin = (ruta, cuerpo) => api(ruta, { method: 'POST', headers: { authorization: `Bearer ${OPERADOR}`, 'content-type': 'application/json' }, body: js(cuerpo ?? {}) })
const f = (id, equipoId, nombrePila, apellido1, dorsal) => ({ id, equipoId, nombrePila, apellido1, apellido2: '', dorsal, personaId: `persona-pub-${id}` })
// P: ya pasó su hora programada (atrasado) y es el que se puntúa. Q: futuro lejano, cruza la fecha UTC (21:30 del sábado en Panamá).
// R: sin hora conocida. Q tiene un equipo de nombre muy largo.
const payload = {
  liga: { id: LIGA, nombre: 'Liga pública sintética', deporte: 'baloncesto', minutosPorPeriodo: 10, categoria: 'mini-basketball', subcategoria: { clave: 'u10' } },
  equipos: [{ id: 'E1', nombre: 'Alfa Norte' }, { id: 'E2', nombre: 'Beta Sur' }, { id: 'E3', nombre: 'Los Tigres del Barrio Norte de la Ciudad' }, { id: 'E4', nombre: 'Delta Oeste' }],
  jugadores: [
    f('J1', 'E1', 'Ana', 'Prueba', 0), f('J2', 'E1', 'Saúl', 'Montero', 2), f('J3', 'E1', 'Beto', 'Muestra', 7),
    f('K1', 'E2', 'Eva', 'Visita', 1), f('K2', 'E2', 'Hugo', 'Cuatro', 4),
  ],
  partidos: [
    { id: 'P', localId: 'E1', visitaId: 'E2', programadoPara: '2026-10-04T19:00:00Z', sede: 'Cancha A' },
    { id: 'Q', localId: 'E3', visitaId: 'E4', programadoPara: '2030-11-03T02:30:00Z', sede: 'Cancha B' },
    { id: 'R', localId: 'E1', visitaId: 'E3' },
  ],
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
  const t = { nombre, viva: true, consola: [], peticiones: [], destinoId: destino.id }
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && pendientes.has(m.id)) { const { ok, ko } = pendientes.get(m.id); pendientes.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') t.consola.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 220))
    if (m.method === 'Network.requestWillBeSent') t.peticiones.push({ url: m.params.request.url, metodo: m.params.request.method, cuerpo: m.params.request.postData ?? null, cabeceras: Object.keys(m.params.request.headers ?? {}).map((k) => k.toLowerCase()), t: Date.now() })
    oyentes.slice().forEach((fn) => fn(m))
  }
  const enviar = (metodo, params = {}) => new Promise((ok, ko) => { id += 1; pendientes.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method: metodo, params })) })
  const evalu = async (expresion, gesto = false) => {
    const r = await enviar('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true, userGesture: gesto })
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
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await enviar(`${d}.enable`)
  await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const p = {
    ...t, ws, enviar, evalu, hasta, navegar,
    v1: () => t.peticiones.filter((x) => x.url.includes('/v1/')),
    texto: async () => (await evalu('document.body.innerText')).toLowerCase(),
    hayTexto: (tx, ms = 10000) => hasta(`document.body.innerText.toLowerCase().includes(${js(tx.toLowerCase())})`, ms, `texto «${tx}»`),
    sinTexto: (tx, ms = 10000) => hasta(`!document.body.innerText.toLowerCase().includes(${js(tx.toLowerCase())})`, ms, `sin texto «${tx}»`),
    clic: (nombreBoton) => evalu(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => ((x.getAttribute('aria-label') || x.textContent).trim() === ${js(nombreBoton)}) && !x.disabled); if (!b) throw new Error('no hay botón activo «${nombreBoton}»'); b.click(); return true })()`),
    clicContiene: (parte) => evalu(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => ((x.getAttribute('aria-label') || x.textContent).trim().includes(${js(parte)})) && !x.disabled); if (!b) throw new Error('no hay botón activo que contenga «${parte}»'); b.click(); return true })()`),
    captura: async (archivo) => writeFileSync(join(CAPTURAS, archivo), Buffer.from((await enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64')),
    sinConexion: (off) => enviar('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    cerrarDestino: async () => { p.viva = false; try { ws.close() } catch { /* nada */ } await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${destino.id}`).catch(() => {}) },
  }
  Object.defineProperty(p, 'consola', { get: () => t.consola })
  pestanas.push(p)
  return p
}
const nuevaPestana = async (nombre) => conectar(await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json(), nombre)
// Una pestaña en una VENTANA PROPIA: así las dos (control y visitante) están visibles a la vez y la del visitante sigue refrescándose
// (una pestaña en segundo plano está «oculta» y, por diseño, no refresca).
async function nuevaVentana(nombre) {
  const navegador = new WebSocket((await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).json()).webSocketDebuggerUrl)
  await new Promise((r, j) => { navegador.onopen = r; navegador.onerror = j })
  const { targetId } = await new Promise((ok, ko) => {
    navegador.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id === 1) (m.error ? ko(new Error(m.error.message)) : ok(m.result)) }
    navegador.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true, width: 420, height: 900 } }))
  })
  navegador.close()
  const destino = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json`)).json()).find((d) => d.id === targetId)
  return conectar(destino, nombre)
}

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
  const codigoDe = async (g) => {
    const r = await api(`/v1/organizador/ligas/${LIGA}/partidos/${g}/codigo`, { method: 'POST', headers: { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json', cookie: `__Host-sesion=${COOKIE}` }, body: '{}' })
    assert.equal(r.status, 200, `código de ${g}`)
    return (await r.json()).codigo
  }

  chrome = lanzar(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${PERFIL}`, '--ignore-certificate-errors',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ])
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break } catch { await espera(250) } }

  let A = null // teléfono de control
  let B = null // visitante
  const claveAct = `sebel.ctl.act.v1:${LIGA}:P`
  const sincroTexto = (p) => p.evalu("document.querySelector('[data-sincro]')?.textContent ?? ''")
  const confirmadas = async (p) => Number(/Confirmado por el servidor: (\d+)/.exec(await sincroTexto(p))?.[1] ?? NaN)
  const confirmandoUna = async (p, accion, etiqueta) => {
    const antes = await confirmadas(p)
    await accion()
    await p.hasta(`(() => { const m = /Confirmado por el servidor: (\\d+)/.exec(document.querySelector('[data-sincro]')?.textContent ?? ''); return m && Number(m[1]) >= ${antes + 1} })()`, 20000, `${etiqueta}: una orden más confirmada`)
  }
  const relojPublico = (p) => p.evalu("document.querySelector('[aria-label=\"Reloj del partido\"]')?.textContent ?? null")
  const mmssASeg = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s }
  const puntosPublicos = (p, equipo) => p.evalu(`document.querySelector('[aria-label="Puntos de ${equipo}"]')?.textContent ?? null`)
  const faltasPublicas = (p) => p.evalu("[...document.querySelectorAll('.faltas-partido .lado b')].map((b) => b.textContent)")
  const sinDesborde = async (p) => {
    const m = await p.evalu('({ ancho: innerWidth, scrollX: document.documentElement.scrollWidth })')
    assert.ok(m.scrollX <= m.ancho, `desborda ${m.scrollX} > ${m.ancho}`)
    return m
  }
  const PUB = `/liga/${LIGA}/partido/P`
  const EQUIPO = `/liga/${LIGA}/equipo/E1`
  /** Corrección real posterior al final con la credencial del teléfono de control: anula el primer punto vivo que cumpla `cuando`. */
  const anularTrasFinal = async (cmdId, cuando) => {
    const token = await A.evalu(`JSON.parse(localStorage.getItem(${js(claveAct)})).token`)
    const e = await (await api(`/v1/ligas/${LIGA}/partidos/P/estado`, { headers: { authorization: `Bearer ${token}` } })).json()
    const ev = e.estado.eventos.find((x) => x.tipo === 'punto' && !x.anulado && cuando(x))
    assert.ok(ev, 'no hay evento que anular')
    const sobre = sobreAnular({ gameId: 'P', rev: e.cursor.rev, eventoId: ev.id, deviceId: e.deviceId, clientSeq: e.cursor.ultimoClientSeq + 1, cmdId, t: Date.now() })
    const r = await api(`/v1/ligas/${LIGA}/partidos/P/comandos`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: js(sobre) })
    assert.equal(r.status, 200, 'comando de corrección')
    assert.equal((await r.json()).resultado, 'aceptado', 'la corrección no se aceptó')
  }
  /** Texto de la fila de una tabla de jugadores por nombre (ya en minúsculas por texto visible) → [celdas]. */
  const filaDe = (p, nombre) => p.evalu(`(() => { const tr = [...document.querySelectorAll('table[aria-label="Plantilla actual"] tr')].find((r) => r.innerText.toLowerCase().includes(${js(nombre.toLowerCase())})); return tr ? [...tr.querySelectorAll('td')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim()) : null })()`)

  await paso('1. Visitante sin credenciales, antes de empezar: Inicio muestra el programado atrasado como «Pendiente de comenzar»; fechas en Panamá; sin «Soy organizador»', async () => {
    B = await nuevaVentana('B')
    await B.navegar('/')
    await B.hayTexto('Próximos partidos', 20000)
    await B.hayTexto('Pendiente de comenzar', 20000)
    const t = await B.texto()
    for (const s of ['Alfa Norte', 'Beta Sur', 'Cancha A', 'Cancha B', '14:00', '21:30', 'Fecha por confirmar', 'sáb 2 nov']) assert.ok(tiene(t, s), `falta «${s}»`)
    assert.ok(!tiene(t, 'Soy organizador'), 'aparece «Soy organizador»')
    assert.ok(tiene(t, 'No hay partidos jugándose'), 'Ahora mismo no está vacío')
    assert.equal(await B.evalu('document.cookie'), '', 'el visitante tiene cookies')
    await sinDesborde(B)
    await B.captura('01-inicio-antes.png')
    const pubs = B.v1().map((p) => p.url.replace(ORIGEN, ''))
    assert.deepEqual([...new Set(pubs)], [`/v1/ligas/${LIGA}/publico`])
    return `Inicio: P (atrasado, 14:00 Panamá) con «Pendiente de comenzar», Q «sáb 2 nov · 21:30» (02:30Z del domingo en UTC), R «Fecha por confirmar»; peticiones /v1: ${pubs.length} (solo la lectura de la liga)`
  })

  await paso('2. Teléfono de control real: activación y comienzo del partido', async () => {
    A = await nuevaVentana('A')
    const codigo = await codigoDe('P')
    await A.navegar(`/control/${LIGA}/P`)
    await A.hayTexto('Código del partido')
    await A.evalu("document.getElementById('codigo-partido').focus()")
    await A.enviar('Input.insertText', { text: codigo })
    await A.hasta("!document.querySelector('form button[type=submit]').disabled", 5000)
    await A.clic('Activar este teléfono')
    await A.hayTexto('Abrir control', 20000)
    await A.clic('Abrir control')
    await A.hayTexto('Comenzar el partido', 20000)
    await A.clic('Comenzar el partido')
    await A.hayTexto('Confirmar inicio')
    await A.clic('Confirmar inicio')
    await A.hasta("!!document.querySelector('[aria-label=\"#2 Saúl Montero más 2\"]')", 30000, 'botones de anotar tras el inicio')
    return 'partido P iniciado desde la pantalla de puntuación real'
  })

  await paso('3. Marcador público: EN VIVO, 0-0, periodo, reloj detenido 10:00, «Faltas del partido»; la acción real se ve sola en ≤ 12 s (refresco de 5 s)', async () => {
    await B.navegar(PUB)
    await B.hayTexto('Faltas del partido', 20000)
    const t = await B.texto()
    for (const s of ['EN VIVO', 'Periodo 1', 'Reloj detenido', 'Alfa Norte', 'Beta Sur', 'Cancha A', 'semabel.com']) assert.ok(tiene(t, s), `falta «${s}»`)
    assert.equal(await relojPublico(B), '10:00')
    assert.equal(await puntosPublicos(B, 'Alfa Norte'), '0')
    await B.captura('02-marcador-inicio.png')
    const antesPeticiones = B.v1().length
    await confirmandoUna(A, () => A.clic('#2 Saúl Montero más 2'), 'punto')
    await B.hasta(`document.querySelector('[aria-label="Puntos de Alfa Norte"]')?.textContent === '2'`, 12000, 'el punto aparece en el marcador público')
    await confirmandoUna(A, () => A.clic('Falta de #2 Saúl Montero'), 'falta')
    await B.hasta("[...document.querySelectorAll('.faltas-partido .lado b')][0]?.textContent === '1'", 12000, 'la falta aparece')
    assert.deepEqual(await faltasPublicas(B), ['1', '0'])
    await confirmandoUna(A, () => A.clic('#0 Ana Prueba más 3'), 'triple')
    await B.hasta(`document.querySelector('[aria-label="Puntos de Alfa Norte"]')?.textContent === '5'`, 12000)
    await B.captura('03-marcador-puntos.png')
    // cadencia: las peticiones del partido van separadas por ≥ ~5 s
    const juego = B.v1().filter((p) => p.url.endsWith('/partidos/P')).map((p) => p.t)
    const huecos = juego.slice(1).map((x, i) => x - juego[i])
    assert.ok(huecos.every((h) => h >= 4500), `peticiones demasiado seguidas: ${huecos}`)
    return `puntos y falta reales visibles solos en la pantalla pública; ${juego.length} lecturas del partido, hueco mínimo ${Math.min(...huecos)} ms (nuevas desde la carga: ${B.v1().length - antesPeticiones})`
  })

  await paso('4. Reloj: arrancar (corre a la hora del servidor), detener, 00:00 (no es final) y corregir', async () => {
    await confirmandoUna(A, () => A.clicContiene('Arrancar'), 'arrancar')
    await B.hasta("document.querySelector('.board .medio .reloj') && !document.querySelector('.board .medio .reloj.detenido')", 15000, 'el reloj corre en el público')
    const r1 = mmssASeg(await relojPublico(B))
    await espera(3000)
    const r2 = mmssASeg(await relojPublico(B))
    assert.ok(r1 - r2 >= 2 && r1 - r2 <= 4, `el reloj no avanzó ~3 s: ${r1} → ${r2}`)
    const enControl = mmssASeg(await A.evalu("document.querySelector('.reloj-consola')?.textContent.match(/\\d\\d:\\d\\d/)?.[0] ?? '00:00'"))
    const enPublico = mmssASeg(await relojPublico(B))
    assert.ok(Math.abs(enControl - enPublico) <= 3, `el público (${enPublico}) y el control (${enControl}) difieren`)
    await B.captura('04-reloj-corriendo.png')
    await confirmandoUna(A, () => A.clicContiene('Detener'), 'detener')
    await B.hayTexto('Reloj detenido', 12000)
    const poner = (v) => A.evalu(`(() => { const i = document.getElementById('cp-reloj'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(i, ${js(v)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await A.hasta("document.querySelector('.cp-corregir') !== null", 10000)
    await poner('00:00')
    await confirmandoUna(A, () => A.clic('Corregir'), 'corregir a cero')
    await B.hayTexto('Fin del período', 12000)
    const t = await B.texto()
    assert.ok(tiene(t, 'EN VIVO') && !/\bfinal\b/i.test(t.replace(/fin del período/gi, '')), '00:00 se mostró como final')
    assert.equal(await relojPublico(B), '00:00')
    await B.captura('05-cero-no-es-final.png')
    await poner('08:30')
    await confirmandoUna(A, () => A.clic('Corregir'), 'corregir a 08:30')
    await B.hasta("document.querySelector('[aria-label=\"Reloj del partido\"]')?.textContent === '08:30'", 12000, 'la corrección del reloj')
    return `corrió: ${r1}→${r2} s en 3 s (control ${enControl}, público ${enPublico}); detenido; 00:00 = «Fin del período» y sigue EN VIVO; corregido a 08:30`
  })

  await paso('5. Inicio y Liga con el partido en vivo: marcador, periodo, reloj, sede, categoría; enlaces sin credenciales; 390 px sin desborde', async () => {
    await B.navegar('/')
    await B.hayTexto('Ahora mismo', 20000)
    await B.hasta("document.querySelector('.hm-marcador') !== null", 15000)
    const tarjeta = await B.evalu("document.querySelector('.hm-marcador').innerText")
    for (const s of ['En vivo', 'Alfa Norte', 'Beta Sur', '1º cuarto', '08:30', 'Cancha A', 'Reloj detenido']) assert.ok(tiene(tarjeta, s), `la tarjeta no dice «${s}»: ${tarjeta}`)
    assert.ok(!tiene(await B.texto(), 'Pendiente de comenzar'), 'ya no hay programados atrasados (P empezó)')
    await sinDesborde(B)
    await B.captura('06-inicio-vivo.png')
    await B.evalu("document.querySelector('.hm-marcador').click()")
    await B.hayTexto('Faltas del partido', 15000)
    await B.clic('Ver liga')
    await B.hayTexto('Resultados', 15000)
    const t = await B.texto()
    for (const s of ['Categoría Mini baloncesto', 'U10', 'En vivo', 'Próximos partidos', 'Los Tigres del Barrio Norte de la Ciudad', 'Cancha A']) assert.ok(tiene(t, s), `la liga no dice «${s}»`)
    assert.ok(!/jugadores|posiciones/i.test(t), 'la liga muestra jugadores o tabla')
    await sinDesborde(B)
    await B.captura('07-liga-vivo.png')
    return 'Inicio y Liga muestran el partido en vivo (1º cuarto, 08:30, Cancha A, categoría Mini baloncesto U10); navegación Inicio → marcador → liga sin credenciales; sin desborde a 390 px'
  })

  await paso('6. Sin red: se conserva el último dato y se dice «Sin actualizar»; al volver, desaparece', async () => {
    await B.navegar(PUB)
    await B.hayTexto('Faltas del partido', 15000)
    await B.sinConexion(true)
    limpiezas.push(async () => { await B.sinConexion(false) })
    await B.hayTexto('Sin actualizar', 20000)
    const t = await B.texto()
    assert.ok(tiene(t, 'último dato confirmado a las'), 'no dice cuándo fue el último dato')
    assert.equal(await puntosPublicos(B, 'Alfa Norte'), '5', 'el dato conservado cambió')
    assert.ok(!tiene(t, 'Última jugada'), 'usa «Última jugada»')
    await B.captura('08-sin-actualizar.png')
    await B.sinConexion(false)
    await B.sinTexto('Sin actualizar', 30000)
    assert.ok(tiene(await B.texto(), 'Actualizado'), 'no vuelve a decir «Actualizado»')
    return 'sin red: dato conservado (Alfa 5), «Sin actualizar · último dato confirmado a las …»; al volver la red el aviso desaparece solo'
  })

  await paso('7. Cierre: el partido pasa a «Final» y a Resultados; la pantalla de Inicio deja de mostrarlo en vivo', async () => {
    await A.clic('Cerrar el partido')
    await A.hayTexto('¿Cerrar el partido?')
    await A.clic('Confirmar cierre')
    await A.hasta("document.querySelector('[data-sincro]').textContent.includes('pendiente de enviar: 0')", 20000, 'cierre confirmado')
    await B.hayTexto('Final', 15000)
    assert.equal(await relojPublico(B), null, 'queda reloj en un partido final')
    assert.ok(!tiene(await B.texto(), 'EN VIVO'), 'sigue EN VIVO')
    await B.captura('09-marcador-final.png')
    await B.navegar('/')
    await B.hayTexto('No hay partidos jugándose', 15000)
    await B.navegar(`/liga/${LIGA}`)
    await B.hayTexto('Resultados', 15000)
    const fila = await B.evalu("[...document.querySelectorAll('a.partido')].find((a) => /final/i.test(a.innerText))?.innerText ?? ''")
    assert.ok(tiene(fila, 'Alfa Norte') && fila.includes('5') && tiene(fila, 'Beta Sur'), `la fila de resultados: ${fila}`)
    await B.captura('10-liga-resultados.png')
    return 'Final en el marcador (sin reloj ni EN VIVO); Inicio sin partidos en vivo; Liga lista el resultado Alfa 5 – Beta 0'
  })

  await paso('7b. Liga → equipo → plantilla (#0 y nombre completo) → estadísticas de partidos finales → resultado → marcador; enlaces sin romper; 390 px', async () => {
    await B.navegar(`/liga/${LIGA}`)
    await B.hayTexto('Resultados', 15000)
    await B.clic('Alfa Norte') // la etiqueta del equipo en la liga es un enlace a su página
    await B.hayTexto('Plantilla', 15000)
    await B.hayTexto('Resultados', 15000)
    assert.equal(await B.evalu('location.pathname'), EQUIPO)
    const t = await B.texto()
    for (const s of ['Alfa Norte', 'Liga pública sintética', 'Jugador', 'Pts', 'Faltas']) assert.ok(tiene(t, s), `falta «${s}»`)
    assert.ok(!/\bgp\b|\bpj\b|partidos jugados(?! )|asistencias|rebotes/.test(t.replace('no se muestran partidos jugados', '')), 'muestra estadísticas no soportadas')
    // plantilla ordenada por número, con el 0 y los nombres completos
    const ana = await filaDe(B, 'Ana Prueba')
    const saul = await filaDe(B, 'Saúl Montero')
    const beto = await filaDe(B, 'Beto Muestra')
    assert.ok(/^#0\s+ana prueba$/i.test(ana[0]), `Ana: ${ana}`)
    assert.deepEqual([ana[1], ana[2]], ['3', '0'], 'puntos y faltas de Ana')
    assert.ok(/^#2\s+saúl montero$/i.test(saul[0]), `Saúl: ${saul}`)
    assert.deepEqual([saul[1], saul[2]], ['2', '1'], 'puntos y faltas de Saúl')
    assert.ok(/^#7\s+beto muestra$/i.test(beto[0]), `Beto: ${beto}`)
    assert.deepEqual([beto[1], beto[2]], ['0', '0'], 'Beto no anotó')
    const orden = await B.evalu("[...document.querySelectorAll('table[aria-label=\"Plantilla actual\"] tbody tr')].map((r) => r.querySelector('.num').innerText)")
    assert.deepEqual(orden, ['#0', '#2', '#7'], 'la plantilla va por número')
    await sinDesborde(B)
    await B.captura('14-equipo.png')
    // enlaces: cada uno lleva a una página que existe (ningún «No encontramos»)
    const enlaces = [...new Set(await B.evalu("[...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))"))]
    assert.ok(enlaces.length >= 2, `pocos enlaces: ${enlaces}`)
    for (const h of enlaces) {
      assert.ok(h === '/' || h.startsWith('/liga/'), `enlace inesperado ${h}`)
      await B.navegar(h)
      await B.hasta("document.body.innerText.length > 40 && !document.body.innerText.toLowerCase().includes('no encontramos')", 15000, `la página de ${h} existe`)
    }
    // resultado → marcador
    await B.navegar(EQUIPO)
    await B.hayTexto('Plantilla', 15000)
    await B.evalu("[...document.querySelectorAll('a.partido')].find((a) => /final/i.test(a.innerText)).click()")
    await B.hayTexto('Faltas del partido', 15000)
    assert.equal(await B.evalu('location.pathname'), PUB)
    assert.ok(tiene(await B.texto(), 'Final'))
    await B.captura('15-equipo-resultado-marcador.png')
    return `liga → equipo (${EQUIPO}): #0 Ana Prueba 3 pts, #2 Saúl Montero 2 pts/1 falta, #7 Beto Muestra 0/0, sin GP; ${enlaces.length} enlaces verificados (${enlaces.join(', ')}); resultado → marcador final; sin desborde a 390 px`
  })

  await paso('8. Corrección POSTERIOR al final: no aparece antes del refresco acotado (30 s) y sí después, por foco', async () => {
    await B.navegar(PUB)
    await B.hayTexto('Final', 15000)
    const peticiones0 = () => B.v1().filter((p) => p.url.endsWith('/partidos/P')).length
    const t0 = peticiones0()
    // corrección real con la credencial del teléfono de control (sobre armado con el motor)
    const token = await A.evalu(`JSON.parse(localStorage.getItem(${js(claveAct)})).token`)
    const e = await (await api(`/v1/ligas/${LIGA}/partidos/P/estado`, { headers: { authorization: `Bearer ${token}` } })).json()
    const triple = e.estado.eventos.find((x) => x.tipo === 'punto' && x.puntos === 3 && !x.anulado)
    assert.ok(triple, 'no hay triple que anular')
    const sobre = sobreAnular({ gameId: 'P', rev: e.cursor.rev, eventoId: triple.id, deviceId: e.deviceId, clientSeq: e.cursor.ultimoClientSeq + 1, cmdId: 'correccion-final-1', t: Date.now() })
    const r = await api(`/v1/ligas/${LIGA}/partidos/P/comandos`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: js(sobre) })
    assert.equal(r.status, 200, 'comando de corrección')
    assert.equal((await r.json()).resultado, 'aceptado', 'la corrección posterior al final no se aceptó')
    const tCorreccion = Date.now()
    const inicioLectura = B.v1().filter((p) => p.url.endsWith('/partidos/P')).at(-1).t
    await espera(8000)
    await B.evalu("window.dispatchEvent(new Event('focus'))")
    await espera(1000)
    assert.equal(peticiones0(), t0, 'el foco antes de 30 s provocó una petición')
    assert.equal(await puntosPublicos(B, 'Alfa Norte'), '5', 'el marcador cambió antes del refresco')
    await espera(Math.max(0, inicioLectura + 31_000 - Date.now()))
    await B.evalu("window.dispatchEvent(new Event('focus'))")
    await B.hasta(`document.querySelector('[aria-label="Puntos de Alfa Norte"]')?.textContent === '2'`, 10000, 'la corrección aparece tras el refresco por foco')
    assert.equal(peticiones0(), t0 + 1)
    await B.captura('11-correccion-final.png')
    return `triple anulado tras el cierre (aceptado); el foco a los ~9 s no pidió nada; a los ≥31 s pidió 1 vez y el marcador pasó de 5 a 2 (${Math.round((Date.now() - tCorreccion) / 1000)} s después de la corrección)`
  })

  await paso('8b. Estadísticas del equipo tras una corrección posterior al final: «Actualizar» las cambia; sin sondeo de 5 s', async () => {
    await B.navegar(EQUIPO)
    await B.hayTexto('Plantilla', 15000)
    const llamadasEquipo = () => B.v1().filter((p) => p.url.endsWith('/equipos/E1/publico'))
    const base = llamadasEquipo().length
    const ana = await filaDe(B, 'Ana Prueba')
    assert.deepEqual([ana[1], ana[2]], ['0', '0'], 'la corrección del paso 8 (triple de Ana) debe verse al abrir la página')
    assert.deepEqual((await filaDe(B, 'Saúl Montero')).slice(1), ['2', '1'])
    await anularTrasFinal('correccion-final-2', (x) => x.puntos === 2)
    const t0 = Date.now()
    await espera(12_000) // más de dos ciclos de 5 s: no debe haber ninguna petición nueva
    assert.equal(llamadasEquipo().length, base, 'hubo sondeo del equipo')
    assert.deepEqual((await filaDe(B, 'Saúl Montero')).slice(1), ['2', '1'], 'cambió sin actualizar')
    await espera(Math.max(0, 16_000 - (Date.now() - t0)))
    await B.clic('Actualizar')
    await B.hasta("(() => { const tr = [...document.querySelectorAll('table[aria-label=\"Plantilla actual\"] tr')].find((r) => /saúl montero/i.test(r.innerText)); return tr && tr.querySelectorAll('td')[1].innerText.trim() === '0' })()", 10000, 'los puntos de Saúl cambian tras Actualizar')
    assert.equal(llamadasEquipo().length, base + 1, 'Actualizar debe pedir una sola vez')
    assert.deepEqual((await filaDe(B, 'Saúl Montero')).slice(1), ['0', '1'], 'las faltas no cambian')
    const resultado = await B.evalu("[...document.querySelectorAll('a.partido')].find((a) => /final/i.test(a.innerText))?.innerText ?? ''")
    assert.ok(/alfa norte[\s\S]*0[\s\S]*beta sur[\s\S]*0/i.test(resultado), `el resultado debe quedar 0-0: ${resultado}`)
    await B.captura('16-equipo-tras-correccion.png')
    return `Saúl pasó de 2 a 0 puntos tras anular su +2 después del cierre: sin cambios durante 12 s (0 peticiones nuevas) y 1 petición al pulsar «Actualizar» (a los ≥16 s); el resultado del equipo quedó 0–0`
  })

  await paso('9. Teléfono 390 px: nombre largo sin desborde, rutas desconocidas sin peticiones y pantalla completa', async () => {
    await B.navegar(`/liga/${LIGA}/partido/Q`)
    await B.hayTexto('Faltas del partido', 15000)
    const t = await B.texto()
    for (const s of ['Los Tigres del Barrio Norte de la Ciudad', 'Delta Oeste', 'Por jugar', '21:30', 'Cancha B']) assert.ok(tiene(t, s), `falta «${s}»`)
    assert.ok(!tiene(t, 'Pendiente de comenzar'), 'Q (2030) no está atrasado')
    const m = await sinDesborde(B)
    const recorte = await B.evalu(`(() => { const e = document.querySelector('.board .equipo .corto'); return e.scrollWidth > e.clientWidth + 1 })()`)
    assert.equal(recorte, false, 'el nombre largo se recorta')
    await B.captura('12-marcador-nombre-largo-390.png')
    const antes = B.v1().length
    await B.navegar('/liga/NOCONFIGURADA')
    await B.hayTexto('No encontramos esta liga')
    await B.navegar(`/liga/${LIGA}/partido/a%20b`)
    await B.hayTexto('No encontramos este partido')
    assert.equal(B.v1().length, antes, 'las rutas desconocidas hicieron peticiones')
    await B.navegar(PUB)
    await B.hayTexto('Pantalla completa', 15000)
    await B.evalu("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pantalla completa').click()", true)
    await B.hasta('document.fullscreenElement !== null', 5000, 'pantalla completa activa')
    await B.hasta("document.querySelector('.board.pantalla-completa') !== null && document.body.innerText.includes('Salir de pantalla completa')", 5000)
    await B.captura('13-pantalla-completa.png')
    await B.evalu('document.exitFullscreen()', true)
    await B.hasta('document.fullscreenElement === null', 5000)
    return `a ${m.ancho} px sin desborde y el nombre largo se ve completo; /liga/NOCONFIGURADA y partido inválido: 0 peticiones; pantalla completa entra y sale`
  })

  await paso('10. Lo que pidió el visitante: solo las dos lecturas públicas, GET, sin autorización, sin cookies', async () => {
    const v1 = B.v1()
    const rutas = [...new Set(v1.map((p) => p.url.replace(ORIGEN, '')))]
    for (const r of rutas) assert.match(r, new RegExp(`^/v1/ligas/${LIGA}/(publico|equipos/E[1-4]/publico|partidos/[PQR])$`), `ruta inesperada ${r}`)
    assert.ok(v1.every((p) => p.metodo === 'GET'), 'hay peticiones que no son GET')
    assert.ok(v1.every((p) => !p.cabeceras.includes('authorization')), 'hay peticiones con autorización')
    assert.ok(!rutas.some((r) => /estado|comandos|preparacion|organizador|admin|acceso/.test(r)), 'se pidió una ruta protegida')
    assert.equal(await B.evalu('document.cookie'), '')
    const externas = B.peticiones.map((p) => new URL(p.url).origin).filter((o) => o !== ORIGEN && !o.startsWith('data:') && o !== 'null')
    return `${v1.length} peticiones /v1, todas GET, sin autorización; rutas: ${rutas.join(', ')}; orígenes externos pedidos por la aplicación: ${[...new Set(externas)].join(', ') || 'ninguno'}`
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
console.log(fallos === 0 ? 'NAVEGADOR PÚBLICO: OK' : `NAVEGADOR PÚBLICO: ${fallos} FALLO(S)`)
process.exit(fallos === 0 ? 0 : 1)
