import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { MAX_OPERACIONES, aplicar, construirPlan, resumenDelPlan, sha256Hex, validarOrigenLocal, verificar } from '../scripts/lib/runner-plantilla.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ORIGEN, admin, iniciarSesion, provisionar, reiniciarAcceso, T0 } from './ayuda-acceso.js'
import { dentro, sqlDe } from './ayuda.js'

// Ejecutor local de plantillas: SOLO datos sintéticos, contra el Worker real dentro del runtime de pruebas.
// Ningún nombre, equipo, liga ni credencial es real.

const LOCAL = 'http://127.0.0.1:8787'
const CARGA = (n) => `carga-runner-${String(n).padStart(4, '0')}-aaaa`

/** Paquete SINTÉTICO con la forma del paquete real (campos de las filas incluidos). */
function paqueteSintetico(ligaNombre = 'Liga Sintetica Runner') {
  const fila = (team, n, nombre, apellido, jersey, extra = {}) => ({
    source_ref: `${team}#p1r${n}`, league: ligaNombre, team: `Equipo ${team}`, source_file: 'sintetico.pdf', source_sha256: 'a'.repeat(64),
    page: 1, row: n, source_text: `${nombre} ${apellido} ${jersey ?? ''}`, source_jersey_text: String(jersey ?? ''),
    first_name: nombre, surname: apellido, name_split: { estado: 'ok', regla: 'primera-palabra' }, jersey, status: jersey === null ? 'held' : 'ready',
    hold_reasons: jersey === null ? ['missing-jersey'] : [], explicit_user_decisions: [], notes: [], ...extra,
  })
  const equipo = (key, nombre, rows, excluded = []) => ({
    team_key: key, team_display_name: nombre, source_file: {}, direct_verification: [], supplied_history: [],
    counts: { candidates: rows.length, ready: rows.filter((r) => r.status === 'ready').length, held: rows.filter((r) => r.status === 'held').length },
    rows, excluded_rows: excluded, skipped_source_rows: [],
  })
  return {
    package: { name: 'sintetico', status: 'preparation-only' },
    totals: { candidates: 7, ready: 5, held: 1, jersey_missing: 1 },
    teams: [
      equipo('S/ALFA', 'Alfa', [
        fila('S/ALFA', 1, 'Ana', 'Prueba', 7), fila('S/ALFA', 2, 'Beto', 'De la Muestra', 0), fila('S/ALFA', 3, 'Cleo', 'Tres', 12, { shirt_name: 'CLEITO' }),
        fila('S/ALFA', 4, 'Dino', 'Cuatro', null),
      ], [{ source_ref: 'S/ALFA#p1r9', league: ligaNombre, team: 'Equipo S/ALFA', jersey: 7, exclusion: 'repetido', source_text: 'x' }]),
      equipo('S/BETA', 'Beta', [fila('S/BETA', 1, 'Eva', 'Visita', 7), fila('S/BETA', 2, 'Fito', 'Dos', 8)]),
    ],
  }
}

const decisiones = (paquete, resolucion = { tipo: 'otra-persona' }) => Object.fromEntries(
  paquete.teams.flatMap((t) => t.rows.filter((r) => r.status === 'ready').map((r) => [r.source_ref, resolucion])),
)
async function mapeoDe(paquete, ligaId, { identidades = decisiones(paquete), equipos = { 'S/ALFA': 'EQ1', 'S/BETA': 'EQ2' } } = {}) {
  const texto = JSON.stringify(paquete)
  return { texto, mapeo: { version: 1, paqueteSha256: await sha256Hex(texto), ligas: { 'Liga Sintetica Runner': { ligaId, equipos } }, identidades } }
}

/** Liga cargada por el operador (estructura + un partido), organizador provisionado por el operador y código para entrar. */
async function escenario() {
  const ligaId = nuevaLiga()
  const e = await admin(`/v1/admin/ligas/${ligaId}/estructura`, {
    cargaId: CARGA(1), liga: { id: ligaId, nombre: 'Liga Sintetica Runner', deporte: 'baloncesto' },
    equipos: [{ id: 'EQ1', nombre: 'Alfa' }, { id: 'EQ2', nombre: 'Beta' }],
  })
  if (e.status !== 201) throw new Error(`estructura: ${e.status}`)
  const g = await admin(`/v1/admin/ligas/${ligaId}/partidos`, { cargaId: CARGA(2), minutosPorPeriodo: 8, partidos: [{ id: 'G1', localId: 'EQ1', visitaId: 'EQ2', programadoPara: '2026-10-18T09:00-05:00', sede: 'Cancha' }] })
  if (g.status !== 201) throw new Error(`partidos: ${g.status}`)
  await reiniciarAcceso(T0)
  const { codigo } = await provisionar([ligaId])
  return { ligaId, codigo }
}

