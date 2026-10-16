import 'fake-indexeddb/auto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Slice C: comandos del reloj y del partido, auditados y atómicos. Cada uno
// cambia el partido y agrega su registro en auditoriaReloj en una sola
// transacción; un rechazo no escribe nada. Estas pruebas cubren pestañas que
// comparten una misma base IndexedDB, no sincronización entre dispositivos.
// ---------------------------------------------------------------------------

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

let db
let R // lib/reloj
let M // lib/marcador
let ahora

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
  ahora = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => ahora)
  ;({ db } = await import('../db.js'))
  R = await import('./reloj.js')
  M = await import('./marcador.js')
})

afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await borrarBd()
})

async function sembrar({ estado = 'vivo', reloj = {}, deporte = 'baloncesto', sesion = true, sinReloj = false } = {}) {
  await db.ligas.add({ id: 'L', deporte, nombre: 'Liga', organizadorId: 'yo' })
  // Un inicio exige dos equipos válidos de la liga (Decisión 115); las plantillas vacías pasan.
  await db.equipos.bulkAdd([{ id: 'EL', ligaId: 'L', nombre: 'Local' }, { id: 'EV', ligaId: 'L', nombre: 'Visita' }])
  const base = sinReloj ? {} : { relojEstado: 'detenido', relojRestante: 600000, relojDesde: null }
  await db.partidos.add({ id: 'P', ligaId: 'L', localId: 'EL', visitaId: 'EV', estado, ...base, ...reloj })
  if (sesion) await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
}

const obs = async () => R.observadoDe(await db.partidos.get('P'), await R.ultimoSeqAuditoria('P'))
const registros = () => db.auditoriaReloj.where('partidoId').equals('P').toArray().then((r) => r.sort((a, b) => a.seq - b.seq))
const foto = async () => ({
  partido: await db.partidos.get('P'),
  eventos: (await db.eventos.toArray()).sort((a, b) => a.seq - b.seq),
  registros: await registros(),
})
const pasar = (ms) => { ahora += ms }

const arrancar = async () => R.arrancarReloj('P', await obs())
const detener = async (opciones) => R.detenerReloj('P', await obs(), opciones)
const iniciar = async () => R.iniciarPartido('P', await obs())
const cerrar = async () => R.cerrarPartido('P', await obs())
const siguiente = async () => {
  const ev = await db.eventos.where('partidoId').equals('P').toArray()
  const liga = await db.ligas.get('L')
  return R.siguientePeriodo({ id: 'P' }, liga, M.periodoVisible(ev, liga.deporte), M.marcaDePeriodo(ev), await obs())
}

