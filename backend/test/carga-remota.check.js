import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { aplicarCarga, construirPlanCarga, construirPlanOrganizador, resumenDelPlanCarga, verificarCarga } from '../scripts/lib/operador.js'
import { aplicar, construirPlan, sha256Hex, verificar } from '../scripts/lib/runner-plantilla.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, TOKEN_OPERADOR, iniciarSesion, reiniciarAcceso, T0 } from './ayuda-acceso.js'
import { sqlDe } from './ayuda.js'

// Herramientas de carga con destino REMOTO aprobado. Todo es SINTÉTICO y NINGUNA petición sale del proceso: el «borde» simulado
// traduce https://semabel.com → el Worker real de pruebas (dentro del runtime). Jamás se contacta ningún servidor real.

const REMOTO = 'https://semabel.com'
const ENTORNO_BUENO = {}
const tiempoMs = 5000

/** fetch simulado del borde. `antes` puede devolver una Response (p. ej. una redirección) o lanzar; `despues` ve la respuesta real. */
function borde({ antes, despues } = {}) {
  const registro = []
  const f = async (url, init = {}) => {
    const entrada = { url: String(url), metodo: init.method ?? 'GET', cuerpo: init.body ?? null, cabeceras: { ...(init.headers ?? {}) }, redirect: init.redirect, conSenal: Boolean(init.signal) }
    registro.push(entrada)
    if (antes) { const r = await antes(entrada, registro); if (r) return r }
    const cab = { ...entrada.cabeceras }
    if (cab.origin === REMOTO) cab.origin = ORIGEN // el Worker de pruebas está configurado con su propio origen sintético
    const r = await exports.default.fetch(new Request(entrada.url.replace(REMOTO, ORIGEN), { method: init.method, headers: cab, body: init.body }))
    entrada.status = r.status
    if (despues) return despues(r, entrada, registro)
    return r
  }
  f.registro = registro
  f.posts = () => registro.filter((x) => x.metodo === 'POST')
  return f
}
const redireccion = (status = 302) => new Response(null, { status, headers: { location: 'https://evil.test/captura' } })
const respuestaPerdida = () => (async (r) => { await r.arrayBuffer(); throw new Error('red caida (prueba)') })

function almacenEnMemoria({ fallaEscritura = () => false } = {}) {
  const a = { texto: null, escrituras: 0, historial: [] }
  a.leer = async () => a.texto
  a.escribir = async (t) => { a.escrituras += 1; if (fallaEscritura(a.escrituras, t)) throw new Error('disco lleno (prueba)'); a.texto = t; a.historial.push(t) }
  return a
}
function salidaDeCodigo({ falla = null } = {}) {
  const s = { codigo: null, preparada: 0, guardados: 0, historial: [] }
  s.preparar = async () => { s.preparada += 1; if (falla === 'preparar') throw new Error('sin carpeta (prueba)') }
  s.guardar = async (c) => { s.guardados += 1; if (falla === 'guardar') throw new Error('disco (prueba)'); s.codigo = c; s.historial.push(c) }
  return s
}

const base = (extra = {}) => ({ origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs, token: TOKEN_OPERADOR, ...extra })
const CARGA = (n) => `carga-remota-${String(n).padStart(4, '0')}-zzzz`

function estructuraDe(ligaId, n, nombre = 'Liga Sintetica Remota') {
  return JSON.stringify({ cargaId: CARGA(n), liga: { id: ligaId, nombre, deporte: 'baloncesto' }, equipos: [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }, { id: 'EQ3', nombre: 'Gama' }] })
}
function partidosDe(n, extra = {}) {
  return JSON.stringify({
    cargaId: CARGA(n), minutosPorPeriodo: 8,
    partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-24T09:00:00-05:00' }, { id: 'G2', localId: 'EQ2', visitaId: 'EQ3', programadoPara: '2026-10-24T16:10:00-05:00', ...extra }],
  })
}
const planEstructura = (textos) => construirPlanCarga({ tipo: 'estructura', estructuras: textos })
const planPartidos = (ligaId, texto, estructuras = []) => construirPlanCarga({ tipo: 'partidos', estructuras, partidos: [{ ligaId, texto }] })
const sinSecretos = (valor, secretos) => { const t = typeof valor === 'string' ? valor : JSON.stringify(valor); for (const s of secretos) expect(t).not.toContain(s) }

