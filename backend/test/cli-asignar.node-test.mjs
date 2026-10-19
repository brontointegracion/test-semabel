// LÍNEA DE COMANDOS de `asignar` (REPORT_187), Node sin workerd: `node --test test/cli-asignar.node-test.mjs`.
// Solo loopback (servidor simulado en 127.0.0.1) y carpetas temporales propias. Nunca se contacta ningún servidor real.
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const OPERADOR = new URL('../scripts/operador-carga.mjs', import.meta.url).pathname
const TOKEN = 'token-sintetico-de-prueba-0123456789-abcdef'
const ORG = 'org-0123456789abcdef'
const dir = mkdtempSync(join(tmpdir(), 'cli-asignar-'))
const correr = (args, env = {}) => new Promise((resolver) => {
  const hijo = spawn(process.execPath, [OPERADOR, ...args], { env: { PATH: process.env.PATH, ...env }, cwd: dir })
  let salida = ''; let error = ''
  hijo.stdout.on('data', (d) => { salida += d }); hijo.stderr.on('data', (d) => { error += d })
  hijo.on('close', (codigo) => resolver({ codigo, salida, error }))
})
function servidor(manejador) {
  const peticiones = []
  const s = createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => { cuerpo += d })
    req.on('end', () => { peticiones.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo }); const r = manejador(req, cuerpo, peticiones.length); res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.json ?? {})) })
  })
  return new Promise((resolver) => s.listen(0, '127.0.0.1', () => resolver({ s, peticiones, origen: `http://127.0.0.1:${s.address().port}` })))
}
const cerrar = []
after(() => { for (const s of cerrar) s.close() })
const OK = (reproducido) => ({ status: reproducido ? 200 : 201, json: { ok: true, organizadorId: ORG, agregadas: reproducido ? ['SIMULACRO-PILOTO'] : ['SIMULACRO-PILOTO'], yaExistian: [], ligas: ['PLATINIUM-U10', 'PLATINIUM-U12', 'SIMULACRO-PILOTO'], reproducido } })
const comun = (origen, diario) => ['asignar', '--organizador', ORG, '--ligas', 'SIMULACRO-PILOTO', '--aplicar', '--origen', origen, '--diario', diario]

