// Humo local con reinicio REAL del proceso de workerd. Con datos sintéticos y almacenamiento aislado:
//   siembra una liga SIN credenciales de partido; el operador da de alta al organizador; el organizador entra con su
//   código, emite el código del partido; un "teléfono" lo activa mandando solo el hash de su token e inicia el partido;
//   se mata el proceso, se vuelve a levantar sobre la misma carpeta y se comprueba que sobreviven la sesión, el estado,
//   el recibo, el cursor, la bandeja y la activación (recuperable); y que en disco no hay ningún secreto en claro.
//   También: un alta de plantilla del organizador (equipo cuyo partido no empezó) y su recibo sobreviven al reinicio, un
//   equipo con partido en curso rechaza la edición, y la lectura de preparación del teléfono responde con su credencial.
//
// Uso (desde backend/):  node scripts/humo-local.mjs
// No usa Cloudflare ni credenciales reales. Escribe SOLO en backend/.wrangler-state/humo (ignorado por git) y lo borra al empezar.
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const RAIZ = resolve(import.meta.dirname, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'humo')
const PUERTO = 8799
const BASE = `http://127.0.0.1:${PUERTO}`
const SEMILLA = 'semilla-humo-local-0001'
const OPERADOR = 'operador-humo-local-sintetico-0000000001'
const ORIGEN = 'https://humo.local'
const LIGA = 'LIGAHUMO'

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(ESTADO, { recursive: true })
// wrangler.jsonc sirve la aplicación desde ../dist; el humo no la necesita: se le da una carpeta mínima y temporal.
const ACTIVOS = join(ESTADO, 'activos-vacios')
mkdirSync(ACTIVOS, { recursive: true })
writeFileSync(join(ACTIVOS, 'index.html'), '<!doctype html><title>humo</title>')

// 1. Empaquetar el cliente (usa el motor sin cambios).
const salidaCliente = join(ESTADO, 'cliente.mjs')
execFileSync(join(RAIZ, 'node_modules', '.bin', 'esbuild'), [
  join(RAIZ, 'scripts', 'cliente-humo.js'), '--bundle', '--format=esm', '--platform=node', `--outfile=${salidaCliente}`, '--log-level=error',
], { stdio: 'inherit' })
const { sobreDeInicio, payloadDeLiga } = await import(pathToFileURL(salidaCliente).href)

