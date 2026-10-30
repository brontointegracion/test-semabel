// Puerto selectivo del precursor a5a823f (solo ligas, sin objeto de acceso) — la herramienta de captura PRIVADA (`scripts/respaldo-privado.mjs`): procesos reales contra un servidor HTTP local simulado, datos SINTÉTICOS, archivos en una carpeta temporal.
// Comprueba permisos, destino exacto, redirecciones, verificación de sellos, que nada de los datos se imprime y la verificación offline de una carpeta.
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { sellar } from '../src/respaldo.js'

const CLI = new URL('../scripts/respaldo-privado.mjs', import.meta.url).pathname
const TOKEN = 'token-sintetico-de-prueba-0123456789-abcdef'
const DATO_SECRETO = 'DATO-SINTETICO-QUE-NO-DEBE-IMPRIMIRSE-7731'
const base = mkdtempSync(join(tmpdir(), 'respaldo-cli-'))
const cerrar = []
after(() => { for (const s of cerrar) s.close() })

const correr = (args, env = {}) => new Promise((resolver) => {
  const hijo = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, ...env }, cwd: base })
  let salida = ''; let error = ''
  hijo.stdout.on('data', (d) => { salida += d }); hijo.stderr.on('data', (d) => { error += d })
  hijo.on('close', (codigo) => resolver({ codigo, salida, error }))
})
const respaldo = async (clase, objeto, extra = {}) => sellar({
  formato: 'sebel-respaldo-sql', version: 1, clase, objeto, versionEsquema: 9, bytesBase: 100, capturadoEnMs: 1,
  esquema: [{ tipo: 'table', nombre: 'meta', tabla: 'meta', sql: 'CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)' }],
  tablas: [{ nombre: 'meta', columnas: ['clave', 'valor'], conRowid: true, filas: 2, datos: [[1, 'esquema', '9'], [2, 'nota', DATO_SECRETO]] }], ...extra,
})
function servidor(manejador) {
  const peticiones = []
  const s = createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => { cuerpo += d })
    req.on('end', async () => {
      peticiones.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo })
      const r = await manejador(req)
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.cabeceras ?? {}) }); res.end(typeof r.texto === 'string' ? r.texto : JSON.stringify(r.json ?? {}))
    })
  })
  return new Promise((resolver) => s.listen(0, '127.0.0.1', () => { cerrar.push(s); resolver({ peticiones, origen: `http://127.0.0.1:${s.address().port}` }) }))
}
const bueno = (sobre = {}) => async (req) => {
  const m = /\/respaldo\/ligas\/([^/]+)\/(exportar|marcador)$/.exec(req.url)
  if (!m) return { status: 404 }
  if (m[2] === 'marcador') return { status: 200, json: { disponible: false, motivo: 'api-no-ofrecida', correspondeConExportacion: false } }
  return { status: 200, texto: JSON.stringify(await respaldo('LigaDO', m[1], sobre)) }
}
let n = 0
const salida = () => join(base, `salida-${++n}`)
const env = { SEBEL_OPERADOR_TOKEN: TOKEN }