/** fetch del ejecutor → Worker real; registra todo (para buscar secretos y contar peticiones). */
function red({ antes, despues } = {}) {
  const registro = []
  const f = async (url, init = {}) => {
    const entrada = { url: String(url), metodo: init.method ?? 'GET', cuerpo: init.body ?? null, cabeceras: { ...(init.headers ?? {}) } }
    registro.push(entrada)
    if (antes) await antes(entrada, registro)
    const r = await exports.default.fetch(new Request(String(url).replace(LOCAL, ORIGEN), init))
    entrada.status = r.status
    if (despues) return despues(r, entrada, registro)
    return r
  }
  f.registro = registro
  f.escrituras = () => registro.filter((x) => x.metodo === 'POST' && x.url.includes('/jugadores'))
  return f
}

function almacenEnMemoria({ fallaEscritura = () => false } = {}) {
  const a = { texto: null, escrituras: 0, historial: [] }
  a.leer = async () => a.texto
  a.escribir = async (t) => {
    a.escrituras += 1
    if (fallaEscritura(a.escrituras, t)) throw new Error('disco lleno (prueba)')
    a.texto = t
    a.historial.push(t)
  }
  return a
}

const jugadores = (ligaId) => sqlDe(ligaId, 'SELECT id, equipo_id, nombre_pila, apellido1, dorsal, nombre_camiseta, persona_id, activo FROM jugadores ORDER BY equipo_id, dorsal')
const base = (extra = {}) => ({ origen: LOCAL, accesoOrigen: ORIGEN, ...extra })

