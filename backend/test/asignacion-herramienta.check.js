import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aplicarCarga, construirPlanAsignacion, resumenDelPlanCarga } from '../scripts/lib/operador.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { sembrar } from './ayuda.js'
import { ORIGEN, TOKEN_OPERADOR, accesoStub, conCookie, control, enAcceso, iniciarSesion, pedir, provisionar, reiniciarAcceso } from './ayuda-acceso.js'

// Herramienta del operador `asignar` (REPORT_187), con destino REMOTO aprobado SIMULADO: ninguna petición sale del proceso; el «borde»
// traduce https://semabel.com → el Worker real de pruebas. Diario de escritura anticipada en memoria. Todo SINTÉTICO.

const REMOTO = 'https://semabel.com'
const tiempoMs = 5000

function borde({ antes, despues } = {}) {
  const registro = []
  const f = async (url, init = {}) => {
    const entrada = { url: String(url), metodo: init.method ?? 'GET', cuerpo: init.body ?? null, cabeceras: { ...(init.headers ?? {}) }, redirect: init.redirect }
    registro.push(entrada)
    if (antes) { const r = await antes(entrada, registro); if (r) return r }
    const r = await exports.default.fetch(new Request(entrada.url.replace(REMOTO, ORIGEN), { method: init.method, headers: entrada.cabeceras, body: init.body }))
    if (despues) return despues(r, entrada, registro)
    return r
  }
  f.registro = registro
  f.posts = () => registro.filter((x) => x.metodo === 'POST')
  return f
}
const respuestaPerdida = () => (async (r) => { await r.arrayBuffer(); throw new Error('red caida (prueba)') })
function almacenEnMemoria({ fallaEscritura = () => false } = {}) {
  const a = { texto: null, escrituras: 0, historial: [] }
  a.leer = async () => a.texto
  a.escribir = async (t) => { a.escrituras += 1; if (fallaEscritura(a.escrituras, t)) throw new Error('disco lleno (prueba)'); a.texto = t; a.historial.push(t) }
  return a
}
const base = (extra = {}) => ({ origen: REMOTO, remoto: true, entorno: {}, tiempoMs, token: TOKEN_OPERADOR, ...extra })
const filas = (c, ...a) => enAcceso((i) => i.almacen.sql.exec(c, ...a).toArray())

async function escenario({ nuevas = 1 } = {}) {
  await reiniciarAcceso()
  await enAcceso((i) => { for (const t of ['asignaciones_liga', 'propiedad', 'auditoria_acceso']) i.almacen.sql.exec(`DELETE FROM ${t}`) })
  const sembrarUna = async () => { const l = nuevaLiga(); const p = payloadDeLiga(l); p.credenciales = []; if ((await sembrar(l, p)).status !== 201) throw new Error('siembra'); return l }
  const mia = await sembrarUna(); const otras = []; for (let i = 0; i < nuevas; i += 1) otras.push(await sembrarUna())
  const { codigo, organizadorId } = await provisionar([mia])
  return { mia, otras, organizadorId, codigo, cookie: (await iniciarSesion(codigo)).cookie }
}
const yo = (cookie) => pedir('GET', '/v1/organizador/yo', { cabeceras: conCookie(cookie) })

beforeEach(() => { control.fallaAsignacion = false })
afterEach(() => { control.fallaAsignacion = false })