describe('simulacro (por defecto): valida y resume sin tocar nada', () => {
  it('no hace ninguna petición y el resumen no lleva nombres', async () => {
    const ligaId = nuevaLiga()
    const plan = await planEstructura([estructuraDe(ligaId, 1)])
    expect(plan.ok).toBe(true)
    const resumen = JSON.stringify(resumenDelPlanCarga(plan))
    expect(resumen).toContain(ligaId)
    for (const n of ['Alfa', 'Beta', 'Gama', 'Liga Sintetica Remota']) expect(resumen).not.toContain(n)
    expect(resumenDelPlanCarga(plan).elementos[0]).toMatchObject({ tipo: 'estructura', equipos: 3 })
  })
  it('detecta archivos inválidos antes de cualquier envío', async () => {
    const ligaId = nuevaLiga()
    const malos = [
      ['cargaId corto', JSON.stringify({ ...JSON.parse(estructuraDe(ligaId, 1)), cargaId: 'corto' })],
      ['equipo repetido', JSON.stringify({ ...JSON.parse(estructuraDe(ligaId, 1)), equipos: [{ id: 'A', nombre: 'Uno' }, { id: 'B', nombre: ' uno ' }] })],
      ['no es JSON', '{nada'],
    ]
    for (const [, texto] of malos) expect((await planEstructura([texto])).ok).toBe(false)
    expect((await planPartidos(ligaId, partidosDe(2, { programadoPara: '2026-10-24T16:10:00' }))).ok).toBe(false) // sin zona
    expect((await planPartidos(ligaId, JSON.stringify({ ...JSON.parse(partidosDe(2)), partidos: [{ id: 'X', localId: 'EQ1', visitaId: 'EQ1' }] }))).ok).toBe(false) // mismo equipo
    expect((await planPartidos(ligaId, partidosDe(2), [estructuraDe(ligaId, 1).replace('EQ3', 'EQ9')])).problemas.join()).toContain('equipo-fuera-de-la-estructura')
    expect((await construirPlanOrganizador({ tipo: 'provisionar', nombre: '', ligas: [ligaId] })).ok).toBe(false)
    expect((await construirPlanOrganizador({ tipo: 'provisionar', nombre: 'Org', ligas: [] })).ok).toBe(false)
    expect((await construirPlanOrganizador({ tipo: 'provisionar', nombre: 'Org', ligas: [ligaId, ligaId] })).ok).toBe(false)
  })
})

