import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Seguridad de la frontera de periodo (Slice B): anotar/marcarFalta,
// siguientePeriodo, deshacer, rehacer y anularEvento son transacciones que
// validan el estado antes de escribir. Un rechazo no escribe nada.
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
let M // lib/marcador
let R // lib/reloj

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
  ;({ db } = await import('../db.js'))
  M = await import('./marcador.js')
  R = await import('./reloj.js')
})

afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await borrarBd()
})

async function sembrar({ estado = 'vivo', deporte = 'baloncesto', reloj = {} } = {}) {
  await db.ligas.add({ id: 'L', deporte, nombre: 'Liga', organizadorId: 'yo' })
  await db.partidos.add({
    id: 'P', ligaId: 'L', estado, relojEstado: 'detenido', relojRestante: 123000, relojDesde: null, ...reloj,
  })
}

const todos = () => db.eventos.where('partidoId').equals('P').toArray().then((e) => e.sort((a, b) => a.seq - b.seq))
const foto = async () => ({ eventos: await todos(), partido: await db.partidos.get('P') })

// Lo que la pantalla estaba mostrando.
const vista = async (deporte = 'baloncesto') => {
  const ev = await todos()
  return {
    periodo: M.periodoVisible(ev, deporte),
    marcaPeriodo: M.marcaDePeriodo(ev),
    observado: R.observadoDe(await db.partidos.get('P'), await R.ultimoSeqAuditoria('P')),
  }
}

const punto = async (extra = {}) =>
  M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 2, ...(await vista()), ...extra })