describe('plan (simulacro): offline, contabilidad y validación completa', () => {
  it('lista solo filas ready; contabiliza retenidas y excluidas; no lleva nombres en el resumen', async () => {
    const paquete = paqueteSintetico()
    const { texto, mapeo } = await mapeoDe(paquete, 'LIGA1')
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    expect(plan.ok).toBe(true)
    expect(plan.operaciones).toHaveLength(5)
    expect(plan.contabilidad).toMatchObject({ listas: 5, retenidas: 1, excluidas: 1, filasDelPaquete: 7 })
    expect(plan.operaciones.map((o) => o.sourceRef)).not.toContain('S/ALFA#p1r4') // retenida
    expect(plan.operaciones.map((o) => o.sourceRef)).not.toContain('S/ALFA#p1r9') // excluida
    const resumen = JSON.stringify(resumenDelPlan(plan))
    for (const nombre of ['Ana', 'Prueba', 'Muestra', 'CLEITO', 'Visita']) expect(resumen).not.toContain(nombre)
    expect(resumenDelPlan(plan)).toMatchObject({ listas: 5, retenidas: 1, excluidas: 1, operaciones: 5, conAlias: 1 })
  })

  it('el alias se mapea a nombreCamiseta sin tocar nombre ni apellido; el apellido compuesto se conserva; sin fecha de nacimiento', async () => {
    const paquete = paqueteSintetico()
    const { texto, mapeo } = await mapeoDe(paquete, 'LIGA1')
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const cuerpo = (ref) => JSON.parse(plan.operaciones.find((o) => o.sourceRef === ref).cuerpo)
    expect(cuerpo('S/ALFA#p1r3').campos).toEqual({ nombrePila: 'Cleo', apellido1: 'Tres', dorsal: 12, nombreCamiseta: 'CLEITO' })
    expect(cuerpo('S/ALFA#p1r2').campos).toEqual({ nombrePila: 'Beto', apellido1: 'De la Muestra', dorsal: 0 }) // 0 es un número válido
    for (const o of plan.operaciones) expect(JSON.parse(o.cuerpo).campos).not.toHaveProperty('fechaNacimiento')
  })

  it('el identificador de operación es estable: no depende del orden, del número ni de la hora; sí del destino y de la referencia', async () => {
    const paquete = paqueteSintetico()
    const a = await mapeoDe(paquete, 'LIGA1')
    const planA = await construirPlan({ paqueteTexto: a.texto, mapeo: a.mapeo })
    const invertido = paqueteSintetico()
    invertido.teams.reverse()
    for (const t of invertido.teams) t.rows.reverse()
    const b = await mapeoDe(invertido, 'LIGA1')
    const planB = await construirPlan({ paqueteTexto: b.texto, mapeo: b.mapeo })
    const ids = (p) => Object.fromEntries(p.operaciones.map((o) => [o.sourceRef, o.operacionId]))
    expect(ids(planB)).toEqual(ids(planA))
    for (const id of Object.values(ids(planA))) expect(id).toMatch(/^op-[0-9a-f]{40}$/)
    // Otro número para la misma referencia: el MISMO identificador (el servidor lo tratará como contenido distinto → conflicto).
    const otroNumero = paqueteSintetico()
    otroNumero.teams[0].rows[0].jersey = 33
    const c = await mapeoDe(otroNumero, 'LIGA1')
    const planC = await construirPlan({ paqueteTexto: c.texto, mapeo: c.mapeo })
    expect(ids(planC)['S/ALFA#p1r1']).toBe(ids(planA)['S/ALFA#p1r1'])
    // Otra liga destino: otro identificador.
    const d = await mapeoDe(paquete, 'LIGA2')
    expect(ids(await construirPlan({ paqueteTexto: d.texto, mapeo: d.mapeo }))['S/ALFA#p1r1']).not.toBe(ids(planA)['S/ALFA#p1r1'])
  })

  const casos = [
    ['sin decisión de identidad para una fila lista', async (p) => { const m = await mapeoDe(p, 'LIGA1'); delete m.mapeo.identidades['S/BETA#p1r2']; return m }, 'falta-decision-de-identidad'],
    ['decisión de identidad mal formada', async (p) => { const m = await mapeoDe(p, 'LIGA1', { identidades: { ...decisiones(p), 'S/BETA#p1r2': { tipo: 'nueva-por-defecto' } } }); return m }, 'decision-de-identidad-invalida'],
    ['decisión sobrante (no hay fila lista con esa referencia)', async (p) => mapeoDe(p, 'LIGA1', { identidades: { ...decisiones(p), 'S/ALFA#p1r4': { tipo: 'otra-persona' } } }), 'decision-sin-fila-lista'],
    ['hash del paquete distinto al revisado', async (p) => { const m = await mapeoDe(p, 'LIGA1'); m.mapeo.paqueteSha256 = 'f'.repeat(64); return m }, 'paquete-no-coincide-con-el-mapeo'],
    ['equipo sin mapeo', async (p) => mapeoDe(p, 'LIGA1', { equipos: { 'S/ALFA': 'EQ1' } }), 'equipo-sin-mapeo'],
    ['liga sin mapeo', async (p) => { const m = await mapeoDe(p, 'LIGA1'); m.mapeo.ligas = {}; return m }, 'liga-sin-mapeo'],
    ['dos equipos del paquete al mismo equipo destino', async (p) => mapeoDe(p, 'LIGA1', { equipos: { 'S/ALFA': 'EQ1', 'S/BETA': 'EQ1' } }), 'equipo-destino-repetido'],
    ['número repetido dentro de un equipo', async (p) => { p.teams[0].rows[1].jersey = 7; return mapeoDe(p, 'LIGA1') }, 'numero-repetido-en-el-equipo'],
    ['número fuera de 0–99', async (p) => { p.teams[0].rows[0].jersey = 100; return mapeoDe(p, 'LIGA1') }, 'numero-invalido'],
    ['nombre vacío', async (p) => { p.teams[0].rows[0].first_name = '  '; return mapeoDe(p, 'LIGA1') }, 'nombre-o-apellido-ausente'],
    ['referencia duplicada', async (p) => { p.teams[1].rows[0].source_ref = p.teams[0].rows[0].source_ref; return mapeoDe(p, 'LIGA1') }, 'referencia-duplicada'],
    ['totales del paquete que no cuadran', async (p) => { p.totals.ready = 99; return mapeoDe(p, 'LIGA1') }, 'totales-del-paquete-no-cuadran'],
    ['conteo del equipo que no cuadra', async (p) => { p.teams[0].counts.candidates = 9; return mapeoDe(p, 'LIGA1') }, 'conteo-del-equipo-no-cuadra'],
  ]
  for (const [nombre, armar, codigo] of casos) {
    it(`no es aplicable: ${nombre}`, async () => {
      const { texto, mapeo } = await armar(paqueteSintetico())
      const plan = await construirPlan({ paqueteTexto: JSON.stringify(JSON.parse(texto)), mapeo: { ...mapeo, paqueteSha256: mapeo.paqueteSha256 === 'f'.repeat(64) ? mapeo.paqueteSha256 : await sha256Hex(JSON.stringify(JSON.parse(texto))) } })
      expect(plan.ok).toBe(false)
      expect(plan.problemas.map((p) => p.codigo)).toContain(codigo)
      expect(plan.operaciones).toEqual([]) // un plan no válido no entrega ninguna operación
    })
  }

  it('demasiadas operaciones: se rechaza el plan entero', async () => {
    const p = paqueteSintetico()
    const extra = Array.from({ length: MAX_OPERACIONES }, (_, i) => ({ ...p.teams[1].rows[0], source_ref: `S/BETA#x${i}`, jersey: i % 100, first_name: 'N', surname: 'S' }))
    p.teams[1].rows.push(...extra)
    p.teams[1].counts.candidates = p.teams[1].rows.length
    p.totals.ready = 5 + MAX_OPERACIONES
    const m = await mapeoDe(p, 'LIGA1')
    const plan = await construirPlan({ paqueteTexto: m.texto, mapeo: m.mapeo })
    expect(plan.problemas.map((x) => x.codigo)).toContain('demasiadas-operaciones')
  })

  it('el origen de aplicar solo puede ser local', () => {
    for (const bueno of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787', 'https://127.0.0.1']) expect(validarOrigenLocal(bueno).origen).toBeTruthy()
    for (const malo of ['https://sebel.example', 'http://192.168.1.5:8787', 'http://127.0.0.1.evil.example', 'http://user:pw@127.0.0.1', 'http://127.0.0.1/ruta', 'ftp://127.0.0.1', 'no es una url', 'http://127.0.0.1?x=1']) {
      expect(validarOrigenLocal(malo).error).toBeTruthy()
    }
  })
})

describe('aplicar: puertas previas, sin tocar la red cuando no se debe', () => {
  it('destino no local, sin credencial o plan inválido: cero peticiones y cero diario', async () => {
    const paquete = paqueteSintetico()
    const { texto, mapeo } = await mapeoDe(paquete, 'LIGA1')
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const roto = await construirPlan({ paqueteTexto: texto, mapeo: { ...mapeo, identidades: {} } })
    for (const [entrada, esperado] of [
      [{ plan, origen: 'https://produccion.example', codigo: 'x'.repeat(20) }, 'origen-no-local'],
      [{ plan, origen: LOCAL, codigo: '' }, 'sin-credencial'],
      [{ plan: roto, origen: LOCAL, codigo: 'x'.repeat(20) }, 'plan-invalido'],
      [{ plan, origen: LOCAL, accesoOrigen: 'http://no-https', codigo: 'x'.repeat(20) }, 'acceso-origen-invalido'],
    ]) {
      const f = red()
      const almacen = almacenEnMemoria()
      const r = await aplicar({ ...base(), ...entrada, almacen, fetch: f })
      expect(r.estado).toBe(esperado)
      expect(f.registro).toEqual([])
      expect(almacen.escrituras).toBe(0)
    }
  })

  it('sin la decisión de identidad de UNA fila no se escribe NINGUNA (ni siquiera las demás) y el servidor no recibe altas', async () => {
    const { ligaId, codigo } = await escenario()
    const paquete = paqueteSintetico()
    const m = await mapeoDe(paquete, ligaId)
    delete m.mapeo.identidades['S/BETA#p1r2']
    const plan = await construirPlan({ paqueteTexto: m.texto, mapeo: m.mapeo })
    const f = red()
    const almacen = almacenEnMemoria()
    const r = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(r).toMatchObject({ estado: 'plan-invalido' })
    expect(r.problemas).toContainEqual({ codigo: 'falta-decision-de-identidad', ref: 'S/BETA#p1r2' })
    expect(f.registro).toEqual([])
    expect(await jugadores(ligaId)).toEqual([])
  })

  it('una liga que el organizador no posee, o un equipo destino inexistente, se detecta ANTES de escribir', async () => {
    const { ligaId, codigo } = await escenario()
    const paquete = paqueteSintetico()
    const ajena = await mapeoDe(paquete, 'LIGA99')
    const f1 = red()
    expect(await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: ajena.texto, mapeo: ajena.mapeo }), almacen: almacenEnMemoria(), fetch: f1, codigo })).toMatchObject({ estado: 'liga-no-poseida' })
    const sinEquipo = await mapeoDe(paquete, ligaId, { equipos: { 'S/ALFA': 'EQ1', 'S/BETA': 'EQ7' } })
    const almacen = almacenEnMemoria()
    const f2 = red()
    expect(await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: sinEquipo.texto, mapeo: sinEquipo.mapeo }), almacen, fetch: f2, codigo })).toMatchObject({ estado: 'equipo-destino-inexistente' })
    expect(f2.escrituras()).toEqual([])
    expect(almacen.escrituras).toBe(0)
    expect(await jugadores(ligaId)).toEqual([])
  })

  it('una credencial incorrecta no inicia sesión y no escribe nada', async () => {
    const { ligaId } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const f = red()
    const r = await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: texto, mapeo }), almacen: almacenEnMemoria(), fetch: f, codigo: 'AAAAA-BBBBB-CCCCC-DDDDD' })
    expect(r.estado).toBe('sesion-no-iniciada')
    expect(f.escrituras()).toEqual([])
  })
})