describe('destino y entorno: nada se envía si el destino o el entorno no son los aprobados', () => {
  it('semabel.com sin opt-in, otro host, puerto, esquema o credenciales: cero peticiones y cero diario', async () => {
    const plan = await planEstructura([estructuraDe(nuevaLiga(), 1)])
    const intentos = [
      { origen: REMOTO, remoto: false }, { origen: 'https://evil.test', remoto: true }, { origen: 'http://semabel.com', remoto: true },
      { origen: 'https://semabel.com:8443', remoto: true }, { origen: 'https://usuario:clave@semabel.com', remoto: true }, { origen: 'https://www.semabel.com', remoto: true },
    ]
    for (const i of intentos) {
      const red = borde(); const almacen = almacenEnMemoria()
      const r = await aplicarCarga({ ...base(i), plan, almacen, fetch: red })
      expect(r.estado, i.origen).toMatch(/^origen-/)
      expect(red.registro).toHaveLength(0)
      expect(almacen.escrituras).toBe(0)
    }
  })
  it('TLS desactivado o CA adicional con destino remoto: no se ejecuta; en loopback sí se permite', async () => {
    const plan = await planEstructura([estructuraDe(nuevaLiga(), 1)])
    for (const [entorno, esperado] of [[{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'tls-verificacion-desactivada'], [{ NODE_EXTRA_CA_CERTS: '/x.pem' }, 'ca-adicional-no-permitida']]) {
      const red = borde(); const almacen = almacenEnMemoria()
      expect(await aplicarCarga({ ...base({ entorno }), plan, almacen, fetch: red })).toEqual({ estado: esperado })
      expect(red.registro).toHaveLength(0); expect(almacen.escrituras).toBe(0)
      const v = await verificarCarga({ estructuras: [estructuraDe('LIGA1', 1)], fetch: red, origen: REMOTO, remoto: true, entorno })
      expect(v.ok).toBe(false); expect(v.comprobaciones[0].codigo).toBe(esperado); expect(red.registro).toHaveLength(0)
    }
  })
  it('tiempo fuera de rango, token ausente o corto: no se envía nada', async () => {
    const plan = await planEstructura([estructuraDe(nuevaLiga(), 1)])
    for (const [extra, esperado] of [[{ tiempoMs: 5 }, 'tiempo-invalido'], [{ token: undefined }, 'sin-credencial'], [{ token: 'corto' }, 'sin-credencial']]) {
      const red = borde(); const almacen = almacenEnMemoria()
      expect((await aplicarCarga({ ...base(extra), plan, almacen, fetch: red })).estado).toBe(esperado)
      expect(red.registro).toHaveLength(0); expect(almacen.escrituras).toBe(0)
    }
  })
})

describe('estructura y partidos: carga remota simulada, lotes separados, idempotencia y lectura de comprobación', () => {
  it('estructura → partidos → verificar; repetir con el mismo diario no envía nada y con diario nuevo reproduce sin duplicar', async () => {
    const ligaId = nuevaLiga()
    const est = estructuraDe(ligaId, 10); const par = partidosDe(11)
    const red = borde()
    const dE = almacenEnMemoria(); const dP = almacenEnMemoria()
    const pE = await planEstructura([est]); const pP = await planPartidos(ligaId, par, [est])
    expect(await aplicarCarga({ ...base(), plan: pE, almacen: dE, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 1, reproducidas: 0 })
    expect(await aplicarCarga({ ...base(), plan: pP, almacen: dP, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 1 })
    // Todas las peticiones fueron al origen aprobado, sin seguir redirecciones y con tiempo máximo; los lotes van separados.
    expect(red.registro.every((x) => x.url.startsWith(`${REMOTO}/v1/`) && x.redirect === 'manual' && x.conSenal)).toBe(true)
    expect(red.posts().map((x) => x.url.replace(REMOTO, ''))).toEqual([`/v1/admin/ligas/${ligaId}/estructura`, `/v1/admin/ligas/${ligaId}/partidos`])
    const v = await verificarCarga({ estructuras: [est], partidos: [{ ligaId, texto: par }], fetch: red, origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })
    expect(v.comprobaciones.filter((c) => !c.ok)).toEqual([])
    expect(v.ok).toBe(true)
    expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 3 }])
    // Mismo diario: nada nuevo.
    const antes = red.posts().length
    expect(await aplicarCarga({ ...base(), plan: pE, almacen: dE, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 0, reproducidas: 0 })
    expect(red.posts()).toHaveLength(antes)
    // Diario NUEVO con el mismo cargaId y contenido: el servidor reproduce, sin escrituras ni duplicados.
    expect(await aplicarCarga({ ...base(), plan: pE, almacen: almacenEnMemoria(), fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 0, reproducidas: 1 })
    expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 3 }])
  })

  it('un conflicto (mismo cargaId con otro contenido, o liga ya cargada) se rechaza y el diario se niega a seguir', async () => {
    const ligaId = nuevaLiga()
    const red = borde()
    expect((await aplicarCarga({ ...base(), plan: await planEstructura([estructuraDe(ligaId, 20)]), almacen: almacenEnMemoria(), fetch: red })).estado).toBe('completo')
    const otra = await planEstructura([estructuraDe(ligaId, 20, 'Otro nombre')])
    const d = almacenEnMemoria()
    expect(await aplicarCarga({ ...base(), plan: otra, almacen: d, fetch: red })).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'carga-conflicto' })
    const posts = red.posts().length
    expect(await aplicarCarga({ ...base(), plan: otra, almacen: d, fetch: red })).toMatchObject({ estado: 'diario-con-rechazo' })
    expect(red.posts()).toHaveLength(posts)
  })

  it('un diario de otro plan o de otro destino (local) no se reutiliza: cero peticiones', async () => {
    const ligaId = nuevaLiga()
    const plan = await planEstructura([estructuraDe(ligaId, 30)])
    const local = almacenEnMemoria()
    const redLocal = borde()
    // El diario «local» lo escribe el mismo código con un destino loopback.
    await aplicarCarga({ plan, almacen: local, fetch: async (u, i) => redLocal(String(u).replace('http://127.0.0.1:8787', REMOTO), i), origen: 'http://127.0.0.1:8787', remoto: false, entorno: {}, tiempoMs, token: TOKEN_OPERADOR })
    expect(JSON.parse(local.texto).destino.origen).toBe('http://127.0.0.1:8787')
    const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: local, fetch: red })).toEqual({ estado: 'diario-de-otro-plan' })
    expect(red.registro).toHaveLength(0)
  })

  it('si el archivo de carga cambia después de guardar el diario, no se envía nada («payload distinto del diario»)', async () => {
    const ligaId = nuevaLiga()
    const d = almacenEnMemoria()
    const plan = await planEstructura([estructuraDe(ligaId, 40)])
    await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde({ antes: () => { throw new Error('red caida') } }) }) // queda incierta
    const distinto = await planEstructura([estructuraDe(ligaId, 40).replace('Gama', 'Gamma')])
    const red = borde()
    // Mismo cargaId y otro contenido: distinta huella de plan → «de otro plan»; el cuerpo guardado en el diario es el que manda.
    expect((await aplicarCarga({ ...base(), plan: distinto, almacen: d, fetch: red })).estado).toMatch(/^(diario-de-otro-plan|payload-distinto-del-diario)$/)
    expect(red.registro).toHaveLength(0)
  })
})