describe('cada comando escribe su cambio y su registro', () => {
  it('inicio-partido', async () => {
    await sembrar({ estado: 'programado', sinReloj: true })
    expect(await iniciar()).toEqual({ ok: true, comando: 'inicio-partido' })
    expect(await db.partidos.get('P')).toMatchObject({
      estado: 'vivo', inicio: new Date(ahora).toISOString(), relojEstado: 'detenido', relojRestante: 600000, relojDesde: null,
    })
    const [r] = await registros()
    expect(r).toMatchObject({
      seq: 1, reloj: 'juego', comando: 'inicio-partido', periodo: 1, origen: 'consola', actorId: 'yo',
      ts: new Date(ahora).toISOString(),
      antes: { estado: 'programado', relojEstado: null, relojRestante: null, relojDesde: null },
      despues: { estado: 'vivo', relojEstado: 'detenido', relojRestante: 600000, relojDesde: null, efectivoMs: 600000 },
    })
    expect(typeof r.id).toBe('string')
  })

  it('arrancar', async () => {
    await sembrar({ reloj: { relojRestante: 123000 } })
    expect((await arrancar()).ok).toBe(true)
    expect(await db.partidos.get('P')).toMatchObject({ relojEstado: 'corriendo', relojRestante: 123000, relojDesde: ahora })
    const [r] = await registros()
    expect(r).toMatchObject({
      comando: 'arrancar', origen: 'consola',
      antes: { relojEstado: 'detenido', relojRestante: 123000, relojDesde: null, efectivoMs: 123000 },
      despues: { relojEstado: 'corriendo', relojRestante: 123000, relojDesde: ahora, efectivoMs: 123000 },
    })
  })

  it('detener (manual): guarda el tiempo efectivo, y el registro distingue lo guardado de lo efectivo', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 100000, relojDesde: ahora } })
    pasar(30000)
    expect((await detener()).ok).toBe(true)
    expect(await db.partidos.get('P')).toMatchObject({ relojEstado: 'detenido', relojRestante: 70000, relojDesde: null })
    const [r] = await registros()
    expect(r.comando).toBe('detener')
    expect(r.antes).toMatchObject({ relojRestante: 100000, efectivoMs: 70000 }) // guardado vs efectivo
    expect(r.despues).toMatchObject({ relojRestante: 70000, efectivoMs: 70000, relojDesde: null })
  })

  it('parada-automatica: solo con el reloj corriendo y sin tiempo; origen sistema y sin actor', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora } })
    const antesDeTiempo = await foto()
    expect(await detener({ origen: 'sistema' })).toEqual({ ok: false, motivo: 'aun-hay-tiempo' })
    expect(await foto()).toEqual(antesDeTiempo)

    pasar(5000)
    expect((await detener({ origen: 'sistema' })).comando).toBe('parada-automatica')
    expect(await db.partidos.get('P')).toMatchObject({ relojEstado: 'detenido', relojRestante: 0, relojDesde: null })
    const [r] = await registros()
    expect(r).toMatchObject({ comando: 'parada-automatica', origen: 'sistema', actorId: null, ceroEnDerivado: ahora - 5000 + 1000 })
  })

  it('detener en cero a mano se clasifica por quien lo pide: detener, con la sesión', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora } })
    pasar(5000)
    expect((await detener()).comando).toBe('detener')
    expect((await registros())[0]).toMatchObject({ comando: 'detener', origen: 'consola', actorId: 'yo' })
  })

  it('reinicio-periodo: evento, reinicio del reloj y registro juntos, con el periodo antes y después', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: ahora } })
    expect((await siguiente()).ok).toBe(true)
    const ev = await db.eventos.toArray()
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ tipo: 'periodo', periodo: 1 })
    expect(await db.partidos.get('P')).toMatchObject({ relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    const [r] = await registros()
    expect(r).toMatchObject({
      comando: 'reinicio-periodo', periodo: 1, periodoDespues: 2, eventoPeriodoId: ev[0].id,
      antes: { relojEstado: 'corriendo' }, despues: { relojEstado: 'detenido', relojRestante: 600000 },
    })
  })

  it('cierre-partido: detiene el reloj en su tiempo efectivo, queda final y no toca ninguna cuenta', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 100000, relojDesde: ahora } })
    const espiasCuenta = ['get', 'update', 'put', 'add', 'toArray', 'bulkPut'].map((m) => vi.spyOn(db.cuenta, m))
    pasar(40000)
    expect((await cerrar()).ok).toBe(true)
    expect(await db.partidos.get('P')).toMatchObject({ estado: 'final', relojEstado: 'detenido', relojRestante: 60000, relojDesde: null })
    const [r] = await registros()
    expect(r).toMatchObject({
      comando: 'cierre-partido',
      antes: { estado: 'vivo', relojEstado: 'corriendo', relojRestante: 100000, efectivoMs: 60000 },
      despues: { estado: 'final', relojEstado: 'detenido', relojRestante: 60000, efectivoMs: 60000 },
    })
    expect(Object.keys(r).some((k) => /saldo|cuenta/i.test(k))).toBe(false)
    espiasCuenta.forEach((e) => expect(e).not.toHaveBeenCalled())
    expect(await db.cuenta.count()).toBe(0) // y funciona sin ninguna cuenta
  })

  it('la cadena del audit es continua en los campos guardados; el tiempo efectivo cambia con el paso del tiempo', async () => {
    await sembrar({ estado: 'programado', sinReloj: true })
    await iniciar()
    await arrancar()
    pasar(10000)
    await detener()
    await arrancar()
    pasar(20000)
    await siguiente() // reinicia el reloj
    await arrancar()
    pasar(700000)
    await detener({ origen: 'sistema' })
    await cerrar()

    const rs = await registros()
    expect(rs.map((r) => r.comando)).toEqual([
      'inicio-partido', 'arrancar', 'detener', 'arrancar', 'reinicio-periodo', 'arrancar', 'parada-automatica', 'cierre-partido',
    ])
    expect(rs.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const guardados = ({ estado, relojEstado, relojRestante, relojDesde }) => ({ estado, relojEstado, relojRestante, relojDesde })
    for (let i = 1; i < rs.length; i++) expect(guardados(rs[i].antes)).toEqual(guardados(rs[i - 1].despues))
    // Entre "arrancar" y el siguiente registro pasó el tiempo: lo efectivo no coincide, lo guardado sí.
    expect(rs[2].antes.efectivoMs).toBeLessThan(rs[1].despues.efectivoMs)
    expect(rs[2].antes.relojRestante).toBe(rs[1].despues.relojRestante)
  })
})

