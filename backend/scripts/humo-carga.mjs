// Humo local de la carga del operador y del ejecutor de plantillas, de extremo a extremo por HTTP real (Node + workerd local).
// SINTÉTICO: liga, equipos, personas, secretos y paquete son inventados aquí; almacenamiento aislado; sin Cloudflare.
//
// Uso (desde backend/):  node scripts/humo-carga.mjs
// Escribe en backend/.wrangler-state/humo-carga (ignorado por git; se borra al empezar) y el diario en una carpeta temporal del
// sistema (fuera de cualquier repositorio).
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const RAIZ = resolve(import.meta.dirname, '..')
const ESTADO = join(RAIZ, '.wrangler-state', 'humo-carga')
const PUERTO = 8798
const BASE = `http://127.0.0.1:${PUERTO}`
const OPERADOR = 'operador-humo-carga-sintetico-000000001'
const ORIGEN = 'https://humo-carga.local'
const LIGA = 'LIGAHUMOCARGA'

rmSync(ESTADO, { recursive: true, force: true })
mkdirSync(join(ESTADO, 'activos-vacios'), { recursive: true })
writeFileSync(join(ESTADO, 'activos-vacios', 'index.html'), '<!doctype html><title>humo</title>')
const privado = mkdtempSync(join(tmpdir(), 'sebel-humo-carga-'))