describe('simulacro por defecto: sin red ni escrituras', () => {
  it('muestra el plan (organizador, ligas, identificador estable) sin peticiones ni archivos', async () => {
    const antes = readdirSync(dir).length
    const r = await correr(['asignar', '--organizador', ORG, '--ligas', 'SIMULACRO-PILOTO'])
    assert.equal(r.codigo, 0, r.salida)
    const j = JSON.parse(r.salida)
    assert.equal(j.modo, 'simulacro'); assert.equal(j.elementos[0].organizadorId, ORG); assert.deepEqual(j.elementos[0].ligas, ['SIMULACRO-PILOTO'])
    assert.match(j.elementos[0].operacionId, /^asig-[0-9a-f]{40}$/)
    assert.match(j.nota, /ninguna petición, ninguna escritura/)
    assert.equal(readdirSync(dir).length, antes)
    const otra = JSON.parse((await correr(['asignar', '--ligas', 'SIMULACRO-PILOTO', '--organizador', ORG])).salida)
    assert.equal(otra.elementos[0].operacionId, j.elementos[0].operacionId) // estable
  })
  it('sin organizador explícito, con un id que no es de organizador, sin ligas o con ligas repetidas: falla en el simulacro y aplicar se niega antes de la red', async () => {
    for (const args of [['asignar', '--ligas', 'SIMULACRO-PILOTO'], ['asignar', '--organizador', 'otro-123', '--ligas', 'X'], ['asignar', '--organizador', ORG], ['asignar', '--organizador', ORG, '--ligas', 'A,A']]) {
      const r = await correr(args); assert.equal(r.codigo, 1, args.join(' ')); assert.equal(JSON.parse(r.salida).ok, false)
    }
    const s = await servidor(() => OK(false)); cerrar.push(s.s)
    const r = await correr(['asignar', '--ligas', 'SIMULACRO-PILOTO', '--aplicar', '--origen', s.origen, '--diario', join(dir, 'd0.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 1); assert.match(r.salida, /plan-invalido/); assert.equal(s.peticiones.length, 0); assert.equal(existsSync(join(dir, 'd0.json')), false)
  })
})

describe('protecciones heredadas', () => {
  it('destino remoto distinto del aprobado, TLS desactivado, credencial por argumentos y archivo de token abierto se niegan antes de cualquier red', async () => {
    const d = join(dir, 'p1.json')
    let r = await correr(['asignar', '--organizador', ORG, '--ligas', 'SIMULACRO-PILOTO', '--aplicar', '--origen', 'https://semabel.com', '--diario', d], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /origen-no-local/)
    r = await correr(['asignar', '--organizador', ORG, '--ligas', 'SIMULACRO-PILOTO', '--aplicar', '--remoto', '--origen', 'https://evil.test', '--diario', d], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r.salida, /origen-remoto-no-aprobado/)
    r = await correr(['asignar', '--organizador', ORG, '--ligas', 'SIMULACRO-PILOTO', '--aplicar', '--remoto', '--origen', 'https://semabel.com', '--diario', d], { SEBEL_OPERADOR_TOKEN: TOKEN, NODE_TLS_REJECT_UNAUTHORIZED: '0' })
    assert.match(r.salida, /tls-verificacion-desactivada/)
    r = await correr(['asignar', '--organizador', ORG, '--ligas', 'SIMULACRO-PILOTO', '--token', TOKEN]); assert.match(r.salida, /credencial-en-argumentos/)
    const abierto = join(dir, 'token-abierto'); writeFileSync(abierto, TOKEN, { mode: 0o644 }); chmodSync(abierto, 0o644)
    const s = await servidor(() => OK(false)); cerrar.push(s.s)
    r = await correr([...comun(s.origen, join(dir, 'p2.json')), '--token-archivo', abierto]); assert.match(r.salida, /permisos-abiertos/)
    r = await correr(comun(s.origen, join(dir, 'p3.json'))); assert.match(r.salida, /sin-credencial/)
    assert.equal(s.peticiones.length, 0); assert.equal(existsSync(d), false)
  })
})

describe('aplicar con diario privado, recuperación y lectura de vuelta', () => {
  it('éxito: Bearer del operador, cuerpo exacto, diario 0600 sin secretos; repetir con el mismo diario no envía nada', async () => {
    const s = await servidor(() => OK(false)); cerrar.push(s.s); const diario = join(dir, 'ok.json')
    const r = await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida); assert.deepEqual(JSON.parse(r.salida), { modo: 'aplicar', estado: 'completo', total: 1, aplicadas: 1, reproducidas: 0 })
    assert.equal(s.peticiones.length, 1); assert.equal(s.peticiones[0].url, '/v1/admin/organizador/ligas'); assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    const cuerpo = JSON.parse(s.peticiones[0].cuerpo); assert.deepEqual(Object.keys(cuerpo).sort(), ['ligas', 'operacionId', 'organizadorId']); assert.equal(cuerpo.organizadorId, ORG)
    assert.equal(statSync(diario).mode & 0o777, 0o600)
    const d = JSON.parse(readFileSync(diario, 'utf8')); assert.equal(d.ops[0].estado, 'aplicada'); assert.deepEqual(d.ops[0].resultado.ligas, ['PLATINIUM-U10', 'PLATINIUM-U12', 'SIMULACRO-PILOTO']) // lectura de vuelta del resultado
    for (const t of [r.salida, readFileSync(diario, 'utf8')]) assert.ok(!t.includes(TOKEN))
    const otra = await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN }); assert.equal(JSON.parse(otra.salida).aplicadas, 0); assert.equal(s.peticiones.length, 1)
  })
  it('respuesta incierta (503) → sale con error y diario «incierta»; reejecutar reenvía el MISMO cuerpo y operacionId, y al responder reproducido termina completo', async () => {
    const s = await servidor((_q, _c, n) => (n === 1 ? { status: 503, json: { tipo: 'resultado-desconocido' } } : OK(true))); cerrar.push(s.s); const diario = join(dir, 'inc.json')
    let r = await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 1); assert.equal(JSON.parse(r.salida).estado, 'detenido-sin-resolver')
    assert.equal(JSON.parse(readFileSync(diario, 'utf8')).ops[0].estado, 'incierta')
    r = await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida); assert.deepEqual(JSON.parse(r.salida), { modo: 'aplicar', estado: 'completo', total: 1, aplicadas: 0, reproducidas: 1 })
    assert.equal(s.peticiones.length, 2); assert.equal(s.peticiones[1].cuerpo, s.peticiones[0].cuerpo)
  })
  it('conflicto del servidor (409) → «detenido-por-rechazo» con el motivo; reejecutar con ese diario no envía nada hasta resolverlo a mano', async () => {
    const s = await servidor(() => ({ status: 409, json: { error: 'liga-con-otro-propietario', ligas: ['SIMULACRO-PILOTO'] } })); cerrar.push(s.s); const diario = join(dir, 'rech.json')
    let r = await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN })
    const j = JSON.parse(r.salida); assert.equal(r.codigo, 1); assert.equal(j.estado, 'detenido-por-rechazo'); assert.equal(j.motivo, 'liga-con-otro-propietario'); assert.deepEqual(j.ligas, ['SIMULACRO-PILOTO'])
    r = await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN }); assert.equal(JSON.parse(r.salida).estado, 'diario-con-rechazo'); assert.equal(s.peticiones.length, 1)
  })
  it('un diario de otro plan (otras ligas) se rechaza sin enviar', async () => {
    const s = await servidor(() => ({ status: 503, json: {} })); cerrar.push(s.s); const diario = join(dir, 'otro.json')
    await correr(comun(s.origen, diario), { SEBEL_OPERADOR_TOKEN: TOKEN })
    const r = await correr(['asignar', '--organizador', ORG, '--ligas', 'OTRA-LIGA', '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(JSON.parse(r.salida).estado, 'diario-de-otro-plan'); assert.equal(s.peticiones.length, 1)
  })
})