describe('precondiciones: un rechazo no escribe nada', () => {
  it.each([
    ['arrancar con el reloj en marcha', { reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 1 } }, () => arrancar(), 'ya-corriendo'],
    ['arrancar sin tiempo', { reloj: { relojRestante: 0 } }, () => arrancar(), 'sin-tiempo'],
    ['detener con el reloj detenido', {}, () => detener(), 'no-corre'],
  ])('%s', async (_n, opciones, accion, motivo) => {
    await sembrar(opciones)
    const antes = await foto()
    expect(await accion()).toEqual({ ok: false, motivo })
    expect(await foto()).toEqual(antes)
  })

  it.each([
    ['programado', () => arrancar()], ['programado', () => detener()], ['programado', () => cerrar()], ['programado', () => siguiente()],
    ['final', () => arrancar()], ['final', () => detener({ origen: 'sistema' })], ['final', () => iniciar()], ['final', () => cerrar()], ['final', () => siguiente()],
    ['vivo', () => iniciar()],
  ])('un partido %s rechaza el comando', async (estado, accion) => {
    await sembrar({ estado })
    const antes = await foto()
    expect(await accion()).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado })
    expect(await foto()).toEqual(antes)
  })

  it('un partido inexistente rechaza sin escribir', async () => {
    expect(await R.arrancarReloj('NO', { seq: 0 })).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado: null })
    expect(await db.auditoriaReloj.count()).toBe(0)
  })
})

describe('atribución', () => {
  it('con sesión: el actor es la cuenta del prototipo; sin sesión: nulo; el automático: sistema y nulo', async () => {
    await sembrar()
    await arrancar()
    expect((await registros())[0]).toMatchObject({ origen: 'consola', actorId: 'yo' })
    await db.meta.delete('sesion')
    await detener()
    expect((await registros())[1]).toMatchObject({ origen: 'consola', actorId: null })
  })
})

describe('duplicados y comandos simultáneos', () => {
  const carrera = async (n, comandoConObservado) => {
    const o = await obs()
    return Promise.all(Array.from({ length: n }, () => comandoConObservado(o)))
  }

  it.each([
    ['arrancar', {}, (o) => R.arrancarReloj('P', o), 'reloj-desactualizado'],
    ['detener', { reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 1_700_000_000_000 } }, (o) => R.detenerReloj('P', o), 'reloj-desactualizado'],
    ['inicio', { estado: 'programado', sinReloj: true }, (o) => R.iniciarPartido('P', o), 'partido-no-disponible'],
    ['cierre', {}, (o) => R.cerrarPartido('P', o), 'partido-no-disponible'],
  ])('%s repetido a la vez: uno gana, el resto no escribe', async (_n, opciones, comandoConObservado, motivoDelResto) => {
    await sembrar(opciones)
    const rs = await carrera(4, comandoConObservado)
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    rs.filter((r) => !r.ok).forEach((r) => expect(r.motivo).toBe(motivoDelResto))
    expect(await registros()).toHaveLength(1)
  })

  it('la parada automática repetida (ticks) deja un solo registro', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora } })
    pasar(5000)
    const rs = await carrera(6, (o) => R.detenerReloj('P', o, { origen: 'sistema' }))
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(await registros()).toHaveLength(1)
    // Y un tick posterior, con la lectura ya actualizada, no hace nada.
    expect(await detener({ origen: 'sistema' })).toEqual({ ok: false, motivo: 'no-corre' })
    expect(await registros()).toHaveLength(1)
  })

  it('dos primeros comandos simultáneos sobre un partido sin registros: uno solo escribe', async () => {
    await sembrar()
    const rs = await carrera(2, (o) => R.arrancarReloj('P', o))
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
  })
})