describe('aplicar + verificar: carga sintética de extremo a extremo', () => {
  it('aplica solo las listas, con alias y sin fecha de nacimiento; el diario guarda los identificadores acuñados; la verificación lee de vuelta', async () => {
    const { ligaId, codigo } = await escenario()
    const paquete = paqueteSintetico()
    const { texto, mapeo } = await mapeoDe(paquete, ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const f = red()
    const almacen = almacenEnMemoria()
    const r = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(r).toEqual({ estado: 'completo', total: 5, aplicadas: 5, reproducidas: 0 })

    const filas = await jugadores(ligaId)
    expect(filas.map((x) => [x.equipo_id, x.nombre_pila, x.apellido1, x.dorsal, x.nombre_camiseta, x.activo])).toEqual([
      ['EQ1', 'Beto', 'De la Muestra', 0, '', 1], ['EQ1', 'Ana', 'Prueba', 7, '', 1], ['EQ1', 'Cleo', 'Tres', 12, 'CLEITO', 1],
      ['EQ2', 'Eva', 'Visita', 7, '', 1], ['EQ2', 'Fito', 'Dos', 8, '', 1],
    ])
    expect(new Set(filas.map((x) => x.persona_id)).size).toBe(5) // 'otra-persona' explícito → cinco personas
    expect((await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM jugadores WHERE fecha_nacimiento IS NOT NULL'))[0].n).toBe(0)
    // El número 7 se repite entre EQUIPOS distintos, pero nunca dentro de uno.
    const diario = JSON.parse(almacen.texto)
    expect(diario.ops.every((o) => o.estado === 'aplicada' && /^f-/.test(o.resultado.fichaId) && /^pr-/.test(o.resultado.personaId))).toBe(true)
    expect(new Set(diario.ops.map((o) => o.operacionId)).size).toBe(5)

    const v = await verificar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(v.comprobaciones.filter((c) => !c.ok)).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.comprobaciones.map((c) => c.codigo)).toEqual(expect.arrayContaining([
      'todas-las-operaciones-aplicadas', 'cantidad-activos:' + ligaId + '/EQ1', 'numeros-unicos:' + ligaId + '/EQ1', 'fichas-del-diario-coinciden:' + ligaId + '/EQ2',
      'publico-liga-200:' + ligaId, 'publico-equipo-sin-campos-privados:' + ligaId + '/EQ1', 'publico-partidos-validos:' + ligaId,
    ]))
    const partidos = v.comprobaciones.find((c) => c.codigo === `publico-partidos-validos:${ligaId}`)
    expect(partidos.detalle).toEqual({ partidos: 1, estados: ['programado'] })
  })

  it('ni el código del organizador ni la cookie aparecen en direcciones, diario, historial del diario ni resultados', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    let cookie = null
    const f = red({ despues: (r) => { const m = /__Host-sesion=([^;]+)/.exec(r.headers.get('set-cookie') ?? ''); if (m) cookie = m[1]; return r } })
    const almacen = almacenEnMemoria()
    const r = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    const v = await verificar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(cookie).toBeTruthy()
    const secretos = [codigo, codigo.replaceAll('-', ''), cookie]
    const salidas = JSON.stringify([f.registro.map((x) => x.url), almacen.historial, r, v, resumenDelPlan(plan), plan.operaciones.map((o) => o.ruta)])
    for (const s of secretos) expect(salidas).not.toContain(s)
    // Solo el cuerpo del inicio de sesión lleva el código (nunca la dirección ni las cabeceras).
    for (const x of f.registro) {
      expect(JSON.stringify(x.cabeceras)).not.toContain(codigo)
      if (!x.url.endsWith('/v1/acceso/organizador')) expect(String(x.cuerpo ?? '')).not.toContain(codigo)
    }
  })

  it('reaplicar con el mismo diario es un no-op: nada se envía de nuevo y no hay duplicados', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria()
    await aplicar({ ...base(), plan, almacen, fetch: red(), codigo })
    const f = red()
    const otra = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(otra).toEqual({ estado: 'completo', total: 5, aplicadas: 0, reproducidas: 0 })
    expect(f.escrituras()).toEqual([])
    expect(await jugadores(ligaId)).toHaveLength(5)
  })

  it('un diario de otro plan (o de otro destino) no se reutiliza', async () => {
    const { ligaId, codigo } = await escenario()
    const a = await mapeoDe(paqueteSintetico(), ligaId)
    const almacen = almacenEnMemoria()
    await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: a.texto, mapeo: a.mapeo }), almacen, fetch: red(), codigo })
    const otroPaquete = paqueteSintetico()
    otroPaquete.teams[1].rows[1].first_name = 'Otro'
    const b = await mapeoDe(otroPaquete, ligaId)
    const f = red()
    const r = await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: b.texto, mapeo: b.mapeo }), almacen, fetch: f, codigo })
    expect(r.estado).toBe('diario-de-otro-plan')
    expect(f.escrituras()).toEqual([])
  })
})

