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

describe('command `equipos` (append teams to an already loaded league)', () => {
  const anexo = (liga = 'LIGA-CLI') => escribir(`anexo-${liga}.json`, JSON.stringify({ cargaId: 'append-cli-0001-aaaaaaaa', equipos: [{ id: `${liga}-NUEVO`, nombre: 'Nuevo' }] }))
  it('dry-run by default: no requests, no journal, and a bad file fails', async () => {
    const r = await correr(OPERADOR, ['equipos', '--equipos', `LIGA-CLI=${anexo()}`])
    assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /simulacro/); assert.doesNotMatch(r.salida, /Nuevo/)
    const mal = escribir('anexo-mal.json', '{nada')
    assert.equal((await correr(OPERADOR, ['equipos', '--equipos', `LIGA-CLI=${mal}`])).codigo, 1)
    assert.match((await correr(OPERADOR, ['equipos', '--equipos', anexo()])).salida, /equipos-requiere-LIGA=archivo/)
  })
  it('apply sends ONE Bearer POST to /equipos with the exact body, journals it 0600, and a redirect is not followed', async () => {
    const s = await servidor(() => ({ status: 201, json: { ok: true, reproducido: false } })); cerrar.push(s.s)
    const diario = join(dir, 'dq.json')
    const r = await correr(OPERADOR, ['equipos', '--equipos', `LIGA-CLI=${anexo()}`, '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida)
    assert.equal(s.peticiones.length, 1); assert.equal(s.peticiones[0].url, '/v1/admin/ligas/LIGA-CLI/equipos')
    assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    assert.deepEqual(JSON.parse(s.peticiones[0].cuerpo), { cargaId: 'append-cli-0001-aaaaaaaa', equipos: [{ id: 'LIGA-CLI-NUEVO', nombre: 'Nuevo' }] })
    assert.equal(statSync(diario).mode & 0o777, 0o600); assert.ok(!readFileSync(diario, 'utf8').includes(TOKEN))
    const fin = await servidor(() => ({ status: 200, json: {} })); cerrar.push(fin.s)
    const redir = await servidor(() => ({ status: 307, json: {}, cabeceras: { location: `${fin.origen}/x` } })); cerrar.push(redir.s)
    const r2 = await correr(OPERADOR, ['equipos', '--equipos', `LIGA-CLI=${anexo()}`, '--aplicar', '--origen', redir.origen, '--diario', join(dir, 'dq2.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(r2.salida, /detenido-sin-resolver/); assert.equal(fin.peticiones.length, 0)
  })
})

describe('commands `retirar` / `restaurar` / `verificar-retiro` (REPORT_208)', () => {
  const retiro = (nombre, cuerpo) => escribir(nombre, JSON.stringify(cuerpo))
  const BUENO = { cargaId: 'retiro-cli-0001-aaaaaaaa', partidos: ['Q', 'P'] }

  it('dry-run by default: no requests, no journal, ids never echoed, bad files and bad bodies fail, retirar and restaurar need --retiros only', async () => {
    const f = retiro('retiro-bueno.json', BUENO)
    for (const c of ['retirar', 'restaurar', 'verificar-retiro', 'verificar-restauracion']) {
      const r = await correr(OPERADOR, [c, '--retiros', `LIGA-CLI=${f}`])
      assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /simulacro/); assert.match(r.salida, /"partidos": 2/)
    }
    for (const cuerpo of [{ ...BUENO, extra: 1 }, { cargaId: 'corto', partidos: ['P'] }, { cargaId: BUENO.cargaId, partidos: [] }, { cargaId: BUENO.cargaId, partidos: ['P', 'P'] }, { cargaId: BUENO.cargaId, partidos: ['P Q'] }, { cargaId: BUENO.cargaId, partidos: Array.from({ length: 51 }, (_, i) => `G${i}`) }]) {
      const r = await correr(OPERADOR, ['retirar', '--retiros', `LIGA-CLI=${retiro('retiro-malo.json', cuerpo)}`])
      assert.equal(r.codigo, 1, JSON.stringify(cuerpo).slice(0, 50))
    }
    assert.equal((await correr(OPERADOR, ['retirar', '--retiros', `LIGA-CLI=${escribir('retiro-ilegible.json', '{nada')}`])).codigo, 1)
    assert.match((await correr(OPERADOR, ['retirar', '--retiros', f])).salida, /retiros-requiere-LIGA=archivo/)
    assert.equal((await correr(OPERADOR, ['retirar', '--partidos', `LIGA-CLI=${f}`])).codigo, 1) // los lotes de partidos no se mezclan con el retiro
    assert.equal((await correr(OPERADOR, ['retirar'])).codigo, 1) // sin archivos
    assert.equal(existsSync(join(dir, 'diario-retiro.json')), false)
  })

  it('apply sends ONE Bearer POST to /partidos/retirar with the NORMALISED body, journals it 0600; restaurar goes to /partidos/restaurar; a retry resends the identical body from the journal', async () => {
    const s = await servidor(() => ({ status: 201, json: { ok: true, reproducido: false } })); cerrar.push(s.s)
    const f = retiro('retiro-aplicar.json', BUENO)
    const diario = join(dir, 'dr.json')
    const r = await correr(OPERADOR, ['retirar', '--retiros', `LIGA-CLI=${f}`, '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida)
    assert.equal(s.peticiones.length, 1); assert.equal(s.peticiones[0].url, '/v1/admin/ligas/LIGA-CLI/partidos/retirar')
    assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    assert.deepEqual(JSON.parse(s.peticiones[0].cuerpo), { cargaId: BUENO.cargaId, partidos: ['P', 'Q'] })
    assert.equal(statSync(diario).mode & 0o777, 0o600); assert.ok(!readFileSync(diario, 'utf8').includes(TOKEN))
    // restaurar: operación aparte, otra ruta y otro diario
    const g = retiro('restaura-aplicar.json', { cargaId: 'restaura-cli-0001-aaaaaaa', partidos: ['P'] })
    const rr = await correr(OPERADOR, ['restaurar', '--retiros', `LIGA-CLI=${g}`, '--aplicar', '--origen', s.origen, '--diario', join(dir, 'dr2.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(rr.codigo, 0, rr.salida); assert.equal(s.peticiones[1].url, '/v1/admin/ligas/LIGA-CLI/partidos/restaurar')
    // respuesta incierta (503) → «detenido-sin-resolver»; repetir reenvía LO IDÉNTICO y completa
    let n = 0
    const u = await servidor(() => { n += 1; return n === 1 ? { status: 503, json: { error: 'resultado-desconocido' } } : { status: 200, json: { ok: true, reproducido: true } } }); cerrar.push(u.s)
    const d3 = join(dir, 'dr3.json')
    const args = ['retirar', '--retiros', `LIGA-CLI=${f}`, '--aplicar', '--origen', u.origen, '--diario', d3]
    const primera = await correr(OPERADOR, args, { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(primera.salida, /detenido-sin-resolver/)
    const segunda = await correr(OPERADOR, args, { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(segunda.codigo, 0, segunda.salida)
    assert.equal(u.peticiones.length, 2); assert.equal(u.peticiones[0].cuerpo, u.peticiones[1].cuerpo)
    // un archivo CAMBIADO tras el intento no se envía con el mismo diario
    const cambiado = retiro('retiro-aplicar.json', { cargaId: BUENO.cargaId, partidos: ['P'] })
    const tercera = await correr(OPERADOR, ['retirar', '--retiros', `LIGA-CLI=${cambiado}`, '--aplicar', '--origen', u.origen, '--diario', d3], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(tercera.salida, /diario-de-otro-plan|payload-distinto-del-diario/); assert.equal(u.peticiones.length, 2)
  })

  it('a rejection (409 retiro-no-seguro) stops and is journalled as rejected; verificar-retiro / verificar-restauracion use only public GETs and compare list and direct read', async () => {
    const rech = await servidor(() => ({ status: 409, json: { error: 'retiro-no-seguro', partidos: [{ id: 'P', motivos: ['con-historial'] }] } })); cerrar.push(rech.s)
    const f = retiro('retiro-rechazo.json', BUENO)
    const r = await correr(OPERADOR, ['retirar', '--retiros', `LIGA-CLI=${f}`, '--aplicar', '--origen', rech.origen, '--diario', join(dir, 'dr4.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 1); assert.match(r.salida, /detenido-por-rechazo/); assert.match(r.salida, /retiro-no-seguro/)
    // verificación: P y Q retirados → fuera de la lista y 404 directo
    const retirados = await servidor((req) => (req.url === '/v1/ligas/LIGA-CLI/publico' ? { status: 200, json: { partidos: [{ gameId: 'OTRO', estado: 'programado', rev: 0 }] } } : { status: 404, json: { error: 'no-encontrado' } })); cerrar.push(retirados.s)
    const ok = await correr(OPERADOR, ['verificar-retiro', '--retiros', `LIGA-CLI=${f}`, '--leer', '--origen', retirados.origen])
    assert.equal(ok.codigo, 0, ok.salida); assert.ok(retirados.peticiones.every((p) => p.metodo === 'GET' && !p.cabeceras.authorization))
    // un partido que SIGUE publicado (lista o lectura directa) falla
    const visible = await servidor((req) => (req.url === '/v1/ligas/LIGA-CLI/publico' ? { status: 200, json: { partidos: [{ gameId: 'P', estado: 'programado', rev: 0 }] } } : { status: 200, json: {} })); cerrar.push(visible.s)
    const mal = await correr(OPERADOR, ['verificar-retiro', '--retiros', `LIGA-CLI=${f}`, '--leer', '--origen', visible.origen])
    assert.equal(mal.codigo, 1); assert.match(mal.salida, /sigue-en-la-lista/)
    // restauración: publicados y programados → ok; ausentes → falla
    const activos = await servidor((req) => (req.url === '/v1/ligas/LIGA-CLI/publico' ? { status: 200, json: { partidos: [{ gameId: 'P', estado: 'programado', rev: 0 }, { gameId: 'Q', estado: 'programado', rev: 0 }] } } : { status: 200, json: {} })); cerrar.push(activos.s)
    assert.equal((await correr(OPERADOR, ['verificar-restauracion', '--retiros', `LIGA-CLI=${f}`, '--leer', '--origen', activos.origen])).codigo, 0)
    assert.equal((await correr(OPERADOR, ['verificar-restauracion', '--retiros', `LIGA-CLI=${f}`, '--leer', '--origen', retirados.origen])).codigo, 1)
    // combinaciones inválidas
    assert.equal((await correr(OPERADOR, ['retirar', '--retiros', `LIGA-CLI=${f}`, '--leer', '--origen', activos.origen])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['verificar-retiro', '--retiros', `LIGA-CLI=${f}`, '--aplicar', '--origen', activos.origen, '--diario', join(dir, 'x.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })).codigo, 1)
  })
})

describe('commands `renombrar` / `verificar-nombre` (REPORT_218)', () => {
  const nombre = (archivo, cuerpo) => escribir(archivo, JSON.stringify(cuerpo))
  const U10 = { cargaId: 'nombre-cli-u10-0001-aaaa', nombre: 'Platinum U10 2026' }

  it('dry-run by default: no requests, no journal; names are shown only as plan data; bad files and bodies fail; only valid with --nombres', async () => {
    const f = nombre('nombre-u10.json', U10)
    const r = await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${f}`])
    assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /simulacro/); assert.match(r.salida, /Platinum U10 2026/)
    assert.equal((await correr(OPERADOR, ['verificar-nombre', '--nombres', `PLATINIUM-U10=${f}`])).codigo, 0)
    for (const cuerpo of [{ ...U10, extra: 1 }, { cargaId: 'corto', nombre: 'Platinum' }, { cargaId: U10.cargaId, nombre: ' Platinum' }, { cargaId: U10.cargaId, nombre: '' }, { cargaId: U10.cargaId, nombre: 'x'.repeat(81) }, { cargaId: U10.cargaId, nombre: 'a\u0000b' }, { cargaId: U10.cargaId }]) {
      assert.equal((await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${nombre('nombre-malo.json', cuerpo)}`])).codigo, 1, JSON.stringify(cuerpo).slice(0, 50))
    }
    assert.equal((await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${escribir('nombre-ilegible.json', '{nada')}`])).codigo, 1)
    assert.match((await correr(OPERADOR, ['renombrar', '--nombres', f])).salida, /nombres-requiere-LIGA=archivo/)
    assert.equal((await correr(OPERADOR, ['renombrar', '--partidos', `PLATINIUM-U10=${f}`])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['retirar', '--nombres', `PLATINIUM-U10=${f}`])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['renombrar'])).codigo, 1)
    const doble = await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${f}`, '--nombres', `PLATINIUM-U10=${nombre('nombre-otro.json', { cargaId: 'nombre-cli-u10-0002-aaaa', nombre: 'Otro' })}`])
    assert.equal(doble.codigo, 1) // un cambio de nombre por liga en cada ejecución
  })

  it('apply sends ONE Bearer POST per league to /nombre with the exact body, journals 0600; an uncertain response is recovered by re-running the SAME command (identical body and cargaId from the journal); a changed file is refused', async () => {
    const s = await servidor(() => ({ status: 201, json: { ok: true, reproducido: false, cambiado: true } })); cerrar.push(s.s)
    const f = nombre('nombre-aplicar.json', U10); const g = nombre('nombre-aplicar12.json', { cargaId: 'nombre-cli-u12-0001-aaaa', nombre: 'Platinum U12 2026' })
    const diario = join(dir, 'dn.json')
    const args = ['renombrar', '--nombres', `PLATINIUM-U10=${f}`, '--nombres', `PLATINIUM-U12=${g}`, '--aplicar', '--origen', s.origen, '--diario', diario]
    const r = await correr(OPERADOR, args, { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida)
    assert.deepEqual(s.peticiones.map((p) => p.url), ['/v1/admin/ligas/PLATINIUM-U10/nombre', '/v1/admin/ligas/PLATINIUM-U12/nombre'])
    assert.deepEqual(JSON.parse(s.peticiones[0].cuerpo), U10)
    assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    assert.equal(statSync(diario).mode & 0o777, 0o600); assert.ok(!readFileSync(diario, 'utf8').includes(TOKEN))
    // incierta → misma orden
    let n = 0
    const u = await servidor(() => { n += 1; return n === 1 ? { status: 503, json: { error: 'resultado-desconocido' } } : { status: 200, json: { ok: true, reproducido: true, cambiado: true } } }); cerrar.push(u.s)
    const d2 = join(dir, 'dn2.json')
    const a2 = ['renombrar', '--nombres', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', u.origen, '--diario', d2]
    assert.match((await correr(OPERADOR, a2, { SEBEL_OPERADOR_TOKEN: TOKEN })).salida, /detenido-sin-resolver/)
    const seg = await correr(OPERADOR, a2, { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(seg.codigo, 0, seg.salida)
    assert.equal(u.peticiones.length, 2); assert.equal(u.peticiones[0].cuerpo, u.peticiones[1].cuerpo)
    // el archivo cambió después del intento: no se envía con ese diario
    const cambiado = nombre('nombre-aplicar.json', { cargaId: U10.cargaId, nombre: 'Platinum U10 2026 (otra)' })
    const ter = await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${cambiado}`, '--aplicar', '--origen', u.origen, '--diario', d2], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(ter.salida, /diario-de-otro-plan|payload-distinto-del-diario/); assert.equal(u.peticiones.length, 2)
    // la reversión: OTRO archivo (otro cargaId) con el nombre anterior = otra operación, otro diario
    const rev = nombre('nombre-revertir.json', { cargaId: 'nombre-cli-u10-rev-0003', nombre: 'Platinium U10 2026' })
    const sr = await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${rev}`, '--aplicar', '--origen', s.origen, '--diario', join(dir, 'dn3.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(sr.codigo, 0, sr.salida); assert.equal(JSON.parse(s.peticiones.at(-1).cuerpo).nombre, 'Platinium U10 2026')
  })

  it('a rejection (409 / 422) stops and is journalled as rejected; verificar-nombre uses only public GETs: name, same id, teams and games present', async () => {
    const rech = await servidor(() => ({ status: 409, json: { error: 'carga-conflicto' } })); cerrar.push(rech.s)
    const f = nombre('nombre-rechazo.json', U10)
    const r = await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', rech.origen, '--diario', join(dir, 'dn4.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 1); assert.match(r.salida, /detenido-por-rechazo/); assert.match(r.salida, /carga-conflicto/)
    const ok = await servidor(() => ({ status: 200, json: { liga: { id: 'PLATINIUM-U10', nombre: 'Platinum U10 2026' }, equipos: [{ id: 'E', nombre: 'E' }], partidos: [] } })); cerrar.push(ok.s)
    const v = await correr(OPERADOR, ['verificar-nombre', '--nombres', `PLATINIUM-U10=${f}`, '--leer', '--origen', ok.origen])
    assert.equal(v.codigo, 0, v.salida); assert.ok(ok.peticiones.every((p) => p.metodo === 'GET' && !p.cabeceras.authorization))
    const viejo = await servidor(() => ({ status: 200, json: { liga: { id: 'PLATINIUM-U10', nombre: 'Platinium U10 2026' }, equipos: [{ id: 'E', nombre: 'E' }], partidos: [] } })); cerrar.push(viejo.s)
    const mal = await correr(OPERADOR, ['verificar-nombre', '--nombres', `PLATINIUM-U10=${f}`, '--leer', '--origen', viejo.origen])
    assert.equal(mal.codigo, 1); assert.match(mal.salida, /"codigo": "nombre:PLATINIUM-U10"/)
    assert.equal((await correr(OPERADOR, ['renombrar', '--nombres', `PLATINIUM-U10=${f}`, '--leer', '--origen', ok.origen])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['verificar-nombre', '--nombres', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', ok.origen, '--diario', join(dir, 'x2.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })).codigo, 1)
  })
})

describe('commands `ramas` / `verificar-ramas` and optional `rama` in loader files (REPORT_220)', () => {
  const archivo = (nombre, cuerpo) => escribir(nombre, JSON.stringify(cuerpo))
  const CUERPO = { cargaId: 'ramas-cli-u10-0001-aaaaaaa', ramas: [{ equipoId: 'PLATINIUM-U10-VIP', rama: 'mixta' }, { equipoId: 'PLATINIUM-U10-DEPORTIVO', rama: 'mixta' }] }

  it('dry-run by default: no requests, no journal; counts by branch; bad bodies (extra keys, capital letters, null, repeated ids, empty) fail; only valid with --ramas', async () => {
    const f = archivo('ramas-u10.json', CUERPO)
    const r = await correr(OPERADOR, ['ramas', '--ramas', `PLATINIUM-U10=${f}`])
    assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /simulacro/); assert.match(r.salida, /"mixta": 2/)
    assert.equal((await correr(OPERADOR, ['verificar-ramas', '--ramas', `PLATINIUM-U10=${f}`])).codigo, 0)
    for (const cuerpo of [{ ...CUERPO, extra: 1 }, { cargaId: 'corto', ramas: CUERPO.ramas }, { cargaId: CUERPO.cargaId, ramas: [{ equipoId: 'A', rama: 'Mixta' }] }, { cargaId: CUERPO.cargaId, ramas: [{ equipoId: 'A', rama: null }] },
      { cargaId: CUERPO.cargaId, ramas: [{ equipoId: 'A', rama: 'mixta' }, { equipoId: 'A', rama: 'mixta' }] }, { cargaId: CUERPO.cargaId, ramas: [] }, { cargaId: CUERPO.cargaId, ramas: [{ equipoId: 'A', rama: 'mixta', x: 1 }] }, { cargaId: CUERPO.cargaId, ramas: [{ equipoId: 'A' }] }]) {
      assert.equal((await correr(OPERADOR, ['ramas', '--ramas', `PLATINIUM-U10=${archivo('ramas-malo.json', cuerpo)}`])).codigo, 1, JSON.stringify(cuerpo).slice(0, 60))
    }
    assert.match((await correr(OPERADOR, ['ramas', '--ramas', f])).salida, /ramas-requiere-LIGA=archivo/)
    assert.equal((await correr(OPERADOR, ['ramas', '--partidos', `PLATINIUM-U10=${f}`])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['renombrar', '--ramas', `PLATINIUM-U10=${f}`])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['ramas'])).codigo, 1)
  })

  it('apply sends ONE Bearer POST per league to /equipos/ramas with the NORMALISED body (teams sorted), journals 0600; an uncertain response is recovered by the SAME command; a 409 conflict stops and is journalled as rejected', async () => {
    const s = await servidor(() => ({ status: 201, json: { ok: true, reproducido: false } })); cerrar.push(s.s)
    const f = archivo('ramas-aplicar.json', CUERPO)
    const diario = join(dir, 'dr-ramas.json')
    const r = await correr(OPERADOR, ['ramas', '--ramas', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida)
    assert.equal(s.peticiones.length, 1); assert.equal(s.peticiones[0].url, '/v1/admin/ligas/PLATINIUM-U10/equipos/ramas')
    assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    assert.deepEqual(JSON.parse(s.peticiones[0].cuerpo), { cargaId: CUERPO.cargaId, ramas: [{ equipoId: 'PLATINIUM-U10-DEPORTIVO', rama: 'mixta' }, { equipoId: 'PLATINIUM-U10-VIP', rama: 'mixta' }] })
    assert.equal(statSync(diario).mode & 0o777, 0o600); assert.ok(!readFileSync(diario, 'utf8').includes(TOKEN))
    let n = 0
    const u = await servidor(() => { n += 1; return n === 1 ? { status: 503, json: { error: 'resultado-desconocido' } } : { status: 200, json: { ok: true, reproducido: true } } }); cerrar.push(u.s)
    const a2 = ['ramas', '--ramas', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', u.origen, '--diario', join(dir, 'dr-ramas2.json')]
    assert.match((await correr(OPERADOR, a2, { SEBEL_OPERADOR_TOKEN: TOKEN })).salida, /detenido-sin-resolver/)
    assert.equal((await correr(OPERADOR, a2, { SEBEL_OPERADOR_TOKEN: TOKEN })).codigo, 0)
    assert.equal(u.peticiones.length, 2); assert.equal(u.peticiones[0].cuerpo, u.peticiones[1].cuerpo)
    const rech = await servidor(() => ({ status: 409, json: { error: 'rama-en-conflicto', equipos: [{ equipoId: 'X', actual: 'mixta' }] } })); cerrar.push(rech.s)
    const rr = await correr(OPERADOR, ['ramas', '--ramas', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', rech.origen, '--diario', join(dir, 'dr-ramas3.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(rr.codigo, 1); assert.match(rr.salida, /detenido-por-rechazo/); assert.match(rr.salida, /rama-en-conflicto/)
  })

  it('verificar-ramas uses only public GETs: every listed team publishes exactly the branch; a missing or different branch fails; an unlisted team is not asserted', async () => {
    const f = archivo('ramas-verificar.json', CUERPO)
    const ok = await servidor(() => ({ status: 200, json: { equipos: [{ id: 'PLATINIUM-U10-VIP', nombre: 'VIP', rama: 'mixta' }, { id: 'PLATINIUM-U10-DEPORTIVO', nombre: 'D', rama: 'mixta' }, { id: 'OTRO', nombre: 'Otro', rama: null }] } })); cerrar.push(ok.s)
    const v = await correr(OPERADOR, ['verificar-ramas', '--ramas', `PLATINIUM-U10=${f}`, '--leer', '--origen', ok.origen])
    assert.equal(v.codigo, 0, v.salida); assert.ok(ok.peticiones.every((p) => p.metodo === 'GET' && !p.cabeceras.authorization))
    const mal = await servidor(() => ({ status: 200, json: { equipos: [{ id: 'PLATINIUM-U10-VIP', nombre: 'VIP', rama: null }, { id: 'PLATINIUM-U10-DEPORTIVO', nombre: 'D', rama: 'masculino' }] } })); cerrar.push(mal.s)
    const m = await correr(OPERADOR, ['verificar-ramas', '--ramas', `PLATINIUM-U10=${f}`, '--leer', '--origen', mal.origen])
    assert.equal(m.codigo, 1); assert.match(m.salida, /PLATINIUM-U10-VIP:null≠mixta/)
    assert.equal((await correr(OPERADOR, ['ramas', '--ramas', `PLATINIUM-U10=${f}`, '--leer', '--origen', ok.origen])).codigo, 1)
  })

  it('structure and team-append files may carry an optional per-team rama in the offline plan; a bad value fails the dry-run', async () => {
    const est = (rama) => escribir('estructura-rama.json', JSON.stringify({ cargaId: 'estructura-cli-rama-0001', liga: { id: 'LIGA-CLI', nombre: 'Liga CLI', deporte: 'baloncesto' }, equipos: [{ id: 'LIGA-CLI-A', nombre: 'Uno', ...(rama === undefined ? {} : { rama }) }, { id: 'LIGA-CLI-B', nombre: 'Dos' }] }))
    assert.equal((await correr(OPERADOR, ['estructura', '--estructura', est('mixta')])).codigo, 0)
    assert.equal((await correr(OPERADOR, ['estructura', '--estructura', est(undefined)])).codigo, 0) // sin rama: como siempre
    assert.equal((await correr(OPERADOR, ['estructura', '--estructura', est('Mixta')])).codigo, 1)
    assert.equal((await correr(OPERADOR, ['estructura', '--estructura', est(null)])).codigo, 1)
    const an = (rama) => escribir('anexo-rama.json', JSON.stringify({ cargaId: 'anexo-cli-rama-00000001', equipos: [{ id: 'LIGA-CLI-C', nombre: 'Tres', rama }] }))
    assert.equal((await correr(OPERADOR, ['equipos', '--equipos', `LIGA-CLI=${an('femenino')}`])).codigo, 0)
    assert.equal((await correr(OPERADOR, ['equipos', '--equipos', `LIGA-CLI=${an('otra')}`])).codigo, 1)
  })
})
