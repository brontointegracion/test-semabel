// Pruebas de la LÍNEA DE COMANDOS de las herramientas de carga (Node, sin workerd): `node --test test/cli-carga.node-test.mjs`.
// Solo loopback (servidor simulado en 127.0.0.1) y carpetas temporales propias. Nunca se contacta ningún servidor real.
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { after, describe, it } from 'node:test'

const OPERADOR = new URL('../scripts/operador-carga.mjs', import.meta.url).pathname
const RUNNER = new URL('../scripts/runner-plantilla.mjs', import.meta.url).pathname
const TOKEN = 'token-sintetico-de-prueba-0123456789-abcdef'
const dir = mkdtempSync(join(tmpdir(), 'carga-cli-'))

const correr = (script, args, env = {}) => new Promise((resolver) => {
  const hijo = spawn(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env }, cwd: dir })
  let salida = ''; let error = ''
  hijo.stdout.on('data', (d) => { salida += d }); hijo.stderr.on('data', (d) => { error += d })
  hijo.on('close', (codigo) => resolver({ codigo, salida, error }))
})
const escribir = (nombre, contenido, modo = 0o600) => { const r = join(dir, nombre); writeFileSync(r, contenido, { mode: modo }); chmodSync(r, modo); return r }
const estructura = (liga = 'LIGA-CLI') => escribir(`${liga}.json`, JSON.stringify({ cargaId: 'carga-cli-0001-aaaaaaaa', liga: { id: liga, nombre: 'Liga CLI', deporte: 'baloncesto' }, equipos: [{ id: 'A', nombre: 'Uno' }, { id: 'B', nombre: 'Dos' }] }))

/** Servidor local simulado: registra peticiones; `manejador(req, cuerpo)` decide la respuesta. */
function servidor(manejador) {
  const peticiones = []
  const s = createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => { cuerpo += d })
    req.on('end', () => {
      peticiones.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo })
      const r = manejador(req, cuerpo)
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.cabeceras ?? {}) }); res.end(JSON.stringify(r.json ?? {}))
    })
  })
  return new Promise((resolver) => s.listen(0, '127.0.0.1', () => resolver({ s, peticiones, origen: `http://127.0.0.1:${s.address().port}` })))
}
const cerrar = []
after(() => { for (const s of cerrar) s.close() })

describe('simulacro por defecto: sin red ni escrituras', () => {
  it('estructura/partidos/provisionar/recuperar/verificar sin --aplicar ni --leer no hacen peticiones ni crean archivos', async () => {
    const e = estructura()
    for (const args of [['estructura', '--estructura', e], ['provisionar', '--nombre', 'Org', '--ligas', 'LIGA-CLI'], ['recuperar'], ['verificar', '--estructura', e]]) {
      const r = await correr(OPERADOR, args)
      assert.equal(r.codigo, 0, r.salida)
      assert.match(r.salida, /simulacro/)
      assert.doesNotMatch(r.salida, /Uno|Dos|Liga CLI/) // sin nombres
    }
    assert.equal(existsSync(join(dir, 'diario.json')), false)
  })
  it('un archivo inválido falla en el simulacro', async () => {
    const mal = escribir('mal.json', '{nada')
    assert.equal((await correr(OPERADOR, ['estructura', '--estructura', mal])).codigo, 1)
  })
})

