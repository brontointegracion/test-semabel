// La línea de comandos de la corrección de ORTOGRAFÍA de la sede (`corregir-ortografia-sede`, `capturar-base-ortografia`, `verificar-ortografia-sede`).
// Procesos reales contra un servidor HTTP local simulado, con datos sintéticos y archivos 0600 en un directorio temporal. Nada toca la red real.
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const OPERADOR = new URL('../scripts/operador-carga.mjs', import.meta.url).pathname
const TOKEN = 'token-sintetico-de-prueba-0123456789-abcdef'
const dir = mkdtempSync(join(tmpdir(), 'ortografia-cli-'))
const cerrar = []
after(() => { for (const s of cerrar) s.close() })

const correr = (args, env = {}) => new Promise((resolver) => {
  const hijo = spawn(process.execPath, [OPERADOR, ...args], { env: { PATH: process.env.PATH, ...env }, cwd: dir })
  let salida = ''; let error = ''
  hijo.stdout.on('data', (d) => { salida += d }); hijo.stderr.on('data', (d) => { error += d })
  hijo.on('close', (codigo) => resolver({ codigo, salida, error }))
})
const escribir = (nombre, contenido, modo = 0o600) => { const r = join(dir, nombre); writeFileSync(r, contenido, { mode: modo }); chmodSync(r, modo); return r }
const archivo = (nombre, cuerpo) => escribir(nombre, JSON.stringify(cuerpo))
function servidor(manejador) {
  const peticiones = []
  const s = createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => { cuerpo += d })
    req.on('end', () => {
      peticiones.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo })
      const r = manejador(req, cuerpo)
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.json ?? {}))
    })
  })
  return new Promise((resolver) => s.listen(0, '127.0.0.1', () => { cerrar.push(s); resolver({ s, peticiones, origen: `http://127.0.0.1:${s.address().port}` }) }))
}

const ANTES = 'Centro Educativo Bilingue Ricardo Miro'
const DESPUES = 'Centro Educativo Bilingüe Ricardo Miró'
const U10 = { cargaId: 'orto-cli-u10-0001-aaaaaaaa', sedeAnterior: ANTES, sede: DESPUES, partidos: ['G-B', 'G-A'] }
const lado = (id, puntos, faltas) => ({ id, puntos, faltas })
const reloj = { estado: null, restanteMs: null, desdeMs: null }
const juego = (gameId, estado, sede, sobre = {}) => ({ gameId, rev: estado === 'final' ? 9 : 0, estado, programadoPara: '2026-10-25T19:00:00.000Z', inicioReal: estado === 'final' ? '2026-10-25T19:03:00.000Z' : null, sede, periodo: estado === 'final' ? 4 : 1, reloj, local: lado('X', estado === 'final' ? 20 : 0, estado === 'final' ? 5 : 0), visita: lado('Y', estado === 'final' ? 14 : 0, estado === 'final' ? 4 : 0), ...sobre })
const lista = (sedeA, sedeB, extra = []) => ({ liga: { id: 'PLATINIUM-U10', nombre: 'Platinum U10 2026' }, equipos: [], partidos: [juego('G-A', 'programado', sedeA), juego('G-B', 'final', sedeB, { visita: lado('Y', 21, 4) }), juego('G-C', 'programado', 'Otra'), ...extra] })

