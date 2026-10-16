import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { preparacionIntegra } from '../../src/lib/motor/preparacion.js'
import { crearAtribucion } from '../../src/lib/motor/atribucion.js'
import { ordenDeInicio, evaluarInicio, huellaDeRecibo, recortarRecibo } from '../../src/lib/control/sesion-motor.js'
import { aplicarRecibo, abrirAlmacen, crearSesion, encolar, leerSesion, marcarEnviando, reanudarSesion, refrescarAntesDelInicioDeSesion, registrarParadaDeTransporte, verificarInstantanea } from '../../src/lib/control/sesion-almacen.js'
import { construirSesion } from '../../src/lib/control/sesion-motor.js'
import { crearOrden } from '../../src/lib/control/reloj-telefono.js'
import { tokenDe } from './fixtures/sintetico.js'
import { leerEstado, postComando } from './ayuda.js'
import { control, T0 } from './ayuda-acceso.js'
import { accion, alta, campos, escenarioPlantilla } from './ayuda-plantilla.js'

// REPORT_120, experimento 2: el núcleo S1a (REAL, con su almacén sobre fake-indexeddb DENTRO de workerd) frente a las rutas
// REALES del Worker. Datos sintéticos desechables. Nada se arregla en producción ni se debilita una aserción: si algo no
// encaja, la prueba falla y el fallo es el hallazgo.

const BASE = 'https://backend.local'
afterEach(() => { control.ahoraMs = null; control.limitesEstado = null })

