// Comprobación en un navegador REAL (Chrome con perfil desechable), aislada y con datos SINTÉTICOS, de la gestión de
// plantillas del organizador a ancho de teléfono (390 px).
//   - compila la aplicación en modo compartido en una carpeta temporal (no toca ../dist);
//   - levanta wrangler dev por HTTPS local con almacenamiento temporal, siembra dos ligas sintéticas y da de alta un
//     organizador sintético por la ruta del operador;
//   - maneja Chrome por el protocolo DevTools: navegación, las cuatro operaciones, identidad, sin conexión, respuesta
//     perdida tras confirmar el servidor, recarga y repetición exacta, fallos de almacenamiento, doble pulsación, pestañas
//     que compiten, sesión terminada, revisión desactualizada y partido que empieza mientras se edita.
// Uso (desde backend/):  node scripts/navegador-plantilla.mjs     Variables: CAPTURAS=<carpeta para las capturas>
// No usa Cloudflare ni datos reales. Al terminar mata todos sus procesos y borra el perfil y el almacenamiento temporales.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // solo este proceso, solo para el certificado autofirmado local
const RAIZ = resolve(import.meta.dirname, '..')
const REPO = resolve(RAIZ, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'plantilla')
const CAPTURAS = process.env.CAPTURAS ?? join(ESTADO, 'capturas')
const PUERTO = 8797
const PUERTO_CDP = 9336
const ORIGEN = `https://localhost:${PUERTO}`
const OPERADOR = 'operador-plantilla-sintetico-0000000001'
const SEMILLA = 'semilla-plantilla-sintetica-0001'
const U10 = 'LIGANAV1'
const U12 = 'LIGANAV2'
const TOKEN_P = 'tok-sintetico-navegador-P-0000001'
const CHROME = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync)
const FRASE = 'Se requiere conexión a internet para esta acción.'

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ESTADO, { recursive: true })
const DIST = join(ESTADO, 'dist')
const PERFIL = join(ESTADO, 'perfil-chrome')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// --- 1. Compilar en modo compartido, fuera de ../dist, y empaquetar el cliente del motor ---
execFileSync(join(REPO, 'node_modules', '.bin', 'vite'), ['build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: REPO, env: { ...process.env, VITE_MODO_COMPARTIDO: '1' }, stdio: 'inherit',
})
const salidaCliente = join(ESTADO, 'cliente.mjs')
execFileSync(join(RAIZ, 'node_modules', '.bin', 'esbuild'), [join(RAIZ, 'scripts', 'cliente-plantilla.js'), '--bundle', '--format=esm', '--platform=node', `--outfile=${salidaCliente}`, '--log-level=error'], { stdio: 'inherit' })
const { sobreDeInicio } = await import(pathToFileURL(salidaCliente).href)

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
const servidor = lanzar(join(RAIZ, 'node_modules', '.bin', 'wrangler'), [
  'dev', '--port', String(PUERTO), '--ip', '127.0.0.1', '--local-protocol', 'https', '--persist-to', join(ESTADO, 'persistencia'),
  '--assets', DIST, '--var', `LIGAS_ADMITIDAS:${U10},${U12}`, '--var', `ACCESO_ORIGEN:${ORIGEN}`,
  '--var', 'ACCESO_ADMIN_HABILITADO:1', '--var', `ACCESO_ADMIN_TOKEN:${OPERADOR}`, '--var', 'PERMITIR_SEMILLA:1', '--var', `SEMILLA_TOKEN:${SEMILLA}`,
], { cwd: RAIZ, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' } })

const api = (ruta, opciones = {}) => fetch(`https://127.0.0.1:${PUERTO}${ruta}`, opciones)
const admin = (ruta, cuerpo) => api(ruta, { method: 'POST', headers: { authorization: `Bearer ${OPERADOR}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}) })

const f = (id, equipoId, nombrePila, apellido1, dorsal, extra = {}) => ({ id, equipoId, nombrePila, apellido1, apellido2: '', dorsal, personaId: `persona-nav-${id}`, ...extra })
const payloadU10 = {
  liga: { id: U10, nombre: 'Liga Sub-10 sintética', deporte: 'baloncesto', minutosPorPeriodo: 10 },
  equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }],
  jugadores: [
    f('J1', 'E1', 'Ana', 'Prueba', 0, { nombreCamiseta: 'ANA' }), f('J2', 'E1', 'Beto', 'Muestra', 7, { fechaNacimiento: '2015-03-12' }),
    f('JX', 'E1', 'Dario', 'Inactivo', 9, { activo: false }),
    f('J3', 'E2', 'Cora', 'Tres', 3), f('J4', 'E2', 'Hugo', 'Cuatro', 4),
    { id: 'L1', equipoId: 'E2', nombre: 'Legado Sin Numero', dorsal: null, personaId: 'persona-nav-L1', activo: false },
  ],
  partidos: [{ id: 'P', localId: 'E1', visitaId: 'E2', inicio: null }],
  credenciales: [{ token: TOKEN_P, partidoId: 'P', deviceId: 'tel-P', actorId: 'actor-P' }],
}
const payloadU12 = {
  liga: { id: U12, nombre: 'Liga Sub-12 sintética', deporte: 'baloncesto', minutosPorPeriodo: 10 },
  equipos: [{ id: 'E3', nombre: 'Gama' }],
  jugadores: [f('K1', 'E3', 'Eva', 'Doce', 5, { fechaNacimiento: '2014-06-01' }), f('K2', 'E3', 'Beto', 'Muestra', 4, { fechaNacimiento: '2014-02-02' })],
  partidos: [], credenciales: [],
}

let chrome = null
const resultados = []
let alFrente = async () => {}
async function paso(nombre, fn) {
  try { await alFrente(); const nota = await fn(); resultados.push({ nombre, ok: true, nota }) } catch (e) { resultados.push({ nombre, ok: false, nota: String(e.message ?? e).split('\n').slice(0, 6).join(' ⏎ ') }) }
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
try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await api('/v1/organizador/yo')).status === 401) break } catch { /* aún no */ }
    await espera(500)
    if (i === 119) throw new Error(`wrangler no arrancó:\n${servidor.registro.slice(-1500)}`)
  }
  for (const [liga, payload] of [[U10, payloadU10], [U12, payloadU12]]) {
    const r = await api(`/v1/_semilla/ligas/${liga}`, { method: 'POST', headers: { authorization: `Bearer ${SEMILLA}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(r.status, 201, `siembra de ${liga}`)
  }
  const alta = await admin('/v1/admin/organizador', { nombre: 'Organizador sintético', ligas: [U10, U12] })
  assert.equal(alta.status, 201, 'alta del organizador sintético')
  const CODIGO = (await alta.json()).codigo

  chrome = lanzar(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${PERFIL}`, '--ignore-certificate-errors',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ])
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break } catch { await espera(250) } }
  const nuevaPestana = async () => conectar(await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json())
  const A = await nuevaPestana()
  alFrente = () => A.enviar('Page.bringToFront')

  // ---------- Ayudas de página ----------
  const texto = (p = A) => p.evalu('document.body.innerText')
  const captura = async (nombre, p = A) => writeFileSync(join(CAPTURAS, nombre), Buffer.from((await p.enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  const fijar = (p, selector, valor) => p.evalu(`(() => { const el = document.querySelector(${js(selector)}); if (!el) throw new Error('no existe ${selector}'); const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, ${js(valor)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const clic = (p, nombre, ambito = 'document') => p.evalu(`(() => { const b = [...${ambito}.querySelectorAll('button, a')].find((x) => x.textContent.trim() === ${js(nombre)} && !x.disabled); if (!b) throw new Error('no hay botón ${nombre}; ruta ' + location.pathname + '; botones: ' + [...${ambito}.querySelectorAll('button')].map((x) => x.textContent.trim() + (x.disabled ? '(desactivado)' : '')).join(' | ') + '; página: ' + document.body.innerText.replaceAll('\\n', ' / ').slice(0, 260)); b.click(); return true })()`)
  const hojaClic = (p, nombre) => clic(p, nombre, "document.querySelector('[role=dialog]')")
  const hayTexto = (p, t) => p.hasta(`document.body.innerText.includes(${js(t)})`, 8000, `texto «${t}»`)
  const llamadaPagina = (p, metodo, ruta, cuerpo) => p.evalu(`(async () => { const r = await fetch(${js(ruta)}, { method: ${js(metodo)}, headers: ${metodo === 'GET' ? '{}' : js({ 'content-type': 'application/json', 'x-sebel-peticion': '1' })}, body: ${metodo === 'GET' ? 'undefined' : js(JSON.stringify(cuerpo))}, credentials: 'same-origin' }); return { status: r.status, cuerpo: await r.json() } })()`)
  const plantillaServidor = async (liga, equipo) => (await llamadaPagina(A, 'GET', `/v1/organizador/ligas/${liga}/equipos/${equipo}/jugadores`)).cuerpo
  const todos = async (liga, equipo) => { const p = await plantillaServidor(liga, equipo); return [...p.activos, ...p.inactivos] }
  const llavesOp = (p = A) => p.evalu("Object.keys(localStorage).filter((k) => k.startsWith('sebel.op.v1:'))")
  const postsA = (p = A) => p.peticiones.filter((x) => x.metodo === 'POST' && x.url.includes('/jugadores'))
  const abrirPlantilla = async (liga = U10, equipo = 'E1', p = A) => {
    await p.navegar(`/anthony/ligas/${liga}/equipos/${equipo}`)
    try { await p.hasta("!!(document.querySelector('h1') && document.querySelector('ul[aria-label=\"Plantilla activa\"]'))", 10000, 'plantilla cargada') } catch (e) {
      throw new Error(`${e.message}; ruta ${await p.evalu('location.pathname')}; página «${(await texto(p)).replaceAll('\n', ' | ').slice(0, 160)}»; respuestas ${p.respuestas.slice(-4).map((r) => `${new URL(r.url).pathname}=${r.status}`).join(', ')}; consola ${p.consola.slice(-3).join(' / ')}`)
    }
  }
  const rellenar = async (p, { nombre, apellido, numero, apellido2, camiseta, fecha }) => {
    await fijar(p, '#jf-nombrePila', nombre); await fijar(p, '#jf-apellido1', apellido); await fijar(p, '#jf-dorsal', String(numero))
    if (apellido2) await fijar(p, '#jf-apellido2', apellido2)
    if (camiseta) await fijar(p, '#jf-nombreCamiseta', camiseta)
    if (fecha) await fijar(p, '#jf-fechaNacimiento', fecha)
  }
  const abrirAlta = async (p = A) => { await clic(p, 'Añadir jugador'); await p.hasta("!!document.querySelector('[role=dialog]')") }
  const sinDesborde = async (p = A) => { const m = await p.evalu('({ ancho: innerWidth, scroll: document.documentElement.scrollWidth })'); assert.ok(m.scroll <= m.ancho, `desborda ${m.scroll} > ${m.ancho}`) }
  const interceptarRespuestaPerdida = async (p = A) => {
    await p.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/jugadores*', requestStage: 'Response' }] })
    const fn = (m) => {
      if (m.method !== 'Fetch.requestPaused') return
      if (m.params.request.method === 'POST') p.enviar('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionReset' }).catch(() => {}) // el servidor YA procesó la petición
      else p.enviar('Fetch.continueResponse', { requestId: m.params.requestId }).catch(() => {})
    }
    p.oyentes.push(fn)
    return async () => { p.oyentes.splice(p.oyentes.indexOf(fn), 1); await p.enviar('Fetch.disable') }
  }
  const sesionIniciada = async () => {
    await A.navegar('/anthony/access')
    await A.hasta("['Acceso del organizador', 'Acceso autorizado', 'Mis ligas'].includes(document.querySelector('h1')?.textContent)")
    if (['Acceso autorizado', 'Mis ligas'].includes(await A.evalu("document.querySelector('h1').textContent"))) return
    await A.evalu("document.getElementById('codigo-acceso').focus()")
    await A.enviar('Input.insertText', { text: CODIGO })
    await A.hasta("!document.querySelector('form button[type=submit]').disabled", 3000)
    await clic(A, 'Entrar')
    // Si una pantalla protegida mandó a la entrada, al volver a entrar la aplicación regresa a ella (el estado de la historia sobrevive).
    try { await A.hasta("['Acceso autorizado', 'Mis ligas'].includes(document.querySelector('h1')?.textContent)", 10000) } catch (e) {
      throw new Error(`${e.message}; ruta ${await A.evalu('location.pathname')}; página «${(await texto()).replaceAll('\\n', ' | ').slice(0, 200)}»; respuestas ${A.respuestas.slice(-4).map((r) => `${new URL(r.url).pathname}=${r.status}`).join(', ')}`)
    }
  }
  const accionesBase = { nombre: 'Carla', apellido: 'Nueva', numero: 12 }

  // Esperas por CONDICIÓN (con tope) para el estado real del servidor sintético y para la hoja cerrada. Solo leen: nunca reintentan una operación.
  // Un texto genérico como «Jugador añadido.» NO sirve: puede ser el aviso de una operación anterior (se retira solo a los 6 s).
  const fichaEnServidor = async (liga, equipo, predicado, etiqueta, ms = 10000) => {
    const t0 = Date.now()
    for (;;) {
      const halladas = (await todos(liga, equipo)).filter(predicado)
      if (halladas.length > 0) return halladas
      if (Date.now() - t0 > ms) throw new Error(`el servidor no tiene el registro esperado: ${etiqueta} (tras ${ms} ms)`)
      await espera(150)
    }
  }
  const hojaCerrada = (p = A, etiqueta = 'hoja cerrada') => p.hasta("!document.querySelector('[role=dialog]')", 10000, etiqueta)
  const sinRegistroPendiente = async (etiqueta) => { try { await A.hasta("Object.keys(localStorage).every((k) => !k.startsWith('sebel.op.v1:'))", 5000, etiqueta) } catch (e) { throw new Error(`${e.message}; claves ${js(await llavesOp())}`) } }

  /** Si `fn` falla, guarda un diagnóstico (sin cookies, cabeceras ni códigos) en CAPTURAS y relanza el MISMO error. */
  async function conDiagnostico(nombre, liga, equipo, fn) {
    try { return await fn() } catch (e) {
      const partes = [`ASERCIÓN/ERROR: ${e.message}`, `PILA:\n${e.stack ?? '(sin pila)'}`]
      const seguro = async (titulo, g) => { try { partes.push(`${titulo}:\n${await g()}`) } catch (e2) { partes.push(`${titulo}: no disponible (${String(e2.message ?? e2).slice(0, 120)})`) } }
      await seguro(`REGISTROS SINTÉTICOS DEL SERVIDOR ${liga}/${equipo}`, async () => js((await todos(liga, equipo)).map((j) => ({ id: j.id, personaId: j.personaId, nombrePila: j.nombrePila, apellido1: j.apellido1, dorsal: j.dorsal, activo: j.activo, rev: j.rev })), null, 1))
      await seguro('REGISTROS DE RECUPERACIÓN (localStorage sebel.op.v1:*)', () => A.evalu("JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('sebel.op.v1:')).map((k) => [k, localStorage.getItem(k)]), null, 1)"))
      await seguro('RUTA', () => A.evalu('location.pathname'))
      await seguro('TEXTO DE LA PÁGINA', async () => (await texto()).slice(0, 1500))
      await seguro('PETICIONES RECIENTES (método, ruta, estado)', async () => js(A.respuestas.slice(-8).map((r) => `${new URL(r.url).pathname}=${r.status}`)))
      await seguro('CONSOLA (últimas)', async () => A.consola.slice(-8).join('\n'))
      await seguro('CAPTURA', async () => { await captura(`${nombre}-fallo.png`); return `${nombre}-fallo.png` })
      const archivo = join(CAPTURAS, `diagnostico-${nombre}.txt`)
      try { writeFileSync(archivo, `${partes.join('\n\n')}\n`) } catch { /* el diagnóstico es auxiliar */ }
      e.message = `${e.message} [diagnóstico: ${archivo}]`
      throw e
    }
  }

  // ---------- Pasos ----------
  await paso('1. Entrada y navegación autorizada: acceso → ligas → liga → equipo → plantilla (a 390 px)', async () => {
    await sesionIniciada()
    await sinDesborde()
    await captura('01-acceso.png')
    await clic(A, 'Ver mis ligas y plantillas')
    await A.hasta("document.querySelector('h1')?.textContent === 'Mis ligas'")
    await hayTexto(A, 'Liga Sub-10 sintética'); await hayTexto(A, 'Liga Sub-12 sintética')
    await sinDesborde(); await captura('02-ligas.png')
    await clic(A, 'Liga Sub-10 sintética')
    await A.hasta("document.querySelector('h1')?.textContent === 'Liga Sub-10 sintética'")
    await hayTexto(A, '2 activos · 1 inactivos'); await hayTexto(A, 'Alfa')
    await sinDesborde(); await captura('03-equipos.png')
    await clic(A, 'Alfa')
    await A.hasta("document.querySelector('h1')?.textContent === 'Alfa'")
    await hayTexto(A, 'Beto Muestra')
    const t = await texto()
    assert.ok(t.includes('Ana Prueba') && t.includes('Dario Inactivo'))
    assert.ok(!/persona-nav|4321/.test(t), 'se ve un identificador interno')
    await sinDesborde(); await captura('04-plantilla.png')
    const alto = await A.evalu("Math.min(...[...document.querySelectorAll('.fila-jugador button, .panel > .btn-fila button')].map((b) => b.getBoundingClientRect().height))")
    assert.ok(alto >= 44, `objetivos táctiles de ${alto}px`)
    return `botones ≥ ${Math.round(alto)}px`
  })

  await paso('2. Añadir: el servidor guarda la ficha con identificadores propios; sin registro pendiente al terminar', async () => {
    await abrirAlta()
    await rellenar(A, { ...accionesBase, apellido2: 'Segunda', camiseta: 'CARLA', fecha: '2014-05-01' })
    await sinDesborde(); await captura('05-formulario.png')
    await hojaClic(A, 'Añadir jugador')
    await hayTexto(A, 'Jugador añadido.')
    const ficha = (await todos(U10, 'E1')).find((j) => j.nombrePila === 'Carla')
    assert.ok(ficha, 'la ficha no está en el servidor')
    assert.match(ficha.id, /^f-/); assert.match(ficha.personaId, /^pr-/)
    assert.deepEqual([ficha.dorsal, ficha.nombreCamiseta, ficha.fechaNacimiento, ficha.rev, ficha.activo], [12, 'CARLA', '2014-05-01', 1, true])
    assert.deepEqual(await llavesOp(), [])
  })

  await paso('3. Editar, desactivar y reactivar (sin eliminar a nadie)', async () => {
    await clic(A, 'Editar', "[...document.querySelectorAll('li')].find((l) => l.textContent.includes('Carla Nueva'))")
    await A.hasta("!!document.querySelector('[role=dialog]')")
    await fijar(A, '#jf-dorsal', '13')
    await hojaClic(A, 'Guardar cambios')
    await hayTexto(A, 'Jugador actualizado.')
    let ficha = (await todos(U10, 'E1')).find((j) => j.nombrePila === 'Carla')
    assert.deepEqual([ficha.dorsal, ficha.rev], [13, 2])
    await clic(A, 'Desactivar', "[...document.querySelectorAll('li')].find((l) => l.textContent.includes('Carla Nueva'))")
    await A.hasta("!!document.querySelector('[role=dialog]')")
    await hayTexto(A, 'No se elimina a nadie')
    await hojaClic(A, 'Desactivar')
    await hayTexto(A, 'Jugador desactivado.')
    ficha = (await todos(U10, 'E1')).find((j) => j.nombrePila === 'Carla')
    assert.deepEqual([ficha.activo, ficha.dorsal, ficha.nombrePila], [false, 13, 'Carla']) // la ficha se conserva
    await clic(A, 'Reactivar', "[...document.querySelectorAll('li')].find((l) => l.textContent.includes('Carla Nueva'))")
    await A.hasta("!!document.querySelector('[role=dialog]')")
    await hojaClic(A, 'Reactivar')
    await hayTexto(A, 'Jugador reactivado.')
    ficha = (await todos(U10, 'E1')).find((j) => j.nombrePila === 'Carla')
    assert.deepEqual([ficha.activo, ficha.dorsal, ficha.rev], [true, 13, 4])
    assert.equal(await A.evalu("[...document.querySelectorAll('button')].some((b) => /eliminar|borrar/i.test(b.textContent))"), false)
  })

  await paso('4. Registro anterior sin número: no se adivina el nombre y no se reactiva sin un número válido', async () => {
    await abrirPlantilla(U10, 'E2')
    await clic(A, 'Reactivar', "[...document.querySelectorAll('li')].find((l) => l.textContent.includes('Legado Sin Numero'))")
    await A.hasta("!!document.querySelector('[role=dialog]')")
    await hojaClic(A, 'Reactivar')
    await hayTexto(A, 'Este registro no tiene número')
    const antes = (await todos(U10, 'E2')).find((j) => j.id === 'L1')
    assert.equal(antes.activo, false)
    await fijar(A, '#rj-numero', '15')
    await hojaClic(A, 'Reactivar')
    await hayTexto(A, 'Jugador reactivado.')
    const despues = (await todos(U10, 'E2')).find((j) => j.id === 'L1')
    assert.deepEqual([despues.activo, despues.dorsal, despues.nombrePila], [true, 15, null]) // sin partes de nombre inventadas
  })

  await paso('5. Identidad: candidatos con contexto, unión verificada entre ligas, buscador por otra ortografía y «otra persona»', () => conDiagnostico('paso5', U10, 'E2', async () => {
    await abrirPlantilla(U10, 'E2')
    await abrirAlta()
    await rellenar(A, { nombre: 'Beto', apellido: 'Muestra', numero: 30 })
    await hojaClic(A, 'Añadir jugador')
    await hayTexto(A, '¿Es alguien que ya está registrado?')
    const t = await texto()
    assert.ok(t.includes('En esta liga') && t.includes('Otra liga: Liga Sub-12 sintética') && t.includes('Gama'), 'falta contexto deportivo')
    assert.ok(!/2015|2014|persona-nav/.test(t), 'se filtra una fecha o un identificador')
    await captura('06-candidatos.png')
    const antes = (await todos(U10, 'E2')).length
    await A.evalu("(() => { const tarjeta = [...document.querySelectorAll('.tarjeta-candidato')].find((c) => c.textContent.includes('Otra liga: Liga Sub-12')); [...tarjeta.querySelectorAll('button')].find((b) => b.textContent === 'Es la misma persona').click() })()")
    await hayTexto(A, 'no existe una operación para deshacer ni separar esta unión')
    await captura('07-confirmar-union.png')
    assert.equal((await todos(U10, 'E2')).length, antes, 'se creó algo antes de confirmar')
    await hojaClic(A, 'Sí, es la misma persona y entiendo que no se puede deshacer')
    // Se espera ESTA operación: la ficha de Beto con el número 30 en el servidor y la hoja cerrada (no un aviso genérico, que puede ser antiguo).
    const [unida] = await fichaEnServidor(U10, 'E2', (j) => j.nombrePila === 'Beto' && j.dorsal === 30, 'Beto #30 (unión con la persona de la otra liga)')
    await hojaCerrada(A, 'hoja cerrada tras la unión')
    await sinRegistroPendiente('registro de recuperación limpio tras la unión')
    assert.equal(unida.personaId, 'persona-nav-K2', 'no conserva la persona de la otra liga')
    assert.notEqual(unida.id, 'K2')
    assert.equal((await todos(U10, 'E2')).filter((j) => j.nombrePila === 'Beto').length, 1, 'tras la unión debe haber exactamente un Beto en E2')
    assert.equal((await todos(U10, 'E2')).length, antes + 1, 'tras la unión debe haber exactamente una ficha más')
    // otra ortografía → buscador
    await abrirAlta()
    await rellenar(A, { nombre: 'Evita', apellido: 'Doce', numero: 31 })
    await clic(A, '¿Ya está registrado en otra liga? Buscarlo allí', "document.querySelector('[role=dialog]')").catch(() => hojaClic(A, '¿Ya está registrado en otra liga? Buscarlo allí'))
    await hayTexto(A, 'Buscar en otra liga')
    await hojaClic(A, 'Liga Sub-12 sintética'); await A.hasta("[...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent === 'Gama')")
    await hojaClic(A, 'Gama'); await hayTexto(A, 'Eva Doce')
    await captura('08-buscador.png')
    await A.evalu("(() => { const t = [...document.querySelectorAll('.tarjeta-candidato')].find((c) => c.textContent.includes('Eva Doce')); [...t.querySelectorAll('button')].find((b) => b.textContent === 'Elegir a este jugador').click() })()")
    await hojaClic(A, 'Sí, es la misma persona y entiendo que no se puede deshacer')
    const [evita] = await fichaEnServidor(U10, 'E2', (j) => j.nombrePila === 'Evita' && j.dorsal === 31, 'Evita #31 (elegida con el buscador)')
    await hojaCerrada(A, 'hoja cerrada tras elegir con el buscador')
    await sinRegistroPendiente('registro de recuperación limpio tras el buscador')
    assert.equal(evita.personaId, 'persona-nav-K1')
    assert.equal((await todos(U10, 'E2')).filter((j) => j.nombrePila === 'Evita').length, 1, 'debe haber exactamente una Evita')
    assert.equal((await todos(U10, 'E2')).length, antes + 2, 'tras el buscador debe haber exactamente dos fichas más')
    // otra persona (explícito)
    await abrirAlta()
    await rellenar(A, { nombre: 'Beto', apellido: 'Muestra', numero: 32 })
    await hojaClic(A, 'Añadir jugador'); await hayTexto(A, '¿Es alguien que ya está registrado?')
    await hojaClic(A, 'Es otra persona distinta'); await hayTexto(A, 'Se creará una identidad de jugador nueva')
    await hojaClic(A, 'Sí, es otra persona')
    const [nueva] = await fichaEnServidor(U10, 'E2', (j) => j.nombrePila === 'Beto' && j.dorsal === 32, 'Beto #32 (otra persona distinta)')
    await hojaCerrada(A, 'hoja cerrada tras «otra persona»')
    await sinRegistroPendiente('registro de recuperación limpio tras «otra persona»')
    assert.match(nueva.personaId, /^pr-/, 'la identidad nueva debe tener un identificador propio')
    const otra = (await todos(U10, 'E2')).filter((j) => j.nombrePila === 'Beto')
    assert.equal(otra.length, 2); assert.ok(otra.some((j) => /^pr-/.test(j.personaId)))
    assert.equal(new Set(otra.map((j) => j.personaId)).size, 2)
    assert.deepEqual(otra.map((j) => j.dorsal).sort((x, y) => x - y), [30, 32])
    assert.equal((await todos(U10, 'E2')).length, antes + 3, 'al final debe haber exactamente tres fichas más')
  }))

  await paso('6. Sin conexión: la frase exacta, ninguna petición, ningún registro y nada guardado', async () => {
    await abrirPlantilla(U10, 'E1')
    await abrirAlta()
    await rellenar(A, { nombre: 'Sin', apellido: 'Conexion', numero: 40 })
    const antes = postsA().length
    const fichas = (await todos(U10, 'E1')).length
    await A.enviar('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await A.hasta('navigator.onLine === false', 3000)
    await hojaClic(A, 'Añadir jugador')
    await A.hasta("document.querySelector('[role=dialog] [role=alert]')?.textContent === " + js(FRASE))
    assert.equal(postsA().length, antes)
    assert.deepEqual(await llavesOp(), [])
    await captura('09-sin-conexion.png')
    await A.enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await A.hasta('navigator.onLine === true', 3000)
    assert.equal((await todos(U10, 'E1')).length, fichas, 'el servidor recibió algo estando sin conexión')
    // no se envía solo después: se espera y se comprueba
    await espera(1500)
    assert.equal(postsA().length, antes)
  })

  await paso('7. Respuesta perdida DESPUÉS de que el servidor confirmó: aviso, recarga y repetición con el mismo cuerpo e identificador, sin duplicar', async () => {
    await abrirPlantilla(U10, 'E1')
    const quitar = await interceptarRespuestaPerdida()
    await abrirAlta()
    await rellenar(A, { nombre: 'Perdida', apellido: 'Respuesta', numero: 41 })
    const antes = postsA().length
    await hojaClic(A, 'Añadir jugador')
    await hayTexto(A, 'No sabemos si el servidor aplicó esta acción')
    await quitar()
    assert.equal(postsA().length, antes + 1)
    const primero = postsA().at(-1)
    assert.equal((await llavesOp()).length, 1)
    // el servidor SÍ aplicó la acción aunque el navegador no lo sepa
    assert.equal((await todos(U10, 'E1')).filter((j) => j.nombrePila === 'Perdida').length, 1)
    try { await A.hasta("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Añadir jugador').disabled === true", 4000, 'Añadir desactivado con una acción sin confirmar') } catch (e) {
      throw new Error(`${e.message}; claves ${js(await llavesOp())}; botones: ${(await A.evalu("[...document.querySelectorAll('button')].map((b) => b.textContent.trim() + (b.disabled ? '(des)' : '')).join(' | ')"))}; página: ${(await texto()).replaceAll('\\n', ' / ').slice(0, 300)}`)
    }
    await captura('10-sin-confirmar.png')
    await A.recargar() // recarga real
    await A.hasta("!!document.querySelector('ul[aria-label=\"Plantilla activa\"]')", 10000)
    await hayTexto(A, 'Acción sin confirmar')
    await espera(1200)
    assert.equal(postsA().length, antes + 1, 'tras la recarga se envió algo solo') // los registros de red sobreviven a la recarga: no hubo ningún POST nuevo
    const registro = JSON.parse(await A.evalu('localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("sebel.op.v1:")))'))
    assert.equal(registro.cuerpoJson, primero.cuerpo, 'el cuerpo guardado no es el enviado')
    await clic(A, 'Repetir la misma solicitud')
    await hayTexto(A, 'Esta acción ya se había procesado antes')
    const repeticion = A.peticiones.filter((x) => x.metodo === 'POST' && x.url.includes('/jugadores')).at(-1)
    assert.equal(repeticion.cuerpo, primero.cuerpo, 'la repetición no es byte a byte la original')
    assert.equal(JSON.parse(repeticion.cuerpo).operacionId, JSON.parse(primero.cuerpo).operacionId)
    assert.equal((await todos(U10, 'E1')).filter((j) => j.nombrePila === 'Perdida').length, 1, 'se duplicó')
    assert.deepEqual(await llavesOp(), [])
  })

  await paso('8. Un fallo definitivo posterior NO resuelve el intento incierto; los registros no caducan; no hay botón de descarte', async () => {
    await abrirPlantilla(U10, 'E1')
    let quitar = await interceptarRespuestaPerdida()
    await abrirAlta()
    await rellenar(A, { nombre: 'Luego', apellido: 'Error', numero: 42 })
    await hojaClic(A, 'Añadir jugador')
    await hayTexto(A, 'No sabemos si el servidor aplicó esta acción')
    await quitar()
    // el registro es «antiguo» (90 días): nada caduca
    await A.evalu('(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("sebel.op.v1:")); const r = JSON.parse(localStorage.getItem(k)); r.creadoEn -= 90 * 24 * 3600 * 1000; localStorage.setItem(k, JSON.stringify(r)) })()')
    await A.recargar(); await hayTexto(A, 'Acción sin confirmar')
    // el siguiente intento recibe un 404 falso (definitivo para ESE intento)
    await A.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/jugadores*', requestStage: 'Request' }] })
    const fn = (m) => { if (m.method === 'Fetch.requestPaused') { if (m.params.request.method === 'POST') A.enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"error":"no-encontrado"}').toString('base64') }).catch(() => {}); else A.enviar('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}) } }
    A.oyentes.push(fn)
    await clic(A, 'Repetir la misma solicitud')
    await hayTexto(A, 'un intento anterior sigue sin confirmarse')
    A.oyentes.splice(A.oyentes.indexOf(fn), 1); await A.enviar('Fetch.disable')
    assert.equal((await llavesOp()).length, 1, 'el 404 resolvió el registro')
    assert.equal(await A.evalu("[...document.querySelectorAll('button')].some((b) => /descartar|cancelar|olvidar/i.test(b.textContent))"), false)
    // la repetición real devuelve el resultado original y limpia
    await clic(A, 'Repetir la misma solicitud')
    await hayTexto(A, 'Esta acción ya se había procesado antes')
    assert.deepEqual(await llavesOp(), [])
    assert.equal((await todos(U10, 'E1')).filter((j) => j.nombrePila === 'Luego').length, 1)
  })

  await paso('9. Doble pulsación: una sola operación', async () => {
    await abrirPlantilla(U10, 'E1')
    await abrirAlta()
    await rellenar(A, { nombre: 'Doble', apellido: 'Clic', numero: 43 })
    const antes = postsA().length
    await A.evalu("(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent === 'Añadir jugador'); b.click(); b.click(); return true })()")
    await hayTexto(A, 'Jugador añadido.')
    assert.equal(postsA().length, antes + 1)
    assert.equal((await todos(U10, 'E1')).filter((j) => j.nombrePila === 'Doble').length, 1)
  })

  await paso('10. Dos pestañas compiten: la segunda no envía mientras la primera tiene el envío en curso', async () => {
    await abrirPlantilla(U10, 'E1')
    const B = await nuevaPestana()
    try {
    await abrirPlantilla(U10, 'E1', B)
    await abrirAlta(); await rellenar(A, { nombre: 'Pestana', apellido: 'Uno', numero: 44 })
    await abrirAlta(B); await rellenar(B, { nombre: 'Pestana', apellido: 'Dos', numero: 45 })
    let liberar
    const retenida = new Promise((r) => { liberar = r })
    await A.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/jugadores*', requestStage: 'Request' }] })
    let pausada = null
    const fn = (m) => { if (m.method === 'Fetch.requestPaused') { if (m.params.request.method === 'POST') { pausada = m.params.requestId; retenida.then(() => A.enviar('Fetch.continueRequest', { requestId: pausada }).catch(() => {})) } else A.enviar('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}) } }
    A.oyentes.push(fn)
    await hojaClic(A, 'Añadir jugador')
    for (let i = 0; i < 50 && !pausada; i += 1) await espera(100)
    assert.ok(pausada, 'la primera pestaña no llegó a enviar')
    // La segunda pestaña ve el registro de la primera (almacenamiento compartido): lo muestra como «enviando» y su envío queda desactivado.
    const antesB = postsA(B).length
    await B.hasta("[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === 'Añadir jugador')?.disabled === true", 6000, 'envío de la segunda pestaña desactivado')
    await B.hasta("document.body.innerText.includes('Enviando una acción')", 6000)
    assert.equal(await B.evalu("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Repetir la misma solicitud')"), false, 'ofrece repetir una acción que está en vuelo')
    assert.equal(await A.evalu("document.body.innerText.includes('No sabemos si el servidor aplicó')"), false, 'la primera pestaña alarma por una petición normal en vuelo')
    assert.equal(postsA(B).length, antesB, 'la segunda pestaña envió')
    liberar()
    await hayTexto(A, 'Jugador añadido.')
    await B.hasta("!document.querySelector('section[aria-label]') && ![...document.querySelectorAll('button')].some((b) => b.textContent === 'Repetir la misma solicitud')", 8000, 'la segunda pestaña ve el registro resuelto')
    assert.equal(postsA(B).length, antesB)
    assert.equal((await todos(U10, 'E1')).filter((j) => j.nombrePila === 'Pestana').length, 1)
    A.oyentes.splice(A.oyentes.indexOf(fn), 1); await A.enviar('Fetch.disable')
    } finally {
      B.ws.close()
      await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${B.destinoId}`).catch(() => {})
      await A.enviar('Page.bringToFront')
    }
  })

  await paso('11. Fallos de almacenamiento: cuota excedida y registro ilegible → no se envía nada', async () => {
    await abrirPlantilla(U10, 'E1')
    await abrirAlta(); await rellenar(A, { nombre: 'Sin', apellido: 'Cuota', numero: 46 })
    await A.evalu("Storage.prototype.setItem = function () { throw new DOMException('cuota', 'QuotaExceededError') }")
    const antes = postsA().length
    const fichas = (await todos(U10, 'E1')).length
    await hojaClic(A, 'Añadir jugador')
    await A.hasta("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('No pudimos guardar en este navegador el registro necesario')", 6000)
    assert.equal(postsA().length, antes); assert.equal((await todos(U10, 'E1')).length, fichas)
    await A.recargar() // restaura Storage
    const org = await A.evalu('fetch("/v1/organizador/yo").then((r) => r.json()).then((y) => y.organizadorId)')
    const k = `sebel.op.v1:${org}:${U10}`
    await A.evalu(`localStorage.setItem(${js(k)}, '{"basura":true}')`)
    await abrirPlantilla(U10, 'E1')
    await hayTexto(A, 'Registro de recuperación ilegible')
    assert.equal(await A.evalu("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Añadir jugador').disabled"), true)
    assert.equal(await A.evalu(`localStorage.getItem(${js(k)})`), '{"basura":true}', 'se tocó el registro dudoso')
    await captura('11-registro-ilegible.png')
    await A.evalu(`localStorage.removeItem(${js(k)})`) // limpieza del escenario de prueba
  })

  await paso('12. Sesión terminada y cierre de sesión con una acción sin confirmar: se conserva y se retoma al volver a entrar', async () => {
    await abrirPlantilla(U10, 'E1')
    const quitar = await interceptarRespuestaPerdida()
    await abrirAlta(); await rellenar(A, { nombre: 'Sesion', apellido: 'Termina', numero: 47 })
    await hojaClic(A, 'Añadir jugador')
    await hayTexto(A, 'No sabemos si el servidor aplicó esta acción')
    await quitar()
    const cuerpo = postsA().at(-1).cuerpo
    // el operador cierra todas las sesiones: la próxima llamada protegida da 401
    assert.equal((await admin('/v1/admin/organizador/sesiones/cerrar')).status, 200)
    await A.evalu("window.dispatchEvent(new Event('focus'))")
    await A.hasta("document.querySelector('h1')?.textContent === 'Acceso del organizador'", 8000)
    await hayTexto(A, 'Tu sesión terminó')
    assert.equal((await llavesOp()).length, 1, 'se perdió el registro con la sesión')
    assert.ok(!(await texto()).includes('Acción sin confirmar'), 'se expone la gestión sin sesión')
    await A.evalu("document.getElementById('codigo-acceso').focus()")
    await A.enviar('Input.insertText', { text: CODIGO })
    await A.hasta("!document.querySelector('form button[type=submit]').disabled", 3000)
    await clic(A, 'Entrar')
    await A.hasta(`location.pathname === '/anthony/ligas/${U10}/equipos/E1'`, 10000, 'vuelve a la plantilla')
    await hayTexto(A, 'Acción sin confirmar')
    await clic(A, 'Repetir la misma solicitud')
    await hayTexto(A, 'Esta acción ya se había procesado antes')
    assert.equal(postsA().length ? A.peticiones.filter((x) => x.metodo === 'POST' && x.url.includes('/jugadores')).at(-1).cuerpo : '', cuerpo)
    // cerrar sesión con otra acción sin confirmar la conserva
    const quitar2 = await interceptarRespuestaPerdida()
    await abrirAlta(); await rellenar(A, { nombre: 'Cierra', apellido: 'Sesion', numero: 48 })
    await hojaClic(A, 'Añadir jugador'); await hayTexto(A, 'No sabemos si el servidor aplicó esta acción')
    await quitar2()
    await A.navegar('/anthony/ligas')
    await hayTexto(A, 'cerrar sesión no las borra')
    await clic(A, 'Cerrar sesión')
    await A.hasta("document.querySelector('h1')?.textContent === 'Acceso del organizador'")
    assert.equal((await llavesOp()).length, 1)
    await sesionIniciada()
    await A.navegar(`/anthony/ligas/${U10}/equipos/E1`); await hayTexto(A, 'Acción sin confirmar')
    await clic(A, 'Repetir la misma solicitud'); await hayTexto(A, 'Esta acción ya se había procesado antes')
    assert.deepEqual(await llavesOp(), [])
  })

  await paso('13. Revisión desactualizada: se muestra qué cambió, se conservan los cambios propios y hace falta reenviar', async () => {
    await abrirPlantilla(U10, 'E1')
    await clic(A, 'Editar', "[...document.querySelectorAll('li')].find((l) => l.textContent.includes('Beto Muestra'))")
    await A.hasta("!!document.querySelector('[role=dialog]')")
    await fijar(A, '#jf-dorsal', '21')
    // otro teléfono edita la misma ficha mientras tanto
    const actual = (await todos(U10, 'E1')).find((j) => j.id === 'J2')
    const otro = await llamadaPagina(A, 'POST', `/v1/organizador/ligas/${U10}/equipos/E1/jugadores/J2/editar`, { operacionId: `op-otro-telefono-${Date.now()}`, revEsperada: actual.rev, campos: { nombreCamiseta: 'BETO' } })
    assert.equal(otro.cuerpo.resultado, 'aplicado')
    const antes = postsA().length
    await hojaClic(A, 'Guardar cambios')
    await hayTexto(A, 'Esta ficha cambió mientras la editabas')
    await captura('12-ficha-cambio.png')
    assert.equal(postsA().length, antes + 1, 'no debe reenviar solo')
    assert.equal((await todos(U10, 'E1')).find((j) => j.id === 'J2').dorsal, 7, 'se sobrescribió en silencio')
    await hojaClic(A, 'Revisar y guardar de nuevo')
    assert.equal(await A.evalu("document.getElementById('jf-nombreCamiseta').value"), 'BETO')
    assert.equal(await A.evalu("document.getElementById('jf-dorsal').value"), '21')
    await hojaClic(A, 'Guardar cambios')
    await hayTexto(A, 'Jugador actualizado.')
    const j2 = (await todos(U10, 'E1')).find((j) => j.id === 'J2')
    assert.deepEqual([j2.dorsal, j2.nombreCamiseta], [21, 'BETO'])
  })

  await paso('14. Un partido que empieza tras abrir el formulario: el servidor manda, se explica y se bloquea', async () => {
    await abrirPlantilla(U10, 'E1')
    await abrirAlta(); await rellenar(A, { nombre: 'Tarde', apellido: 'Llegada', numero: 49 })
    // preparación y inicio del partido P con la credencial del teléfono sintético
    const prep = await (await api(`/v1/ligas/${U10}/partidos/P/preparacion`, { headers: { authorization: `Bearer ${TOKEN_P}` } })).json()
    const sobre = sobreDeInicio({ gameId: 'P', cmdId: 'nav-inicio-1', clientSeq: prep.ultimoClientSeq + 1, deviceId: 'tel-P', version: prep.preparacion.version, t: Date.now() })
    const inicio = await api(`/v1/ligas/${U10}/partidos/P/comandos`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN_P}`, 'content-type': 'application/json' }, body: JSON.stringify(sobre) })
    assert.equal((await inicio.json()).resultado, 'aceptado', 'el partido no inició')
    const fichas = (await todos(U10, 'E1')).length
    await hojaClic(A, 'Añadir jugador')
    await hayTexto(A, 'Un partido de este equipo está en curso')
    assert.equal((await todos(U10, 'E1')).length, fichas)
    await A.evalu("[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === 'Cerrar').click()")
    await hayTexto(A, 'Hay un partido de este equipo en curso o en pausa')
    assert.equal(await A.evalu("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Añadir jugador').disabled"), true)
    await captura('13-bloqueada.png')
    assert.deepEqual(await llavesOp(), [])
    // el equipo del otro lado también está bloqueado; el equipo de otra liga no
    await abrirPlantilla(U10, 'E2'); await hayTexto(A, 'Hay un partido de este equipo en curso o en pausa')
    await abrirPlantilla(U12, 'E3')
    assert.equal(await A.evalu("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Añadir jugador').disabled"), false)
  })

  await paso('15. Sin datos de demostración ni escrituras locales de plantilla; sesión local de invitado intacta; sin errores en consola', async () => {
    const v = JSON.parse(await A.evalu(`(async () => {
      const salida = { local: Object.keys(localStorage), bases: {} }
      for (const { name } of (await indexedDB.databases())) {
        salida.bases[name] = await new Promise((ok) => { const r = indexedDB.open(name); r.onsuccess = async () => { const db = r.result; const o = {}
          for (const s of db.objectStoreNames) o[s] = await new Promise((k) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => k(q.result); q.onerror = () => k(null) })
          db.close(); ok(o) }; r.onerror = () => ok(null) })
      }
      return JSON.stringify(salida)
    })()`))
    const base = v.bases.sebel ?? {}
    for (const tabla of ['ligas', 'equipos', 'jugadores', 'auditoria', 'partidos', 'eventos']) assert.equal((base[tabla] ?? []).length, 0, `hay filas locales en ${tabla}`)
    const sesion = (base.meta ?? []).find((m) => m.id === 'sesion')
    assert.deepEqual(sesion && [sesion.rol, sesion.cuentaId], ['invitado', null])
    assert.deepEqual(v.local.filter((k) => !k.startsWith('sebel.op.v1:')), [])
    const errores = A.consola.filter((l) => /^(error|warning)/i.test(l) && !/Failed to load resource|ERR_|net::/i.test(l))
    assert.deepEqual(errores, [])
    return `bases: ${Object.keys(v.bases).join(',')}; meta: ${js(sesion)}`
  })

  await paso('16. Pestaña cerrada con la petición en vuelo (registro «enviando»): el servidor confirma, la respuesta se retiene ANTES del manejador de la página, se cierra la pestaña, se reabre y la repetición exacta reproduce el recibo original', async () => {
    const liga = U12; const equipo = 'E3'
    const C = await nuevaPestana() // pestaña que envía y morirá
    let D = null
    const posts = (p) => p.peticiones.filter((x) => x.metodo === 'POST' && x.url.includes('/jugadores'))
    const claveOp = (p) => p.evalu("Object.keys(localStorage).find((k) => k.startsWith('sebel.op.v1:')) ?? null")
    const registroDe = (p) => p.evalu("(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('sebel.op.v1:')); return k ? localStorage.getItem(k) : null })()")
    const fichasServidor = async () => (await todos(liga, equipo)).filter((j) => j.nombrePila === 'Interrumpida')
    try {
      await abrirPlantilla(liga, equipo, C)
      assert.equal((await fichasServidor()).length, 0)
      assert.deepEqual(await llavesOp(C), [], 'el perfil no está limpio de registros')
      // Se retiene la RESPUESTA de la alta: el servidor ya la procesó y respondió; la página no recibe nada (ni éxito ni error).
      let retenida = null
      await C.enviar('Fetch.enable', { patterns: [{ urlPattern: '*/jugadores*', requestStage: 'Response' }] })
      C.oyentes.push((m) => {
        if (m.method !== 'Fetch.requestPaused') return
        if (m.params.request.method === 'POST') retenida = { id: m.params.requestId, estado: m.params.responseStatusCode } // NO se continúa, NO se falla
        else C.enviar('Fetch.continueResponse', { requestId: m.params.requestId }).catch(() => {})
      })
      await abrirAlta(C)
      await rellenar(C, { nombre: 'Interrumpida', apellido: 'Pestana', numero: 51 })
      await hojaClic(C, 'Añadir jugador')
      for (let i = 0; i < 60 && !retenida; i += 1) await espera(100)
      assert.ok(retenida, 'la respuesta de la alta no llegó a retenerse')
      assert.equal(retenida.estado, 200, 'el servidor no había respondido 200 al retenerse')
      // 1) El servidor YA aplicó la alta (se lee desde la pestaña principal A, que no retiene nada).
      assert.equal((await fichasServidor()).length, 1, 'el servidor no había confirmado')
      // 2) Esperamos un tiempo: el manejador de la página sigue sin ejecutarse; el registro sigue «enviando».
      await espera(1500)
      const textoC = await C.evalu('document.body.innerText')
      assert.ok(textoC.includes('Enviando una acción'), 'la pestaña no muestra «enviando»')
      assert.ok(!textoC.includes('No sabemos si el servidor aplicó'), 'el manejador de respuesta ya había clasificado la respuesta')
      const textoEnC = await registroDe(C)
      const enC = JSON.parse(textoEnC)
      assert.deepEqual([enC.ultimo, enC.intentos, enC.conIncierto, enC.tipo], ['enviando', 1, false, 'alta'], `el registro en la pestaña viva no era «enviando»: ${textoEnC}`)
      const primero = posts(C).at(-1)
      assert.equal(posts(C).length, 1)
      assert.equal(enC.cuerpoJson, primero.cuerpo, 'el cuerpo guardado no es el enviado')
      const llaveC = await claveOp(C)
      // El candado de la liga lo mantiene la pestaña que envía (se consulta desde otra pestaña del mismo origen).
      const candadoRetenido = () => A.evalu(`navigator.locks.query().then((q) => q.held.some((c) => c.name.endsWith(':${liga}') && c.name.startsWith('sebel-op:')))`)
      assert.equal(await candadoRetenido(), true, 'la pestaña que envía no retenía el candado de la liga')
      // 3) Se cierra la pestaña que envía (cierre real de la página en Chrome).
      // OJO: NO se cierra antes la sesión de DevTools: al desconectarse, Chrome reanudaría la respuesta retenida y la página la clasificaría.
      assert.equal((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${C.destinoId}`)).ok, true)
      for (let i = 0; i < 50; i += 1) { const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json(); if (!lista.some((t) => t.id === C.destinoId)) break; await espera(100) }
      const abiertas = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()
      assert.ok(!abiertas.some((t) => t.id === C.destinoId), 'la pestaña no se cerró')
      try { C.ws.close() } catch { /* ya cerrada */ }
      for (let i = 0; i < 100 && await candadoRetenido(); i += 1) await espera(100)
      assert.equal(await candadoRetenido(), false, 'el candado de la pestaña cerrada no se liberó')
      // 4) Se reabre la aplicación en el MISMO perfil desechable, en una pestaña nueva.
      D = await nuevaPestana()
      await abrirPlantilla(liga, equipo, D)
      try { await hayTexto(D, 'Acción sin confirmar') } catch (e) { // el panel de recuperación
        throw new Error(`${e.message}; ruta ${await D.evalu('location.pathname')}; registro ${await registroDe(D)}; página «${(await texto(D)).replaceAll('\n', ' | ').slice(0, 400)}»; consola ${D.consola.slice(-3).join(' / ')}`)
      }
      await hayTexto(D, 'Se estaba enviando cuando la página se cerró o se recargó.')
      const textoEnD = await registroDe(D)
      assert.equal(textoEnD, textoEnC, 'el registro tras reabrir no es idéntico (byte a byte) al que tenía la pestaña al morir')
      assert.equal(await claveOp(D), llaveC)
      assert.equal(posts(D).length, 0, 'al reabrir se envió algo solo')
      await espera(1200)
      assert.equal(posts(D).length, 0, 'tras reabrir se envió algo solo')
      assert.equal((await fichasServidor()).length, 1)
      await captura('14-pestana-cerrada-enviando.png', D)
      assert.equal(await D.evalu("[...document.querySelectorAll('button')].some((b) => /descartar|cancelar|olvidar/i.test(b.textContent))"), false)
      // 5) Repetición EXPLÍCITA: mismo identificador y mismo cuerpo; el servidor reproduce el recibo original.
      await clic(D, 'Repetir la misma solicitud')
      await hayTexto(D, 'Esta acción ya se había procesado antes')
      assert.equal(posts(D).length, 1, 'la repetición no envió exactamente una petición')
      const repeticion = posts(D).at(-1)
      assert.equal(repeticion.cuerpo, primero.cuerpo, 'la repetición no es byte a byte la original')
      assert.equal(JSON.parse(repeticion.cuerpo).operacionId, enC.operacionId)
      assert.equal(repeticion.url, primero.url)
      const respuestaRepeticion = D.respuestas.filter((r) => r.url.includes('/jugadores') && r.status === 200).at(-1)
      assert.ok(respuestaRepeticion, 'no hubo respuesta 200 a la repetición')
      // 6) Sin duplicados; el registro se limpia SOLO tras ese resultado decidido.
      const fichas = await fichasServidor()
      assert.equal(fichas.length, 1, 'se duplicó la alta')
      assert.deepEqual([fichas[0].dorsal, fichas[0].rev], [51, 1], 'la ficha cambió con la repetición')
      assert.deepEqual(await llavesOp(D), [])
      assert.equal((await todos(liga, equipo)).filter((j) => j.dorsal === 51).length, 1)
      return `registro al cerrar: ${textoEnC.replace(/"cuerpoJson":"(?:\\.|[^"\\])*"/, '"cuerpoJson":"…"')} ; reabierto idéntico; 1 POST de repetición con el mismo cuerpo (${primero.cuerpo.length} B); 1 ficha en servidor; registros tras decidir: 0`
    } finally {
      for (const p of [C, D]) {
        if (!p) continue
        try { p.ws.close() } catch { /* ya cerrada */ }
        await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${p.destinoId}`).catch(() => {})
      }
      await A.enviar('Page.bringToFront')
    }
  })
} catch (e) {
  resultados.push({ nombre: 'preparación', ok: false, nota: String(e.message ?? e) })
} finally {
  for (const p of hijos.reverse()) await matar(p)
  rmSync(ESTADO, { recursive: true, force: true, maxRetries: 3 })
}

let fallos = 0
for (const r of resultados) { if (!r.ok) fallos += 1; console.log(`${r.ok ? 'OK ' : 'FALLA'}  ${r.nombre}${r.nota ? `  —  ${r.nota}` : ''}`) }
console.log(fallos === 0 ? 'NAVEGADOR DE PLANTILLAS: OK' : `NAVEGADOR DE PLANTILLAS: ${fallos} FALLO(S)`)