describe('respuesta perdida o interrupción: solo se reintenta lo idéntico', () => {
  it('la petición llegó, la respuesta se perdió: queda sin resolver; el reintento reenvía el MISMO cuerpo y NO duplica', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria()
    let altas = 0
    const f1 = red({ despues: async (r, e) => { if (e.metodo === 'POST' && e.url.includes('/jugadores') && (altas += 1) === 3) throw new TypeError('red cortada (prueba)'); return r } })
    const primera = await aplicar({ ...base(), plan, almacen, fetch: f1, codigo })
    expect(primera).toMatchObject({ estado: 'detenido-sin-resolver', aplicadas: 2 })
    expect(await jugadores(ligaId)).toHaveLength(3) // la tercera SÍ se aplicó en el servidor
    const diario1 = JSON.parse(almacen.texto)
    expect(diario1.ops.map((o) => o.estado)).toEqual(['aplicada', 'aplicada', 'incierta', 'pendiente', 'pendiente'])
    const sinResolver = diario1.ops[2]

    const f2 = red()
    const segunda = await aplicar({ ...base(), plan, almacen, fetch: f2, codigo })
    expect(segunda).toEqual({ estado: 'completo', total: 5, aplicadas: 2, reproducidas: 1 })
    // El primer envío del reintento es EXACTAMENTE la operación sin resolver: mismo identificador, mismo cuerpo.
    const primeraEscritura = f2.escrituras()[0]
    expect(primeraEscritura.cuerpo).toBe(sinResolver.cuerpo)
    expect(JSON.parse(primeraEscritura.cuerpo).operacionId).toBe(sinResolver.operacionId)
    expect(await jugadores(ligaId)).toHaveLength(5)
    expect(new Set((await jugadores(ligaId)).map((x) => x.id)).size).toBe(5)
    // Un solo recibo por operación; ningún identificador de reemplazo.
    expect((await sqlDe(ligaId, 'SELECT COUNT(*) AS n FROM operaciones_plantilla'))[0].n).toBe(5)
    const idsFinales = JSON.parse(almacen.texto).ops.map((o) => o.operacionId)
    expect(idsFinales).toEqual(plan.operaciones.map((o) => o.operacionId))
  })

  it('la petición nunca llegó: el reintento la aplica con el mismo identificador', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria()
    let altas = 0
    const f1 = red({ antes: (e) => { if (e.metodo === 'POST' && e.url.includes('/jugadores') && (altas += 1) === 2) throw new TypeError('sin red (prueba)') } })
    expect(await aplicar({ ...base(), plan, almacen, fetch: f1, codigo })).toMatchObject({ estado: 'detenido-sin-resolver', aplicadas: 1 })
    expect(await jugadores(ligaId)).toHaveLength(1)
    const segunda = await aplicar({ ...base(), plan, almacen, fetch: red(), codigo })
    expect(segunda).toEqual({ estado: 'completo', total: 5, aplicadas: 4, reproducidas: 0 })
    expect(await jugadores(ligaId)).toHaveLength(5)
  })

  it('respuestas inciertas (503, 401 por sesión caída, cuerpo inesperado) detienen la ejecución y no cambian el identificador', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    for (const estado of [503, 401, 500]) {
      const almacen = almacenEnMemoria()
      let altas = 0
      const f = red({ despues: (r, e) => (e.metodo === 'POST' && e.url.includes('/jugadores') && (altas += 1) === 1 ? new Response('{}', { status: estado }) : r) })
      const r = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
      expect(r).toMatchObject({ estado: 'detenido-sin-resolver', motivo: `http-${estado}` })
      expect(f.escrituras()).toHaveLength(1) // no sigue a ciegas
      expect(JSON.parse(almacen.texto).ops[0].estado).toBe('incierta')
      // Limpia lo que sí llegó antes de la siguiente vuelta del bucle.
      await dentro(ligaId, (inst) => { for (const t of ['jugadores', 'operaciones_plantilla', 'auditoria_plantilla']) inst.almacen.sql.exec(`DELETE FROM ${t}`).toArray() })
    }
  })
})