const falta = async (extra = {}) =>
  M.marcarFalta({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', ...(await vista()), ...extra })
const transicion = async (extra = {}) => {
  const v = await vista()
  const liga = await db.ligas.get('L')
  return R.siguientePeriodo({ id: 'P' }, liga, v.periodo, v.marcaPeriodo, v.observado, ...[].concat(extra))
}

let n = 0
const evento = (campos) => ({
  id: `e${++n}`, partidoId: 'P', anulado: false, creadoEn: 1, equipoId: 'E1', jugadorId: 'J1', ...campos,
})

describe('helpers puros', () => {
  it('marcaDePeriodo cuenta también las transiciones anuladas; periodoEnPosicion usa solo las vivas', async () => {
    await sembrar()
    const ev = [
      evento({ seq: 1, tipo: 'punto', puntos: 2, periodo: 1 }),
      evento({ seq: 2, tipo: 'periodo', periodo: 1, anulado: true }),
      evento({ seq: 3, tipo: 'periodo', periodo: 1 }),
      evento({ seq: 4, tipo: 'punto', puntos: 2, periodo: 2 }),
    ]
    expect(M.marcaDePeriodo([])).toBe(0)
    expect(M.marcaDePeriodo(ev)).toBe(3)
    expect(M.periodoEnPosicion(ev, 1)).toBe(1)
    expect(M.periodoEnPosicion(ev, 4)).toBe(2)
    expect(M.periodoActual(ev)).toBe(2)
  })
})

describe('anotar y marcarFalta', () => {
  it('guardan el mismo evento de antes; dos toques intencionales son dos eventos', async () => {
    await sembrar()
    expect((await punto()).ok).toBe(true)
    expect((await punto()).ok).toBe(true)
    expect((await falta()).ok).toBe(true)
    const ev = await todos()
    expect(ev.map((e) => [e.seq, e.tipo, e.puntos, e.periodo, e.equipoId, e.jugadorId, e.anulado]))
      .toEqual([[1, 'punto', 2, 1, 'E1', 'J1', false], [2, 'punto', 2, 1, 'E1', 'J1', false], [3, 'falta', 0, 1, 'E1', 'J1', false]])
    expect(typeof ev[0].creadoEn).toBe('number')
  })

  it('un reloj detenido permite anotar', async () => {
    await sembrar({ reloj: { relojEstado: 'detenido', relojRestante: 0, relojDesde: null } })
    expect((await punto()).ok).toBe(true)
  })

  it('anotar bloquea el rehacer pendiente (como siempre)', async () => {
    await sembrar()
    await punto()
    await M.deshacer('P')
    expect((await todos())[0].rehacerBloqueado).toBeUndefined()
    await punto()
    expect((await todos())[0].rehacerBloqueado).toBe(true)
  })

  it.each([['programado'], ['final']])('un partido %s rechaza y no cambia nada, ni el rehacer pendiente', async (estado) => {
    await sembrar()
    await punto()
    await M.deshacer('P') // rehacer pendiente
    await db.partidos.update('P', { estado })
    const antes = await foto()
    const r1 = await punto()
    const r2 = await falta()
    expect(r1).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado })
    expect(r2).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado })
    expect(await foto()).toEqual(antes)
    expect((await todos())[0].rehacerBloqueado).toBeUndefined()
    expect(M.hayQueRehacer(await todos())).toBe(true)
  })

  it('un partido inexistente rechaza sin escribir', async () => {
    const r = await M.anotar({ partidoId: 'NO', equipoId: 'E1', jugadorId: 'J1', puntos: 1, periodo: 1, marcaPeriodo: 0 })
    expect(r).toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado: null })
    expect(await db.eventos.count()).toBe(0)
  })

  it('un periodo viejo se rechaza y no se reetiqueta ni se reintenta', async () => {
    await sembrar()
    const vieja = await vista() // el periodo 1 que mostraba la pantalla
    expect((await transicion()).ok).toBe(true)
    const antes = await foto()
    const r = await M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 3, ...vieja })
    expect(r).toEqual({ ok: false, motivo: 'periodo-desactualizado' })
    expect(await foto()).toEqual(antes)
    expect((await todos()).filter((e) => e.tipo === 'punto')).toHaveLength(0)
  })

  it('una marca vieja se rechaza aunque el número de periodo vuelva a coincidir tras una corrección', async () => {
    await sembrar()
    const vieja = await vista() // periodo 1, marca 0
    await transicion()
    // Simula una corrección posterior: la transición queda anulada y el periodo vuelve a ser 1.
    const [t] = await todos()
    await db.eventos.update(t.id, { anulado: true, anuladoEn: 5, rehacerBloqueado: true })
    const ahora = await vista()
    expect(ahora.periodo).toBe(vieja.periodo)
    expect(ahora.marcaPeriodo).not.toBe(vieja.marcaPeriodo)

    const antes = await foto()
    expect(await M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 1, ...vieja }))
      .toEqual({ ok: false, motivo: 'periodo-desactualizado' })
    expect(await M.marcarFalta({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', ...vieja }))
      .toEqual({ ok: false, motivo: 'periodo-desactualizado' })
    expect(await foto()).toEqual(antes)
    expect((await M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 1, ...ahora })).ok).toBe(true)
  })

  it('un periodo inventado por la pantalla también se rechaza', async () => {
    await sembrar()
    const v = await vista()
    expect((await M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 1, periodo: 2, marcaPeriodo: v.marcaPeriodo })).ok).toBe(false)
    expect((await M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 1, periodo: 1 })).ok).toBe(false) // sin marca
    expect(await db.eventos.count()).toBe(0)
  })

  it('con más transiciones que periodos (doble toque antiguo) se anota con el tope que muestra la pantalla', async () => {
    await sembrar({ deporte: 'futsal' })
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'periodo', periodo: 1 }),
      evento({ seq: 2, tipo: 'periodo', periodo: 2 }),
    ])
    const v = await vista('futsal')
    expect(v.periodo).toBe(2)
    expect((await M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 1, ...v })).ok).toBe(true)
    expect((await todos()).at(-1)).toMatchObject({ tipo: 'punto', periodo: 2, seq: 3 })
  })
})

