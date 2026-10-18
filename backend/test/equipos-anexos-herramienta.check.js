import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { aplicarCarga, construirPlanCarga, resumenDelPlanCarga, verificarCarga } from '../scripts/lib/operador.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR } from './ayuda-acceso.js'
import { sqlDe } from './ayuda.js'

// Operator tool, command `equipos` (append teams): dry-run, journal, retries, read-back. SYNTHETIC data; the mocked "edge"
// maps https://semabel.com to the in-process test Worker. No real server is ever contacted.

const REMOTO = 'https://semabel.com'
function borde({ antes, despues } = {}) {
  const registro = []
  const f = async (url, init = {}) => {
    const e = { url: String(url), metodo: init.method ?? 'GET', cuerpo: init.body ?? null, cabeceras: { ...(init.headers ?? {}) }, redirect: init.redirect }
    registro.push(e)
    if (antes) { const r = await antes(e); if (r) return r }
    const r = await exports.default.fetch(new Request(e.url.replace(REMOTO, ORIGEN), { method: init.method, headers: e.cabeceras, body: init.body }))
    e.status = r.status
    return despues ? despues(r, e) : r
  }
  f.registro = registro; f.posts = () => registro.filter((x) => x.metodo === 'POST')
  return f
}
function almacen({ falla = () => false } = {}) {
  const a = { texto: null, n: 0, historial: [] }
  a.leer = async () => a.texto
  a.escribir = async (t) => { a.n += 1; if (falla(a.n)) throw new Error('disk full (test)'); a.texto = t; a.historial.push(t) }
  return a
}
const base = (extra = {}) => ({ origen: REMOTO, remoto: true, entorno: {}, tiempoMs: 5000, token: TOKEN_OPERADOR, ...extra })
const CARGA = (n) => `append-tool-${String(n).padStart(4, '0')}-zzzz`
const estructura = (L, n = 1) => JSON.stringify({ cargaId: CARGA(n), liga: { id: L, nombre: 'Tool append league', deporte: 'baloncesto' }, equipos: [{ id: `${L}-ALFA`, nombre: 'Alfa' }, { id: `${L}-BETA`, nombre: 'Beta' }] })
const anexo = (L, n = 10, extra = []) => JSON.stringify({ cargaId: CARGA(n), equipos: [{ id: `${L}-GAMMA`, nombre: 'Gamma' }, { id: `${L}-DELTA`, nombre: 'Delta' }, ...extra] })
const planEst = (t) => construirPlanCarga({ tipo: 'estructura', estructuras: [t] })
const planAn = (L, t) => construirPlanCarga({ tipo: 'equipos', anexos: [{ ligaId: L, texto: t }] })
async function conEstructura() {
  const L = nuevaLiga(); const est = estructura(L)
  expect((await aplicarCarga({ ...base(), plan: await planEst(est), almacen: almacen(), fetch: borde() })).estado).toBe('completo')
  return { L, est }
}
const nEquipos = async (L) => (await sqlDe(L, 'SELECT COUNT(*) AS n FROM equipos'))[0].n

describe('dry-run (default): validates and summarises, no requests', () => {
  it('valid append payload: summary without names; the route is the append route', async () => {
    const L = nuevaLiga(); const plan = await planAn(L, anexo(L))
    expect(plan.ok).toBe(true)
    expect(plan.usadas[0].ruta).toBe(`/v1/admin/ligas/${L}/equipos`)
    const resumen = JSON.stringify(resumenDelPlanCarga(plan))
    expect(resumen).toContain('"equipos":2')
    for (const n of ['Gamma', 'Delta']) expect(resumen).not.toContain(n)
  })
  it('flags invalid payloads before any request: short cargaId, duplicate names/ids, ambiguous public key, extra fields, padded names', async () => {
    const L = nuevaLiga()
    const malos = [
      JSON.stringify({ cargaId: 'short', equipos: [{ id: `${L}-A`, nombre: 'A' }] }),
      JSON.stringify({ cargaId: CARGA(1), equipos: [{ id: `${L}-A`, nombre: 'Same' }, { id: `${L}-B`, nombre: 'same' }] }),
      JSON.stringify({ cargaId: CARGA(1), equipos: [{ id: `${L}-A`, nombre: 'One' }, { id: `${L}-A`, nombre: 'Two' }] }),
      JSON.stringify({ cargaId: CARGA(1), equipos: [{ id: `${L}-A`, nombre: 'One' }, { id: `${L}-a`, nombre: 'Two' }] }),
      JSON.stringify({ cargaId: CARGA(1), equipos: [{ id: `${L}-A`, nombre: 'One' }], liga: {} }),
      JSON.stringify({ cargaId: CARGA(1), equipos: [{ id: `${L}-A`, nombre: ' One' }] }),
      '{broken',
    ]
    for (const t of malos) expect((await planAn(L, t)).ok).toBe(false)
  })
  it('games for appended teams are cross-checked against structure + appended teams', async () => {
    const L = nuevaLiga()
    const lote = (visita) => JSON.stringify({ cargaId: CARGA(20), minutosPorPeriodo: 8, partidos: [{ id: 'G1', localId: `${L}-GAMMA`, visitaId: visita }] })
    const ok = await construirPlanCarga({ tipo: 'partidos', estructuras: [estructura(L)], anexos: [{ ligaId: L, texto: anexo(L) }], partidos: [{ ligaId: L, texto: lote(`${L}-ALFA`) }] })
    expect(ok.ok).toBe(true)
    const mal = await construirPlanCarga({ tipo: 'partidos', estructuras: [estructura(L)], anexos: [{ ligaId: L, texto: anexo(L) }], partidos: [{ ligaId: L, texto: lote(`${L}-NOPE`) }] })
    expect(mal.problemas.join()).toContain('equipo-fuera-de-la-estructura')
  })
})