describe('el diario va primero', () => {
  it('si el diario inicial no se puede guardar, NO se envía ninguna alta', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const f = red()
    const r = await aplicar({ ...base(), plan, almacen: almacenEnMemoria({ fallaEscritura: () => true }), fetch: f, codigo })
    expect(r.estado).toBe('diario-no-guardado')
    expect(f.escrituras()).toEqual([])
    expect(await jugadores(ligaId)).toEqual([])
  })

  it('si no se puede anotar "enviando" antes de una operación, esa operación no se envía', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const f = red()
    // escritura 1: diario inicial; 2: enviando(op1); 3: resultado(op1); 4: enviando(op2) ← falla
    const r = await aplicar({ ...base(), plan, almacen: almacenEnMemoria({ fallaEscritura: (n) => n === 4 }), fetch: f, codigo })
    expect(r.estado).toBe('diario-no-guardado')
    expect(f.escrituras()).toHaveLength(1)
    expect(await jugadores(ligaId)).toHaveLength(1)
  })

  it('si falla guardar el RESULTADO, la operación queda "enviando" en el diario y su reintento es idéntico, sin duplicar', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria({ fallaEscritura: (n) => n === 3 }) // el resultado de la primera operación
    const r = await aplicar({ ...base(), plan, almacen, fetch: red(), codigo })
    expect(r.estado).toBe('diario-no-guardado')
    expect(JSON.parse(almacen.texto).ops[0].estado).toBe('enviando')
    expect(await jugadores(ligaId)).toHaveLength(1)
    const f = red()
    const otra = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(otra).toEqual({ estado: 'completo', total: 5, aplicadas: 4, reproducidas: 1 })
    expect(JSON.parse(f.escrituras()[0].cuerpo).operacionId).toBe(plan.operaciones[0].operacionId)
    expect(await jugadores(ligaId)).toHaveLength(5)
  })

  it('el diario inicial lleva ya todos los cuerpos exactos (para poder reintentarlos) y ningún secreto', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria()
    await aplicar({ ...base(), plan, almacen, fetch: red(), codigo })
    const inicial = JSON.parse(almacen.historial[0])
    expect(inicial.ops.map((o) => o.estado)).toEqual(Array(5).fill('pendiente'))
    expect(inicial.ops.map((o) => o.cuerpo)).toEqual(plan.operaciones.map((o) => o.cuerpo))
    expect(almacen.historial[0]).not.toContain(codigo)
  })
})