describe('rollback', () => {
  const comandos = [
    ['inicio-partido', { estado: 'programado', sinReloj: true }, () => iniciar()],
    ['arrancar', {}, () => arrancar()],
    ['detener', { reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 1_700_000_000_000 } }, () => detener()],
    ['parada-automatica', { reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: 1_700_000_000_000 - 9000 } }, () => detener({ origen: 'sistema' })],
    ['reinicio-periodo', { reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 1_700_000_000_000 } }, () => siguiente()],
    ['cierre-partido', { reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 1_700_000_000_000 } }, () => cerrar()],
  ]

  it.each(comandos)('%s: si falla el registro, no queda ni el cambio ni el evento', async (_n, opciones, accion) => {
    await sembrar(opciones)
    const antes = await foto()
    vi.spyOn(db.auditoriaReloj, 'add').mockRejectedValueOnce(new Error('fallo simulado'))
    await expect(accion()).rejects.toThrow('fallo simulado')
    expect(await foto()).toEqual(antes)
  })

  it.each(comandos)('%s: si falla la escritura del partido, no queda ningún registro', async (_n, opciones, accion) => {
    await sembrar(opciones)
    const antes = await foto()
    vi.spyOn(db.partidos, 'update').mockRejectedValueOnce(new Error('fallo simulado'))
    await expect(accion()).rejects.toThrow('fallo simulado')
    expect(await foto()).toEqual(antes)
  })
})

describe('estado observado: una pantalla vieja no puede actuar sobre una corrida más nueva', () => {
  it('un Detener viejo no detiene la corrida nueva tras otra parada, cambio de periodo y arranque', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 300000, relojDesde: ahora } })
    const viejaObservacion = await obs() // pestaña A: corrida X en marcha
    pasar(1000)
    // Pestaña B: detiene, cambia de periodo y vuelve a arrancar (corrida Y).
    expect((await detener()).ok).toBe(true)
    expect((await siguiente()).ok).toBe(true)
    pasar(1000)
    expect((await arrancar()).ok).toBe(true)
    const corridaY = (await db.partidos.get('P')).relojDesde
    const antes = await foto()

    expect(await R.detenerReloj('P', viejaObservacion)).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await foto()).toEqual(antes)
    const ahoraP = await db.partidos.get('P')
    expect(ahoraP).toMatchObject({ relojEstado: 'corriendo', relojDesde: corridaY })
    expect((await registros()).map((r) => r.comando)).toEqual(['detener', 'reinicio-periodo', 'arrancar'])
  })

  it('un Arrancar viejo se rechaza aunque los campos guardados hayan vuelto a verse iguales (lo atrapa el seq)', async () => {
    await sembrar()
    const vieja = await obs()
    await arrancar()
    await detener() // mismo instante: relojRestante, relojDesde y relojEstado quedan como estaban
    expect((await db.partidos.get('P'))).toMatchObject({ relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    const antes = await foto()
    expect(await R.arrancarReloj('P', vieja)).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await foto()).toEqual(antes)
  })

  it('una parada automática vieja no detiene una corrida nueva', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora } })
    pasar(5000)
    const vieja = await obs() // A ve la corrida X agotada
    // B la detiene, cambia de periodo y arranca una corrida nueva (corre).
    await detener({ origen: 'sistema' })
    await siguiente()
    await arrancar()
    const antes = await foto()
    expect(await R.detenerReloj('P', vieja, { origen: 'sistema' })).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await foto()).toEqual(antes)
    expect((await db.partidos.get('P')).relojEstado).toBe('corriendo')
  })

  it('un cambio de periodo viejo y un cierre viejo se rechazan sin escribir', async () => {
    await sembrar()
    const ev = await db.eventos.where('partidoId').equals('P').toArray()
    const liga = await db.ligas.get('L')
    const vieja = await obs()
    await arrancar() // otra pestaña tocó el reloj
    const antes = await foto()
    expect(await R.siguientePeriodo({ id: 'P' }, liga, M.periodoVisible(ev, liga.deporte), M.marcaDePeriodo(ev), vieja))
      .toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await R.cerrarPartido('P', vieja)).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await foto()).toEqual(antes)
    expect((await db.partidos.get('P')).estado).toBe('vivo')
  })

  it('un inicio viejo no vuelve a comenzar un partido que ya comenzó', async () => {
    await sembrar({ estado: 'programado', sinReloj: true })
    const vieja = await obs()
    await iniciar()
    const antes = await foto()
    expect(await R.iniciarPartido('P', vieja)).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado: 'vivo' })
    expect(await foto()).toEqual(antes)
  })

  it('un cambio sin registro (escritura directa o dato antiguo) también invalida lo observado', async () => {
    await sembrar()
    const vieja = await obs()
    await db.partidos.update('P', { relojRestante: 555000 }) // sin auditoría
    expect(await R.arrancarReloj('P', vieja)).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await registros()).toHaveLength(0)
  })

  it('sin observación no se actúa: el comando exige el estado observado', async () => {
    await sembrar()
    expect(await R.arrancarReloj('P')).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await R.cerrarPartido('P', null)).toEqual({ ok: false, motivo: 'reloj-desactualizado' })
    expect(await registros()).toHaveLength(0)
  })
})