describe('siguientePeriodo', () => {
  it('anota la transición y reinicia el reloj juntos, y conserva el rehacer pendiente', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: Date.now() } })
    await punto()
    await M.deshacer('P')
    expect((await transicion()).ok).toBe(true)
    const ev = await todos()
    expect(ev.map((e) => [e.seq, e.tipo, e.periodo])).toEqual([[1, 'punto', 1], [2, 'periodo', 1]])
    expect(ev[0].rehacerBloqueado).toBeUndefined() // la transición no bloquea el rehacer
    expect(await db.partidos.get('P')).toMatchObject({ relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    expect(M.hayQueRehacer(ev)).toBe(true)
  })

  it('doble toque concurrente: una sola transición y un solo reinicio', async () => {
    await sembrar()
    const v = await vista()
    const liga = await db.ligas.get('L')
    const resultados = await Promise.all([1, 2, 3].map(() => R.siguientePeriodo({ id: 'P' }, liga, v.periodo, v.marcaPeriodo, v.observado)))
    expect(resultados.filter((r) => r.ok)).toHaveLength(1)
    resultados.filter((r) => !r.ok).forEach((r) => expect(r.motivo).toBe('periodo-desactualizado'))
    expect((await todos()).filter((e) => e.tipo === 'periodo')).toHaveLength(1)
  })

  it('rechazos (pantalla vieja, partido no vivo, último periodo) no escriben nada', async () => {
    await sembrar()
    const vieja = await vista()
    await transicion()
    const liga = await db.ligas.get('L')

    let antes = await foto()
    expect(await R.siguientePeriodo({ id: 'P' }, liga, vieja.periodo, vieja.marcaPeriodo, vieja.observado))
      .toEqual({ ok: false, motivo: 'periodo-desactualizado' })
    expect(await foto()).toEqual(antes)

    const v = await vista()
    for (const estado of ['programado', 'final']) {
      await db.partidos.update('P', { estado })
      antes = await foto()
      expect(await R.siguientePeriodo({ id: 'P' }, liga, v.periodo, v.marcaPeriodo, v.observado))
        .toMatchObject({ ok: false, motivo: 'partido-no-disponible', estado })
      expect(await foto()).toEqual(antes)
    }
    await db.partidos.update('P', { estado: 'vivo' })

    await transicion()
    await transicion() // periodo 4 de 4
    antes = await foto()
    const ultimo = await vista()
    expect(ultimo.periodo).toBe(4)
    expect(await R.siguientePeriodo({ id: 'P' }, liga, ultimo.periodo, ultimo.marcaPeriodo, ultimo.observado))
      .toEqual({ ok: false, motivo: 'ultimo-periodo' })
    expect(await foto()).toEqual(antes)
  })

  it('si falla la escritura del reloj, no queda ni la transición ni el reinicio (rollback)', async () => {
    await sembrar({ reloj: { relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 1234 } })
    await punto()
    const antes = await foto()
    vi.spyOn(db.partidos, 'update').mockRejectedValueOnce(new Error('fallo simulado'))
    await expect(transicion()).rejects.toThrow('fallo simulado')
    expect(await foto()).toEqual(antes)
    expect((await todos()).filter((e) => e.tipo === 'periodo')).toHaveLength(0)
  })

  it('anotar y cambiar de periodo a la vez: seq únicos y cada evento en su periodo', async () => {
    await sembrar()
    // Tres rondas: periodos 1→2→3→4 (el 4º es el último y ya no admite transición).
    for (let ronda = 0; ronda < 3; ronda++) {
      const v = await vista()
      const liga = await db.ligas.get('L')
      const lote = []
      for (let i = 0; i < 6; i++) lote.push(M.anotar({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', puntos: 1, ...v }))
      lote.push(R.siguientePeriodo({ id: 'P' }, liga, v.periodo, v.marcaPeriodo, v.observado))
      for (let i = 0; i < 6; i++) lote.push(M.marcarFalta({ partidoId: 'P', equipoId: 'E1', jugadorId: 'J1', ...v }))
      lote.push(R.siguientePeriodo({ id: 'P' }, liga, v.periodo, v.marcaPeriodo, v.observado))
      await Promise.all(lote)

      const ev = await todos()
      const seqs = ev.map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
      for (const e of ev.filter((x) => x.tipo !== 'periodo')) {
        expect(e.periodo).toBe(M.periodoEnPosicion(ev, e.seq, 'baloncesto'))
      }
      // Dos transiciones simultáneas con la misma vista: solo una gana.
      expect(ev.filter((e) => e.tipo === 'periodo')).toHaveLength(ronda + 1)
    }
  })
})

describe('deshacer', () => {
  it('anula el último punto o falta vivo; con historial vacío no hace nada', async () => {
    await sembrar()
    expect(await M.deshacer('P')).toEqual({ resultado: 'nada' })
    await punto(); await falta()
    expect((await M.deshacer('P')).resultado).toBe('anulado')
    expect((await todos()).map((e) => e.anulado)).toEqual([false, true])
    expect((await M.deshacer('P')).resultado).toBe('anulado')
    expect(await M.deshacer('P')).toEqual({ resultado: 'nada' })
  })

  it('se detiene en la transición: no la anula ni salta a un punto anterior', async () => {
    await sembrar()
    await punto()
    await transicion()
    const antes = await foto()
    const r = await M.deshacer('P')
    expect(r.resultado).toBe('limite-periodo')
    expect(await foto()).toEqual(antes)
    expect((await todos()).map((e) => e.anulado)).toEqual([false, false])
  })

  it('con acciones posteriores a la transición: las deshace y luego se detiene en ella', async () => {
    await sembrar()
    await punto()
    await transicion()
    await punto(); await falta()
    expect((await M.deshacer('P')).resultado).toBe('anulado')
    expect((await M.deshacer('P')).resultado).toBe('anulado')
    const antes = await foto()
    expect((await M.deshacer('P')).resultado).toBe('limite-periodo')
    expect(await foto()).toEqual(antes)
    expect((await todos()).map((e) => [e.tipo, e.anulado])).toEqual([['punto', false], ['periodo', false], ['punto', true], ['falta', true]])
  })

  it('una transición anulada (datos antiguos) no cuenta como frontera activa', async () => {
    await sembrar()
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'punto', puntos: 2, periodo: 1 }),
      evento({ seq: 2, tipo: 'periodo', periodo: 1, anulado: true, anuladoEn: 9 }),
      evento({ seq: 3, tipo: 'punto', puntos: 2, periodo: 1 }),
    ])
    expect((await M.deshacer('P')).evento.seq).toBe(3)
    expect((await M.deshacer('P')).evento.seq).toBe(1)
    expect((await todos())[1].anulado).toBe(true) // la transición antigua queda como estaba
  })

  it('sigue disponible con el partido terminado', async () => {
    await sembrar({ estado: 'final' })
    await db.eventos.add(evento({ seq: 1, tipo: 'punto', puntos: 3, periodo: 1 }))
    expect((await M.deshacer('P')).resultado).toBe('anulado')
  })
})