describe('`corregir-ortografia-sede`', () => {
  it('simulacro por omisión: sin peticiones ni diario; muestra los caracteres que cambian; cuerpos que NO son ortografía o están mal formados fallan', async () => {
    const f = archivo('orto-u10.json', U10)
    const r = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`])
    assert.equal(r.codigo, 0, r.salida)
    const j = JSON.parse(r.salida)
    assert.equal(j.modo, 'simulacro'); assert.equal(j.ok, true)
    assert.equal(j.elementos[0].partidos, 2)
    assert.match(JSON.stringify(j.elementos[0].cambio), /u→ü/); assert.match(JSON.stringify(j.elementos[0].cambio), /o→ó/)
    const NFD = 'Centro Educativo Bilingüe Ricardo Miró'
    for (const cuerpo of [
      { ...U10, extra: 1 }, { ...U10, cargaId: 'corto' }, { ...U10, sede: ANTES }, { ...U10, sede: ` ${DESPUES}` }, { ...U10, sede: NFD }, { ...U10, partidos: [] }, { ...U10, partidos: ['A', 'A'] },
      { ...U10, sede: 'Centro Educativo Bilingüe Ricardo Mira' }, // otra sede: no es ortografía
      { ...U10, sede: 'Colegio Ricardo Miró' },
      { ...U10, sede: 'Escuela Bilingüe Ricardo Miró' }, // «Centro Educativo» → «Escuela» es otro lugar escrito, no ortografía
      { ...U10, sede: 'Escuela Bilingue Ricardo Miro' },
    ]) {
      const malo = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${archivo('orto-malo.json', cuerpo)}`])
      assert.equal(malo.codigo, 1, JSON.stringify(cuerpo).slice(0, 80))
    }
    const noOrto = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${archivo('orto-malo.json', { ...U10, sede: 'Colegio Ricardo Miró' })}`])
    assert.match(noOrto.salida, /sede-no-es-ortografia/)
    const escuela = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${archivo('orto-escuela.json', { ...U10, sede: 'Escuela Bilingüe Ricardo Miró' })}`])
    assert.equal(escuela.codigo, 1); assert.match(escuela.salida, /sede-no-es-ortografia/)
    // mayúsculas y espacios sí son ortografía
    const mayus = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${archivo('orto-mayus.json', { ...U10, sedeAnterior: 'centro  educativo bilingue ricardo miro' })}`])
    assert.equal(mayus.codigo, 0, mayus.salida)
    assert.match((await correr(['corregir-ortografia-sede', '--ortografias', f])).salida, /ortografias-requiere-LIGA=archivo/)
    assert.equal((await correr(['corregir-ortografia-sede'])).codigo, 1)
    // opciones de otras operaciones no se mezclan
    assert.equal((await correr(['corregir-ortografia-sede', '--partidos', `PLATINIUM-U10=${f}`])).codigo, 1)
    assert.equal((await correr(['renombrar', '--ortografias', `PLATINIUM-U10=${f}`])).codigo, 1)
    const doble = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--ortografias', `PLATINIUM-U10=${archivo('orto-otro.json', { ...U10, cargaId: 'orto-cli-u10-0002-aaaaaaaa' })}`])
    assert.equal(doble.codigo, 1) // una corrección por liga en cada ejecución
  })

  it('aplicar envía UNA POST con Bearer por liga a /partidos/sede-ortografia con el cuerpo NORMALIZADO, diario 0600 sin el token; incierta se recupera con el MISMO comando; archivo cambiado se rechaza; 409 se registra y detiene', async () => {
    const s = await servidor(() => ({ status: 201, json: { ok: true, reproducido: false } }))
    const f = archivo('orto-aplicar.json', U10); const g = archivo('orto-aplicar12.json', { ...U10, cargaId: 'orto-cli-u12-0001-aaaaaaaa', partidos: ['G-Z'] })
    const diario = join(dir, 'do.json')
    const r = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--ortografias', `PLATINIUM-U12=${g}`, '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(r.codigo, 0, r.salida)
    assert.deepEqual(s.peticiones.map((p) => [p.metodo, p.url]), [['POST', '/v1/admin/ligas/PLATINIUM-U10/partidos/sede-ortografia'], ['POST', '/v1/admin/ligas/PLATINIUM-U12/partidos/sede-ortografia']])
    assert.deepEqual(JSON.parse(s.peticiones[0].cuerpo), { ...U10, partidos: ['G-A', 'G-B'] })
    assert.equal(s.peticiones[0].cabeceras.authorization, `Bearer ${TOKEN}`)
    assert.equal(statSync(diario).mode & 0o777, 0o600); assert.ok(!readFileSync(diario, 'utf8').includes(TOKEN))
    const rep = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--ortografias', `PLATINIUM-U12=${g}`, '--aplicar', '--origen', s.origen, '--diario', diario], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(rep.codigo, 0, rep.salida); assert.equal(s.peticiones.length, 2) // nada se reenvía
    let n = 0
    const u = await servidor(() => { n += 1; return n === 1 ? { status: 503, json: { error: 'resultado-desconocido' } } : { status: 200, json: { ok: true, reproducido: true } } })
    const d2 = join(dir, 'do2.json')
    const a2 = ['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', u.origen, '--diario', d2]
    assert.match((await correr(a2, { SEBEL_OPERADOR_TOKEN: TOKEN })).salida, /detenido-sin-resolver/)
    const seg = await correr(a2, { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(seg.codigo, 0, seg.salida)
    assert.equal(u.peticiones.length, 2); assert.equal(u.peticiones[0].cuerpo, u.peticiones[1].cuerpo) // lo IDÉNTICO
    const cambiado = archivo('orto-aplicar.json', { ...U10, sede: 'Centro Educativo Bilingüe Ricardo MIRÓ' })
    const ter = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${cambiado}`, '--aplicar', '--origen', u.origen, '--diario', d2], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.match(ter.salida, /diario-de-otro-plan|payload-distinto-del-diario/); assert.equal(u.peticiones.length, 2)
    const rech = await servidor(() => ({ status: 409, json: { error: 'sede-no-segura' } }))
    const rr = await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${g}`, '--aplicar', '--origen', rech.origen, '--diario', join(dir, 'do3.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })
    assert.equal(rr.codigo, 1); assert.match(rr.salida, /detenido-por-rechazo/); assert.match(rr.salida, /sede-no-segura/)
    // sin diario o sin credencial no hay petición
    assert.equal((await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', s.origen])).codigo, 1)
    assert.equal((await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', s.origen, '--diario', join(dir, 'do4.json')])).codigo, 1)
    assert.equal(s.peticiones.length, 2)
  })

  it('capturar-base-ortografia: solo GET; escribe la base en un archivo NUEVO 0600 (nunca sobrescribe); se niega con un partido en juego o con la sede distinta de la anterior; sin --base-salida no pide nada', async () => {
    const f = archivo('orto-cap.json', { ...U10, partidos: ['G-A', 'G-B'] })
    const ok = await servidor((req) => ({ status: 200, json: req.url.endsWith('/publico') ? lista(ANTES, ANTES) : juego(req.url.split('/').pop(), req.url.endsWith('G-B') ? 'final' : 'programado', ANTES) }))
    const salida = join(dir, 'base-u10.json')
    const r = await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--base-salida', `PLATINIUM-U10=${salida}`, '--leer', '--origen', ok.origen])
    assert.equal(r.codigo, 0, r.salida)
    assert.ok(ok.peticiones.every((p) => p.metodo === 'GET') && ok.peticiones.length === 3)
    assert.ok(ok.peticiones.every((p) => p.cabeceras.authorization === undefined)) // sin credenciales
    assert.equal(statSync(salida).mode & 0o777, 0o600)
    const base = JSON.parse(readFileSync(salida, 'utf8'))
    assert.equal(base.lista.partidos.length, 3); assert.deepEqual(Object.keys(base.directos).sort(), ['G-A', 'G-B'])
    assert.equal(base.lista.partidos.find((p) => p.gameId === 'G-B').visita.puntos, 21)
    // no sobrescribe
    const antes = readFileSync(salida, 'utf8')
    const otra = await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--base-salida', `PLATINIUM-U10=${salida}`, '--leer', '--origen', ok.origen])
    assert.equal(otra.codigo, 1); assert.match(otra.salida, /base-salida-ya-existe/); assert.equal(readFileSync(salida, 'utf8'), antes)
    const n = ok.peticiones.length
    assert.equal((await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--leer', '--origen', ok.origen])).codigo, 1)
    assert.equal(ok.peticiones.length, n)
    // un partido en juego, o una sede que no es la anterior: se niega y NO escribe el archivo
    for (const [i, publico] of [lista(ANTES, ANTES, []).partidos.map((p) => (p.gameId === 'G-A' ? { ...p, estado: 'vivo', rev: 3 } : p)), lista('Otra sede', ANTES).partidos].entries()) {
      const mal = await servidor((req) => ({ status: 200, json: req.url.endsWith('/publico') ? { ...lista(ANTES, ANTES), partidos: publico } : juego('G-A', 'programado', ANTES) }))
      const nuevo = join(dir, `base-mala-${i}.json`)
      const m = await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--base-salida', `PLATINIUM-U10=${nuevo}`, '--leer', '--origen', mal.origen])
      assert.equal(m.codigo, 1, m.salida); assert.ok(!existsSync(nuevo))
    }
    // una sede ya corregida (mezcla) o TODAS corregidas: la base se captura igual (el servidor las acepta como yaCorregidos); otra sede, no
    for (const [i, [sa, sb]] of [[DESPUES, ANTES], [DESPUES, DESPUES]].entries()) {
      const mezcla = await servidor((req) => ({ status: 200, json: req.url.endsWith('/publico') ? lista(sa, sb) : juego(req.url.split('/').pop(), req.url.endsWith('G-B') ? 'final' : 'programado', req.url.endsWith('G-B') ? sb : sa) }))
      const nuevo = join(dir, `base-mezcla-${i}.json`)
      const m = await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--base-salida', `PLATINIUM-U10=${nuevo}`, '--leer', '--origen', mezcla.origen])
      assert.equal(m.codigo, 0, m.salida); assert.ok(existsSync(nuevo))
    }
    // simulacro: sin --leer no se hace ninguna petición
    const n2 = ok.peticiones.length
    const sim = await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--origen', ok.origen])
    assert.equal(sim.codigo, 0); assert.equal(ok.peticiones.length, n2)
    assert.equal((await correr(['capturar-base-ortografia', '--ortografias', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', ok.origen, '--diario', join(dir, 'x.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })).codigo, 1)
  })

  it('verificar-ortografia-sede: pasa SOLO si la sede de los nombrados cambió y todo lo demás coincide con la base (también un partido final); falla si cambia otro dato, falta la base o la sede está a medias', async () => {
    const f = archivo('orto-ver.json', { ...U10, partidos: ['G-A', 'G-B'] })
    const publicoAntes = lista(ANTES, ANTES)
    const directo = (id, sede, sobre = {}) => (id === 'G-B' ? juego('G-B', 'final', sede, { visita: lado('Y', 21, 4), ...sobre }) : juego('G-A', 'programado', sede, sobre))
    const baseArchivo = archivo('base-ver.json', { version: 1, ligaId: 'PLATINIUM-U10', lista: publicoAntes, directos: { 'G-A': directo('G-A', ANTES), 'G-B': directo('G-B', ANTES) } })
    // cada respuesta lleva una `servidorAhoraMs` DISTINTA (como el servidor real): lo volátil no puede hacer fallar una verificación sin cambios
    let reloj = 1_700_000_000_000
    const servir = (p, d) => servidor((req) => ({ status: 200, json: { servidorAhoraMs: (reloj += 7919), ...(req.url.endsWith('/publico') ? p : d(req.url.split('/').pop())) } }))
    const args = (origen) => ['verificar-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--base', `PLATINIUM-U10=${baseArchivo}`, '--leer', '--origen', origen]
    const ok = await servir(lista(DESPUES, DESPUES), (id) => directo(id, DESPUES))
    const v = await correr(args(ok.origen))
    assert.equal(v.codigo, 0, v.salida)
    assert.ok(ok.peticiones.every((p) => p.metodo === 'GET'))
    const casos = {
      'sede a medias en la lista': [lista(DESPUES, ANTES), (id) => directo(id, DESPUES)],
      'sede a medias en la lectura directa': [lista(DESPUES, DESPUES), (id) => directo(id, id === 'G-B' ? ANTES : DESPUES)],
      'cambió el marcador del final': [{ ...lista(DESPUES, DESPUES), partidos: lista(DESPUES, DESPUES).partidos.map((p) => (p.gameId === 'G-B' ? { ...p, visita: lado('Y', 22, 4) } : p)) }, (id) => directo(id, DESPUES)],
      'cambió un campo nuevo que la base no conocía': [{ ...lista(DESPUES, DESPUES), faltasAlcance: 'otro' }, (id) => directo(id, DESPUES)],
      'cambió la lectura directa (campo adicional)': [lista(DESPUES, DESPUES), (id) => directo(id, DESPUES, { anotaciones: [{ x: 1 }] })],
      'cambió la sede de un partido no nombrado': [{ ...lista(DESPUES, DESPUES), partidos: lista(DESPUES, DESPUES).partidos.map((p) => (p.gameId === 'G-C' ? { ...p, sede: DESPUES } : p)) }, (id) => directo(id, DESPUES)],
      'apareció un partido': [lista(DESPUES, DESPUES, [juego('G-X', 'programado', null)]), (id) => directo(id, DESPUES)],
      'desapareció un partido': [{ ...lista(DESPUES, DESPUES), partidos: lista(DESPUES, DESPUES).partidos.slice(1) }, (id) => directo(id, DESPUES)],
      'cambió el reloj': [{ ...lista(DESPUES, DESPUES), partidos: lista(DESPUES, DESPUES).partidos.map((p) => (p.gameId === 'G-C' ? { ...p, reloj: { estado: 'corriendo', restanteMs: 1000, desdeMs: 5 } } : p)) }, (id) => directo(id, DESPUES)],
      'cambió el estado de un partido no nombrado': [{ ...lista(DESPUES, DESPUES), partidos: lista(DESPUES, DESPUES).partidos.map((p) => (p.gameId === 'G-C' ? { ...p, estado: 'vivo', rev: 2 } : p)) }, (id) => directo(id, DESPUES)],
      'cambió la lectura directa (faltas)': [lista(DESPUES, DESPUES), (id) => directo(id, DESPUES, { local: lado('X', id === 'G-B' ? 20 : 0, 99) })],
      'cambió la hora': [{ ...lista(DESPUES, DESPUES), partidos: lista(DESPUES, DESPUES).partidos.map((p) => (p.gameId === 'G-A' ? { ...p, programadoPara: '2026-10-25T20:00:00.000Z' } : p)) }, (id) => directo(id, DESPUES)],
    }
    for (const [nombre, [p, d]] of Object.entries(casos)) {
      const s = await servir(p, d)
      const m = await correr(args(s.origen))
      assert.equal(m.codigo, 1, nombre)
    }
    // sin la base, o con una base de otra liga: falla
    const s2 = await servir(lista(DESPUES, DESPUES), (id) => directo(id, DESPUES))
    assert.equal((await correr(['verificar-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--leer', '--origen', s2.origen])).codigo, 1)
    const otraBase = archivo('base-otra.json', { version: 1, ligaId: 'OTRA', lista: { partidos: [] }, directos: {} })
    assert.equal((await correr(['verificar-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--base', `PLATINIUM-U10=${otraBase}`, '--leer', '--origen', s2.origen])).codigo, 1)
    // simulacro y mezclas
    const n = s2.peticiones.length
    assert.equal((await correr(['verificar-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--origen', s2.origen])).codigo, 0); assert.equal(s2.peticiones.length, n)
    assert.equal((await correr(['corregir-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--base', `PLATINIUM-U10=${baseArchivo}`])).codigo, 1)
    assert.equal((await correr(['verificar-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--aplicar', '--origen', s2.origen, '--diario', join(dir, 'y.json')], { SEBEL_OPERADOR_TOKEN: TOKEN })).codigo, 1)
  })

  it('esta versión no tiene `corregir-sede` ni `verificar-sede`: el comando se rechaza y no hace peticiones', async () => {
    const f = archivo('sede-vieja.json', { ...U10, partidos: ['G-A'] })
    for (const c of ['corregir-sede', 'verificar-sede']) {
      const r = await correr([c, '--sedes', `PLATINIUM-U10=${f}`])
      assert.equal(r.codigo, 1, c)
    }
  })

  it('la verificación ignora SOLO `servidorAhoraMs`: con la base y la liga idénticas pasa aunque cada respuesta lleve otra hora del servidor, y falla si cambia cualquier otro campo anidado', async () => {
    const f = archivo('orto-volatil.json', { ...U10, partidos: ['G-A'] })
    const antes = lista(ANTES, ANTES)
    const baseArchivo = archivo('base-volatil.json', { version: 1, ligaId: 'PLATINIUM-U10', lista: antes, directos: { 'G-A': juego('G-A', 'programado', ANTES) } })
    let reloj = 1
    const servir = (p) => servidor((req) => ({ status: 200, json: { servidorAhoraMs: (reloj += 1013), ...(req.url.endsWith('/publico') ? p : juego('G-A', 'programado', DESPUES)) } }))
    const args = (origen) => ['verificar-ortografia-sede', '--ortografias', `PLATINIUM-U10=${f}`, '--base', `PLATINIUM-U10=${baseArchivo}`, '--leer', '--origen', origen]
    const esperada = { ...antes, partidos: antes.partidos.map((p) => (p.gameId === 'G-A' ? { ...p, sede: DESPUES } : p)) }
    const ok = await servir(esperada)
    assert.equal((await correr(args(ok.origen))).codigo, 0)
    const anidado = await servir({ ...esperada, partidos: esperada.partidos.map((p) => (p.gameId === 'G-C' ? { ...p, local: { ...p.local, faltas: 1 } } : p)) })
    assert.equal((await correr(args(anidado.origen))).codigo, 1)
  })
})
