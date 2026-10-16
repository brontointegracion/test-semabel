// Comprobación en un navegador REAL, aislada y con acceso sintético.
//   - compila la aplicación en modo compartido en una carpeta temporal (no toca ../dist);
//   - levanta wrangler dev por HTTPS local con esa carpeta como archivos estáticos y almacenamiento temporal;
//   - da de alta un organizador SINTÉTICO por la ruta del operador (secretos de un solo uso, solo en este proceso);
//   - lanza Chrome con un perfil DESECHABLE (nunca el del usuario) y lo maneja por el protocolo DevTools;
//   - comprueba cookie, recarga, cierre de sesión, enrutamiento JSON de la API, ausencia del código en URL, almacenamiento,
//     cachés y registros, el diseño a ancho de teléfono y los encabezados.
// Uso (desde backend/):  node scripts/navegador-local.mjs     Variables: CAPTURAS=<carpeta para las capturas>
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // solo este proceso, solo para el certificado autofirmado local
const RAIZ = resolve(import.meta.dirname, '..')
const REPO = resolve(RAIZ, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'navegador')
const CAPTURAS = process.env.CAPTURAS ?? join(ESTADO, 'capturas')
const PUERTO = 8798
const PUERTO_CDP = 9335
const ORIGEN = `https://localhost:${PUERTO}`
const OPERADOR = 'operador-navegador-sintetico-0000000001'
const LIGAS = ['LIGANAV1', 'LIGANAV2']
const CHROME = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync)
const MENSAJES = {
  invalido: 'Ese código no es válido. Revísalo y vuelve a escribirlo.',
  sinConexion: 'Se requiere conexión a internet para esta acción.',
  incierto: 'No pudimos confirmar el acceso. Vuelve a escribir el código.',
  salidaIncierta: 'No pudimos confirmar el cierre de sesión. Tu sesión sigue abierta; vuelve a intentarlo.',
  demasiados: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
}

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
const servidor = lanzar(join(RAIZ, 'node_modules', '.bin', 'wrangler'), [
  'dev', '--port', String(PUERTO), '--ip', '127.0.0.1', '--local-protocol', 'https', '--persist-to', join(ESTADO, 'persistencia'),
  '--assets', DIST, '--var', `LIGAS_ADMITIDAS:${LIGAS.join(',')}`, '--var', `ACCESO_ORIGEN:${ORIGEN}`,
  '--var', 'ACCESO_ADMIN_HABILITADO:1', '--var', `ACCESO_ADMIN_TOKEN:${OPERADOR}`,
], { cwd: RAIZ, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' } })

let chrome = null
const resultados = []
async function paso(nombre, fn) {
  try { const nota = await fn(); resultados.push({ nombre, ok: true, nota }) } catch (e) { resultados.push({ nombre, ok: false, nota: String(e.message ?? e).split('\n')[0] }) }
}

try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`https://127.0.0.1:${PUERTO}/v1/organizador/yo`)).status === 401) break } catch { /* aún no */ }
    await espera(500)
    if (i === 119) throw new Error(`wrangler no arrancó:\n${servidor.registro.slice(-1500)}`)
  }
  const alta = await fetch(`https://127.0.0.1:${PUERTO}/v1/admin/organizador`, {
    method: 'POST', headers: { authorization: `Bearer ${OPERADOR}`, 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Organizador sintético', ligas: LIGAS }),
  })
  assert.equal(alta.status, 201, 'alta del organizador sintético')
  const CODIGO = (await alta.json()).codigo
  const SECRETO = CODIGO.replaceAll('-', '').slice(5)

  // --- 3. Chrome con perfil desechable ---
  chrome = lanzar(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${PERFIL}`, '--ignore-certificate-errors',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ])
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break } catch { await espera(250) } }
  const destino = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(destino.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

  // --- Cliente CDP mínimo ---
  let id = 0
  const pendientes = new Map()
  const oyentes = []
  const consola = []
  const peticiones = []
  const respuestas = []
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && pendientes.has(m.id)) { const { ok, ko } = pendientes.get(m.id); pendientes.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') consola.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
    if (m.method === 'Log.entryAdded') consola.push(`${m.params.entry.level}: ${m.params.entry.text}`)
    if (m.method === 'Network.requestWillBeSent') peticiones.push({ url: m.params.request.url, metodo: m.params.request.method, cuerpo: m.params.request.postData ?? null })
    if (m.method === 'Network.responseReceived') respuestas.push({ url: m.params.response.url, status: m.params.response.status, cabeceras: Object.fromEntries(Object.entries(m.params.response.headers).map(([k, v]) => [k.toLowerCase(), v])), tipo: m.params.type })
    oyentes.forEach((f) => f(m))
  }
  const enviar = (metodo, params = {}) => new Promise((ok, ko) => { id += 1; pendientes.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method: metodo, params })) })
  const evalu = async (expresion) => {
    const r = await enviar('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error de evaluación')
    return r.result.value
  }
  const hasta = async (expresion, ms = 8000, etiqueta = expresion) => {
    const t = Date.now()
    while (Date.now() - t < ms) { try { if (await evalu(expresion)) return true } catch { /* la página cambia */ } await espera(100) }
    throw new Error(`no se cumplió: ${etiqueta}`)
  }
  const navegar = async (ruta) => {
    const cargada = new Promise((r) => { const f = (m) => { if (m.method === 'Page.loadEventFired') { oyentes.splice(oyentes.indexOf(f), 1); r() } }; oyentes.push(f) })
    await enviar('Page.navigate', { url: `${ORIGEN}${ruta}` })
    await cargada
  }
  const texto = () => evalu('document.body.innerText')
  const escribir = async (valor) => {
    await evalu("document.getElementById('codigo-acceso').focus()"); await enviar('Input.insertText', { text: valor })
    await hasta("!document.querySelector('form button[type=submit]').disabled", 3000, 'botón activado') // React ya registró el texto
  }
  const pulsar = (nombre) => evalu(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(nombre)}).click()`)
  const alerta = () => evalu("document.querySelector('[role=alert]')?.textContent ?? null")
  const captura = async (nombre) => writeFileSync(join(CAPTURAS, nombre), Buffer.from((await enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  const cookies = async () => (await enviar('Network.getCookies', { urls: [ORIGEN] })).cookies
  const enSesion = () => cookies().then((c) => c.find((x) => x.name === '__Host-sesion'))
  const interceptar = async (patron) => {
    await enviar('Fetch.enable', { patterns: [{ urlPattern: patron, requestStage: 'Request' }] })
    const f = (m) => { if (m.method === 'Fetch.requestPaused') enviar('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionReset' }).catch(() => {}) }
    oyentes.push(f)
    return async () => { oyentes.splice(oyentes.indexOf(f), 1); await enviar('Fetch.disable') }
  }
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await enviar(`${d}.enable`)
  await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const volcadoDeAlmacenamiento = () => evalu(`(async () => {
    const salida = { local: JSON.stringify({ ...localStorage }), sesion: JSON.stringify({ ...sessionStorage }), cookie: document.cookie, url: location.href, bases: {}, caches: {} }
    for (const { name } of (await indexedDB.databases())) {
      salida.bases[name] = await new Promise((ok) => { const r = indexedDB.open(name); r.onsuccess = async () => { const db = r.result; const o = {}
        for (const s of db.objectStoreNames) o[s] = await new Promise((k) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => k(q.result); q.onerror = () => k(null) })
        db.close(); ok(o) }; r.onerror = () => ok(null) })
    }
    for (const nombre of await caches.keys()) { const c = await caches.open(nombre); const o = []; for (const p of await c.keys()) { const resp = await c.match(p); o.push({ url: p.url, texto: p.url.includes('/v1/') ? await resp.text() : '' }) } salida.caches[nombre] = o }
    return JSON.stringify(salida)
  })()`)

  // ---------- Pasos ----------
  await paso('1. /anthony/access (caída a la aplicación) abre la entrada del organizador y los encabezados estáticos', async () => {
    await navegar('/anthony/access')
    await hasta("document.querySelector('h1')?.textContent === 'Acceso del organizador'")
    const doc = respuestas.find((r) => r.url === `${ORIGEN}/anthony/access` && r.tipo === 'Document')
    assert.equal(doc.status, 200)
    const h = doc.cabeceras
    const notas = []
    for (const [nombre, esperado] of [['referrer-policy', 'no-referrer'], ['x-content-type-options', 'nosniff'], ['x-robots-tag', 'noindex'], ['cache-control', 'no-store']]) {
      const v = h[nombre]
      notas.push(`${nombre}=${v ?? 'AUSENTE'}`)
    }
    const csp = h['content-security-policy']
    notas.push(`csp=${csp ? 'presente' : 'AUSENTE'}`)
    return notas.join(' ')
  })

  await paso('2. Diseño a ancho de teléfono (390 px): sin desbordamiento, campo ≥16 px, objetivos ≥44 px', async () => {
    const m = await evalu(`(() => { const i = document.getElementById('codigo-acceso'); const b = document.querySelector('form button[type=submit]'); const ri = i.getBoundingClientRect(); const rb = b.getBoundingClientRect()
      return { ancho: innerWidth, scroll: document.documentElement.scrollWidth, campoIzq: ri.left, campoDer: ri.right, campoAlto: ri.height, fuente: parseFloat(getComputedStyle(i).fontSize), btnAlto: rb.height, btnDer: rb.right, btnIzq: rb.left } })()`)
    assert.ok(m.scroll <= m.ancho, `desborda: ${m.scroll} > ${m.ancho}`)
    assert.ok(m.campoIzq >= 0 && m.campoDer <= m.ancho && m.btnIzq >= 0 && m.btnDer <= m.ancho, 'fuera de pantalla')
    assert.ok(m.fuente >= 16, `fuente del campo ${m.fuente}`)
    assert.ok(m.campoAlto >= 44 && m.btnAlto >= 44, `alturas ${m.campoAlto}/${m.btnAlto}`)
    await captura('01-formulario-390.png')
    return `ancho ${m.ancho}, campo ${Math.round(m.campoAlto)}px/${m.fuente}px, botón ${Math.round(m.btnAlto)}px`
  })

  await paso('3. Código erróneo: mensaje fijo, campo vacío, sin sesión', async () => {
    await escribir('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ'); await pulsar('Entrar')
    try { await hasta("!!document.querySelector('[role=alert]')") } catch (e) {
      const t = (await texto()).replaceAll('\n', ' | ')
      const ult = peticiones.slice(-3).map((p) => `${p.metodo} ${new URL(p.url).pathname}`).join(', ')
      const resp = respuestas.slice(-3).map((r) => `${new URL(r.url).pathname}=${r.status}`).join(', ')
      throw new Error(`${e.message}; página: «${t.slice(0, 120)}»; peticiones: ${ult}; respuestas: ${resp}; consola: ${consola.slice(-3).join(' / ')}`)
    }
    assert.equal(await alerta(), MENSAJES.invalido)
    assert.equal(await evalu("document.getElementById('codigo-acceso').value"), '')
    assert.equal(await enSesion(), undefined)
  })

  await paso('4. Sin conexión: la frase aprobada y ninguna petición de acceso', async () => {
    const antes = peticiones.filter((p) => p.url.includes('/v1/acceso/')).length
    await enviar('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await hasta('navigator.onLine === false', 3000)
    await escribir(CODIGO); await pulsar('Entrar')
    await hasta("document.querySelector('[role=alert]')?.textContent.includes('conexión')")
    assert.equal(await alerta(), MENSAJES.sinConexion)
    assert.equal(peticiones.filter((p) => p.url.includes('/v1/acceso/')).length, antes)
    await enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await hasta('navigator.onLine === true', 3000)
  })

  await paso('5. Respuesta perdida con el código correcto: no se afirma el acceso y no queda cookie', async () => {
    const quitar = await interceptar('*/v1/acceso/organizador*')
    await escribir(CODIGO); await pulsar('Entrar')
    await hasta("document.querySelector('[role=alert]')?.textContent.includes('No pudimos confirmar el acceso')")
    assert.equal(await alerta(), MENSAJES.incierto)
    assert.equal(await evalu("document.querySelector('h1').textContent"), 'Acceso del organizador')
    await quitar()
    assert.equal(await enSesion(), undefined)
  })

  await paso('6. Código correcto: acceso confirmado con /yo y ligas autorizadas', async () => {
    await escribir(CODIGO); await pulsar('Entrar')
    await hasta("document.querySelector('h1')?.textContent === 'Acceso autorizado'")
    // Desde REPORT_105 la página enlaza al panel de plantillas en lugar de listar identificadores.
    assert.equal(await evalu("document.querySelector('.acceso .sub')?.textContent"), `Tienes acceso a ${LIGAS.length} ligas.`)
    assert.equal(await evalu("document.querySelector('a[href=\"/anthony/ligas\"]')?.textContent"), 'Ver mis ligas y plantillas')
    const llamadas = peticiones.filter((p) => p.url.includes('/v1/')).map((p) => `${p.metodo} ${new URL(p.url).pathname}`)
    assert.ok(llamadas.lastIndexOf('GET /v1/organizador/yo') > llamadas.lastIndexOf('POST /v1/acceso/organizador'), '/yo después del inicio de sesión')
    await captura('02-acceso-autorizado-390.png')
    const m = await evalu('({ ancho: innerWidth, scroll: document.documentElement.scrollWidth })')
    assert.ok(m.scroll <= m.ancho)
  })

  await paso('7. Cookie: HttpOnly, Secure, SameSite=Strict, host-only, ruta /, invisible para el script', async () => {
    const c = await enSesion()
    assert.ok(c, 'falta la cookie')
    assert.equal(c.httpOnly, true); assert.equal(c.secure, true); assert.equal(c.sameSite, 'Strict'); assert.equal(c.path, '/')
    assert.ok(!c.domain.startsWith('.'), `dominio ${c.domain}`)
    assert.ok(c.expires > Date.now() / 1000 && c.expires - Date.now() / 1000 <= 24 * 3600 + 5, 'caducidad ≤ 24 h')
    assert.ok(!(await evalu('document.cookie')).includes('__Host-sesion'))
    return `${c.name} dominio=${c.domain}`
  })

  await paso('8. El código no está en URL, almacenamiento, IndexedDB, cachés, DOM, consola ni peticiones (salvo el cuerpo del POST)', async () => {
    const volcado = await volcadoDeAlmacenamiento()
    const cuerpo = await texto()
    for (const [nombre, contenido] of [['almacenamiento', volcado], ['DOM', cuerpo], ['consola', consola.join('\n')]]) {
      assert.ok(!contenido.replaceAll('-', '').includes(SECRETO), `${nombre} contiene el código`)
    }
    for (const p of peticiones) assert.ok(!p.url.replaceAll('-', '').includes(SECRETO), `URL con el código: ${p.url}`)
    const posts = peticiones.filter((p) => p.metodo === 'POST' && p.url.endsWith('/v1/acceso/organizador'))
    assert.ok(posts.length >= 1 && posts.some((p) => (p.cuerpo ?? '').includes(CODIGO.slice(0, 5))), 'el cuerpo del POST sí lleva el código')
    const v = JSON.parse(volcado)
    return `bases: ${Object.keys(v.bases).join(',') || 'ninguna'}; cachés: ${Object.keys(v.caches).join(',') || 'ninguna'}`
  })

  await paso('9. Respuestas de la API sin caché y sin referrer; sin errores de CSP en la consola', async () => {
    const api = respuestas.filter((r) => new URL(r.url).pathname.startsWith('/v1/'))
    assert.ok(api.length >= 3)
    for (const r of api) { assert.equal(r.cabeceras['cache-control'], 'no-store', r.url); assert.equal(r.cabeceras['referrer-policy'], 'no-referrer', r.url) }
    const csp = consola.filter((l) => /content security policy|refused to/i.test(l))
    assert.deepEqual(csp, [])
    return `${api.length} respuestas de la API; mensajes de consola: ${consola.length}`
  })

  await paso('10. Recargar conserva la sesión (la cookie, no el navegador)', async () => {
    await enviar('Page.reload')
    await hasta("document.querySelector('h1')?.textContent === 'Acceso autorizado'", 10000)
    assert.ok(await enSesion())
  })

  await paso('11. Cierre de sesión con respuesta perdida: no se afirma; la sesión sigue', async () => {
    const quitar = await interceptar('*/v1/organizador/salir*')
    await pulsar('Cerrar sesión')
    await hasta("document.querySelector('[role=alert]')?.textContent.includes('cierre de sesión')")
    assert.equal(await alerta(), MENSAJES.salidaIncierta)
    assert.equal(await evalu("document.querySelector('h1').textContent"), 'Acceso autorizado')
    await quitar()
    assert.ok(await enSesion())
  })

  await paso('12. Cierre de sesión confirmado: vuelve el formulario, la cookie se borra y recargar no la recupera', async () => {
    await pulsar('Cerrar sesión')
    await hasta("document.querySelector('h1')?.textContent === 'Acceso del organizador'")
    assert.equal(await enSesion(), undefined)
    await enviar('Page.reload')
    await hasta("document.querySelector('h1')?.textContent === 'Acceso del organizador'", 10000)
    assert.equal(await enSesion(), undefined)
  })

  await paso('13. La API responde JSON, nunca la página de la aplicación (fetch y navegación, con o sin service worker)', async () => {
    const sw = await evalu('navigator.serviceWorker ? (async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (r.active ? "activo" : "registrado") : "sin registro" })() : "sin soporte"')
    const f = await evalu(`(async () => { const salida = {}; for (const ruta of ['/v1/no-existe', '/v1/organizador/yo', '/v1/ligas/LIGANAV1/partidos/NOHAY']) { const r = await fetch(ruta, { cache: 'no-store' }); salida[ruta] = { status: r.status, tipo: r.headers.get('content-type'), cuerpo: (await r.text()).slice(0, 80) } } return salida })()`)
    assert.equal(f['/v1/no-existe'].status, 404); assert.match(f['/v1/no-existe'].tipo, /json/); assert.equal(f['/v1/no-existe'].cuerpo, '{"error":"no-encontrado"}')
    assert.equal(f['/v1/organizador/yo'].status, 401); assert.match(f['/v1/organizador/yo'].tipo, /json/)
    assert.equal(f['/v1/ligas/LIGANAV1/partidos/NOHAY'].status, 404); assert.match(f['/v1/ligas/LIGANAV1/partidos/NOHAY'].tipo, /json/)
    for (const ruta of ['/v1/no-existe', '/v1/organizador/yo']) {
      await navegar(ruta)
      const t = await texto()
      assert.ok(t.startsWith('{') && !t.toLowerCase().includes('<html'), `navegación a ${ruta}: ${t.slice(0, 60)}`)
    }
    return `service worker: ${sw}`
  })

  await paso('14. Caídas de la aplicación: ruta desconocida y portada muestran "en preparación", sin datos de demostración', async () => {
    for (const ruta of ['/', '/ruta/que/no/existe', '/ligas', '/l/liga-4821']) {
      await navegar(ruta)
      await hasta("document.body.innerText.includes('Estamos preparando')")
      const t = await texto()
      assert.ok(!/Chiricana|Antioque|Don Bosco|Halcones|Titanes|Soy organizador/i.test(t), `${ruta} muestra datos del prototipo`)
    }
    const v = JSON.parse(await volcadoDeAlmacenamiento())
    const ligasLocales = (v.bases.sebel?.ligas ?? []).length
    assert.equal(ligasLocales, 0, 'no se sembró ninguna liga')
    await captura('03-en-preparacion-390.png')
    return `sesión local: ${JSON.stringify(v.bases.sebel?.meta?.find((m) => m.id === 'sesion') ?? null)}`
  })

  await paso('15. Demasiados intentos (cubo por fuente): mensaje fijo de limitación', async () => {
    for (let i = 0; i < 22; i += 1) {
      await fetch(`https://127.0.0.1:${PUERTO}/v1/acceso/organizador`, {
        method: 'POST', headers: { origin: ORIGEN, 'x-sebel-peticion': '1', 'content-type': 'application/json' }, body: JSON.stringify({ codigo: 'YYYYY-YYYYY-YYYYY-YYYYY' }),
      })
    }
    await navegar('/anthony/access')
    await hasta("document.querySelector('h1')?.textContent === 'Acceso del organizador'")
    await escribir(CODIGO); await pulsar('Entrar')
    await hasta("document.querySelector('[role=alert]')?.textContent.includes('Demasiados')")
    assert.equal(await alerta(), MENSAJES.demasiados)
    assert.equal(await enSesion(), undefined)
  })

  await paso('16. Los registros del servidor no contienen el código, el secreto de sesión ni el secreto del operador', async () => {
    const registro = servidor.registro
    assert.ok(!registro.replaceAll('-', '').includes(SECRETO), 'registro con el código')
    assert.ok(!registro.includes(OPERADOR), 'registro con el secreto del operador')
    return `${registro.split('\n').length} líneas revisadas`
  })
} catch (e) {
  resultados.push({ nombre: 'preparación', ok: false, nota: String(e.message ?? e) })
} finally {
  for (const p of hijos.reverse()) await matar(p)
  rmSync(ESTADO, { recursive: true, force: true, maxRetries: 3 })
  // (las capturas, si CAPTURAS apuntaba fuera de ESTADO, se conservan)
}

let fallos = 0
for (const r of resultados) { if (!r.ok) fallos += 1; console.log(`${r.ok ? 'OK ' : 'FALLA'}  ${r.nombre}${r.nota ? `  —  ${r.nota}` : ''}`) }
console.log(fallos === 0 ? 'NAVEGADOR LOCAL: OK' : `NAVEGADOR LOCAL: ${fallos} FALLO(S)`)
process.exit(fallos === 0 ? 0 : 1)