describe('rehacer pendiente y datos antiguos', () => {
  const evento = (campos) => ({
    id: `e${campos.seq}`, partidoId: 'P', anulado: false, creadoEn: 1, equipoId: 'E1', jugadorId: 'J1', ...campos,
  })

  it('ningún comando del reloj toca el rehacer pendiente ni los eventos; Deshacer/Rehacer/Anular no ven la auditoría', async () => {
    await sembrar({ estado: 'programado', sinReloj: true })
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'punto', puntos: 2, periodo: 1 }),
      evento({ seq: 2, tipo: 'punto', puntos: 3, periodo: 1, anulado: true, anuladoEn: 5 }),
    ])
    const soloMarcas = async () => (await db.eventos.toArray()).filter((e) => e.tipo === 'punto').sort((a, b) => a.seq - b.seq)
    const puntosAntes = await soloMarcas()
    await iniciar(); await arrancar(); pasar(1000); await detener(); await siguiente()
    await arrancar(); pasar(700000); await detener({ origen: 'sistema' })
    expect(await soloMarcas()).toEqual(puntosAntes)
    expect(M.hayQueRehacer(await db.eventos.toArray())).toBe(true)

    await cerrar() // y después del cierre se puede corregir
    expect((await M.rehacer('P')).resultado).toBe('rehecho')
    expect((await M.deshacer('P')).resultado).toBe('limite-periodo') // el último evento vivo es la transición
    expect(await registros()).toHaveLength(7)
  })

  it('un partido con reloj pero sin registros empieza su historia en el primer comando, sin inventar nada', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora - 9000 } })
    expect(await db.auditoriaReloj.count()).toBe(0)
    expect(await R.ultimoSeqAuditoria('P')).toBe(0)
    await detener({ origen: 'sistema' })
    const [r] = await registros()
    expect(r.seq).toBe(1)
    expect(r.antes).toMatchObject({ relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora - 9000, efectivoMs: 0 })
  })
})

describe('el reloj ya no tiene escritores sin auditar', () => {
  it('ajustarReloj ya no existe', () => {
    expect(R.ajustarReloj).toBeUndefined()
  })

  it('en el código de la app solo los comandos (reloj.js) y la siembra escriben el reloj', () => {
    const archivos = []
    const recorrer = (dir) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre)
        if (statSync(ruta).isDirectory()) recorrer(ruta)
        else if (/\.(js|jsx)$/.test(nombre) && !/\.test\./.test(nombre)) archivos.push(ruta)
      }
    }
    recorrer('src')
    const escribeReloj = archivos.filter((f) => /relojEstado\s*:|relojRestante\s*:|relojDesde\s*:/.test(readFileSync(f, 'utf8')))
    expect(escribeReloj.map((f) => f.replace(/\\/g, '/')).sort()).toEqual(['src/lib/reloj.js', 'src/seed.js'])

    // La consola no escribe partidos ni cuentas por su cuenta.
    const consola = readFileSync('src/pantallas/Consola.jsx', 'utf8')
    expect(consola).not.toMatch(/db\.(partidos|cuenta)\.(update|put|add|bulk\w+|delete)/)
    expect(consola).not.toMatch(/useCuenta/)
    expect(consola).not.toMatch(/−10s|\+10s/)
  })
})