describe('apply: write-ahead journal, idempotency and identical retries', () => {
  it('appends, then the same journal is a no-op and a NEW journal with the same payload is replayed by the server (reproducido) without duplicates', async () => {
    const { L } = await conEstructura(); const plan = await planAn(L, anexo(L)); const d = almacen(); const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 1, reproducidas: 0 })
    expect(red.posts().map((x) => x.url.replace(REMOTO, ''))).toEqual([`/v1/admin/ligas/${L}/equipos`])
    expect(await nEquipos(L)).toBe(4)
    const n = red.posts().length
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 0 })
    expect(red.posts()).toHaveLength(n)
    expect(await aplicarCarga({ ...base(), plan, almacen: almacen(), fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 0, reproducidas: 1 })
    expect(await nEquipos(L)).toBe(4)
  })
  it('lost response: the append DID apply; the retry resends the identical body and cargaId and the server replays it', async () => {
    const { L } = await conEstructura(); const plan = await planAn(L, anexo(L)); const d = almacen()
    const perdida = borde({ despues: async (r) => { await r.arrayBuffer(); throw new Error('network lost (test)') } })
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: perdida })).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-0' })
    expect(JSON.parse(d.texto).ops[0].estado).toBe('incierta'); expect(await nEquipos(L)).toBe(4)
    const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', reproducidas: 1 })
    expect(red.posts()[0].cuerpo).toBe(JSON.parse(d.historial[0]).ops[0].cuerpo)
    expect(JSON.parse(red.posts()[0].cuerpo).cargaId).toBe(CARGA(10))
    expect(await nEquipos(L)).toBe(4)
  })
  it('changed content under the same cargaId is a rejected conflict (409): nothing written and the journal refuses to continue', async () => {
    const { L } = await conEstructura()
    await aplicarCarga({ ...base(), plan: await planAn(L, anexo(L)), almacen: almacen(), fetch: borde() })
    const cambiado = await planAn(L, anexo(L, 10, [{ id: `${L}-OMEGA`, nombre: 'Omega' }]))
    const d = almacen(); const red = borde()
    expect(await aplicarCarga({ ...base(), plan: cambiado, almacen: d, fetch: red })).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'carga-conflicto' })
    expect(await nEquipos(L)).toBe(4)
    const n = red.posts().length
    expect((await aplicarCarga({ ...base(), plan: cambiado, almacen: d, fetch: red })).estado).toBe('diario-con-rechazo'); expect(red.posts()).toHaveLength(n)
  })
  it('colliding id/name against the stored league is rejected by the server and writes nothing; uninitialized league is rejected', async () => {
    const { L } = await conEstructura()
    const choca = await planAn(L, JSON.stringify({ cargaId: CARGA(30), equipos: [{ id: `${L}-NEW`, nombre: 'Fresh' }, { id: `${L}-BETA`, nombre: 'Collides' }] }))
    expect(await aplicarCarga({ ...base(), plan: choca, almacen: almacen(), fetch: borde() })).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'equipo-existente' })
    expect(await nEquipos(L)).toBe(2)
    const vacia = nuevaLiga()
    expect(await aplicarCarga({ ...base(), plan: await planAn(vacia, anexo(vacia)), almacen: almacen(), fetch: borde() })).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'liga-sin-estructura' })
  })
  it('journal failures: nothing is sent if the journal cannot be saved; an unsaved result leaves the operation «enviando» and the retry is identical', async () => {
    const { L } = await conEstructura(); const plan = await planAn(L, anexo(L))
    const red0 = borde()
    expect((await aplicarCarga({ ...base(), plan, almacen: almacen({ falla: () => true }), fetch: red0 })).estado).toBe('diario-no-guardado'); expect(red0.registro).toHaveLength(0)
    const red1 = borde()
    expect((await aplicarCarga({ ...base(), plan, almacen: almacen({ falla: (n) => n === 2 }), fetch: red1 })).estado).toBe('diario-no-guardado'); expect(red1.registro).toHaveLength(0)
    const d = almacen({ falla: (n) => n === 3 })
    expect((await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde() })).estado).toBe('diario-no-guardado')
    expect(JSON.parse(d.texto).ops[0].estado).toBe('enviando')
    d.escribir = async (t) => { d.texto = t }
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde() })).toMatchObject({ estado: 'completo', reproducidas: 1 })
    expect(await nEquipos(L)).toBe(4)
  })
  it('target guards still apply to the new command (no opt-in, wrong origin, TLS off, redirect): no appended team, no journal', async () => {
    const { L } = await conEstructura(); const plan = await planAn(L, anexo(L))
    for (const [extra, cod] of [[{ remoto: false }, 'origen-no-local'], [{ origen: 'https://evil.test' }, 'origen-remoto-no-aprobado'], [{ entorno: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } }, 'tls-verificacion-desactivada']]) {
      const red = borde(); const d = almacen()
      expect(await aplicarCarga({ ...base(extra), plan, almacen: d, fetch: red })).toEqual({ estado: cod }); expect(red.registro).toHaveLength(0); expect(d.n).toBe(0)
    }
    const red = borde({ antes: () => new Response(null, { status: 307, headers: { location: 'https://evil.test/x' } }) })
    expect(await aplicarCarga({ ...base(), plan, almacen: almacen(), fetch: red })).toMatchObject({ estado: 'detenido-sin-resolver' })
    expect(red.registro).toHaveLength(1); expect(await nEquipos(L)).toBe(2)
  })
})