describe('destino y entorno', () => {
  it('aplicar sin --remoto contra semabel.com, u otro host con --remoto, o con TLS desactivado: se niega antes de cualquier red', async () => {
    const e = estructura(); const diario = join(dir, 'd1.json')
    const comun = ['estructura', '--estructura', e, '--aplicar', '--diario', diario]
    let r = await correr(OPERADOR, [...comun, '--origen', 'https://semabel.com'], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /origen-no-local/)
    r = await correr(OPERADOR, [...comun, '--remoto', '--origen', 'https://evil.test'], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /origen-remoto-no-aprobado/)
    r = await correr(OPERADOR, [...comun, '--remoto', '--origen', 'https://semabel.com:8443'], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /origen-remoto-no-aprobado/)
    r = await correr(OPERADOR, [...comun, '--remoto', '--origen', 'https://semabel.com'], { SEBEL_OPERADOR_TOKEN: TOKEN, NODE_TLS_REJECT_UNAUTHORIZED: '0' })
    assert.match(r.salida, /tls-verificacion-desactivada/)
    r = await correr(OPERADOR, [...comun, '--remoto', '--origen', 'https://semabel.com'], { SEBEL_OPERADOR_TOKEN: TOKEN, NODE_EXTRA_CA_CERTS: join(dir, 'x.pem') })
    assert.match(r.salida, /ca-adicional-no-permitida/)
    assert.equal(existsSync(diario), false)
  })
  it('el ejecutor de plantillas conserva su rechazo de destinos no locales y acepta --remoto solo con el origen exacto', async () => {
    const fila = (n) => ({ source_ref: `S/A#p1r${n}`, league: 'L', team: 'Eq', source_file: 's.pdf', source_sha256: 'a'.repeat(64), page: 1, row: n, source_text: `Ana P ${n}`, source_jersey_text: String(n), first_name: 'Ana', surname: `P${n}`, name_split: { estado: 'ok', regla: 'primera-palabra' }, jersey: n, status: 'ready', hold_reasons: [], explicit_user_decisions: [], notes: [] })
    const paquete = JSON.stringify({ package: { name: 's', status: 'preparation-only' }, totals: { candidates: 1, ready: 1, held: 0, jersey_missing: 0 }, teams: [{ team_key: 'S/A', team_display_name: 'A', source_file: {}, direct_verification: [], supplied_history: [], counts: { candidates: 1, ready: 1, held: 0 }, rows: [fila(1)], excluded_rows: [], skipped_source_rows: [] }] })
    const mapeo = JSON.stringify({ version: 1, paqueteSha256: createHash('sha256').update(paquete).digest('hex'), ligas: { L: { ligaId: 'LIGA1', equipos: { 'S/A': 'EQ1' } } }, identidades: { 'S/A#p1r1': { tipo: 'otra-persona' } } })
    const base = ['--aplicar', '--paquete', escribir('p.json', paquete), '--mapeo', escribir('m.json', mapeo)]
    let r = await correr(RUNNER, [...base, '--origen', 'https://semabel.com', '--acceso-origen', 'https://semabel.com', '--diario', join(dir, 'dr.json')])
    assert.match(r.salida, /origen-no-local/)
    r = await correr(RUNNER, [...base, '--remoto', '--origen', 'https://evil.test', '--acceso-origen', 'https://evil.test', '--diario', join(dir, 'dr.json')])
    assert.match(r.salida, /origen-remoto-no-aprobado/)
    r = await correr(RUNNER, [...base, '--remoto', '--origen', 'https://semabel.com', '--acceso-origen', 'https://semabel.com', '--diario', join(dir, 'dr.json')], { NODE_TLS_REJECT_UNAUTHORIZED: '0' })
    assert.match(r.salida, /tls-verificacion-desactivada/)
    assert.equal(existsSync(join(dir, 'dr.json')), false)
  })
})

describe('credenciales', () => {
  it('un valor con forma de token o de código en la línea de comandos se rechaza; --token no existe', async () => {
    const e = estructura()
    let r = await correr(OPERADOR, ['estructura', '--estructura', e, '--aplicar', '--origen', 'http://127.0.0.1:1', '--diario', join(dir, 'x.json'), '--token', TOKEN])
    assert.match(r.salida, /credencial-en-argumentos/)
    r = await correr(OPERADOR, ['estructura', '--estructura', e, '--nombre', 'ABCDE-FGHIJ-KLMNO-PQRST'])
    assert.match(r.salida, /credencial-en-argumentos/)
  })
  it('el archivo de token con permisos abiertos se rechaza; sin credencial no se envía nada', async () => {
    const e = estructura(); const abierto = escribir('token-abierto', TOKEN, 0o644)
    const s = await servidor(() => ({ status: 201, json: { reproducido: false } })); cerrar.push(s.s)
    const base = ['estructura', '--estructura', e, '--aplicar', '--origen', s.origen]
    let r = await correr(OPERADOR, [...base, '--diario', join(dir, 'dt.json'), '--token-archivo', abierto])
    assert.match(r.salida, /permisos-abiertos/)
    r = await correr(OPERADOR, [...base, '--diario', join(dir, 'dt2.json')])
    assert.match(r.salida, /sin-credencial/)
    assert.equal(s.peticiones.length, 0)
  })
})