// ---------------------------------------------------------------------------
// S4 — el inicio exige plantillas listas (Decisión 115). Se lee dentro de la
// misma transacción que escribe el inicio. Solo el inicio: los demás comandos
// no leen plantillas. Evidencia de fake-indexeddb: no prueba atomicidad en un
// navegador nativo ni en un servidor.
// ---------------------------------------------------------------------------
describe('inicio: plantillas listas', () => {
  const DUENO = { rol: 'organizador', cuentaId: 'yo' }
  const jug = (id, equipoId, dorsal, extra = {}) => ({
    id, ligaId: 'L', equipoId, nombre: id, nombrePila: id, apellido1: 'Ap', personaId: `p-${id}`, codigo: `c-${id}`,
    ...(dorsal === undefined ? {} : { dorsal }), ...extra,
  })
  const sembrarInicio = async (jugadores = []) => {
    await sembrar({ estado: 'programado', sinReloj: true })
    if (jugadores.length) await db.jugadores.bulkAdd(jugadores)
  }
  const rechaza = async (motivo) => {
    const antes = await foto()
    const r = await iniciar()
    expect(r).toMatchObject({ ok: false, motivo })
    expect(await foto()).toEqual(antes)
    return r
  }

  it('plantillas válidas, con #0 y fecha de nacimiento ausente, inician', async () => {
    await sembrarInicio([jug('a1', 'EL', 0), jug('a2', 'EL', 9), jug('b1', 'EV', 0), jug('b2', 'EV', 9, { fechaNacimiento: undefined })])
    expect(await iniciar()).toEqual({ ok: true, comando: 'inicio-partido' })
    expect((await db.partidos.get('P')).estado).toBe('vivo')
  })

  it('equipos sin jugadores inician: no hay mínimo inventado', async () => {
    await sembrarInicio()
    expect((await iniciar()).ok).toBe(true)
  })

  it('número pendiente (ausente) rechaza y no escribe nada; el detalle no trae nombres', async () => {
    await sembrarInicio([jug('a1', 'EL', 4), jug('b1', 'EV', undefined, { nombre: 'Nombre Privado' })])
    const r = await rechaza('plantilla-incompleta')
    expect(r.detalle.equipos).toEqual([{ equipoId: 'EV', nombre: 'Visita', sinNumero: 1, duplicados: [] }])
    expect(JSON.stringify(r)).not.toMatch(/Privado|p-b1|c-b1/)
  })

  it.each([['cadena "07"', '07'], ['cadena vacía', ''], ['NaN', NaN], ['fuera de rango', 100]])(
    'un número guardado mal formado (%s) rechaza y no se corrige', async (_n, dorsal) => {
      await sembrarInicio([jug('a1', 'EL', dorsal)])
      await rechaza('plantilla-incompleta')
      expect((await db.jugadores.get('a1')).dorsal).toEqual(dorsal)
    })

  it('repetidos rechazan, también dos #0', async () => {
    await sembrarInicio([jug('a1', 'EL', 0), jug('a2', 'EL', 0)])
    const r = await rechaza('plantilla-incompleta')
    expect(r.detalle.equipos[0].duplicados).toEqual([0])
  })

  it('inactivos pendientes o repetidos no bloquean', async () => {
    await sembrarInicio([jug('a1', 'EL', 4), jug('a2', 'EL', undefined, { activo: false }), jug('a3', 'EL', 4, { activo: false })])
    expect((await iniciar()).ok).toBe(true)
  })

  it('un cero a la izquierda aceptado por el dominio queda entero y pasa', async () => {
    const Roster = await import('./roster.js')
    await sembrarInicio()
    const liga = await db.ligas.get('L')
    const campos = { nombrePila: 'Ana', apellido1: 'Perez', apellido2: '', nombreCamiseta: '', fechaNacimiento: '' }
    for (const [equipoId, nombrePila, dorsal] of [['EL', 'Ana', '007'], ['EV', 'Bea', '0']]) {
      expect((await Roster.agregarJugador({ sesion: DUENO, liga, equipoId, campos: { ...campos, nombrePila, dorsal } })).tipo).toBe('creado')
    }
    expect((await db.jugadores.where('equipoId').equals('EL').first()).dorsal).toBe(7)
    expect((await iniciar()).ok).toBe(true)
  })

  it.each([
    ['liga inexistente', () => db.partidos.update('P', { ligaId: 'NO' })],
    ['visita inexistente', () => db.partidos.update('P', { visitaId: 'NO' })],
    ['local ausente', () => db.partidos.update('P', { localId: undefined })],
    ['el mismo equipo dos veces', () => db.partidos.update('P', { visitaId: 'EL' })],
    ['equipo de otra liga', () => db.equipos.update('EV', { ligaId: 'OTRA' })],
  ])('%s rechaza con equipos-invalidos sin escribir', async (_n, romper) => {
    await sembrarInicio([jug('a1', 'EL', 1)])
    await romper()
    const antes = await foto()
    expect(await iniciar()).toMatchObject({ ok: false, motivo: 'equipos-invalidos' })
    expect(await foto()).toEqual(antes)
  })

  it('precedencia: una pantalla vieja recibe reloj-desactualizado antes que la plantilla', async () => {
    await sembrarInicio([jug('a1', 'EL', undefined)])
    const vieja = await obs()
    await db.partidos.update('P', { relojEstado: 'detenido', relojRestante: 1 })
    expect(await R.iniciarPartido('P', vieja)).toMatchObject({ ok: false, motivo: 'reloj-desactualizado' })
  })

  it('una vista vieja de la plantilla no salta la relectura: el partido se lee de nuevo al iniciar', async () => {
    await sembrarInicio([jug('a1', 'EL', 3)])
    const observado = await obs() // la pantalla vio una plantilla válida
    await db.jugadores.update('a1', { dorsal: undefined }) // cambia después, sin tocar el partido
    expect(await R.iniciarPartido('P', observado)).toMatchObject({ ok: false, motivo: 'plantilla-incompleta' })
    expect((await db.partidos.get('P')).estado).toBe('programado')
  })

  it('reanudar, detener, cambiar de periodo y cerrar no consultan plantillas', async () => {
    await sembrarInicio([jug('a1', 'EL', 3)])
    expect((await iniciar()).ok).toBe(true)
    await db.jugadores.update('a1', { dorsal: undefined }) // pendiente después del inicio: sin política
    expect((await arrancar()).ok).toBe(true)
    pasar(1000)
    expect((await detener()).ok).toBe(true)
    expect((await siguiente()).ok).toBe(true)
    expect((await arrancar()).ok).toBe(true)
    expect((await cerrar()).ok).toBe(true)
  })

  it('un partido ya vivo sigue rechazando el inicio por estado, no por plantilla', async () => {
    await sembrar({ estado: 'vivo' })
    await db.jugadores.add(jug('a1', 'EL', undefined))
    expect(await iniciar()).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado: 'vivo' })
  })

  it('solo el inicio amplía el alcance con equipos y jugadores', async () => {
    const fuente = readFileSync('src/lib/reloj.js', 'utf8')
    expect(fuente.match(/tablasExtra: \[/g)).toHaveLength(1)
    expect(fuente).toMatch(/iniciarPartido[\s\S]*tablasExtra: \[db\.equipos, db\.jugadores\]/)
  })
})