describe('resultado incierto: solo se reintenta lo idéntico', () => {
  it('respuesta perdida: la carga SÍ se aplicó; el reintento reenvía el MISMO cuerpo y cargaId; el servidor reproduce sin duplicar', async () => {
    const ligaId = nuevaLiga()
    const plan = await planEstructura([estructuraDe(ligaId, 50)])
    const d = almacenEnMemoria()
    const r1 = await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde({ despues: respuestaPerdida() }) })
    expect(r1).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-0' })
    expect(JSON.parse(d.texto).ops[0]).toMatchObject({ estado: 'incierta' })
    expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 3 }]) // sí llegó
    const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', reproducidas: 1 })
    expect(red.posts()).toHaveLength(1)
    expect(red.posts()[0].cuerpo).toBe(JSON.parse(d.historial[0]).ops[0].cuerpo) // idéntico al guardado ANTES de enviar
    expect(JSON.parse(red.posts()[0].cuerpo).cargaId).toBe(CARGA(50))
    expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 3 }])
  })
  it('redirección en una mutación: se rechaza, no se sigue (una sola petición, nada hacia evil.test) y queda incierta', async () => {
    const ligaId = nuevaLiga()
    const plan = await planEstructura([estructuraDe(ligaId, 51)])
    const d = almacenEnMemoria()
    const red = borde({ antes: () => redireccion(307) })
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-0' })
    expect(red.registro).toHaveLength(1)
    expect(red.registro.every((x) => x.url.startsWith(REMOTO))).toBe(true)
    expect(JSON.parse(d.texto).ops[0].estado).toBe('incierta')
  })
  it('tiempo agotado: queda incierta y el reintento es idéntico', async () => {
    const ligaId = nuevaLiga()
    const plan = await planEstructura([estructuraDe(ligaId, 52)])
    const d = almacenEnMemoria()
    const colgado = borde({ antes: (e) => new Promise(() => {}) }) // nunca responde
    const fAbortable = async (u, init) => { const p = colgado(u, init); return Promise.race([p, new Promise((_, rj) => init.signal.addEventListener('abort', () => rj(new Error('tiempo')))) ]) }
    expect(await aplicarCarga({ ...base({ tiempoMs: 1000 }), plan, almacen: d, fetch: fAbortable })).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-0' })
    const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 1 })
  }, 10000)
  it('401 (token incorrecto), 404 (puerta cerrada simulada) y 503: incierta, sin cambiar el identificador', async () => {
    for (const forzado of [401, 404, 503]) {
      const ligaId = nuevaLiga()
      const plan = await planEstructura([estructuraDe(ligaId, 60 + forzado)])
      const d = almacenEnMemoria()
      const r = await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde({ antes: () => new Response('{"error":"x"}', { status: forzado }) }) })
      expect(r).toMatchObject({ estado: 'detenido-sin-resolver', motivo: `http-${forzado}` })
      const red = borde()
      expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', aplicadas: 1 })
      expect(JSON.parse(red.posts()[0].cuerpo).cargaId).toBe(CARGA(60 + forzado))
    }
  })
  it('un token incorrecto real da 401 y no escribe nada', async () => {
    const ligaId = nuevaLiga()
    const red = borde()
    const r = await aplicarCarga({ ...base({ token: `${TOKEN_OPERADOR}-incorrecto` }), plan: await planEstructura([estructuraDe(ligaId, 70)]), almacen: almacenEnMemoria(), fetch: red })
    expect(r).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-401' })
    expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 0 }])
  })
})

describe('el diario va primero', () => {
  it('si el diario inicial no se puede guardar, NO se envía nada', async () => {
    const red = borde()
    const r = await aplicarCarga({ ...base(), plan: await planEstructura([estructuraDe(nuevaLiga(), 80)]), almacen: almacenEnMemoria({ fallaEscritura: () => true }), fetch: red })
    expect(r.estado).toBe('diario-no-guardado'); expect(red.registro).toHaveLength(0)
  })
  it('si no se puede anotar «enviando», esa carga no se envía', async () => {
    const red = borde()
    const r = await aplicarCarga({ ...base(), plan: await planEstructura([estructuraDe(nuevaLiga(), 81)]), almacen: almacenEnMemoria({ fallaEscritura: (n) => n === 2 }), fetch: red })
    expect(r.estado).toBe('diario-no-guardado'); expect(red.registro).toHaveLength(0)
  })
  it('si falla guardar el RESULTADO, la carga queda «enviando» y su reintento es idéntico y sin duplicar', async () => {
    const ligaId = nuevaLiga()
    const plan = await planEstructura([estructuraDe(ligaId, 82)])
    const d = almacenEnMemoria({ fallaEscritura: (n) => n === 3 })
    const r = await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde() })
    expect(r.estado).toBe('diario-no-guardado')
    expect(JSON.parse(d.texto).ops[0].estado).toBe('enviando')
    d.escribir = (async (t) => { d.texto = t })
    const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red })).toMatchObject({ estado: 'completo', reproducidas: 1 })
    expect(await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM equipos')).toEqual([{ n: 3 }])
  })
})