describe('carga local simulada de extremo a extremo (servidor 127.0.0.1 de prueba)', () => {
  it('provisionar escribe el código en un archivo 0600 NUEVO, nunca en la salida ni en el diario; no pisa un código existente', async () => {
    const CODIGO = 'AAAAA-BBBBB-CCCCC-DDDDD'
    const s = await servidor(() => ({ status: 201, json: { ok: true, organizadorId: 'org-1', codigo: CODIGO, expiraEn: 1 } })); cerrar.push(s.s)
    const diario = join(dir, 'dp.json'); const salida = join(dir, 'codigo-nuevo')
    const args = ['provisionar', '--nombre', 'Org', '--ligas', 'LIGA-CLI', '--aplicar', '--origen', s.origen, '--diario', diario, '--codigo-salida', salida]
    const r = await correr(OPERADOR, args, { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida)
    assert.equal(readFileSync(salida, 'utf8').trim(), CODIGO)
    assert.equal(statSync(salida).mode & 0o777, 0o600)
    for (const t of [r.salida, r.error, readFileSync(diario, 'utf8'), JSON.stringify(s.peticiones.map((p) => p.url))]) { assert.ok(!t.includes(CODIGO)); assert.ok(!t.includes(TOKEN)) }
    assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    // Una segunda provisión con otro diario NO pisa el archivo con contenido.
    const r2 = await correr(OPERADOR, ['provisionar', '--nombre', 'Org', '--ligas', 'LIGA-CLI', '--aplicar', '--origen', s.origen, '--diario', join(dir, 'dp2.json'), '--codigo-salida', salida], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r2.salida, /salida-de-codigo-no-disponible/)
    assert.equal(s.peticiones.length, 1)
  })
  it('recuperar exige --confirmo-rotacion', async () => {
    const s = await servidor(() => ({ status: 200, json: { ok: true, codigo: 'EEEEE-FFFFF-GGGGG-HHHHH', expiraEn: 1 } })); cerrar.push(s.s)
    const r = await correr(OPERADOR, ['recuperar', '--aplicar', '--origen', s.origen, '--diario', join(dir, 'dr1.json'), '--codigo-salida', join(dir, 'codigo-rot')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /rotacion-sin-confirmar/)
    assert.equal(s.peticiones.length, 0)
  })
  it('una redirección del servidor no se sigue: el segundo servidor no recibe NADA (ni el token)', async () => {
    const destinoFinal = await servidor(() => ({ status: 200, json: {} })); cerrar.push(destinoFinal.s)
    const s = await servidor(() => ({ status: 307, json: {}, cabeceras: { location: `${destinoFinal.origen}/captura` } })); cerrar.push(s.s)
    const diario = join(dir, 'dredir.json')
    const r = await correr(OPERADOR, ['estructura', '--estructura', estructura('LIGA-REDIR'), '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 1); assert.match(r.salida, /detenido-sin-resolver/)
    assert.equal(s.peticiones.length, 1); assert.equal(destinoFinal.peticiones.length, 0)
    assert.equal(JSON.parse(readFileSync(diario, 'utf8')).ops[0].estado, 'incierta')
    assert.equal(statSync(diario).mode & 0o777, 0o600)
  })
  it('el diario dentro de un repositorio Git se rechaza', async () => {
    const repo = join(dir, 'repo'); writeFileSync(join(dir, 'ok'), '')
    const { mkdirSync } = await import('node:fs'); mkdirSync(join(repo, '.git'), { recursive: true })
    const r = await correr(OPERADOR, ['estructura', '--estructura', estructura(), '--aplicar', '--origen', 'http://127.0.0.1:1', '--diario', join(repo, 'd.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /dentro-de-un-repositorio/)
  })
})