describe('inicio: ligaId ausente o mal formado', () => {
  const sin = Symbol('sin ligaId')
  const poner = (valor) => db.partidos.update('P', { ligaId: valor === sin ? undefined : valor })

  it.each([
    ['ausente', sin], ['null', null], ['vacío', ''], ['solo espacios', '   '], ['número', 5], ['objeto', {}], ['arreglo', []],
  ])('con ligaId %s, iniciarPartido devuelve equipos-invalidos sin lanzar ni escribir', async (_n, valor) => {
    await sembrar({ estado: 'programado', sinReloj: true })
    await poner(valor)
    const antes = await foto()
    expect(await iniciar()).toEqual({ ok: false, motivo: 'equipos-invalidos', detalle: { causa: 'liga' } })
    expect(await foto()).toEqual(antes)
    expect(await db.auditoriaReloj.count()).toBe(0)
  })

  it('precedencia: el estado del partido y el reloj observado se evalúan antes que la liga', async () => {
    await sembrar({ estado: 'programado', sinReloj: true })
    await poner(null)
    const vieja = await obs()
    await db.partidos.update('P', { relojEstado: 'detenido' })
    expect(await R.iniciarPartido('P', vieja)).toMatchObject({ ok: false, motivo: 'reloj-desactualizado' })
    await db.partidos.update('P', { estado: 'vivo' })
    expect(await iniciar()).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado: 'vivo' })
  })

  it('un partido que no existe sigue devolviendo partido-no-disponible', async () => {
    await sembrar({ estado: 'programado', sinReloj: true })
    expect(await R.iniciarPartido('NO', await obs())).toMatchObject({ ok: false, motivo: 'partido-no-disponible' })
  })

  it('los demás comandos no cambian: con ligaId nulo no devuelven equipos-invalidos ni plantilla-incompleta', async () => {
    await sembrar({ estado: 'vivo' })
    await poner(null)
    const antes = await foto()
    const resultado = await arrancar().then((r) => r, (e) => ({ lanzo: e.name }))
    // Comportamiento anterior, sin cambios y fuera de este alcance: la lectura de la liga lanza y no queda nada escrito.
    expect(resultado.lanzo).toBeTruthy()
    expect(resultado.motivo).toBeUndefined()
    expect(await foto()).toEqual(antes)
  })
})