describe('verificar: lectura de comprobación (solo GET públicos)', () => {
  async function cargada() {
    const ligaId = nuevaLiga(); const est = estructuraDe(ligaId, 90); const par = partidosDe(91)
    const red = borde()
    await aplicarCarga({ ...base(), plan: await planEstructura([est]), almacen: almacenEnMemoria(), fetch: red })
    await aplicarCarga({ ...base(), plan: await planPartidos(ligaId, par, [est]), almacen: almacenEnMemoria(), fetch: red })
    return { ligaId, est, par }
  }
  const ver = (e, fetch) => verificarCarga({ estructuras: [e.est], partidos: [{ ligaId: e.ligaId, texto: e.par }], fetch, origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })
  it('solo hace GET, sin credenciales', async () => {
    const e = await cargada(); const red = borde()
    expect((await ver(e, red)).ok).toBe(true)
    expect(red.registro.every((x) => x.metodo === 'GET' && !x.cabeceras.authorization && !x.cabeceras.cookie)).toBe(true)
  })
  it('detecta una hora distinta, una sede inesperada, un partido ausente o extra, y un equipo de más', async () => {
    const e = await cargada()
    const v1 = await verificarCarga({ estructuras: [e.est], partidos: [{ ligaId: e.ligaId, texto: partidosDe(91).replace('09:00:00-05:00', '10:00:00-05:00') }], fetch: borde(), origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })
    expect(v1.ok).toBe(false); expect(JSON.stringify(v1.comprobaciones)).toContain('G1:hora')
    const v2 = await verificarCarga({ estructuras: [e.est], partidos: [{ ligaId: e.ligaId, texto: partidosDe(91, { sede: 'Cancha X' }) }], fetch: borde(), origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })
    expect(JSON.stringify(v2.comprobaciones)).toContain('G2:sede')
    const unoSolo = JSON.stringify({ ...JSON.parse(partidosDe(91)), partidos: JSON.parse(partidosDe(91)).partidos.slice(0, 1) })
    const v3 = await verificarCarga({ estructuras: [e.est], partidos: [{ ligaId: e.ligaId, texto: unoSolo }], fetch: borde(), origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })
    expect(v3.ok).toBe(false)
    const menos = e.est.replace(',{"id":"EQ3","nombre":"Gama"}', '')
    const v4 = await verificarCarga({ estructuras: [menos], fetch: borde(), origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })
    expect(JSON.stringify(v4.comprobaciones)).toContain('equipos-exactos')
    expect(v4.ok).toBe(false)
  })
  it('un campo privado, un estado distinto de «programado» o una redirección hacen fallar la comprobación', async () => {
    const e = await cargada()
    const alterada = (cambio) => borde({ despues: async (r) => { const j = await r.json(); cambio(j); return new Response(JSON.stringify(j), { status: 200 }) } })
    expect((await ver(e, alterada((j) => { j.equipos[0].personaId = 'p-1' }))).ok).toBe(false)
    expect((await ver(e, alterada((j) => { j.partidos[0].estado = 'en-juego' }))).ok).toBe(false)
    const redir = borde({ antes: () => redireccion() })
    const v = await ver(e, redir)
    expect(v.ok).toBe(false); expect(redir.registro).toHaveLength(1)
  })
  it('un diario con operaciones sin aplicar hace fallar la comprobación opcional', async () => {
    const e = await cargada(); const d = almacenEnMemoria()
    await aplicarCarga({ ...base(), plan: await planEstructura([estructuraDe(nuevaLiga(), 92)]), almacen: d, fetch: borde({ antes: () => { throw new Error('x') } }) })
    const v = await verificarCarga({ estructuras: [e.est], partidos: [{ ligaId: e.ligaId, texto: e.par }], fetch: borde(), origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs, almacen: d })
    expect(v.comprobaciones.find((c) => c.codigo === 'diario-todo-aplicado').ok).toBe(false)
  })
})