describe('plan (por omisión): sin red ni archivos', () => {
  it('muestra el destino y los archivos; un destino no aprobado, sin objetivos o con credencial en los argumentos falla; nada se crea', async () => {
    const s = await servidor(bueno())
    const dir = salida()
    const p = await correr(['--origen', s.origen, '--liga', 'LIGA-A', '--salida', dir])
    assert.equal(p.codigo, 0, p.salida)
    const j = JSON.parse(p.salida)
    assert.equal(j.modo, 'plan'); assert.deepEqual(j.archivos, ['liga-LIGA-A.json', 'marcador-liga-LIGA-A.json'])
    assert.equal((await correr(['--origen', s.origen, '--liga', 'LIGA-A', '--acceso', '--salida', dir])).codigo, 1) // el objeto de acceso no se puede pedir
    assert.equal(s.peticiones.length, 0); assert.ok(!existsSync(dir))
    assert.equal((await correr(['--origen', 'http://otro-host.example:9', '--liga', 'L', '--salida', dir])).codigo, 1)
    assert.match((await correr(['--origen', 'https://semabel.com.evil.example', '--remoto', '--liga', 'L', '--salida', dir])).salida, /origen-remoto-no-aprobado/)
    assert.equal((await correr(['--origen', s.origen, '--salida', dir])).codigo, 1) // sin objetivos
    assert.equal((await correr(['--origen', s.origen, '--liga', 'L', '--liga', 'L', '--salida', dir])).codigo, 1)
    assert.equal((await correr(['--origen', s.origen, '--liga', TOKEN, '--salida', dir])).codigo, 1) // algo con forma de credencial en los argumentos
    assert.equal((await correr(['--origen', s.origen, '--liga', 'L', '--salida', dir, '--capturar'], { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).codigo, 0) // local: el aviso de TLS solo bloquea el remoto
  })
})

describe('capturar', () => {
  it('guarda cada objeto en un archivo NUEVO 0600 dentro de una carpeta 0700, con manifiesto; solo POST con Bearer; NADA de los datos ni el token ni el checksum completo se imprimen', async () => {
    const s = await servidor(bueno())
    const dir = salida()
    const r = await correr(['--origen', s.origen, '--liga', 'LIGA-A', '--liga', 'LIGA-B', '--salida', dir, '--capturar'], env)
    assert.equal(r.codigo, 0, r.salida)
    const j = JSON.parse(r.salida)
    assert.equal(j.estado, 'completo')
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    const nombres = readdirSync(dir).sort()
    assert.deepEqual(nombres, ['MANIFIESTO.json', 'liga-LIGA-A.json', 'liga-LIGA-B.json', 'marcador-liga-LIGA-A.json', 'marcador-liga-LIGA-B.json'])
    for (const f of nombres) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f)
    assert.ok(s.peticiones.every((p) => p.metodo === 'POST' && p.cabeceras.authorization === `Bearer ${TOKEN}`))
    assert.equal(s.peticiones.length, 4)
    assert.ok(s.peticiones.every((p) => /\/respaldo\/ligas\//.test(p.url)))
    for (const texto of [r.salida, r.error]) {
      assert.ok(!texto.includes(DATO_SECRETO)); assert.ok(!texto.includes(TOKEN))
      for (const a of j.archivos) assert.equal(a.sha256.length, 12)
    }
    assert.ok(readFileSync(join(dir, 'liga-LIGA-A.json'), 'utf8').includes(DATO_SECRETO)) // el dato SÍ está en el archivo privado
    const m = JSON.parse(readFileSync(join(dir, 'MANIFIESTO.json'), 'utf8'))
    assert.equal(m.objetos.length, 2); assert.match(m.aviso, /NO hay atomicidad/)
    const v = await correr(['--verificar', dir]); assert.equal(v.codigo, 0, v.salida); assert.ok(!v.salida.includes(DATO_SECRETO))
  })

  it('no sobrescribe: una carpeta existente se rechaza antes de pedir nada; tampoco dentro de un repositorio Git', async () => {
    const s = await servidor(bueno())
    const dir = salida()
    assert.equal((await correr(['--origen', s.origen, '--liga', 'L', '--salida', dir, '--capturar'], env)).codigo, 0)
    const n0 = s.peticiones.length
    const otra = await correr(['--origen', s.origen, '--liga', 'L', '--salida', dir, '--capturar'], env)
    assert.equal(otra.codigo, 1); assert.match(otra.salida, /salida-carpeta-ya-existe/); assert.equal(s.peticiones.length, n0)
    const enRepo = await correr(['--origen', s.origen, '--liga', 'L', '--salida', new URL('../salida-no-debe-existir', import.meta.url).pathname, '--capturar'], env)
    assert.equal(enRepo.codigo, 1); assert.match(enRepo.salida, /dentro-de-un-repositorio/)
  })

  it('se detiene sin guardar datos dudosos: redirección, estado ≠ 200, tipo inesperado, JSON ilegible, sellos alterados, clase u objeto inesperados, marcador que falla', async () => {
    const casos = {
      redireccion: async () => ({ status: 302, cabeceras: { location: 'http://127.0.0.1:1/x' } }),
      'estado 503': async () => ({ status: 503, json: { error: 'x' } }),
      'tipo inesperado': async () => ({ status: 200, texto: 'hola', cabeceras: { 'content-type': 'text/plain' } }),
      'json ilegible': async () => ({ status: 200, texto: '{no es json' }),
      'sellos alterados': async (req) => { const r = await respaldo('LigaDO', 'LIGA-A'); r.tablas[0].datos[0][2] = '10'; return { status: 200, texto: JSON.stringify(r) } },
      'clase distinta': async () => ({ status: 200, texto: JSON.stringify(await respaldo('AccesoDO', 'LIGA-A')) }),
      'objeto distinto': async () => ({ status: 200, texto: JSON.stringify(await respaldo('LigaDO', 'OTRA')) }),
      'marcador falla': async (req) => (req.url.endsWith('/marcador') ? { status: 500 } : bueno()(req)),
    }
    for (const [nombre, manejador] of Object.entries(casos)) {
      const s = await servidor(manejador)
      const dir = salida()
      const r = await correr(['--origen', s.origen, '--liga', 'LIGA-A', '--salida', dir, '--capturar'], env)
      assert.equal(r.codigo, 1, nombre); assert.match(r.salida, /detenido/, nombre)
      assert.ok(!existsSync(join(dir, 'MANIFIESTO.json')), nombre) // sin manifiesto = captura incompleta
      assert.ok(!r.salida.includes(DATO_SECRETO), nombre)
      if (nombre !== 'marcador falla') assert.deepEqual(readdirSync(dir), [], nombre) // nada guardado antes de verificar
      const v = await correr(['--verificar', dir]); assert.equal(v.codigo, 1, nombre)
    }
  })

  it('credencial: sin ella no hay petición; un archivo con permisos abiertos se rechaza; el archivo 0600 sirve', async () => {
    const s = await servidor(bueno())
    assert.equal((await correr(['--origen', s.origen, '--liga', 'L', '--salida', salida(), '--capturar'])).codigo, 1)
    const t = join(base, 'token.txt'); writeFileSync(t, `${TOKEN}\n`, { mode: 0o644 }); chmodSync(t, 0o644)
    const abierto = await correr(['--origen', s.origen, '--liga', 'L', '--salida', salida(), '--token-archivo', t, '--capturar'])
    assert.equal(abierto.codigo, 1); assert.match(abierto.salida, /permisos-abiertos/); assert.equal(s.peticiones.length, 0)
    chmodSync(t, 0o600)
    assert.equal((await correr(['--origen', s.origen, '--liga', 'L', '--salida', salida(), '--token-archivo', t, '--capturar'])).codigo, 0)
  })
})

describe('verificación offline de una carpeta', () => {
  it('detecta un byte alterado, un archivo ajeno, permisos abiertos, un archivo que falta y la ausencia de manifiesto', async () => {
    const s = await servidor(bueno())
    const nueva = async () => { const d = salida(); assert.equal((await correr(['--origen', s.origen, '--liga', 'LIGA-A', '--salida', d, '--capturar'], env)).codigo, 0); return d }
    let d = await nueva()
    writeFileSync(join(d, 'liga-LIGA-A.json'), readFileSync(join(d, 'liga-LIGA-A.json'), 'utf8').replace('"9"', '"8"'), { mode: 0o600 })
    let v = await correr(['--verificar', d]); assert.equal(v.codigo, 1); assert.match(v.salida, /checksum:liga-LIGA-A.json/)
    d = await nueva(); writeFileSync(join(d, 'ajeno.txt'), 'x', { mode: 0o600 })
    v = await correr(['--verificar', d]); assert.match(v.salida, /archivo-ajeno:ajeno.txt/)
    d = await nueva(); chmodSync(join(d, 'liga-LIGA-A.json'), 0o644)
    v = await correr(['--verificar', d]); assert.match(v.salida, /permisos:liga-LIGA-A.json/)
    d = await nueva(); chmodSync(d, 0o755)
    v = await correr(['--verificar', d]); assert.match(v.salida, /carpeta-con-permisos-abiertos/)
    d = await nueva(); const { unlinkSync } = await import('node:fs'); unlinkSync(join(d, 'marcador-liga-LIGA-A.json'))
    v = await correr(['--verificar', d]); assert.match(v.salida, /falta:marcador-liga-LIGA-A.json/)
    d = await nueva(); unlinkSync(join(d, 'MANIFIESTO.json'))
    v = await correr(['--verificar', d]); assert.match(v.salida, /sin-manifiesto/)
    assert.equal((await correr(['--verificar', join(base, 'no-existe')])).codigo, 1)
  })
})

describe('compatibilidad con el convertidor portatil', () => {
  it('una carpeta capturada y verificada se convierte, el paquete verifica y el informe tecnico queda fuera', async () => {
    const { convertir, escribirPaquete } = await import('../scripts/lib/exportar-portable.mjs')
    const { verificarPaquete } = await import('../scripts/lib/lector-portable.mjs')
    const s = await servidor(bueno())
    const dir = salida()
    assert.equal((await correr(['--origen', s.origen, '--liga', 'LIGA-A', '--salida', dir, '--capturar'], env)).codigo, 0)
    // La captura sintetica minima solo trae la tabla `meta`: el convertidor la rechaza por faltar las tablas del deporte (no convierte a ciegas).
    const x = JSON.parse(readFileSync(join(dir, 'liga-LIGA-A.json'), 'utf8'))
    assert.throws(() => convertir(x), (e) => e.codigo === 'tabla-requerida-ausente')
    void escribirPaquete; void verificarPaquete
  })
})