// ---------------------------------------------------------------------------
// Superposición real. Las transacciones de IndexedDB con alcance común se
// ejecutan en el orden en que se crean. Se coordina sin esperas por tiempo y sin
// ganchos de producción: un gancho de Dexie SOLO de la prueba, que corre dentro
// de la transacción que ya está escribiendo, pide la otra operación en ese
// momento (fuera de la zona de esa transacción). La otra operación nace, pues,
// mientras la primera sigue abierta.
// ---------------------------------------------------------------------------
describe('inicio y edición de plantilla superpuestos', () => {
  const DUENO = { rol: 'organizador', cuentaId: 'yo' }
  const ficha = (id, equipoId, dorsal) => ({
    id, ligaId: 'L', equipoId, nombre: 'Ana Perez', nombrePila: 'Ana', apellido1: 'Perez', apellido2: '',
    personaId: `p-${id}`, codigo: `c-${id}`, nombreCamiseta: '', dorsal,
  })
  const cambioDeNombre = { nombrePila: 'Anita' }

  async function preparar() {
    await sembrar({ estado: 'programado', sinReloj: true })
    await db.jugadores.bulkAdd([ficha('a1', 'EL', 5), ficha('b1', 'EV', 6)])
    return { liga: await db.ligas.get('L'), Roster: await import('./roster.js') }
  }
  const aparte = (fn) => db.constructor.ignoreTransaction(fn)

  // El dominio ya no puede dejar a un jugador sin número, así que el escritor que lo hace aquí es un
  // escritor que no pasa por el dominio (un dato heredado, una siembra, un importador futuro): justo
  // el caso que la lectura dentro de la transacción de inicio debe atrapar.
  it('una escritura anterior que deja a un activo sin número se ve en el inicio, que rechaza sin efectos', async () => {
    await preparar()
    const observado = await obs()
    const antes = await foto()
    const bitacora = []
    let inicio
    await db.transaction('rw', db.jugadores, async () => {
      await db.jugadores.update('a1', { dorsal: undefined })
      bitacora.push('escritura-hecha')
      bitacora.push('inicio-pedido')
      inicio = aparte(() => R.iniciarPartido('P', observado)) // nace con la escritura aún sin confirmar
    })
    const resultado = await inicio
    expect(bitacora).toEqual(['escritura-hecha', 'inicio-pedido'])
    expect(resultado).toMatchObject({ ok: false, motivo: 'plantilla-incompleta' })
    expect(await foto()).toEqual(antes)
    expect('dorsal' in (await db.jugadores.get('a1'))).toBe(false)
  })

  it('un inicio anterior confirma con su plantilla válida mientras la edición posterior espera', async () => {
    const { liga, Roster } = await preparar()
    const observado = await obs()
    const bitacora = []
    let edicion
    db.partidos.hook('updating', () => {
      bitacora.push('inicio-escribe')
      if (!edicion) {
        bitacora.push('edicion-pedida')
        edicion = aparte(() => Roster.editarJugador({ sesion: DUENO, liga, ficha: { id: 'a1' }, campos: cambioDeNombre }))
      }
    })
    db.jugadores.hook('updating', () => { bitacora.push('edicion-escribe') })

    const resultado = await R.iniciarPartido('P', observado)
    expect(resultado).toEqual({ ok: true, comando: 'inicio-partido' })
    await edicion
    // La edición pedida durante el inicio escribió después de la escritura del inicio.
    expect(bitacora).toEqual(['inicio-escribe', 'edicion-pedida', 'edicion-escribe'])
    expect((await registros()).map((r) => r.comando)).toEqual(['inicio-partido'])
    // Solo demuestra el orden del inicio; no aprueba ninguna política de cambios con el partido vivo.
  })
})