describe('read-back verification', () => {
  const ver = (L, { est, anexos, partidos, fetch = borde() }) => verificarCarga({ estructuras: est ? [est] : [], anexos: (anexos ?? []).map((texto) => ({ ligaId: L, texto })), partidos: partidos ?? [], fetch, origen: REMOTO, remoto: true, entorno: {}, tiempoMs: 5000 })
  it('initial structure + appended teams: the COMPLETE set is exact', async () => {
    const { L, est } = await conEstructura()
    await aplicarCarga({ ...base(), plan: await planAn(L, anexo(L)), almacen: almacen(), fetch: borde() })
    const v = await ver(L, { est, anexos: [anexo(L)] })
    expect(v.comprobaciones.filter((c) => !c.ok)).toEqual([]); expect(v.comprobaciones.find((c) => c.codigo === `equipos-exactos:${L}`).detalle).toEqual({ esperados: 4, reales: 4 })
  })
  it('the exact structure check is NOT weakened: after an append, the initial structure alone fails because of the unexpected teams', async () => {
    const { L, est } = await conEstructura()
    await aplicarCarga({ ...base(), plan: await planAn(L, anexo(L)), almacen: almacen(), fetch: borde() })
    const v = await ver(L, { est })
    expect(v.ok).toBe(false); expect(v.comprobaciones.find((c) => c.codigo === `equipos-exactos:${L}`).ok).toBe(false)
  })
  it('before the append is applied, structure + anexos fails (teams missing); appended-only mode checks presence and exact names without claiming completeness', async () => {
    const { L, est } = await conEstructura()
    expect((await ver(L, { est, anexos: [anexo(L)] })).ok).toBe(false)
    const antes = await ver(L, { anexos: [anexo(L)] })
    expect(antes.ok).toBe(false); expect(antes.comprobaciones.find((c) => c.codigo === `equipos-anadidos-presentes:${L}`).detalle).toHaveLength(2)
    await aplicarCarga({ ...base(), plan: await planAn(L, anexo(L)), almacen: almacen(), fetch: borde() })
    expect((await ver(L, { anexos: [anexo(L)] })).ok).toBe(true)
    expect((await ver(L, { anexos: [anexo(L).replace('Gamma', 'Gamma X')] })).ok).toBe(false) // wrong name
  })
  it('detects a missing or extra appended team and still reads only public GETs without credentials', async () => {
    const { L, est } = await conEstructura(); const red = borde()
    await aplicarCarga({ ...base(), plan: await planAn(L, anexo(L)), almacen: almacen(), fetch: borde() })
    expect((await ver(L, { est, anexos: [JSON.stringify({ cargaId: CARGA(10), equipos: [{ id: `${L}-GAMMA`, nombre: 'Gamma' }] })], fetch: red })).ok).toBe(false) // DELTA unexpected
    expect(red.registro.every((x) => x.metodo === 'GET' && !x.cabeceras.authorization && !x.cabeceras.cookie)).toBe(true)
  })
})