const servidor = spawn(join(RAIZ, 'node_modules', '.bin', 'wrangler'), [
  'dev', '--port', String(PUERTO), '--ip', '127.0.0.1', '--persist-to', join(ESTADO, 'persistencia'), '--assets', join(ESTADO, 'activos-vacios'),
  '--var', `LIGAS_ADMITIDAS:${LIGA}`, '--var', `ACCESO_ORIGEN:${ORIGEN}`, '--var', 'ACCESO_ADMIN_HABILITADO:1', '--var', `ACCESO_ADMIN_TOKEN:${OPERADOR}`,
], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' } })
let log = ''
servidor.stdout.on('data', (d) => { log += d })
servidor.stderr.on('data', (d) => { log += d })
async function matar() {
  const fin = new Promise((r) => servidor.once('exit', r))
  try { process.kill(-servidor.pid, 'SIGTERM') } catch { /* ya terminó */ }
  await Promise.race([fin, new Promise((r) => setTimeout(r, 8000))])
  try { process.kill(-servidor.pid, 'SIGKILL') } catch { /* ya terminó */ }
}

try {
  for (let i = 0; ; i += 1) {
    try { if ((await fetch(`${BASE}/v1/ligas/x/partidos/y`)).status === 404) break } catch { /* aún no */ }
    if (i > 120) throw new Error(`workerd no arrancó:\n${log.slice(-2000)}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  const json = { 'content-type': 'application/json' }
  const operador = (ruta, cuerpo, token = OPERADOR) => fetch(`${BASE}${ruta}`, { method: 'POST', headers: { ...json, authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo) })

  // 1. Carga del operador (estructura y partidos). Cerrada sin el token del operador.
  assert.equal((await operador(`/v1/admin/ligas/${LIGA}/estructura`, {}, 'otro-token')).status, 401)
  const estructura = { cargaId: 'carga-humo-estructura-0001', liga: { id: LIGA, nombre: 'Liga Humo Carga', deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }, equipos: [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }] }
  assert.equal((await operador(`/v1/admin/ligas/${LIGA}/estructura`, estructura)).status, 201)
  assert.equal((await operador(`/v1/admin/ligas/${LIGA}/estructura`, estructura)).status, 200) // reintento exacto
  assert.equal((await operador(`/v1/admin/ligas/${LIGA}/partidos`, { cargaId: 'carga-humo-partidos-00002', minutosPorPeriodo: 8, partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T09:00:00-05:00', sede: 'Cancha 1' }] })).status, 201)
  assert.equal((await fetch(`${BASE}/v1/ligas/${LIGA}/publico`)).status, 200)

  // 2. El operador da de alta al organizador (el ejecutor NUNCA lo hace); el código se pasa por entorno, nunca por argumentos.
  const prov = await (await operador('/v1/admin/organizador', { nombre: 'Organizador sintético', ligas: [LIGA] })).json()
  assert.ok(prov.codigo)

  // 3. Paquete y mapeo sintéticos (con la forma del paquete real).
  const fila = (n, nombre, apellido, jersey, extra = {}) => ({ source_ref: `H/EQ#p1r${n}`, league: 'Liga Humo Carga', team: 'Alfa', first_name: nombre, surname: apellido, jersey, status: 'ready', hold_reasons: [], ...extra })
  const paquete = JSON.stringify({ totals: { ready: 3, held: 1 }, teams: [
    { team_key: 'H/ALFA', team_display_name: 'Alfa', counts: { candidates: 4 }, rows: [fila(1, 'Ana', 'Prueba', 7), fila(2, 'Beto', 'Muestra', 0), fila(3, 'Cleo', 'Tres', 12, { shirt_name: 'CLEITO' }), { ...fila(4, 'Dino', 'Cuatro', null), status: 'held', hold_reasons: ['missing-jersey'] }], excluded_rows: [] },
  ] })
  const mapeo = { version: 1, paqueteSha256: createHash('sha256').update(paquete).digest('hex'), ligas: { 'Liga Humo Carga': { ligaId: LIGA, equipos: { 'H/ALFA': 'EQ1' } } },
    identidades: Object.fromEntries([1, 2, 3].map((n) => [`H/EQ#p1r${n}`, { tipo: 'otra-persona' }])) }
  const rutaPaquete = join(privado, 'paquete.json'); const rutaMapeo = join(privado, 'mapeo.json'); const diario = join(privado, 'diario.json')
  writeFileSync(rutaPaquete, paquete); writeFileSync(rutaMapeo, JSON.stringify(mapeo))

  const cli = (args, entorno = {}) => spawnSync(process.execPath, [join(RAIZ, 'scripts', 'runner-plantilla.mjs'), ...args], {
    cwd: privado, encoding: 'utf8', env: { PATH: process.env.PATH, ...entorno },
  })
  const destino = ['--origen', BASE, '--acceso-origen', ORIGEN, '--diario', diario]

  // 4. Simulacro por defecto: sin red (el servidor ni se menciona), sin archivos nuevos.
  const sim = cli(['--paquete', rutaPaquete, '--mapeo', rutaMapeo])
  assert.equal(sim.status, 0, sim.stdout + sim.stderr)
  const resumen = JSON.parse(sim.stdout)
  assert.deepEqual([resumen.modo, resumen.listas, resumen.retenidas, resumen.operaciones, resumen.conAlias], ['simulacro', 3, 1, 3, 1])
  assert.ok(!existsSync(diario))
  assert.ok(!sim.stdout.includes('Ana') && !sim.stdout.includes('CLEITO'))

  // 5. Puertas de la línea de comandos.
  assert.equal(JSON.parse(cli(['--aplicar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, '--origen', 'https://sebel.example', '--acceso-origen', ORIGEN, '--diario', diario], { SEBEL_CODIGO_ORGANIZADOR: prov.codigo }).stdout).estado, 'origen-no-local')
  assert.equal(JSON.parse(cli(['--aplicar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, ...destino]).stdout).estado, 'sin-credencial')
  assert.equal(JSON.parse(cli(['--aplicar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, ...destino, '--codigo', prov.codigo]).stdout).estado, 'credencial-en-argumentos')
  assert.equal(JSON.parse(cli(['--aplicar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, '--origen', BASE, '--acceso-origen', ORIGEN, '--diario', join(RAIZ, 'diario-no.json')], { SEBEL_CODIGO_ORGANIZADOR: prov.codigo }).stdout).estado, 'diario-dentro-de-un-repositorio')
  assert.ok(!existsSync(diario))

  // 6. Aplicar, reaplicar (no-op) y verificar.
  const entorno = { SEBEL_CODIGO_ORGANIZADOR: prov.codigo }
  const ap = cli(['--aplicar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, ...destino], entorno)
  assert.equal(ap.status, 0, ap.stdout + ap.stderr)
  assert.deepEqual(JSON.parse(ap.stdout), { modo: 'aplicar', estado: 'completo', total: 3, aplicadas: 3, reproducidas: 0 })
  assert.equal(statSync(diario).mode & 0o777, 0o600)
  const otra = JSON.parse(cli(['--aplicar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, ...destino], entorno).stdout)
  assert.deepEqual([otra.estado, otra.aplicadas, otra.reproducidas], ['completo', 0, 0])
  const ver = cli(['--verificar', '--paquete', rutaPaquete, '--mapeo', rutaMapeo, ...destino], entorno)
  const v = JSON.parse(ver.stdout)
  assert.equal(v.ok, true, ver.stdout)
  // Ni el código ni la cookie en la salida ni en el diario.
  for (const texto of [sim.stdout, ap.stdout, ver.stdout, readFileSync(diario, 'utf8')]) assert.ok(!texto.includes(prov.codigo) && !texto.includes('__Host-sesion'))

  process.stdout.write(`humo-carga OK: simulacro sin red ni archivos; puertas de la línea de comandos; ${v.comprobaciones.length} comprobaciones de verificación; diario 0600 sin secretos\n`)
} finally {
  await matar()
  rmSync(privado, { recursive: true, force: true })
}