describe('organizador: provisión y recuperación sin reprovisionar ni rotar a ciegas', () => {
  const ligasDe = () => [nuevaLiga(), nuevaLiga()]
  const planProv = (ligas) => construirPlanOrganizador({ tipo: 'provisionar', nombre: 'Organizador Sintetico', ligas })
  const planRec = () => construirPlanOrganizador({ tipo: 'recuperar' })
  const entrar = async (codigo) => (await iniciarSesion(codigo)).status

  it('provisiona, guarda el código SOLO en la salida privada y nada lo contiene (diario, resultado, direcciones, peticiones del diario)', async () => {
    await reiniciarAcceso(T0)
    const ligas = ligasDe(); const d = almacenEnMemoria(); const s = salidaDeCodigo(); const red = borde()
    const r = await aplicarCarga({ ...base(), plan: await planProv(ligas), almacen: d, fetch: red, salidaDeCodigo: s })
    expect(r).toMatchObject({ estado: 'completo', aplicadas: 1 })
    expect(s.preparada).toBe(1); expect(s.guardados).toBe(1)
    expect(await entrar(s.codigo)).toBe(200) // el código guardado funciona
    sinSecretos(r, [s.codigo, TOKEN_OPERADOR]); sinSecretos(d.historial.join('\n'), [s.codigo, TOKEN_OPERADOR])
    for (const x of red.registro) sinSecretos(x.url, [s.codigo, TOKEN_OPERADOR])
    expect(JSON.parse(d.texto).ops[0].resultado).toMatchObject({ status: 201 })
    expect(Object.keys(JSON.parse(d.texto).ops[0].resultado)).not.toContain('codigo')
  })
  it('la salida del código se prepara ANTES de enviar: si no está disponible, no se envía nada', async () => {
    await reiniciarAcceso(T0)
    const red = borde(); const d = almacenEnMemoria()
    expect(await aplicarCarga({ ...base(), plan: await planProv(ligasDe()), almacen: d, fetch: red, salidaDeCodigo: salidaDeCodigo({ falla: 'preparar' }) })).toEqual({ estado: 'salida-de-codigo-no-disponible' })
    expect(red.registro).toHaveLength(0); expect(d.escrituras).toBe(0)
    expect(await aplicarCarga({ ...base(), plan: await planProv(ligasDe()), almacen: almacenEnMemoria(), fetch: red })).toEqual({ estado: 'sin-salida-de-codigo' })
  })
  it('respuesta perdida: el reenvío idéntico da 409, NO crea otro organizador, NO emite código y NO rota nada solo', async () => {
    await reiniciarAcceso(T0)
    const ligas = ligasDe(); const plan = await planProv(ligas); const d = almacenEnMemoria(); const s = salidaDeCodigo()
    const r1 = await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde({ despues: respuestaPerdida() }), salidaDeCodigo: s })
    expect(r1).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-0' })
    expect(s.guardados).toBe(0)
    const red = borde()
    const r2 = await aplicarCarga({ ...base(), plan, almacen: d, fetch: red, salidaDeCodigo: s })
    expect(r2).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'organizador-existente', aviso: 'organizador-existente-tras-respuesta-incierta' })
    expect(red.posts().map((x) => x.url.replace(REMOTO, ''))).toEqual(['/v1/admin/organizador'])
    expect(red.registro.some((x) => x.url.includes('rotar'))).toBe(false)
    expect(s.guardados).toBe(0)
    expect(JSON.parse(d.texto).ops[0].resultado).toMatchObject({ error: 'organizador-existente', trasEnvioIncierto: true })
    // Y el diario se niega a seguir hasta una decisión explícita.
    expect((await aplicarCarga({ ...base(), plan, almacen: d, fetch: red, salidaDeCodigo: s })).estado).toBe('diario-con-rechazo')
  })
  it('recuperar: sin confirmación no hace nada; con ella emite OTRO código, revoca el anterior y lo guarda en una salida nueva', async () => {
    await reiniciarAcceso(T0)
    const ligas = ligasDe(); const s1 = salidaDeCodigo()
    await aplicarCarga({ ...base(), plan: await planProv(ligas), almacen: almacenEnMemoria(), fetch: borde(), salidaDeCodigo: s1 })
    const plan = await planRec(); const s2 = salidaDeCodigo(); const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: almacenEnMemoria(), fetch: red, salidaDeCodigo: s2 })).toEqual({ estado: 'rotacion-sin-confirmar' })
    expect(red.registro).toHaveLength(0)
    expect(await aplicarCarga({ ...base(), plan, almacen: almacenEnMemoria(), fetch: red, salidaDeCodigo: s2, confirmaciones: new Set(['rotacion']) })).toMatchObject({ estado: 'completo', aplicadas: 1 })
    expect(s2.codigo).toBeTruthy(); expect(s2.codigo).not.toBe(s1.codigo)
    expect(await entrar(s1.codigo)).toBe(401) // el anterior quedó revocado
    expect(await entrar(s2.codigo)).toBe(200)
  })
  it('rotación incierta: reintentar exige una segunda confirmación explícita (otro código nuevo; no es idempotente)', async () => {
    await reiniciarAcceso(T0)
    await aplicarCarga({ ...base(), plan: await planProv(ligasDe()), almacen: almacenEnMemoria(), fetch: borde(), salidaDeCodigo: salidaDeCodigo() })
    const plan = await planRec(); const d = almacenEnMemoria(); const s = salidaDeCodigo()
    const conf = new Set(['rotacion'])
    expect((await aplicarCarga({ ...base(), plan, almacen: d, fetch: borde({ despues: respuestaPerdida() }), salidaDeCodigo: s, confirmaciones: conf })).estado).toBe('detenido-sin-resolver')
    const red = borde()
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red, salidaDeCodigo: s, confirmaciones: conf })).toMatchObject({ estado: 'rotacion-incierta-requiere-confirmacion' })
    expect(red.registro).toHaveLength(0)
    expect(await aplicarCarga({ ...base(), plan, almacen: d, fetch: red, salidaDeCodigo: s, confirmaciones: new Set(['rotacion', 'rotacion-repetida']) })).toMatchObject({ estado: 'completo' })
    expect(await entrar(s.codigo)).toBe(200)
  })
  it('si el código llega pero no se puede guardar: se anota sin el código, se detiene y la recuperación es el comando explícito', async () => {
    await reiniciarAcceso(T0)
    const d = almacenEnMemoria(); const s = salidaDeCodigo({ falla: 'guardar' })
    const r = await aplicarCarga({ ...base(), plan: await planProv(ligasDe()), almacen: d, fetch: borde(), salidaDeCodigo: s })
    expect(r).toMatchObject({ estado: 'codigo-no-guardado' })
    expect(JSON.parse(d.texto).ops[0].estado).toBe('codigo-no-guardado')
    sinSecretos(d.historial.join('\n'), ['codigo":"'])
    expect(s.codigo).toBeNull()
    // Reanudar con ese diario NO reprovisiona: nada pendiente que enviar ni «sin resolver».
    const red = borde()
    expect((await aplicarCarga({ ...base(), plan: await planProv(JSON.parse(d.texto).ops[0].cuerpo ? JSON.parse(JSON.parse(d.texto).ops[0].cuerpo).ligas : []), almacen: d, fetch: red, salidaDeCodigo: salidaDeCodigo() })).estado).toBe('completo')
    expect(red.registro).toHaveLength(0)
  })
  it('un organizador ya existente (sin envío previo incierto) se informa como tal y no se toca', async () => {
    await reiniciarAcceso(T0)
    await aplicarCarga({ ...base(), plan: await planProv(ligasDe()), almacen: almacenEnMemoria(), fetch: borde(), salidaDeCodigo: salidaDeCodigo() })
    const r = await aplicarCarga({ ...base(), plan: await planProv(ligasDe()), almacen: almacenEnMemoria(), fetch: borde(), salidaDeCodigo: salidaDeCodigo() })
    expect(r).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'organizador-existente', aviso: 'organizador-existente' })
  })
  it('una liga no admitida en la provisión se rechaza (422) y el diario se niega a seguir', async () => {
    await reiniciarAcceso(T0)
    const r = await aplicarCarga({ ...base(), plan: await planProv(['NO-ADMITIDA-XYZ']), almacen: almacenEnMemoria(), fetch: borde(), salidaDeCodigo: salidaDeCodigo() })
    expect(r).toMatchObject({ estado: 'detenido-por-rechazo' })
  })
})