describe('conflictos y rechazos: se detiene, no se rebasan solos', () => {
  it('un número ya ocupado en el servidor se rechaza; el ejecutor se detiene, no envía las demás y se niega a seguir con ese diario', async () => {
    const { ligaId, codigo } = await escenario()
    await dentro(ligaId, (inst) => {
      inst.almacen.sql.exec("INSERT INTO jugadores (id, liga_id, equipo_id, persona_id, nombre_pila, apellido1, nombre, dorsal, activo, rev) VALUES ('PREVIO', ?, 'EQ1', 'persona-previa', 'Previo', 'Existente', 'Previo Existente', 7, 1, 1)", ligaId).toArray()
    })
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria()
    const f = red()
    const r = await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(r).toMatchObject({ estado: 'detenido-por-rechazo', sourceRef: 'S/ALFA#p1r1', motivo: 'conflicto-numero' })
    expect(f.escrituras()).toHaveLength(1)
    expect(await jugadores(ligaId)).toHaveLength(1) // solo el previo
    expect(JSON.parse(almacen.texto).ops.map((o) => o.estado)).toEqual(['rechazada', 'pendiente', 'pendiente', 'pendiente', 'pendiente'])
    const f2 = red()
    expect(await aplicar({ ...base(), plan, almacen, fetch: f2, codigo })).toMatchObject({ estado: 'diario-con-rechazo' })
    expect(f2.escrituras()).toEqual([])
  })

  it('una decisión "misma persona" con una persona inexistente en la liga se rechaza (el servidor la verifica) y se detiene', async () => {
    const { ligaId, codigo } = await escenario()
    const paquete = paqueteSintetico()
    const identidades = { ...decisiones(paquete), 'S/ALFA#p1r1': { tipo: 'misma-persona', personaId: 'pr-inventada' } }
    const { texto, mapeo } = await mapeoDe(paquete, ligaId, { identidades })
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const r = await aplicar({ ...base(), plan, almacen: almacenEnMemoria(), fetch: red(), codigo })
    expect(r).toMatchObject({ estado: 'detenido-por-rechazo', motivo: 'identidad-invalida' })
    expect(await jugadores(ligaId)).toEqual([])
  })

  it('un nombre repetido en la misma liga no se fusiona solo: con la decisión explícita "otra-persona" nace otra persona', async () => {
    const e = await escenario()
    const m1 = await mapeoDe(paqueteSintetico(), e.ligaId)
    await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: m1.texto, mapeo: m1.mapeo }), almacen: almacenEnMemoria(), fetch: red(), codigo: e.codigo })
    const antes = (await jugadores(e.ligaId)).map((x) => x.persona_id)
    // Otro paquete: una fila nueva (otra referencia) con el MISMO nombre que una ficha ya existente de otro equipo.
    const dup = paqueteSintetico()
    dup.teams = [{ ...dup.teams[1], team_key: 'S/BETA', rows: [{ ...dup.teams[1].rows[0], source_ref: 'S/BETA#p2r1', first_name: 'Ana', surname: 'Prueba', jersey: 20 }], excluded_rows: [], counts: { candidates: 1 } }]
    dup.totals = { ready: 1 }
    const m2 = await mapeoDe(dup, e.ligaId)
    const almacen = almacenEnMemoria()
    const r = await aplicar({ ...base(), plan: await construirPlan({ paqueteTexto: m2.texto, mapeo: m2.mapeo }), almacen, fetch: red(), codigo: e.codigo })
    expect(r).toMatchObject({ estado: 'completo', aplicadas: 1 })
    const despues = (await jugadores(e.ligaId)).map((x) => x.persona_id)
    expect(despues).toHaveLength(6)
    expect(new Set(despues).size).toBe(6) // misma ortografía, personas distintas: nada se fusiona por nombre
    expect(antes.every((p) => despues.includes(p))).toBe(true)
    expect(JSON.parse(JSON.parse(almacen.texto).ops[0].cuerpo).resolucionIdentidad).toEqual({ tipo: 'otra-persona' }) // la decisión viajó explícita
  })
})