describe('rehacer', () => {
  it('conserva el orden por hora de anulación y no revive eventos bloqueados', async () => {
    await sembrar()
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'punto', puntos: 1, periodo: 1, anulado: true, anuladoEn: 10 }),
      evento({ seq: 2, tipo: 'punto', puntos: 2, periodo: 1, anulado: true, anuladoEn: 30 }),
      evento({ seq: 3, tipo: 'punto', puntos: 3, periodo: 1, anulado: true, anuladoEn: 20 }),
      evento({ seq: 4, tipo: 'punto', puntos: 4, periodo: 1, anulado: true, anuladoEn: 99, rehacerBloqueado: true }),
    ])
    expect((await M.rehacer('P')).evento.seq).toBe(2)
    expect((await M.rehacer('P')).evento.seq).toBe(3)
    expect((await M.rehacer('P')).evento.seq).toBe(1)
    expect(await M.rehacer('P')).toEqual({ resultado: 'nada' })
    expect((await todos())[3]).toMatchObject({ anulado: true, rehacerBloqueado: true })
  })

  it('no considera las transiciones anuladas, pero conserva sus registros', async () => {
    await sembrar()
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'punto', puntos: 2, periodo: 1, anulado: true, anuladoEn: 5 }),
      evento({ seq: 2, tipo: 'periodo', periodo: 1, anulado: true, anuladoEn: 50 }),
    ])
    const ev = await todos()
    expect(M.hayQueRehacer(ev)).toBe(true)
    expect((await M.rehacer('P')).evento.seq).toBe(1)
    const despues = await todos()
    expect(despues[1]).toMatchObject({ tipo: 'periodo', anulado: true, anuladoEn: 50 })
    expect(M.hayQueRehacer(despues)).toBe(false)
    expect(await M.rehacer('P')).toEqual({ resultado: 'nada' })
  })

  it('solo una transición anulada: no hay nada que rehacer', async () => {
    await sembrar()
    await db.eventos.add(evento({ seq: 1, tipo: 'periodo', periodo: 1, anulado: true, anuladoEn: 5 }))
    expect(M.hayQueRehacer(await todos())).toBe(false)
    expect(await M.rehacer('P')).toEqual({ resultado: 'nada' })
  })

  it('un evento de un periodo anterior se puede rehacer después de cambiar de periodo y vuelve a su periodo', async () => {
    await sembrar()
    await punto()
    await M.deshacer('P')
    await transicion()
    expect((await M.rehacer('P')).resultado).toBe('rehecho')
    const ev = await todos()
    expect(ev[0]).toMatchObject({ tipo: 'punto', periodo: 1, anulado: false })
    expect(M.marcadorEquipo(ev, 'E1')).toBe(2)
    expect(M.periodoActual(ev)).toBe(2)
  })

  it('si el periodo del candidato no encaja con su lugar, se detiene y no salta a otro', async () => {
    await sembrar()
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'punto', puntos: 1, periodo: 1, anulado: true, anuladoEn: 10 }), // válido, más antiguo
      evento({ seq: 2, tipo: 'periodo', periodo: 1 }),
      evento({ seq: 3, tipo: 'punto', puntos: 2, periodo: 1, anulado: true, anuladoEn: 20 }), // dice periodo 1 pero está tras la transición
    ])
    const antes = await foto()
    const r = await M.rehacer('P')
    expect(r.resultado).toBe('periodo-invalido')
    expect(r.evento.seq).toBe(3)
    expect(await foto()).toEqual(antes)
    expect(M.marcadorEquipo(await todos(), 'E1')).toBe(0)
  })

  it('sigue disponible con el partido terminado', async () => {
    await sembrar({ estado: 'final' })
    await db.eventos.add(evento({ seq: 1, tipo: 'punto', puntos: 3, periodo: 1, anulado: true, anuladoEn: 5 }))
    expect((await M.rehacer('P')).resultado).toBe('rehecho')
  })
})