describe('simulacro (por defecto) y validación del plan: ninguna petición ni escritura', () => {
  it('el plan valida y resume (organizador, ligas ordenadas, identificador estable); el identificador no depende del orden y cambia con el contenido', async () => {
    const a = await construirPlanAsignacion({ organizadorId: 'org-0123456789abcdef', ligas: ['LIGA2', 'LIGA1'] })
    const b = await construirPlanAsignacion({ organizadorId: 'org-0123456789abcdef', ligas: ['LIGA1', 'LIGA2'] })
    const c = await construirPlanAsignacion({ organizadorId: 'org-0123456789abcdef', ligas: ['LIGA1'] })
    const d = await construirPlanAsignacion({ organizadorId: 'org-fedcba9876543210', ligas: ['LIGA1', 'LIGA2'] })
    expect(a.ok).toBe(true)
    expect(resumenDelPlanCarga(a).elementos[0]).toMatchObject({ tipo: 'asignar', organizadorId: 'org-0123456789abcdef', ligas: ['LIGA1', 'LIGA2'] })
    expect(a.usadas[0].cuerpo).toBe(b.usadas[0].cuerpo)
    expect(a.usadas[0].resumen.operacionId).toMatch(/^asig-[0-9a-f]{40}$/)
    expect(new Set([a, c, d].map((p) => p.usadas[0].resumen.operacionId)).size).toBe(3)
  })
  it('exige organizador y ligas explícitos y válidos', async () => {
    const malos = [
      { ligas: ['LIGA1'] }, { organizadorId: '', ligas: ['LIGA1'] }, { organizadorId: 'otro-0123', ligas: ['LIGA1'] }, { organizadorId: 'org-01 23', ligas: ['LIGA1'] },
      { organizadorId: 'org-0123' }, { organizadorId: 'org-0123', ligas: [] }, { organizadorId: 'org-0123', ligas: ['A', 'A'] }, { organizadorId: 'org-0123', ligas: ['mala liga'] },
      { organizadorId: 'org-0123', ligas: Array.from({ length: 11 }, (_, i) => `L${i}`) },
    ]
    for (const m of malos) { const p = await construirPlanAsignacion(m); expect(p.ok, JSON.stringify(m)).toBe(false); expect(p.problemas.length).toBeGreaterThan(0) }
  })
  it('aplicar con un plan inválido no envía nada ni escribe el diario', async () => {
    const plan = await construirPlanAsignacion({ ligas: ['LIGA1'] }); const f = borde(); const almacen = almacenEnMemoria()
    const r = await aplicarCarga({ plan, almacen, fetch: f, ...base() })
    expect(r.estado).toBe('plan-invalido'); expect(f.registro).toHaveLength(0); expect(almacen.escrituras).toBe(0)
  })
})