describe('verificar: compara contenido, no solo recuentos', () => {
  async function cargado() {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    const almacen = almacenEnMemoria()
    const f = red()
    await aplicar({ ...base(), plan, almacen, fetch: f, codigo })
    return { ligaId, codigo, plan, almacen, f }
  }
  const falla = (v, prefijo) => v.comprobaciones.filter((c) => !c.ok).map((c) => c.codigo).filter((c) => c.startsWith(prefijo))

  it('una ficha cambiada fuera del ejecutor (mismo recuento) se detecta', async () => {
    const { ligaId, codigo, plan, almacen, f } = await cargado()
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE jugadores SET dorsal = 44 WHERE nombre_pila = 'Ana'").toArray() })
    const v = await verificar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(v.ok).toBe(false)
    expect(falla(v, 'fichas-del-diario-coinciden')).toEqual([`fichas-del-diario-coinciden:${ligaId}/EQ1`])
    expect(falla(v, 'cantidad-activos')).toEqual([])
    expect(falla(v, 'publico-plantilla-numeros')).toEqual([`publico-plantilla-numeros:${ligaId}/EQ1`])
  })

  it('un alias perdido, una ficha extra y una ficha desactivada se detectan', async () => {
    const { ligaId, codigo, plan, almacen, f } = await cargado()
    await dentro(ligaId, (inst) => {
      inst.almacen.sql.exec("UPDATE jugadores SET nombre_camiseta = NULL WHERE nombre_pila = 'Cleo'").toArray()
      inst.almacen.sql.exec("INSERT INTO jugadores (id, liga_id, equipo_id, persona_id, nombre_pila, apellido1, nombre, dorsal, activo, rev) VALUES ('EXTRA', ?, 'EQ2', 'persona-extra', 'Extra', 'Ficha', 'Extra Ficha', 9, 1, 1)", ligaId).toArray()
      inst.almacen.sql.exec("UPDATE jugadores SET activo = 0 WHERE nombre_pila = 'Eva'").toArray()
    })
    const v = await verificar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(v.ok).toBe(false)
    expect(falla(v, 'fichas-del-diario-coinciden')).toEqual([`fichas-del-diario-coinciden:${ligaId}/EQ1`, `fichas-del-diario-coinciden:${ligaId}/EQ2`])
    expect(falla(v, 'nombre-del-equipo')).toEqual([])
  })

  it('un diario con operaciones sin resolver o un nombre de equipo distinto hacen fallar la verificación', async () => {
    const { ligaId, codigo, plan, almacen, f } = await cargado()
    const d = JSON.parse(almacen.texto)
    d.ops[1].estado = 'incierta'
    almacen.texto = JSON.stringify(d)
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE equipos SET nombre = 'Otro nombre' WHERE id = 'EQ1'").toArray() })
    const v = await verificar({ ...base(), plan, almacen, fetch: f, codigo })
    expect(v.ok).toBe(false)
    expect(falla(v, 'todas-las-operaciones-aplicadas')).toHaveLength(1)
    expect(falla(v, 'nombre-del-equipo')).toEqual([`nombre-del-equipo:${ligaId}/EQ1`])
  })

  it('un campo privado en una lectura pública se detecta', async () => {
    const { ligaId, codigo, plan, almacen } = await cargado()
    const filtrada = red({ despues: async (r, e) => {
      if (!e.url.includes('/publico') || r.status !== 200) return r
      const j = await r.json()
      return new Response(JSON.stringify({ ...j, plantilla: (j.plantilla ?? []).map((x) => ({ ...x, personaId: 'pr-x' })), partidos: j.partidos }), { status: 200 })
    } })
    const v = await verificar({ ...base(), plan, almacen, fetch: filtrada, codigo })
    expect(v.ok).toBe(false)
    expect(falla(v, 'publico-equipo-sin-campos-privados').length).toBeGreaterThan(0)
  })

  it('sin diario o con destino no local, la verificación falla sin tocar nada', async () => {
    const { ligaId, codigo } = await escenario()
    const { texto, mapeo } = await mapeoDe(paqueteSintetico(), ligaId)
    const plan = await construirPlan({ paqueteTexto: texto, mapeo })
    expect((await verificar({ ...base(), plan, almacen: almacenEnMemoria(), fetch: red(), codigo })).comprobaciones[0].codigo).toBe('diario-ausente')
    const f = red()
    expect((await verificar({ ...base({ origen: 'https://x.example' }), plan, almacen: almacenEnMemoria(), fetch: f, codigo })).comprobaciones[0].codigo).toBe('origen-no-local')
    expect(f.registro).toEqual([])
  })
})