const leerPrep = (ligaId, juego, token) => exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/partidos/${juego}/preparacion`, { headers: { authorization: `Bearer ${token}` } }))
const ver = async (r) => { const texto = await r.text(); let cuerpo = null; try { cuerpo = JSON.parse(texto) } catch { /* sin JSON */ } return { status: r.status, texto, cuerpo, cabeceras: r.headers } }
const claves = (o) => Object.keys(o).sort()

// Hora del SERVIDOR sintético (control.ahoraMs): fija, para que los límites de tiempo sean deterministas.
const SERVIDOR = T0 + 10_000_000
let n = 0
let c = 0
const cmd = (p = 'c') => `${p}-compat-${++c}`

async function telefono(e, { juego = 'P' } = {}) {
  const ligaId = e.ligaId
  const token = tokenDe(ligaId, juego)
  const almacen = await abrirAlmacen({ nombre: `compat-http-${++n}-${Math.random().toString(36).slice(2)}` })
  const id = `${ligaId}:${juego}`
  control.ahoraMs = SERVIDOR
  const t = {
    ligaId, juego, token, almacen, id, revision: 0, ahora: SERVIDOR,
    ctx: (x = {}) => ({ ahoraEstimado: t.ahora, actorId: 'compat', enLinea: true, ahora: t.ahora, ...x }),
    nota(r) { if (r?.vista) t.revision = r.vista.revision; return r },
    estado: async () => ver(await leerEstado(ligaId, juego, token)),
    prep: async () => ver(await leerPrep(ligaId, juego, token)),
    async hidratar() {
      const est = await t.estado()
      const s = construirSesion({ ligaId, partidoId: juego, cuerpoEstado: est.cuerpo })
      if (!s.ok) return { est, construir: s }
      return { est, construir: s, creada: t.nota(await crearSesion(almacen, s.sesion)) }
    },
    leer: async () => { const r = await leerSesion(almacen, id, t.ctx()); if (r.ok) t.revision = r.sesion.revision; return r },
    encolar: async (orden, ctx = t.ctx()) => t.nota(await encolar(almacen, { id, revision: t.revision, orden, ctx })),
    /** Marca, envía el texto EXACTO guardado al Worker real y deja la respuesta cruda sin interpretar. */
    async enviar() {
      const l = await t.leer()
      const primera = l.entradas.find((f) => f.estado === 'pendiente' || f.estado === 'enviando')
      if (!primera) return { nada: true }
      const m = t.nota(await marcarEnviando(almacen, { id, revision: t.revision, cmdId: primera.cmdId, ctx: t.ctx() }))
      if (!m.ok) return { marcar: m }
      const r = await ver(await postComando(ligaId, juego, token, null, { crudo: m.cuerpoJson }))
      return { marcar: m, http: r, cuerpoJson: m.cuerpoJson, cmdId: primera.cmdId }
    },
    async aplicar(http) {
      return t.nota(await aplicarRecibo(almacen, { id, revision: t.revision, recibo: http.cuerpo.recibo, ctx: t.ctx() }))
    },
    async enviarYAplicar() {
      const s = await t.enviar()
      if (s.nada || !s.http || s.http.status !== 200) return s
      return { ...s, aplicado: await t.aplicar(s.http) }
    },
    async verificar() {
      const est = await t.estado()
      return { est, v: t.nota(await verificarInstantanea(almacen, { id, revision: t.revision, cuerpoEstado: est.cuerpo, ctx: t.ctx() })) }
    },
    tiempo: (accionTs, extra = {}) => ({ accionTs, accionTsCrudo: accionTs, ajusteTsMs: 0, discontinuidad: null, ...extra }),
    orden: (tipo, datos, accionTs, extra = {}) => ({ cmdId: cmd(tipo.slice(0, 3)), tipo, datos, tiempo: t.tiempo(accionTs), ...extra }),
  }
  return t
}

/** Inicio aceptado por el Worker real, con el núcleo S1a. */
async function conInicio(e) {
  const t = await telefono(e)
  const h = await t.hidratar()
  expect(h.creada?.ok, JSON.stringify(h.construir)).toBe(true)
  const p = await t.prep()
  expect(p.status).toBe(200)
  const l = await t.leer()
  const g = evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: [], preparacion: p.cuerpo.preparacion })
  expect(g, JSON.stringify(g)).toEqual({ puede: true })
  const o = ordenDeInicio({ cmdId: cmd('ini'), preparacion: p.cuerpo.preparacion, tiempo: t.tiempo(SERVIDOR - 1000), sesion: l.sesion })
  const enc = await t.encolar(o.orden)
  expect(enc.ok, JSON.stringify(enc)).toBe(true)
  const s = await t.enviarYAplicar()
  return { t, s, orden: o.orden, prep: p.cuerpo.preparacion }
}

const CLAVES_RECIBO = ['accionTs', 'advertencias', 'clientSeq', 'cmdId', 'contenido', 'deviceId', 'gameId', 'meta', 'refs', 'resultado', 'revDespues']
const CLAVES_RECIBO_RECHAZADO = [...CLAVES_RECIBO, 'detalle', 'motivo'].sort()
const CLAVES_META = ['advertenciasRecepcion', 'recibidoEn', 'versionMotor']
const CLAVES_REFS = ['auditoria', 'eventosNuevos', 'eventosActualizados'].sort()

describe('E2a — hidratación: la respuesta REAL de /estado construye la sesión S1a', () => {
  it('/estado y /preparacion reales: formas, integridad, sesión sin iniciar y base «verificada»', async () => {
    const e = await escenarioPlantilla()
    const t = await telefono(e)
    const h = await t.hidratar()
    expect(h.est.status).toBe(200)
    expect(claves(h.est.cuerpo)).toEqual(['atribucion', 'cursor', 'credencial', 'deviceId', 'estado', 'etiquetas', 'gameId', 'partido', 'servidorAhoraMs', 'version', 'visualizacion'].sort())
    expect(h.est.cabeceras.get('cache-control')).toBe('no-store')
    expect(h.construir.ok, JSON.stringify(h.construir)).toBe(true)
    expect(h.creada.ok).toBe(true)
    const { sesion } = await t.leer()
    expect(sesion).toMatchObject({ deviceId: 'tel-P', inicio: 'sin-iniciar', siguienteSeq: 1, verificacion: { nivel: 'verificada', verificadaRev: 0 }, base: { ultimoClientSeq: 0 } })
    const p = await t.prep()
    expect(claves(p.cuerpo)).toEqual(['etiquetas', 'preparacion', 'rev', 'ultimoClientSeq'])
    expect(preparacionIntegra(p.cuerpo.preparacion, { gameId: 'P' })).toBe(true)
    // la lectura real equivale a lo que el servidor tiene: una instantánea idéntica verifica la base recién creada
    const v = await t.verificar()
    expect(v.v, JSON.stringify(v.v)).toMatchObject({ ok: true, verificada: true })
  })
})

describe('E2a-bis — hidratar un partido que YA está en curso (inicio perdido: diferido en S1a)', () => {
  it('la sesión nace «sin-resolver», la base es verificada y no se puede puntuar', async () => {
    const e = await escenarioPlantilla()
    await conInicio(e) // otra sesión/teléfono inició el partido; la sesión nueva no tiene su sobre de inicio
    const nuevo = await telefono(e)
    const h = await nuevo.hidratar()
    expect(h.creada, JSON.stringify(h.construir)).toMatchObject({ ok: true })
    const l = await nuevo.leer()
    expect(l.sesion.inicio).toBe('sin-resolver')
    expect(l.sesion.base.estado.rev).toBe(1)
    expect(l.vista.puntuacion).toEqual({ habilitada: false, motivo: 'inicio-sin-resolver' })
    const r = await nuevo.encolar(nuevo.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, SERVIDOR - 10))
    expect(r).toMatchObject({ ok: false, motivo: 'inicio-sin-resolver' })
  })
})

describe('E2b — recibos reales: aceptado, repetido (recibo-existente) y rechazado frente al contrato S1a', () => {
  it('inicio aceptado: cuerpo 200 exacto, recibo con las claves esperadas, S1a lo aplica y confirma el inicio', async () => {
    const e = await escenarioPlantilla()
    const { t, s } = await conInicio(e)
    expect(s.http.status).toBe(200)
    expect(claves(s.http.cuerpo)).toEqual(['publicacion', 'recibo', 'resultado'])
    expect(s.http.cuerpo.resultado).toBe('aceptado')
    expect(s.http.cuerpo.publicacion).toBe('pendiente') // la entrega pública no está configurada: no se afirma ninguna entrega
    expect(claves(s.http.cuerpo.recibo)).toEqual(CLAVES_RECIBO)
    expect(claves(s.http.cuerpo.recibo.meta)).toEqual(CLAVES_META)
    expect(claves(s.http.cuerpo.recibo.refs)).toEqual(CLAVES_REFS)
    expect(s.http.cabeceras.get('content-type')).toBe('application/json; charset=utf-8')
    expect(s.aplicado, JSON.stringify(s.aplicado)).toMatchObject({ ok: true })
    const l = await t.leer()
    expect(l.sesion.inicio).toBe('confirmado')
    expect(l.sesion.base).toMatchObject({ ultimoClientSeq: 1 })
    expect(l.sesion.base.estado.rev).toBe(s.http.cuerpo.recibo.revDespues)
    const v = await t.verificar()
    expect(v.v, JSON.stringify(v.v)).toMatchObject({ ok: true, verificada: true })
  })

  it('reenvío del texto exacto: 200 recibo-existente con el MISMO recibo; S1a no-op', async () => {
    const e = await escenarioPlantilla()
    const { t, s } = await conInicio(e)
    const l = await t.leer()
    const guardado = l.entradas[0].cuerpoJson
    expect(guardado).toBe(s.cuerpoJson)
    const otra = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: guardado }))
    expect(otra.status).toBe(200)
    expect(otra.cuerpo.resultado).toBe('recibo-existente')
    expect(otra.cuerpo.publicacion).toBe('no-aplica')
    expect(otra.cuerpo.recibo).toEqual(s.http.cuerpo.recibo)
    expect(await huellaDeRecibo(otra.cuerpo.recibo)).toBe(await huellaDeRecibo(s.http.cuerpo.recibo))
    const antes = await t.leer()
    const ap = await t.aplicar(otra)
    expect(ap, JSON.stringify(ap)).toMatchObject({ ok: true, noop: true })
    expect((await t.leer()).sesion.revision).toBe(antes.sesion.revision)
  })

  it('rechazo definitivo real (tiempo-invalido): 200 rechazado; S1a avanza la secuencia, no la revisión, y conserva dependientes; el reenvío devuelve el mismo rechazo', async () => {
    const e = await escenarioPlantilla()
    const { t } = await conInicio(e)
    const antes = (await t.leer()).sesion.base.estado.rev
    const futuro = SERVIDOR + 60_000
    t.ahora = futuro
    expect((await t.encolar(t.orden('arrancar-reloj', {}, futuro))).ok).toBe(true)
    expect((await t.encolar(t.orden('siguiente-periodo', {}, futuro))).ok).toBe(true)
    expect((await t.encolar(t.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, futuro))).ok).toBe(true)
    const textos = (await t.leer()).entradas.map((f) => f.cuerpoJson)
    const s = await t.enviarYAplicar()
    expect(s.http.status).toBe(200)
    expect(s.http.cuerpo.resultado).toBe('rechazado')
    const r = s.http.cuerpo.recibo
    expect(claves(r)).toEqual(CLAVES_RECIBO_RECHAZADO)
    expect(r.motivo).toBe('tiempo-invalido')
    expect(r.revDespues).toBe(antes)
    expect(r.refs).toEqual({ eventosNuevos: [], eventosActualizados: [], auditoria: [] })
    expect(s.http.cuerpo.publicacion).toBe('no-aplica')
    expect(s.aplicado, JSON.stringify(s.aplicado)).toMatchObject({ ok: true })
    const l = await t.leer()
    expect(l.entradas.map((f) => f.estado)).toEqual(['confirmada', 'rechazada', 'no-aplicada', 'no-aplicada'])
    expect(l.entradas.slice(1).map((f) => f.cuerpoJson)).toEqual(textos.slice(1))
    expect(l.sesion.base.estado.rev).toBe(antes)
    expect(l.sesion.base.ultimoClientSeq).toBe(2)
    expect(l.sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo', motivo: 'tiempo-invalido' })
    // el servidor guarda ese rechazo: el reenvío exacto devuelve «recibo-existente» con el recibo rechazado
    const otra = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: l.entradas[1].cuerpoJson }))
    expect(otra.status).toBe(200)
    expect(otra.cuerpo.resultado).toBe('recibo-existente')
    expect(otra.cuerpo.recibo).toEqual(r)
    expect(await t.aplicar(otra)).toMatchObject({ ok: true, noop: true })
    // y la instantánea real coincide con el cursor local: se puede reanudar con ella
    const est = await t.estado()
    expect(est.cuerpo.cursor).toEqual({ rev: antes, ultimoClientSeq: 2 })
    const rr = await reanudarSesion(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: est.cuerpo, confirmadoPorOperador: true, ctx: t.ctx() })
    expect(rr, JSON.stringify(rr)).toMatchObject({ ok: true })
  })
})

describe('E2c — los 12 tipos de orden contra el Worker real: la base derivada coincide con /estado tras cada uno', () => {
  it('recorrido completo con verificación paso a paso', async () => {
    const e = await escenarioPlantilla()
    const { t } = await conInicio(e)
    const B = SERVIDOR - 800_000
    const confianza = (ts) => ({ nivel: 'confiable', estimadoMs: ts, accionTsCrudo: ts, discontinuidad: null })
    let estimacion = null
    const paso = async (tipo, datos, ts) => {
      const prov = (await t.leer()).vista.estadoProvisional
      estimacion = confianza(ts)
      const o = crearOrden({ estadoProvisional: prov, tipo, datos, cmdId: cmd(tipo.slice(0, 3)), estimacion })
      expect(o.ok, `${tipo} ${JSON.stringify(o)}`).toBe(true)
      const enc = await t.encolar(o.orden)
      expect(enc.ok, `${tipo} ${JSON.stringify(enc)}`).toBe(true)
      const s = await t.enviarYAplicar()
      expect(s.http.status, `${tipo} ${s.http.texto}`).toBe(200)
      expect(s.http.cuerpo.resultado, `${tipo} ${s.http.texto}`).toBe('aceptado')
      expect(claves(s.http.cuerpo.recibo)).toEqual(CLAVES_RECIBO)
      expect(s.aplicado.ok, `${tipo} ${JSON.stringify(s.aplicado)}`).toBe(true)
      const v = await t.verificar()
      expect(v.v, `${tipo} verificación: ${JSON.stringify(v.v)}`).toMatchObject({ ok: true, verificada: true })
      return o.orden.cmdId
    }
    await paso('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, B)
    await paso('falta', { equipoId: 'E2', jugadorId: 'J9' }, B + 10)
    await paso('deshacer', {}, B + 20)
    await paso('rehacer', {}, B + 30)
    const a2 = await paso('anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 }, B + 40)
    await paso('anular-evento', { eventoId: a2 }, B + 50)
    await paso('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 1 }, B + 60) // bloquea el rehacer de lo anulado
    await paso('arrancar-reloj', {}, B + 1000)
    await paso('detener-reloj', {}, B + 5000)
    await paso('corregir-reloj', { restanteMs: 500_000 }, B + 6000)
    await paso('arrancar-reloj', {}, B + 10_000)
    const prov = (await t.leer()).vista.estadoProvisional
    const plazo = prov.partido.relojDesde + prov.partido.relojRestante
    expect(plazo).toBeLessThan(SERVIDOR)
    const auto = await t.encolar({ cmdId: `auto:P:${prov.corridaSeq}`, tipo: 'parada-automatica', datos: { corridaSeq: prov.corridaSeq }, tiempo: t.tiempo(plazo) })
    expect(auto.ok, JSON.stringify(auto)).toBe(true)
    const sa = await t.enviarYAplicar()
    expect(sa.http.cuerpo.resultado, sa.http.texto).toBe('aceptado')
    expect((await t.verificar()).v, 'parada-automatica').toMatchObject({ ok: true, verificada: true })
    await paso('siguiente-periodo', {}, B + 20_000)
    await paso('cerrar-partido', {}, B + 30_000)
    const tipos = new Set((await t.leer()).entradas.map((f) => f.tipo))
    for (const x of ['iniciar-partido', 'anotar', 'falta', 'deshacer', 'rehacer', 'anular-evento', 'arrancar-reloj', 'detener-reloj', 'corregir-reloj', 'parada-automatica', 'siguiente-periodo', 'cerrar-partido']) expect(tipos.has(x), x).toBe(true)
    const l = await t.leer()
    expect(l.sesion.divergencia).toBeNull()
    expect(l.sesion.uso.sobreReserva).toBe(false)
    expect(l.entradas.every((f) => f.estado === 'confirmada')).toBe(true)
  }, 60_000) // ~20 ciclos con verificación; en la suite completa, con carga, supera los 5 s por defecto
})

describe('E2d — inicio obsoleto y reintento aceptado tras un cambio de plantilla permitido', () => {
  it('inicio con preparación vieja: rechazo real preparacion-desactualizada, reanudación con insumos frescos y un cmdId nuevo', async () => {
    const e = await escenarioPlantilla()
    const t = await telefono(e)
    await t.hidratar()
    const p1 = await t.prep()
    const l = await t.leer()
    const viejo = ordenDeInicio({ cmdId: cmd('ini'), preparacion: p1.cuerpo.preparacion, tiempo: t.tiempo(SERVIDOR - 1000), sesion: l.sesion }).orden
    expect((await t.encolar(viejo)).ok).toBe(true)
    // cambio de plantilla PERMITIDO: el partido todavía no empezó (altas por la API real del organizador)
    const a = await alta(e.cookie, e.ligaId, 'E2', { campos: campos({ nombrePila: 'Nueva', apellido1: 'Jugadora', dorsal: 22 }) })
    expect([200, 201], JSON.stringify(a.cuerpo)).toContain(a.status)
    const s = await t.enviarYAplicar()
    expect(s.http.cuerpo.resultado).toBe('rechazado')
    expect(s.http.cuerpo.recibo.motivo).toBe('preparacion-desactualizada')
    expect(typeof s.http.cuerpo.recibo.detalle.versionServidor).toBe('string')
    expect(s.aplicado.ok, JSON.stringify(s.aplicado)).toBe(true)
    expect((await t.leer()).sesion.inicio).toBe('sin-iniciar')
    const p2 = await t.prep()
    expect(p2.cuerpo.preparacion.version).not.toBe(p1.cuerpo.preparacion.version)
    expect(p2.cuerpo.preparacion.version).toBe(s.http.cuerpo.recibo.detalle.versionServidor)
    const est = await t.estado()
    const rr = await reanudarSesion(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: est.cuerpo, preparacion: p2.cuerpo.preparacion, confirmadoPorOperador: true, ctx: t.ctx() })
    expect(rr, JSON.stringify(rr)).toMatchObject({ ok: true })
    t.nota(rr)
    const l2 = await t.leer()
    const nuevo = ordenDeInicio({ cmdId: cmd('ini'), preparacion: p2.cuerpo.preparacion, tiempo: t.tiempo(SERVIDOR - 500), sesion: l2.sesion }).orden
    expect((await t.encolar(nuevo)).ok).toBe(true)
    const s2 = await t.enviarYAplicar()
    expect(s2.http.cuerpo.resultado).toBe('aceptado')
    expect((await t.leer()).sesion.inicio).toBe('confirmado')
  })

  /**
   * Inicio aceptado, un punto, partido CERRADO y plantilla cambiada DESPUÉS por la API real del organizador (permitido: ya no
   * corre; con el partido en curso esas operaciones están bloqueadas y aquí nunca se toca una plantilla en juego).
   * `cambios`: operaciones del organizador a aplicar tras cerrar. Deja una orden `deshacer` SIN ENVIAR (viva) si `pendiente`.
   */
  async function partidoCerradoYPlantillaCambiada({ cambios = ['alta'], pendiente = false } = {}) {
    const e = await escenarioPlantilla()
    const { t, s } = await conInicio(e)
    const punto = crearOrden({ estadoProvisional: (await t.leer()).vista.estadoProvisional, tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, cmdId: cmd('pto'), estimacion: { nivel: 'confiable', estimadoMs: SERVIDOR - 200, accionTsCrudo: SERVIDOR - 200, discontinuidad: null } })
    expect((await t.encolar(punto.orden)).ok).toBe(true)
    expect((await t.enviarYAplicar()).http.cuerpo.resultado).toBe('aceptado')
    const cerrar = crearOrden({ estadoProvisional: (await t.leer()).vista.estadoProvisional, tipo: 'cerrar-partido', cmdId: cmd('cer'), estimacion: { nivel: 'confiable', estimadoMs: SERVIDOR - 100, accionTsCrudo: SERVIDOR - 100, discontinuidad: null } })
    expect((await t.encolar(cerrar.orden)).ok).toBe(true)
    const sc = await t.enviarYAplicar()
    expect(sc.http.cuerpo.resultado, sc.http.texto).toBe('aceptado')
    expect((await t.estado()).cuerpo.estado.partido.estado).toBe('final')
    if (pendiente) {
      const des = crearOrden({ estadoProvisional: (await t.leer()).vista.estadoProvisional, tipo: 'deshacer', cmdId: cmd('des'), estimacion: { nivel: 'confiable', estimadoMs: SERVIDOR - 50, accionTsCrudo: SERVIDOR - 50, discontinuidad: null } })
      expect((await t.encolar(des.orden)).ok, 'orden viva sin enviar').toBe(true)
    }
    const antes = (await t.estado()).cuerpo.atribucion.version
    for (const c of cambios) {
      let r
      if (c === 'alta') r = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ nombrePila: 'Tardía', apellido1: 'Alta', dorsal: 33 }) })
      if (c === 'desactivar-usada') r = await accion(e.cookie, e.ligaId, 'E1', 'J1', 'desactivar', { revEsperada: 1 })
      if (c === 'etiqueta') r = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { nombreCamiseta: 'BETITO' } })
      expect([200, 201], `${c}: ${r.status} ${JSON.stringify(r.cuerpo)}`).toContain(r.status)
    }
    const ahora = await t.estado()
    return { e, t, s, antes, ahora, textoInicio: (await t.leer()).entradas[0].cuerpoJson, cmdIdInicio: (await t.leer()).entradas[0].cmdId }
  }
  const filasInmutables = (l) => JSON.stringify(l.entradas.map((f) => [f.clientSeq, f.cmdId, f.cuerpoJson, f.estado, f.recibo, f.reciboHuella, f.reserva, f.bytes, f.intentos]))

  it('reenvío del sobre ORIGINAL del inicio tras el cambio de plantilla: mismo texto, mismo cmdId, recibo original y S1a no-op', async () => {
    const { t, s, textoInicio, cmdIdInicio } = await partidoCerradoYPlantillaCambiada()
    const p = await t.prep()
    expect(p.cuerpo.preparacion.version).not.toBe(JSON.parse(textoInicio).preparacionVersion) // la plantilla sí cambió
    const otra = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: textoInicio }))
    expect(otra.status).toBe(200)
    expect(otra.cuerpo.resultado).toBe('recibo-existente')
    expect(otra.cuerpo.recibo).toEqual(s.http.cuerpo.recibo)
    expect(otra.cuerpo.recibo.cmdId).toBe(cmdIdInicio)
    const ap = await t.aplicar(otra)
    expect(ap, JSON.stringify(ap)).toMatchObject({ ok: true, noop: true })
    expect((await t.leer()).entradas[0].cuerpoJson).toBe(textoInicio)
  })

  // Era el DESAJUSTE CONOCIDO de REPORT_120 (marcado it.fails). Ahora es una regresión normal con su aserción original.
  it('la verificación tras un cambio de plantilla permitido en un partido final NO detiene la sesión: se refresca la atribución', async () => {
    const { t, antes, ahora } = await partidoCerradoYPlantillaCambiada()
    expect(ahora.cuerpo.atribucion.version).not.toBe(antes) // la atribución real cambió de verdad
    const v = await t.verificar()
    expect(v.v, JSON.stringify(v.v)).toMatchObject({ ok: true, verificada: true })
    const l = await t.leer()
    expect(l.sesion.divergencia).toBeNull()
    expect(l.sesion.verificacion).toEqual({ nivel: 'verificada', verificadaRev: l.sesion.base.estado.rev, atribucionRefrescada: { de: antes, a: ahora.cuerpo.atribucion.version } })
    expect(l.sesion.base.estado.atribucion).toEqual(ahora.cuerpo.atribucion)
    expect(l.sesion.etiquetas).toEqual(ahora.cuerpo.etiquetas)
    expect(v.v.vista.atribucionRefrescada).toEqual({ de: antes, a: ahora.cuerpo.atribucion.version })
    // verificar otra vez ya no encuentra nada que refrescar
    const otra = await t.verificar()
    expect(otra.v).toMatchObject({ ok: true, verificada: true })
    expect((await t.leer()).vista.atribucionRefrescada).toBeNull()
  })

  it('jugador USADO desactivado + alta + etiqueta: se refresca; sobres pendientes, recibos y huellas quedan idénticos byte a byte', async () => {
    const { t, s, textoInicio, ahora } = await partidoCerradoYPlantillaCambiada({ cambios: ['desactivar-usada', 'alta', 'etiqueta'], pendiente: true })
    expect(ahora.cuerpo.atribucion.jugadores.J1.elegible).toBe(false) // la ficha usada sigue en la atribución, sin permiso para puntos nuevos
    const antes = await t.leer()
    const filasAntes = filasInmutables(antes)
    const huellaInicio = antes.entradas[0].reciboHuella
    expect(antes.entradas.at(-1)).toMatchObject({ estado: 'pendiente', tipo: 'deshacer' })
    const v = await t.verificar()
    expect(v.v, JSON.stringify(v.v)).toMatchObject({ ok: true, verificada: true })
    const despues = await t.leer()
    expect(filasInmutables(despues)).toBe(filasAntes) // cmdId, texto del sobre, recibo recortado, huella, reserva, bytes: nada se tocó
    expect(despues.entradas[0].reciboHuella).toBe(huellaInicio)
    expect(despues.entradas[0].cuerpoJson).toBe(textoInicio)
    expect(despues.sesion.base.estado.atribucion.jugadores.J1.elegible).toBe(false)
    expect(despues.sesion.base.estado.eventos.find((e) => e.jugadorId === 'J1')).toBeTruthy() // la historia conserva al jugador
    expect(despues.vista.ok).toBe(true) // el provisional (con el deshacer vivo) se sigue reconstruyendo
    expect(despues.vista.pendientes).toBe(1)
    // el reenvío del inicio original sigue dando su recibo original
    const otra = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: textoInicio }))
    expect(otra.cuerpo.resultado).toBe('recibo-existente')
    expect(otra.cuerpo.recibo).toEqual(s.http.cuerpo.recibo)
    expect(await t.aplicar(otra)).toMatchObject({ ok: true, noop: true })
    expect(filasInmutables(await t.leer())).toBe(filasAntes)
    // y el deshacer vivo se envía y se aplica con la atribución refrescada
    const env = await t.enviarYAplicar()
    expect(env.http.cuerpo.resultado, env.http.texto).toBe('aceptado')
    expect((await t.verificar()).v).toMatchObject({ ok: true, verificada: true })
  })

  describe('lo que SIGUE deteniendo la sesión (con datos reales del Worker)', () => {
    const diverge = async (t, cuerpo) => {
      const base = (await t.leer()).sesion.base
      const r = await verificarInstantanea(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: cuerpo, ctx: t.ctx() })
      t.nota(r)
      const l = await t.leer()
      return { r, l, baseIntacta: JSON.stringify(l.sesion.base) === JSON.stringify(base) }
    }
    it('un desajuste REAL del estado del juego (eventos) aunque la atribución también haya cambiado', async () => {
      const { t, ahora } = await partidoCerradoYPlantillaCambiada()
      const torcido = JSON.parse(ahora.texto)
      torcido.estado.eventos = torcido.estado.eventos.map((e) => ({ ...e, puntos: e.puntos + 1 }))
      const d = await diverge(t, torcido)
      expect(d.r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'instantanea-distinta' })
      expect(d.l.sesion.divergencia.detalle.diferencias).toEqual(expect.arrayContaining(['eventos', 'atribucion']))
      expect(d.baseIntacta).toBe(true)
      expect(d.l.vista.puntuacion).toEqual({ habilitada: false, motivo: 'divergencia' })
    })
    it.each([
      ['revisión', (c) => { c.cursor.rev += 1 }, 'rev'],
      ['cursor de secuencia', (c) => { c.cursor.ultimoClientSeq += 1 }, 'ultimoClientSeq'],
      ['reloj', (c) => { c.estado.partido.relojRestante -= 1 }, 'partido'],
      ['marca de auditoría', (c) => { c.estado.auditSeq += 1 }, 'auditSeq'],
    ])('un desajuste de %s', async (_n, tocar, campo) => {
      const { t, ahora } = await partidoCerradoYPlantillaCambiada()
      const torcido = JSON.parse(ahora.texto)
      tocar(torcido)
      const d = await diverge(t, torcido)
      expect(d.r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'instantanea-distinta' })
      expect(d.l.sesion.divergencia.detalle.diferencias).toContain(campo)
      expect(d.baseIntacta).toBe(true)
    })
    it('otra identidad de teléfono (deviceId) no es una instantánea de esta sesión', async () => {
      const { t, ahora } = await partidoCerradoYPlantillaCambiada()
      const torcido = JSON.parse(ahora.texto)
      torcido.deviceId = 'otro-telefono'
      const r = await verificarInstantanea(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: torcido, ctx: t.ctx() })
      expect(r).toMatchObject({ ok: false, motivo: 'instantanea-invalida', detalle: 'dispositivo-distinto' })
    })
    it('una instantánea que dice «final» cuando la base derivada NO lo es (aunque además cambie la plantilla)', async () => {
      const e = await escenarioPlantilla()
      const { t } = await conInicio(e)
      // El partido se cierra por OTRO camino (no por esta sesión) y la plantilla cambia después.
      const otro = new (await import('./ayuda.js')).Telefono(e.ligaId, 'P', { deviceId: 'tel-P' })
      const cierre = await otro.mandar('cerrar-partido', {}, { t: SERVIDOR - 100, seq: (await t.leer()).sesion.base.ultimoClientSeq + 1 })
      expect(cierre.cuerpo.resultado, JSON.stringify(cierre.cuerpo)).toBe('aceptado')
      const a = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ nombrePila: 'Tardía', apellido1: 'Alta', dorsal: 33 }) })
      expect([200, 201]).toContain(a.status)
      const est = await t.estado()
      expect(est.cuerpo.estado.partido.estado).toBe('final')
      expect((await t.leer()).sesion.base.estado.partido.estado).toBe('vivo')
      const d = await diverge(t, est.cuerpo)
      expect(d.r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'instantanea-distinta' })
      expect(d.l.sesion.divergencia.detalle.diferencias).toEqual(expect.arrayContaining(['partido', 'rev', 'ultimoClientSeq', 'atribucion']))
      expect(d.baseIntacta).toBe(true)
    })
    it('una atribución distinta con el partido VIVO sigue siendo divergencia (la plantilla está bloqueada)', async () => {
      const e = await escenarioPlantilla()
      const { t } = await conInicio(e)
      const est = (await t.estado()).cuerpo
      const otra = crearAtribucionDe(est, { agregar: 'ZZ9' })
      const d = await diverge(t, { ...est, atribucion: otra })
      expect(d.r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'instantanea-distinta' })
      expect(d.l.sesion.divergencia.detalle.diferencias).toEqual(['atribucion'])
      expect(d.baseIntacta).toBe(true)
    })
    it.each([
      ['falta un jugador usado en un evento', (c, f) => ({ ...c, atribucion: f(c, { quitar: 'J1' }) }), 'jugador-de-un-evento-ausente'],
      ['un jugador usado cambió de equipo', (c, f) => ({ ...c, atribucion: f(c, { mover: ['J1', 'E2'] }) }), 'jugador-de-un-evento-en-otro-equipo'],
      ['otros equipos en la atribución', (c, f) => ({ ...c, atribucion: f(c, { equipos: ['E1', 'E3'] }) }), 'equipos-de-la-atribucion-cambiaron'],
      ['el partido declara otros equipos', (c) => ({ ...c, partido: { ...c.partido, visitaId: 'E3' } }), 'equipos-distintos-del-partido'],
      ['sin atribución', (c) => ({ ...c, atribucion: null }), 'atribucion-ausente-o-no-integra'],
    ])('atribución inválida o incoherente: %s', async (_n, torcer, motivo) => {
      const { t, ahora } = await partidoCerradoYPlantillaCambiada()
      const d = await diverge(t, torcer(JSON.parse(ahora.texto), crearAtribucionDe))
      expect(d.r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'atribucion-incoherente' })
      expect(d.l.sesion.divergencia.detalle.motivo).toBe(motivo)
      expect(d.baseIntacta).toBe(true)
    })
    it('una atribución con la huella manipulada ni siquiera se acepta como instantánea', async () => {
      const { t, ahora } = await partidoCerradoYPlantillaCambiada()
      const torcido = JSON.parse(ahora.texto)
      torcido.atribucion.jugadores.J9.elegible = false // la huella ya no coincide
      const r = await verificarInstantanea(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: torcido, ctx: t.ctx() })
      expect(r).toMatchObject({ ok: false, motivo: 'instantanea-invalida', detalle: 'atribucion' })
    })
  })
})

/** Atribución íntegra derivada de la de un cuerpo real, con un cambio (la huella se recalcula con la función del motor). */
function crearAtribucionDe(cuerpo, { agregar, quitar, mover, equipos } = {}) {
  const jug = Object.entries(cuerpo.atribucion.jugadores).map(([id, j]) => ({ id, equipoId: j.equipoId, activo: j.elegible }))
  let lista = jug
  if (quitar) lista = lista.filter((j) => j.id !== quitar)
  if (mover) lista = lista.map((j) => (j.id === mover[0] ? { ...j, equipoId: mover[1] } : j))
  if (agregar) lista = [...lista, { id: agregar, equipoId: 'E1', activo: true }]
  return crearAtribucion({ equipos: equipos ?? cuerpo.atribucion.equipos, jugadores: lista.filter((j) => (equipos ?? cuerpo.atribucion.equipos).includes(j.equipoId)) })
}

describe('E2e — formas reales de error de /comandos (para la clasificación de S1b)', () => {
  const post = async (t, cuerpo, token = t.token, crudo) => ver(await postComando(t.ligaId, 'P', token, cuerpo, crudo === undefined ? {} : { crudo }))
  it('401, 400, 404, 413, 422 y los cuatro 409', async () => {
    const e = await escenarioPlantilla()
    const { t } = await conInicio(e)
    const ok = (await t.leer()).entradas[0]
    const sobre = JSON.parse(ok.cuerpoJson)
    // 401 genérico con token malo o ausente
    expect(await post(t, sobre, 'token-que-no-existe-0000')).toMatchObject({ status: 401, cuerpo: { error: 'no-autorizado' } })
    expect(await post(t, sobre, null)).toMatchObject({ status: 401, cuerpo: { error: 'no-autorizado' } })
    // 400: el partido de la dirección y el del sobre difieren / JSON ilegible
    expect(await post(t, { ...sobre, gameId: 'Q' })).toMatchObject({ status: 400, cuerpo: { error: 'juego-distinto' } })
    expect(await post(t, null, t.token, '{no es json')).toMatchObject({ status: 400, cuerpo: { error: 'json-invalido' } })
    // 413 por tamaño
    expect(await post(t, null, t.token, JSON.stringify({ ...sobre, relleno: 'x'.repeat(70 * 1024) }))).toMatchObject({ status: 413, cuerpo: { error: 'cuerpo-demasiado-grande' } })
    // 422 con la lista de errores (sobre sin campos)
    const inv = await post(t, { gameId: 'P' })
    expect(inv.status).toBe(422)
    expect(claves(inv.cuerpo)).toEqual(['error', 'errores'])
    expect(inv.cuerpo.error).toBe('sobre-invalido')
    // 404: liga no admitida (misma respuesta que una ruta desconocida)
    const fuera = await ver(await exports.default.fetch(new Request(`${BASE}/v1/ligas/LIGA9999/partidos/P/comandos`, { method: 'POST', headers: { authorization: `Bearer ${t.token}` }, body: '{}' })))
    expect(fuera).toMatchObject({ status: 404, cuerpo: { error: 'no-encontrado' } })
    // 409 hueco: un número por delante del siguiente
    const nuevo = { ...sobre, cmdId: cmd('h'), clientSeq: 9 }
    expect(await post(t, nuevo)).toMatchObject({ status: 409, cuerpo: { tipo: 'hueco', esperado: 2 } })
    // 409 secuencia-ocupada: número ya usado por OTRO cmdId
    expect(await post(t, { ...sobre, cmdId: cmd('o'), clientSeq: 1 })).toMatchObject({ status: 409, cuerpo: { tipo: 'secuencia-ocupada', ocupadaPor: ok.cmdId } })
    // 409 conflicto-contenido: mismo cmdId, contenido distinto → trae el recibo original
    const conf = await post(t, { ...sobre, accionTs: sobre.accionTs + 1, accionTsCrudo: sobre.accionTsCrudo + 1 })
    expect(conf.status).toBe(409)
    expect(claves(conf.cuerpo)).toEqual(['reciboOriginal', 'tipo'])
    expect(conf.cuerpo.tipo).toBe('conflicto-contenido')
    expect(conf.cuerpo.reciboOriginal.cmdId).toBe(ok.cmdId)
    // 409 bloqueado: el partido bloqueado por el servidor
    await (await import('./ayuda.js')).dentro(t.ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET bloqueo_json = '{\"por\":\"organizador\"}', version_bloqueo = version_bloqueo + 1 WHERE id = 'P'"))
    expect(await post(t, { ...sobre, cmdId: cmd('b'), clientSeq: 2 })).toMatchObject({ status: 409, cuerpo: { tipo: 'bloqueado' } })
  })
})

describe('E2f — REPORT_123: parada de transporte (C1) y refresco antes del inicio (C3) contra el Worker real', () => {
  const huella = async (t) => JSON.stringify((await t.leer()).entradas)
  const inicioPendiente = async (t, prep) => {
    const l = await t.leer()
    const g = evaluarInicio({ enLinea: true, sesion: l.sesion, entradas: l.entradas, preparacion: prep })
    expect(g, JSON.stringify(g)).toEqual({ puede: true })
    const o = ordenDeInicio({ cmdId: cmd('ini'), preparacion: prep, tiempo: t.tiempo(SERVIDOR - 1000), sesion: l.sesion }).orden
    expect((await t.encolar(o)).ok).toBe(true)
    return o
  }
  const refrescar = async (t, estado, prep) => t.nota(await refrescarAntesDelInicioDeSesion(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: estado.cuerpo, preparacion: prep, ctx: t.ctx() }))

  it('C3: cambio de plantilla ANTES del inicio con instantánea y preparación reales: se refresca, no se crea ni acepta un inicio, y luego el inicio nuevo es aceptado', async () => {
    const e = await escenarioPlantilla()
    const t = await telefono(e)
    expect((await t.hidratar()).creada.ok).toBe(true)
    const p1 = await t.prep()
    const a = await alta(e.cookie, e.ligaId, 'E2', { campos: campos({ nombrePila: 'Nueva', apellido1: 'Jugadora', dorsal: 22 }) })
    expect([200, 201], JSON.stringify(a.cuerpo)).toContain(a.status)
    const est = await t.estado()
    const p2 = await t.prep()
    expect(p2.cuerpo.preparacion.version).not.toBe(p1.cuerpo.preparacion.version)
    const l0 = await t.leer()
    expect(evaluarInicio({ enLinea: true, sesion: l0.sesion, entradas: [], preparacion: p2.cuerpo.preparacion })).toMatchObject({ puede: false, motivo: 'atribucion-no-coincide-con-preparacion' })
    const r = await refrescar(t, est, p2.cuerpo.preparacion)
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, previaAlInicio: true })
    expect(r.atribucionRefrescada.de).toBe(l0.sesion.base.estado.atribucion.version)
    const l = await t.leer()
    expect(l.sesion.base.estado.atribucion.version).toBe(est.cuerpo.atribucion.version)
    expect(l.sesion).toMatchObject({ inicio: 'sin-iniciar', detenida: null, divergencia: null })
    expect(l.entradas).toEqual([])
    expect(l.vista.puntuacion.habilitada).toBe(false)
    // el servidor no recibió nada: sigue programado y sin recibos
    expect((await t.estado()).cuerpo.estado.partido.estado).toBe('programado')
    await inicioPendiente(t, p2.cuerpo.preparacion)
    const s = await t.enviarYAplicar()
    expect(s.http.cuerpo.resultado).toBe('aceptado')
    expect((await t.leer()).sesion.inicio).toBe('confirmado')
  })

  it('C3: rechazo CONFIRMADO del inicio obsoleto → solo la recuperación explícita; se conservan lo rechazado y el cmdId viejo; el nuevo es aceptado', async () => {
    const e = await escenarioPlantilla()
    const t = await telefono(e)
    await t.hidratar()
    const p1 = await t.prep()
    const viejo = await inicioPendiente(t, p1.cuerpo.preparacion)
    await alta(e.cookie, e.ligaId, 'E2', { campos: campos({ nombrePila: 'Nueva', apellido1: 'Jugadora', dorsal: 22 }) })
    const s = await t.enviarYAplicar()
    expect(s.http.cuerpo.recibo.motivo).toBe('preparacion-desactualizada')
    const antes = await huella(t)
    const est = await t.estado()
    const p2 = await t.prep()
    expect(await refrescar(t, est, p2.cuerpo.preparacion)).toMatchObject({ ok: false, motivo: 'cola-detenida', detalle: 'rechazo-definitivo' })
    expect(await huella(t)).toBe(antes)
    const rr = t.nota(await reanudarSesion(t.almacen, { id: t.id, revision: t.revision, cuerpoEstado: est.cuerpo, preparacion: p2.cuerpo.preparacion, confirmadoPorOperador: true, ctx: t.ctx() }))
    expect(rr.ok, JSON.stringify(rr)).toBe(true)
    expect(await huella(t)).toBe(antes) // rechazada y sus sobres intactos
    const l = await t.leer()
    expect(await t.encolar(ordenDeInicio({ cmdId: viejo.cmdId, preparacion: p2.cuerpo.preparacion, tiempo: t.tiempo(SERVIDOR - 500), sesion: l.sesion }).orden)).toMatchObject({ ok: false, motivo: 'cmdId-reutilizado' })
    await inicioPendiente(t, p2.cuerpo.preparacion)
    const s2 = await t.enviarYAplicar()
    expect(s2.http.cuerpo.resultado).toBe('aceptado')
    expect((await t.leer()).sesion.inicio).toBe('confirmado')
  })

  it('C3: inicio con respuesta PERDIDA (el Worker lo aceptó): el refresco no lo salta ni habilita la puntuación; el reenvío del original lo resuelve', async () => {
    const e = await escenarioPlantilla()
    const t = await telefono(e)
    await t.hidratar()
    const p = await t.prep()
    const o = await inicioPendiente(t, p.cuerpo.preparacion)
    const enviado = await t.enviar() // el teléfono marca «enviando»; la respuesta se «pierde»: no se aplica
    expect(enviado.http.cuerpo.resultado).toBe('aceptado')
    const antes = await huella(t)
    const est = await t.estado()
    expect(est.cuerpo.estado.partido.estado).toBe('vivo')
    expect(await refrescar(t, est, p.cuerpo.preparacion)).toMatchObject({ ok: false, motivo: 'resultado-sin-resolver' })
    expect(await huella(t)).toBe(antes)
    const l = await t.leer()
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(l.vista.puntuacion.habilitada).toBe(false)
    // la verificación simple tampoco lo resuelve (hay una entrada en vuelo)
    expect((await t.verificar()).v).toMatchObject({ ok: false, motivo: 'no-aplicable' })
    // solo el recibo (reenvío del texto original) lo resuelve
    const otra = await t.enviar()
    expect(otra.cuerpoJson).toBe(enviado.cuerpoJson)
    expect(otra.http.cuerpo.resultado).toBe('recibo-existente')
    expect((await t.aplicar(otra.http)).ok).toBe(true)
    expect((await t.leer()).sesion.inicio).toBe('confirmado')
    expect(o.cmdId).toBe((await t.leer()).entradas[0].cmdId)
  })

  it('C3: partido en curso o final, juego o dispositivo equivocado, atribución malformada: seguro rechazado sin escribir', async () => {
    const e = await escenarioPlantilla()
    const { t, prep } = await conInicio(e)
    const antes = await huella(t)
    const est = await t.estado()
    expect(await refrescar(t, est, prep)).toMatchObject({ ok: false, motivo: 'no-es-previa-al-inicio' })
    // sesión nueva sin iniciar para el MISMO partido ya en curso: nace sin-resolver
    const t2 = await telefono(e)
    await t2.hidratar()
    expect((await t2.leer()).sesion.inicio).toBe('sin-resolver')
    expect(await refrescar(t2, est, prep)).toMatchObject({ ok: false, motivo: 'no-es-previa-al-inicio' })
    // pre-inicio en OTRO partido de la misma liga no hay: se prueban las formas de la instantánea sobre una sesión programada
    const e2 = await escenarioPlantilla()
    const u = await telefono(e2)
    await u.hidratar()
    const ok = await u.estado()
    const pp = await u.prep()
    const antesU = await huella(u)
    expect(await refrescar(u, { cuerpo: { ...ok.cuerpo, gameId: 'Q' } }, pp.cuerpo.preparacion)).toMatchObject({ ok: false, motivo: 'instantanea-invalida' })
    expect(await refrescar(u, { cuerpo: { ...ok.cuerpo, deviceId: 'otro-telefono' } }, pp.cuerpo.preparacion)).toMatchObject({ ok: false, motivo: 'instantanea-invalida' })
    expect(await refrescar(u, { cuerpo: { ...ok.cuerpo, atribucion: { ...ok.cuerpo.atribucion, version: 'v-falsa' } } }, pp.cuerpo.preparacion)).toMatchObject({ ok: false, motivo: 'instantanea-invalida' })
    expect(await huella(u)).toBe(antesU)
    expect(await huella(t)).toBe(antes)
  })

  it('C1: 401 real con el token malo → parada de transporte persistida; recarga la conserva y bloquea el envío; el reenvío explícito del ORIGINAL con el token bueno obtiene recibo-existente', async () => {
    const e = await escenarioPlantilla()
    const t = await telefono(e)
    await t.hidratar()
    const p = await t.prep()
    const o = await inicioPendiente(t, p.cuerpo.preparacion)
    const m = t.nota(await marcarEnviando(t.almacen, { id: t.id, revision: t.revision, cmdId: o.cmdId, ctx: t.ctx() }))
    // el primer intento llega al Worker (se acepta) pero el teléfono no lo sabe; el siguiente sale con un token inválido → 401 genérico
    expect((await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: m.cuerpoJson }))).cuerpo.resultado).toBe('aceptado')
    const m2 = t.nota(await marcarEnviando(t.almacen, { id: t.id, revision: t.revision, cmdId: o.cmdId, ctx: t.ctx() }))
    const r401 = await ver(await postComando(t.ligaId, 'P', 'token-que-no-existe-0000', null, { crudo: m2.cuerpoJson }))
    expect(r401).toMatchObject({ status: 401, cuerpo: { error: 'no-autorizado' } })
    const antes = await huella(t)
    const st = t.nota(await registrarParadaDeTransporte(t.almacen, { id: t.id, revision: t.revision, parada: { clase: 'no-autorizado', http: r401.status, cmdId: o.cmdId }, ctx: t.ctx() }))
    expect(st, JSON.stringify(st)).toMatchObject({ ok: true, detenida: { causa: 'transporte', clase: 'no-autorizado', http: 401 } })
    expect(await huella(t)).toBe(antes) // ni recibo fabricado ni cambio de estado de la orden incierta
    // recarga
    const otra = await abrirAlmacen({ nombre: t.almacen.db.name })
    const lr = await leerSesion(otra, t.id, t.ctx())
    expect(lr.sesion.detenida).toMatchObject({ causa: 'transporte' })
    expect(await marcarEnviando(otra, { id: t.id, revision: lr.sesion.revision, cmdId: o.cmdId, ctx: t.ctx() })).toMatchObject({ ok: false, motivo: 'cola-detenida' })
    // vía explícita autorizada: el mismo sobre, token bueno
    const m3 = t.nota(await marcarEnviando(t.almacen, { id: t.id, revision: t.revision, cmdId: o.cmdId, confirmadoPorOperador: true, ctx: t.ctx() }))
    expect(m3.cuerpoJson).toBe(m.cuerpoJson)
    const ok = await ver(await postComando(t.ligaId, 'P', t.token, null, { crudo: m3.cuerpoJson }))
    expect(ok.cuerpo.resultado).toBe('recibo-existente')
    expect((await t.aplicar(ok)).ok).toBe(true)
    const l = await t.leer()
    expect(l.sesion).toMatchObject({ inicio: 'confirmado', detenida: { causa: 'transporte' } })
    expect(l.entradas[0]).toMatchObject({ estado: 'confirmada', cuerpoJson: m.cuerpoJson })
    // reintento idempotente del mismo recibo
    expect(await t.aplicar(ok)).toMatchObject({ ok: true, noop: true })
  })

  it('C1: el 409 (hueco) y el 422 reales se registran como parada de transporte, sin recibo fabricado y con evidencia acotada', async () => {
    const casos = [
      [(sobre) => ({ ...sobre, cmdId: cmd('h'), clientSeq: 9 }), { clase: 'conflicto', subtipo: 'hueco', http: 409 }],
      [() => ({ gameId: 'P' }), { clase: 'sobre-invalido', http: 422 }],
    ]
    for (const [armar, parada] of casos) {
      const { t } = await conInicio(await escenarioPlantilla())
      const sobre = JSON.parse((await t.leer()).entradas[0].cuerpoJson)
      const r = await ver(await postComando(t.ligaId, 'P', t.token, armar(sobre)))
      expect(r.status).toBe(parada.http)
      const antes = await huella(t)
      const reg = t.nota(await registrarParadaDeTransporte(t.almacen, { id: t.id, revision: t.revision, parada: { ...parada, cuerpo: r.texto }, ctx: t.ctx() }))
      expect(reg.ok, JSON.stringify(reg)).toBe(true)
      const d = (await t.leer()).sesion.detenida
      expect(Object.keys(d).sort()).toEqual(['causa', 'clase', 'cmdId', 'en', 'http', 'subtipo'])
      expect(JSON.stringify(d)).not.toContain(r.texto)
      expect(await huella(t)).toBe(antes)
    }
  })
})