describe('extremo a extremo SINTÉTICO en el orden de producción, con destino remoto simulado', () => {
  it('provisión → estructura → plantillas (ejecutor existente, --remoto) → partidos → lecturas → verificación', async () => {
    await reiniciarAcceso(T0)
    const ligaId = nuevaLiga(); const est = estructuraDe(ligaId, 100, 'Liga Sintetica Runner'); const par = partidosDe(101)
    const red = borde(); const s = salidaDeCodigo()
    expect((await aplicarCarga({ ...base(), plan: await planProv2([ligaId]), almacen: almacenEnMemoria(), fetch: red, salidaDeCodigo: s })).estado).toBe('completo')
    expect((await aplicarCarga({ ...base(), plan: await planEstructura([est]), almacen: almacenEnMemoria(), fetch: red })).estado).toBe('completo')
    // Plantillas con el ejecutor existente.
    const paquete = paqueteMinimo('Liga Sintetica Runner')
    const texto = JSON.stringify(paquete)
    const mapeo = { version: 1, paqueteSha256: await sha256Hex(texto), ligas: { 'Liga Sintetica Runner': { ligaId, equipos: { 'S/ALFA': 'EQ1' } } }, identidades: Object.fromEntries(paquete.teams[0].rows.map((r) => [r.source_ref, { tipo: 'otra-persona' }])) }
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    expect(plan.ok).toBe(true)
    const diarioR = almacenEnMemoria()
    const comun = { plan, almacen: diarioR, fetch: red, origen: REMOTO, accesoOrigen: REMOTO, codigo: s.codigo, remoto: true, entorno: ENTORNO_BUENO, tiempoMs }
    expect(await aplicar(comun)).toMatchObject({ estado: 'completo', aplicadas: 2 })
    expect((await verificar(comun)).ok).toBe(true)
    expect(JSON.parse(diarioR.texto).destino.origen).toBe(REMOTO)
    sinSecretos(diarioR.historial.join('\n'), [s.codigo, TOKEN_OPERADOR])
    for (const x of red.registro) { sinSecretos(x.url, [s.codigo, TOKEN_OPERADOR]); expect(x.redirect).toBe('manual'); expect(x.url.startsWith(REMOTO)).toBe(true) }
    expect((await aplicarCarga({ ...base(), plan: await planPartidos(ligaId, par, [est]), almacen: almacenEnMemoria(), fetch: red })).estado).toBe('completo')
    expect((await verificarCarga({ estructuras: [est], partidos: [{ ligaId, texto: par }], fetch: red, origen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs })).ok).toBe(true)
  })
})