describe('anularEvento', () => {
  it('anula puntos y faltas, también de periodos anteriores, y deja el rehacer como estaba', async () => {
    await sembrar()
    await punto(); await falta()
    await transicion()
    await punto()
    const [p1, f1] = await todos()
    expect((await M.anularEvento(p1.id)).resultado).toBe('anulado')
    expect((await M.anularEvento(f1.id)).resultado).toBe('anulado')
    const ev = await todos()
    expect(ev[0]).toMatchObject({ anulado: true })
    expect(typeof ev[0].anuladoEn).toBe('number')
    expect(ev[0].rehacerBloqueado).toBeUndefined()
    expect(M.hayQueRehacer(ev)).toBe(true)
  })

  it('rechaza las transiciones de periodo sin escribir', async () => {
    await sembrar()
    await punto()
    await transicion()
    const t = (await todos()).find((e) => e.tipo === 'periodo')
    const antes = await foto()
    expect((await M.anularEvento(t.id)).resultado).toBe('limite-periodo')
    expect(await foto()).toEqual(antes)
  })

  it('un evento ya anulado o un id desconocido no hacen nada: ni hora nueva ni marca de bloqueo', async () => {
    await sembrar()
    await db.eventos.bulkAdd([
      evento({ seq: 1, tipo: 'punto', puntos: 1, periodo: 1, anulado: true, anuladoEn: 111 }),
      evento({ seq: 2, tipo: 'punto', puntos: 1, periodo: 1, anulado: true, anuladoEn: 222, rehacerBloqueado: true }),
    ])
    const antes = await foto()
    const [a, b] = antes.eventos
    expect((await M.anularEvento(a.id)).resultado).toBe('nada')
    expect((await M.anularEvento(b.id)).resultado).toBe('nada')
    expect(await M.anularEvento('no-existe')).toEqual({ resultado: 'nada' })
    expect(await foto()).toEqual(antes)
    expect((await M.rehacer('P')).evento.seq).toBe(1) // el orden de rehacer no cambió
  })

  it('sigue disponible con el partido terminado', async () => {
    await sembrar({ estado: 'final' })
    await db.eventos.add(evento({ seq: 1, tipo: 'falta', puntos: 0, periodo: 1 }))
    const [f] = await todos()
    expect((await M.anularEvento(f.id)).resultado).toBe('anulado')
  })
})

describe('historias antiguas de la demo (limitación conocida)', () => {
  // Así quedaba la demo antes de ordenarHistoria: todos los puntos y faltas primero y las
  // transiciones al final. Las bases que ya tienen esa siembra no se tocan ni se vuelven a sembrar.
  const historiaAntigua = () => [
    evento({ seq: 1, tipo: 'punto', puntos: 2, periodo: 1 }),
    evento({ seq: 2, tipo: 'punto', puntos: 3, periodo: 2 }),
    evento({ seq: 3, tipo: 'falta', puntos: 0, periodo: 2 }),
    evento({ seq: 4, tipo: 'periodo', periodo: 1 }),
    evento({ seq: 5, tipo: 'periodo', periodo: 2 }),
  ]

  it('su periodo no encaja con su lugar, y rehacer lo rechaza sin escribir', async () => {
    await sembrar()
    await db.eventos.bulkAdd(historiaAntigua())
    const ev = await todos()
    expect(ev.filter((e) => e.tipo !== 'periodo' && e.periodo !== M.periodoEnPosicion(ev, e.seq, 'baloncesto')).length).toBe(2)

    // Un evento de periodo 2 anulado con Anular (sin bloqueo): no se puede rehacer.
    const punto2 = ev.find((e) => e.puntos === 3)
    expect((await M.anularEvento(punto2.id)).resultado).toBe('anulado')
    const antes = await foto()
    const r = await M.rehacer('P')
    expect(r.resultado).toBe('periodo-invalido')
    expect(r.evento.id).toBe(punto2.id)
    expect(await foto()).toEqual(antes)
  })

  it('un evento del periodo 1 de esa historia sí se puede rehacer', async () => {
    await sembrar()
    await db.eventos.bulkAdd(historiaAntigua())
    const [p1] = await todos()
    await M.anularEvento(p1.id)
    expect((await M.rehacer('P')).resultado).toBe('rehecho')
  })
})