let servidor = null
async function levantar() {
  servidor = spawn(join(RAIZ, 'node_modules', '.bin', 'wrangler'), [
    'dev', '--port', String(PUERTO), '--ip', '127.0.0.1', '--persist-to', join(ESTADO, 'persistencia'), '--assets', ACTIVOS,
    '--var', 'PERMITIR_SEMILLA:1', '--var', `SEMILLA_TOKEN:${SEMILLA}`, '--var', `LIGAS_ADMITIDAS:${LIGA}`,
    '--var', `ACCESO_ORIGEN:${ORIGEN}`, '--var', 'ACCESO_ADMIN_HABILITADO:1', '--var', `ACCESO_ADMIN_TOKEN:${OPERADOR}`,
  ], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' } })
  let log = ''
  servidor.stdout.on('data', (d) => { log += d })
  servidor.stderr.on('data', (d) => { log += d })
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/v1/ligas/x/partidos/y`)).status === 404) return } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`workerd no arrancó:\n${log.slice(-2000)}`)
}
async function matar() {
  if (!servidor) return
  const fin = new Promise((r) => servidor.once('exit', r))
  try { process.kill(-servidor.pid, 'SIGTERM') } catch { /* ya terminó */ }
  await Promise.race([fin, new Promise((r) => setTimeout(r, 8000))])
  try { process.kill(-servidor.pid, 'SIGKILL') } catch { /* ya terminó */ }
  servidor = null
}

const json = { 'content-type': 'application/json' }
const post = (ruta, cuerpo, cabeceras = {}) => fetch(`${BASE}${ruta}`, { method: 'POST', headers: { ...json, ...cabeceras }, body: JSON.stringify(cuerpo) })
const organizador = (cookie) => ({ origin: ORIGEN, 'x-sebel-peticion': '1', cookie: `__Host-sesion=${cookie}` })
const sha256 = (t) => createHash('sha256').update(t).digest('hex')
const leer = async () => (await fetch(`${BASE}/v1/ligas/${LIGA}/partidos/P`)).json()

// Objetos Durable Object de liga que existen en disco (uno por liga que alguna vez se instanció).
function objetosEnDisco() {
  const carpeta = join(ESTADO, 'persistencia', 'v3', 'do', 'sebel-liga-backend-LigaDO')
  if (!existsSync(carpeta)) return 0
  return readdirSync(carpeta).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite').length
}
const archivos = (d) => readdirSync(d).flatMap((n) => { const r = join(d, n); return statSync(r).isDirectory() ? archivos(r) : [r] })

function contarEnDisco() {
  for (const a of archivos(join(ESTADO, 'persistencia')).filter((f) => f.endsWith('.sqlite'))) {
    // Se lee una COPIA (con su -wal): no se toca la base persistida.
    const copia = join(ESTADO, 'copia-lectura', a.split('/').slice(-1)[0])
    mkdirSync(join(ESTADO, 'copia-lectura'), { recursive: true })
    for (const sufijo of ['', '-wal', '-shm']) if (existsSync(a + sufijo)) copyFileSync(a + sufijo, copia + sufijo)
    const db = new DatabaseSync(copia)
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bandeja'").get()) continue
      if (db.prepare('SELECT COUNT(*) n FROM partidos').get().n === 0) continue
      return {
        recibos: db.prepare('SELECT COUNT(*) n FROM recibos').get().n,
        bandejaPendiente: db.prepare('SELECT COUNT(*) n FROM bandeja WHERE entregado_en IS NULL').get().n,
        rev: db.prepare("SELECT rev FROM partidos WHERE id='P'").get().rev,
        credencialesActivas: db.prepare('SELECT COUNT(*) n FROM credenciales WHERE revocada = 0').get().n,
        operacionesPlantilla: db.prepare('SELECT COUNT(*) n FROM operaciones_plantilla').get().n,
        auditoriaPlantilla: db.prepare('SELECT COUNT(*) n FROM auditoria_plantilla').get().n,
        fichasNuevas: db.prepare("SELECT COUNT(*) n FROM jugadores WHERE id LIKE 'f-%'").get().n,
      }
    } finally { db.close() }
  }
  throw new Error('no se encontró la base SQLite del objeto de la liga')
}

// Busca un texto en CUALQUIER archivo guardado (bases y registros de escritura anticipada).
const enDisco = (texto) => archivos(join(ESTADO, 'persistencia')).filter((f) => readFileSync(f).includes(texto))

try {
  await levantar()

  // --- Preparación: liga sin credenciales de partido, organizador y sesión ---
  const payload = payloadDeLiga(LIGA)
  payload.credenciales = []
  assert.equal((await post(`/v1/_semilla/ligas/${LIGA}`, payload, { authorization: `Bearer ${SEMILLA}` })).status, 201, 'siembra')
  const alta = await post('/v1/admin/organizador', { nombre: 'Organizador sintético', ligas: [LIGA] }, { authorization: `Bearer ${OPERADOR}` })
  assert.equal(alta.status, 201, 'alta del organizador')
  const codigoOrganizador = (await alta.json()).codigo
  const login = await post('/v1/acceso/organizador', { codigo: codigoOrganizador }, { origin: ORIGEN, 'x-sebel-peticion': '1' })
  assert.equal(login.status, 200, 'inicio de sesión')
  const cookie = /^__Host-sesion=([^;]+)/.exec(login.headers.get('set-cookie'))[1]
  assert.match(login.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/)

  // --- Código de partido y activación del teléfono (solo viaja el hash del token) ---
  const emitido = await post(`/v1/organizador/ligas/${LIGA}/partidos/P/codigo`, {}, organizador(cookie))
  assert.equal(emitido.status, 200, 'código de partido')
  const codigoPartido = (await emitido.json()).codigo
  const token = randomBytes(32).toString('hex')
  const activar = () => post(`/v1/ligas/${LIGA}/partidos/P/activar`, { codigo: codigoPartido, tokenHash: sha256(token) })
  const act = await activar()
  assert.equal(act.status, 200, 'activación')
  const { deviceId } = await act.json()

  // --- Inicio del partido con la credencial activada ---
  const inicio = sobreDeInicio(LIGA, { cmdId: 'humo-inicio-1', clientSeq: 1, deviceId })
  const comando = (sobre) => post(`/v1/ligas/${LIGA}/partidos/P/comandos`, sobre, { authorization: `Bearer ${token}` })
  const c1 = await (await comando(inicio)).json()
  assert.equal(c1.resultado, 'aceptado')
  const antes = await leer()
  assert.equal(antes.estado, 'vivo')
  console.log('antes del reinicio  :', JSON.stringify({ estado: antes.estado, rev: antes.rev }), '| dispositivo', deviceId)

  // --- Plantilla compartida: el equipo E3 no juega el partido en curso; E1 sí ---
  const rutaE3 = `/v1/organizador/ligas/${LIGA}/equipos/E3/jugadores`
  const rutaE1 = `/v1/organizador/ligas/${LIGA}/equipos/E1/jugadores`
  const altaE3 = { operacionId: 'humo-op-alta-00000000001', campos: { nombrePila: 'Humo', apellido1: 'Sintetico', dorsal: 50 } }
  const a1 = await (await post(rutaE3, altaE3, organizador(cookie))).json()
  assert.deepEqual([a1.resultado, a1.tipo, a1.reproducido], ['aplicado', 'creado', false])
  const fichaNueva = a1.ficha.id
  const b1 = await (await post(rutaE1, { operacionId: 'humo-op-bloqueo-0000000001', campos: { nombrePila: 'Otro', apellido1: 'Humo', dorsal: 51 } }, organizador(cookie))).json()
  assert.deepEqual([b1.resultado, b1.tipo], ['rechazado', 'equipo-bloqueado'])
  const prepUrl = `${BASE}/v1/ligas/${LIGA}/partidos/P/preparacion`
  const prep1 = await fetch(prepUrl, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(prep1.status, 200, 'lectura de preparación con la credencial activa')
  const prepCuerpo1 = await prep1.json()
  assert.deepEqual(Object.keys(prepCuerpo1).sort(), ['etiquetas', 'preparacion', 'rev', 'ultimoClientSeq'])
  assert.equal(prepCuerpo1.ultimoClientSeq, 1)
  assert.equal((await fetch(prepUrl)).status, 401, 'sin credencial no hay preparación')

  // Admisión: una liga fuera de LIGAS_ADMITIDAS recibe 404 y NO crea ningún objeto.
  assert.equal(objetosEnDisco(), 1)
  for (const [metodo, ruta] of [['GET', '/v1/ligas/LIGANOADMITIDA/partidos/P'], ['POST', '/v1/ligas/LIGANOADMITIDA/partidos/P/activar']]) {
    const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: json, body: metodo === 'POST' ? '{}' : undefined })
    assert.equal(r.status, 404, `${metodo} ${ruta}`)
  }
  assert.equal(objetosEnDisco(), 1, 'las ligas no admitidas no crearon ningún objeto')

  await matar()
  const disco = contarEnDisco()
  assert.deepEqual(disco, { recibos: 1, bandejaPendiente: 1, rev: 1, credencialesActivas: 1, operacionesPlantilla: 2, auditoriaPlantilla: 1, fichasNuevas: 1 })
  console.log('en disco (apagado)  :', JSON.stringify(disco))
  // Nada en claro en ningún archivo guardado: ni códigos, ni secreto de sesión, ni el token del teléfono.
  const secretos = { codigoOrganizador: codigoOrganizador.replaceAll('-', '').slice(5), codigoPartido: codigoPartido.replaceAll('-', '').slice(5), sesion: cookie.split('.')[1], token }
  for (const [nombre, s] of Object.entries(secretos)) assert.deepEqual(enDisco(s), [], `${nombre} aparece en disco`)
  assert.ok(enDisco(sha256(token)).length > 0, 'el hash del token sí debe estar guardado')

  // --- Reinicio real ---
  await levantar()
  const despues = await leer()
  assert.equal(despues.estado, 'vivo')
  assert.equal(despues.rev, 1)
  assert.equal((await (await comando(inicio)).json()).resultado, 'recibo-existente') // mismo recibo tras el reinicio
  const yo = await fetch(`${BASE}/v1/organizador/yo`, { headers: { cookie: `__Host-sesion=${cookie}` } })
  assert.equal(yo.status, 200, 'la sesión del organizador sobrevive al reinicio')
  // la plantilla sobrevive: el recibo del alta se repite igual, la ficha está y el equipo en curso sigue bloqueado
  const a2 = await (await post(rutaE3, altaE3, organizador(cookie))).json()
  assert.equal(a2.reproducido, true)
  assert.equal(a2.ficha.id, fichaNueva)
  const e3 = await (await fetch(`${BASE}${rutaE3}`, { headers: { cookie: `__Host-sesion=${cookie}` } })).json()
  assert.ok(e3.activos.some((j) => j.id === fichaNueva && j.nombre === 'Humo Sintetico' && j.dorsal === 50))
  const bloq = await (await post(rutaE1, { operacionId: 'humo-op-bloqueo-0000000002', campos: { nombrePila: 'Otro', apellido1: 'Humo', dorsal: 52 } }, organizador(cookie))).json()
  assert.equal(bloq.tipo, 'equipo-bloqueado')
  assert.equal((await post(rutaE3, { ...altaE3, campos: { ...altaE3.campos, dorsal: 53 } }, organizador(cookie))).status, 409) // mismo identificador, otro contenido
  const prep2 = await (await fetch(prepUrl, { headers: { authorization: `Bearer ${token}` } })).json()
  assert.deepEqual(prep2.preparacion, prepCuerpo1.preparacion)
  assert.equal(prep2.ultimoClientSeq, 1)
  // recuperación de la activación original tras el inicio: mismo dispositivo, sin cambios
  const recuperada = await activar()
  assert.equal(recuperada.status, 200)
  assert.equal((await recuperada.json()).deviceId, deviceId)
  // ninguna activación nueva ni sustitución tras el inicio
  const otro = await post(`/v1/ligas/${LIGA}/partidos/P/activar`, { codigo: codigoPartido, tokenHash: sha256(randomBytes(32).toString('hex')) })
  assert.equal(otro.status, 401)
  assert.equal((await post(`/v1/organizador/ligas/${LIGA}/partidos/P/codigo`, {}, organizador(cookie))).status, 409)
  assert.equal((await post(`/v1/organizador/ligas/${LIGA}/partidos/P/control/revocar`, {}, organizador(cookie))).status, 409)
  // el cursor sobrevivió: el número 1 con otro cmdId está ocupado; el 2 es el siguiente
  assert.equal((await comando(sobreDeInicio(LIGA, { cmdId: 'humo-inicio-otro', clientSeq: 1, deviceId }))).status, 409)
  assert.equal((await (await comando(sobreDeInicio(LIGA, { cmdId: 'humo-inicio-2', clientSeq: 2, deviceId }))).json()).resultado, 'rechazado')
  // el código del organizador se puede volver a usar (es reutilizable) y salir cierra la sesión
  assert.equal((await post('/v1/acceso/organizador', { codigo: codigoOrganizador }, { origin: ORIGEN, 'x-sebel-peticion': '1' })).status, 200)
  assert.equal((await post('/v1/organizador/salir', {}, organizador(cookie))).status, 200)
  assert.equal((await fetch(`${BASE}/v1/organizador/yo`, { headers: { cookie: `__Host-sesion=${cookie}` } })).status, 401)
  assert.equal(objetosEnDisco(), 1)
  console.log('tras el reinicio    : sesión, estado, recibo, cursor, bandeja, activación recuperable, ficha y recibo de plantilla conservados; objetos de liga en disco: 1')
  console.log('HUMO LOCAL: OK')
} finally {
  await matar()
}