describe('ejecutor de plantillas: destino remoto aprobado', () => {
  async function entorno() {
    await reiniciarAcceso(T0)
    const ligaId = nuevaLiga(); const est = estructuraDe(ligaId, 110, 'Liga Sintetica Runner'); const red = borde(); const s = salidaDeCodigo()
    await aplicarCarga({ ...base(), plan: await planProv2([ligaId]), almacen: almacenEnMemoria(), fetch: red, salidaDeCodigo: s })
    await aplicarCarga({ ...base(), plan: await planEstructura([est]), almacen: almacenEnMemoria(), fetch: red })
    const paquete = paqueteMinimo('Liga Sintetica Runner'); const texto = JSON.stringify(paquete)
    const mapeo = { version: 1, paqueteSha256: await sha256Hex(texto), ligas: { 'Liga Sintetica Runner': { ligaId, equipos: { 'S/ALFA': 'EQ1' } } }, identidades: Object.fromEntries(paquete.teams[0].rows.map((r) => [r.source_ref, { tipo: 'otra-persona' }])) }
    return { plan: await construirPlan({ paqueteTexto: texto, mapeo }), codigo: s.codigo }
  }
  const comunes = (e, extra) => ({ plan: e.plan, almacen: almacenEnMemoria(), codigo: e.codigo, origen: REMOTO, accesoOrigen: REMOTO, remoto: true, entorno: ENTORNO_BUENO, tiempoMs, ...extra })

  it('sin opt-in, con acceso-origen distinto, con TLS desactivado o con CA adicional: cero peticiones y cero diario', async () => {
    const e = await entorno()
    for (const [extra, esperado] of [
      [{ remoto: false }, 'origen-no-local'], [{ accesoOrigen: 'https://backend.local' }, 'acceso-origen-distinto-del-destino'],
      [{ entorno: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } }, 'tls-verificacion-desactivada'], [{ entorno: { NODE_EXTRA_CA_CERTS: '/x' } }, 'ca-adicional-no-permitida'],
      [{ origen: 'https://evil.test' }, 'origen-remoto-no-aprobado'], [{ tiempoMs: 1 }, 'tiempo-invalido'],
    ]) {
      const red = borde(); const c = comunes(e, { ...extra, fetch: red })
      expect((await aplicar(c)).estado, esperado).toBe(esperado)
      expect(red.registro).toHaveLength(0); expect(c.almacen.escrituras ?? 0).toBe(0)
      expect((await verificar(c)).comprobaciones[0].codigo).toBe(esperado)
    }
  })
  it('una redirección en el INICIO DE SESIÓN no se sigue: una sola petición, el código no sale hacia otro origen', async () => {
    const e = await entorno(); const red = borde({ antes: () => redireccion(302) }); const c = comunes(e, { fetch: red })
    expect(await aplicar(c)).toEqual({ estado: 'sesion-no-iniciada' })
    expect(red.registro).toHaveLength(1); expect(red.registro[0].url).toBe(`${REMOTO}/v1/acceso/organizador`)
    expect(c.almacen.escrituras).toBe(0)
  })
  it('una redirección en una alta: queda incierta (mismo cuerpo e identificador al reintentar) y no se reenvía nada a otro origen', async () => {
    const e = await entorno()
    const red = borde({ antes: (x) => (x.url.endsWith('/jugadores') ? redireccion(308) : null) }); const c = comunes(e, { fetch: red })
    const r = await aplicar(c)
    expect(r).toMatchObject({ estado: 'detenido-sin-resolver', motivo: 'http-0' })
    expect(red.registro.every((x) => x.url.startsWith(REMOTO))).toBe(true)
    const op = JSON.parse(c.almacen.texto).ops.find((o) => o.estado === 'incierta')
    const red2 = borde()
    expect(await aplicar({ ...c, fetch: red2 })).toMatchObject({ estado: 'completo' })
    expect(red2.posts().find((x) => x.url.endsWith('/jugadores')).cuerpo).toBe(op.cuerpo)
  })
  it('un diario creado para un destino local no se reutiliza en remoto', async () => {
    const e = await entorno()
    const c = comunes(e, { fetch: borde() })
    const d = JSON.parse(JSON.stringify({ version: 1 }))
    const redL = borde()
    const local = almacenEnMemoria()
    await aplicar({ plan: e.plan, almacen: local, fetch: async (u, i) => redL(String(u).replace('http://127.0.0.1:8787', REMOTO), i), origen: 'http://127.0.0.1:8787', accesoOrigen: ORIGEN, codigo: 'x'.repeat(20) }).catch(() => null)
    local.texto ??= JSON.stringify({ ...d, huellaDelPlan: e.plan.huella, destino: { origen: 'http://127.0.0.1:8787' }, ops: [] })
    const red = borde()
    expect(await aplicar({ ...c, almacen: local, fetch: red })).toEqual({ estado: 'diario-de-otro-plan' })
    expect(red.registro).toHaveLength(0)
  })
})

// ---- auxiliares de esta suite ----
const planProv2 = (ligas) => construirPlanOrganizador({ tipo: 'provisionar', nombre: 'Organizador Sintetico', ligas })
function paqueteMinimo(ligaNombre) {
  const fila = (n, nombre, apellido, jersey) => ({
    source_ref: `S/ALFA#p1r${n}`, league: ligaNombre, team: 'Equipo S/ALFA', source_file: 'sintetico.pdf', source_sha256: 'a'.repeat(64), page: 1, row: n,
    source_text: `${nombre} ${apellido} ${jersey}`, source_jersey_text: String(jersey), first_name: nombre, surname: apellido, name_split: { estado: 'ok', regla: 'primera-palabra' },
    jersey, status: 'ready', hold_reasons: [], explicit_user_decisions: [], notes: [],
  })
  const rows = [fila(1, 'Ana', 'Prueba', 7), fila(2, 'Beto', 'Muestra', 9)]
  return {
    package: { name: 'sintetico', status: 'preparation-only' }, totals: { candidates: 2, ready: 2, held: 0, jersey_missing: 0 },
    teams: [{ team_key: 'S/ALFA', team_display_name: 'Alfa', source_file: {}, direct_verification: [], supplied_history: [], counts: { candidates: 2, ready: 2, held: 0 }, rows, excluded_rows: [], skipped_source_rows: [] }],
  }
}