describe('aplicar: diario anticipado, reproducción y lectura de vuelta', () => {
  it('éxito: el diario se escribe ANTES de enviar y guarda el resultado; la MISMA sesión ve la liga; reejecutar con el mismo diario no envía nada; con un diario nuevo el servidor repite el resultado original', async () => {
    const e = await escenario(); const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    const f = borde(); const almacen = almacenEnMemoria()
    const r = await aplicarCarga({ plan, almacen, fetch: f, ...base() })
    expect(r).toEqual({ estado: 'completo', total: 1, aplicadas: 1, reproducidas: 0 })
    // escritura anticipada: el primer estado guardado es «pendiente», luego «enviando» ANTES de la petición, luego «aplicada»
    const estados = almacen.historial.map((t) => JSON.parse(t).ops[0].estado)
    expect(estados).toEqual(['pendiente', 'enviando', 'aplicada'])
    const diario = JSON.parse(almacen.texto)
    expect(diario.ops[0].resultado).toMatchObject({ status: 201, reproducido: false, agregadas: [e.otras[0]], yaExistian: [] })
    expect(diario.ops[0].resultado.ligas).toEqual([e.mia, e.otras[0]].sort())
    // lectura de vuelta con la sesión de SIEMPRE (sin volver a entrar)
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([e.mia, e.otras[0]].sort())
    // el mismo diario: nada que reenviar
    const f2 = borde(); const r2 = await aplicarCarga({ plan, almacen, fetch: f2, ...base() })
    expect(r2).toEqual({ estado: 'completo', total: 1, aplicadas: 0, reproducidas: 0 }); expect(f2.registro).toHaveLength(0)
    // un diario NUEVO con el mismo plan: el servidor repite el resultado original (mismo operacionId + contenido)
    const r3 = await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: borde(), ...base() })
    expect(r3).toEqual({ estado: 'completo', total: 1, aplicadas: 0, reproducidas: 1 })
    expect((await filas('SELECT COUNT(*) AS n FROM propiedad WHERE liga_id = ?', e.otras[0]))[0].n).toBe(1)
  })
  it('respuesta PERDIDA tras aplicarse en el servidor: queda «incierta» y se detiene; la siguiente ejecución reenvía EXACTAMENTE el mismo cuerpo (mismo identificador) y el servidor repite el original', async () => {
    const e = await escenario(); const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    const almacen = almacenEnMemoria(); const f = borde({ despues: respuestaPerdida() })
    const r = await aplicarCarga({ plan, almacen, fetch: f, ...base() })
    expect(r.estado).toBe('detenido-sin-resolver')
    expect(JSON.parse(almacen.texto).ops[0].estado).toBe('incierta')
    expect((await filas('SELECT liga_id FROM propiedad WHERE organizador_id = ? ORDER BY liga_id', e.organizadorId)).map((x) => x.liga_id)).toEqual([e.mia, e.otras[0]].sort()) // el servidor SÍ la aplicó
    const f2 = borde(); const r2 = await aplicarCarga({ plan, almacen, fetch: f2, ...base() })
    expect(r2).toEqual({ estado: 'completo', total: 1, aplicadas: 0, reproducidas: 1 })
    expect(f2.posts()).toHaveLength(1)
    expect(f2.posts()[0].cuerpo).toBe(f.posts()[0].cuerpo) // idéntico: mismo operacionId
    expect(JSON.parse(f2.posts()[0].cuerpo).operacionId).toBe(plan.usadas[0].resumen.operacionId)
  })
  it('respuesta perdida ANTES de aplicarse (resultado incierto de verdad): el reintento exacto la aplica una sola vez', async () => {
    const e = await escenario(); const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    const almacen = almacenEnMemoria(); const f = borde({ antes: async () => { throw new Error('sin red (prueba)') } })
    expect((await aplicarCarga({ plan, almacen, fetch: f, ...base() })).estado).toBe('detenido-sin-resolver')
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([e.mia])
    const r = await aplicarCarga({ plan, almacen, fetch: borde(), ...base() })
    expect(r).toEqual({ estado: 'completo', total: 1, aplicadas: 1, reproducidas: 0 })
  })
  it('fallo del servidor entre la propiedad y el recibo: 503 → «incierta», nada quedó escrito; el reintento exacto aplica una vez', async () => {
    const e = await escenario(); const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    const almacen = almacenEnMemoria(); control.fallaAsignacion = true
    expect((await aplicarCarga({ plan, almacen, fetch: borde(), ...base() })).estado).toBe('detenido-sin-resolver')
    expect((await filas('SELECT COUNT(*) AS n FROM asignaciones_liga'))[0].n).toBe(0)
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([e.mia])
    control.fallaAsignacion = false
    expect(await aplicarCarga({ plan, almacen, fetch: borde(), ...base() })).toEqual({ estado: 'completo', total: 1, aplicadas: 1, reproducidas: 0 })
  })
  it('credencial incorrecta o puerta cerrada → «incierta» (no se asume nada), sin escrituras en el servidor; nunca se crea otro identificador', async () => {
    const e = await escenario(); const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    const almacen = almacenEnMemoria()
    expect((await aplicarCarga({ plan, almacen, fetch: borde(), ...base({ token: 'otro-secreto-cualquiera-de-operador-00' }) })).estado).toBe('detenido-sin-resolver')
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([e.mia])
    const cerrada = borde({ antes: async (en) => (en.url.includes('/v1/admin/') ? new Response('{"error":"no-encontrado"}', { status: 404 }) : null) })
    expect((await aplicarCarga({ plan, almacen, fetch: cerrada, ...base() })).estado).toBe('detenido-sin-resolver')
    const ids = new Set(almacen.historial.map((t) => JSON.parse(t).ops[0].cuerpo))
    expect(ids.size).toBe(1)
  })
  it('conflicto de propiedad: «detenido-por-rechazo» con las ligas en conflicto, el servidor no escribió nada, el diario queda «rechazada» y reejecutarlo no envía otra petición', async () => {
    const e = await escenario({ nuevas: 2 })
    await enAcceso((i) => i.almacen.sql.exec("INSERT INTO propiedad (organizador_id, liga_id) VALUES ('org-ajeno-heredado', ?)", e.otras[1]))
    const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0], e.otras[1]] })
    const almacen = almacenEnMemoria(); const f = borde()
    const r = await aplicarCarga({ plan, almacen, fetch: f, ...base() })
    expect(r).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'liga-con-otro-propietario', ligas: [e.otras[1]] })
    expect((await yo(e.cookie)).cuerpo.ligas).toEqual([e.mia])
    const f2 = borde(); const r2 = await aplicarCarga({ plan, almacen, fetch: f2, ...base() })
    expect(r2.estado).toBe('diario-con-rechazo'); expect(f2.registro).toHaveLength(0)
  })
  it('organizador desactivado, o un id equivocado: rechazo `organizador-no-activo`, nada escrito', async () => {
    const e = await escenario()
    for (const id of ['org-equivocado-0000', e.organizadorId]) {
      if (id === e.organizadorId) await accesoStub().desactivarOrganizador()
      const plan = await construirPlanAsignacion({ organizadorId: id, ligas: [e.otras[0]] })
      expect(await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: borde(), ...base() })).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'organizador-no-activo' })
    }
    expect((await filas('SELECT COUNT(*) AS n FROM propiedad WHERE liga_id = ?', e.otras[0]))[0].n).toBe(0)
  })
  it('liga no admitida: rechazo 422 `ligas-invalidas` sin escribir', async () => {
    const e = await escenario()
    const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: ['NO-ADMITIDA'] })
    expect(await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: borde(), ...base() })).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'ligas-invalidas' })
  })
  it('un diario de OTRO plan (otras ligas u otro organizador) se rechaza sin enviar; el cuerpo del diario es el que se reenvía', async () => {
    const e = await escenario({ nuevas: 2 }); const almacen = almacenEnMemoria()
    const plan1 = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    await aplicarCarga({ plan: plan1, almacen, fetch: borde({ despues: respuestaPerdida() }), ...base() })
    const plan2 = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[1]] })
    const f = borde(); const r = await aplicarCarga({ plan: plan2, almacen, fetch: f, ...base() })
    expect(r.estado).toBe('diario-de-otro-plan'); expect(f.registro).toHaveLength(0)
  })
  it('protecciones del transporte intactas: origen exacto aprobado, TLS no desactivado, redirección = incierta sin seguirla; el diario no guarda el token y no se envía con un diario que no se puede escribir', async () => {
    const e = await escenario(); const plan = await construirPlanAsignacion({ organizadorId: e.organizadorId, ligas: [e.otras[0]] })
    for (const origen of ['https://semabel.com/', 'http://semabel.com', 'https://evil.test', 'HTTPS://SEMABEL.COM']) {
      const f = borde(); expect((await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: f, ...base({ origen }) })).estado, origen).toBe('origen-remoto-no-aprobado'); expect(f.registro).toHaveLength(0)
    }
    expect((await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: borde(), ...base({ entorno: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } }) })).estado).toBe('tls-verificacion-desactivada')
    expect((await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: borde(), ...base({ token: 'corto' }) })).estado).toBe('sin-credencial')
    expect((await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: borde(), ...base({ tiempoMs: 5 }) })).estado).toBe('tiempo-invalido')
    const redir = borde({ antes: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } }) })
    expect((await aplicarCarga({ plan, almacen: almacenEnMemoria(), fetch: redir, ...base() })).estado).toBe('detenido-sin-resolver'); expect(redir.registro).toHaveLength(1)
    const sinDisco = almacenEnMemoria({ fallaEscritura: () => true }); const f = borde()
    expect((await aplicarCarga({ plan, almacen: sinDisco, fetch: f, ...base() })).estado).toBe('diario-no-guardado'); expect(f.registro).toHaveLength(0)
    const alm = almacenEnMemoria(); await aplicarCarga({ plan, almacen: alm, fetch: borde(), ...base() })
    expect(alm.historial.join('')).not.toContain(TOKEN_OPERADOR)
    expect(JSON.stringify(await aplicarCarga({ plan, almacen: alm, fetch: borde(), ...base() }))).not.toContain(TOKEN_OPERADOR)
    expect((await yo(e.cookie)).status).toBe(200)
  })
})
